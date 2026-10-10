package ai

import (
	"context"
	"errors"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
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
	scenarioJobPersistDispatchIntent  scenarioJobPersistenceOperation = "dispatch-intent"
	scenarioJobPersistCreate          scenarioJobPersistenceOperation = "create"
	scenarioJobPersistCreateAndBind   scenarioJobPersistenceOperation = "create-and-bind-idempotency"
	scenarioJobPersistBind            scenarioJobPersistenceOperation = "bind-idempotency"
	scenarioJobPersistTransition      scenarioJobPersistenceOperation = "transition"
	scenarioJobPersistProgress        scenarioJobPersistenceOperation = "progress"
	scenarioJobPersistArtifact        scenarioJobPersistenceOperation = "artifact"
	scenarioJobPersistCancellation    scenarioJobPersistenceOperation = "cancellation"
	scenarioJobPersistCustodyBegin    scenarioJobPersistenceOperation = "credential-custody-begin"
	scenarioJobPersistCustodyAbort    scenarioJobPersistenceOperation = "credential-custody-abort"
	scenarioJobPersistCustodyRelease  scenarioJobPersistenceOperation = "credential-custody-release"
	scenarioJobPersistLoad            scenarioJobPersistenceOperation = "load"
	scenarioJobPersistPrune           scenarioJobPersistenceOperation = "prune"
	scenarioJobPersistMaintenance     scenarioJobPersistenceOperation = "maintenance"
	scenarioJobPersistResultCandidate scenarioJobPersistenceOperation = "result-candidate"
	scenarioJobPersistPayloadFence    scenarioJobPersistenceOperation = "payload-fence"
	scenarioJobPersistPayloadDispose  scenarioJobPersistenceOperation = "payload-dispose"
)

type scenarioJobPersistenceAttempt struct {
	Operation scenarioJobPersistenceOperation
	JobID     string
	Status    runtimev1.ScenarioJobStatus
}

type scenarioJobRecord struct {
	captureAborted          bool
	pendingTerminal         *runtimev1.ScenarioJob
	dispatchPossible        *bool
	nativeReceipt           *nimillm.NativeTaskReceipt
	nativeReceiptPending    bool
	nativeResult            *nimillm.NativeTaskObservation
	bodyArtifactIDs         []string
	resultCandidate         *scenarioJobResultCandidate
	nativeObservation       bool
	nativeWorkVersion       uint64
	observationIssue        *runtimev1.ScenarioJobObservationIssue
	payload                 *embeddingPayload
	executionDone           chan struct{}
	job                     *runtimev1.ScenarioJob
	resolvedAssembly        *localResolvedAssembly
	cloudAssembly           *cloudResolvedAssembly
	localAppOwner           *localAppJobOwner
	musicSubmission         *localAppMusicSubmission
	musicOutputReservations map[string]int64
	voiceAsset              *runtimev1.VoiceAsset
	voiceReference          *runtimev1.VoiceReference
	visionLocate            *runtimev1.VisionLocateResult
	events                  []*runtimev1.ScenarioJobEvent
	subscribers             map[uint64]chan *runtimev1.ScenarioJobEvent
	nextSubID               uint64
	nextSeq                 uint64
	done                    chan struct{}
	doneClosed              bool
	cancel                  context.CancelFunc
	cancelRequested         bool
	cancelReason            string
	executionStarted        bool
	createdAt               time.Time
	updatedAt               time.Time
	terminalAt              time.Time
	terminalUnpersisted     bool
	publicEvicted           bool
	// modelAssetUses keeps every captured ModelAsset's files alive until the
	// job is terminal and its executor has exited. Released exactly once.
	modelAssetUses []func()
}

// releaseModelAssetUses releases the captured ModelAsset uses once. It is
// called only when the record is terminal and no executor still runs.
func (record *scenarioJobRecord) releaseModelAssetUses() {
	if record == nil {
		return
	}
	runModelAssetReleases(record.takeModelAssetUses())
}

// Caller owns the unpublished record or holds the Job store mutex.
func (record *scenarioJobRecord) takeModelAssetUses() []func() {
	releases := record.modelAssetUses
	record.modelAssetUses = nil
	return releases
}

