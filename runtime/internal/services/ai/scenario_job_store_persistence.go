package ai

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
)

type scenarioJobIsolationDiagnostic struct {
	Level          string
	ReasonCode     string
	Message        string
	QuarantinePath string
	Section        string
	RecordIndex    int
	RecordID       string
}

type scenarioJobDiskRawSnapshot struct {
	Version     int               `json:"version"`
	Records     []json.RawMessage `json:"records"`
	Idempotency []json.RawMessage `json:"idempotency,omitempty"`
}

type scenarioJobQuarantinedRecord struct {
	Section     string
	RecordIndex int
	RecordID    string
	Reason      string
}

type scenarioJobDiskSnapshot struct {
	Version     int                               `json:"version"`
	Records     []scenarioJobDiskRecord           `json:"records"`
	Idempotency []scenarioJobDiskIdempotencyEntry `json:"idempotency,omitempty"`
}

type scenarioJobDiskRecord struct {
	Job              json.RawMessage   `json:"job"`
	ResolvedAssembly json.RawMessage   `json:"resolved_assembly,omitempty"`
	Owner            *localAppJobOwner `json:"owner,omitempty"`
	CreatedAt        time.Time         `json:"created_at"`
	UpdatedAt        time.Time         `json:"updated_at"`
	TerminalAt       time.Time         `json:"terminal_at,omitempty"`
}

type scenarioJobDiskIdempotencyEntry struct {
	ScopeKey string    `json:"scope_key"`
	JobID    string    `json:"job_id"`
	BoundAt  time.Time `json:"bound_at"`
}

// @nimi-authority: rule.nimi.runtime.local-compute.r100
func newScenarioJobStoreForLocalStatePath(localStatePath string) (*scenarioJobStore, error) {
	store := newScenarioJobStore()
	store.durablePath = scenarioJobStorePathForLocalStatePath(localStatePath)
	if store.durablePath == "" {
		return store, nil
	}
	if err := store.loadDurableJobs(); err != nil {
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

func (s *scenarioJobStore) loadDurableJobs() error {
	raw, err := os.ReadFile(s.durablePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	var snapshot scenarioJobDiskRawSnapshot
	if err := decodeScenarioJobStrictJSON(raw, &snapshot); err != nil {
		return s.isolateDurableDocument(raw, err)
	}
	if snapshot.Version != scenarioJobDiskStoreVersion {
		return s.isolateDurableDocument(raw, fmt.Errorf("unsupported scenario job store version %d", snapshot.Version))
	}

	now := time.Now().UTC()
	quarantined := make([]scenarioJobQuarantinedRecord, 0)
	for index, rawRecord := range snapshot.Records {
		var item scenarioJobDiskRecord
		rowErr := decodeScenarioJobStrictJSON(rawRecord, &item)
		var job runtimev1.ScenarioJob
		if rowErr == nil {
			rowErr = (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(item.Job, &job)
		}
		var resolvedAssembly *localResolvedAssembly
		if rowErr == nil && len(item.ResolvedAssembly) > 0 {
			resolvedAssembly = &localResolvedAssembly{}
			rowErr = decodeScenarioJobStrictJSON(item.ResolvedAssembly, resolvedAssembly)
		}
		if rowErr == nil {
			rowErr = validateScenarioJobResolvedAssemblyPair(&job, resolvedAssembly)
		}
		jobID := strings.TrimSpace(job.GetJobId())
		if rowErr == nil && (jobID == "" || item.CreatedAt.IsZero() || item.UpdatedAt.IsZero()) {
			rowErr = errors.New("record has no stable identity or timestamps")
		}
		if rowErr == nil && s.jobs[jobID] != nil {
			rowErr = fmt.Errorf("duplicate scenario job %q", jobID)
		}
		if rowErr != nil {
			quarantined = append(quarantined, scenarioJobQuarantinedRecord{
				Section: "records", RecordIndex: index, RecordID: jobID, Reason: rowErr.Error(),
			})
			continue
		}
		if !isTerminalScenarioJobStatus(job.GetStatus()) {
			job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
			job.ReasonCode = runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED
			job.ReasonDetail = interruptedCapturedAssemblyDetail(&job)
			job.ReasonMetadata = nil
			job.UpdatedAt = timestamppb.New(now)
			item.UpdatedAt = now
			item.TerminalAt = now
		}
		record := &scenarioJobRecord{
			job: cloneScenarioJob(&job), resolvedAssembly: resolvedAssembly, localAppOwner: cloneLocalAppJobOwner(item.Owner),
			events: make([]*runtimev1.ScenarioJobEvent, 0, 1), subscribers: make(map[uint64]chan *runtimev1.ScenarioJobEvent),
			done: make(chan struct{}), createdAt: item.CreatedAt.UTC(), updatedAt: item.UpdatedAt.UTC(), terminalAt: item.TerminalAt.UTC(),
		}
		if isTerminalScenarioJobStatus(job.GetStatus()) {
			record.doneClosed = true
			close(record.done)
		}
		s.jobs[jobID] = record
		s.syncArtifactIndexLocked(jobID, record)
		s.publishLocked(record, scenarioJobEventForStatus(job.GetStatus()))
	}

	seenScopes := make(map[string]struct{}, len(snapshot.Idempotency))
	for index, rawBinding := range snapshot.Idempotency {
		var item scenarioJobDiskIdempotencyEntry
		rowErr := decodeScenarioJobStrictJSON(rawBinding, &item)
		key := strings.TrimSpace(item.ScopeKey)
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
				Section: "idempotency", RecordIndex: index, RecordID: key, Reason: rowErr.Error(),
			})
			continue
		}
		seenScopes[key] = struct{}{}
		s.idempotency[key] = scenarioIdempotencyBinding{jobID: jobID, boundAt: item.BoundAt.UTC()}
	}

	if len(quarantined) > 0 {
		quarantinePath, quarantineErr := s.preserveIsolatedRecords(raw)
		if quarantineErr != nil {
			return fmt.Errorf("preserve isolated scenario job records: %w", quarantineErr)
		}
		for _, record := range quarantined {
			s.isolationDiagnostics = append(s.isolationDiagnostics, scenarioJobIsolationDiagnostic{
				Level: scenarioJobIsolationLevelRecord, ReasonCode: scenarioJobRecordQuarantinedReason,
				Message: record.Reason, QuarantinePath: quarantinePath, Section: record.Section,
				RecordIndex: record.RecordIndex, RecordID: record.RecordID,
			})
		}
	}
	s.pruneLocked(now)
	return s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistLoad})
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

