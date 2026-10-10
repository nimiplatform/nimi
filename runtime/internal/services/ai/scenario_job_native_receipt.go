package ai

import (
	"context"
	"fmt"
	"google.golang.org/protobuf/proto"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-execution-scope
// The receipt is persisted with the original Job and never entered in a
// separate task registry. A late receipt can only update private ownership.
func (s *scenarioJobStore) bindNativeReceipt(jobID string, receipt *nimillm.NativeTaskReceipt, privateOnly ...bool) error {
	if err := nimillm.ValidateNativeTaskReceipt(receipt); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.jobs[strings.TrimSpace(jobID)]
	if r == nil || r.job == nil {
		return fmt.Errorf("native receipt has no original Job")
	}
	if r.job.GetExecutionMode() != runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB || r.job.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD || r.cloudAssembly == nil || r.cloudAssembly.CredentialCustodyRef == "" {
		return fmt.Errorf("native receipt has no captured Cloud Job owner")
	}
	if r.job.GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_UNKNOWN && r.job.GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED {
		return fmt.Errorf("native receipt has no durable possible-dispatch fact")
	}
	if r.nativeReceipt != nil && !nimillm.EqualNativeTaskReceipt(r.nativeReceipt, receipt) {
		return fmt.Errorf("native receipt changed original task identity")
	}
	previousDispatch := r.dispatchPossible
	previous := r.nativeReceipt
	previousPending := r.nativeReceiptPending
	priorJob := cloneScenarioJob(r.job)
	priorUpdated := r.updatedAt
	r.nativeReceipt = nimillm.CloneNativeTaskReceipt(receipt)
	r.nativeReceiptPending = false
	r.dispatchPossible = proto.Bool(true)
	if !isTerminalScenarioJobStatus(r.job.GetStatus()) && (len(privateOnly) == 0 || !privateOnly[0]) {
		r.job.SubmissionOutcome = runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED
		r.updatedAt = time.Now().UTC()
		r.job.UpdatedAt = timestamppb.New(r.updatedAt)
	}
	if err := s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistTransition, JobID: jobID, Status: r.job.GetStatus()}); err != nil {
		if previous != nil && !previousPending {
			r.nativeReceipt, r.nativeReceiptPending = previous, false
			r.dispatchPossible = previousDispatch
		} else {
			// Keep the received locator in this process without promising restart
			// recovery or reporting a durable acceptance. Never replay create.
			r.nativeReceiptPending = true
		}
		r.job = priorJob
		r.updatedAt = priorUpdated
		return err
	}
	return nil
}

func (s *scenarioJobStore) nativeReceiptNeedsPersistence(jobID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r := s.jobs[jobID]
	return r != nil && r.nativeReceiptPending
}

func (s *scenarioJobStore) originalNativeReceipt(jobID string) *nimillm.NativeTaskReceipt {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r := s.jobs[jobID]
	if r == nil || r.nativeReceipt == nil {
		return nil
	}
	return nimillm.CloneNativeTaskReceipt(r.nativeReceipt)
}

func validatePersistedNativeReceipt(record *scenarioJobRecord) error {
	if err := validateScenarioDispatch(record); err != nil {
		return err
	}
	if err := validateScenarioResultCandidate(record); err != nil {
		return err
	}
	if err := validateScenarioBodyIDs(record.bodyArtifactIDs); err != nil {
		return err
	}
	if len(record.bodyArtifactIDs) > 0 && record.job.GetExecutionMode() != runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB {
		return fmt.Errorf("Job body candidates require an ASYNC_JOB owner")
	}
	if err := validateNativeResult(record); err != nil {
		return err
	}
	if record.nativeReceipt == nil || record.nativeReceiptPending {
		return nil
	}
	if err := nimillm.ValidateNativeTaskReceipt(record.nativeReceipt); err != nil {
		return err
	}
	job := record.job
	if job.GetExecutionMode() != runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB || job.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD || record.cloudAssembly == nil {
		return fmt.Errorf("native receipt has no captured Cloud Job owner")
	}
	if job.GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED && !(isTerminalScenarioJobStatus(job.GetStatus()) && job.GetSubmissionOutcome() == runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_UNKNOWN) {
		return fmt.Errorf("native receipt disagrees with durable dispatch facts")
	}
	return nil
}

