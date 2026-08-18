package ai

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	maxScenarioJobEventBacklog                 = 128
	maxRetainedTerminalScenarioJobs            = 1024
	maxScenarioUploadedArtifacts               = 1024
	maxScenarioIdempotencyBindings             = 2048
	maxScenarioJobTerminalPersistenceAttempts  = 3
	scenarioJobRetention                       = 30 * time.Minute
	scenarioUploadedArtifactRetention          = 30 * time.Minute
	scenarioIdempotencyRetention               = 30 * time.Minute
	scenarioJobQueuedPersistenceFailedReason   = "scenario-job-queued-persist-failed"
	scenarioJobRunningPersistenceFailedReason  = "scenario-job-running-persist-failed"
	scenarioJobTerminalPersistenceFailedReason = "scenario-job-terminal-persist-failed"
)

type scenarioJobPersistenceOperation string

const (
	scenarioJobPersistCreate         scenarioJobPersistenceOperation = "create"
	scenarioJobPersistCreateAndBind  scenarioJobPersistenceOperation = "create-and-bind-idempotency"
	scenarioJobPersistBind           scenarioJobPersistenceOperation = "bind-idempotency"
	scenarioJobPersistTransition     scenarioJobPersistenceOperation = "transition"
	scenarioJobPersistProgress       scenarioJobPersistenceOperation = "progress"
	scenarioJobPersistArtifact       scenarioJobPersistenceOperation = "artifact"
	scenarioJobPersistCancellation   scenarioJobPersistenceOperation = "cancellation"
	scenarioJobPersistCustodyBegin   scenarioJobPersistenceOperation = "credential-custody-begin"
	scenarioJobPersistCustodyAbort   scenarioJobPersistenceOperation = "credential-custody-abort"
	scenarioJobPersistCustodyRelease scenarioJobPersistenceOperation = "credential-custody-release"
	scenarioJobPersistLoad           scenarioJobPersistenceOperation = "load"
	scenarioJobPersistPrune          scenarioJobPersistenceOperation = "prune"
)

type scenarioJobPersistenceAttempt struct {
	Operation scenarioJobPersistenceOperation
	JobID     string
	Status    runtimev1.ScenarioJobStatus
}

type scenarioJobRecord struct {
	job              *runtimev1.ScenarioJob
	resolvedAssembly *localResolvedAssembly
	cloudAssembly    *cloudResolvedAssembly
	localAppOwner    *localAppJobOwner
	voiceAsset       *runtimev1.VoiceAsset
	voiceReference   *runtimev1.VoiceReference
	events           []*runtimev1.ScenarioJobEvent
	subscribers      map[uint64]chan *runtimev1.ScenarioJobEvent
	nextSubID        uint64
	nextSeq          uint64
	done             chan struct{}
	doneClosed       bool
	cancel           context.CancelFunc
	cancelRequested  bool
	cancelReason     string
	executionStarted bool
	createdAt        time.Time
	updatedAt        time.Time
	terminalAt       time.Time
}

type uploadedArtifactRecord struct {
	appID         string
	subjectUserID string
	traceID       string
	artifact      *runtimev1.ScenarioArtifact
	storedAt      time.Time
}

type scenarioIdempotencyBinding struct {
	jobID   string
	boundAt time.Time
}

type scenarioPendingCloudCustody struct {
	jobID      string
	ref        string
	capturedAt time.Time
}

// @nimi-authority: definition.nimi.runtime.service-operations.scenario-job-plane
type scenarioJobStore struct {
	mu                   sync.RWMutex
	durablePath          string
	jobs                 map[string]*scenarioJobRecord
	artifactJobs         map[string]string
	idempotency          map[string]scenarioIdempotencyBinding
	pendingCloudCustody  map[string]scenarioPendingCloudCustody
	uploads              map[string]*uploadedArtifactRecord
	persistenceFailure   func(scenarioJobPersistenceAttempt) error
	isolationDiagnostics []scenarioJobIsolationDiagnostic
}

func newScenarioJobStore() *scenarioJobStore {
	return &scenarioJobStore{
		jobs:                make(map[string]*scenarioJobRecord),
		artifactJobs:        make(map[string]string),
		idempotency:         make(map[string]scenarioIdempotencyBinding),
		pendingCloudCustody: make(map[string]scenarioPendingCloudCustody),
		uploads:             make(map[string]*uploadedArtifactRecord),
	}
}

func (s *scenarioJobStore) create(job *runtimev1.ScenarioJob, cancel context.CancelFunc) *runtimev1.ScenarioJob {
	created, _ := s.createOwnedChecked(job, cancel, nil)
	return created
}

func (s *scenarioJobStore) createOwned(job *runtimev1.ScenarioJob, cancel context.CancelFunc, owner *localAppJobOwner) *runtimev1.ScenarioJob {
	created, _ := s.createOwnedChecked(job, cancel, owner)
	return created
}

func (s *scenarioJobStore) createOwnedChecked(job *runtimev1.ScenarioJob, cancel context.CancelFunc, owner *localAppJobOwner) (*runtimev1.ScenarioJob, error) {
	created, _, err := s.createOwnedAndBindChecked(job, cancel, owner, "")
	return created, err
}

// createOwnedAndBindChecked atomically returns the Job already bound to the
// idempotency scope or publishes the submitted Job and binding with one durable
// snapshot. A failed write therefore leaves neither an in-memory Job nor an
// earlier durable SUBMITTED record.
func (s *scenarioJobStore) createOwnedAndBindChecked(
	job *runtimev1.ScenarioJob,
	cancel context.CancelFunc,
	owner *localAppJobOwner,
	idempotencyScope string,
) (*runtimev1.ScenarioJob, bool, error) {
	return s.createOwnedAndBindAssemblyChecked(job, cancel, owner, idempotencyScope, nil)
}

func (s *scenarioJobStore) createOwnedAndBindAssemblyChecked(
	job *runtimev1.ScenarioJob,
	cancel context.CancelFunc,
	owner *localAppJobOwner,
	idempotencyScope string,
	resolvedAssembly *localResolvedAssembly,
) (*runtimev1.ScenarioJob, bool, error) {
	return s.createOwnedAndBindCapturedInputsChecked(job, cancel, owner, idempotencyScope, resolvedAssembly, nil, false)
}