func (s *scenarioJobStore) preserveIsolatedRecords(payload []byte) (string, error) {
	target, err := s.scenarioJobQuarantinePath("records")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(target, payload, 0o600); err != nil {
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

func (s *scenarioJobStore) persistDurableJobsLocked(attempt scenarioJobPersistenceAttempt) error {
	if s == nil {
		return nil
	}
	if s.persistenceFailure != nil {
		if err := s.persistenceFailure(attempt); err != nil {
			return err
		}
	}
	if strings.TrimSpace(s.durablePath) == "" {
		return nil
	}
	jobIDs := make([]string, 0, len(s.jobs))
	for jobID := range s.jobs {
		jobIDs = append(jobIDs, jobID)
	}
	sort.Strings(jobIDs)
	snapshot := scenarioJobDiskSnapshot{Version: scenarioJobDiskStoreVersion, Records: make([]scenarioJobDiskRecord, 0, len(jobIDs))}
	for _, jobID := range jobIDs {
		record := s.jobs[jobID]
		if record == nil || record.job == nil {
			return fmt.Errorf("scenario job %q has no record", jobID)
		}
		if err := validateScenarioJobResolvedAssemblyPair(record.job, record.resolvedAssembly); err != nil {
			return fmt.Errorf("scenario job %q captured inputs: %w", jobID, err)
		}
		raw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(record.job)
		if err != nil {
			return err
		}
		var assemblyRaw json.RawMessage
		if record.resolvedAssembly != nil {
			assemblyRaw, err = json.Marshal(record.resolvedAssembly)
			if err != nil {
				return fmt.Errorf("marshal scenario job %q ResolvedAssembly: %w", jobID, err)
			}
		}
		snapshot.Records = append(snapshot.Records, scenarioJobDiskRecord{
			Job: raw, ResolvedAssembly: assemblyRaw, Owner: cloneLocalAppJobOwner(record.localAppOwner),
			CreatedAt: record.createdAt, UpdatedAt: record.updatedAt, TerminalAt: record.terminalAt,
		})
	}
	keys := make([]string, 0, len(s.idempotency))
	for key := range s.idempotency {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		binding := s.idempotency[key]
		snapshot.Idempotency = append(snapshot.Idempotency, scenarioJobDiskIdempotencyEntry{ScopeKey: key, JobID: binding.jobID, BoundAt: binding.boundAt})
	}
	raw, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.durablePath), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(s.durablePath), ".scenario-jobs-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(raw); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, s.durablePath)
}
