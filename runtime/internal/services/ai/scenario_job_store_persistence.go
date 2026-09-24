package ai

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	scenarioJobDiskStoreVersion           = 1
	scenarioJobDiskStoreDirName           = "scenario-jobs"
	scenarioJobDiskStoreFileName          = "scenario-jobs.json"
	scenarioJobIsolationLevelRecord       = "record"
	scenarioJobIsolationLevelDocument     = "document"
	scenarioJobRecordQuarantinedReason    = "SCENARIO_JOB_RECORD_QUARANTINED"
	scenarioJobDocumentQuarantinedReason  = "SCENARIO_JOB_DOCUMENT_QUARANTINED"
	scenarioJobIsolationQuarantineDirName = "state-quarantine"
	scenarioJobQuarantineRecordsLevel     = "records"
)

type scenarioJobIsolationDiagnostic struct {
	Level          string
	ReasonCode     string
	Message        string
	QuarantinePath string
	Section        string
	RecordIndex    int
	RecordID       string
	// JournalLine is the 1-based journal line of the isolated row; zero for a
	// base snapshot row.
	JournalLine int
}

type scenarioJobDiskRawSnapshot struct {
	Version        int               `json:"version"`
	Records        []json.RawMessage `json:"records"`
	Idempotency    []json.RawMessage `json:"idempotency,omitempty"`
	PendingCustody []json.RawMessage `json:"pending_credential_custody,omitempty"`
}

type scenarioJobQuarantinedRecord struct {
	Section     string
	RecordIndex int
	JournalLine int
	RecordID    string
	Reason      string
	Raw         json.RawMessage
}

// scenarioJobLoadRow is one row reload validates: a base snapshot row, or the
// final journal row of a key (journalLine > 0).
type scenarioJobLoadRow struct {
	raw         json.RawMessage
	key         string
	index       int
	journalLine int
}

type scenarioJobDiskSnapshot struct {
	Version        int                               `json:"version"`
	Records        []scenarioJobDiskRecord           `json:"records"`
	Idempotency    []scenarioJobDiskIdempotencyEntry `json:"idempotency,omitempty"`
	PendingCustody []scenarioJobDiskPendingCustody   `json:"pending_credential_custody,omitempty"`
}

type scenarioJobDiskRecord struct {
	Payload               *embeddingPayload        `json:"embedding_payload,omitempty"`
	Job                   json.RawMessage          `json:"job"`
	ResolvedAssembly      json.RawMessage          `json:"resolved_assembly,omitempty"`
	CloudResolvedAssembly json.RawMessage          `json:"cloud_resolved_assembly,omitempty"`
	VoiceAsset            json.RawMessage          `json:"voice_asset,omitempty"`
	VoiceReference        json.RawMessage          `json:"voice_reference,omitempty"`
	VisionLocate          json.RawMessage          `json:"vision_locate,omitempty"`
	Owner                 *localAppJobOwner        `json:"owner,omitempty"`
	MusicSubmission       *localAppMusicSubmission `json:"music_submission,omitempty"`
	CreatedAt             time.Time                `json:"created_at"`
	UpdatedAt             time.Time                `json:"updated_at"`
	TerminalAt            time.Time                `json:"terminal_at,omitempty"`
}

type scenarioJobDiskIdempotencyEntry struct {
	ScopeKey string    `json:"scope_key"`
	JobID    string    `json:"job_id"`
	BoundAt  time.Time `json:"bound_at"`
}

type scenarioJobDiskPendingCustody struct {
	JobID      string    `json:"job_id"`
	Ref        string    `json:"credential_custody_ref"`
	CapturedAt time.Time `json:"captured_at"`
}

// @nimi-authority: rule.nimi.runtime.local-compute.r100
func newScenarioJobStoreForLocalStatePath(localStatePath string) (*scenarioJobStore, error) {
	return newScenarioJobStoreForLocalStatePathWithStartupPrune(localStatePath, true)
}

// newScenarioJobStoreForLocalStatePathBeforeStartupPrune retains recovered
// terminal Jobs until every cross-store publication protocol has reconciled.
// Production startup prunes and persists them immediately afterward.
func newScenarioJobStoreForLocalStatePathBeforeStartupPrune(localStatePath string) (*scenarioJobStore, error) {
	return newScenarioJobStoreForLocalStatePathWithStartupPrune(localStatePath, false)
}

func newScenarioJobStoreForLocalStatePathWithStartupPrune(localStatePath string, prune bool) (*scenarioJobStore, error) {
	store := newScenarioJobStore()
	store.durablePath = scenarioJobStorePathForLocalStatePath(localStatePath)
	if store.durablePath == "" {
		return store, nil
	}
	if err := store.loadDurableJobs(prune); err != nil {
		return nil, err
	}
	return store, nil
}