func (s *scenarioJobStore) createOwnedAndBindCloudAssemblyChecked(
	job *runtimev1.ScenarioJob,
	cancel context.CancelFunc,
	owner *localAppJobOwner,
	idempotencyScope string,
	cloudAssembly *cloudResolvedAssembly,
) (*runtimev1.ScenarioJob, bool, error) {
	return s.createOwnedAndBindCapturedInputsChecked(job, cancel, owner, idempotencyScope, nil, cloudAssembly, true)
}

func (s *scenarioJobStore) createOwnedAndBindCapturedInputsChecked(
	job *runtimev1.ScenarioJob,
	cancel context.CancelFunc,
	owner *localAppJobOwner,
	idempotencyScope string,
	resolvedAssembly *localResolvedAssembly,
	cloudAssembly *cloudResolvedAssembly,
	consumePendingCloudCustody bool,
) (*runtimev1.ScenarioJob, bool, error) {
	if job == nil {
		return nil, false, fmt.Errorf("scenario job is required")
	}
	id := strings.TrimSpace(job.GetJobId())
	if id == "" {
		return nil, false, fmt.Errorf("scenario job id is required")
	}
	nowTime := time.Now().UTC()
	now := timestamppb.New(nowTime)
	if job.GetCreatedAt() == nil {
		job.CreatedAt = now
	}
	if job.GetUpdatedAt() == nil {
		job.UpdatedAt = now
	}
	if job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_UNSPECIFIED {
		job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED
	}
	capturedAssembly, err := cloneLocalResolvedAssembly(resolvedAssembly)
	if err != nil {
		return nil, false, fmt.Errorf("clone local ResolvedAssembly: %w", err)
	}
	capturedCloudAssembly, err := cloneCloudResolvedAssembly(cloudAssembly)
	if err != nil {
		return nil, false, fmt.Errorf("clone Cloud ResolvedAssembly: %w", err)
	}
	if err := validateScenarioJobCapturedInputsPair(job, capturedAssembly, capturedCloudAssembly); err != nil {
		return nil, false, err
	}
	record := &scenarioJobRecord{
		job:              cloneScenarioJob(job),
		resolvedAssembly: capturedAssembly,
		cloudAssembly:    capturedCloudAssembly,
		localAppOwner:    cloneLocalAppJobOwner(owner),
		events:           make([]*runtimev1.ScenarioJobEvent, 0, 8),
		subscribers:      make(map[uint64]chan *runtimev1.ScenarioJobEvent),
		done:             make(chan struct{}),
		cancel:           cancel,
		createdAt:        nowTime,
		updatedAt:        nowTime,
	}
	key := strings.TrimSpace(idempotencyScope)

	s.mu.Lock()
	var pendingCustody scenarioPendingCloudCustody
	if consumePendingCloudCustody {
		pendingCustody = s.pendingCloudCustody[id]
		if strings.TrimSpace(pendingCustody.ref) == "" || capturedCloudAssembly == nil ||
			pendingCustody.ref != strings.TrimSpace(capturedCloudAssembly.CredentialCustodyRef) {
			s.mu.Unlock()
			return nil, false, fmt.Errorf("scenario job %q has no matching durable credential custody obligation", id)
		}
	}
	var previousBinding scenarioIdempotencyBinding
	var hadPreviousBinding bool
	operation := scenarioJobPersistCreate
	if key != "" {
		previousBinding, hadPreviousBinding = s.idempotency[key]
		if hadPreviousBinding {
			existing := s.jobs[strings.TrimSpace(previousBinding.jobID)]
			if existing != nil && existing.job != nil {
				snapshot := cloneScenarioJob(existing.job)
				s.mu.Unlock()
				return snapshot, false, nil
			}
		}
	}
	s.jobs[id] = record
	if consumePendingCloudCustody {
		delete(s.pendingCloudCustody, id)
	}
	s.syncArtifactIndexLocked(id, record)
	if key != "" {
		s.idempotency[key] = scenarioIdempotencyBinding{jobID: id, boundAt: nowTime}
		operation = scenarioJobPersistCreateAndBind
	}
	s.publishLocked(record, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_SUBMITTED)
	s.pruneLocked(nowTime)
	if err := s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: operation, JobID: id, Status: record.job.GetStatus()}); err != nil {
		s.deleteJobLocked(id)
		if consumePendingCloudCustody {
			s.pendingCloudCustody[id] = pendingCustody
		}
		if key != "" {
			if hadPreviousBinding {
				s.idempotency[key] = previousBinding
			} else {
				delete(s.idempotency, key)
			}
		}
		s.mu.Unlock()
		if key != "" {
			return nil, false, fmt.Errorf("persist scenario job %q creation and idempotency binding: %w", id, err)
		}
		return nil, false, fmt.Errorf("persist scenario job %q creation: %w", id, err)
	}
	s.mu.Unlock()
	return cloneScenarioJob(record.job), true, nil
}

func (s *scenarioJobStore) beginCloudCredentialCustody(jobID string, ref string) error {
	if s == nil {
		return fmt.Errorf("ScenarioJob store is required")
	}
	id := strings.TrimSpace(jobID)
	custodyRef := strings.TrimSpace(ref)
	if id == "" || custodyRef == "" {
		return fmt.Errorf("ScenarioJob credential custody identity is required")
	}
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.jobs[id] != nil {
		return fmt.Errorf("scenario job %q already exists", id)
	}
	previous, hadPrevious := s.pendingCloudCustody[id]
	if hadPrevious && previous.ref != custodyRef {
		return fmt.Errorf("scenario job %q has another credential custody obligation", id)
	}
	s.pendingCloudCustody[id] = scenarioPendingCloudCustody{jobID: id, ref: custodyRef, capturedAt: now}
	if err := s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistCustodyBegin, JobID: id}); err != nil {
		if hadPrevious {
			s.pendingCloudCustody[id] = previous
		} else {
			delete(s.pendingCloudCustody, id)
		}
		return fmt.Errorf("persist ScenarioJob credential custody obligation: %w", err)
	}
	return nil
}

func (s *scenarioJobStore) clearPendingCloudCredentialCustody(jobID string, ref string) error {
	if s == nil {
		return fmt.Errorf("ScenarioJob store is required")
	}
	id := strings.TrimSpace(jobID)
	custodyRef := strings.TrimSpace(ref)
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, ok := s.pendingCloudCustody[id]
	if !ok {
		return nil
	}
	if previous.ref != custodyRef {
		return fmt.Errorf("scenario job %q credential custody obligation does not match", id)
	}
	delete(s.pendingCloudCustody, id)
	if err := s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistCustodyAbort, JobID: id}); err != nil {
		s.pendingCloudCustody[id] = previous
		return fmt.Errorf("persist ScenarioJob credential custody cleanup: %w", err)
	}
	return nil
}