func runModelAssetReleases(releases []func()) {
	for _, release := range releases {
		if release != nil {
			release()
		}
	}
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
	recoveryIncomplete   bool
	captureRows          map[string]*scenarioJobRecord
	jobBodies            runtimeartifact.JobBodyStore
	actionClaims         map[scenarioActionKey]*scenarioActionClaim
	captureSlots         chan struct{}
	musicArtifacts       runtimeartifact.MusicRecoveryStore
	musicPreparations    map[string]int64
	modelAssetUseHolder  localexecution.ModelAssetUseHolder
	mu                   sync.RWMutex
	durablePath          string
	jobs                 map[string]*scenarioJobRecord
	artifactJobs         map[string]string
	idempotency          map[string]scenarioIdempotencyBinding
	pendingCloudCustody  map[string]scenarioPendingCloudCustody
	uploads              map[string]*uploadedArtifactRecord
	persistenceFailure   func(scenarioJobPersistenceAttempt) error
	isolationDiagnostics []scenarioJobIsolationDiagnostic
	durable              scenarioJobDurableState
}

func newScenarioJobStore() *scenarioJobStore {
	return &scenarioJobStore{
		musicArtifacts:      runtimeartifact.NewMemoryStore(),
		musicPreparations:   make(map[string]int64),
		jobs:                make(map[string]*scenarioJobRecord),
		artifactJobs:        make(map[string]string),
		idempotency:         make(map[string]scenarioIdempotencyBinding),
		pendingCloudCustody: make(map[string]scenarioPendingCloudCustody),
		uploads:             make(map[string]*uploadedArtifactRecord),
		durable:             newScenarioJobDurableState(),
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
	payload ...*embeddingPayload,
) (*runtimev1.ScenarioJob, bool, error) {
	return s.createOwnedAndBindCapturedInputsChecked(job, cancel, owner, idempotencyScope, resolvedAssembly, nil, false, nil, payload...)
}

func (s *scenarioJobStore) createOwnedAndBindCloudAssemblyChecked(
	job *runtimev1.ScenarioJob,
	cancel context.CancelFunc,
	owner *localAppJobOwner,
	idempotencyScope string,
	cloudAssembly *cloudResolvedAssembly,
	payload ...*embeddingPayload,
) (*runtimev1.ScenarioJob, bool, error) {
	return s.createOwnedAndBindCapturedInputsChecked(job, cancel, owner, idempotencyScope, nil, cloudAssembly, true, nil, payload...)
}

func (s *scenarioJobStore) createOwnedAndBindCapturedInputsChecked(
	job *runtimev1.ScenarioJob,
	cancel context.CancelFunc,
	owner *localAppJobOwner,
	idempotencyScope string,
	resolvedAssembly *localResolvedAssembly,
	cloudAssembly *cloudResolvedAssembly,
	consumePendingCloudCustody bool,
	submission *localAppMusicSubmission,
	payload ...*embeddingPayload,
) (*runtimev1.ScenarioJob, bool, error) {
	if job == nil {
		return nil, false, fmt.Errorf("scenario job is required")
	}
	id := strings.TrimSpace(job.GetJobId())
	if id == "" {
		return nil, false, fmt.Errorf("scenario job id is required")
	}
	if err := validateLocalAppMusicSubmission(submission, owner, job, cloudAssembly); err != nil {
		return nil, false, err
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
	if job.GetExecutionMode() == runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB && (job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED || job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED) {
		job.SubmissionOutcome = runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_NOT_DISPATCHED
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
	var capturedPayload *embeddingPayload
	if len(payload) > 0 {
		capturedPayload = cloneEmbeddingPayload(payload[0])
	}
	if err := validateScenarioJobPayload(job, capturedAssembly, capturedCloudAssembly, capturedPayload); err != nil {
		return nil, false, err
	}
	record := &scenarioJobRecord{
		payload:          capturedPayload,
		job:              cloneScenarioJob(job),
		resolvedAssembly: capturedAssembly,
		cloudAssembly:    capturedCloudAssembly,
		localAppOwner:    cloneLocalAppJobOwner(owner),
		musicSubmission:  cloneLocalAppMusicSubmission(submission),
		events:           make([]*runtimev1.ScenarioJobEvent, 0, 8),
		subscribers:      make(map[uint64]chan *runtimev1.ScenarioJobEvent),
		done:             make(chan struct{}),
		cancel:           cancel,
		createdAt:        nowTime,
		updatedAt:        nowTime,
	}
	if job.GetExecutionMode() == runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB {
		record.dispatchPossible = proto.Bool(job.GetSubmissionOutcome() == runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED)
	}
	if resolvedAssembly != nil && resolvedAssembly.modelAssetUse != nil {
		use, err := resolvedAssembly.modelAssetUse.Retain()
		if err != nil {
			return nil, false, fmt.Errorf("retain captured ModelAsset use: %w", err)
		}
		record.modelAssetUses = []func(){use.Release}
	} else {
		var err error
		record.modelAssetUses, err = s.acquireModelAssetUsesFor(id, capturedAssembly)
		if err != nil {
			return nil, false, err
		}
	}
	published := false
	defer func() {
		if !published {
			record.releaseModelAssetUses()
		}
	}()
	key := strings.TrimSpace(idempotencyScope)

	s.mu.Lock()
	if submission != nil {
		if existing := s.musicSubmissionLocked(owner, submission.ID); existing != nil {
			if scenarioJobPublicExpired(existing, nowTime) {
				s.mu.Unlock()
				return nil, false, errMusicRecoveryExpired
			}
			if existing.musicSubmission.RequestSHA256 != submission.RequestSHA256 {
				s.mu.Unlock()
				return nil, false, errLocalAppSubmissionConflict
			}
			snapshot := cloneScenarioJob(existing.job)
			s.mu.Unlock()
			return snapshot, false, nil
		}
		if submission.ReservedBytes > 0 {
			if err := s.admitMusicRecoveryLocked(musicRecoveryOutputReservation(submission, capturedCloudAssembly)+musicCapturedInputBytes(capturedAssembly, capturedCloudAssembly), true); err != nil {
				s.mu.Unlock()
				return nil, false, err
			}
		}
	}
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
				if scenarioJobPublicExpired(existing, nowTime) {
					s.mu.Unlock()
					return nil, false, errMusicRecoveryExpired
				}
				snapshot := cloneScenarioJob(existing.job)
				s.mu.Unlock()
				return snapshot, false, nil
			}
		}
	}
	if capture := s.captureRows[id]; capture != nil {
		record.bodyArtifactIDs = append([]string(nil), capture.bodyArtifactIDs...)
	}
	if err := s.admitJobCapacityLocked(record); err != nil {
		s.mu.Unlock()
		return nil, false, err
	}
	if s.jobs[id] != nil {
		s.mu.Unlock()
		return nil, false, fmt.Errorf("scenario Job identity is already owned")
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
	if record.localAppOwner != nil && record.localAppOwner.workPermit != nil {
		permit := record.localAppOwner.workPermit
		permit.jobID = id
		permit.adopted.Store(true)
	}
	s.mu.Unlock()
	published = true
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
	if !ok || scenarioJobPublicExpired(record, time.Now()) {
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
	if !ok || record == nil || scenarioJobPublicExpired(record, time.Now()) {
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
	work ...context.Context,
) (*runtimev1.ScenarioJob, bool, error) {
	return s.transitionWithResults(jobID, status, eventType, nil, nil, nil, mutate, work...)
}

func (s *scenarioJobStore) transitionVoiceCompleted(
	jobID string,
	asset *runtimev1.VoiceAsset,
	reference *runtimev1.VoiceReference,
	mutate func(*runtimev1.ScenarioJob),
	work ...context.Context,
) (*runtimev1.ScenarioJob, bool, error) {
	return s.transitionWithResults(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		asset,
		reference,
		nil,
		mutate,
		work...,
	)
}

func (s *scenarioJobStore) transitionWithResults(
	jobID string,
	status runtimev1.ScenarioJobStatus,
	eventType runtimev1.ScenarioJobEventType,
	voiceAsset *runtimev1.VoiceAsset,
	voiceReference *runtimev1.VoiceReference,
	visionLocate *runtimev1.VisionLocateResult,
	mutate func(*runtimev1.ScenarioJob),
	work ...context.Context,
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
	if err := validateNativeJobClaim(record, work); err != nil {
		s.mu.Unlock()
		return nil, false, err
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
	previousVisionLocate := cloneVisionLocateResult(record.visionLocate)
	previousUpdatedAt := record.updatedAt
	previousTerminalAt := record.terminalAt
	previousDispatch := record.dispatchPossible
	previousCandidate := record.resultCandidate
	if voiceAsset != nil || voiceReference != nil {
		record.voiceAsset = cloneVoiceAsset(voiceAsset)
		record.voiceReference = cloneVoiceReference(voiceReference)
	}
	if visionLocate != nil {
		record.visionLocate = cloneVisionLocateResult(visionLocate)
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
	setScenarioJobTransitionOutcome(record.job)
	applyScenarioDispatchFacts(record)
	if record.job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED ||
		record.job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		record.job.ReasonMetadata = nil
		record.job.Interruption = nil
	}
	if err := prepareFailedScenarioJobProjection(record.job); err != nil {
		record.dispatchPossible = previousDispatch
		record.job = previousJob
		record.visionLocate = previousVisionLocate
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
	validationErr := validateScenarioJobTerminalResults(record)
	if validationErr == nil {
		validationErr = s.retainTerminalMusicLocked(record)
	}
	if err := validationErr; err != nil {
		record.dispatchPossible = previousDispatch
		record.job = previousJob
		record.visionLocate = previousVisionLocate
		record.voiceAsset = previousVoiceAsset
		record.voiceReference = previousVoiceReference
		record.updatedAt = previousUpdatedAt
		record.terminalAt = previousTerminalAt
		s.syncArtifactIndexLocked(id, record)
		job := cloneScenarioJob(record.job)
		s.mu.Unlock()
		return job, false, err
	}
	persist := func() error {
		return s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistTransition, JobID: id, Status: status})
	}
	if status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED && (len(record.job.GetArtifacts()) > 0 || voiceAsset != nil) && record.job.GetExecutionMode() == runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB && (voiceAsset == nil || voiceAsset.GetPersistence() == runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT) {
		if record.resultCandidate == nil {
			candidate, candidateErr := encodeScenarioResultCandidate(record)
			if candidateErr != nil {
				record.dispatchPossible = previousDispatch
				record.job = previousJob
				record.updatedAt, record.terminalAt = previousUpdatedAt, previousTerminalAt
				record.voiceAsset, record.voiceReference, record.visionLocate = previousVoiceAsset, previousVoiceReference, previousVisionLocate
				s.syncArtifactIndexLocked(id, record)
				s.mu.Unlock()
				return cloneScenarioJob(previousJob), false, candidateErr
			}
			finalAsset, finalReference := record.voiceAsset, record.voiceReference
			finalVision := record.visionLocate
			finalJob, finalUpdated, finalTerminal := record.job, record.updatedAt, record.terminalAt
			previousNative := record.nativeResult
			record.job, record.updatedAt, record.terminalAt = previousJob, previousUpdatedAt, previousTerminalAt
			record.resultCandidate = candidate
			record.voiceAsset, record.voiceReference = previousVoiceAsset, previousVoiceReference
			record.visionLocate = previousVisionLocate
			record.nativeResult = nil
			s.syncArtifactIndexLocked(id, record)
			candidateErr = s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistResultCandidate, JobID: id, Status: record.job.GetStatus()})
			if candidateErr != nil {
				// Keep the validated complete result in this process for the next
				// writer attempt or original Job Get. The public snapshot stays
				// unchanged; this failed write grants no restart durability.
				record.dispatchPossible = previousDispatch
				record.nativeResult = previousNative
				s.mu.Unlock()
				return cloneScenarioJob(previousJob), false, candidateErr
			}
			previousCandidate = record.resultCandidate
			previousDispatch = record.dispatchPossible
			record.job, record.updatedAt, record.terminalAt = finalJob, finalUpdated, finalTerminal
			record.voiceAsset, record.voiceReference = finalAsset, finalReference
			record.visionLocate = finalVision
			s.syncArtifactIndexLocked(id, record)
		}
		record.resultCandidate = nil
	}
	if status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		record.resultCandidate = nil
	}
	var persistenceErr error
	var ids []string
	if status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		for _, artifact := range record.job.GetArtifacts() {
			for _, candidateID := range record.bodyArtifactIDs {
				if candidateID == artifact.GetArtifactId() {
					ids = append(ids, candidateID)
					break
				}
			}
		}
	}
	if len(ids) > 0 {
		if s.jobBodies == nil {
			persistenceErr = fmt.Errorf("native result has no body custody owner")
		} else {
			persistenceErr = s.jobBodies.PublishJobBodies(id, ids, persist)
		}
	} else {
		persistenceErr = persist()
	}
	if err := persistenceErr; err != nil {
		if isTerminalScenarioJobStatus(status) && status != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			record.pendingTerminal = cloneScenarioJob(record.job)
		}
		var transientCandidate *scenarioJobResultCandidate
		if status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED && record.job.GetExecutionMode() == runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB && previousCandidate == nil && voiceAsset == nil {
			transientCandidate, _ = encodeScenarioResultCandidate(record)
		}
		record.resultCandidate = previousCandidate
		if transientCandidate != nil {
			record.resultCandidate = transientCandidate
		}
		record.dispatchPossible = previousDispatch
		record.job = previousJob
		record.visionLocate = previousVisionLocate
		record.voiceAsset = previousVoiceAsset
		record.voiceReference = previousVoiceReference
		record.updatedAt = previousUpdatedAt
		record.terminalAt = previousTerminalAt
		s.syncArtifactIndexLocked(id, record)
		job := cloneScenarioJob(record.job)
		s.mu.Unlock()
		return job, false, fmt.Errorf("persist scenario job %q transition to %s: %w", id, status.String(), err)
	}
	record.pendingTerminal = nil
	record.observationIssue = nil
	var releases []func()
	if becameTerminal {
		record.doneClosed = true
		close(record.done)
		if !record.executionStarted {
			releases = record.takeModelAssetUses()
		}
	}
	if eventType != runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TYPE_UNSPECIFIED {
		s.publishLocked(record, eventType)
	}
	s.pruneLocked(nowTime)
	job := cloneScenarioJob(record.job)
	s.mu.Unlock()
	runModelAssetReleases(releases)
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

