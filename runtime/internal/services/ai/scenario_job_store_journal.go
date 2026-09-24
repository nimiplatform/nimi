package ai

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/encoding/protojson"
)

// The durable ScenarioJob document is one base snapshot followed by one
// newline-terminated journal line per acknowledged mutation. A mutation
// appends only the rows it changed; a rewrite folds the journal back into a
// fresh base snapshot. A reader of the base format alone rejects the extra
// lines instead of silently reading stale state.
const (
	// Appended history is folded into a new base once it is as large as the
	// live state it describes, and never below this floor.
	scenarioJobStoreRewriteFloorBytes = 4 << 20

	scenarioJobIsolationLevelJournalTail  = "journal-tail"
	scenarioJobJournalTailDiscardedReason = "SCENARIO_JOB_JOURNAL_TAIL_DISCARDED"
)

var errScenarioJobStoreDrift = errors.New("ScenarioJob store document changed outside its writer")

// scenarioJobJournalEntry is one acknowledged store mutation. Its rows repeat
// the base snapshot row shapes; record rows carry their key so a later reload
// can supersede the base row without decoding it twice.
type scenarioJobJournalEntry struct {
	Records               []scenarioJobJournalRecord        `json:"records,omitempty"`
	DeletedJobs           []string                          `json:"deleted_jobs,omitempty"`
	Idempotency           []scenarioJobDiskIdempotencyEntry `json:"idempotency,omitempty"`
	DeletedIdempotency    []string                          `json:"deleted_idempotency,omitempty"`
	PendingCustody        []scenarioJobDiskPendingCustody   `json:"pending_credential_custody,omitempty"`
	DeletedPendingCustody []string                          `json:"deleted_pending_credential_custody,omitempty"`
}

type scenarioJobJournalRecord struct {
	JobID  string          `json:"job_id"`
	Record json.RawMessage `json:"record"`
}

func (entry scenarioJobJournalEntry) empty() bool {
	return len(entry.Records) == 0 && len(entry.DeletedJobs) == 0 &&
		len(entry.Idempotency) == 0 && len(entry.DeletedIdempotency) == 0 &&
		len(entry.PendingCustody) == 0 && len(entry.DeletedPendingCustody) == 0
}

// scenarioJobDurableState is what the durable document holds, so a mutation
// writes only the rows that differ from it. Caller holds the store mutex.
type scenarioJobDurableState struct {
	jobs           map[string]struct{}
	changed        map[string]struct{}
	idempotency    map[string]scenarioIdempotencyBinding
	pendingCustody map[string]scenarioPendingCloudCustody
	fileBytes      int64
	baseBytes      int64
	// removed reports that the journal still holds captured inputs of a Job
	// that is no longer live; only a rewrite drops them from the disk.
	removed bool
	// current reports that the document holds exactly this state and can be
	// appended to. A fresh, isolated, or unrecoverably failed document is
	// rewritten from memory by the next write.
	current bool
}

func newScenarioJobDurableState() scenarioJobDurableState {
	return scenarioJobDurableState{
		jobs:           make(map[string]struct{}),
		changed:        make(map[string]struct{}),
		idempotency:    make(map[string]scenarioIdempotencyBinding),
		pendingCustody: make(map[string]scenarioPendingCloudCustody),
	}
}