func (s *scenarioJobStore) clearTerminalCloudCredentialCustody(jobID string, ref string) error {
	id := strings.TrimSpace(jobID)
	custodyRef := strings.TrimSpace(ref)
	if id == "" || custodyRef == "" {
		return fmt.Errorf("terminal Cloud credential custody requires a Job and reference")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record := s.jobs[id]
	if record == nil || record.job == nil || record.cloudAssembly == nil {
		return fmt.Errorf("terminal Cloud credential custody Job %q is unavailable", id)
	}
	if !isTerminalScenarioJobStatus(record.job.GetStatus()) {
		return fmt.Errorf("Cloud credential custody Job %q is not terminal", id)
	}
	if strings.TrimSpace(record.cloudAssembly.CredentialCustodyRef) != custodyRef {
		return fmt.Errorf("terminal Cloud credential custody reference does not match Job %q", id)
	}
	record.cloudAssembly.CredentialCustodyRef = ""
	if err := s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{
		Operation: scenarioJobPersistCustodyRelease,
		JobID:     id,
		Status:    record.job.GetStatus(),
	}); err != nil {
		record.cloudAssembly.CredentialCustodyRef = custodyRef
		return fmt.Errorf("persist terminal Cloud credential custody cleanup for %q: %w", id, err)
	}
	return nil
}

func (s *scenarioJobStore) pendingCloudCredentialCustody() []scenarioPendingCloudCustody {
	if s == nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]scenarioPendingCloudCustody, 0, len(s.pendingCloudCustody))
	for _, pending := range s.pendingCloudCustody {
		result = append(result, pending)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].jobID < result[j].jobID })
	return result
}

func (s *scenarioJobStore) resolvedAssembly(jobID string) (*localResolvedAssembly, bool) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return nil, false
	}
	s.mu.RLock()
	record := s.jobs[id]
	if record == nil || record.resolvedAssembly == nil {
		s.mu.RUnlock()
		return nil, false
	}
	assembly, err := cloneLocalResolvedAssembly(record.resolvedAssembly)
	s.mu.RUnlock()
	return assembly, err == nil && assembly != nil
}

func (s *scenarioJobStore) cloudResolvedAssembly(jobID string) (*cloudResolvedAssembly, bool) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return nil, false
	}
	s.mu.RLock()
	record := s.jobs[id]
	if record == nil || record.cloudAssembly == nil {
		s.mu.RUnlock()
		return nil, false
	}
	assembly, err := cloneCloudResolvedAssembly(record.cloudAssembly)
	s.mu.RUnlock()
	return assembly, err == nil && assembly != nil
}

func (s *scenarioJobStore) localAppOwner(jobID string) (*localAppJobOwner, bool) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return nil, false
	}
	s.mu.RLock()
	record := s.jobs[id]
	if record == nil || !record.localAppOwner.valid() {
		s.mu.RUnlock()
		return nil, false
	}
	owner := cloneLocalAppJobOwner(record.localAppOwner)
	s.mu.RUnlock()
	return owner, true
}

func (s *scenarioJobStore) get(jobID string) (*runtimev1.ScenarioJob, bool) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return nil, false
	}
	s.mu.RLock()
	record, ok := s.jobs[id]
	if !ok {
		s.mu.RUnlock()
		return nil, false
	}
	job := cloneScenarioJob(record.job)
	s.mu.RUnlock()
	return job, true
}

func (s *scenarioJobStore) completedVoiceResult(jobID string) (*runtimev1.VoiceAsset, *runtimev1.VoiceReference, bool) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return nil, nil, false
	}
	s.mu.RLock()
	record := s.jobs[id]
	if record == nil || validateScenarioJobVoiceResultPair(record.job, record.voiceAsset, record.voiceReference) != nil {
		s.mu.RUnlock()
		return nil, nil, false
	}
	asset := cloneVoiceAsset(record.voiceAsset)
	reference := cloneVoiceReference(record.voiceReference)
	s.mu.RUnlock()
	return asset, reference, asset != nil && reference != nil
}

func (s *scenarioJobStore) getByIdempotency(scopeKey string) (*runtimev1.ScenarioJob, bool) {
	key := strings.TrimSpace(scopeKey)
	if key == "" {
		return nil, false
	}
	s.mu.RLock()
	binding, ok := s.idempotency[key]
	jobID := strings.TrimSpace(binding.jobID)
	record := s.jobs[jobID]
	if !ok || record == nil {
		s.mu.RUnlock()
		return nil, false
	}
	job := cloneScenarioJob(record.job)
	s.mu.RUnlock()
	return job, true
}

func (s *scenarioJobStore) bindIdempotency(scopeKey string, jobID string) error {
	key := strings.TrimSpace(scopeKey)
	id := strings.TrimSpace(jobID)
	if key == "" || id == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.jobs[id]; !exists {
		return nil
	}
	previous, hadPrevious := s.idempotency[key]
	s.idempotency[key] = scenarioIdempotencyBinding{
		jobID:   id,
		boundAt: time.Now().UTC(),
	}
	s.pruneLocked(time.Now().UTC())
	if err := s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistBind, JobID: id}); err != nil {
		if hadPrevious {
			s.idempotency[key] = previous
		} else {
			delete(s.idempotency, key)
		}
		return fmt.Errorf("persist scenario job %q idempotency binding: %w", id, err)
	}
	return nil
}

func (s *scenarioJobStore) transition(
	jobID string,
	status runtimev1.ScenarioJobStatus,
	eventType runtimev1.ScenarioJobEventType,
	mutate func(*runtimev1.ScenarioJob),
) (*runtimev1.ScenarioJob, bool, error) {
	return s.transitionWithVoiceResult(jobID, status, eventType, nil, nil, mutate)
}

func (s *scenarioJobStore) transitionVoiceCompleted(
	jobID string,
	asset *runtimev1.VoiceAsset,
	reference *runtimev1.VoiceReference,
	mutate func(*runtimev1.ScenarioJob),
) (*runtimev1.ScenarioJob, bool, error) {
	return s.transitionWithVoiceResult(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		asset,
		reference,
		mutate,
	)
}

