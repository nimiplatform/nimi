package ai

import (
	"context"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"google.golang.org/protobuf/proto"
)

func cloneScenarioDispatch(value *bool) *bool {
	if value == nil {
		return nil
	}
	return proto.Bool(*value)
}
func scenarioDispatchKnownAbsent(value *bool) bool { return value != nil && !*value }

func (s *scenarioJobStore) dispatchMayHaveOccurred(id string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r := s.jobs[id]
	return r != nil && r.dispatchPossible != nil && *r.dispatchPossible
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-observation
// Absence is historical uncertainty. A present false is explicit new-Job
// evidence: the guarded transport has not crossed its durable intent point.
func validateScenarioDispatch(record *scenarioJobRecord) error {
	if record.dispatchPossible == nil {
		return nil
	}
	if record.job.GetExecutionMode() != runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB {
		return fmt.Errorf("dispatch evidence requires an ASYNC Job")
	}
	// A private complete result may retain the last public snapshot while its
	// final atomic publication is pending. Its full candidate is validated below.
	if *record.dispatchPossible && record.resultCandidate == nil && record.job.GetSubmissionOutcome() == runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_NOT_DISPATCHED {
		return fmt.Errorf("possible dispatch contradicts non-dispatch outcome")
	}
	if !*record.dispatchPossible && (record.nativeReceipt != nil || record.resultCandidate != nil || record.job.GetSubmissionOutcome() == runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED) {
		return fmt.Errorf("accepted execution contradicts non-dispatch evidence")
	}
	return nil
}
func (s *Service) scenarioJobOutboundContext(ctx context.Context, id string) context.Context {
	return remoteexecution.WithJobDispatchIntent(ctx, func(step context.Context) error { return s.scenarioJobs.markScenarioDispatchPossible(step, id) })
}
func (s *scenarioJobStore) markScenarioDispatchPossible(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.jobs[id]
	if r == nil || ctx.Err() != nil {
		return fmt.Errorf("Job dispatch admission is closed")
	}
	if r.dispatchPossible != nil && *r.dispatchPossible {
		return nil
	}
	if isTerminalScenarioJobStatus(r.job.GetStatus()) || r.cancelRequested || r.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING {
		return fmt.Errorf("Job dispatch admission is closed")
	}
	previous := r.dispatchPossible
	r.dispatchPossible = proto.Bool(true)
	if err := s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistDispatchIntent, JobID: id, Status: r.job.GetStatus()}); err != nil {
		r.dispatchPossible = previous
		return err
	}
	return nil
}
func applyScenarioDispatchFacts(record *scenarioJobRecord) {
	job := record.job
	if job.GetExecutionMode() != runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB {
		return
	}
	if job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || (job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING && job.GetRouteDecision() == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL) {
		record.dispatchPossible = proto.Bool(true)
	}
	if record.resultCandidate != nil && isTerminalScenarioJobStatus(job.GetStatus()) {
		job.SubmissionOutcome = runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED
	}
	if scenarioDispatchKnownAbsent(record.dispatchPossible) && isTerminalScenarioJobStatus(job.GetStatus()) && job.GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED {
		job.SubmissionOutcome = runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_NOT_DISPATCHED
	}
	if job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		setScenarioJobCancellationOutcome(job)
	}
}
