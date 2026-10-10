package ai

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
)

func (s *Service) executeScenarioAsyncJob(
	ctx context.Context,
	jobID string,
) {
	if !s.scenarioJobs.startExecution(jobID) {
		return
	}
	ctx = s.scenarioJobOutboundContext(ctx, jobID)
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
	native := nimillm.MediaUsesNativeTask(effective.mapped.Adapter(), req, effective.mapped.ProviderModelID())
	var bodySlots []runtimeartifact.JobBodySlot
	if !native {
		bodySlots, err = s.prepareFiniteMediaBodies(ctx, jobID, req)
		if err != nil {
			if errors.Is(err, runtimeartifact.ErrJobBodyCapacity) {
				err = jobCapacityError(err)
			}
			s.finishScenarioAsyncJobFailure(ctx, jobID, effective, err)
			return
		}
	}
	budget := newScenarioJobExecutionBudget(ctx)
	ctx = budget
	defer budget.close()
	duration := 5 * time.Minute
	if effective.mapped.Adapter() == "elevenlabs_music_adapter" && effective.mapped.ProviderModelID() == "music_v2" {
		duration = 10 * time.Minute
	}
	if err := budget.start(duration); err != nil {
		s.finishScenarioAsyncJobFailure(ctx, jobID, effective, err)
		return
	}
	if _, ok, transitionErr := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); transitionErr != nil {
		s.failScenarioJobPersistencePrecondition(jobID, scenarioJobRunningPersistenceFailedReason, transitionErr)
		return
	} else if !ok {
		return
	}

	ctx = nimillm.WithNativeTaskPublisher(ctx, func(receipt *nimillm.NativeTaskReceipt) error {
		if !native {
			return fmt.Errorf("unexpected native receipt for a finite captured protocol")
		}
		if receipt.Adapter != effective.mapped.Adapter() {
			return fmt.Errorf("native receipt does not match the frozen Driver")
		}
		return s.publishScenarioNativeReceipt(jobID, receipt)
	})
	if !native {
		ctx = nimillm.WithFiniteMediaResultOwner(ctx, func(artifacts []*runtimev1.ScenarioArtifact, usage *runtimev1.UsageStats) error {
			return s.retainFiniteScenarioResult(ctx, jobID, req.GetHead(), bodySlots, artifacts, usage)
		})
	}
	result, err := s.executeCapturedCloudMedia(ctx, effective)
	budget.stop()
	if errors.Is(err, nimillm.ErrFiniteMediaResultOwned) {
		// RS work continues autonomously. A failed acquisition is retained for
		// a later Get, without replaying the completed generating request.
		s.runNativeObservation(ctx, jobID, 0)
		return
	}
	if errors.Is(err, nimillm.ErrNativeTaskYielded) {
		return
	}
	if err != nil {
		if native && s.scenarioJobs.originalNativeReceipt(jobID) != nil {
			s.setNativeObservationIssue(jobID, 0, err)
			return
		}
		if native && ctx.Err() == nil && nimillm.IsNativeCreateResponseUnavailable(err) && s.scenarioJobs.dispatchMayHaveOccurred(jobID) {
			// A lost acknowledgement says nothing definitive about the original
			// provider execution. Keep UNKNOWN locally controllable without a
			// locator search, another create, or an invented terminal event.
			if authorityErr := s.scenarioJobs.withJobWorkAuthority(jobID, func() error { return nil }); authorityErr != nil {
				s.scenarioJobs.failJobWorkAuthority(jobID, authorityErr)
				return
			}
			s.setNativeObservationIssue(jobID, 0, err)
			return
		}
		s.finishScenarioAsyncJobFailure(ctx, jobID, effective, err)
		return
	}

	if !native {
		result, err = s.stageFiniteMediaBodies(ctx, jobID, req.GetHead(), bodySlots, result)
		if err != nil {
			s.finishScenarioAsyncJobFailure(ctx, jobID, effective, err)
			return
		}
		ctx = context.WithValue(ctx, preparedScenarioBodiesKey{}, jobID)
	}

	if err := s.commitScenarioAsyncJobResult(ctx, jobID, effective, result); err != nil {
		s.finishScenarioAsyncJobFailure(ctx, jobID, effective, err)
	}
}