func (s *scenarioJobStore) transitionWithVoiceResult(
	jobID string,
	status runtimev1.ScenarioJobStatus,
	eventType runtimev1.ScenarioJobEventType,
	voiceAsset *runtimev1.VoiceAsset,
	voiceReference *runtimev1.VoiceReference,
	mutate func(*runtimev1.ScenarioJob),
) (*runtimev1.ScenarioJob, bool, error) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return nil, false, nil
	}
	s.mu.Lock()
	record, ok := s.jobs[id]
	if !ok {
		s.mu.Unlock()
		return nil, false, nil
	}
	if isTerminalScenarioJobStatus(record.job.GetStatus()) {
		job := cloneScenarioJob(record.job)
		s.mu.Unlock()
		return job, false, nil
	}
	if record.cancelRequested && status != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		job := cloneScenarioJob(record.job)
		s.mu.Unlock()
		return job, false, nil
	}
	previousJob := cloneScenarioJob(record.job)
	previousVoiceAsset := cloneVoiceAsset(record.voiceAsset)
	previousVoiceReference := cloneVoiceReference(record.voiceReference)
	previousUpdatedAt := record.updatedAt
	previousTerminalAt := record.terminalAt
	if voiceAsset != nil || voiceReference != nil {
		record.voiceAsset = cloneVoiceAsset(voiceAsset)
		record.voiceReference = cloneVoiceReference(voiceReference)
	}
	if mutate != nil {
		mutate(record.job)
	}
	if record.cancelRequested && status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		record.job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		record.job.ReasonDetail = record.cancelReason
		record.job.ReasonMetadata = nil
	}
	if status != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_UNSPECIFIED {
		record.job.Status = status
	}
	if record.job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED ||
		record.job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		record.job.ReasonMetadata = nil
	}
	if err := prepareFailedScenarioJobProjection(record.job); err != nil {
		record.job = previousJob
		record.voiceAsset = previousVoiceAsset
		record.voiceReference = previousVoiceReference
		record.updatedAt = previousUpdatedAt
		record.terminalAt = previousTerminalAt
		s.syncArtifactIndexLocked(id, record)
		job := cloneScenarioJob(record.job)
		s.mu.Unlock()
		return job, false, err
	}
	s.syncArtifactIndexLocked(id, record)
	nowTime := time.Now().UTC()
	record.updatedAt = nowTime
	record.job.UpdatedAt = timestamppb.New(nowTime)
	becameTerminal := isTerminalScenarioJobStatus(record.job.GetStatus()) && !record.doneClosed
	if becameTerminal {
		record.terminalAt = nowTime
	}
	if err := validateScenarioJobVoiceResultPair(record.job, record.voiceAsset, record.voiceReference); err != nil {
		record.job = previousJob
		record.voiceAsset = previousVoiceAsset
		record.voiceReference = previousVoiceReference
		record.updatedAt = previousUpdatedAt
		record.terminalAt = previousTerminalAt
		s.syncArtifactIndexLocked(id, record)
		job := cloneScenarioJob(record.job)
		s.mu.Unlock()
		return job, false, err
	}
	if err := s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistTransition, JobID: id, Status: status}); err != nil {
		record.job = previousJob
		record.voiceAsset = previousVoiceAsset
		record.voiceReference = previousVoiceReference
		record.updatedAt = previousUpdatedAt
		record.terminalAt = previousTerminalAt
		s.syncArtifactIndexLocked(id, record)
		job := cloneScenarioJob(record.job)
		s.mu.Unlock()
		return job, false, fmt.Errorf("persist scenario job %q transition to %s: %w", id, status.String(), err)
	}
	if becameTerminal {
		record.doneClosed = true
		close(record.done)
	}
	if eventType != runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TYPE_UNSPECIFIED {
		s.publishLocked(record, eventType)
	}
	s.pruneLocked(nowTime)
	job := cloneScenarioJob(record.job)
	s.mu.Unlock()
	return job, true, nil
}

func validateScenarioJobVoiceResultPair(job *runtimev1.ScenarioJob, asset *runtimev1.VoiceAsset, reference *runtimev1.VoiceReference) error {
	if job == nil {
		return fmt.Errorf("ScenarioJob is required")
	}
	isCompletedVoice := job.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE &&
		job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED
	if asset == nil && reference == nil {
		if isCompletedVoice {
			return fmt.Errorf("completed voice.create ScenarioJob requires a terminal VoiceAsset result")
		}
		return nil
	}
	if !isCompletedVoice || asset == nil || reference == nil || job.GetHead() == nil {
		return fmt.Errorf("ScenarioJob terminal VoiceAsset result is not state-consistent")
	}
	jobID := strings.TrimSpace(job.GetJobId())
	assetID := strings.TrimSpace(asset.GetVoiceAssetId())
	returnID := strings.TrimSpace(reference.GetVoiceAssetId())
	if jobID == "" || assetID == "" || assetID != jobID || returnID != assetID ||
		asset.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE ||
		strings.TrimSpace(asset.GetProviderVoiceRef()) == "" ||
		strings.TrimSpace(asset.GetAppId()) != strings.TrimSpace(job.GetHead().GetAppId()) ||
		strings.TrimSpace(asset.GetSubjectUserId()) != strings.TrimSpace(job.GetHead().GetSubjectUserId()) ||
		reference.GetKind() != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET {
		return fmt.Errorf("ScenarioJob terminal VoiceAsset result identity is invalid")
	}
	return nil
}

// forceFailedInMemory is the last-resort observability boundary after bounded
// terminal persistence retries are exhausted. It deliberately does not write
// durable state; restart recovery will terminalize the last durable nonterminal
// snapshot, while current callers and waiters immediately observe FAILED.
func (s *scenarioJobStore) forceFailedInMemory(jobID string, reason string) (*runtimev1.ScenarioJob, bool) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return nil, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record := s.jobs[id]
	if record == nil || record.job == nil {
		return nil, false
	}
	if isTerminalScenarioJobStatus(record.job.GetStatus()) {
		return cloneScenarioJob(record.job), false
	}
	previousJob := cloneScenarioJob(record.job)
	nowTime := time.Now().UTC()
	record.job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
	record.job.ReasonCode = runtimev1.ReasonCode_AI_OUTPUT_INVALID
	record.job.ReasonDetail = strings.TrimSpace(reason)
	record.job.ReasonMetadata = nil
	if err := prepareFailedScenarioJobProjection(record.job); err != nil {
		record.job = previousJob
		return cloneScenarioJob(record.job), false
	}
	record.job.UpdatedAt = timestamppb.New(nowTime)
	record.updatedAt = nowTime
	record.terminalAt = nowTime
	if !record.doneClosed {
		record.doneClosed = true
		close(record.done)
	}
	s.publishLocked(record, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED)
	return cloneScenarioJob(record.job), true
}

