package ai

import (
	"context"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
)

func pikaInputCleanupPending(r *scenarioJobRecord) bool {
	return r != nil && r.cloudAssembly != nil && r.cloudAssembly.Connector.Provider == "pika" && len(r.pikaUploads) > 0 && r.inputCleanup == nil && isTerminalScenarioJobStatus(r.job.GetStatus()) && (r.nativeReceipt != nil || scenarioDispatchKnownAbsent(r.dispatchPossible))
}
func (s *scenarioJobStore) pikaInputCleanupPending(jobID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return pikaInputCleanupPending(s.jobs[jobID])
}

func (s *scenarioJobStore) pikaInputReleaseKnown(jobID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r := s.jobs[jobID]
	if r == nil {
		return false
	}
	return scenarioDispatchKnownAbsent(r.dispatchPossible) || r.job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || r.job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED && r.job.GetStopOutcome() == runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_CONFIRMED
}

// A cleanup query may refine only private storage disposition. It must never
// revive a terminal Job, publish an output, or reuse historical App authority.
func (s *Service) cleanupPikaJobInputs(ctx context.Context, jobID string, effective *cloudMediaEffectiveInputs, released bool) nimillm.InputCleanupResult {
	none := nimillm.InputCleanupResult{State: "not_required", ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}
	if effective == nil || effective.target.Provider() != "pika" {
		return none
	}
	uploads := s.scenarioJobs.currentPikaUploads(jobID)
	if len(uploads) == 0 {
		return none
	}
	if previous := s.scenarioJobs.currentInputCleanup(jobID); previous != nil {
		return *previous
	}
	result := nimillm.InputCleanupResult{State: "unconfirmed", Unconfirmed: len(uploads), ReasonCode: runtimev1.ReasonCode_AI_MEDIA_STORAGE_CLEANUP_UNCONFIRMED}
	host, ok := s.remoteMediaHost.(remoteexecution.PikaInputCleanupHost)
	if !ok {
		return result
	}
	released = released || s.scenarioJobs.pikaInputReleaseKnown(jobID)
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 20*time.Second)
	defer cancel()
	result, disposed := host.CleanupPikaInputUploads(cleanup, effective.connector, effective.target, uploads, s.scenarioJobs.originalNativeReceipt(jobID), released, effective.dispatchAudit())
	if !disposed {
		return result
	}
	if err := s.scenarioJobs.recordInputCleanup(jobID, result); err != nil {
		s.logScenarioJobPersistenceFailure("Pika input cleanup disposition could not be persisted", "job_id", jobID, "error", err)
		result.State = "unconfirmed"
		result.ReasonCode = runtimev1.ReasonCode_AI_MEDIA_STORAGE_CLEANUP_UNCONFIRMED
	}
	return result
}

func (s *Service) cleanupPikaExecutionExit(ctx context.Context, jobID string, effective *cloudMediaEffectiveInputs) {
	if s.scenarioJobs.pikaInputCleanupPending(jobID) {
		s.cleanupPikaJobInputs(ctx, jobID, effective, false)
	}
}
