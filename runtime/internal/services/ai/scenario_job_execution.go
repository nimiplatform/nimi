package ai

import (
	"context"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *Service) executeScenarioAsyncJob(
	ctx context.Context,
	jobID string,
	effective *cloudMediaEffectiveInputs,
) {
	if effective == nil || effective.request == nil {
		return
	}
	req := effective.request
	if _, ok := s.scenarioJobs.transition(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED, nil); !ok {
		return
	}
	if _, ok := s.scenarioJobs.transition(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); !ok && s.logger != nil {
		s.logger.Warn("scenario job transition to RUNNING failed", "job_id", jobID)
	}

	result, err := s.executeCapturedCloudMedia(ctx, effective)
	if err != nil {
		if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
			return
		}
		reasonCode := reasonCodeFromMediaError(err)
		if s.logger != nil {
			s.logger.Warn("scenario job execution failed",
				"job_id", jobID,
				"scenario_type", req.GetScenarioType().String(),
				"model_resolved", strings.TrimSpace(effective.modelResolved()),
				"driver_dialect", strings.TrimSpace(effective.mapped.Adapter()),
				"reason_code", reasonCode.String(),
				"error", err,
			)
		}
		statusValue := runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
		eventType := runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED
		if errors.Is(err, context.Canceled) || status.Code(err) == codes.Canceled {
			statusValue = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
			eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED
		} else if reasonCode == runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
			statusValue = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT
			eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT
		}
		if _, ok := s.scenarioJobs.transition(jobID, statusValue, eventType, func(job *runtimev1.ScenarioJob) {
			job.ReasonCode = reasonCode
			job.ReasonDetail = sanitizeScenarioJobReasonDetail(err, reasonCode)
			job.ReasonMetadata = scenarioJobReasonMetadata(err, reasonCode)
			job.ProviderJobId = ""
			job.RetryCount = 0
			job.NextPollAt = nil
		}); !ok && s.logger != nil {
			s.logger.Warn("scenario job transition to terminal failed", "job_id", jobID, "status", statusValue.String())
		}
		return
	}

	if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
		return
	}
	artifacts, custodyErr := bindRuntimeJobArtifacts(jobID, req.GetHead(), result.Artifacts)
	if custodyErr == nil {
		custodyErr = s.storeRuntimeJobArtifacts(jobID, req.GetHead(), artifacts)
	}
	if custodyErr != nil {
		if _, ok := s.scenarioJobs.transition(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED, func(job *runtimev1.ScenarioJob) {
			job.ProviderJobId = ""
			job.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
			job.ReasonDetail = "Runtime artifact custody failed"
			job.ReasonMetadata = nil
			job.RetryCount = 0
			job.NextPollAt = nil
		}); !ok && s.logger != nil {
			s.logger.Warn("scenario job transition to FAILED after artifact custody failure failed", "job_id", jobID, "error", custodyErr)
		}
		return
	}
	if _, ok := s.scenarioJobs.transition(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(job *runtimev1.ScenarioJob) {
		job.ScenarioType = req.GetScenarioType()
		job.ExecutionMode = runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB
		// Provider polling identifiers remain Remote Host private. Runtime's
		// public terminal projection is bound by its own job id and artifacts.
		job.ProviderJobId = ""
		job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		job.ReasonDetail = ""
		job.ReasonMetadata = nil
		job.RetryCount = 0
		job.NextPollAt = nil
		if job.GetProgressTotalSteps() > 0 {
			job.ProgressCurrentStep = job.GetProgressTotalSteps()
		}
		job.ProgressPercent = 100
		job.Artifacts = cloneScenarioArtifacts(artifacts)
		job.Usage = result.Usage
	}); !ok && s.logger != nil {
		s.logger.Warn("scenario job transition to COMPLETED failed", "job_id", jobID)
	}
}