func (s *Service) transitionScenarioJob(
	jobID string,
	status runtimev1.ScenarioJobStatus,
	eventType runtimev1.ScenarioJobEventType,
	mutate func(*runtimev1.ScenarioJob),
) (*runtimev1.ScenarioJob, bool, error) {
	attempts := 1
	if isTerminalScenarioJobStatus(status) {
		attempts = maxScenarioJobTerminalPersistenceAttempts
	}
	var job *runtimev1.ScenarioJob
	var transitioned bool
	var err error
	for attempt := 1; attempt <= attempts; attempt++ {
		job, transitioned, err = s.scenarioJobs.transition(jobID, status, eventType, mutate)
		if err == nil {
			if job != nil && isTerminalScenarioJobStatus(job.GetStatus()) {
				s.releaseCloudCredentialCustodyForJob(jobID)
			}
			return job, transitioned, nil
		}
		s.logScenarioJobPersistenceFailure(
			"scenario job transition persistence attempt failed",
			"job_id", strings.TrimSpace(jobID),
			"status", status.String(),
			"attempt", attempt,
			"max_attempts", attempts,
			"error", err,
		)
	}
	if isTerminalScenarioJobStatus(status) {
		job, _ = s.scenarioJobs.forceFailedInMemory(jobID, scenarioJobTerminalPersistenceFailedReason)
		s.logScenarioJobPersistenceFailure(
			"SCENARIO JOB TERMINAL STATE COULD NOT BE PERSISTED; forced in-memory FAILED terminal",
			"job_id", strings.TrimSpace(jobID),
			"requested_status", status.String(),
			"reason", scenarioJobTerminalPersistenceFailedReason,
			"error", err,
		)
	}
	return job, false, err
}

func (s *Service) transitionVoiceScenarioJobCompleted(
	jobID string,
	asset *runtimev1.VoiceAsset,
	reference *runtimev1.VoiceReference,
	mutate func(*runtimev1.ScenarioJob),
) (*runtimev1.ScenarioJob, bool, error) {
	var job *runtimev1.ScenarioJob
	var transitioned bool
	var err error
	for attempt := 1; attempt <= maxScenarioJobTerminalPersistenceAttempts; attempt++ {
		job, transitioned, err = s.scenarioJobs.transitionVoiceCompleted(jobID, asset, reference, mutate)
		if err == nil {
			if job != nil && isTerminalScenarioJobStatus(job.GetStatus()) {
				s.releaseCloudCredentialCustodyForJob(jobID)
			}
			return job, transitioned, nil
		}
		s.logScenarioJobPersistenceFailure(
			"voice ScenarioJob terminal result persistence attempt failed",
			"job_id", strings.TrimSpace(jobID),
			"attempt", attempt,
			"max_attempts", maxScenarioJobTerminalPersistenceAttempts,
			"error", err,
		)
	}
	job, _ = s.scenarioJobs.forceFailedInMemory(jobID, scenarioJobTerminalPersistenceFailedReason)
	s.logScenarioJobPersistenceFailure(
		"VOICE SCENARIO JOB TERMINAL RESULT COULD NOT BE PERSISTED; forced in-memory FAILED terminal",
		"job_id", strings.TrimSpace(jobID),
		"reason", scenarioJobTerminalPersistenceFailedReason,
		"error", err,
	)
	return job, false, err
}

func (s *Service) failScenarioJobPersistencePrecondition(jobID string, reason string, cause error) {
	_, _, terminalErr := s.transitionScenarioJob(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED,
		func(job *runtimev1.ScenarioJob) {
			job.ReasonCode = runtimev1.ReasonCode_AI_OUTPUT_INVALID
			job.ReasonDetail = reason
			job.ReasonMetadata = nil
		},
	)
	if terminalErr != nil {
		s.logScenarioJobPersistenceFailure(
			"SCENARIO JOB EXECUTION PRECONDITION FAILED AND TERMINAL STATE COULD NOT BE PERSISTED",
			"job_id", strings.TrimSpace(jobID),
			"reason", reason,
			"precondition_error", cause,
			"terminal_error", terminalErr,
		)
	}
}

func (s *Service) finishScenarioJobExecution(jobID string) {
	var terminalPersisted bool
	var err error
	for attempt := 1; attempt <= maxScenarioJobTerminalPersistenceAttempts; attempt++ {
		terminalPersisted, err = s.scenarioJobs.finishExecution(jobID)
		if err == nil {
			if terminalPersisted {
				s.releaseCloudCredentialCustodyForJob(jobID)
			}
			return
		}
		s.logScenarioJobPersistenceFailure(
			"scenario job finish persistence attempt failed",
			"job_id", strings.TrimSpace(jobID),
			"attempt", attempt,
			"max_attempts", maxScenarioJobTerminalPersistenceAttempts,
			"error", err,
		)
	}
	s.scenarioJobs.forceFailedInMemory(jobID, scenarioJobTerminalPersistenceFailedReason)
	s.logScenarioJobPersistenceFailure(
		"SCENARIO JOB FINISH STATE COULD NOT BE PERSISTED; forced in-memory FAILED terminal",
		"job_id", strings.TrimSpace(jobID),
		"reason", scenarioJobTerminalPersistenceFailedReason,
		"error", err,
	)
}

func (s *Service) logScenarioJobPersistenceFailure(message string, args ...any) {
	logger := slog.Default()
	if s != nil && s.logger != nil {
		logger = s.logger
	}
	logger.Error(message, args...)
}

func (s *Service) updateScenarioJobProgress(jobID string, currentStep int32, totalSteps int32, progressPercent int32) (*runtimev1.ScenarioJob, bool) {
	job, updated, err := s.scenarioJobs.updateProgress(jobID, currentStep, totalSteps, progressPercent)
	if err != nil {
		s.logScenarioJobPersistenceFailure("scenario job progress persistence failed", "job_id", strings.TrimSpace(jobID), "error", err)
		return job, false
	}
	return job, updated
}