func (s *Service) commitScenarioAsyncJobResult(ctx context.Context, jobID string, effective *cloudMediaEffectiveInputs, result capabilitydriver.CloudMediaResult) error {
	req := effective.request
	if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
		capabilitydriver.CloseArtifactBodies(result.ArtifactBodies)
		return nil
	}
	if req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE {
		return s.commitCloudMusicGeneration(ctx, jobID, effective, result)
	}
	var transcription *runtimev1.SpeechTranscript
	artifacts, custodyErr := bindRuntimeJobArtifacts(jobID, req.GetHead(), result.Artifacts)
	var newCustodyIDs []string
	if custodyErr == nil && scenarioBodiesPrepared(ctx, jobID) {
		// The Driver normalized real, integrity-checked candidate streams. They
		// already occupy their original slots; publishing must not copy them.
		for _, artifact := range artifacts {
			body := result.ArtifactBodies[artifact.GetArtifactId()]
			if body != nil && body.Kind() == capabilitydriver.ArtifactBodyCommittedReference {
				_, custodyErr = s.storeRuntimeJobArtifact(ctx, jobID, req.GetHead(), artifact, body, nil)
				if custodyErr != nil {
					break
				}
			}
		}
		capabilitydriver.CloseArtifactBodies(result.ArtifactBodies)
	} else if custodyErr == nil {
		newCustodyIDs, custodyErr = s.storeRuntimeJobArtifacts(ctx, jobID, req.GetHead(), artifacts, result.ArtifactBodies)
	}
	if custodyErr == nil {
		transcription, custodyErr = s.captureScenarioTranscriptionResult(ctx, req.GetScenarioType(), artifacts, req.GetSpec().GetSpeechTranscribe().GetTimestamps(), req.GetSpec().GetSpeechTranscribe().GetDiarization())
	}
	if custodyErr != nil {
		capabilitydriver.CloseArtifactBodies(result.ArtifactBodies)
		for _, artifactID := range newCustodyIDs {
			s.deleteRuntimeArtifactCandidate(artifactID, "typed result capture failed")
		}
	}
	if custodyErr != nil {
		if ctx.Err() != nil {
			custodyErr = ctx.Err()
		}
		if !errors.Is(custodyErr, context.Canceled) && !errors.Is(custodyErr, context.DeadlineExceeded) &&
			status.Code(custodyErr) != codes.Canceled && status.Code(custodyErr) != codes.DeadlineExceeded {
			custodyErr = grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
				grpcerr.ReasonOptions{Message: "Runtime artifact custody failed"})
		}
		return custodyErr
	}
	if _, ok, commitErr := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(job *runtimev1.ScenarioJob) {
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
		job.TranscriptionText = transcription.GetText()
		job.Transcription = transcription
		job.Usage = result.Usage
	}, ctx); !ok {
		for _, artifactID := range newCustodyIDs {
			s.deleteRuntimeArtifactCandidate(artifactID, "job metadata attachment failed")
		}
		if s.logger != nil {
			s.logger.Warn("scenario job transition to COMPLETED failed", "job_id", jobID)
		}
		if commitErr != nil {
			return commitErr
		}
		return fmt.Errorf("Job result publication was closed")
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.rpc-foundations.r002
func (s *Service) finishScenarioAsyncJobFailure(ctx context.Context, jobID string, effective *cloudMediaEffectiveInputs, err error) {
	if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
		return
	}
	if s.scenarioJobs.hasResultCandidate(jobID) || s.scenarioJobs.currentNativeResult(jobID) != nil {
		s.setNativeObservationIssue(jobID, 0, err)
		return
	}
	reasonCode := reasonCodeFromMediaError(err)
	statusValue := runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
	eventType := runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED
	if reasonCode == runtimev1.ReasonCode_AI_PROVIDER_TASK_CANCELED {
		statusValue, eventType = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED
	} else if reasonCode == runtimev1.ReasonCode_AI_PROVIDER_TASK_EXPIRED {
		statusValue, eventType = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT
	} else if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) || reasonCode == runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		statusValue = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT
		eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT
		reasonCode = runtimev1.ReasonCode_AI_EXECUTION_RESOURCE_LIMIT_EXCEEDED
	} else if (errors.Is(err, context.Canceled) || status.Code(err) == codes.Canceled) && s.scenarioJobs.cancellationRequested(jobID) {
		statusValue = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
		eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED
	}
	if statusValue == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED && reasonCode == runtimev1.ReasonCode_ACTION_EXECUTED {
		if authorityErr := s.scenarioJobs.withJobWorkAuthority(jobID, func() error { return nil }); authorityErr != nil {
			s.scenarioJobs.failJobWorkAuthority(jobID, authorityErr)
			return
		}
		reasonCode = runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	}
	reasonDetail := sanitizeScenarioJobReasonDetail(err, reasonCode)
	reasonMetadata := scenarioJobReasonMetadata(err, reasonCode)
	if statusValue == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		reasonMetadata = nil
	}
	if s.logger != nil && effective != nil && effective.request != nil {
		s.logger.Warn("scenario job execution failed",
			"source", "runtime",
			"operation", "scenario_job_execution",
			"job_id", jobID,
			"scenario_type", effective.request.GetScenarioType().String(),
			"model_resolved", strings.TrimSpace(effective.modelResolved()),
			"driver_dialect", strings.TrimSpace(effective.mapped.Adapter()),
			"status", statusValue.String(),
			"reason_code", reasonCode.String(),
			"action_hint", reasonMetadata.GetFields()["action_hint"].GetStringValue(),
			"trace_id", strings.TrimSpace(effective.traceID),
			"message", reasonDetail,
		)
	}
	if _, ok, _ := s.transitionScenarioJob(jobID, statusValue, eventType, func(job *runtimev1.ScenarioJob) {
		job.ReasonCode = reasonCode
		job.ReasonDetail = reasonDetail
		job.ReasonMetadata = reasonMetadata
		job.ProviderJobId = ""
		job.RetryCount = 0
		job.NextPollAt = nil
	}, ctx); !ok && s.logger != nil {
		s.logger.Warn("scenario job transition to terminal failed", "job_id", jobID, "status", statusValue.String())
	}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
