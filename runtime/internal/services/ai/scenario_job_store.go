package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) SubmitScenarioJob(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error) {
	if req == nil || req.GetHead() == nil || req.GetSpec() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	mode := req.GetExecutionMode()
	if mode == runtimev1.ExecutionMode_EXECUTION_MODE_UNSPECIFIED {
		mode = runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB
	}
	if err := validateScenarioExecutionMode(req.GetScenarioType(), mode); err != nil {
		return nil, err
	}
	if mode != runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	ignored, err := classifyScenarioExtensions(req.GetScenarioType(), req.GetExtensions())
	if err != nil {
		return nil, err
	}

	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE, runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		return s.submitVoiceWorkflowJob(ctx, req, ignored)

	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE:
		return s.submitScenarioAsyncJob(ctx, req, mode, ignored)
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

func (s *Service) submitVoiceWorkflowJob(
	ctx context.Context,
	req *runtimev1.SubmitScenarioJobRequest,
	ignored []*runtimev1.IgnoredScenarioExtension,
) (*runtimev1.SubmitScenarioJobResponse, error) {
	if req == nil || req.GetHead() == nil || req.GetSpec() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := validateVoiceWorkflowSpec(req.GetScenarioType(), req.GetSpec()); err != nil {
		return nil, err
	}

	remoteTarget, err := s.prepareScenarioRequest(ctx, req.GetHead())
	if err != nil {
		return nil, err
	}

	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if acquireErr != nil {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("submit_voice_workflow_job", req.GetHead().GetAppId(), acquireResult)

	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProviderWithTarget(
		ctx,
		req.GetHead().GetRoutePolicy(),
		req.GetHead().GetFallback(),
		req.GetHead().GetModelId(),
		remoteTarget,
	)
	if err != nil {
		return nil, err
	}
	if err := s.validateScenarioCapability(ctx, req.GetScenarioType(), modelResolved, remoteTarget, selectedProvider); err != nil {
		return nil, err
	}
	providerType := inferScenarioProviderType(modelResolved, remoteTarget, selectedProvider)
	if err := s.validateCatalogAwareScenarioSupport(ctx, req.GetScenarioType(), providerType, modelResolved, req.GetSpec()); err != nil {
		return nil, err
	}
	s.recordRouteAutoSwitch(
		req.GetHead().GetAppId(),
		req.GetHead().GetSubjectUserId(),
		req.GetHead().GetModelId(),
		modelResolved,
		routeInfo,
	)

	workflowType := workflowTypeFromScenarioType(req.GetScenarioType())
	workflowResolution, err := s.resolveVoiceWorkflow(ctx, providerType, modelResolved, workflowType)
	if err != nil {
		if errors.Is(err, catalog.ErrModelNotFound) {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
		}
		if errors.Is(err, catalog.ErrVoiceWorkflowUnsupported) {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
		}
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	if _, err := resolveVoiceWorkflowExtensionPayload(req, workflowResolution.Provider); err != nil {
		return nil, err
	}

	traceID := ulid.Make().String()
	job, asset := s.voiceAssets.submit(&voiceWorkflowSubmitInput{
		Head:              req.GetHead(),
		ScenarioType:      req.GetScenarioType(),
		Spec:              req.GetSpec(),
		TraceID:           traceID,
		RouteDecision:     routeDecision,
		ModelResolved:     modelResolved,
		Provider:          workflowResolution.Provider,
		WorkflowModelID:   workflowResolution.WorkflowModelID,
		OutputPersistence: workflowResolution.OutputPersistence,
		IgnoredExtensions: ignored,
	})
	if job == nil || asset == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	adapterCfg := s.resolveNativeAdapterConfig(workflowResolution.Provider, remoteTarget)

	timeout := timeoutDuration(req.GetHead().GetTimeoutMs(), defaultSynthesizeTimeout)
	jobCtx := context.Background()
	var cancel context.CancelFunc
	if timeout > 0 {
		jobCtx, cancel = context.WithTimeout(jobCtx, timeout)
	} else {
		jobCtx, cancel = context.WithCancel(jobCtx)
	}
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, identity)
	}
	go func() {
		defer cancel()
		s.executeVoiceWorkflowJob(jobCtx, job.GetJobId(), asset.GetVoiceAssetId(), workflowResolution, cloneSubmitScenarioJobRequest(req), adapterCfg)
	}()

	return &runtimev1.SubmitScenarioJobResponse{
		Job:   job,
		Asset: asset,
	}, nil
}

func (s *Service) GetScenarioJob(_ context.Context, req *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error) {
	if req == nil || strings.TrimSpace(req.GetJobId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	jobID := strings.TrimSpace(req.GetJobId())
	if job, ok := s.scenarioJobs.get(jobID); ok {
		return &runtimev1.GetScenarioJobResponse{Job: job}, nil
	}
	job, ok := s.voiceAssets.getJob(jobID)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
	}
	return &runtimev1.GetScenarioJobResponse{Job: job}, nil
}

func (s *Service) CancelScenarioJob(_ context.Context, req *runtimev1.CancelScenarioJobRequest) (*runtimev1.CancelScenarioJobResponse, error) {
	if req == nil || strings.TrimSpace(req.GetJobId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	jobID := strings.TrimSpace(req.GetJobId())
	if existingJob, exists := s.scenarioJobs.get(jobID); exists {
		if isTerminalScenarioJobStatus(existingJob.GetStatus()) {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_CANCELLABLE)
		}
		_, ok := s.scenarioJobs.transition(
			jobID,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
			runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED,
			func(job *runtimev1.ScenarioJob) {
				job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
				job.ReasonDetail = strings.TrimSpace(req.GetReason())
			},
		)
		if !ok {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_CANCELLABLE)
		}
		s.scenarioJobs.cancel(jobID)
		job, _ := s.scenarioJobs.get(jobID)
		return &runtimev1.CancelScenarioJobResponse{Job: job}, nil
	}
	job, ok := s.voiceAssets.cancelJob(jobID, req.GetReason())
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
	}
	return &runtimev1.CancelScenarioJobResponse{Job: job}, nil
}