// markDurableJobChangedLocked makes the next durable write re-derive the Job's
// row from memory: an upsert while the Job is live, a deletion otherwise.
func (s *scenarioJobStore) markDurableJobChangedLocked(jobID string) {
	if s == nil || strings.TrimSpace(s.durablePath) == "" {
		return
	}
	if id := strings.TrimSpace(jobID); id != "" {
		s.durable.changed[id] = struct{}{}
	}
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-incremental-persistence
func (s *scenarioJobStore) persistDurableJobsLocked(attempt scenarioJobPersistenceAttempt) error {
	if s == nil {
		return nil
	}
	s.markDurableJobChangedLocked(attempt.JobID)
	if s.persistenceFailure != nil {
		if err := s.persistenceFailure(attempt); err != nil {
			return err
		}
	}
	if strings.TrimSpace(s.durablePath) == "" {
		return nil
	}
	if s.durableRewriteDueLocked(attempt.Operation) {
		return s.rewriteDurableStoreLocked()
	}
	return s.appendDurableChangesLocked()
}

func (s *scenarioJobStore) durableRewriteDueLocked(operation scenarioJobPersistenceOperation) bool {
	durable := &s.durable
	if !durable.current {
		return true
	}
	switch operation {
	case scenarioJobPersistLoad, scenarioJobPersistPayloadDispose:
		return true
	case scenarioJobPersistPrune:
		return durable.fileBytes > durable.baseBytes || s.durableRemovalPendingLocked()
	case scenarioJobPersistMaintenance:
		return s.durableRemovalPendingLocked()
	}
	return durable.fileBytes-durable.baseBytes >= max(durable.baseBytes, scenarioJobStoreRewriteFloorBytes)
}

// durableRemovalPendingLocked reports captured inputs of a removed Job that
// are still on disk, either in superseded history or in a pending deletion.
func (s *scenarioJobStore) durableRemovalPendingLocked() bool {
	if s.durable.removed {
		return true
	}
	for id := range s.durable.changed {
		if _, live := s.jobs[id]; live {
			continue
		}
		if _, durable := s.durable.jobs[id]; durable {
			return true
		}
	}
	return false
}

func (s *scenarioJobStore) appendDurableChangesLocked() error {
	entry, removed, err := s.durableChangesLocked()
	if err != nil {
		return err
	}
	if entry.empty() {
		return nil
	}
	line, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("encode ScenarioJob store change: %w", err)
	}
	if bytes.IndexByte(line, '\n') >= 0 {
		return fmt.Errorf("encoded ScenarioJob store change spans more than one line")
	}
	line = append(line, '\n')
	restored, err := appendScenarioJobStoreLine(s.durablePath, s.durable.fileBytes, line)
	if errors.Is(err, errScenarioJobStoreDrift) {
		// Memory holds every acknowledged mutation of this process.
		return s.rewriteDurableStoreLocked()
	}
	if err != nil {
		if !restored {
			s.durable.current = false
		}
		return err
	}
	for _, row := range entry.Records {
		s.durable.jobs[row.JobID] = struct{}{}
	}
	for _, id := range entry.DeletedJobs {
		delete(s.durable.jobs, id)
	}
	for _, row := range entry.Idempotency {
		s.durable.idempotency[row.ScopeKey] = scenarioIdempotencyBinding{jobID: row.JobID, boundAt: row.BoundAt}
	}
	for _, key := range entry.DeletedIdempotency {
		delete(s.durable.idempotency, key)
	}
	for _, row := range entry.PendingCustody {
		s.durable.pendingCustody[row.JobID] = scenarioPendingCloudCustody{jobID: row.JobID, ref: row.Ref, capturedAt: row.CapturedAt}
	}
	for _, jobID := range entry.DeletedPendingCustody {
		delete(s.durable.pendingCustody, jobID)
	}
	clear(s.durable.changed)
	s.durable.removed = s.durable.removed || removed
	s.durable.fileBytes += int64(len(line))
	return nil
}

