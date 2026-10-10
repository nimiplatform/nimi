package ai

import (
	"context"
	"errors"
	"fmt"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type nativeJobClaimKey struct{}
type nativeJobClaim struct {
	jobID   string
	version uint64
}

var errNativeJobClaimLost = errors.New("native Job work claim is no longer current")

func scenarioNativeObservationAllowed(job *runtimev1.ScenarioJob) bool {
	return !isTerminalScenarioJobStatus(job.GetStatus()) ||
		(job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED && job.GetStopOutcome() == runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_UNCONFIRMED)
}

// Called under the existing writer mutex at mutation, not as a preflight.
func validateNativeJobClaim(record *scenarioJobRecord, work []context.Context) error {
	var claim *nativeJobClaim
	if len(work) > 0 {
		claim, _ = work[0].Value(nativeJobClaimKey{}).(*nativeJobClaim)
	}
	if claim == nil {
		return nil
	}
	if !record.executionStarted || !record.nativeObservation || record.job.GetJobId() != claim.jobID || record.nativeWorkVersion != claim.version {
		return errNativeJobClaimLost
	}
	return nil
}

// A Get may admit one finite original-task observation. Its caller can detach
// without cancelling the admitted work; an in-flight claim prevents a second
// Get from starting another query or transfer.
func (s *Service) observeScenarioNativeJob(ctx context.Context, jobID string) error {
	if s.scenarioJobs.originalNativeReceipt(jobID) == nil && s.scenarioJobs.currentNativeResult(jobID) == nil && !s.scenarioJobs.hasResultCandidate(jobID) {
		return nil
	}
	admitted, releaseUnused, err := s.admitJobSubmissionWork(ctx)
	if err != nil {
		return err
	}
	defer releaseUnused()
	work, cancel := context.WithCancel(newDetachedAsyncJobContext(admitted))
	permit := jobWorkPermitFromContext(admitted)
	var version uint64
	claim := func() error {
		s.scenarioJobs.mu.Lock()
		defer s.scenarioJobs.mu.Unlock()
		r := s.scenarioJobs.jobs[jobID]
		if r == nil || r.executionStarted || r.pendingTerminal != nil || (r.nativeReceipt == nil && r.nativeResult == nil && r.resultCandidate == nil) || scenarioJobPublicExpired(r, time.Now()) || !scenarioNativeObservationAllowed(r.job) {
			return nil
		}
		if r.nativeReceipt == nil && isTerminalScenarioJobStatus(r.job.GetStatus()) {
			return nil
		}
		machine, owner := 0, 0
		for _, current := range s.scenarioJobs.jobs {
			if current != nil && current.executionStarted && current.nativeObservation {
				machine++
				if jobCapacityOwner(current) == jobCapacityOwner(r) {
					owner++
				}
			}
		}
		if machine >= 8 || owner >= 2 {
			r.observationIssue = &runtimev1.ScenarioJobObservationIssue{ReasonCode: reasonCodeFromMediaError(jobCapacityError(errScenarioJobCapacity)), ObservedAt: timestamppb.Now()}
			return nil
		}
		r.nativeWorkVersion++
		if r.nativeWorkVersion == 0 {
			return fmt.Errorf("native work generation exhausted")
		}
		version = r.nativeWorkVersion
		r.nativeObservation, r.executionStarted = true, true
		r.executionDone = make(chan struct{})
		r.cancel = cancel
		if permit != nil {
			permit.jobID = jobID
			permit.adopted.Store(true)
			r.localAppOwner.workPermit = permit
		}
		return nil
	}
	if permit != nil {
		err = permit.authority.WithCurrent(ctx, claim)
	} else {
		err = claim()
	}
	if err != nil || version == 0 {
		cancel()
		return err
	}
	work = context.WithValue(work, nativeJobClaimKey{}, &nativeJobClaim{jobID: jobID, version: version})
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer s.finishScenarioJobExecution(jobID)
		s.runNativeObservation(work, jobID, version)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Service) runNativeObservation(ctx context.Context, jobID string, version uint64) {
	if s.scenarioJobs.hasResultCandidate(jobID) {
		job, _ := s.scenarioJobs.get(jobID)
		if !isTerminalScenarioJobStatus(job.GetStatus()) {
			s.setNativeObservationIssue(jobID, version, s.commitScenarioResultCandidate(ctx, jobID))
			return
		}
	}
	if s.scenarioJobs.nativeReceiptNeedsPersistence(jobID) {
		if err := s.publishScenarioNativeReceipt(jobID, s.scenarioJobs.originalNativeReceipt(jobID)); err != nil {
			s.setNativeObservationIssue(jobID, version, err)
			return
		}
	}

	host, ok := s.remoteMediaHost.(remoteexecution.NativeTaskHost)
	if !ok {
		s.setNativeObservationIssue(jobID, version, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE))
		return
	}
	assembly, exists := s.scenarioJobs.cloudResolvedAssembly(jobID)
	if !exists {
		s.setNativeObservationIssue(jobID, version, fmt.Errorf("original captured input is unavailable"))
		return
	}
	effective, err := s.cloudMediaEffectiveInputsFromResolvedAssembly(assembly)
	if err != nil {
		s.setNativeObservationIssue(jobID, version, err)
		return
	}
	defer effective.release()
	if job, ok := s.scenarioJobs.get(jobID); ok && job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		s.runNativeStopObservation(ctx, jobID, version, effective)
		return
	}
	response := s.scenarioJobs.currentNativeResult(jobID)
	previousResult := response
	receipt := s.scenarioJobs.originalNativeReceipt(jobID)
	refresh := receipt != nil && (response == nil || !s.nativeBodiesComplete(jobID, response))
	if receipt == nil && response == nil {
		s.setNativeObservationIssue(jobID, version, fmt.Errorf("original result is unavailable"))
		return
	}
	if refresh {
		query, cancelQuery := context.WithTimeout(ctx, 30*time.Second)
		observed, terminal, err := host.ObserveNativeTask(query, effective.connector, effective.target, s.scenarioJobs.originalNativeReceipt(jobID), effective.dispatchAudit())
		cancelQuery()
		if err != nil {
			if terminal && previousResult == nil {
				s.finishScenarioAsyncJobFailure(ctx, jobID, effective, err)
			} else {
				s.setNativeObservationIssue(jobID, version, err)
			}
			return
		}
		s.setNativeObservationIssue(jobID, version, nil)
		if !terminal {
			return
		}
		response = observed
	}
	required := 1
	if effective.request.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE {
		required = 2
	}
	if spec := effective.request.GetSpec().GetImageGenerate(); spec != nil && spec.GetN() > 0 {
		required = int(spec.GetN())
	}
	if spec := effective.request.GetSpec().GetVideoGenerate(); spec != nil && spec.GetOptions().GetReturnLastFrame() {
		required++
	}
	if len(response.Artifacts) != required {
		s.setNativeObservationIssue(jobID, version, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		return
	}
	if refresh {
		// An original-task query may renew locators for missing bodies. Already
		// complete slots retain the exact descriptor paired with their bytes.
		if previousResult != nil {
			if err := s.preserveCompleteNativeSlots(jobID, previousResult, response); err != nil {
				s.setNativeObservationIssue(jobID, version, err)
				return
			}
		}
		if err := s.scenarioJobs.withJobWorkAuthority(jobID, func() error { return s.scenarioJobs.stageNativeResult(ctx, jobID, response) }); err != nil {
			s.setNativeObservationIssue(jobID, version, err)
			return
		}
	}
	transport, err := s.prepareNativeBodies(ctx, jobID, effective, host, response)
	if err != nil {
		s.setNativeObservationIssue(jobID, version, err)
		return
	}
	defer capabilitydriver.CloseArtifactBodies(transport.ArtifactBodies)
	result, err := effective.driver.NormalizeResponse(transport)
	if err == nil {
		err = s.commitScenarioAsyncJobResult(context.WithValue(ctx, preparedScenarioBodiesKey{}, jobID), jobID, effective, result)
	}

	s.setNativeObservationIssue(jobID, version, err)
}