func (s *Service) SubscribeScenarioJobEvents(req *runtimev1.SubscribeScenarioJobEventsRequest, stream grpc.ServerStreamingServer[runtimev1.ScenarioJobEvent]) error {
	if req == nil || strings.TrimSpace(req.GetJobId()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	jobID := strings.TrimSpace(req.GetJobId())
	subID, ch, backlog, terminal, ok := s.scenarioJobs.subscribe(jobID, 32)
	if ok {
		defer s.scenarioJobs.unsubscribe(jobID, subID)
		for _, event := range backlog {
			if err := stream.Send(event); err != nil {
				return err
			}
		}
		if terminal {
			return nil
		}
		for {
			select {
			case <-stream.Context().Done():
				return nil
			case event, open := <-ch:
				if !open {
					return nil
				}
				if err := stream.Send(event); err != nil {
					return err
				}
				if isTerminalScenarioJobEvent(event.GetEventType()) {
					return nil
				}
			}
		}
	}
	voiceSubID, voiceCh, voiceBacklog, voiceTerminal, voiceOK := s.voiceAssets.subscribe(jobID, 32)
	if !voiceOK {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
	}
	defer s.voiceAssets.unsubscribe(jobID, voiceSubID)
	for _, event := range voiceBacklog {
		if err := stream.Send(event); err != nil {
			return err
		}
	}
	if voiceTerminal {
		return nil
	}
	for {
		select {
		case <-stream.Context().Done():
			return nil
		case event, open := <-voiceCh:
			if !open {
				return nil
			}
			if err := stream.Send(event); err != nil {
				return err
			}
			if isTerminalScenarioJobEvent(event.GetEventType()) {
				return nil
			}
		}
	}
}

func (s *Service) GetScenarioArtifacts(_ context.Context, req *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error) {
	if req == nil || strings.TrimSpace(req.GetJobId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	jobID := strings.TrimSpace(req.GetJobId())
	artifacts, traceID, ok := s.scenarioJobs.listArtifacts(jobID)
	if ok {
		return &runtimev1.GetScenarioArtifactsResponse{
			JobId:     jobID,
			Artifacts: artifacts,
			TraceId:   traceID,
		}, nil
	}
	if job, ok := s.voiceAssets.getJob(jobID); ok {
		return &runtimev1.GetScenarioArtifactsResponse{
			JobId:     jobID,
			Artifacts: []*runtimev1.ScenarioArtifact{},
			TraceId:   job.GetTraceId(),
		}, nil
	}
	return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
}

func (s *Service) submitScenarioAsyncJob(
	ctx context.Context,
	req *runtimev1.SubmitScenarioJobRequest,
	mode runtimev1.ExecutionMode,
	ignored []*runtimev1.IgnoredScenarioExtension,
) (*runtimev1.SubmitScenarioJobResponse, error) {
	if err := validateSubmitScenarioAsyncJobRequest(req); err != nil {
		return nil, err
	}

	remoteTarget, err := s.prepareScenarioRequest(ctx, req.GetHead())
	if err != nil {
		return nil, err
	}

	idempotencyScope, err := buildScenarioJobIdempotencyScope(req)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if idempotencyScope != "" {
		if existing, ok := s.scenarioJobs.getByIdempotency(idempotencyScope); ok {
			return &runtimev1.SubmitScenarioJobResponse{Job: existing}, nil
		}
	}

	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if acquireErr != nil {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("submit_scenario_job", req.GetHead().GetAppId(), acquireResult)

	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProviderWithTarget(
		ctx,
		req.GetHead().GetRoutePolicy(),
		req.GetHead().GetFallback(),
		req.GetHead().GetModelId(),
		remoteTarget,
	)
	if err != nil {
		return nil, err
	}
	if err := s.validateScenarioCapability(ctx, req.GetScenarioType(), modelResolved, remoteTarget, selectedProvider); err != nil {
		return nil, err
	}
	if _, iteration, resolveErr := resolveMusicGenerateExtensionPayload(req); resolveErr != nil {
		return nil, resolveErr
	} else if supportErr := validateMusicGenerateIterationSupport(ctx, s, modelResolved, remoteTarget, selectedProvider, iteration); supportErr != nil {
		return nil, supportErr
	}
	s.recordRouteAutoSwitch(
		req.GetHead().GetAppId(),
		req.GetHead().GetSubjectUserId(),
		req.GetHead().GetModelId(),
		modelResolved,
		routeInfo,
	)

	jobID := ulid.Make().String()
	traceID := ulid.Make().String()
	timeout := scenarioJobTimeoutDuration(req, defaultScenarioJobTimeout(req.GetScenarioType()), remoteTarget == nil)
	jobCtx := context.Background()
	var cancel context.CancelFunc
	if timeout > 0 {
		jobCtx, cancel = context.WithTimeout(jobCtx, timeout)
	} else {
		jobCtx, cancel = context.WithCancel(jobCtx)
	}
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, identity)
	}

	now := timestamppb.New(time.Now().UTC())
	job := &runtimev1.ScenarioJob{
		JobId:             jobID,
		Head:              cloneScenarioHead(req.GetHead()),
		ScenarioType:      req.GetScenarioType(),
		ExecutionMode:     mode,
		RouteDecision:     routeDecision,
		ModelResolved:     modelResolved,
		Status:            runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		ProviderJobId:     "",
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		ReasonDetail:      "",
		RetryCount:        0,
		CreatedAt:         now,
		UpdatedAt:         now,
		NextPollAt:        nil,
		Artifacts:         nil,
		Usage:             nil,
		TraceId:           traceID,
		IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored),
	}
	snapshot := s.scenarioJobs.create(job, cancel)
	if snapshot == nil {
		cancel()
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if idempotencyScope != "" {
		s.scenarioJobs.bindIdempotency(idempotencyScope, jobID)
	}
	go s.executeScenarioAsyncJob(jobCtx, jobID, cloneSubmitScenarioJobRequest(req), selectedProvider, modelResolved, remoteTarget)
	return &runtimev1.SubmitScenarioJobResponse{
		Job: snapshot,
	}, nil
}

func (s *Service) executeScenarioAsyncJob(
	ctx context.Context,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	selectedProvider provider,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
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
		providerType = inferMediaProviderTypeFromSelectedBackend(selectedProvider, modelResolved)
	}
	adapterName := resolveMediaAdapterName(req.GetHead().GetModelId(), modelResolved, scenarioModalFromType(req.GetScenarioType()), providerType)
	var (
		artifacts     []*runtimev1.ScenarioArtifact
		usage         *runtimev1.UsageStats
		providerJobID string
		err           error
	)
	if req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
		err = validateConnectorTTSModelSupport(ctx, s.logger, req, modelResolved, remoteTarget, s.selector.cloudProvider, s.speechCatalog)
	}
	if err == nil {
		switch adapterName {
		case adapterBytedanceOpenSpeech:
			cfg := s.resolveNativeAdapterConfig("volcengine_openspeech", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteBytedanceOpenSpeech(ctx, cfg, req, modelResolved)
		case adapterBytedanceARKTask:
			cfg := s.resolveNativeAdapterConfig("volcengine", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteBytedanceARKTask(ctx, cfg, s, jobID, req, modelResolved)
		case adapterAlibabaNative:
			cfg := s.resolveNativeAdapterConfig("dashscope", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteAlibabaNative(ctx, cfg, s, jobID, req, modelResolved)
		case adapterGeminiOperation:
			cfg := s.resolveNativeAdapterConfig("gemini", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteGeminiOperation(ctx, cfg, s, jobID, req, modelResolved, extractScenarioExtensions)
		case adapterDashScopeChatSTT:
			cfg := s.resolveNativeAdapterConfig("dashscope", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteDashScopeTranscribe(ctx, cfg, req, modelResolved)
		case adapterGeminiChatSTT:
			cfg := s.resolveNativeAdapterConfig("gemini", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteGeminiTranscribe(ctx, cfg, req, modelResolved)
		case adapterMiniMaxTask:
			cfg := s.resolveNativeAdapterConfig("minimax", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteMiniMaxTask(ctx, cfg, s, jobID, req, modelResolved, extractScenarioExtensions)
		case adapterGLMTask:
			cfg := s.resolveNativeAdapterConfig("glm", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteGLMTask(ctx, cfg, s, jobID, req, modelResolved, extractScenarioExtensions)
		case adapterGLMNative:
			cfg := s.resolveNativeAdapterConfig("glm", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteGLMNative(ctx, cfg, req, modelResolved)
		case adapterKimiChatMultimodal:
			cfg := s.resolveNativeAdapterConfig("kimi", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteKimiImageChatMultimodal(ctx, cfg, req, modelResolved)
		case adapterElevenLabsNative:
			cfg := s.resolveNativeAdapterConfig("elevenlabs", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteElevenLabsTTS(ctx, cfg, req, modelResolved)
		case adapterFishAudioNative:
			cfg := s.resolveNativeAdapterConfig("fish_audio", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteFishAudioTTS(ctx, cfg, req, modelResolved)
		case adapterAWSPollyNative:
			cfg := s.resolveNativeAdapterConfig("aws_polly", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteAWSPollyTTS(ctx, cfg, req, modelResolved)
		case adapterAzureSpeechNative:
			cfg := s.resolveNativeAdapterConfig("azure_speech", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteAzureSpeechTTS(ctx, cfg, req, modelResolved)
		case adapterGoogleCloudTTS:
			cfg := s.resolveNativeAdapterConfig("google_cloud_tts", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteGoogleCloudTTS(ctx, cfg, req, modelResolved)
		case adapterFluxNative:
			cfg := s.resolveNativeAdapterConfig("flux", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteFluxImage(ctx, cfg, s, jobID, req, modelResolved)
		case adapterIdeogramNative:
			cfg := s.resolveNativeAdapterConfig("ideogram", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteIdeogramImage(ctx, cfg, req, modelResolved)
		case adapterStabilityNative:
			cfg := s.resolveNativeAdapterConfig("stability", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteStabilityImage(ctx, cfg, req, modelResolved)
		case adapterStabilityMusic:
			cfg := s.resolveNativeAdapterConfig("stability", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteStabilityMusic(ctx, cfg, req, modelResolved)
		case adapterKlingTask:
			cfg := s.resolveNativeAdapterConfig("kling", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteKlingTask(ctx, cfg, s, jobID, req, modelResolved)
		case adapterLumaTask:
			cfg := s.resolveNativeAdapterConfig("luma", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteLumaTask(ctx, cfg, s, jobID, req, modelResolved)
		case adapterPikaTask:
			cfg := s.resolveNativeAdapterConfig("pika", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecutePikaTask(ctx, cfg, s, jobID, req, modelResolved)
		case adapterRunwayTask:
			cfg := s.resolveNativeAdapterConfig("runway", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteRunwayTask(ctx, cfg, s, jobID, req, modelResolved)
		case adapterGoogleVeoOperation:
			cfg := s.resolveNativeAdapterConfig("google_veo", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteGoogleVeoOperation(ctx, cfg, s, jobID, req, modelResolved)
		case adapterStepFunNative:
			cfg := s.resolveNativeAdapterConfig("stepfun", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteStepFunMedia(ctx, cfg, req, modelResolved)
		case adapterSoundverseMusic:
			cfg := s.resolveNativeAdapterConfig("soundverse", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteSoundverseMusic(ctx, cfg, req, modelResolved)
		case adapterMubertMusic:
			cfg := s.resolveNativeAdapterConfig("mubert", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteMubertMusic(ctx, cfg, s, jobID, req, modelResolved)
		case adapterLoudlyMusic:
			cfg := s.resolveNativeAdapterConfig("loudly", remoteTarget)
			artifacts, usage, providerJobID, err = nimillm.ExecuteLoudlyMusic(ctx, cfg, req, modelResolved)
		case adapterLocalAIMusic:
			creds := s.config.LocalProviders["localai"]
			cfg := nimillm.MediaAdapterConfig{BaseURL: creds.BaseURL, APIKey: creds.APIKey, Headers: creds.Headers}
			artifacts, usage, providerJobID, err = nimillm.ExecuteLocalAIMusic(ctx, cfg, req, modelResolved)
		case adapterSidecarMusic:
			creds := s.config.LocalProviders["sidecar"]
			cfg := nimillm.MediaAdapterConfig{BaseURL: creds.BaseURL, APIKey: creds.APIKey, Headers: creds.Headers}
			artifacts, usage, providerJobID, err = nimillm.ExecuteSidecarMusic(ctx, cfg, req, modelResolved)
		default:
			artifacts, usage, providerJobID, err = executeBackendSyncMedia(ctx, s, s.logger, req, selectedProvider, modelResolved, adapterName, remoteTarget, s.selector.cloudProvider, s.speechCatalog)
		}
	}

	if err != nil {
		reasonCode := reasonCodeFromMediaError(err)
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
			job.ReasonDetail = strings.TrimSpace(err.Error())
		}); !ok {
			s.logger.Warn("scenario job transition to terminal failed", "job_id", jobID, "status", statusValue.String())
		}
		return
	}

	if _, ok := s.scenarioJobs.transition(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(job *runtimev1.ScenarioJob) {
		job.ScenarioType = req.GetScenarioType()
		job.ExecutionMode = runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB
		job.ProviderJobId = strings.TrimSpace(providerJobID)
		job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		job.ReasonDetail = ""
		job.Artifacts = cloneScenarioArtifacts(artifacts)
		job.Usage = usage
	}); !ok {
		s.logger.Warn("scenario job transition to COMPLETED failed", "job_id", jobID)
	}
}

func isTerminalScenarioJobEvent(eventType runtimev1.ScenarioJobEventType) bool {
	switch eventType {
	case runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT:
		return true
	default:
		return false
	}
}