// durableChangesLocked validates and encodes only the rows that differ from
// the durable document. Rows it does not touch were validated when written.
func (s *scenarioJobStore) durableChangesLocked() (scenarioJobJournalEntry, bool, error) {
	var entry scenarioJobJournalEntry
	removed := false
	changed := make([]string, 0, len(s.durable.changed))
	for id := range s.durable.changed {
		changed = append(changed, id)
	}
	sort.Strings(changed)
	for _, jobID := range changed {
		record, live := s.jobs[jobID]
		if !live {
			if _, durable := s.durable.jobs[jobID]; durable {
				entry.DeletedJobs = append(entry.DeletedJobs, jobID)
				removed = true
			}
			continue
		}
		row, err := scenarioJobDiskRecordFor(jobID, record, true)
		if err != nil {
			return entry, false, err
		}
		raw, err := json.Marshal(row)
		if err != nil {
			return entry, false, fmt.Errorf("encode scenario job %q: %w", jobID, err)
		}
		entry.Records = append(entry.Records, scenarioJobJournalRecord{JobID: jobID, Record: raw})
	}
	for key, binding := range s.idempotency {
		if previous, ok := s.durable.idempotency[key]; ok && previous.jobID == binding.jobID && previous.boundAt.Equal(binding.boundAt) {
			continue
		}
		entry.Idempotency = append(entry.Idempotency, scenarioJobDiskIdempotencyEntry{ScopeKey: key, JobID: binding.jobID, BoundAt: binding.boundAt})
	}
	for key := range s.durable.idempotency {
		if _, ok := s.idempotency[key]; !ok {
			entry.DeletedIdempotency = append(entry.DeletedIdempotency, key)
		}
	}
	for jobID, pending := range s.pendingCloudCustody {
		if previous, ok := s.durable.pendingCustody[jobID]; ok && previous.ref == pending.ref && previous.capturedAt.Equal(pending.capturedAt) {
			continue
		}
		row, err := scenarioJobDiskPendingCustodyFor(jobID, pending)
		if err != nil {
			return entry, false, err
		}
		entry.PendingCustody = append(entry.PendingCustody, row)
	}
	for jobID := range s.durable.pendingCustody {
		if _, ok := s.pendingCloudCustody[jobID]; !ok {
			entry.DeletedPendingCustody = append(entry.DeletedPendingCustody, jobID)
		}
	}
	sort.Slice(entry.Idempotency, func(i, j int) bool { return entry.Idempotency[i].ScopeKey < entry.Idempotency[j].ScopeKey })
	sort.Strings(entry.DeletedIdempotency)
	sort.Slice(entry.PendingCustody, func(i, j int) bool { return entry.PendingCustody[i].JobID < entry.PendingCustody[j].JobID })
	sort.Strings(entry.DeletedPendingCustody)
	return entry, removed, nil
}