func scenarioJobStorePathForLocalStatePath(localStatePath string) string {
	trimmed := strings.TrimSpace(localStatePath)
	if trimmed == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(trimmed), scenarioJobDiskStoreDirName, scenarioJobDiskStoreFileName)
}

// @nimi-authority: rule.nimi.runtime.service-operations.r072
func (s *scenarioJobStore) loadDurableJobs(prune bool) error {
	raw, err := os.ReadFile(s.durablePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	document, err := parseScenarioJobDurableDocument(raw)
	if err != nil {
		return s.isolateDurableDocument(raw, err)
	}
	snapshot := document.base
	if snapshot.Version != scenarioJobDiskStoreVersion {
		return s.isolateDurableDocument(raw, fmt.Errorf("unsupported scenario job store version %d", snapshot.Version))
	}
	// A Job, binding, or custody obligation that the journal touched is
	// represented by its final journal row, never by its base row.
	replay := replayScenarioJobJournal(document.entries)

	now := time.Now().UTC()
	quarantined := make([]scenarioJobQuarantinedRecord, 0)
	recordRows := make([]scenarioJobLoadRow, 0, len(snapshot.Records)+len(replay.records.order))
	for index, rawRecord := range snapshot.Records {
		recordRows = append(recordRows, scenarioJobLoadRow{raw: rawRecord, index: index})
	}
	for _, row := range replay.records.live() {
		recordRows = append(recordRows, scenarioJobLoadRow{raw: row.value.Record, key: row.value.JobID, index: row.index, journalLine: row.line})
	}
	for _, row := range recordRows {
		var item scenarioJobDiskRecord
		rowErr := decodeScenarioJobStrictJSON(row.raw, &item)
		var job runtimev1.ScenarioJob
		if rowErr == nil {
			rowErr = (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(item.Job, &job)
		}
		jobID := strings.TrimSpace(job.GetJobId())
		if rowErr == nil && row.journalLine == 0 && replay.records.touched(jobID) {
			continue
		}
		if rowErr == nil && row.journalLine > 0 && jobID != row.key {
			rowErr = fmt.Errorf("journal row for scenario job %q holds scenario job %q", row.key, jobID)
		}
		var resolvedAssembly *localResolvedAssembly
		if rowErr == nil && len(item.ResolvedAssembly) > 0 {
			resolvedAssembly = &localResolvedAssembly{}
			rowErr = decodeScenarioJobStrictJSON(item.ResolvedAssembly, resolvedAssembly)
		}
		var cloudAssembly *cloudResolvedAssembly
		if rowErr == nil && len(item.CloudResolvedAssembly) > 0 {
			cloudAssembly = &cloudResolvedAssembly{}
			rowErr = decodeScenarioJobStrictJSON(item.CloudResolvedAssembly, cloudAssembly)
		}
		if rowErr == nil {
			rowErr = validatePersistedScenarioJob(&job, item.CreatedAt, item.UpdatedAt, item.TerminalAt)
		}
		if rowErr == nil {
			rowErr = validateScenarioJobPayload(&job, resolvedAssembly, cloudAssembly, item.Payload)
		}
		if rowErr == nil {
			rowErr = validateLocalAppMusicSubmission(item.MusicSubmission, item.Owner, &job)
		}
		if rowErr == nil && item.MusicSubmission != nil && s.musicSubmissionLocked(item.Owner, item.MusicSubmission.ID) != nil {
			rowErr = errors.New("duplicate protected music submission binding")
		}
		var voiceAsset *runtimev1.VoiceAsset
		if rowErr == nil && len(item.VoiceAsset) > 0 {
			voiceAsset = &runtimev1.VoiceAsset{}
			rowErr = (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(item.VoiceAsset, voiceAsset)
		}
		var voiceReference *runtimev1.VoiceReference
		if rowErr == nil && len(item.VoiceReference) > 0 {
			voiceReference = &runtimev1.VoiceReference{}
			rowErr = (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(item.VoiceReference, voiceReference)
		}
		if rowErr == nil {
			rowErr = validateScenarioJobVoiceResultPair(&job, voiceAsset, voiceReference)
		}
		var visionLocate *runtimev1.VisionLocateResult
		if rowErr == nil && len(item.VisionLocate) > 0 {
			visionLocate = &runtimev1.VisionLocateResult{}
			rowErr = (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(item.VisionLocate, visionLocate)
		}
		if rowErr == nil {
			rowErr = validateScenarioJobVisionResult(&job, resolvedAssembly, visionLocate)
		}
		if rowErr == nil && (jobID == "" || item.CreatedAt.IsZero() || item.UpdatedAt.IsZero()) {
			rowErr = errors.New("record has no stable identity or timestamps")
		}
		if rowErr == nil && s.jobs[jobID] != nil {
			rowErr = fmt.Errorf("duplicate scenario job %q", jobID)
		}
		if rowErr != nil {
			quarantined = append(quarantined, scenarioJobQuarantinedRecord{
				Section: "records", RecordIndex: row.index, JournalLine: row.journalLine, RecordID: jobID, Reason: rowErr.Error(), Raw: row.raw,
			})
			continue
		}
		if !isTerminalScenarioJobStatus(job.GetStatus()) {
			job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
			job.ReasonCode = runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED
			job.ReasonDetail = interruptedCapturedAssemblyDetail(&job)
			job.ReasonMetadata = nil
			job.Interruption = runtimeRestartExecutionInterruption()
			if projectionErr := prepareFailedScenarioJobProjection(&job); projectionErr != nil {
				quarantined = append(quarantined, scenarioJobQuarantinedRecord{
					Section: "records", RecordIndex: row.index, JournalLine: row.journalLine, RecordID: jobID, Reason: projectionErr.Error(), Raw: row.raw,
				})
				continue
			}
			job.UpdatedAt = timestamppb.New(now)
			item.UpdatedAt = now
			item.TerminalAt = now
			s.markDurableJobChangedLocked(jobID)
		}
		record := &scenarioJobRecord{
			payload: cloneEmbeddingPayload(item.Payload), job: cloneScenarioJob(&job), resolvedAssembly: resolvedAssembly, cloudAssembly: cloudAssembly, localAppOwner: cloneLocalAppJobOwner(item.Owner),
			voiceAsset: cloneVoiceAsset(voiceAsset), voiceReference: cloneVoiceReference(voiceReference),
			visionLocate: cloneVisionLocateResult(visionLocate),
			events:       make([]*runtimev1.ScenarioJobEvent, 0, 1), subscribers: make(map[uint64]chan *runtimev1.ScenarioJobEvent),
			musicSubmission: cloneLocalAppMusicSubmission(item.MusicSubmission),
			done:            make(chan struct{}), createdAt: item.CreatedAt.UTC(), updatedAt: item.UpdatedAt.UTC(), terminalAt: item.TerminalAt.UTC(),
		}
		projectMusicRecoveryExpiry(record)
		if isTerminalScenarioJobStatus(job.GetStatus()) {
			record.doneClosed = true
			close(record.done)
		}
		s.jobs[jobID] = record
		s.syncArtifactIndexLocked(jobID, record)
		s.publishLocked(record, scenarioJobEventForStatus(job.GetStatus()))
	}

	custodyRows, err := scenarioJobLoadRows(snapshot.PendingCustody, replay.pendingCustody.live(), func(item scenarioJobDiskPendingCustody) string { return item.JobID })
	if err != nil {
		return err
	}
	seenPendingCustody := make(map[string]struct{}, len(custodyRows))
	for _, row := range custodyRows {
		var item scenarioJobDiskPendingCustody
		rowErr := decodeScenarioJobStrictJSON(row.raw, &item)
		jobID := strings.TrimSpace(item.JobID)
		if rowErr == nil && row.journalLine == 0 && replay.pendingCustody.touched(jobID) {
			continue
		}
		ref := strings.TrimSpace(item.Ref)
		if rowErr == nil && (jobID == "" || ref == "" || item.CapturedAt.IsZero()) {
			rowErr = errors.New("pending credential custody has no stable Job, reference, or timestamp")
		}
		if rowErr == nil {
			rowErr = connector.ValidateCredentialCustodyRefForJob(ref, jobID)
		}
		if rowErr == nil && s.jobs[jobID] != nil {
			rowErr = fmt.Errorf("pending credential custody targets published scenario job %q", jobID)
		}
		if rowErr == nil {
			if _, duplicate := seenPendingCustody[jobID]; duplicate {
				rowErr = fmt.Errorf("duplicate pending credential custody for scenario job %q", jobID)
			}
		}
		if rowErr != nil {
			quarantined = append(quarantined, scenarioJobQuarantinedRecord{
				Section: "pending_credential_custody", RecordIndex: row.index, JournalLine: row.journalLine, RecordID: jobID, Reason: rowErr.Error(), Raw: row.raw,
			})
			continue
		}
		seenPendingCustody[jobID] = struct{}{}
		s.pendingCloudCustody[jobID] = scenarioPendingCloudCustody{
			jobID: jobID, ref: ref, capturedAt: item.CapturedAt.UTC(),
		}
	}

	bindingRows, err := scenarioJobLoadRows(snapshot.Idempotency, replay.idempotency.live(), func(item scenarioJobDiskIdempotencyEntry) string { return item.ScopeKey })
	if err != nil {
		return err
	}
	seenScopes := make(map[string]struct{}, len(bindingRows))
	for _, row := range bindingRows {
		var item scenarioJobDiskIdempotencyEntry
		rowErr := decodeScenarioJobStrictJSON(row.raw, &item)
		key := strings.TrimSpace(item.ScopeKey)
		if rowErr == nil && row.journalLine == 0 && replay.idempotency.touched(key) {
			continue
		}
		jobID := strings.TrimSpace(item.JobID)
		if rowErr == nil && (key == "" || jobID == "" || item.BoundAt.IsZero() || s.jobs[jobID] == nil) {
			rowErr = errors.New("binding has no stable scope, Job, timestamp, or live Job target")
		}
		if rowErr == nil {
			if _, duplicate := seenScopes[key]; duplicate {
				rowErr = fmt.Errorf("duplicate scenario job idempotency scope %q", key)
			}
		}
		if rowErr != nil {
			quarantined = append(quarantined, scenarioJobQuarantinedRecord{
				Section: "idempotency", RecordIndex: row.index, JournalLine: row.journalLine, RecordID: key, Reason: rowErr.Error(), Raw: row.raw,
			})
			continue
		}
		seenScopes[key] = struct{}{}
		s.idempotency[key] = scenarioIdempotencyBinding{jobID: jobID, boundAt: item.BoundAt.UTC()}
	}

	if len(quarantined) > 0 {
		quarantinePath, quarantineErr := s.preserveIsolatedRecords(quarantined)
		if quarantineErr != nil {
			return fmt.Errorf("preserve isolated scenario job records: %w", quarantineErr)
		}
		for _, record := range quarantined {
			s.isolationDiagnostics = append(s.isolationDiagnostics, scenarioJobIsolationDiagnostic{
				Level: scenarioJobIsolationLevelRecord, ReasonCode: scenarioJobRecordQuarantinedReason,
				Message: record.Reason, QuarantinePath: quarantinePath, Section: record.Section,
				RecordIndex: record.RecordIndex, RecordID: record.RecordID, JournalLine: record.JournalLine,
			})
		}
	}
	if document.tornBytes > 0 {
		s.isolationDiagnostics = append(s.isolationDiagnostics, scenarioJobIsolationDiagnostic{
			Level: scenarioJobIsolationLevelJournalTail, ReasonCode: scenarioJobJournalTailDiscardedReason,
			Message:     fmt.Sprintf("discarded %d bytes of a final append that was never acknowledged", document.tornBytes),
			RecordIndex: -1,
		})
	}
	// Every loaded row was validated above. The load rewrite validates again
	// only the Jobs that restart recovery changed.
	for jobID := range s.jobs {
		s.durable.jobs[jobID] = struct{}{}
	}
	if prune {
		s.pruneLocked(now)
	}
	return s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistLoad})
}

// scenarioJobLoadRows lists base rows followed by the final journal row of
// each key, encoded in the same row shape.
func scenarioJobLoadRows[T any](base []json.RawMessage, journal []scenarioJobJournalRow[T], key func(T) string) ([]scenarioJobLoadRow, error) {
	rows := make([]scenarioJobLoadRow, 0, len(base)+len(journal))
	for index, raw := range base {
		rows = append(rows, scenarioJobLoadRow{raw: raw, index: index})
	}
	for _, row := range journal {
		raw, err := json.Marshal(row.value)
		if err != nil {
			return nil, fmt.Errorf("encode ScenarioJob journal row: %w", err)
		}
		rows = append(rows, scenarioJobLoadRow{raw: raw, key: key(row.value), index: row.index, journalLine: row.line})
	}
	return rows, nil
}

func (s *scenarioJobStore) pruneRecoveredDurableState() error {
	if s == nil {
		return fmt.Errorf("ScenarioJob store is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// A missing active document is meaningful after whole-document isolation
	// (and on a fresh install). Do not recreate an empty active store merely as
	// a side effect of the post-reconciliation prune phase; the first healthy
	// Job write will materialize it.
	if len(s.jobs) == 0 && len(s.idempotency) == 0 && len(s.pendingCloudCustody) == 0 {
		if _, err := os.Stat(s.durablePath); errors.Is(err, os.ErrNotExist) {
			return nil
		} else if err != nil {
			return fmt.Errorf("inspect ScenarioJob store before prune: %w", err)
		}
	}
	s.pruneLocked(time.Now().UTC())
	return s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistPrune})
}

func decodeScenarioJobStrictJSON(payload []byte, target any) error {
	if len(payload) == 0 {
		return errors.New("document is empty")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("document contains multiple JSON values")
		}
		return err
	}
	return nil
}

func (s *scenarioJobStore) IsolationDiagnostics() []scenarioJobIsolationDiagnostic {
	if s == nil {
		return nil
	}
	return append([]scenarioJobIsolationDiagnostic(nil), s.isolationDiagnostics...)
}

func (s *scenarioJobStore) isolateDurableDocument(payload []byte, cause error) error {
	quarantinePath, err := s.preserveScenarioJobDocument(payload)
	message := scenarioJobDiskStoreFileName + " document was isolated: " + cause.Error()
	if err != nil {
		message += "; quarantine failed: " + err.Error()
	}
	s.isolationDiagnostics = append(s.isolationDiagnostics, scenarioJobIsolationDiagnostic{
		Level: scenarioJobIsolationLevelDocument, ReasonCode: scenarioJobDocumentQuarantinedReason,
		Message: message, QuarantinePath: quarantinePath, RecordIndex: -1,
	})
	if err != nil {
		return fmt.Errorf("isolate %s document after %v: %w", scenarioJobDiskStoreFileName, cause, err)
	}
	return nil
}

func (s *scenarioJobStore) preserveScenarioJobDocument(payload []byte) (string, error) {
	target, err := s.scenarioJobQuarantinePath("document")
	if err != nil {
		return "", err
	}
	if err := os.Rename(s.durablePath, target); err == nil {
		return target, nil
	}
	if err := os.WriteFile(target, payload, 0o600); err != nil {
		return "", err
	}
	if err := os.Remove(s.durablePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return target, err
	}
	return target, nil
}

// preserveIsolatedRecords copies only the isolated rows into quarantine
// evidence. Healthy sibling rows stay solely in the live store, so their
// captured inputs follow ordinary retention.
// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-isolation-evidence
func (s *scenarioJobStore) preserveIsolatedRecords(rows []scenarioJobQuarantinedRecord) (string, error) {
	isolated := scenarioJobDiskRawSnapshot{Version: scenarioJobDiskStoreVersion}
	for _, row := range rows {
		switch row.Section {
		case "records":
			isolated.Records = append(isolated.Records, row.Raw)
		case "idempotency":
			isolated.Idempotency = append(isolated.Idempotency, row.Raw)
		case "pending_credential_custody":
			isolated.PendingCustody = append(isolated.PendingCustody, row.Raw)
		default:
			return "", fmt.Errorf("isolated scenario job row section %q is unknown", row.Section)
		}
	}
	payload, err := json.MarshalIndent(isolated, "", "  ")
	if err != nil {
		return "", err
	}
	target, err := s.scenarioJobQuarantinePath(scenarioJobQuarantineRecordsLevel)
	if err != nil {
		return "", err
	}
	if err := writeScenarioJobDocument(target, payload); err != nil {
		return "", err
	}
	return target, nil
}

func (s *scenarioJobStore) scenarioJobQuarantinePath(level string) (string, error) {
	directory := filepath.Join(filepath.Dir(s.durablePath), scenarioJobIsolationQuarantineDirName)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", err
	}
	name := fmt.Sprintf("%s.%d.%s.json", filepath.Base(s.durablePath), time.Now().UTC().UnixNano(), level)
	return filepath.Join(directory, name), nil
}

func interruptedCapturedAssemblyDetail(job *runtimev1.ScenarioJob) string {
	identity := job.GetEffectiveInputIdentity()
	if identity == nil {
		return "Runtime restarted before the captured ScenarioJob execution completed"
	}
	return fmt.Sprintf(
		"Runtime restarted before captured ResolvedAssembly completed (loadout_id=%s recipe_id=%s recipe_revision=%s)",
		strings.TrimSpace(identity.GetLoadoutId()), strings.TrimSpace(identity.GetRecipeId()), strings.TrimSpace(identity.GetRecipeRevision()),
	)
}

func scenarioJobEventForStatus(status runtimev1.ScenarioJobStatus) runtimev1.ScenarioJobEventType {
	switch status {
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED:
		return runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED:
		return runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED:
		return runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
		return runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING:
		return runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED:
		return runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED
	default:
		return runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_SUBMITTED
	}
}

func writeScenarioJobDocument(path string, raw []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".scenario-jobs-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer func() { _ = os.Remove(temporaryPath) }()
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(raw); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return replaceScenarioJobFileAtomically(temporaryPath, path)
}
