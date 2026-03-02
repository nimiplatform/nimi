package ai

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

const (
	adapterOpenAICompat        = "openai_compat_adapter"
	adapterNexaNative          = "nexa_native_adapter"
	adapterBytedanceOpenSpeech = "bytedance_openspeech_adapter"
	adapterBytedanceARKTask    = "bytedance_ark_task_adapter"
	adapterAlibabaNative       = "alibaba_native_adapter"
	adapterGeminiOperation     = "gemini_operation_adapter"
	adapterMiniMaxTask         = "minimax_task_adapter"
	adapterGLMTask             = "glm_task_adapter"
	adapterGLMNative           = "glm_native_adapter"
	adapterKimiChatMultimodal  = "kimi_chat_multimodal_adapter"
)

func (s *Service) SubmitMediaJob(ctx context.Context, req *runtimev1.SubmitMediaJobRequest) (*runtimev1.SubmitMediaJobResponse, error) {
	if err := validateSubmitMediaJobRequest(req); err != nil {
		return nil, err
	}
	// K-KEYSRC-004: parse and validate key-source
	parsed := parseKeySource(ctx, req.GetConnectorId())
	if err := validateKeySource(parsed); err != nil {
		return nil, err
	}
	remoteTarget, err := resolveKeySourceToTarget(parsed, s.connStore, s.allowLoopback)
	if err != nil {
		return nil, err
	}

	idempotencyScope, err := buildMediaJobIdempotencyScope(req)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if idempotencyScope != "" {
		if existing, ok := s.mediaJobs.getByIdempotency(idempotencyScope); ok {
			return &runtimev1.SubmitMediaJobResponse{Job: existing}, nil
		}
	}
	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetAppId())
	if acquireErr != nil {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("submit_media_job", req.GetAppId(), acquireResult)

	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProviderWithTarget(ctx, req.GetRoutePolicy(), req.GetFallback(), req.GetModelId(), remoteTarget)
	if err != nil {
		return nil, err
	}
	s.recordRouteAutoSwitch(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), modelResolved, routeInfo)

	jobID := ulid.Make().String()
	traceID := ulid.Make().String()
	timeout := timeoutDuration(req.GetTimeoutMs(), defaultMediaTimeoutForModal(req.GetModal()))
	jobCtx := context.Background()
	var cancel context.CancelFunc
	if timeout > 0 {
		jobCtx, cancel = context.WithTimeout(jobCtx, timeout)
	} else {
		jobCtx, cancel = context.WithCancel(jobCtx)
	}

	job := &runtimev1.MediaJob{
		JobId:           jobID,
		AppId:           req.GetAppId(),
		SubjectUserId:   req.GetSubjectUserId(),
		ModelId:         req.GetModelId(),
		Modal:           req.GetModal(),
		RoutePolicy:     req.GetRoutePolicy(),
		RouteDecision:   routeDecision,
		ModelResolved:   modelResolved,
		Status:          runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_SUBMITTED,
		ReasonCode:      runtimev1.ReasonCode_ACTION_EXECUTED,
		ProviderOptions: cloneStructPB(extractProviderOptions(req)),
		TraceId:         traceID,
		CreatedAt:       timestamppb.New(time.Now().UTC()),
		UpdatedAt:       timestamppb.New(time.Now().UTC()),
	}
	snapshot := s.mediaJobs.create(job, cancel)
	if snapshot == nil {
		cancel()
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if idempotencyScope != "" {
		s.mediaJobs.bindIdempotency(idempotencyScope, jobID)
	}

	go s.executeMediaJob(jobCtx, jobID, cloneSubmitMediaJobRequest(req), selectedProvider, modelResolved, remoteTarget)
	return &runtimev1.SubmitMediaJobResponse{Job: snapshot}, nil
}

func (s *Service) GetMediaJob(_ context.Context, req *runtimev1.GetMediaJobRequest) (*runtimev1.GetMediaJobResponse, error) {
	jobID := strings.TrimSpace(req.GetJobId())
	if jobID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	job, ok := s.mediaJobs.get(jobID)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
	}
	return &runtimev1.GetMediaJobResponse{Job: job}, nil
}

