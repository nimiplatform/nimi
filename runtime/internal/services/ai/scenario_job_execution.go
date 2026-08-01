package ai

import (
	"context"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func inheritAsyncJobContext(parent context.Context) context.Context {
	ctx := context.Background()
	if parent == nil {
		return ctx
	}
	if incoming, ok := metadata.FromIncomingContext(parent); ok {
		ctx = metadata.NewIncomingContext(ctx, incoming.Copy())
	}
	if outgoing, ok := metadata.FromOutgoingContext(parent); ok {
		ctx = metadata.NewOutgoingContext(ctx, outgoing.Copy())
	}
	return ctx
}

func (s *Service) executeScenarioAsyncJob(
	ctx context.Context,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	selectedProvider provider,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	localPlan *localModelExecutionPlan,
) {
	_, ok := s.scenarioJobs.transition(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED, nil)
	if !ok {
		return
	}
	if _, ok := s.scenarioJobs.transition(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); !ok {
		s.logger.Warn("scenario job transition to RUNNING failed", "job_id", jobID)
	}

	providerType := ""
	if remoteTarget != nil {
		providerType = remoteTarget.ProviderType
	} else {
		providerType = inferMediaProviderTypeFromSelectedBackend(selectedProvider, modelResolved, scenarioModalFromType(req.GetScenarioType()))
	}
	adapterName := resolveMediaAdapterName(req.GetHead().GetModelId(), modelResolved, scenarioModalFromType(req.GetScenarioType()), providerType)

	// Resolve catalog alias → canonical API model ID (e.g. "seedance-2.0" → "doubao-seedance-2-0-260128").
	apiModelID := modelResolved
	if s.speechCatalog != nil && providerType != "" {
		apiModelID = s.speechCatalog.ResolveAPIModelID(providerType, modelResolved)
	}

	var (
		artifacts     []*runtimev1.ScenarioArtifact
		usage         *runtimev1.UsageStats
		providerJobID string
		err           error
	)
	if s.logger != nil && req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE && preferredRoute(req.GetHead().GetModelId()) == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		s.logger.Info(
			"execute local image scenario job: adapter resolved",
			"job_id", jobID,
			"requested_model_id", strings.TrimSpace(req.GetHead().GetModelId()),
			"model_resolved", strings.TrimSpace(modelResolved),
			"provider_type", strings.TrimSpace(providerType),
			"adapter", strings.TrimSpace(adapterName),
		)
	}
	if req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
		originalReq := req
		var effectiveSpec *runtimev1.SpeechSynthesizeScenarioSpec
		effectiveSpec, err = s.resolveSynthesizeSpeechSpecVoiceRef(ctx, req.GetHead(), modelResolved, req.GetSpec().GetSpeechSynthesize())
		if err == nil && effectiveSpec != nil && effectiveSpec != req.GetSpec().GetSpeechSynthesize() {
			clonedReq := cloneSubmitScenarioJobRequest(req)
			if clonedReq == nil || clonedReq.GetSpec() == nil {
				err = grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
			} else {
				clonedReq.Spec.Spec = &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: effectiveSpec}
				req = clonedReq
			}
		}
		if err == nil {
			err = validateConnectorTTSModelSupport(ctx, s.logger, originalReq, effectiveSpec, modelResolved, remoteTarget, s.selector.cloudProvider, s.speechCatalog)
		}
	}
	if err == nil {
		switch adapterName {
		case adapterBytedanceOpenSpeech:
			cfg := s.resolveNativeAdapterConfig("volcengine_openspeech", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteBytedanceOpenSpeech(ctx, cfg, req, apiModelID)
		case adapterBytedanceARKTask:
			cfg := s.resolveNativeAdapterConfig("volcengine", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteBytedanceARKTask(ctx, cfg, s, jobID, req, apiModelID)
		case adapterAlibabaNative:
			cfg := s.resolveNativeAdapterConfig("dashscope", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteAlibabaNative(ctx, cfg, s, jobID, req, apiModelID)
		case adapterGeminiOperation:
			cfg := s.resolveNativeAdapterConfig("gemini", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteGeminiOperation(ctx, cfg, s, jobID, req, apiModelID, extractScenarioExtensions)
		case adapterDashScopeChatSTT:
			cfg := s.resolveNativeAdapterConfig("dashscope", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteDashScopeTranscribe(ctx, cfg, req, apiModelID)
		case adapterGeminiChatSTT:
			cfg := s.resolveNativeAdapterConfig("gemini", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteGeminiTranscribe(ctx, cfg, req, apiModelID)
		case adapterMiniMaxTask:
			cfg := s.resolveNativeAdapterConfig("minimax", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteMiniMaxTask(ctx, cfg, s, jobID, req, apiModelID, extractScenarioExtensions)
		case adapterGLMTask:
			cfg := s.resolveNativeAdapterConfig("glm", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteGLMTask(ctx, cfg, s, jobID, req, apiModelID, extractScenarioExtensions)
		case adapterGLMNative:
			cfg := s.resolveNativeAdapterConfig("glm", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteGLMNative(ctx, cfg, req, apiModelID)
		case adapterKimiChatMultimodal:
			cfg := s.resolveNativeAdapterConfig("kimi", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteKimiImageChatMultimodal(ctx, cfg, req, apiModelID)
		case adapterElevenLabsNative:
			cfg := s.resolveNativeAdapterConfig("elevenlabs", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteElevenLabsTTS(ctx, cfg, req, apiModelID)
		case adapterFishAudioNative:
			cfg := s.resolveNativeAdapterConfig("fish_audio", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteFishAudioTTS(ctx, cfg, req, apiModelID)
		case adapterAWSPollyNative:
			cfg := s.resolveNativeAdapterConfig("aws_polly", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteAWSPollyTTS(ctx, cfg, req, apiModelID)
		case adapterAzureSpeechNative:
			cfg := s.resolveNativeAdapterConfig("azure_speech", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteAzureSpeechTTS(ctx, cfg, req, apiModelID)
		case adapterGoogleCloudTTS:
			cfg := s.resolveNativeAdapterConfig("google_cloud_tts", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteGoogleCloudTTS(ctx, cfg, req, apiModelID)
		case adapterFluxNative:
			cfg := s.resolveNativeAdapterConfig("flux", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteFluxImage(ctx, cfg, s, jobID, req, apiModelID)
		case adapterIdeogramNative:
			cfg := s.resolveNativeAdapterConfig("ideogram", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteIdeogramImage(ctx, cfg, req, apiModelID)
		case adapterStabilityNative:
			cfg := s.resolveNativeAdapterConfig("stability", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteStabilityImage(ctx, cfg, req, apiModelID)
		case adapterStabilityMusic:
			cfg := s.resolveNativeAdapterConfig("stability", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteStabilityMusic(ctx, cfg, req, apiModelID)
		case adapterKlingTask:
			cfg := s.resolveNativeAdapterConfig("kling", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteKlingTask(ctx, cfg, s, jobID, req, apiModelID)
		case adapterLumaTask:
			cfg := s.resolveNativeAdapterConfig("luma", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteLumaTask(ctx, cfg, s, jobID, req, apiModelID)
		case adapterPikaTask:
			cfg := s.resolveNativeAdapterConfig("pika", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecutePikaTask(ctx, cfg, s, jobID, req, apiModelID)
		case adapterRunwayTask:
			cfg := s.resolveNativeAdapterConfig("runway", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteRunwayTask(ctx, cfg, s, jobID, req, apiModelID)
		case adapterGoogleVeoOperation:
			cfg := s.resolveNativeAdapterConfig("google_veo", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteGoogleVeoOperation(ctx, cfg, s, jobID, req, apiModelID)
		case adapterStepFunNative:
			cfg := s.resolveNativeAdapterConfig("stepfun", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteStepFunMedia(ctx, cfg, req, apiModelID)
		case adapterSoundverseMusic:
			cfg := s.resolveNativeAdapterConfig("soundverse", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteSoundverseMusic(ctx, cfg, req, apiModelID)
		case adapterMubertMusic:
			cfg := s.resolveNativeAdapterConfig("mubert", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteMubertMusic(ctx, cfg, s, jobID, req, apiModelID)
		case adapterLoudlyMusic:
			cfg := s.resolveNativeAdapterConfig("loudly", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteLoudlyMusic(ctx, cfg, req, apiModelID)
		case adapterSidecarMusic:
			creds := s.config.LocalProviders["sidecar"]
			cfg := nimillm.MediaAdapterConfig{
				BaseURL:               creds.BaseURL,
				APIKey:                creds.APIKey,
				Headers:               creds.Headers,
				AllowLoopbackEndpoint: s.allowLoopback,
			}
			artifacts, usage, providerJobID, err = nimillm.ExecuteSidecarMusic(ctx, cfg, req, apiModelID)
		case adapterWorldLabsNative:
			cfg := s.resolveNativeAdapterConfig("worldlabs", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteWorldLabsWorld(ctx, cfg, s, jobID, req, apiModelID)
		default:
			artifacts, usage, providerJobID, err = executeBackendSyncMedia(
				ctx,
				s,
				s.logger,
				req,
				selectedProvider,
				apiModelID,
				adapterName,
				remoteTarget,
				localPlan,
				s.selector.cloudProvider,
				s.speechCatalog,
				func(progress nimillm.ManagedMediaImageProgress) {
					if _, ok := s.scenarioJobs.updateProgress(jobID, progress.CurrentStep, progress.TotalSteps, progress.ProgressPercent); !ok {
						s.logger.Debug("scenario job progress update skipped", "job_id", jobID)
					}
				},
			)
		}
	}

	if err != nil {
		if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
			return
		}
		reasonCode := reasonCodeFromMediaError(err)
		if s.logger != nil {
			s.logger.Warn("scenario job execution failed",
				"job_id", jobID,
				"scenario_type", req.GetScenarioType().String(),
				"requested_model_id", strings.TrimSpace(req.GetHead().GetModelId()),
				"model_resolved", strings.TrimSpace(modelResolved),
				"adapter", strings.TrimSpace(adapterName),
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
			if providerJobID != "" {
				job.ProviderJobId = providerJobID
			}
			job.ReasonCode = reasonCode
			job.ReasonDetail = sanitizeScenarioJobReasonDetail(err, reasonCode)
			job.ReasonMetadata = scenarioJobReasonMetadata(err, reasonCode)
		}); !ok {
			s.logger.Warn("scenario job transition to terminal failed", "job_id", jobID, "status", statusValue.String())
		}
		return
	}

	if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
		return
	}
	if storeErr := s.storeRuntimeArtifacts(artifacts); storeErr != nil {
		if _, ok := s.scenarioJobs.transition(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED, func(job *runtimev1.ScenarioJob) {
			if providerJobID != "" {
				job.ProviderJobId = providerJobID
			}
			job.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
			job.ReasonDetail = storeErr.Error()
			job.ReasonMetadata = nil
		}); !ok {
			s.logger.Warn("scenario job transition to FAILED after artifact store failure failed", "job_id", jobID, "error", storeErr)
		}
		return
	}
	if _, ok := s.scenarioJobs.transition(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(job *runtimev1.ScenarioJob) {
		job.ScenarioType = req.GetScenarioType()
		job.ExecutionMode = runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB
		job.ProviderJobId = strings.TrimSpace(providerJobID)
		job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		job.ReasonDetail = ""
		job.ReasonMetadata = nil
		if job.GetProgressTotalSteps() > 0 {
			job.ProgressCurrentStep = job.GetProgressTotalSteps()
		}
		job.ProgressPercent = 100
		job.Artifacts = cloneScenarioArtifacts(artifacts)
		job.Usage = usage
	}); !ok {
		s.logger.Warn("scenario job transition to COMPLETED failed", "job_id", jobID)
	}
}