func (s *Service) commitScenarioJobArtifact(
	jobID string,
	artifact *runtimev1.ScenarioArtifact,
	currentStep int32,
	totalSteps int32,
	progressPercent int32,
) (*runtimev1.ScenarioJob, bool) {
	job, committed, err := s.scenarioJobs.commitArtifact(jobID, artifact, currentStep, totalSteps, progressPercent)
	if err != nil {
		s.logScenarioJobPersistenceFailure("scenario job artifact persistence failed", "job_id", strings.TrimSpace(jobID), "artifact_id", strings.TrimSpace(artifact.GetArtifactId()), "error", err)
		return job, false
	}
	return job, committed
}

func (s *scenarioJobStore) updateProgress(jobID string, currentStep int32, totalSteps int32, progressPercent int32) (*runtimev1.ScenarioJob, bool, error) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return nil, false, nil
	}
	s.mu.Lock()
	record, ok := s.jobs[id]
	if !ok || record == nil || record.job == nil {
		s.mu.Unlock()
		return nil, false, nil
	}
	if isTerminalScenarioJobStatus(record.job.GetStatus()) || record.cancelRequested {
		s.mu.Unlock()
		return nil, false, nil
	}
	previousJob := cloneScenarioJob(record.job)
	previousUpdatedAt := record.updatedAt
	record.job.ProgressCurrentStep = clampProgressStep(currentStep)
	record.job.ProgressTotalSteps = clampProgressStep(totalSteps)
	record.job.ProgressPercent = clampProgressPercent(progressPercent)
	nowTime := time.Now().UTC()
	record.updatedAt = nowTime
	record.job.UpdatedAt = timestamppb.New(nowTime)
	if err := s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistProgress, JobID: id, Status: record.job.GetStatus()}); err != nil {
		record.job = previousJob
		record.updatedAt = previousUpdatedAt
		job := cloneScenarioJob(record.job)
		s.mu.Unlock()
		return job, false, fmt.Errorf("persist scenario job %q progress: %w", id, err)
	}
	s.publishLocked(record, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING)
	s.pruneLocked(nowTime)
	job := cloneScenarioJob(record.job)
	s.mu.Unlock()
	return job, true, nil
}

func (s *scenarioJobStore) commitArtifact(
	jobID string,
	artifact *runtimev1.ScenarioArtifact,
	currentStep int32,
	totalSteps int32,
	progressPercent int32,
) (*runtimev1.ScenarioJob, bool, error) {
	id := strings.TrimSpace(jobID)
	if id == "" || artifact == nil {
		return nil, false, nil
	}
	artifactID := strings.TrimSpace(artifact.GetArtifactId())
	if artifactID == "" {
		return nil, false, nil
	}
	s.mu.Lock()
	record, ok := s.jobs[id]
	if !ok || record == nil || record.job == nil || isTerminalScenarioJobStatus(record.job.GetStatus()) || record.cancelRequested {
		s.mu.Unlock()
		return nil, false, nil
	}
	for _, existing := range record.job.GetArtifacts() {
		if strings.TrimSpace(existing.GetArtifactId()) == artifactID {
			s.mu.Unlock()
			return nil, false, nil
		}
	}
	previousJob := cloneScenarioJob(record.job)
	previousUpdatedAt := record.updatedAt
	record.job.Artifacts = append(record.job.Artifacts, cloneScenarioArtifact(artifact))
	record.job.ProgressCurrentStep = clampProgressStep(currentStep)
	record.job.ProgressTotalSteps = clampProgressStep(totalSteps)
	record.job.ProgressPercent = clampProgressPercent(progressPercent)
	s.syncArtifactIndexLocked(id, record)
	nowTime := time.Now().UTC()
	record.updatedAt = nowTime
	record.job.UpdatedAt = timestamppb.New(nowTime)
	if err := s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistArtifact, JobID: id, Status: record.job.GetStatus()}); err != nil {
		record.job = previousJob
		record.updatedAt = previousUpdatedAt
		s.syncArtifactIndexLocked(id, record)
		job := cloneScenarioJob(record.job)
		s.mu.Unlock()
		return job, false, fmt.Errorf("persist scenario job %q artifact %q: %w", id, artifactID, err)
	}
	s.publishLocked(record, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING)
	s.pruneLocked(nowTime)
	job := cloneScenarioJob(record.job)
	s.mu.Unlock()
	return job, true, nil
}

func (s *scenarioJobStore) startExecution(jobID string) bool {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return false
	}
	s.mu.Lock()
	record, ok := s.jobs[id]
	if !ok || record == nil || record.job == nil || isTerminalScenarioJobStatus(record.job.GetStatus()) || record.cancelRequested || record.executionStarted {
		s.mu.Unlock()
		return false
	}
	record.executionStarted = true
	s.mu.Unlock()
	return true
}

func (s *scenarioJobStore) requestCancel(jobID string, reason string) (*runtimev1.ScenarioJob, bool, error) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return nil, false, nil
	}
	s.mu.Lock()
	record, ok := s.jobs[id]
	if !ok || record == nil || record.job == nil || isTerminalScenarioJobStatus(record.job.GetStatus()) {
		var job *runtimev1.ScenarioJob
		if record != nil {
			job = cloneScenarioJob(record.job)
		}
		s.mu.Unlock()
		return job, false, nil
	}
	record.cancelRequested = true
	record.cancelReason = strings.TrimSpace(reason)
	record.job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
	record.job.ReasonDetail = record.cancelReason
	record.job.ReasonMetadata = nil
	nowTime := time.Now().UTC()
	record.updatedAt = nowTime
	record.job.UpdatedAt = timestamppb.New(nowTime)
	cancel := record.cancel
	executionStarted := record.executionStarted
	job := cloneScenarioJob(record.job)
	s.mu.Unlock()

	// Forward cancellation before any public CANCELED transition.
	if cancel != nil {
		cancel()
	}
	if !executionStarted {
		if _, err := s.finishExecution(id); err != nil {
			return job, false, err
		}
		job, _ = s.get(id)
	}
	return job, true, nil
}