// rewriteDurableStoreLocked replaces the document with one base snapshot of
// the live state, dropping superseded history and removed captured inputs.
func (s *scenarioJobStore) rewriteDurableStoreLocked() error {
	jobIDs := make([]string, 0, len(s.jobs))
	for jobID := range s.jobs {
		jobIDs = append(jobIDs, jobID)
	}
	sort.Strings(jobIDs)
	snapshot := scenarioJobDiskSnapshot{Version: scenarioJobDiskStoreVersion, Records: make([]scenarioJobDiskRecord, 0, len(jobIDs))}
	for _, jobID := range jobIDs {
		_, durable := s.durable.jobs[jobID]
		_, changed := s.durable.changed[jobID]
		row, err := scenarioJobDiskRecordFor(jobID, s.jobs[jobID], changed || !durable)
		if err != nil {
			return err
		}
		snapshot.Records = append(snapshot.Records, row)
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
	pendingJobIDs := make([]string, 0, len(s.pendingCloudCustody))
	for jobID := range s.pendingCloudCustody {
		pendingJobIDs = append(pendingJobIDs, jobID)
	}
	sort.Strings(pendingJobIDs)
	for _, jobID := range pendingJobIDs {
		row, err := scenarioJobDiskPendingCustodyFor(jobID, s.pendingCloudCustody[jobID])
		if err != nil {
			return err
		}
		snapshot.PendingCustody = append(snapshot.PendingCustody, row)
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	if err := writeScenarioJobDocument(s.durablePath, raw); err != nil {
		return err
	}
	s.durable.jobs = make(map[string]struct{}, len(jobIDs))
	for _, jobID := range jobIDs {
		s.durable.jobs[jobID] = struct{}{}
	}
	clear(s.durable.changed)
	s.durable.idempotency = make(map[string]scenarioIdempotencyBinding, len(s.idempotency))
	for key, binding := range s.idempotency {
		s.durable.idempotency[key] = binding
	}
	s.durable.pendingCustody = make(map[string]scenarioPendingCloudCustody, len(s.pendingCloudCustody))
	for jobID, pending := range s.pendingCloudCustody {
		s.durable.pendingCustody[jobID] = pending
	}
	s.durable.fileBytes = int64(len(raw))
	s.durable.baseBytes = int64(len(raw))
	s.durable.removed = false
	s.durable.current = true
	return nil
}

// scenarioJobDiskRecordFor encodes one live Job row. A row whose captured
// state changed since the durable document last held it is validated first.
func scenarioJobDiskRecordFor(jobID string, record *scenarioJobRecord, validate bool) (scenarioJobDiskRecord, error) {
	if record == nil || record.job == nil {
		return scenarioJobDiskRecord{}, fmt.Errorf("scenario job %q has no record", jobID)
	}
	if validate {
		if err := validatePersistedScenarioJob(record.job, record.createdAt, record.updatedAt, record.terminalAt); err != nil {
			return scenarioJobDiskRecord{}, fmt.Errorf("scenario job %q public record: %w", jobID, err)
		}
		if err := validateScenarioJobPayload(record.job, record.resolvedAssembly, record.cloudAssembly, record.payload); err != nil {
			return scenarioJobDiskRecord{}, fmt.Errorf("scenario job %q captured inputs: %w", jobID, err)
		}
		if err := validateScenarioJobTerminalResults(record); err != nil {
			return scenarioJobDiskRecord{}, fmt.Errorf("scenario job %q terminal result: %w", jobID, err)
		}
		if err := validateLocalAppMusicSubmission(record.musicSubmission, record.localAppOwner, record.job); err != nil {
			return scenarioJobDiskRecord{}, err
		}
	}
	raw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(record.job)
	if err != nil {
		return scenarioJobDiskRecord{}, err
	}
	var assemblyRaw json.RawMessage
	if record.resolvedAssembly != nil {
		assemblyRaw, err = json.Marshal(record.resolvedAssembly)
		if err != nil {
			return scenarioJobDiskRecord{}, fmt.Errorf("marshal scenario job %q ResolvedAssembly: %w", jobID, err)
		}
	}
	var cloudAssemblyRaw json.RawMessage
	if record.cloudAssembly != nil {
		cloudAssemblyRaw, err = json.Marshal(record.cloudAssembly)
		if err != nil {
			return scenarioJobDiskRecord{}, fmt.Errorf("marshal scenario job %q Cloud ResolvedAssembly: %w", jobID, err)
		}
	}
	var voiceAssetRaw json.RawMessage
	if record.voiceAsset != nil {
		voiceAssetRaw, err = (protojson.MarshalOptions{UseProtoNames: true}).Marshal(record.voiceAsset)
		if err != nil {
			return scenarioJobDiskRecord{}, fmt.Errorf("marshal scenario job %q terminal VoiceAsset: %w", jobID, err)
		}
	}
	var voiceReferenceRaw json.RawMessage
	if record.voiceReference != nil {
		voiceReferenceRaw, err = (protojson.MarshalOptions{UseProtoNames: true}).Marshal(record.voiceReference)
		if err != nil {
			return scenarioJobDiskRecord{}, fmt.Errorf("marshal scenario job %q terminal VoiceReference: %w", jobID, err)
		}
	}
	var visionRaw json.RawMessage
	if record.visionLocate != nil {
		visionRaw, err = (protojson.MarshalOptions{UseProtoNames: true}).Marshal(record.visionLocate)
		if err != nil {
			return scenarioJobDiskRecord{}, fmt.Errorf("marshal scenario job %q Locate result: %w", jobID, err)
		}
	}
	return scenarioJobDiskRecord{
		Payload: cloneEmbeddingPayload(record.payload), Job: raw, ResolvedAssembly: assemblyRaw, CloudResolvedAssembly: cloudAssemblyRaw, Owner: cloneLocalAppJobOwner(record.localAppOwner),
		VoiceAsset: voiceAssetRaw, VoiceReference: voiceReferenceRaw,
		MusicSubmission: cloneLocalAppMusicSubmission(record.musicSubmission),
		VisionLocate:    visionRaw,
		CreatedAt:       record.createdAt, UpdatedAt: record.updatedAt, TerminalAt: record.terminalAt,
	}, nil
}

func scenarioJobDiskPendingCustodyFor(jobID string, pending scenarioPendingCloudCustody) (scenarioJobDiskPendingCustody, error) {
	if pending.jobID != jobID || strings.TrimSpace(pending.ref) == "" || pending.capturedAt.IsZero() {
		return scenarioJobDiskPendingCustody{}, fmt.Errorf("pending credential custody for scenario job %q is invalid", jobID)
	}
	if err := connector.ValidateCredentialCustodyRefForJob(pending.ref, jobID); err != nil {
		return scenarioJobDiskPendingCustody{}, fmt.Errorf("pending credential custody for scenario job %q: %w", jobID, err)
	}
	return scenarioJobDiskPendingCustody{JobID: jobID, Ref: pending.ref, CapturedAt: pending.capturedAt}, nil
}

// appendScenarioJobStoreLine durably appends one journal line at the length
// the writer last acknowledged. restored reports that a failed append left no
// bytes behind; otherwise the next write must rewrite the whole document.
func appendScenarioJobStoreLine(path string, acknowledgedBytes int64, line []byte) (restored bool, err error) {
	file, err := openScenarioJobStoreForAppend(path)
	if errors.Is(err, os.ErrNotExist) {
		return true, errScenarioJobStoreDrift
	}
	if err != nil {
		return true, err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return true, err
	}
	if info.Size() != acknowledgedBytes {
		_ = file.Close()
		return true, errScenarioJobStoreDrift
	}
	_, err = file.WriteAt(line, acknowledgedBytes)
	if err == nil {
		err = file.Sync()
	}
	if err == nil {
		// The line is durable once synced; a failed close cannot undo it, and
		// reporting failure would make the caller roll back acknowledged state.
		_ = file.Close()
		return true, nil
	}
	restored = file.Truncate(acknowledgedBytes) == nil && file.Sync() == nil
	_ = file.Close()
	return restored, err
}

// scenarioJobDurableDocument is one parsed store document: the base snapshot
// and the journal lines appended after it.
type scenarioJobDurableDocument struct {
	base    scenarioJobDiskRawSnapshot
	entries []scenarioJobJournalEntry
	// tornBytes counts a final append that never finished and therefore was
	// never acknowledged to a caller.
	tornBytes int
}

// parseScenarioJobDurableDocument reads the base snapshot and every journal
// line. Only the final append can be torn by an interrupted write; any other
// unreadable content is corruption of acknowledged state.
func parseScenarioJobDurableDocument(raw []byte) (scenarioJobDurableDocument, error) {
	var document scenarioJobDurableDocument
	if len(raw) == 0 {
		return document, errors.New("document is empty")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&document.base); err != nil {
		return document, err
	}
	rest := raw[decoder.InputOffset():]
	lineBreak := bytes.IndexByte(rest, '\n')
	if lineBreak < 0 {
		if len(bytes.TrimSpace(rest)) != 0 {
			return document, errors.New("document contains data after its base snapshot")
		}
		return document, nil
	}
	if len(bytes.TrimSpace(rest[:lineBreak])) != 0 {
		return document, errors.New("document contains data after its base snapshot")
	}
	lines := rest[lineBreak+1:]
	for len(lines) > 0 {
		end := bytes.IndexByte(lines, '\n')
		if end < 0 {
			document.tornBytes = len(lines)
			break
		}
		var entry scenarioJobJournalEntry
		if err := decodeScenarioJobStrictJSON(lines[:end], &entry); err != nil {
			// A terminated final line can still be torn: its line break may reach
			// the disk before earlier bytes of the same unacknowledged write. Such
			// a line is not valid JSON; a well-formed wrong line is corruption.
			if end+1 == len(lines) && !json.Valid(lines[:end]) {
				document.tornBytes = len(lines)
				break
			}
			return document, fmt.Errorf("journal line %d: %w", len(document.entries)+1, err)
		}
		if entry.empty() {
			return document, fmt.Errorf("journal line %d records no change", len(document.entries)+1)
		}
		document.entries = append(document.entries, entry)
		lines = lines[end+1:]
	}
	return document, nil
}

// encode writes the document back in its durable shape. A torn final append
// is not part of the document and is dropped.
func (document scenarioJobDurableDocument) encode() ([]byte, error) {
	var out bytes.Buffer
	base, err := json.Marshal(document.base)
	if err != nil {
		return nil, err
	}
	out.Write(base)
	out.WriteByte('\n')
	for _, entry := range document.entries {
		line, err := json.Marshal(entry)
		if err != nil {
			return nil, err
		}
		out.Write(line)
		out.WriteByte('\n')
	}
	return out.Bytes(), nil
}

// scenarioJobJournalRow is the final journal row of one key and where it was
// written.
type scenarioJobJournalRow[T any] struct {
	value T
	line  int
	index int
}

// scenarioJobJournalKeys folds journal writes of one row kind into the final
// row per key; a nil row is a deletion. order keeps first-touch order.
type scenarioJobJournalKeys[T any] struct {
	final map[string]*scenarioJobJournalRow[T]
	order []string
}

func (keys *scenarioJobJournalKeys[T]) touch(key string, row *scenarioJobJournalRow[T]) {
	if keys.final == nil {
		keys.final = make(map[string]*scenarioJobJournalRow[T])
	}
	if _, seen := keys.final[key]; !seen {
		keys.order = append(keys.order, key)
	}
	keys.final[key] = row
}

func (keys *scenarioJobJournalKeys[T]) touched(key string) bool {
	_, ok := keys.final[key]
	return ok
}

func (keys *scenarioJobJournalKeys[T]) live() []scenarioJobJournalRow[T] {
	rows := make([]scenarioJobJournalRow[T], 0, len(keys.order))
	for _, key := range keys.order {
		if row := keys.final[key]; row != nil {
			rows = append(rows, *row)
		}
	}
	return rows
}

// scenarioJobJournalReplay is the journal folded into its final rows. A base
// row whose key the journal touched is superseded by the journal.
type scenarioJobJournalReplay struct {
	records        scenarioJobJournalKeys[scenarioJobJournalRecord]
	idempotency    scenarioJobJournalKeys[scenarioJobDiskIdempotencyEntry]
	pendingCustody scenarioJobJournalKeys[scenarioJobDiskPendingCustody]
}

func replayScenarioJobJournal(entries []scenarioJobJournalEntry) scenarioJobJournalReplay {
	var replay scenarioJobJournalReplay
	for index, entry := range entries {
		line := index + 1
		for rowIndex, row := range entry.Records {
			replay.records.touch(row.JobID, &scenarioJobJournalRow[scenarioJobJournalRecord]{value: row, line: line, index: rowIndex})
		}
		for _, jobID := range entry.DeletedJobs {
			replay.records.touch(jobID, nil)
		}
		for rowIndex, row := range entry.Idempotency {
			replay.idempotency.touch(row.ScopeKey, &scenarioJobJournalRow[scenarioJobDiskIdempotencyEntry]{value: row, line: line, index: rowIndex})
		}
		for _, key := range entry.DeletedIdempotency {
			replay.idempotency.touch(key, nil)
		}
		for rowIndex, row := range entry.PendingCustody {
			replay.pendingCustody.touch(row.JobID, &scenarioJobJournalRow[scenarioJobDiskPendingCustody]{value: row, line: line, index: rowIndex})
		}
		for _, jobID := range entry.DeletedPendingCustody {
			replay.pendingCustody.touch(jobID, nil)
		}
	}
	return replay
}