func (s *Service) CancelMediaJob(_ context.Context, req *runtimev1.CancelMediaJobRequest) (*runtimev1.CancelMediaJobResponse, error) {
	jobID := strings.TrimSpace(req.GetJobId())
	if jobID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	// Check existence and cancellability before transition.
	existingJob, exists := s.mediaJobs.get(jobID)
	if !exists {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
	}
	if isTerminalMediaJobEvent(mediaJobStatusToEventType(existingJob.GetStatus())) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_CANCELLABLE)
	}
	_, ok := s.mediaJobs.transition(
		jobID,
		runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_CANCELED,
		runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_CANCELED,
		func(job *runtimev1.MediaJob) {
			job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
			job.ReasonDetail = strings.TrimSpace(req.GetReason())
		},
	)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_CANCELLABLE)
	}
	s.mediaJobs.cancel(jobID)
	job, _ := s.mediaJobs.get(jobID)
	return &runtimev1.CancelMediaJobResponse{Job: job}, nil
}

func (s *Service) SubscribeMediaJobEvents(req *runtimev1.SubscribeMediaJobEventsRequest, stream grpc.ServerStreamingServer[runtimev1.MediaJobEvent]) error {
	jobID := strings.TrimSpace(req.GetJobId())
	if jobID == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	subID, ch, backlog, terminal, ok := s.mediaJobs.subscribe(jobID, 32)
	if !ok {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
	}
	defer s.mediaJobs.unsubscribe(jobID, subID)

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
			if isTerminalMediaJobEvent(event.GetEventType()) {
				return nil
			}
		}
	}
}

func (s *Service) GetMediaArtifacts(_ context.Context, req *runtimev1.GetMediaArtifactsRequest) (*runtimev1.GetMediaArtifactsResponse, error) {
	jobID := strings.TrimSpace(req.GetJobId())
	if jobID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	artifacts, traceID, ok := s.mediaJobs.listArtifacts(jobID)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
	}
	return &runtimev1.GetMediaArtifactsResponse{
		JobId:     jobID,
		Artifacts: artifacts,
		TraceId:   traceID,
	}, nil
}

func (s *Service) executeMediaJob(ctx context.Context, jobID string, req *runtimev1.SubmitMediaJobRequest, selectedProvider provider, modelResolved string, remoteTarget *nimillm.RemoteTarget) {
	_, ok := s.mediaJobs.transition(jobID, runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_QUEUED, runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_QUEUED, nil)
	if !ok {
		return
	}
	if _, ok := s.mediaJobs.transition(jobID, runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_RUNNING, runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_RUNNING, nil); !ok {
		s.logger.Warn("media job transition to RUNNING failed", "job_id", jobID)
	}

	providerType := ""
	if remoteTarget != nil {
		providerType = remoteTarget.ProviderType
	}
	adapterName := resolveMediaAdapterName(req.GetModelId(), modelResolved, req.GetModal(), providerType)
	var (
		artifacts     []*runtimev1.MediaArtifact
		usage         *runtimev1.UsageStats
		providerJobID string
		err           error
	)

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
		artifacts, usage, providerJobID, err = nimillm.ExecuteGeminiOperation(ctx, cfg, s, jobID, req, modelResolved, extractProviderOptions)
	case adapterMiniMaxTask:
		cfg := s.resolveNativeAdapterConfig("minimax", remoteTarget)
		artifacts, usage, providerJobID, err = nimillm.ExecuteMiniMaxTask(ctx, cfg, s, jobID, req, modelResolved, extractProviderOptions)
	case adapterGLMTask:
		cfg := s.resolveNativeAdapterConfig("glm", remoteTarget)
		artifacts, usage, providerJobID, err = nimillm.ExecuteGLMTask(ctx, cfg, s, jobID, req, modelResolved, extractProviderOptions)
	case adapterGLMNative:
		cfg := s.resolveNativeAdapterConfig("glm", remoteTarget)
		artifacts, usage, providerJobID, err = nimillm.ExecuteGLMNative(ctx, cfg, req, modelResolved)
	case adapterKimiChatMultimodal:
		cfg := s.resolveNativeAdapterConfig("kimi", remoteTarget)
		artifacts, usage, providerJobID, err = nimillm.ExecuteKimiImageChatMultimodal(ctx, cfg, req, modelResolved)
	default:
		artifacts, usage, providerJobID, err = executeBackendSyncMedia(ctx, req, selectedProvider, modelResolved, adapterName, remoteTarget, s.selector.cloudProvider)
	}

	if err != nil {
		reasonCode := reasonCodeFromMediaError(err)
		statusValue := runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED
		eventType := runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_FAILED
		if errors.Is(err, context.Canceled) || status.Code(err) == codes.Canceled {
			statusValue = runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_CANCELED
			eventType = runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_CANCELED
		} else if reasonCode == runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
			statusValue = runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_TIMEOUT
			eventType = runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_TIMEOUT
		}
		if _, ok := s.mediaJobs.transition(jobID, statusValue, eventType, func(job *runtimev1.MediaJob) {
			if providerJobID != "" {
				job.ProviderJobId = providerJobID
			}
			job.ReasonCode = reasonCode
			job.ReasonDetail = strings.TrimSpace(err.Error())
		}); !ok {
			s.logger.Warn("media job transition to terminal failed", "job_id", jobID, "status", statusValue.String())
		}
		return
	}

	if _, ok := s.mediaJobs.transition(jobID, runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED, runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_COMPLETED, func(job *runtimev1.MediaJob) {
		job.ProviderJobId = strings.TrimSpace(providerJobID)
		job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		job.ReasonDetail = ""
		job.Artifacts = cloneArtifacts(artifacts)
		job.Usage = usage
	}); !ok {
		s.logger.Warn("media job transition to COMPLETED failed", "job_id", jobID)
	}
}