func (s *Service) captureScenarioTranscriptionResult(ctx context.Context, scenarioType runtimev1.ScenarioType, artifacts []*runtimev1.ScenarioArtifact, requireTiming, requireDiarization bool) (*runtimev1.SpeechTranscript, error) {
	if scenarioType != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE {
		return nil, nil
	}
	var transcript *runtimev1.SpeechTranscript
	text := ""
	for _, artifact := range artifacts {
		if artifact == nil {
			continue
		}
		mime := strings.ToLower(strings.TrimSpace(strings.Split(artifact.GetMimeType(), ";")[0]))
		if mime != "text/plain" && mime != localexecution.SpeechTranscriptMIME {
			continue
		}
		if s == nil || s.runtimeArtifacts == nil || artifact.GetSizeBytes() <= 0 || artifact.GetSizeBytes() > localexecution.MaxSpeechTranscriptBytes {
			return nil, fmt.Errorf("speech transcription artifact exceeds result bounds")
		}
		var source *runtimeartifact.ArtifactSource
		var ok bool
		jobID, _ := ctx.Value(preparedScenarioBodiesKey{}).(string)
		if store, prepared := s.runtimeArtifacts.(runtimeartifact.JobBodyStore); prepared && jobID != "" {
			if _, candidate := store.JobBodyStat(jobID, artifact.GetArtifactId()); candidate {
				source, ok = store.OpenJobBody(ctx, jobID, artifact.GetArtifactId())
			} else {
				source, ok = s.runtimeArtifacts.Open(ctx, artifact.GetArtifactId())
			}
		} else {
			source, ok = s.runtimeArtifacts.Open(ctx, artifact.GetArtifactId())
		}
		if !ok {
			return nil, fmt.Errorf("speech transcription result custody is unavailable")
		}
		payload, err := io.ReadAll(io.LimitReader(source.Body, localexecution.MaxSpeechTranscriptBytes+1))
		closeErr := source.Body.Close()
		if err != nil || closeErr != nil || int64(len(payload)) != artifact.GetSizeBytes() || !utf8.Valid(payload) {
			return nil, fmt.Errorf("speech transcription result custody could not be read")
		}
		if mime == localexecution.SpeechTranscriptMIME {
			if transcript != nil {
				return nil, fmt.Errorf("speech transcription has duplicate typed results")
			}
			transcript = &runtimev1.SpeechTranscript{}
			if err := protojson.Unmarshal(payload, transcript); err != nil {
				return nil, fmt.Errorf("speech transcription result is invalid: %w", err)
			}
		} else {
			text = strings.TrimSpace(string(payload))
		}
	}
	if transcript == nil {
		transcript = &runtimev1.SpeechTranscript{Status: runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_TRANSCRIBED, Text: text}
	}
	if text != "" && text != transcript.GetText() {
		return nil, fmt.Errorf("speech transcription text artifacts disagree")
	}
	if err := localexecution.ValidateSpeechTranscript(transcript, requireTiming); err != nil {
		return nil, err
	}
	if requireDiarization != (transcript.GetDiarization() != nil) {
		return nil, fmt.Errorf("requested diarization result is missing or unsolicited")
	}
	return transcript, nil
}