func validateNativeResult(record *scenarioJobRecord) error {
	result := record.nativeResult
	if result == nil {
		return nil
	}
	if len(result.Artifacts) < 1 || len(result.Artifacts) > 16 {
		return fmt.Errorf("native result has no original receipt or complete bounded output set")
	}
	finite := record.nativeReceipt == nil
	if finite {
		if record.cloudAssembly == nil || record.job.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD || record.job.GetExecutionMode() != runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB || record.job.GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED || len(result.WorldPayload) != 0 {
			return fmt.Errorf("finite result has no accepted captured Cloud Job")
		}
		request := &runtimev1.SubmitScenarioJobRequest{}
		if err := protojson.Unmarshal(record.cloudAssembly.Request, request); err != nil {
			return fmt.Errorf("finite result captured request is invalid: %w", err)
		}
		if len(result.Artifacts) != requiredScenarioBodyCount(request) {
			return fmt.Errorf("finite result does not contain its required output set")
		}
	}
	ids := map[string]bool{}
	for index, artifact := range result.Artifacts {
		expected := fmt.Sprintf("%s-result-%d", record.job.GetJobId(), index+1)
		if !finite {
			expected = record.nativeReceipt.Artifact.GetArtifactId()
		}
		if !finite && index > 0 {
			if (record.nativeReceipt.Adapter == nimillm.AdapterSpaitialNative || record.nativeReceipt.Adapter == nimillm.AdapterWorldLabsNative) && index == 1 {
				expected += "-bundle"
			} else {
				expected = fmt.Sprintf("%s-%d", expected, index)
			}
		}
		if artifact == nil || artifact.GetArtifactId() == "" || ids[artifact.GetArtifactId()] || artifact.GetMimeType() == "" || artifact.GetSizeBytes() < 0 || artifact.GetSizeBytes() > 8<<30 {
			return fmt.Errorf("invalid native output descriptor")
		}
		if artifact.GetArtifactId() != expected {
			return fmt.Errorf("native output changed original slot identity")
		}
		ids[artifact.GetArtifactId()] = true
		if finite && len(artifact.GetBytes()) > 0 {
			return fmt.Errorf("finite result body must occupy its owned private slot")
		}
		if len(result.WorldPayload) == 0 && len(artifact.GetBytes()) == 0 && artifact.GetUri() == "" && (!finite || artifact.GetSizeBytes() <= 0 || artifact.GetSha256() == "") {
			return fmt.Errorf("native output source missing")
		}
	}
	if len(result.WorldPayload) > 0 && (finite || (record.nativeReceipt.Adapter != nimillm.AdapterSpaitialNative && record.nativeReceipt.Adapter != nimillm.AdapterWorldLabsNative)) {
		return fmt.Errorf("World result disagrees with original protocol")
	}
	return nil
}

func (s *scenarioJobStore) currentNativeResult(jobID string) *nimillm.NativeTaskObservation {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if record := s.jobs[jobID]; record != nil {
		return nimillm.CloneNativeTaskObservation(record.nativeResult)
	}
	return nil
}

func (s *scenarioJobStore) stageNativeResult(ctx context.Context, jobID string, result *nimillm.NativeTaskObservation) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.jobs[jobID]
	if r == nil {
		return errNativeJobClaimLost
	}
	if err := validateNativeJobClaim(r, []context.Context{ctx}); err != nil {
		return err
	}
	if isTerminalScenarioJobStatus(r.job.GetStatus()) {
		return fmt.Errorf("Job result publication is closed")
	}
	previous := r.nativeResult
	if previous != nil {
		if len(previous.Artifacts) != len(result.Artifacts) {
			return fmt.Errorf("native refresh changed required set")
		}
		for i, artifact := range previous.Artifacts {
			if artifact.GetArtifactId() != result.Artifacts[i].GetArtifactId() {
				return fmt.Errorf("native refresh changed slot identity")
			}
		}
	}
	r.nativeResult = nimillm.CloneNativeTaskObservation(result)
	previousIDs := r.bodyArtifactIDs
	r.bodyArtifactIDs = nil
	for _, artifact := range result.Artifacts {
		r.bodyArtifactIDs = append(r.bodyArtifactIDs, artifact.GetArtifactId())
	}
	if r.job.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE {
		r.bodyArtifactIDs = append(r.bodyArtifactIDs, jobID+"-music-mix")
	}
	if err := validateNativeResult(r); err != nil {
		r.nativeResult = previous
		r.bodyArtifactIDs = previousIDs
		return err
	}
	if err := s.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistTransition, JobID: jobID, Status: r.job.GetStatus()}); err != nil {
		r.nativeResult = previous
		r.bodyArtifactIDs = previousIDs
		return err
	}
	return nil
}

// A late receipt remains owned after true authority withdrawal, but it cannot
// publish a newly accepted result or continue the revoked work.
func (s *Service) publishScenarioNativeReceipt(jobID string, receipt *nimillm.NativeTaskReceipt) error {
	entered := false
	err := s.scenarioJobs.withJobWorkAuthority(jobID, func() error { entered = true; return s.scenarioJobs.bindNativeReceipt(jobID, receipt) })
	if entered || err == nil {
		return err
	}
	s.scenarioJobs.failJobWorkAuthority(jobID, err)
	return s.scenarioJobs.bindNativeReceipt(jobID, receipt, true)
}
