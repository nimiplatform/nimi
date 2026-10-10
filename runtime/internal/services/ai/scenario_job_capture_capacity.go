package ai

import (
	"context"
	"errors"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
)

type scenarioCaptureRowKey struct{}

// A not-yet-published capture participates in current record and task limits.
// It is never a second durable Job ledger: publication consumes it by Job ID,
// and an aborted capture releases it after its local cleanup has returned.
func (s *scenarioJobStore) captureRowScope(ctx context.Context, job *runtimev1.ScenarioJob) (context.Context, func()) {
	return context.WithValue(ctx, scenarioCaptureRowKey{}, job), func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if r := s.captureRows[job.GetJobId()]; r != nil && s.jobs[job.GetJobId()] == nil {
			r.captureAborted = true
			if !s.cleanupCaptureRowLocked(job.GetJobId(), r) {
				return
			}
		}
		delete(s.captureRows, job.GetJobId())
	}
}

// Local planning has already fixed every serialized field, including exact
// source facts, dependency identities, paths and process arguments. Only the
// physical range copy remains. Check the current captured row before copying;
// publication checks its final actual encoding again.
// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-admission
func (s *Service) admitPlannedLocalCapture(ctx context.Context, selected *localexecution.SelectedLocalExecution, assembly *localResolvedAssembly, identity *runtimev1.LoadoutEffectiveInputIdentity, bodySets ...[]runtimeartifact.JobBodySlot) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	draft, _ := ctx.Value(scenarioCaptureRowKey{}).(*runtimev1.ScenarioJob)
	if draft == nil {
		return nil
	} // Non-Job callers do not own a Job capture row.
	job := cloneScenarioJob(draft)
	job.ModelResolved = selected.DisplayName
	if job.ModelResolved == "" {
		job.ModelResolved = selected.LoadoutID
	}
	job.EffectiveInputIdentity = cloneLoadoutEffectiveInputIdentity(identity)
	record := &scenarioJobRecord{job: job, resolvedAssembly: assembly, localAppOwner: cloneLocalAppJobOwner(localAppJobOwnerFromContext(ctx)), musicSubmission: cloneLocalAppMusicSubmission(localAppMusicSubmissionFromContext(ctx)), createdAt: job.GetCreatedAt().AsTime(), updatedAt: job.GetUpdatedAt().AsTime()}
	var slots []runtimeartifact.JobBodySlot
	if len(bodySets) > 0 {
		slots = bodySets[0]
		for _, slot := range slots {
			record.bodyArtifactIDs = append(record.bodyArtifactIDs, slot.ArtifactID)
		}
	}
	return s.admitScenarioCaptureRow(record, slots)
}

func (s *Service) admitScenarioCaptureRow(record *scenarioJobRecord, slots []runtimeartifact.JobBodySlot) error {
	job := record.job
	s.scenarioJobs.mu.Lock()
	defer s.scenarioJobs.mu.Unlock()
	store := s.scenarioJobs
	for id, r := range store.captureRows {
		if r.captureAborted && store.cleanupCaptureRowLocked(id, r) {
			delete(store.captureRows, id)
		}
	}
	if store.captureRows[job.JobId] != nil || store.jobs[job.JobId] != nil {
		return fmt.Errorf("capture identity already owns a row")
	}
	if err := store.admitJobCapacityLocked(record); err != nil {
		return scenarioJobSubmissionError(err, "Capture row could not be admitted")
	}
	if store.captureRows == nil {
		store.captureRows = map[string]*scenarioJobRecord{}
	}
	store.captureRows[job.JobId] = record
	if store.durablePath != "" && !store.durable.current {
		// Establish the original writer before any pre-publication body exists.
		// After a crash, absence from this complete baseline is usable evidence.
		if err := store.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistMaintenance}); err != nil {
			return err
		}
	}
	if len(slots) > 0 {
		owner, ok := s.runtimeArtifacts.(runtimeartifact.JobBodyStore)
		if !ok {
			return fmt.Errorf("capture body custody is unavailable")
		}
		store.jobBodies = owner
		if err := owner.PrepareJobBodies(job.JobId, s.runtimeArtifactOwnerForJobRecord(record), slots); err != nil {
			if errors.Is(err, runtimeartifact.ErrJobBodyCapacity) {
				return jobCapacityError(err)
			}
			return err
		}
	}
	return nil
}

// Cloud mapping fixes the current row before taking credential custody.
// Include its deterministic custody identity in ordinary admission checks;
// no future result or control allowance is promised.
func (s *Service) admitPlannedCloudCapture(ctx context.Context, job *runtimev1.ScenarioJob, assembly *cloudResolvedAssembly, submission *localAppMusicSubmission) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.scenarioJobs.mu.RLock()
	reserved := s.scenarioJobs.captureRows[job.GetJobId()] != nil
	s.scenarioJobs.mu.RUnlock()
	if reserved {
		return func() {}, nil
	}
	ref, err := connector.CredentialCustodyRefForJob(job.GetJobId())
	if err != nil {
		return nil, err
	}
	planned, err := cloneCloudResolvedAssembly(assembly)
	if err != nil {
		return nil, err
	}
	planned.CredentialCustodyRef = ref
	record := &scenarioJobRecord{job: cloneScenarioJob(job), cloudAssembly: planned, localAppOwner: cloneLocalAppJobOwner(localAppJobOwnerFromContext(ctx)), musicSubmission: cloneLocalAppMusicSubmission(submission), createdAt: job.GetCreatedAt().AsTime(), updatedAt: job.GetUpdatedAt().AsTime()}
	_, release := s.scenarioJobs.captureRowScope(ctx, job)
	if err := s.admitScenarioCaptureRow(record, nil); err != nil {
		release()
		return nil, err
	}
	return release, nil
}

// A published row replaces its transient capture under the same writer lock.
func (s *scenarioJobStore) capacityRecordsLocked() []*scenarioJobRecord {
	records := make([]*scenarioJobRecord, 0, len(s.jobs)+len(s.captureRows))
	for _, r := range s.jobs {
		records = append(records, r)
	}
	for id, r := range s.captureRows {
		if s.jobs[id] == nil {
			records = append(records, r)
		}
	}
	return records
}

func localCanonicalCaptureError(err error) error {
	return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
}

func (s *scenarioJobStore) cleanupCaptureRowLocked(id string, r *scenarioJobRecord) bool {
	if len(r.bodyArtifactIDs) == 0 {
		return true
	}
	if s.jobBodies == nil {
		return false
	}
	for _, body := range r.bodyArtifactIDs {
		if err := s.jobBodies.DeleteJobBody(id, body); err != nil {
			return false
		}
	}
	return true
}