// A failed persistence operation changes observation diagnostics, never the
// public Job fact or event stream. Real authority/Host stops remain independent.
func (s *scenarioJobStore) recordPersistenceIssue(jobID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if record := s.jobs[jobID]; record != nil && !isTerminalScenarioJobStatus(record.job.GetStatus()) {
		record.observationIssue = &runtimev1.ScenarioJobObservationIssue{ReasonCode: runtimev1.ReasonCode_AI_OUTPUT_INVALID, ObservedAt: timestamppb.Now()}
	}
}

func (s *Service) transitionScenarioJob(
	jobID string,
	status runtimev1.ScenarioJobStatus,
	eventType runtimev1.ScenarioJobEventType,
	mutate func(*runtimev1.ScenarioJob),
	work ...context.Context,
) (*runtimev1.ScenarioJob, bool, error) {
	attempts := 1
	if isTerminalScenarioJobStatus(status) {
		attempts = maxScenarioJobTerminalPersistenceAttempts
	}
	var job *runtimev1.ScenarioJob
	var transitioned bool
	var err error
	for attempt := 1; attempt <= attempts; attempt++ {
		entered := false
		commit := func() error {
			entered = true
			var cause error
			job, transitioned, cause = s.scenarioJobs.transition(jobID, status, eventType, mutate, work...)
			return cause
		}
		if status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED {
			err = s.scenarioJobs.withJobWorkAuthority(jobID, commit)
		} else {
			err = commit()
		}
		if errors.Is(err, errNativeJobClaimLost) {
			return job, false, err
		}
		if err != nil && !entered {
			s.scenarioJobs.failJobWorkAuthority(jobID, err, work...)
			job, _ = s.scenarioJobs.get(jobID)
			return job, false, err
		}
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
		if status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED && s.scenarioJobs.hasResultCandidate(jobID) {
			return job, false, err
		}
		if len(work) > 0 && work[0].Value(nativeJobClaimKey{}) != nil && status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			return job, false, err
		}
		s.scenarioJobs.recordPersistenceIssue(jobID)
		job, _ = s.scenarioJobs.get(jobID)
		s.logScenarioJobPersistenceFailure(
			"SCENARIO JOB TERMINAL STATE COULD NOT BE PERSISTED; last trustworthy Job retained",
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
	work ...context.Context,
) (*runtimev1.ScenarioJob, bool, error) {
	var job *runtimev1.ScenarioJob
	var transitioned bool
	var err error
	for attempt := 1; attempt <= maxScenarioJobTerminalPersistenceAttempts; attempt++ {
		entered := false
		err = s.scenarioJobs.withJobWorkAuthority(jobID, func() error {
			entered = true
			var cause error
			job, transitioned, cause = s.scenarioJobs.transitionVoiceCompleted(jobID, asset, reference, mutate, work...)
			return cause
		})
		if errors.Is(err, errNativeJobClaimLost) {
			return job, false, err
		}
		if err != nil && !entered {
			s.scenarioJobs.failJobWorkAuthority(jobID, err, work...)
			job, _ = s.scenarioJobs.get(jobID)
			return job, false, err
		}
		if err == nil {
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
	if s.scenarioJobs.hasResultCandidate(jobID) {
		return job, false, err
	}
	s.scenarioJobs.recordPersistenceIssue(jobID)
	job, _ = s.scenarioJobs.get(jobID)
	s.logScenarioJobPersistenceFailure(
		"VOICE SCENARIO JOB TERMINAL RESULT COULD NOT BE PERSISTED; last trustworthy Job retained",
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
	var err error
	for attempt := 1; attempt <= maxScenarioJobTerminalPersistenceAttempts; attempt++ {
		_, err = s.scenarioJobs.finishExecution(jobID)
		if err == nil {
			if cleanupErr := s.releaseScenarioBodyCandidates(jobID); cleanupErr != nil {
				s.logScenarioJobPersistenceFailure("Job body cleanup remains pending", "job_id", jobID, "error", cleanupErr)
			}
			s.releaseCloudCredentialCustodyForJob(jobID)
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
	s.scenarioJobs.recordPersistenceIssue(jobID)
	s.logScenarioJobPersistenceFailure(
		"SCENARIO JOB FINISH STATE COULD NOT BE PERSISTED; last trustworthy Job retained",
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
	var job *runtimev1.ScenarioJob
	var committed bool
	err := s.scenarioJobs.withJobWorkAuthority(jobID, func() error {
		var cause error
		job, committed, cause = s.scenarioJobs.commitArtifact(jobID, artifact, currentStep, totalSteps, progressPercent)
		return cause
	})
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

// setModelAssetUseHolder installs the inventory owner's use surface. Jobs
// created afterwards keep their captured ModelAssets alive until terminal.
func (s *scenarioJobStore) setModelAssetUseHolder(holder localexecution.ModelAssetUseHolder) {
	s.mu.Lock()
	s.modelAssetUseHolder = holder
	s.mu.Unlock()
}

func (s *scenarioJobStore) acquireModelAssetUsesFor(jobID string, assembly *localResolvedAssembly) ([]func(), error) {
	if assembly == nil {
		return nil, nil
	}
	s.mu.Lock()
	holder := s.modelAssetUseHolder
	s.mu.Unlock()
	if holder == nil {
		return nil, nil
	}
	seen := make(map[string]struct{}, len(assembly.ModelAxes))
	releases := make([]func(), 0, len(assembly.ModelAxes))
	for _, axis := range assembly.ModelAxes {
		id := strings.TrimSpace(axis.ModelAssetID)
		if id == "" {
			continue
		}
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		seen[id] = struct{}{}
		release := holder.AcquireModelAssetUse(id, "job:"+strings.TrimSpace(jobID))
		if release == nil {
			for _, prior := range releases {
				prior()
			}
			return nil, fmt.Errorf("captured ModelAsset %s was removed before Job publication", id)
		}
		releases = append(releases, release)
	}
	return releases, nil
}

// A declined duplicate must not remove paths still in use by the claimed executor.
// Terminal/canceled state is stable: no later startExecution can claim that Job.
func (s *scenarioJobStore) canCleanUnstartedLocalStaging(jobID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	record := s.jobs[strings.TrimSpace(jobID)]
	return record == nil || (record.job != nil && !record.executionStarted && (isTerminalScenarioJobStatus(record.job.GetStatus()) || record.cancelRequested))
}

func (s *scenarioJobStore) cancellationRequested(jobID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	record := s.jobs[jobID]
	// Immediate SYNC/STREAM calls still use their caller context. An admitted
	// asynchronous Job requires the explicit durable Cancel operation.
	return record != nil && (record.cancelRequested || isImmediateScenarioJob(record.job))
}

func (s *scenarioJobStore) startExecution(jobID string) bool {
	started := false
	var cleanup func()
	if err := s.withJobWorkAuthority(jobID, func() error { started, cleanup = s.startAuthorizedExecution(jobID); return nil }); err != nil {
		s.failJobWorkAuthority(jobID, err)
		return false
	}
	if cleanup != nil {
		cleanup()
	}
	return started
}

func (s *scenarioJobStore) startAuthorizedExecution(jobID string) (bool, func()) {
	id := strings.TrimSpace(jobID)
	if id == "" {
		return false, nil
	}
	s.mu.Lock()
	record, ok := s.jobs[id]
	if !ok || record == nil || record.job == nil || isTerminalScenarioJobStatus(record.job.GetStatus()) || record.cancelRequested || record.executionStarted || (record.payload != nil && record.payload.State != "retained") {
		s.mu.Unlock()
		return false, nil
	}

	record.executionStarted = true
	record.executionDone = make(chan struct{})
	s.mu.Unlock()
	return true, nil
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
	if record.job.GetExecutionMode() == runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB {
		previousJob := cloneScenarioJob(record.job)
		previousUpdated, previousTerminal := record.updatedAt, record.terminalAt
		previousRequested, previousReason := record.cancelRequested, record.cancelReason
		record.cancelRequested, record.cancelReason = true, strings.TrimSpace(reason)
		record.job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
		applyScenarioDispatchFacts(record)
		record.job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		record.job.ReasonDetail = record.cancelReason
		record.job.ReasonMetadata, record.job.Interruption = nil, nil
		now := time.Now().UTC()
		record.updatedAt, record.terminalAt = now, now
		record.job.UpdatedAt = timestamppb.New(now)
		err := s.retainTerminalMusicLocked(record)
		if err == nil {
			err = s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistCancellation, JobID: id, Status: record.job.GetStatus()})
		}
		if err != nil {
			record.job = previousJob
			record.updatedAt, record.terminalAt = previousUpdated, previousTerminal
			record.cancelRequested, record.cancelReason = previousRequested, previousReason
			s.mu.Unlock()
			return cloneScenarioJob(previousJob), false, err
		}
		record.pendingTerminal = nil
		// The local publication gate wins durably before signaling the worker.
		// Its resources remain owned until active use and protocol purposes end.
		if !record.doneClosed {
			record.doneClosed = true
			close(record.done)
		}
		s.publishLocked(record, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED)
		job, cancel := cloneScenarioJob(record.job), record.cancel
		var releases []func()
		var releaseWork func()
		if !record.executionStarted {
			releases = record.takeModelAssetUses()
			if record.localAppOwner != nil && record.localAppOwner.workPermit != nil {
				releaseWork = record.localAppOwner.workPermit.authority.Release
			}
		}
		s.mu.Unlock()
		if cancel != nil {
			cancel()
		}
		if releaseWork != nil {
			releaseWork()
		}
		runModelAssetReleases(releases)
		return job, true, nil
	}
	record.cancelRequested = true
	record.cancelReason = strings.TrimSpace(reason)
	record.job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
	record.job.ReasonDetail = record.cancelReason
	record.job.ReasonMetadata = nil
	nowTime := time.Now().UTC()
	record.updatedAt = nowTime
	record.job.UpdatedAt = timestamppb.New(nowTime)
	s.markDurableJobChangedLocked(id)
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
	if record.executionStarted && record.executionDone != nil {
		close(record.executionDone)
	}
	record.executionStarted = false
	cancel := record.cancel
	record.cancel = nil
	if record.cancelRequested && !isTerminalScenarioJobStatus(record.job.GetStatus()) {
		previousJob := cloneScenarioJob(record.job)
		previousUpdatedAt := record.updatedAt
		previousTerminalAt := record.terminalAt
		record.job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
		applyScenarioDispatchFacts(record)
		record.job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		record.job.ReasonDetail = record.cancelReason
		record.job.ReasonMetadata = nil
		nowTime := time.Now().UTC()
		record.updatedAt = nowTime
		record.terminalAt = nowTime
		record.job.UpdatedAt = timestamppb.New(nowTime)
		persistErr := s.retainTerminalMusicLocked(record)
		if persistErr == nil {
			persistErr = s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistCancellation, JobID: id, Status: record.job.GetStatus()})
		}
		if err := persistErr; err != nil {
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
	var releases []func()
	if isTerminalScenarioJobStatus(record.job.GetStatus()) {
		releases = record.takeModelAssetUses()
	}
	var releaseWork func()
	if record.localAppOwner != nil && record.localAppOwner.workPermit != nil {
		releaseWork = record.localAppOwner.workPermit.authority.Release
	}
	s.mu.Unlock()
	runModelAssetReleases(releases)
	if cancel != nil {
		cancel()
	}
	if releaseWork != nil {
		releaseWork()
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
	if !ok || scenarioJobPublicExpired(record, time.Now()) {
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

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-retention
func (s *scenarioJobStore) pruneJobsLocked(now time.Time) {
	var immediate, submitted []scenarioJobEvictionCandidate
	for jobID, record := range s.jobs {
		if record == nil || record.job == nil {
			s.deleteJobLocked(jobID)
			continue
		}
		if !isTerminalScenarioJobStatus(record.job.GetStatus()) {
			continue
		}
		if scenarioJobPublicExpired(record, now) {
			s.evictScenarioJobPubliclyLocked(jobID, record)
			continue
		}
		if hasMediaRecoveryReservation(record) {
			continue
		}
		candidate := scenarioJobEvictionCandidate{jobID: jobID, at: scenarioJobRecordTimestamp(record)}
		if isImmediateScenarioJob(record.job) {
			immediate = append(immediate, candidate)
		} else {
			submitted = append(submitted, candidate)
		}
	}
	s.evictOldestTerminalJobsLocked(immediate)
	s.evictOldestTerminalJobsLocked(submitted)
}

type scenarioJobEvictionCandidate struct {
	jobID string
	at    time.Time
}

// evictOldestTerminalJobsLocked applies the count bound within one delivery
// class only.
func (s *scenarioJobStore) evictOldestTerminalJobsLocked(terminal []scenarioJobEvictionCandidate) {
	if len(terminal) <= maxRetainedTerminalScenarioJobs {
		return
	}
	sort.Slice(terminal, func(i int, j int) bool {
		return terminal[i].at.Before(terminal[j].at)
	})
	for _, item := range terminal[:len(terminal)-maxRetainedTerminalScenarioJobs] {
		s.evictScenarioJobPubliclyLocked(item.jobID, s.jobs[item.jobID])
	}
}

func scenarioJobPublicExpired(record *scenarioJobRecord, now time.Time) bool {
	if record == nil || record.job == nil || record.publicEvicted {
		return true
	}
	if !isTerminalScenarioJobStatus(record.job.GetStatus()) {
		return false
	}
	retention := scenarioJobRetention
	if hasMediaRecoveryReservation(record) {
		retention = musicRecoveryRetention
	}
	terminal := scenarioJobRecordTimestamp(record)
	return !terminal.IsZero() && !now.Before(terminal.Add(retention))
}

func (s *scenarioJobStore) evictScenarioJobPubliclyLocked(id string, record *scenarioJobRecord) {
	if record == nil {
		return
	}
	record.publicEvicted = true
	s.markDurableJobChangedLocked(id)
	// Closing observation does not destroy late-receipt, active-use or cleanup
	// ownership. These private rows keep their original quota and timestamps.
	if record.executionStarted || record.nativeResult != nil || record.resultCandidate != nil || len(record.bodyArtifactIDs) > 0 || len(record.modelAssetUses) > 0 ||
		(record.cloudAssembly != nil && record.cloudAssembly.CredentialCustodyRef != "") ||
		(record.payload != nil && record.payload.State != "disposed") {
		return
	}
	s.deleteJobLocked(id)
}

func isImmediateScenarioJob(job *runtimev1.ScenarioJob) bool {
	switch job.GetExecutionMode() {
	case runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM:
		return true
	default:
		return false
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
	s.markDurableJobChangedLocked(jobID)
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

// claimPreparedEmbedding replaces only the in-process cancellation hook, never
// captured inputs. Restored interrupted jobs are terminal and cannot be claimed.
func (s *scenarioJobStore) claimPreparedEmbedding(ctx context.Context, id string) (context.Context, context.CancelFunc, error) {
	s.mu.Lock()
	record, ok := s.jobs[id]
	if !ok || record == nil || record.job == nil || record.job.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED || record.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED || record.cancelRequested || record.executionStarted || (record.payload != nil && record.payload.State != "retained") {
		s.mu.Unlock()
		return nil, nil, fmt.Errorf("captured Memory embedding Job is no longer executable")
	}
	jobCtx, cancel := context.WithCancel(ctx)
	oldCancel := record.cancel
	record.cancel = cancel
	record.executionStarted = true
	record.executionDone = make(chan struct{})
	s.mu.Unlock()
	if oldCancel != nil {
		oldCancel()
	}
	return jobCtx, cancel, nil
}