func (s *scenarioJobStore) finishExecution(jobID string) (bool, error) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return false, nil
	}
	s.mu.Lock()
	record := s.jobs[id]
	if record == nil || record.job == nil {
		s.mu.Unlock()
		return false, nil
	}
	terminalPersisted := false
	record.executionStarted = false
	cancel := record.cancel
	record.cancel = nil
	if record.cancelRequested && !isTerminalScenarioJobStatus(record.job.GetStatus()) {
		previousJob := cloneScenarioJob(record.job)
		previousUpdatedAt := record.updatedAt
		previousTerminalAt := record.terminalAt
		record.job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
		record.job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		record.job.ReasonDetail = record.cancelReason
		record.job.ReasonMetadata = nil
		nowTime := time.Now().UTC()
		record.updatedAt = nowTime
		record.terminalAt = nowTime
		record.job.UpdatedAt = timestamppb.New(nowTime)
		if err := s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistCancellation, JobID: id, Status: record.job.GetStatus()}); err != nil {
			record.job = previousJob
			record.updatedAt = previousUpdatedAt
			record.terminalAt = previousTerminalAt
			s.mu.Unlock()
			if cancel != nil {
				cancel()
			}
			return false, fmt.Errorf("persist scenario job %q cancellation: %w", id, err)
		}
		terminalPersisted = true
		if !record.doneClosed {
			record.doneClosed = true
			close(record.done)
		}
		s.publishLocked(record, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED)
		s.pruneLocked(nowTime)
	}
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return terminalPersisted, nil
}

func clampProgressPercent(value int32) int32 {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func clampProgressStep(value int32) int32 {
	if value < 0 {
		return 0
	}
	return value
}

func (s *scenarioJobStore) listArtifacts(jobID string) (*runtimev1.ScenarioJob, []*runtimev1.ScenarioArtifact, string, bool) {
	job, ok := s.get(jobID)
	if !ok {
		return nil, nil, "", false
	}
	items := make([]*runtimev1.ScenarioArtifact, 0, len(job.GetArtifacts()))
	for _, artifact := range job.GetArtifacts() {
		items = append(items, cloneScenarioArtifact(artifact))
	}
	return job, items, job.GetTraceId(), true
}

func (s *scenarioJobStore) findArtifact(appID string, subjectUserID string, artifactID string) (*runtimev1.ScenarioArtifact, string, bool) {
	id := strings.TrimSpace(artifactID)
	if id == "" {
		return nil, "", false
	}
	wantAppID := strings.TrimSpace(appID)
	wantSubjectUserID := strings.TrimSpace(subjectUserID)

	s.mu.RLock()
	defer s.mu.RUnlock()

	if uploaded := s.uploads[id]; uploaded != nil {
		if wantAppID != "" && strings.TrimSpace(uploaded.appID) != wantAppID {
			return nil, "", false
		}
		if wantSubjectUserID != "" && strings.TrimSpace(uploaded.subjectUserID) != wantSubjectUserID {
			return nil, "", false
		}
		return cloneScenarioArtifact(uploaded.artifact), strings.TrimSpace(uploaded.traceID), true
	}
	if jobID := strings.TrimSpace(s.artifactJobs[id]); jobID != "" {
		record := s.jobs[jobID]
		if record != nil && record.job != nil {
			head := record.job.GetHead()
			if wantAppID == "" || strings.TrimSpace(head.GetAppId()) == wantAppID {
				if wantSubjectUserID == "" || strings.TrimSpace(head.GetSubjectUserId()) == wantSubjectUserID {
					for _, artifact := range record.job.GetArtifacts() {
						if strings.TrimSpace(artifact.GetArtifactId()) == id {
							return cloneScenarioArtifact(artifact), record.job.GetTraceId(), true
						}
					}
				}
			}
		}
	}

	for _, record := range s.jobs {
		if record == nil || record.job == nil {
			continue
		}
		head := record.job.GetHead()
		if wantAppID != "" && strings.TrimSpace(head.GetAppId()) != wantAppID {
			continue
		}
		if wantSubjectUserID != "" && strings.TrimSpace(head.GetSubjectUserId()) != wantSubjectUserID {
			continue
		}
		for _, artifact := range record.job.GetArtifacts() {
			if strings.TrimSpace(artifact.GetArtifactId()) != id {
				continue
			}
			return cloneScenarioArtifact(artifact), record.job.GetTraceId(), true
		}
	}
	return nil, "", false
}

func (s *scenarioJobStore) storeUploadedArtifact(appID string, subjectUserID string, traceID string, artifact *runtimev1.ScenarioArtifact) *runtimev1.ScenarioArtifact {
	if artifact == nil {
		return nil
	}
	artifactID := strings.TrimSpace(artifact.GetArtifactId())
	if artifactID == "" {
		return nil
	}
	cloned := cloneScenarioArtifact(artifact)
	nowTime := time.Now().UTC()
	s.mu.Lock()
	s.uploads[artifactID] = &uploadedArtifactRecord{
		appID:         strings.TrimSpace(appID),
		subjectUserID: strings.TrimSpace(subjectUserID),
		traceID:       strings.TrimSpace(traceID),
		artifact:      cloned,
		storedAt:      nowTime,
	}
	s.pruneLocked(nowTime)
	s.mu.Unlock()
	return cloneScenarioArtifact(cloned)
}

func (s *scenarioJobStore) subscribe(jobID string, buffer int) (uint64, <-chan *runtimev1.ScenarioJobEvent, []*runtimev1.ScenarioJobEvent, bool, bool) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return 0, nil, nil, false, false
	}
	if buffer < 1 {
		buffer = 1
	}

	s.mu.Lock()
	record, ok := s.jobs[id]
	if !ok {
		s.mu.Unlock()
		return 0, nil, nil, false, false
	}
	record.nextSubID++
	subID := record.nextSubID
	ch := make(chan *runtimev1.ScenarioJobEvent, buffer)
	record.subscribers[subID] = ch

	backlog := make([]*runtimev1.ScenarioJobEvent, 0, len(record.events))
	for _, event := range record.events {
		backlog = append(backlog, cloneScenarioJobEvent(event))
	}
	terminal := isTerminalScenarioJobStatus(record.job.GetStatus())
	s.mu.Unlock()
	return subID, ch, backlog, terminal, true
}

func (s *scenarioJobStore) unsubscribe(jobID string, subID uint64) {
	id := strings.TrimSpace(jobID)
	if id == "" || subID == 0 {
		return
	}
	s.mu.Lock()
	record, ok := s.jobs[id]
	if !ok {
		s.mu.Unlock()
		return
	}
	ch, exists := record.subscribers[subID]
	if exists {
		delete(record.subscribers, subID)
		close(ch)
	}
	s.mu.Unlock()
}