// executeBackendSyncMedia routes sync media operations through the underlying
// Backend (via MediaBackendProvider) rather than the Provider interface.
// This is the OpenAI-compat fallback adapter path.
func executeBackendSyncMedia(
	ctx context.Context,
	req *runtimev1.SubmitMediaJobRequest,
	selectedProvider provider,
	modelResolved string,
	adapterName string,
	remoteTarget *nimillm.RemoteTarget,
	cloudProvider *nimillm.CloudProvider,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	var backend *nimillm.Backend
	var backendModelID string
	if remoteTarget != nil && cloudProvider != nil {
		backend, backendModelID = cloudProvider.ResolveMediaBackendWithTarget(modelResolved, remoteTarget)
	} else {
		mbp, ok := selectedProvider.(nimillm.MediaBackendProvider)
		if !ok || mbp == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		backend, backendModelID = mbp.ResolveMediaBackend(modelResolved)
	}
	if backend == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if backendModelID == "" {
		backendModelID = modelResolved
	}

	switch req.GetModal() {
	case runtimev1.Modal_MODAL_IMAGE:
		spec := req.GetImageSpec()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		payload, usage, err := backend.GenerateImage(ctx, backendModelID, spec)
		if err != nil {
			return nil, nil, "", err
		}
		providerRaw := map[string]any{
			"adapter":          adapterName,
			"prompt":           strings.TrimSpace(spec.GetPrompt()),
			"negative_prompt":  strings.TrimSpace(spec.GetNegativePrompt()),
			"size":             strings.TrimSpace(spec.GetSize()),
			"aspect_ratio":     strings.TrimSpace(spec.GetAspectRatio()),
			"quality":          strings.TrimSpace(spec.GetQuality()),
			"style":            strings.TrimSpace(spec.GetStyle()),
			"response_format":  strings.TrimSpace(spec.GetResponseFormat()),
			"reference_images": append([]string(nil), spec.GetReferenceImages()...),
			"mask":             strings.TrimSpace(spec.GetMask()),
			"provider_options": nimillm.StructToMap(spec.GetProviderOptions()),
		}
		artifact := nimillm.BinaryArtifact(nimillm.ResolveImageArtifactMIME(spec, payload), payload, providerRaw)
		nimillm.ApplyImageSpecMetadata(artifact, spec)
		return []*runtimev1.MediaArtifact{artifact}, usage, "", nil
	case runtimev1.Modal_MODAL_VIDEO:
		spec := req.GetVideoSpec()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		payload, usage, err := backend.GenerateVideo(ctx, backendModelID, spec)
		if err != nil {
			return nil, nil, "", err
		}
		providerRaw := map[string]any{
			"adapter":          adapterName,
			"prompt":           strings.TrimSpace(spec.GetPrompt()),
			"negative_prompt":  strings.TrimSpace(spec.GetNegativePrompt()),
			"duration_sec":     spec.GetDurationSec(),
			"fps":              spec.GetFps(),
			"resolution":       strings.TrimSpace(spec.GetResolution()),
			"aspect_ratio":     strings.TrimSpace(spec.GetAspectRatio()),
			"first_frame_uri":  strings.TrimSpace(spec.GetFirstFrameUri()),
			"last_frame_uri":   strings.TrimSpace(spec.GetLastFrameUri()),
			"camera_motion":    strings.TrimSpace(spec.GetCameraMotion()),
			"provider_options": nimillm.StructToMap(spec.GetProviderOptions()),
		}
		artifact := nimillm.BinaryArtifact(nimillm.ResolveVideoArtifactMIME(spec, payload), payload, providerRaw)
		nimillm.ApplyVideoSpecMetadata(artifact, spec)
		return []*runtimev1.MediaArtifact{artifact}, usage, "", nil
	case runtimev1.Modal_MODAL_TTS:
		spec := req.GetSpeechSpec()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		payload, usage, err := backend.SynthesizeSpeech(ctx, backendModelID, spec)
		if err != nil {
			return nil, nil, "", err
		}
		artifact := nimillm.BinaryArtifact(nimillm.ResolveSpeechArtifactMIME(spec, payload), payload, map[string]any{
			"adapter":          adapterName,
			"voice":            strings.TrimSpace(spec.GetVoice()),
			"language":         strings.TrimSpace(spec.GetLanguage()),
			"audio_format":     strings.TrimSpace(spec.GetAudioFormat()),
			"emotion":          strings.TrimSpace(spec.GetEmotion()),
			"provider_options": nimillm.StructToMap(spec.GetProviderOptions()),
		})
		nimillm.ApplySpeechSpecMetadata(artifact, spec)
		return []*runtimev1.MediaArtifact{artifact}, usage, "", nil
	case runtimev1.Modal_MODAL_STT:
		spec := req.GetTranscriptionSpec()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		audioBytes, mimeType, audioURI, err := nimillm.ResolveTranscriptionAudioSource(ctx, spec)
		if err != nil {
			return nil, nil, "", err
		}
		text, usage, err := backend.Transcribe(ctx, backendModelID, spec, audioBytes, mimeType)
		if err != nil {
			return nil, nil, "", err
		}
		artifact := nimillm.BinaryArtifact(nimillm.ResolveTranscriptionArtifactMIME(spec), []byte(text), map[string]any{
			"text":             text,
			"adapter":          adapterName,
			"language":         strings.TrimSpace(spec.GetLanguage()),
			"timestamps":       spec.GetTimestamps(),
			"diarization":      spec.GetDiarization(),
			"speaker_count":    spec.GetSpeakerCount(),
			"response_format":  strings.TrimSpace(spec.GetResponseFormat()),
			"mime_type":        mimeType,
			"audio_uri":        audioURI,
			"provider_options": nimillm.StructToMap(spec.GetProviderOptions()),
		})
		nimillm.ApplyTranscriptionSpecMetadata(artifact, spec, audioURI)
		return []*runtimev1.MediaArtifact{artifact}, usage, "", nil
	default:
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

func resolveMediaAdapterName(modelID string, modelResolved string, modal runtimev1.Modal, providerType string) string {
	raw := strings.ToLower(strings.TrimSpace(modelID))
	resolved := strings.ToLower(strings.TrimSpace(modelResolved))
	joined := raw + "::" + resolved
	provider := strings.ToLower(strings.TrimSpace(providerType))
	switch {
	case strings.Contains(joined, "nexa/"):
		return adapterNexaNative
	case strings.Contains(joined, "dashscope/"), provider == "dashscope":
		return adapterAlibabaNative
	case strings.Contains(joined, "kimi/"), provider == "kimi":
		if modal == runtimev1.Modal_MODAL_IMAGE {
			return adapterKimiChatMultimodal
		}
	case strings.Contains(joined, "gemini/"), provider == "gemini":
		return adapterGeminiOperation
	case strings.Contains(joined, "minimax/"), provider == "minimax":
		return adapterMiniMaxTask
	case strings.Contains(joined, "glm/"), provider == "glm":
		if modal == runtimev1.Modal_MODAL_VIDEO {
			return adapterGLMTask
		}
		return adapterGLMNative
	case strings.Contains(joined, "volcengine/"), strings.Contains(joined, "volcengine_openspeech/"), provider == "volcengine", provider == "volcengine_openspeech":
		if modal == runtimev1.Modal_MODAL_TTS || modal == runtimev1.Modal_MODAL_STT {
			return adapterBytedanceOpenSpeech
		}
		if modal == runtimev1.Modal_MODAL_IMAGE || modal == runtimev1.Modal_MODAL_VIDEO {
			return adapterBytedanceARKTask
		}
	}
	return adapterOpenAICompat
}

// resolveNativeAdapterConfig returns adapter credentials from remoteTarget when
// available (connector path), falling back to the config-based cloud provider entry.
func (s *Service) resolveNativeAdapterConfig(configKey string, remoteTarget *nimillm.RemoteTarget) nimillm.MediaAdapterConfig {
	if remoteTarget != nil && remoteTarget.APIKey != "" {
		return nimillm.MediaAdapterConfig{BaseURL: remoteTarget.Endpoint, APIKey: remoteTarget.APIKey}
	}
	creds := s.config.CloudProviders[configKey]
	return nimillm.MediaAdapterConfig{BaseURL: creds.BaseURL, APIKey: creds.APIKey}
}

func validateSubmitMediaJobRequest(req *runtimev1.SubmitMediaJobRequest) error {
	if req == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := validateBaseRequest(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), req.GetRoutePolicy()); err != nil {
		return err
	}
	if len(req.GetIdempotencyKey()) > 256 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	for key := range req.GetLabels() {
		if strings.TrimSpace(key) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
	}
	if req.GetModal() == runtimev1.Modal_MODAL_UNSPECIFIED {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	switch req.GetModal() {
	case runtimev1.Modal_MODAL_IMAGE:
		spec := req.GetImageSpec()
		if spec == nil || strings.TrimSpace(spec.GetPrompt()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		if spec.GetN() < 0 || spec.GetN() > 16 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	case runtimev1.Modal_MODAL_VIDEO:
		spec := req.GetVideoSpec()
		if spec == nil || strings.TrimSpace(spec.GetPrompt()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		if spec.GetDurationSec() < 0 || spec.GetDurationSec() > 600 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		if spec.GetFps() < 0 || spec.GetFps() > 120 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	case runtimev1.Modal_MODAL_TTS:
		spec := req.GetSpeechSpec()
		if spec == nil || strings.TrimSpace(spec.GetText()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		if spec.GetSampleRateHz() < 0 || spec.GetSampleRateHz() > 192000 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		if spec.GetSpeed() < 0 || spec.GetSpeed() > 4 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		if spec.GetPitch() < -24 || spec.GetPitch() > 24 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		if spec.GetVolume() < 0 || spec.GetVolume() > 4 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	case runtimev1.Modal_MODAL_STT:
		spec := req.GetTranscriptionSpec()
		if spec == nil || !hasTranscriptionAudioSource(spec) {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
		if spec.GetSpeakerCount() < 0 || spec.GetSpeakerCount() > 32 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	default:
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	return nil
}

func hasTranscriptionAudioSource(spec *runtimev1.SpeechTranscriptionSpec) bool {
	if spec == nil {
		return false
	}
	if source := spec.GetAudioSource(); source != nil {
		switch typed := source.GetSource().(type) {
		case *runtimev1.SpeechTranscriptionAudioSource_AudioBytes:
			return len(typed.AudioBytes) > 0
		case *runtimev1.SpeechTranscriptionAudioSource_AudioUri:
			return strings.TrimSpace(typed.AudioUri) != ""
		case *runtimev1.SpeechTranscriptionAudioSource_AudioChunks:
			if typed.AudioChunks == nil {
				return false
			}
			for _, chunk := range typed.AudioChunks.GetChunks() {
				if len(chunk) > 0 {
					return true
				}
			}
		}
	}
	return len(spec.GetAudioBytes()) > 0 || strings.TrimSpace(spec.GetAudioUri()) != ""
}

func buildMediaJobIdempotencyScope(req *runtimev1.SubmitMediaJobRequest) (string, error) {
	if req == nil {
		return "", nil
	}
	idempotencyKey := strings.TrimSpace(req.GetIdempotencyKey())
	if idempotencyKey == "" {
		return "", nil
	}
	specHash, err := hashSubmitMediaSpec(req)
	if err != nil {
		return "", err
	}
	return strings.Join([]string{
		strings.TrimSpace(req.GetAppId()),
		strings.TrimSpace(req.GetSubjectUserId()),
		strings.TrimSpace(req.GetModelId()),
		strconv.FormatInt(int64(req.GetModal()), 10),
		idempotencyKey,
		specHash,
	}, "::"), nil
}

func hashSubmitMediaSpec(req *runtimev1.SubmitMediaJobRequest) (string, error) {
	if req == nil {
		return "", nil
	}
	var (
		raw []byte
		err error
	)
	switch req.GetModal() {
	case runtimev1.Modal_MODAL_IMAGE:
		raw, err = proto.Marshal(req.GetImageSpec())
	case runtimev1.Modal_MODAL_VIDEO:
		raw, err = proto.Marshal(req.GetVideoSpec())
	case runtimev1.Modal_MODAL_TTS:
		raw, err = proto.Marshal(req.GetSpeechSpec())
	case runtimev1.Modal_MODAL_STT:
		raw, err = proto.Marshal(req.GetTranscriptionSpec())
	default:
		raw, err = proto.Marshal(req)
	}
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return fmt.Sprintf("%x", sum), nil
}

func extractProviderOptions(req *runtimev1.SubmitMediaJobRequest) *structpb.Struct {
	if req == nil {
		return nil
	}
	if spec := req.GetImageSpec(); spec != nil {
		return spec.GetProviderOptions()
	}
	if spec := req.GetVideoSpec(); spec != nil {
		return spec.GetProviderOptions()
	}
	if spec := req.GetSpeechSpec(); spec != nil {
		return spec.GetProviderOptions()
	}
	if spec := req.GetTranscriptionSpec(); spec != nil {
		return spec.GetProviderOptions()
	}
	return nil
}

func defaultMediaTimeoutForModal(modal runtimev1.Modal) time.Duration {
	switch modal {
	case runtimev1.Modal_MODAL_IMAGE:
		return defaultGenerateImageTimeout
	case runtimev1.Modal_MODAL_VIDEO:
		return defaultGenerateVideoTimeout
	case runtimev1.Modal_MODAL_TTS:
		return defaultSynthesizeTimeout
	case runtimev1.Modal_MODAL_STT:
		return defaultTranscribeTimeout
	default:
		return defaultGenerateTimeout
	}
}

func reasonCodeFromMediaError(err error) runtimev1.ReasonCode {
	if err == nil {
		return runtimev1.ReasonCode_ACTION_EXECUTED
	}
	st, ok := status.FromError(err)
	if !ok {
		return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	}
	if value, exists := runtimev1.ReasonCode_value[strings.TrimSpace(st.Message())]; exists {
		return runtimev1.ReasonCode(value)
	}
	switch st.Code() {
	case codes.Canceled:
		return runtimev1.ReasonCode_ACTION_EXECUTED
	case codes.DeadlineExceeded:
		return runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	case codes.NotFound:
		return runtimev1.ReasonCode_AI_MODEL_NOT_FOUND
	case codes.FailedPrecondition:
		return runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED
	case codes.InvalidArgument:
		return runtimev1.ReasonCode_AI_INPUT_INVALID
	default:
		return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	}
}

func cloneArtifacts(input []*runtimev1.MediaArtifact) []*runtimev1.MediaArtifact {
	if len(input) == 0 {
		return nil
	}
	out := make([]*runtimev1.MediaArtifact, 0, len(input))
	for _, item := range input {
		out = append(out, cloneMediaArtifact(item))
	}
	return out
}

func cloneStructPB(input *structpb.Struct) *structpb.Struct {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	copied, ok := cloned.(*structpb.Struct)
	if !ok {
		return nil
	}
	return copied
}

func cloneSubmitMediaJobRequest(input *runtimev1.SubmitMediaJobRequest) *runtimev1.SubmitMediaJobRequest {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	copied, ok := cloned.(*runtimev1.SubmitMediaJobRequest)
	if !ok {
		return nil
	}
	return copied
}

func mediaJobStatusToEventType(status runtimev1.MediaJobStatus) runtimev1.MediaJobEventType {
	switch status {
	case runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED:
		return runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_COMPLETED
	case runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED:
		return runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_FAILED
	case runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_CANCELED:
		return runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_CANCELED
	case runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_TIMEOUT:
		return runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_TIMEOUT
	default:
		return runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_TYPE_UNSPECIFIED
	}
}

func isTerminalMediaJobEvent(eventType runtimev1.MediaJobEventType) bool {
	switch eventType {
	case runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_COMPLETED,
		runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_FAILED,
		runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_CANCELED,
		runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_TIMEOUT:
		return true
	default:
		return false
	}
}

func (s *Service) UpdatePollState(
	jobID string,
	providerJobID string,
	retryCount int32,
	nextPollAt *timestamppb.Timestamp,
	lastError string,
) {
	if _, ok := s.mediaJobs.transition(
		jobID,
		runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_UNSPECIFIED,
		runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_TYPE_UNSPECIFIED,
		func(job *runtimev1.MediaJob) {
			job.ProviderJobId = strings.TrimSpace(providerJobID)
			job.RetryCount = retryCount
			job.NextPollAt = nextPollAt
			job.ReasonDetail = strings.TrimSpace(lastError)
		},
	); !ok {
		s.logger.Warn("media job poll state update failed", "job_id", jobID)
	}
}
