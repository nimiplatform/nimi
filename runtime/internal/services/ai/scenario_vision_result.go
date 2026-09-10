package ai

import (
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func cloneVisionLocateResult(value *runtimev1.VisionLocateResult) *runtimev1.VisionLocateResult {
	if value == nil {
		return nil
	}
	return proto.Clone(value).(*runtimev1.VisionLocateResult)
}

func validateScenarioJobTerminalResults(record *scenarioJobRecord) error {
	if err := validateScenarioJobVoiceResultPair(record.job, record.voiceAsset, record.voiceReference); err != nil {
		return err
	}
	return validateScenarioJobVisionResult(record.job, record.resolvedAssembly, record.visionLocate)
}

// @nimi-authority: rule.nimi.runtime.service-operations.r036
func validateScenarioJobVisionResult(job *runtimev1.ScenarioJob, assembly *localResolvedAssembly, result *runtimev1.VisionLocateResult) error {
	completed := job.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_VISION_LOCATE && job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED
	if !completed {
		if result != nil {
			return fmt.Errorf("Locate result is not consistent with its Job state")
		}
		return nil
	}
	if result == nil || assembly == nil || assembly.LoadPlan.Vision == nil || len(job.GetArtifacts()) != 0 {
		return fmt.Errorf("completed Locate Job requires its sole typed result")
	}
	spec := &runtimev1.VisionLocateScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, spec); err != nil {
		return err
	}
	return localexecution.ValidateVisionLocateResult(result, spec, assembly.LoadPlan.Vision.Width, assembly.LoadPlan.Vision.Height)
}

func (s *scenarioJobStore) completedVisionResult(jobID string) (*runtimev1.VisionLocateResult, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	record := s.jobs[jobID]
	if record == nil || record.visionLocate == nil || validateScenarioJobVisionResult(record.job, record.resolvedAssembly, record.visionLocate) != nil {
		return nil, false
	}
	return cloneVisionLocateResult(record.visionLocate), true
}

func (s *Service) completeVisionScenarioJob(jobID string, result *runtimev1.VisionLocateResult) error {
	var err error
	for attempt := 1; attempt <= maxScenarioJobTerminalPersistenceAttempts; attempt++ {
		_, _, err = s.scenarioJobs.transitionWithResults(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, nil, nil, result, func(job *runtimev1.ScenarioJob) {
			job.ProgressPercent = 100
			job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
			job.ReasonDetail = ""
		})
		if err == nil {
			return nil
		}
		s.logScenarioJobPersistenceFailure("Locate Job result persistence failed", "job_id", jobID, "attempt", attempt, "error", err)
	}
	s.scenarioJobs.forceFailedInMemory(jobID, scenarioJobTerminalPersistenceFailedReason)
	return err
}
