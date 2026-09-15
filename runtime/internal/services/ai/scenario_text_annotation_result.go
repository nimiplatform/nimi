package ai

import (
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func (s *Service) SetLocalTextAnnotationExecutionHost(host localexecution.TextAnnotationExecutionHost) {
	if s != nil {
		s.localAnnotationHost = host
	}
}

func cloneTextAnnotationResult(value *runtimev1.TextAnnotationResult) *runtimev1.TextAnnotationResult {
	if value == nil {
		return nil
	}
	return proto.Clone(value).(*runtimev1.TextAnnotationResult)
}

func validateScenarioJobAnnotationResult(job *runtimev1.ScenarioJob, assembly *localResolvedAssembly) error {
	completed := job.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_ANNOTATE && job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED
	if !completed {
		if job.GetTextAnnotation() != nil {
			return fmt.Errorf("annotation result is inconsistent with its Job state")
		}
		return nil
	}
	if assembly == nil || assembly.LoadPlan.Annotation == nil || len(job.GetArtifacts()) != 0 {
		return fmt.Errorf("completed annotation Job requires its captured input and sole typed result")
	}
	spec := &runtimev1.TextAnnotateScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, spec); err != nil {
		return err
	}
	return localexecution.ValidateTextAnnotationResult(job.GetTextAnnotation(), spec)
}

func (s *Service) completeAnnotationScenarioJob(jobID string, result *runtimev1.TextAnnotationResult) error {
	var err error
	for attempt := 1; attempt <= maxScenarioJobTerminalPersistenceAttempts; attempt++ {
		_, _, err = s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(job *runtimev1.ScenarioJob) {
			job.TextAnnotation = cloneTextAnnotationResult(result)
			job.ProgressPercent = 100
			job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
			job.ReasonDetail = ""
		})
		if err == nil {
			return nil
		}
		s.logScenarioJobPersistenceFailure("Annotation Job result persistence failed", "job_id", jobID, "attempt", attempt, "error", err)
	}
	s.scenarioJobs.forceFailedInMemory(jobID, scenarioJobTerminalPersistenceFailedReason)
	return err
}
