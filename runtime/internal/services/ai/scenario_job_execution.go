package ai

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *Service) executeScenarioAsyncJob(
	ctx context.Context,
	jobID string,
) {
	if !s.scenarioJobs.startExecution(jobID) {
		return
	}
	defer s.finishScenarioJobExecution(jobID)
	assembly, ok := s.scenarioJobs.cloudResolvedAssembly(jobID)
	if !ok {
		s.failScenarioJobPersistencePrecondition(jobID, "scenario-job-cloud-inputs-missing", nil)
		return
	}
	effective, err := s.cloudMediaEffectiveInputsFromResolvedAssembly(assembly)
	if err != nil {
		s.finishScenarioAsyncJobFailure(ctx, jobID, nil, err)
		return
	}
	defer effective.release()
	req := effective.request
	if _, ok, transitionErr := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED, nil); transitionErr != nil {
		s.failScenarioJobPersistencePrecondition(jobID, scenarioJobQueuedPersistenceFailedReason, transitionErr)
		return
	} else if !ok {
		return
	}
	release, err := s.acquireAsyncScenarioJobLease(ctx, req.GetHead().GetAppId(), "scenario_job_cloud_media")
	if err != nil {
		s.finishScenarioAsyncJobFailure(ctx, jobID, effective, err)
		return
	}
	defer release()
	if _, ok, transitionErr := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); transitionErr != nil {
		s.failScenarioJobPersistencePrecondition(jobID, scenarioJobRunningPersistenceFailedReason, transitionErr)
		return
	} else if !ok {
		return
	}

	result, err := s.executeCapturedCloudMedia(ctx, effective)
	if err != nil {
		s.finishScenarioAsyncJobFailure(ctx, jobID, effective, err)
		return
	}

	if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
		return
	}
	transcriptionText := ""
	artifacts, custodyErr := bindRuntimeJobArtifacts(jobID, req.GetHead(), result.Artifacts)
	var newCustodyIDs []string
	if custodyErr == nil {
		newCustodyIDs, custodyErr = s.storeRuntimeJobArtifacts(ctx, jobID, req.GetHead(), artifacts, result.ArtifactBodies)
	}
	if custodyErr == nil {
		transcriptionText, custodyErr = s.captureScenarioTranscriptionText(ctx, req.GetScenarioType(), artifacts)
	}
	if custodyErr != nil {
		capabilitydriver.CloseArtifactBodies(result.ArtifactBodies)
		for _, artifactID := range newCustodyIDs {
			s.deleteRuntimeArtifactCandidate(artifactID, "typed result capture failed")
		}
	}
	if custodyErr != nil {
		if _, ok, _ := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED, func(job *runtimev1.ScenarioJob) {
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
	if _, ok, _ := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(job *runtimev1.ScenarioJob) {
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
		job.TranscriptionText = transcriptionText
		job.Usage = result.Usage
	}); !ok {
		for _, artifactID := range newCustodyIDs {
			s.deleteRuntimeArtifactCandidate(artifactID, "job metadata attachment failed")
		}
		if s.logger != nil {
			s.logger.Warn("scenario job transition to COMPLETED failed", "job_id", jobID)
		}
	}
}

func (s *Service) finishScenarioAsyncJobFailure(ctx context.Context, jobID string, effective *cloudMediaEffectiveInputs, err error) {
	if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
		return
	}
	reasonCode := reasonCodeFromMediaError(err)
	if s.logger != nil && effective != nil && effective.request != nil {
		s.logger.Warn("scenario job execution failed",
			"job_id", jobID,
			"scenario_type", effective.request.GetScenarioType().String(),
			"model_resolved", strings.TrimSpace(effective.modelResolved()),
			"driver_dialect", strings.TrimSpace(effective.mapped.Adapter()),
			"reason_code", reasonCode.String(),
			"error", err,
		)
	}
	statusValue := runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
	eventType := runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) || reasonCode == runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		statusValue = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT
		eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT
		reasonCode = runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	} else if errors.Is(err, context.Canceled) || status.Code(err) == codes.Canceled {
		statusValue = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
		eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED
	}
	if _, ok, _ := s.transitionScenarioJob(jobID, statusValue, eventType, func(job *runtimev1.ScenarioJob) {
		job.ReasonCode = reasonCode
		job.ReasonDetail = sanitizeScenarioJobReasonDetail(err, reasonCode)
		job.ReasonMetadata = scenarioJobReasonMetadata(err, reasonCode)
		job.ProviderJobId = ""
		job.RetryCount = 0
		job.NextPollAt = nil
	}); !ok && s.logger != nil {
		s.logger.Warn("scenario job transition to terminal failed", "job_id", jobID, "status", statusValue.String())
	}
}

func (s *Service) captureScenarioTranscriptionText(ctx context.Context, scenarioType runtimev1.ScenarioType, artifacts []*runtimev1.ScenarioArtifact) (string, error) {
	if scenarioType != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE {
		return "", nil
	}
	for _, artifact := range artifacts {
		if artifact == nil || !strings.HasPrefix(strings.ToLower(strings.TrimSpace(artifact.GetMimeType())), "text/plain") {
			continue
		}
		if s == nil || s.runtimeArtifacts == nil || artifact.GetSizeBytes() <= 0 || artifact.GetSizeBytes() > maxLocalAppTranscriptionTextBytes {
			return "", fmt.Errorf("speech transcription result is not bounded UTF-8 text")
		}
		source, ok := s.runtimeArtifacts.Open(ctx, artifact.GetArtifactId())
		if !ok {
			return "", fmt.Errorf("speech transcription result custody is unavailable")
		}
		payload, err := io.ReadAll(io.LimitReader(source.Body, maxLocalAppTranscriptionTextBytes+1))
		closeErr := source.Body.Close()
		if err != nil || closeErr != nil || int64(len(payload)) != artifact.GetSizeBytes() {
			return "", fmt.Errorf("speech transcription result custody could not be read")
		}
		if len(payload) == 0 || len(payload) > maxLocalAppTranscriptionTextBytes || !utf8.Valid(payload) {
			return "", fmt.Errorf("speech transcription result is not bounded UTF-8 text")
		}
		text := strings.TrimSpace(string(payload))
		if text == "" || len([]byte(text)) > maxLocalAppTranscriptionTextBytes {
			return "", fmt.Errorf("speech transcription result is empty")
		}
		return text, nil
	}
	return "", fmt.Errorf("speech transcription result artifact is missing")
}