func (s *Service) runNativeStopObservation(ctx context.Context, jobID string, version uint64, effective *cloudMediaEffectiveInputs) {
	host, ok := s.remoteMediaHost.(remoteexecution.NativeTaskStopHost)
	if !ok {
		return
	}
	stop, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	outcome, err := host.StopNativeTask(stop, effective.connector, effective.target, s.scenarioJobs.originalNativeReceipt(jobID), effective.dispatchAudit())
	if outcome == nimillm.ProviderTaskCleanupCanceled && err == nil {
		err = s.scenarioJobs.withJobWorkAuthority(jobID, func() error {
			return s.scenarioJobs.confirmNativeStop(ctx, jobID)
		})
	}
	s.setNativeObservationIssue(jobID, version, err)
}

// Stop proof refines the existing terminal fact. It cannot replace its cause,
// reopen publication, refresh its terminal time or renew public retention.
func (s *scenarioJobStore) confirmNativeStop(ctx context.Context, jobID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.jobs[jobID]
	if r == nil {
		return errNativeJobClaimLost
	}
	if err := validateNativeJobClaim(r, []context.Context{ctx}); err != nil {
		return err
	}
	if r.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || r.nativeReceipt == nil {
		return nil
	}
	previous := r.job.StopOutcome
	previousSubmission := r.job.SubmissionOutcome
	// A fresh original-task stop proof can refine an earlier UNKNOWN Cancel
	// after its late receipt was retained privately. The terminal cause and
	// clocks remain fixed; only now-proved common facts become definite.
	r.job.SubmissionOutcome = runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED
	r.job.StopOutcome = runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_CONFIRMED
	if err := s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistTransition, JobID: jobID, Status: r.job.GetStatus()}); err != nil {
		r.job.StopOutcome = previous
		r.job.SubmissionOutcome = previousSubmission
		return err
	}
	return nil
}

func (s *Service) setNativeObservationIssue(jobID string, version uint64, err error) {
	s.scenarioJobs.mu.Lock()
	defer s.scenarioJobs.mu.Unlock()
	r := s.scenarioJobs.jobs[jobID]
	if r == nil || !r.executionStarted || r.nativeWorkVersion != version {
		return
	}
	r.observationIssue = nil
	if err != nil {
		reason := reasonCodeFromMediaError(err)
		if reason == runtimev1.ReasonCode_ACTION_EXECUTED {
			reason = runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
		}
		r.observationIssue = &runtimev1.ScenarioJobObservationIssue{ReasonCode: reason, ObservedAt: timestamppb.Now()}
	}
}

func (s *scenarioJobStore) currentObservationIssue(jobID string) *runtimev1.ScenarioJobObservationIssue {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r := s.jobs[jobID]
	if r == nil || r.observationIssue == nil {
		return nil
	}
	return proto.Clone(r.observationIssue).(*runtimev1.ScenarioJobObservationIssue)
}