func (s *scenarioJobStore) publishLocked(record *scenarioJobRecord, eventType runtimev1.ScenarioJobEventType) {
	if record == nil {
		return
	}
	record.nextSeq++
	event := &runtimev1.ScenarioJobEvent{
		EventType: eventType,
		Sequence:  record.nextSeq,
		TraceId:   record.job.GetTraceId(),
		Timestamp: timestamppb.New(time.Now().UTC()),
		Job:       cloneScenarioJob(record.job),
	}
	record.events = append(record.events, event)
	if len(record.events) > maxScenarioJobEventBacklog {
		record.events = cloneScenarioJobEvents(record.events[len(record.events)-maxScenarioJobEventBacklog:])
	}
	for _, ch := range record.subscribers {
		select {
		case ch <- cloneScenarioJobEvent(event):
			continue
		default:
		}
		select {
		case <-ch:
		default:
		}
		select {
		case ch <- cloneScenarioJobEvent(event):
		default:
		}
	}
}

func (s *scenarioJobStore) pruneLocked(now time.Time) {
	s.pruneJobsLocked(now)
	s.pruneUploadsLocked(now)
	s.pruneIdempotencyLocked(now)
}

func (s *scenarioJobStore) pruneJobsLocked(now time.Time) {
	cutoff := now.Add(-scenarioJobRetention)
	type candidate struct {
		jobID string
		at    time.Time
	}
	terminal := make([]candidate, 0, len(s.jobs))
	for jobID, record := range s.jobs {
		if record == nil || record.job == nil {
			s.deleteJobLocked(jobID)
			continue
		}
		if !isTerminalScenarioJobStatus(record.job.GetStatus()) {
			continue
		}
		if record.cloudAssembly != nil && strings.TrimSpace(record.cloudAssembly.CredentialCustodyRef) != "" {
			continue
		}
		terminalAt := scenarioJobRecordTimestamp(record)
		if !terminalAt.IsZero() && terminalAt.Before(cutoff) {
			s.deleteJobLocked(jobID)
			continue
		}
		terminal = append(terminal, candidate{jobID: jobID, at: terminalAt})
	}
	if len(terminal) <= maxRetainedTerminalScenarioJobs {
		return
	}
	sort.Slice(terminal, func(i int, j int) bool {
		return terminal[i].at.Before(terminal[j].at)
	})
	for _, item := range terminal[:len(terminal)-maxRetainedTerminalScenarioJobs] {
		s.deleteJobLocked(item.jobID)
	}
}

func (s *scenarioJobStore) pruneUploadsLocked(now time.Time) {
	cutoff := now.Add(-scenarioUploadedArtifactRetention)
	type candidate struct {
		artifactID string
		at         time.Time
	}
	uploads := make([]candidate, 0, len(s.uploads))
	for artifactID, record := range s.uploads {
		if record == nil || record.artifact == nil {
			delete(s.uploads, artifactID)
			continue
		}
		if !record.storedAt.IsZero() && record.storedAt.Before(cutoff) {
			delete(s.uploads, artifactID)
			continue
		}
		uploads = append(uploads, candidate{artifactID: artifactID, at: record.storedAt})
	}
	if len(uploads) <= maxScenarioUploadedArtifacts {
		return
	}
	sort.Slice(uploads, func(i int, j int) bool {
		return uploads[i].at.Before(uploads[j].at)
	})
	for _, item := range uploads[:len(uploads)-maxScenarioUploadedArtifacts] {
		delete(s.uploads, item.artifactID)
	}
}

func (s *scenarioJobStore) pruneIdempotencyLocked(now time.Time) {
	cutoff := now.Add(-scenarioIdempotencyRetention)
	type candidate struct {
		key string
		at  time.Time
	}
	bindings := make([]candidate, 0, len(s.idempotency))
	for key, binding := range s.idempotency {
		jobID := strings.TrimSpace(binding.jobID)
		if jobID == "" || s.jobs[jobID] == nil {
			delete(s.idempotency, key)
			continue
		}
		if !binding.boundAt.IsZero() && binding.boundAt.Before(cutoff) {
			delete(s.idempotency, key)
			continue
		}
		bindings = append(bindings, candidate{key: key, at: binding.boundAt})
	}
	if len(bindings) <= maxScenarioIdempotencyBindings {
		return
	}
	sort.Slice(bindings, func(i int, j int) bool {
		return bindings[i].at.Before(bindings[j].at)
	})
	for _, item := range bindings[:len(bindings)-maxScenarioIdempotencyBindings] {
		delete(s.idempotency, item.key)
	}
}

func (s *scenarioJobStore) deleteJobLocked(jobID string) {
	record := s.jobs[jobID]
	delete(s.jobs, jobID)
	if record == nil {
		return
	}
	for artifactID, indexedJobID := range s.artifactJobs {
		if indexedJobID == jobID {
			delete(s.artifactJobs, artifactID)
		}
	}
	for subID, ch := range record.subscribers {
		delete(record.subscribers, subID)
		close(ch)
	}
}

func (s *scenarioJobStore) syncArtifactIndexLocked(jobID string, record *scenarioJobRecord) {
	if jobID == "" {
		return
	}
	for artifactID, indexedJobID := range s.artifactJobs {
		if indexedJobID == jobID {
			delete(s.artifactJobs, artifactID)
		}
	}
	if record == nil || record.job == nil {
		return
	}
	for _, artifact := range record.job.GetArtifacts() {
		artifactID := strings.TrimSpace(artifact.GetArtifactId())
		if artifactID == "" {
			continue
		}
		s.artifactJobs[artifactID] = jobID
	}
}

func scenarioJobRecordTimestamp(record *scenarioJobRecord) time.Time {
	if record == nil {
		return time.Time{}
	}
	switch {
	case !record.terminalAt.IsZero():
		return record.terminalAt
	case !record.updatedAt.IsZero():
		return record.updatedAt
	default:
		return record.createdAt
	}
}

func cloneScenarioJobEvents(input []*runtimev1.ScenarioJobEvent) []*runtimev1.ScenarioJobEvent {
	if len(input) == 0 {
		return nil
	}
	out := make([]*runtimev1.ScenarioJobEvent, 0, len(input))
	for _, event := range input {
		out = append(out, cloneScenarioJobEvent(event))
	}
	return out
}

func cloneScenarioArtifact(input *runtimev1.ScenarioArtifact) *runtimev1.ScenarioArtifact {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	out, ok := cloned.(*runtimev1.ScenarioArtifact)
	if !ok {
		return nil
	}
	return out
}
