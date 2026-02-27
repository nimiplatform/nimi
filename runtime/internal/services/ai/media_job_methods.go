package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"golang.org/x/net/websocket"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
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
	if err := validateCredentialSourceAtRequestBoundary(ctx, req.GetRoutePolicy()); err != nil {
		return nil, err
	}
	idempotencyScope, err := buildMediaJobIdempotencyScope(req)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	if idempotencyScope != "" {
		if existing, ok := s.mediaJobs.getByIdempotency(idempotencyScope); ok {
			return &runtimev1.SubmitMediaJobResponse{Job: existing}, nil
		}
	}
	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetAppId())
	if acquireErr != nil {
		return nil, status.Error(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("submit_media_job", req.GetAppId(), acquireResult)

	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProvider(ctx, req.GetRoutePolicy(), req.GetFallback(), req.GetModelId())
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
		return nil, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	if idempotencyScope != "" {
		s.mediaJobs.bindIdempotency(idempotencyScope, jobID)
	}

	go s.executeMediaJob(jobCtx, jobID, cloneSubmitMediaJobRequest(req), selectedProvider, modelResolved)
	return &runtimev1.SubmitMediaJobResponse{Job: snapshot}, nil
}

func (s *Service) GetMediaJob(_ context.Context, req *runtimev1.GetMediaJobRequest) (*runtimev1.GetMediaJobResponse, error) {
	jobID := strings.TrimSpace(req.GetJobId())
	if jobID == "" {
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
	}
	job, ok := s.mediaJobs.get(jobID)
	if !ok {
		return nil, status.Error(codes.NotFound, runtimev1.ReasonCode_APP_GRANT_INVALID.String())
	}
	return &runtimev1.GetMediaJobResponse{Job: job}, nil
}

func (s *Service) CancelMediaJob(_ context.Context, req *runtimev1.CancelMediaJobRequest) (*runtimev1.CancelMediaJobResponse, error) {
	jobID := strings.TrimSpace(req.GetJobId())
	if jobID == "" {
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
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
		return nil, status.Error(codes.NotFound, runtimev1.ReasonCode_APP_GRANT_INVALID.String())
	}
	s.mediaJobs.cancel(jobID)
	job, _ := s.mediaJobs.get(jobID)
	return &runtimev1.CancelMediaJobResponse{Job: job}, nil
}

func (s *Service) SubscribeMediaJobEvents(req *runtimev1.SubscribeMediaJobEventsRequest, stream grpc.ServerStreamingServer[runtimev1.MediaJobEvent]) error {
	jobID := strings.TrimSpace(req.GetJobId())
	if jobID == "" {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
	}

	subID, ch, backlog, terminal, ok := s.mediaJobs.subscribe(jobID, 32)
	if !ok {
		return status.Error(codes.NotFound, runtimev1.ReasonCode_APP_GRANT_INVALID.String())
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
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
	}
	artifacts, traceID, ok := s.mediaJobs.listArtifacts(jobID)
	if !ok {
		return nil, status.Error(codes.NotFound, runtimev1.ReasonCode_APP_GRANT_INVALID.String())
	}
	return &runtimev1.GetMediaArtifactsResponse{
		JobId:     jobID,
		Artifacts: artifacts,
		TraceId:   traceID,
	}, nil
}

func (s *Service) executeMediaJob(ctx context.Context, jobID string, req *runtimev1.SubmitMediaJobRequest, selectedProvider provider, modelResolved string) {
	_, ok := s.mediaJobs.transition(jobID, runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_QUEUED, runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_QUEUED, nil)
	if !ok {
		return
	}
	_, _ = s.mediaJobs.transition(jobID, runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_RUNNING, runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_RUNNING, nil)

	adapterName := resolveMediaAdapterName(req.GetModelId(), modelResolved, req.GetModal())
	var (
		artifacts     []*runtimev1.MediaArtifact
		usage         *runtimev1.UsageStats
		providerJobID string
		err           error
	)

	switch adapterName {
	case adapterBytedanceOpenSpeech:
		artifacts, usage, providerJobID, err = s.executeBytedanceOpenSpeech(ctx, req, modelResolved)
	case adapterBytedanceARKTask:
		artifacts, usage, providerJobID, err = s.executeBytedanceARKTask(ctx, jobID, req, modelResolved)
	case adapterAlibabaNative:
		artifacts, usage, providerJobID, err = s.executeAlibabaNative(ctx, jobID, req, modelResolved)
	case adapterGeminiOperation:
		artifacts, usage, providerJobID, err = s.executeGeminiOperation(ctx, jobID, req, modelResolved)
	case adapterMiniMaxTask:
		artifacts, usage, providerJobID, err = s.executeMiniMaxTask(ctx, jobID, req, modelResolved)
	case adapterGLMTask:
		artifacts, usage, providerJobID, err = s.executeGLMTask(ctx, jobID, req, modelResolved)
	case adapterGLMNative:
		artifacts, usage, providerJobID, err = s.executeGLMNative(ctx, req, modelResolved)
	case adapterKimiChatMultimodal:
		artifacts, usage, providerJobID, err = s.executeKimiImageChatMultimodal(ctx, req, modelResolved)
	default:
		artifacts, usage, providerJobID, err = executeProviderSyncMedia(ctx, req, selectedProvider, modelResolved, adapterName)
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
		_, _ = s.mediaJobs.transition(jobID, statusValue, eventType, func(job *runtimev1.MediaJob) {
			if providerJobID != "" {
				job.ProviderJobId = providerJobID
			}
			job.ReasonCode = reasonCode
			job.ReasonDetail = strings.TrimSpace(err.Error())
		})
		return
	}

	_, _ = s.mediaJobs.transition(jobID, runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED, runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_COMPLETED, func(job *runtimev1.MediaJob) {
		job.ProviderJobId = strings.TrimSpace(providerJobID)
		job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		job.ReasonDetail = ""
		job.Artifacts = cloneArtifacts(artifacts)
		job.Usage = usage
	})
}

func executeProviderSyncMedia(
	ctx context.Context,
	req *runtimev1.SubmitMediaJobRequest,
	selectedProvider provider,
	modelResolved string,
	adapterName string,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	if selectedProvider == nil {
		return nil, nil, "", status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	switch req.GetModal() {
	case runtimev1.Modal_MODAL_IMAGE:
		spec := req.GetImageSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		payload, usage, err := selectedProvider.generateImage(ctx, modelResolved, spec)
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
			"provider_options": structToMap(spec.GetProviderOptions()),
		}
		artifact := binaryArtifact(resolveImageArtifactMIME(spec, payload), payload, providerRaw)
		applyImageSpecMetadata(artifact, spec)
		return []*runtimev1.MediaArtifact{artifact}, usage, "", nil
	case runtimev1.Modal_MODAL_VIDEO:
		spec := req.GetVideoSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		payload, usage, err := selectedProvider.generateVideo(ctx, modelResolved, spec)
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
			"provider_options": structToMap(spec.GetProviderOptions()),
		}
		artifact := binaryArtifact(resolveVideoArtifactMIME(spec, payload), payload, providerRaw)
		applyVideoSpecMetadata(artifact, spec)
		return []*runtimev1.MediaArtifact{artifact}, usage, "", nil
	case runtimev1.Modal_MODAL_TTS:
		spec := req.GetSpeechSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		payload, usage, err := selectedProvider.synthesizeSpeech(ctx, modelResolved, spec)
		if err != nil {
			return nil, nil, "", err
		}
		artifact := binaryArtifact(resolveSpeechArtifactMIME(spec, payload), payload, map[string]any{
			"adapter":          adapterName,
			"voice":            strings.TrimSpace(spec.GetVoice()),
			"language":         strings.TrimSpace(spec.GetLanguage()),
			"audio_format":     strings.TrimSpace(spec.GetAudioFormat()),
			"emotion":          strings.TrimSpace(spec.GetEmotion()),
			"provider_options": structToMap(spec.GetProviderOptions()),
		})
		applySpeechSpecMetadata(artifact, spec)
		return []*runtimev1.MediaArtifact{artifact}, usage, "", nil
	case runtimev1.Modal_MODAL_STT:
		spec := req.GetTranscriptionSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		audioBytes, mimeType, audioURI, err := resolveTranscriptionAudioSource(ctx, spec)
		if err != nil {
			return nil, nil, "", err
		}
		text, usage, err := selectedProvider.transcribe(ctx, modelResolved, spec, audioBytes, mimeType)
		if err != nil {
			return nil, nil, "", err
		}
		artifact := binaryArtifact(resolveTranscriptionArtifactMIME(spec), []byte(text), map[string]any{
			"text":             text,
			"adapter":          adapterName,
			"language":         strings.TrimSpace(spec.GetLanguage()),
			"timestamps":       spec.GetTimestamps(),
			"diarization":      spec.GetDiarization(),
			"speaker_count":    spec.GetSpeakerCount(),
			"response_format":  strings.TrimSpace(spec.GetResponseFormat()),
			"mime_type":        mimeType,
			"audio_uri":        audioURI,
			"provider_options": structToMap(spec.GetProviderOptions()),
		})
		applyTranscriptionSpecMetadata(artifact, spec, audioURI)
		return []*runtimev1.MediaArtifact{artifact}, usage, "", nil
	default:
		return nil, nil, "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
}

func resolveMediaAdapterName(modelID string, modelResolved string, modal runtimev1.Modal) string {
	raw := strings.ToLower(strings.TrimSpace(modelID))
	resolved := strings.ToLower(strings.TrimSpace(modelResolved))
	joined := raw + "::" + resolved
	switch {
	case strings.Contains(joined, "nexa/"):
		return adapterNexaNative
	case strings.Contains(joined, "alibaba/"), strings.Contains(joined, "aliyun/"):
		return adapterAlibabaNative
	case strings.Contains(joined, "kimi/"), strings.Contains(joined, "moonshot/"):
		if modal == runtimev1.Modal_MODAL_IMAGE {
			return adapterKimiChatMultimodal
		}
	case strings.Contains(joined, "gemini/"):
		return adapterGeminiOperation
	case strings.Contains(joined, "minimax/"):
		return adapterMiniMaxTask
	case strings.Contains(joined, "glm/"), strings.Contains(joined, "zhipu/"), strings.Contains(joined, "bigmodel/"):
		if modal == runtimev1.Modal_MODAL_VIDEO {
			return adapterGLMTask
		}
		return adapterGLMNative
	case strings.Contains(joined, "bytedance/"), strings.Contains(joined, "byte/"):
		if modal == runtimev1.Modal_MODAL_TTS || modal == runtimev1.Modal_MODAL_STT {
			return adapterBytedanceOpenSpeech
		}
		if modal == runtimev1.Modal_MODAL_IMAGE || modal == runtimev1.Modal_MODAL_VIDEO {
			return adapterBytedanceARKTask
		}
	}
	return adapterOpenAICompat
}

func validateSubmitMediaJobRequest(req *runtimev1.SubmitMediaJobRequest) error {
	if req == nil {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
	}
	if err := validateBaseRequest(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), req.GetRoutePolicy()); err != nil {
		return err
	}
	if len(req.GetIdempotencyKey()) > 256 {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	for key := range req.GetLabels() {
		if strings.TrimSpace(key) == "" {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
	}
	if req.GetModal() == runtimev1.Modal_MODAL_UNSPECIFIED {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	switch req.GetModal() {
	case runtimev1.Modal_MODAL_IMAGE:
		spec := req.GetImageSpec()
		if spec == nil || strings.TrimSpace(spec.GetPrompt()) == "" {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		if spec.GetN() < 0 || spec.GetN() > 16 {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
	case runtimev1.Modal_MODAL_VIDEO:
		spec := req.GetVideoSpec()
		if spec == nil || strings.TrimSpace(spec.GetPrompt()) == "" {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		if spec.GetDurationSec() < 0 || spec.GetDurationSec() > 600 {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		if spec.GetFps() < 0 || spec.GetFps() > 120 {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
	case runtimev1.Modal_MODAL_TTS:
		spec := req.GetSpeechSpec()
		if spec == nil || strings.TrimSpace(spec.GetText()) == "" {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		if spec.GetSampleRateHz() < 0 || spec.GetSampleRateHz() > 192000 {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		if spec.GetSpeed() < 0 || spec.GetSpeed() > 4 {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		if spec.GetPitch() < -24 || spec.GetPitch() > 24 {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		if spec.GetVolume() < 0 || spec.GetVolume() > 4 {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
	case runtimev1.Modal_MODAL_STT:
		spec := req.GetTranscriptionSpec()
		if spec == nil || !hasTranscriptionAudioSource(spec) {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		if spec.GetSpeakerCount() < 0 || spec.GetSpeakerCount() > 32 {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
	default:
		return status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
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

func resolveTranscriptionAudioSource(ctx context.Context, spec *runtimev1.SpeechTranscriptionSpec) ([]byte, string, string, error) {
	if spec == nil {
		return nil, "", "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	mimeType := strings.TrimSpace(spec.GetMimeType())
	if source := spec.GetAudioSource(); source != nil {
		switch typed := source.GetSource().(type) {
		case *runtimev1.SpeechTranscriptionAudioSource_AudioBytes:
			audio := append([]byte(nil), typed.AudioBytes...)
			if len(audio) == 0 {
				return nil, "", "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
			}
			return audio, mimeType, "", nil
		case *runtimev1.SpeechTranscriptionAudioSource_AudioUri:
			audioURI := strings.TrimSpace(typed.AudioUri)
			if audioURI == "" {
				return nil, "", "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
			}
			audio, detectedMIME, err := fetchAudioFromURI(ctx, audioURI)
			if err != nil {
				return nil, "", "", err
			}
			if mimeType == "" {
				mimeType = detectedMIME
			}
			return audio, mimeType, audioURI, nil
		case *runtimev1.SpeechTranscriptionAudioSource_AudioChunks:
			if typed.AudioChunks == nil {
				return nil, "", "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
			}
			audio := joinAudioChunks(typed.AudioChunks.GetChunks())
			if len(audio) == 0 {
				return nil, "", "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
			}
			return audio, mimeType, "", nil
		}
	}
	if len(spec.GetAudioBytes()) > 0 {
		return append([]byte(nil), spec.GetAudioBytes()...), mimeType, "", nil
	}
	if uriText := strings.TrimSpace(spec.GetAudioUri()); uriText != "" {
		audio, detectedMIME, err := fetchAudioFromURI(ctx, uriText)
		if err != nil {
			return nil, "", "", err
		}
		if mimeType == "" {
			mimeType = detectedMIME
		}
		return audio, mimeType, uriText, nil
	}
	return nil, "", "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
}

func fetchAudioFromURI(ctx context.Context, audioURI string) ([]byte, string, error) {
	parsed, err := url.Parse(strings.TrimSpace(audioURI))
	if err != nil || parsed == nil || parsed.Scheme == "" {
		return nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, "", status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, "", status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	payload, err := io.ReadAll(response.Body)
	if err != nil || len(payload) == 0 {
		return nil, "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	return payload, strings.TrimSpace(response.Header.Get("Content-Type")), nil
}

func joinAudioChunks(chunks [][]byte) []byte {
	total := 0
	for _, chunk := range chunks {
		total += len(chunk)
	}
	if total == 0 {
		return nil
	}
	joined := make([]byte, 0, total)
	for _, chunk := range chunks {
		joined = append(joined, chunk...)
	}
	return joined
}

func resolveImageArtifactMIME(spec *runtimev1.ImageGenerationSpec, payload []byte) string {
	responseFormat := ""
	if spec != nil {
		responseFormat = strings.ToLower(strings.TrimSpace(spec.GetResponseFormat()))
	}
	switch responseFormat {
	case "png", "image/png", "b64_json":
		return "image/png"
	case "jpeg", "jpg", "image/jpeg":
		return "image/jpeg"
	case "webp", "image/webp":
		return "image/webp"
	}
	detected := strings.TrimSpace(http.DetectContentType(payload))
	if strings.HasPrefix(detected, "image/") {
		return detected
	}
	return "image/png"
}

func resolveVideoArtifactMIME(spec *runtimev1.VideoGenerationSpec, payload []byte) string {
	detected := strings.TrimSpace(http.DetectContentType(payload))
	if strings.HasPrefix(detected, "video/") {
		return detected
	}
	return "video/mp4"
}

func resolveSpeechArtifactMIME(spec *runtimev1.SpeechSynthesisSpec, payload []byte) string {
	audioFormat := ""
	if spec != nil {
		audioFormat = strings.ToLower(strings.TrimSpace(spec.GetAudioFormat()))
	}
	switch audioFormat {
	case "wav", "audio/wav":
		return "audio/wav"
	case "mp3", "mpeg", "audio/mpeg":
		return "audio/mpeg"
	case "ogg", "audio/ogg":
		return "audio/ogg"
	case "flac", "audio/flac":
		return "audio/flac"
	}
	detected := strings.TrimSpace(http.DetectContentType(payload))
	if strings.HasPrefix(detected, "audio/") {
		return detected
	}
	return "audio/mpeg"
}

func resolveTranscriptionArtifactMIME(spec *runtimev1.SpeechTranscriptionSpec) string {
	responseFormat := ""
	if spec != nil {
		responseFormat = strings.ToLower(strings.TrimSpace(spec.GetResponseFormat()))
	}
	switch responseFormat {
	case "json", "application/json":
		return "application/json"
	case "srt", "text/srt":
		return "text/srt"
	case "vtt", "text/vtt":
		return "text/vtt"
	default:
		return "text/plain"
	}
}

func applyImageSpecMetadata(artifact *runtimev1.MediaArtifact, spec *runtimev1.ImageGenerationSpec) {
	if artifact == nil || spec == nil {
		return
	}
	if width, height := parseDimensionPair(spec.GetSize()); width > 0 && height > 0 {
		artifact.Width = width
		artifact.Height = height
	}
}

func applyVideoSpecMetadata(artifact *runtimev1.MediaArtifact, spec *runtimev1.VideoGenerationSpec) {
	if artifact == nil || spec == nil {
		return
	}
	if spec.GetDurationSec() > 0 {
		artifact.DurationMs = int64(spec.GetDurationSec()) * 1000
	}
	if spec.GetFps() > 0 {
		artifact.Fps = spec.GetFps()
	}
	if width, height := parseDimensionPair(spec.GetResolution()); width > 0 && height > 0 {
		artifact.Width = width
		artifact.Height = height
	}
}

func applySpeechSpecMetadata(artifact *runtimev1.MediaArtifact, spec *runtimev1.SpeechSynthesisSpec) {
	if artifact == nil || spec == nil {
		return
	}
	if spec.GetSampleRateHz() > 0 {
		artifact.SampleRateHz = spec.GetSampleRateHz()
	}
}

func applyTranscriptionSpecMetadata(artifact *runtimev1.MediaArtifact, spec *runtimev1.SpeechTranscriptionSpec, audioURI string) {
	if artifact == nil || spec == nil {
		return
	}
	if strings.TrimSpace(audioURI) != "" {
		artifact.Uri = strings.TrimSpace(audioURI)
	}
	if spec.GetSpeakerCount() > 0 {
		artifact.Channels = spec.GetSpeakerCount()
	}
}

func parseDimensionPair(raw string) (int32, int32) {
	value := strings.ToLower(strings.TrimSpace(raw))
	if value == "" {
		return 0, 0
	}
	value = strings.ReplaceAll(value, " ", "")
	for _, separator := range []string{"x", "*"} {
		parts := strings.Split(value, separator)
		if len(parts) != 2 {
			continue
		}
		width, widthErr := strconv.ParseInt(parts[0], 10, 32)
		height, heightErr := strconv.ParseInt(parts[1], 10, 32)
		if widthErr == nil && heightErr == nil && width > 0 && height > 0 {
			return int32(width), int32(height)
		}
	}
	return 0, 0
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

func binaryArtifact(mimeType string, payload []byte, providerRaw map[string]any) *runtimev1.MediaArtifact {
	if len(payload) == 0 {
		payload = []byte{}
	}
	sum := sha256.Sum256(payload)
	resolvedMIME := strings.TrimSpace(mimeType)
	if resolvedMIME == "" {
		detected := strings.TrimSpace(http.DetectContentType(payload))
		if detected != "" {
			resolvedMIME = detected
		}
	}
	if resolvedMIME == "" {
		resolvedMIME = "application/octet-stream"
	}
	artifact := &runtimev1.MediaArtifact{
		ArtifactId: ulid.Make().String(),
		MimeType:   resolvedMIME,
		Bytes:      append([]byte(nil), payload...),
		Sha256:     fmt.Sprintf("%x", sum),
		SizeBytes:  int64(len(payload)),
	}
	if len(providerRaw) > 0 {
		if uri := strings.TrimSpace(firstNonEmptyString(
			valueAsString(providerRaw["uri"]),
			valueAsString(providerRaw["url"]),
		)); uri != "" {
			artifact.Uri = uri
		}
		if durationMS := valueAsInt64(firstNonNil(providerRaw["duration_ms"], providerRaw["durationMs"])); durationMS > 0 {
			artifact.DurationMs = durationMS
		} else if durationSec := valueAsInt64(firstNonNil(providerRaw["duration_sec"], providerRaw["durationSec"])); durationSec > 0 {
			artifact.DurationMs = durationSec * 1000
		}
		if fps := valueAsInt32(providerRaw["fps"]); fps > 0 {
			artifact.Fps = fps
		}
		if width := valueAsInt32(providerRaw["width"]); width > 0 {
			artifact.Width = width
		}
		if height := valueAsInt32(providerRaw["height"]); height > 0 {
			artifact.Height = height
		}
		if artifact.GetWidth() == 0 || artifact.GetHeight() == 0 {
			if width, height := parseDimensionPair(firstNonEmptyString(
				valueAsString(providerRaw["size"]),
				valueAsString(providerRaw["resolution"]),
			)); width > 0 && height > 0 {
				artifact.Width = width
				artifact.Height = height
			}
		}
		if sampleRate := valueAsInt32(firstNonNil(providerRaw["sample_rate_hz"], providerRaw["sampleRateHz"])); sampleRate > 0 {
			artifact.SampleRateHz = sampleRate
		}
		if channels := valueAsInt32(providerRaw["channels"]); channels > 0 {
			artifact.Channels = channels
		}
		artifact.ProviderRaw = toStruct(providerRaw)
	}
	return artifact
}

func toStruct(input map[string]any) *structpb.Struct {
	if len(input) == 0 {
		return nil
	}
	value, err := structpb.NewStruct(input)
	if err != nil {
		return nil
	}
	return value
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

func (s *Service) executeBytedanceOpenSpeech(
	ctx context.Context,
	req *runtimev1.SubmitMediaJobRequest,
	modelResolved string,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(s.config.CloudBytedanceSpeechBaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	apiKey := strings.TrimSpace(s.config.CloudBytedanceSpeechAPIKey)

	switch req.GetModal() {
	case runtimev1.Modal_MODAL_TTS:
		spec := req.GetSpeechSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		payload := map[string]any{
			"model":       modelResolved,
			"text":        spec.GetText(),
			"voice":       spec.GetVoice(),
			"language":    spec.GetLanguage(),
			"emotion":     spec.GetEmotion(),
			"speed":       spec.GetSpeed(),
			"pitch":       spec.GetPitch(),
			"volume":      spec.GetVolume(),
			"sample_rate": spec.GetSampleRateHz(),
		}
		if spec.GetAudioFormat() != "" {
			payload["format"] = spec.GetAudioFormat()
		}
		if opts := structToMap(spec.GetProviderOptions()); len(opts) > 0 {
			payload["provider_options"] = opts
		}
		body, err := doJSONOrBinaryRequest(ctx, http.MethodPost, joinURL(baseURL, "/api/v1/tts"), apiKey, payload)
		if err != nil {
			return nil, nil, "", err
		}
		artifact := binaryArtifact(resolveSpeechArtifactMIME(spec, body.bytes), body.bytes, map[string]any{
			"adapter":          adapterBytedanceOpenSpeech,
			"voice":            spec.GetVoice(),
			"language":         spec.GetLanguage(),
			"emotion":          spec.GetEmotion(),
			"provider_options": structToMap(spec.GetProviderOptions()),
			"mime_type":        body.mime,
		})
		applySpeechSpecMetadata(artifact, spec)
		return []*runtimev1.MediaArtifact{artifact}, artifactUsage(spec.GetText(), body.bytes, 120), "", nil
	case runtimev1.Modal_MODAL_STT:
		spec := req.GetTranscriptionSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		audioBytes, mimeType, audioURI, resolveErr := resolveTranscriptionAudioSource(ctx, spec)
		if resolveErr != nil {
			return nil, nil, "", resolveErr
		}
		providerOptions := structToMap(spec.GetProviderOptions())
		if shouldUseBytedanceOpenSpeechWS(spec, providerOptions) {
			text, wsRaw, wsErr := executeBytedanceOpenSpeechWS(ctx, baseURL, apiKey, modelResolved, spec, audioBytes, mimeType, providerOptions)
			if wsErr != nil {
				return nil, nil, "", wsErr
			}
			providerRaw := map[string]any{
				"text":             text,
				"adapter":          adapterBytedanceOpenSpeech,
				"transport":        "ws",
				"mime_type":        mimeType,
				"audio_uri":        audioURI,
				"response_format":  spec.GetResponseFormat(),
				"provider_options": providerOptions,
			}
			if len(wsRaw) > 0 {
				providerRaw["ws_response"] = wsRaw
			}
			artifact := binaryArtifact(resolveTranscriptionArtifactMIME(spec), []byte(text), providerRaw)
			applyTranscriptionSpecMetadata(artifact, spec, audioURI)
			return []*runtimev1.MediaArtifact{artifact}, &runtimev1.UsageStats{
				InputTokens:  maxInt64(1, int64(len(audioBytes)/256)),
				OutputTokens: estimateTokens(text),
				ComputeMs:    maxInt64(10, int64(len(audioBytes)/64)),
			}, "", nil
		}
		payload := map[string]any{
			"model":           modelResolved,
			"mime_type":       mimeType,
			"audio_base":      base64.StdEncoding.EncodeToString(audioBytes),
			"timestamps":      spec.GetTimestamps(),
			"diarization":     spec.GetDiarization(),
			"speaker_count":   spec.GetSpeakerCount(),
			"prompt":          spec.GetPrompt(),
			"response_format": spec.GetResponseFormat(),
		}
		if spec.GetLanguage() != "" {
			payload["language"] = spec.GetLanguage()
		}
		if len(providerOptions) > 0 {
			opts := providerOptions
			payload["provider_options"] = opts
		}
		body, err := doJSONOrBinaryRequest(ctx, http.MethodPost, joinURL(baseURL, "/api/v3/auc/bigmodel/recognize/flash"), apiKey, payload)
		if err != nil {
			return nil, nil, "", err
		}
		text := strings.TrimSpace(body.text)
		if text == "" {
			return nil, nil, "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		artifact := binaryArtifact(resolveTranscriptionArtifactMIME(spec), []byte(text), map[string]any{
			"text":             text,
			"adapter":          adapterBytedanceOpenSpeech,
			"mime_type":        mimeType,
			"audio_uri":        audioURI,
			"response_format":  spec.GetResponseFormat(),
			"provider_options": providerOptions,
		})
		applyTranscriptionSpecMetadata(artifact, spec, audioURI)
		return []*runtimev1.MediaArtifact{artifact}, &runtimev1.UsageStats{
			InputTokens:  maxInt64(1, int64(len(audioBytes)/256)),
			OutputTokens: estimateTokens(text),
			ComputeMs:    maxInt64(10, int64(len(audioBytes)/64)),
		}, "", nil
	default:
		return nil, nil, "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
}

func (s *Service) executeBytedanceARKTask(
	ctx context.Context,
	jobID string,
	req *runtimev1.SubmitMediaJobRequest,
	modelResolved string,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(s.config.CloudBytedanceBaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	apiKey := strings.TrimSpace(s.config.CloudBytedanceAPIKey)

	switch req.GetModal() {
	case runtimev1.Modal_MODAL_IMAGE:
		spec := req.GetImageSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		providerOptions := structToMap(spec.GetProviderOptions())
		submitPath := resolveBytedanceARKImagePath(spec)
		submitPayload := map[string]any{
			"model":           modelResolved,
			"prompt":          spec.GetPrompt(),
			"negative_prompt": spec.GetNegativePrompt(),
			"size":            spec.GetSize(),
			"aspect_ratio":    spec.GetAspectRatio(),
			"quality":         spec.GetQuality(),
			"style":           spec.GetStyle(),
			"response_format": spec.GetResponseFormat(),
		}
		if spec.GetSeed() != 0 {
			submitPayload["seed"] = spec.GetSeed()
		}
		if len(spec.GetReferenceImages()) > 0 {
			submitPayload["reference_images"] = append([]string(nil), spec.GetReferenceImages()...)
		}
		if strings.TrimSpace(spec.GetMask()) != "" {
			submitPayload["mask"] = strings.TrimSpace(spec.GetMask())
		}
		submitPayload["input"] = map[string]any{
			"prompt":          spec.GetPrompt(),
			"negative_prompt": spec.GetNegativePrompt(),
		}
		if len(providerOptions) > 0 {
			submitPayload["provider_options"] = providerOptions
		}

		submitResp := map[string]any{}
		if err := doJSONRequest(ctx, http.MethodPost, joinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp); err != nil {
			return nil, nil, "", err
		}
		artifactBytes, mimeType, artifactURI := extractTaskArtifactBytesAndMIME(submitResp)
		if len(artifactBytes) == 0 {
			return nil, nil, "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		if mimeType == "" {
			mimeType = resolveImageArtifactMIME(spec, artifactBytes)
		}
		providerRaw := map[string]any{
			"adapter":          adapterBytedanceARKTask,
			"endpoint":         submitPath,
			"response":         submitResp,
			"prompt":           strings.TrimSpace(spec.GetPrompt()),
			"negative_prompt":  strings.TrimSpace(spec.GetNegativePrompt()),
			"size":             strings.TrimSpace(spec.GetSize()),
			"aspect_ratio":     strings.TrimSpace(spec.GetAspectRatio()),
			"quality":          strings.TrimSpace(spec.GetQuality()),
			"style":            strings.TrimSpace(spec.GetStyle()),
			"response_format":  strings.TrimSpace(spec.GetResponseFormat()),
			"reference_images": append([]string(nil), spec.GetReferenceImages()...),
			"mask":             strings.TrimSpace(spec.GetMask()),
			"provider_options": providerOptions,
		}
		if artifactURI != "" {
			providerRaw["uri"] = artifactURI
		}
		artifact := binaryArtifact(mimeType, artifactBytes, providerRaw)
		applyImageSpecMetadata(artifact, spec)
		return []*runtimev1.MediaArtifact{artifact}, artifactUsage(spec.GetPrompt(), artifactBytes, 180), "", nil
	case runtimev1.Modal_MODAL_VIDEO:
		spec := req.GetVideoSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		providerOptions := structToMap(spec.GetProviderOptions())
		submitPath := resolveBytedanceARKVideoSubmitPath(spec)
		queryPathTemplate := resolveBytedanceARKVideoQueryPathTemplate(spec)
		submitPayload := map[string]any{
			"model":           modelResolved,
			"prompt":          spec.GetPrompt(),
			"negative_prompt": spec.GetNegativePrompt(),
			"duration_sec":    spec.GetDurationSec(),
			"fps":             spec.GetFps(),
			"resolution":      spec.GetResolution(),
			"aspect_ratio":    spec.GetAspectRatio(),
			"first_frame_uri": spec.GetFirstFrameUri(),
			"last_frame_uri":  spec.GetLastFrameUri(),
			"camera_motion":   spec.GetCameraMotion(),
		}
		if spec.GetSeed() != 0 {
			submitPayload["seed"] = spec.GetSeed()
		}
		submitPayload["input"] = map[string]any{
			"prompt":          spec.GetPrompt(),
			"negative_prompt": spec.GetNegativePrompt(),
		}
		if len(providerOptions) > 0 {
			submitPayload["provider_options"] = providerOptions
		}

		submitResp := map[string]any{}
		if err := doJSONRequest(ctx, http.MethodPost, joinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp); err != nil {
			return nil, nil, "", err
		}
		providerJobID := extractTaskIDFromPayload(submitResp)
		if providerJobID == "" {
			artifactBytes, mimeType, artifactURI := extractTaskArtifactBytesAndMIME(submitResp)
			if len(artifactBytes) == 0 {
				return nil, nil, "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
			}
			if mimeType == "" {
				mimeType = resolveVideoArtifactMIME(spec, artifactBytes)
			}
			providerRaw := map[string]any{
				"adapter":         adapterBytedanceARKTask,
				"submit_endpoint": submitPath,
				"response":        submitResp,
			}
			if artifactURI != "" {
				providerRaw["uri"] = artifactURI
			}
			artifact := binaryArtifact(mimeType, artifactBytes, providerRaw)
			applyVideoSpecMetadata(artifact, spec)
			return []*runtimev1.MediaArtifact{artifact}, artifactUsage(spec.GetPrompt(), artifactBytes, 420), "", nil
		}
		return s.pollProviderTaskForArtifact(
			ctx,
			jobID,
			baseURL,
			apiKey,
			adapterBytedanceARKTask,
			providerJobID,
			submitPath,
			queryPathTemplate,
			"video/mp4",
			420,
			spec.GetPrompt(),
			func(artifact *runtimev1.MediaArtifact) {
				applyVideoSpecMetadata(artifact, spec)
			},
			map[string]any{
				"provider_options": providerOptions,
			},
		)
	default:
		return nil, nil, "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
}

func (s *Service) executeAlibabaNative(
	ctx context.Context,
	jobID string,
	req *runtimev1.SubmitMediaJobRequest,
	modelResolved string,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(s.config.CloudAlibabaBaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	apiKey := strings.TrimSpace(s.config.CloudAlibabaAPIKey)

	switch req.GetModal() {
	case runtimev1.Modal_MODAL_IMAGE:
		spec := req.GetImageSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		providerOptions := structToMap(spec.GetProviderOptions())
		submitPath := resolveAlibabaImageSubmitPath(spec)
		queryPathTemplate := resolveAlibabaTaskQueryPathTemplate(providerOptions)
		submitPayload := map[string]any{
			"model":           modelResolved,
			"prompt":          spec.GetPrompt(),
			"negative_prompt": spec.GetNegativePrompt(),
			"input": map[string]any{
				"prompt":          spec.GetPrompt(),
				"negative_prompt": spec.GetNegativePrompt(),
			},
			"parameters": map[string]any{
				"n":            spec.GetN(),
				"size":         spec.GetSize(),
				"aspect_ratio": spec.GetAspectRatio(),
				"quality":      spec.GetQuality(),
				"style":        spec.GetStyle(),
				"seed":         spec.GetSeed(),
				"mask":         spec.GetMask(),
				"format":       spec.GetResponseFormat(),
			},
		}
		if len(spec.GetReferenceImages()) > 0 {
			submitPayload["reference_images"] = append([]string(nil), spec.GetReferenceImages()...)
		}
		if len(providerOptions) > 0 {
			submitPayload["provider_options"] = providerOptions
		}
		submitResp := map[string]any{}
		if err := doJSONRequest(ctx, http.MethodPost, joinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp); err != nil {
			return nil, nil, "", err
		}
		providerJobID := extractTaskIDFromPayload(submitResp)
		if providerJobID == "" {
			artifactBytes, mimeType, artifactURI := extractTaskArtifactBytesAndMIME(submitResp)
			if len(artifactBytes) == 0 {
				return nil, nil, "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
			}
			if mimeType == "" {
				mimeType = resolveImageArtifactMIME(spec, artifactBytes)
			}
			providerRaw := map[string]any{
				"adapter":          adapterAlibabaNative,
				"submit_endpoint":  submitPath,
				"response":         submitResp,
				"provider_options": providerOptions,
			}
			if artifactURI != "" {
				providerRaw["uri"] = artifactURI
			}
			artifact := binaryArtifact(mimeType, artifactBytes, providerRaw)
			applyImageSpecMetadata(artifact, spec)
			return []*runtimev1.MediaArtifact{artifact}, artifactUsage(spec.GetPrompt(), artifactBytes, 180), "", nil
		}
		return s.pollProviderTaskForArtifact(
			ctx,
			jobID,
			baseURL,
			apiKey,
			adapterAlibabaNative,
			providerJobID,
			submitPath,
			queryPathTemplate,
			resolveImageArtifactMIME(spec, nil),
			180,
			spec.GetPrompt(),
			func(artifact *runtimev1.MediaArtifact) {
				applyImageSpecMetadata(artifact, spec)
			},
			map[string]any{
				"provider_options": providerOptions,
			},
		)
	case runtimev1.Modal_MODAL_VIDEO:
		spec := req.GetVideoSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		providerOptions := structToMap(spec.GetProviderOptions())
		submitPath := resolveAlibabaVideoSubmitPath(spec)
		queryPathTemplate := resolveAlibabaTaskQueryPathTemplate(providerOptions)
		submitPayload := map[string]any{
			"model":           modelResolved,
			"prompt":          spec.GetPrompt(),
			"negative_prompt": spec.GetNegativePrompt(),
			"input": map[string]any{
				"prompt":          spec.GetPrompt(),
				"negative_prompt": spec.GetNegativePrompt(),
			},
			"parameters": map[string]any{
				"duration_sec":    spec.GetDurationSec(),
				"fps":             spec.GetFps(),
				"resolution":      spec.GetResolution(),
				"aspect_ratio":    spec.GetAspectRatio(),
				"seed":            spec.GetSeed(),
				"first_frame_uri": spec.GetFirstFrameUri(),
				"last_frame_uri":  spec.GetLastFrameUri(),
				"camera_motion":   spec.GetCameraMotion(),
			},
		}
		if len(providerOptions) > 0 {
			submitPayload["provider_options"] = providerOptions
		}
		submitResp := map[string]any{}
		if err := doJSONRequest(ctx, http.MethodPost, joinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp); err != nil {
			return nil, nil, "", err
		}
		providerJobID := extractTaskIDFromPayload(submitResp)
		if providerJobID == "" {
			artifactBytes, mimeType, artifactURI := extractTaskArtifactBytesAndMIME(submitResp)
			if len(artifactBytes) == 0 {
				return nil, nil, "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
			}
			if mimeType == "" {
				mimeType = resolveVideoArtifactMIME(spec, artifactBytes)
			}
			providerRaw := map[string]any{
				"adapter":          adapterAlibabaNative,
				"submit_endpoint":  submitPath,
				"response":         submitResp,
				"provider_options": providerOptions,
			}
			if artifactURI != "" {
				providerRaw["uri"] = artifactURI
			}
			artifact := binaryArtifact(mimeType, artifactBytes, providerRaw)
			applyVideoSpecMetadata(artifact, spec)
			return []*runtimev1.MediaArtifact{artifact}, artifactUsage(spec.GetPrompt(), artifactBytes, 420), "", nil
		}
		return s.pollProviderTaskForArtifact(
			ctx,
			jobID,
			baseURL,
			apiKey,
			adapterAlibabaNative,
			providerJobID,
			submitPath,
			queryPathTemplate,
			"video/mp4",
			420,
			spec.GetPrompt(),
			func(artifact *runtimev1.MediaArtifact) {
				applyVideoSpecMetadata(artifact, spec)
			},
			map[string]any{
				"provider_options": providerOptions,
			},
		)
	case runtimev1.Modal_MODAL_TTS:
		spec := req.GetSpeechSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		providerOptions := structToMap(spec.GetProviderOptions())
		payload := map[string]any{
			"model": modelResolved,
			"input": map[string]any{
				"text": strings.TrimSpace(spec.GetText()),
			},
			"parameters": map[string]any{
				"voice":       strings.TrimSpace(spec.GetVoice()),
				"language":    strings.TrimSpace(spec.GetLanguage()),
				"emotion":     strings.TrimSpace(spec.GetEmotion()),
				"speed":       spec.GetSpeed(),
				"pitch":       spec.GetPitch(),
				"volume":      spec.GetVolume(),
				"format":      strings.TrimSpace(spec.GetAudioFormat()),
				"sample_rate": spec.GetSampleRateHz(),
			},
			"text":           strings.TrimSpace(spec.GetText()),
			"audio_format":   strings.TrimSpace(spec.GetAudioFormat()),
			"sample_rate_hz": spec.GetSampleRateHz(),
		}
		if len(providerOptions) > 0 {
			payload["provider_options"] = providerOptions
		}
		body, err := doJSONOrBinaryRequest(ctx, http.MethodPost, joinURL(baseURL, resolveAlibabaTTSPath(spec)), apiKey, payload)
		if err != nil {
			return nil, nil, "", err
		}
		artifactBytes, mimeType := extractSpeechArtifactFromResponseBody(body)
		if len(artifactBytes) == 0 {
			return nil, nil, "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "audio/") {
			mimeType = resolveSpeechArtifactMIME(spec, artifactBytes)
		}
		artifact := binaryArtifact(mimeType, artifactBytes, map[string]any{
			"adapter":          adapterAlibabaNative,
			"endpoint":         resolveAlibabaTTSPath(spec),
			"voice":            strings.TrimSpace(spec.GetVoice()),
			"language":         strings.TrimSpace(spec.GetLanguage()),
			"audio_format":     strings.TrimSpace(spec.GetAudioFormat()),
			"emotion":          strings.TrimSpace(spec.GetEmotion()),
			"provider_options": providerOptions,
		})
		applySpeechSpecMetadata(artifact, spec)
		return []*runtimev1.MediaArtifact{artifact}, artifactUsage(spec.GetText(), artifactBytes, 120), "", nil
	case runtimev1.Modal_MODAL_STT:
		spec := req.GetTranscriptionSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		audioBytes, mimeType, audioURI, err := resolveTranscriptionAudioSource(ctx, spec)
		if err != nil {
			return nil, nil, "", err
		}
		endpoint := resolveAlibabaSTTPath(spec)
		text, err := executeGLMTranscribe(ctx, joinURL(baseURL, endpoint), apiKey, modelResolved, spec, audioBytes, mimeType)
		if err != nil {
			return nil, nil, "", err
		}
		usage := &runtimev1.UsageStats{
			InputTokens:  maxInt64(1, int64(len(audioBytes)/256)),
			OutputTokens: estimateTokens(text),
			ComputeMs:    maxInt64(10, int64(len(audioBytes)/64)),
		}
		artifact := binaryArtifact(resolveTranscriptionArtifactMIME(spec), []byte(text), map[string]any{
			"text":             text,
			"adapter":          adapterAlibabaNative,
			"endpoint":         endpoint,
			"language":         strings.TrimSpace(spec.GetLanguage()),
			"timestamps":       spec.GetTimestamps(),
			"diarization":      spec.GetDiarization(),
			"speaker_count":    spec.GetSpeakerCount(),
			"response_format":  strings.TrimSpace(spec.GetResponseFormat()),
			"mime_type":        mimeType,
			"audio_uri":        audioURI,
			"provider_options": structToMap(spec.GetProviderOptions()),
		})
		applyTranscriptionSpecMetadata(artifact, spec, audioURI)
		return []*runtimev1.MediaArtifact{artifact}, usage, "", nil
	default:
		return nil, nil, "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
}

func (s *Service) pollProviderTaskForArtifact(
	ctx context.Context,
	jobID string,
	baseURL string,
	apiKey string,
	adapter string,
	providerJobID string,
	submitPath string,
	queryPathTemplate string,
	defaultMIME string,
	computeMs int64,
	prompt string,
	applyMetadata func(*runtimev1.MediaArtifact),
	extraProviderRaw map[string]any,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	s.updateMediaJobPollState(jobID, providerJobID, 0, timestamppb.New(time.Now().UTC().Add(500*time.Millisecond)), "")
	retryCount := int32(0)
	for {
		if ctx.Err() != nil {
			return nil, nil, providerJobID, mapProviderRequestError(ctx.Err())
		}
		retryCount++
		pollResp := map[string]any{}
		pollPath := resolveTaskQueryPath(queryPathTemplate, providerJobID)
		if err := doJSONRequest(ctx, http.MethodGet, joinURL(baseURL, pollPath), apiKey, nil, &pollResp); err != nil {
			return nil, nil, providerJobID, err
		}
		statusText := resolveAsyncTaskStatus(pollResp)
		if isAsyncTaskPendingStatus(statusText) {
			s.updateMediaJobPollState(jobID, providerJobID, retryCount, timestamppb.New(time.Now().UTC().Add(500*time.Millisecond)), "")
			time.Sleep(500 * time.Millisecond)
			continue
		}
		if isAsyncTaskFailedStatus(statusText) {
			s.updateMediaJobPollState(jobID, providerJobID, retryCount, nil, statusText)
			return nil, nil, providerJobID, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
		}
		artifactBytes, mimeType, artifactURI := extractTaskArtifactBytesAndMIME(pollResp)
		if len(artifactBytes) == 0 {
			s.updateMediaJobPollState(jobID, providerJobID, retryCount, nil, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
			return nil, nil, providerJobID, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		if strings.TrimSpace(mimeType) == "" {
			mimeType = strings.TrimSpace(defaultMIME)
			if mimeType == "" {
				mimeType = strings.TrimSpace(http.DetectContentType(artifactBytes))
			}
		}
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		providerRaw := map[string]any{
			"adapter":         adapter,
			"submit_endpoint": submitPath,
			"query_endpoint":  queryPathTemplate,
			"response":        pollResp,
		}
		for key, value := range extraProviderRaw {
			providerRaw[key] = value
		}
		if artifactURI != "" {
			providerRaw["uri"] = artifactURI
		}
		artifact := binaryArtifact(mimeType, artifactBytes, providerRaw)
		if applyMetadata != nil {
			applyMetadata(artifact)
		}
		s.updateMediaJobPollState(jobID, providerJobID, retryCount, nil, "")
		return []*runtimev1.MediaArtifact{artifact}, artifactUsage(prompt, artifactBytes, computeMs), providerJobID, nil
	}
}

func extractTaskIDFromPayload(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	return strings.TrimSpace(firstNonEmptyString(
		valueAsString(payload["task_id"]),
		valueAsString(payload["taskId"]),
		valueAsString(payload["id"]),
		valueAsString(mapField(payload["task"], "id")),
		valueAsString(mapField(payload["task"], "task_id")),
		valueAsString(mapField(payload["result"], "id")),
		valueAsString(mapField(payload["result"], "task_id")),
		valueAsString(mapField(payload["data"], "id")),
		valueAsString(mapField(payload["data"], "task_id")),
		valueAsString(mapField(payload["output"], "id")),
		valueAsString(mapField(payload["output"], "task_id")),
	))
}

func resolveAsyncTaskStatus(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(firstNonEmptyString(
		valueAsString(payload["status"]),
		valueAsString(payload["task_status"]),
		valueAsString(mapField(payload["result"], "status")),
		valueAsString(mapField(payload["result"], "task_status")),
		valueAsString(mapField(payload["data"], "status")),
		valueAsString(mapField(payload["data"], "task_status")),
		valueAsString(mapField(payload["output"], "status")),
		valueAsString(mapField(payload["output"], "task_status")),
	)))
}

func isAsyncTaskPendingStatus(statusText string) bool {
	switch strings.ToLower(strings.TrimSpace(statusText)) {
	case "", "submitted", "queued", "pending", "running", "processing", "in_progress":
		return true
	default:
		return false
	}
}

func isAsyncTaskFailedStatus(statusText string) bool {
	switch strings.ToLower(strings.TrimSpace(statusText)) {
	case "failed", "error", "canceled", "cancelled":
		return true
	default:
		return false
	}
}

func extractTaskArtifactBytesAndMIME(payload map[string]any) ([]byte, string, string) {
	if artifactBytes, mimeType, artifactURI := extractArtifactBytesAndMIME(payload); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	if artifactBytes, mimeType, artifactURI := extractImageArtifactFromAny(payload["result"]); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	if artifactBytes, mimeType, artifactURI := extractImageArtifactFromAny(payload["data"]); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	if artifactBytes, mimeType, artifactURI := extractImageArtifactFromAny(payload["output"]); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	return nil, "", ""
}

func resolveTaskQueryPath(queryTemplate string, providerJobID string) string {
	template := strings.TrimSpace(queryTemplate)
	if template == "" {
		return ""
	}
	taskID := url.PathEscape(strings.TrimSpace(providerJobID))
	if taskID == "" {
		return template
	}
	if strings.Contains(template, "{task_id}") {
		return strings.ReplaceAll(template, "{task_id}", taskID)
	}
	if strings.HasSuffix(template, "/") {
		return template + taskID
	}
	return template + "/" + taskID
}

func resolveBytedanceARKImagePath(spec *runtimev1.ImageGenerationSpec) string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = structToMap(spec.GetProviderOptions())
	}
	return firstProviderEndpointPath(
		providerOptions,
		[]string{"image_path", "image_submit_path"},
		[]string{"image_paths", "image_submit_paths"},
		[]string{"/api/v3/images/generations"},
	)
}

func resolveBytedanceARKVideoSubmitPath(spec *runtimev1.VideoGenerationSpec) string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = structToMap(spec.GetProviderOptions())
	}
	return firstProviderEndpointPath(
		providerOptions,
		[]string{"video_path", "video_submit_path", "task_submit_path"},
		[]string{"video_paths", "video_submit_paths", "task_submit_paths"},
		[]string{"/api/v3/contents/generations/tasks"},
	)
}

func resolveBytedanceARKVideoQueryPathTemplate(spec *runtimev1.VideoGenerationSpec) string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = structToMap(spec.GetProviderOptions())
	}
	return resolveTaskQueryPathTemplate(
		providerOptions,
		[]string{"video_query_path", "video_query_path_template", "task_query_path"},
		[]string{"video_query_paths", "video_query_path_templates", "task_query_paths"},
		[]string{"/api/v3/contents/generations/tasks/{task_id}"},
	)
}

func resolveAlibabaImageSubmitPath(spec *runtimev1.ImageGenerationSpec) string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = structToMap(spec.GetProviderOptions())
	}
	return firstProviderEndpointPath(
		providerOptions,
		[]string{"image_path", "image_submit_path"},
		[]string{"image_paths", "image_submit_paths"},
		[]string{"/api/v1/services/aigc/image2image/image-synthesis"},
	)
}

func resolveAlibabaVideoSubmitPath(spec *runtimev1.VideoGenerationSpec) string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = structToMap(spec.GetProviderOptions())
	}
	return firstProviderEndpointPath(
		providerOptions,
		[]string{"video_path", "video_submit_path"},
		[]string{"video_paths", "video_submit_paths"},
		[]string{"/api/v1/services/aigc/video-generation/video-synthesis"},
	)
}

func resolveAlibabaTaskQueryPathTemplate(providerOptions map[string]any) string {
	return resolveTaskQueryPathTemplate(
		providerOptions,
		[]string{"task_query_path", "query_path", "task_query_path_template"},
		[]string{"task_query_paths", "query_paths", "task_query_path_templates"},
		[]string{"/api/v1/tasks/{task_id}"},
	)
}

func resolveAlibabaTTSPath(spec *runtimev1.SpeechSynthesisSpec) string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = structToMap(spec.GetProviderOptions())
	}
	return firstProviderEndpointPath(
		providerOptions,
		[]string{"tts_path", "speech_path"},
		[]string{"tts_paths", "speech_paths"},
		[]string{"/api/v1/services/aigc/multimodal-generation/generation"},
	)
}

func resolveAlibabaSTTPath(spec *runtimev1.SpeechTranscriptionSpec) string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = structToMap(spec.GetProviderOptions())
	}
	return firstProviderEndpointPath(
		providerOptions,
		[]string{"stt_path", "transcription_path"},
		[]string{"stt_paths", "transcription_paths"},
		[]string{"/api/v1/services/audio/asr/transcription"},
	)
}

func resolveTaskQueryPathTemplate(providerOptions map[string]any, singleKeys []string, listKeys []string, defaults []string) string {
	candidates := resolveProviderEndpointPaths(providerOptions, singleKeys, listKeys, defaults)
	for _, candidate := range candidates {
		trimmed := strings.TrimSpace(candidate)
		if trimmed == "" {
			continue
		}
		if strings.Contains(trimmed, "{task_id}") {
			return trimmed
		}
		if strings.HasSuffix(trimmed, "/") {
			return trimmed + "{task_id}"
		}
		return trimmed + "/{task_id}"
	}
	return ""
}

func firstProviderEndpointPath(providerOptions map[string]any, singleKeys []string, listKeys []string, defaults []string) string {
	paths := resolveProviderEndpointPaths(providerOptions, singleKeys, listKeys, defaults)
	if len(paths) == 0 {
		return ""
	}
	return paths[0]
}

func shouldUseBytedanceOpenSpeechWS(spec *runtimev1.SpeechTranscriptionSpec, providerOptions map[string]any) bool {
	if spec == nil {
		return false
	}
	if valueAsBool(firstNonNil(providerOptions["prefer_ws"], providerOptions["use_ws"], providerOptions["websocket"])) {
		return true
	}
	transport := strings.ToLower(strings.TrimSpace(valueAsString(providerOptions["transport"])))
	if transport == "ws" || transport == "websocket" {
		return true
	}
	if source := spec.GetAudioSource(); source != nil {
		if chunks := source.GetAudioChunks(); chunks != nil && len(chunks.GetChunks()) > 0 {
			return true
		}
	}
	return false
}

func executeBytedanceOpenSpeechWS(
	ctx context.Context,
	baseURL string,
	apiKey string,
	modelResolved string,
	spec *runtimev1.SpeechTranscriptionSpec,
	audioBytes []byte,
	mimeType string,
	providerOptions map[string]any,
) (string, map[string]any, error) {
	targetURL := resolveBytedanceOpenSpeechWSURL(baseURL, providerOptions)
	if targetURL == "" {
		return "", nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	config, err := websocket.NewConfig(targetURL, websocketOrigin(targetURL))
	if err != nil {
		return "", nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	config.Header = http.Header{}
	config.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(apiKey) != "" {
		config.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	connection, err := websocket.DialConfig(config)
	if err != nil {
		return "", nil, mapProviderRequestError(err)
	}
	defer connection.Close()

	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = connection.Close()
		case <-done:
		}
	}()
	defer close(done)

	if deadline, ok := ctx.Deadline(); ok {
		_ = connection.SetDeadline(deadline)
	}

	chunks := transcriptionAudioChunks(spec, audioBytes)
	startPayload := map[string]any{
		"event":            "start",
		"model":            modelResolved,
		"mime_type":        mimeType,
		"language":         strings.TrimSpace(spec.GetLanguage()),
		"timestamps":       spec.GetTimestamps(),
		"diarization":      spec.GetDiarization(),
		"speaker_count":    spec.GetSpeakerCount(),
		"prompt":           strings.TrimSpace(spec.GetPrompt()),
		"response_format":  strings.TrimSpace(spec.GetResponseFormat()),
		"provider_options": providerOptions,
	}
	if err := websocket.JSON.Send(connection, startPayload); err != nil {
		return "", nil, mapProviderRequestError(err)
	}
	for index, chunk := range chunks {
		if len(chunk) == 0 {
			continue
		}
		frame := map[string]any{
			"event":        "audio",
			"seq":          index + 1,
			"audio_base64": base64.StdEncoding.EncodeToString(chunk),
		}
		if err := websocket.JSON.Send(connection, frame); err != nil {
			return "", nil, mapProviderRequestError(err)
		}
	}
	if err := websocket.JSON.Send(connection, map[string]any{"event": "finish"}); err != nil {
		return "", nil, mapProviderRequestError(err)
	}

	readTimeout := 4 * time.Second
	if rawTimeout := valueAsInt64(firstNonNil(providerOptions["ws_read_timeout_ms"], providerOptions["read_timeout_ms"])); rawTimeout > 0 {
		readTimeout = time.Duration(rawTimeout) * time.Millisecond
	}
	messageCount := 0
	lastStatus := ""
	finalText := ""
	var deltaBuilder strings.Builder
	responsePayload := map[string]any{}

	for {
		if ctx.Err() != nil {
			return "", responsePayload, mapProviderRequestError(ctx.Err())
		}
		_ = connection.SetReadDeadline(computeWSReadDeadline(ctx, readTimeout))
		var payload map[string]any
		if receiveErr := websocket.JSON.Receive(connection, &payload); receiveErr != nil {
			if errors.Is(receiveErr, io.EOF) {
				break
			}
			if isNetworkTimeout(receiveErr) {
				if finalText != "" || strings.TrimSpace(deltaBuilder.String()) != "" {
					break
				}
				return "", responsePayload, status.Error(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String())
			}
			return "", responsePayload, mapProviderRequestError(receiveErr)
		}
		messageCount++
		responsePayload = payload

		errorMessage := strings.TrimSpace(firstNonEmptyString(
			valueAsString(payload["error"]),
			valueAsString(payload["error_message"]),
			valueAsString(mapField(payload["error"], "message")),
			valueAsString(mapField(payload["result"], "error")),
		))
		if errorMessage != "" {
			return "", responsePayload, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
		}
		if delta := strings.TrimSpace(firstNonEmptyString(
			valueAsString(payload["delta"]),
			valueAsString(payload["partial_text"]),
			valueAsString(mapField(payload["result"], "delta")),
		)); delta != "" {
			deltaBuilder.WriteString(delta)
		}
		if text := strings.TrimSpace(firstNonEmptyString(
			valueAsString(payload["text"]),
			valueAsString(payload["final_text"]),
			valueAsString(mapField(payload["result"], "text")),
		)); text != "" {
			finalText = text
		}
		lastStatus = strings.ToLower(strings.TrimSpace(firstNonEmptyString(
			valueAsString(payload["status"]),
			valueAsString(mapField(payload["result"], "status")),
		)))
		doneFlag := valueAsBool(firstNonNil(payload["done"], mapField(payload["result"], "done")))
		if lastStatus == "failed" || lastStatus == "error" {
			return "", responsePayload, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
		}
		if doneFlag || lastStatus == "completed" || lastStatus == "finished" || lastStatus == "done" {
			break
		}
	}

	if strings.TrimSpace(finalText) == "" {
		finalText = strings.TrimSpace(deltaBuilder.String())
	}
	if finalText == "" {
		return "", responsePayload, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	return finalText, map[string]any{
		"status":        lastStatus,
		"message_count": messageCount,
		"transport":     "ws",
		"response":      responsePayload,
	}, nil
}

func computeWSReadDeadline(ctx context.Context, readTimeout time.Duration) time.Time {
	now := time.Now().UTC()
	deadline := now.Add(readTimeout)
	if ctxDeadline, hasDeadline := ctx.Deadline(); hasDeadline && ctxDeadline.Before(deadline) {
		return ctxDeadline
	}
	return deadline
}

func resolveBytedanceOpenSpeechWSURL(baseURL string, providerOptions map[string]any) string {
	if explicitURL := strings.TrimSpace(valueAsString(providerOptions["ws_url"])); explicitURL != "" {
		return explicitURL
	}
	wsPath := strings.TrimSpace(valueAsString(providerOptions["ws_path"]))
	if wsPath == "" {
		wsPath = "/api/v3/auc/bigmodel/recognize/stream"
	}
	httpURL := joinURL(baseURL, wsPath)
	parsed, err := url.Parse(httpURL)
	if err != nil || parsed == nil || strings.TrimSpace(parsed.Host) == "" {
		return ""
	}
	switch parsed.Scheme {
	case "wss", "https":
		parsed.Scheme = "wss"
	default:
		parsed.Scheme = "ws"
	}
	return parsed.String()
}

func websocketOrigin(targetURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(targetURL))
	if err != nil || parsed == nil || strings.TrimSpace(parsed.Host) == "" {
		return "http://localhost/"
	}
	if parsed.Scheme == "wss" {
		return "https://" + parsed.Host + "/"
	}
	return "http://" + parsed.Host + "/"
}

func transcriptionAudioChunks(spec *runtimev1.SpeechTranscriptionSpec, fallback []byte) [][]byte {
	if spec != nil {
		if source := spec.GetAudioSource(); source != nil {
			if chunks := source.GetAudioChunks(); chunks != nil {
				collected := make([][]byte, 0, len(chunks.GetChunks()))
				for _, chunk := range chunks.GetChunks() {
					if len(chunk) == 0 {
						continue
					}
					collected = append(collected, append([]byte(nil), chunk...))
				}
				if len(collected) > 0 {
					return collected
				}
			}
		}
	}
	if len(fallback) > 0 {
		return [][]byte{append([]byte(nil), fallback...)}
	}
	return nil
}

func isNetworkTimeout(err error) bool {
	if err == nil {
		return false
	}
	timeoutError, ok := err.(net.Error)
	return ok && timeoutError.Timeout()
}

func (s *Service) executeGeminiOperation(
	ctx context.Context,
	jobID string,
	req *runtimev1.SubmitMediaJobRequest,
	modelResolved string,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(s.config.CloudGeminiBaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	apiKey := strings.TrimSpace(s.config.CloudGeminiAPIKey)

	submitPayload := map[string]any{
		"model": modelResolved,
		"modal": strings.ToLower(req.GetModal().String()),
	}
	providerOptions := structToMap(extractProviderOptions(req))
	prompt := ""
	defaultMIME := ""
	computeMs := int64(180)
	transcriptionAudioBytes := []byte(nil)
	transcriptionAudioURI := ""
	transcriptionMIME := ""
	switch req.GetModal() {
	case runtimev1.Modal_MODAL_IMAGE:
		spec := req.GetImageSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		prompt = spec.GetPrompt()
		defaultMIME = "image/png"
		computeMs = 180
		submitPayload["prompt"] = spec.GetPrompt()
		submitPayload["negative_prompt"] = spec.GetNegativePrompt()
		submitPayload["size"] = spec.GetSize()
		submitPayload["aspect_ratio"] = spec.GetAspectRatio()
		submitPayload["quality"] = spec.GetQuality()
		submitPayload["style"] = spec.GetStyle()
		submitPayload["response_format"] = spec.GetResponseFormat()
		submitPayload["reference_images"] = append([]string(nil), spec.GetReferenceImages()...)
		submitPayload["mask"] = spec.GetMask()
	case runtimev1.Modal_MODAL_VIDEO:
		spec := req.GetVideoSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		prompt = spec.GetPrompt()
		defaultMIME = "video/mp4"
		computeMs = 420
		submitPayload["prompt"] = spec.GetPrompt()
		submitPayload["negative_prompt"] = spec.GetNegativePrompt()
		submitPayload["duration_sec"] = spec.GetDurationSec()
		submitPayload["fps"] = spec.GetFps()
		submitPayload["resolution"] = spec.GetResolution()
		submitPayload["aspect_ratio"] = spec.GetAspectRatio()
		submitPayload["first_frame_uri"] = spec.GetFirstFrameUri()
		submitPayload["last_frame_uri"] = spec.GetLastFrameUri()
		submitPayload["camera_motion"] = spec.GetCameraMotion()
	case runtimev1.Modal_MODAL_TTS:
		spec := req.GetSpeechSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		prompt = spec.GetText()
		defaultMIME = resolveSpeechArtifactMIME(spec, nil)
		computeMs = 120
		submitPayload["input"] = spec.GetText()
		submitPayload["text"] = spec.GetText()
		submitPayload["voice"] = spec.GetVoice()
		submitPayload["language"] = spec.GetLanguage()
		submitPayload["emotion"] = spec.GetEmotion()
		submitPayload["speed"] = spec.GetSpeed()
		submitPayload["pitch"] = spec.GetPitch()
		submitPayload["volume"] = spec.GetVolume()
		submitPayload["sample_rate_hz"] = spec.GetSampleRateHz()
		if format := strings.TrimSpace(spec.GetAudioFormat()); format != "" {
			submitPayload["audio_format"] = format
			submitPayload["response_format"] = format
		}
	case runtimev1.Modal_MODAL_STT:
		spec := req.GetTranscriptionSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		audioBytes, mimeType, audioURI, err := resolveTranscriptionAudioSource(ctx, spec)
		if err != nil {
			return nil, nil, "", err
		}
		prompt = spec.GetPrompt()
		defaultMIME = resolveTranscriptionArtifactMIME(spec)
		computeMs = maxInt64(10, int64(len(audioBytes)/64))
		transcriptionAudioBytes = audioBytes
		transcriptionAudioURI = audioURI
		transcriptionMIME = mimeType
		submitPayload["audio_base64"] = base64.StdEncoding.EncodeToString(audioBytes)
		submitPayload["mime_type"] = mimeType
		submitPayload["language"] = spec.GetLanguage()
		submitPayload["timestamps"] = spec.GetTimestamps()
		submitPayload["diarization"] = spec.GetDiarization()
		submitPayload["speaker_count"] = spec.GetSpeakerCount()
		submitPayload["prompt"] = spec.GetPrompt()
		submitPayload["response_format"] = spec.GetResponseFormat()
		if strings.TrimSpace(audioURI) != "" {
			submitPayload["audio_uri"] = audioURI
		}
	default:
		return nil, nil, "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
	if len(providerOptions) > 0 {
		submitPayload["provider_options"] = providerOptions
	}

	submitResp := map[string]any{}
	if err := doJSONRequest(ctx, http.MethodPost, joinURL(baseURL, "/operations"), apiKey, submitPayload, &submitResp); err != nil {
		return nil, nil, "", err
	}
	providerJobID := firstNonEmptyString(
		valueAsString(submitResp["name"]),
		valueAsString(submitResp["operation"]),
		valueAsString(mapField(submitResp["operation"], "name")),
		valueAsString(submitResp["id"]),
	)
	if providerJobID == "" {
		return nil, nil, "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	s.updateMediaJobPollState(jobID, providerJobID, 0, timestamppb.New(time.Now().UTC().Add(500*time.Millisecond)), "")
	retryCount := int32(0)

	for {
		if ctx.Err() != nil {
			return nil, nil, providerJobID, mapProviderRequestError(ctx.Err())
		}
		retryCount++
		pollResp := map[string]any{}
		pollPath := joinURL(baseURL, path.Join("/operations", url.PathEscape(providerJobID)))
		if err := doJSONRequest(ctx, http.MethodGet, pollPath, apiKey, nil, &pollResp); err != nil {
			return nil, nil, providerJobID, err
		}
		done := valueAsBool(pollResp["done"])
		if !done {
			s.updateMediaJobPollState(jobID, providerJobID, retryCount, timestamppb.New(time.Now().UTC().Add(500*time.Millisecond)), "")
			time.Sleep(500 * time.Millisecond)
			continue
		}
		statusText := strings.ToLower(strings.TrimSpace(firstNonEmptyString(
			valueAsString(pollResp["status"]),
			valueAsString(mapField(pollResp["result"], "status")),
		)))
		if statusText == "failed" || statusText == "error" || statusText == "canceled" || statusText == "cancelled" {
			s.updateMediaJobPollState(jobID, providerJobID, retryCount, nil, statusText)
			return nil, nil, providerJobID, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
		}
		artifactBytes, mimeType, artifactURI := extractArtifactBytesAndMIME(pollResp)
		if len(artifactBytes) == 0 {
			s.updateMediaJobPollState(jobID, providerJobID, retryCount, nil, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
			return nil, nil, providerJobID, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		if mimeType == "" {
			mimeType = defaultMIME
		}
		providerRaw := map[string]any{
			"adapter":  adapterGeminiOperation,
			"response": pollResp,
		}
		if artifactURI != "" {
			providerRaw["uri"] = artifactURI
		}
		if req.GetModal() == runtimev1.Modal_MODAL_STT {
			providerRaw["audio_uri"] = transcriptionAudioURI
			providerRaw["mime_type"] = transcriptionMIME
		}
		artifact := binaryArtifact(mimeType, artifactBytes, providerRaw)
		var usage *runtimev1.UsageStats
		if req.GetImageSpec() != nil {
			applyImageSpecMetadata(artifact, req.GetImageSpec())
		}
		if req.GetVideoSpec() != nil {
			applyVideoSpecMetadata(artifact, req.GetVideoSpec())
		}
		if req.GetSpeechSpec() != nil {
			spec := req.GetSpeechSpec()
			providerRaw["voice"] = strings.TrimSpace(spec.GetVoice())
			providerRaw["language"] = strings.TrimSpace(spec.GetLanguage())
			providerRaw["audio_format"] = strings.TrimSpace(spec.GetAudioFormat())
			providerRaw["emotion"] = strings.TrimSpace(spec.GetEmotion())
			providerRaw["provider_options"] = providerOptions
			applySpeechSpecMetadata(artifact, spec)
			if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(artifact.GetMimeType())), "audio/") {
				artifact.MimeType = resolveSpeechArtifactMIME(spec, artifactBytes)
			}
			usage = artifactUsage(spec.GetText(), artifactBytes, computeMs)
		}
		if req.GetTranscriptionSpec() != nil {
			spec := req.GetTranscriptionSpec()
			text := strings.TrimSpace(firstNonEmptyString(
				valueAsString(pollResp["artifact_text"]),
				valueAsString(pollResp["text"]),
				valueAsString(mapField(pollResp["result"], "text")),
				string(artifactBytes),
			))
			providerRaw["text"] = text
			providerRaw["language"] = strings.TrimSpace(spec.GetLanguage())
			providerRaw["timestamps"] = spec.GetTimestamps()
			providerRaw["diarization"] = spec.GetDiarization()
			providerRaw["speaker_count"] = spec.GetSpeakerCount()
			providerRaw["response_format"] = strings.TrimSpace(spec.GetResponseFormat())
			providerRaw["provider_options"] = providerOptions
			applyTranscriptionSpecMetadata(artifact, spec, transcriptionAudioURI)
			if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(artifact.GetMimeType())), "text/") &&
				!strings.EqualFold(strings.TrimSpace(artifact.GetMimeType()), "application/json") {
				artifact.MimeType = resolveTranscriptionArtifactMIME(spec)
			}
			usage = &runtimev1.UsageStats{
				InputTokens:  maxInt64(1, int64(len(transcriptionAudioBytes)/256)),
				OutputTokens: estimateTokens(text),
				ComputeMs:    computeMs,
			}
		}
		artifact.ProviderRaw = toStruct(providerRaw)
		if usage == nil {
			usage = artifactUsage(prompt, artifactBytes, computeMs)
		}
		s.updateMediaJobPollState(jobID, providerJobID, retryCount, nil, "")
		return []*runtimev1.MediaArtifact{artifact}, usage, providerJobID, nil
	}
}

func (s *Service) executeMiniMaxTask(
	ctx context.Context,
	jobID string,
	req *runtimev1.SubmitMediaJobRequest,
	modelResolved string,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(s.config.CloudMiniMaxBaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	apiKey := strings.TrimSpace(s.config.CloudMiniMaxAPIKey)

	switch req.GetModal() {
	case runtimev1.Modal_MODAL_TTS:
		spec := req.GetSpeechSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		providerOptions := structToMap(spec.GetProviderOptions())
		miniMaxPayload := map[string]any{
			"model":  modelResolved,
			"text":   strings.TrimSpace(spec.GetText()),
			"input":  strings.TrimSpace(spec.GetText()),
			"stream": false,
		}
		if len(providerOptions) > 0 {
			miniMaxPayload["provider_options"] = providerOptions
		}
		voiceSetting := map[string]any{}
		if voice := strings.TrimSpace(spec.GetVoice()); voice != "" {
			voiceSetting["voice"] = voice
		}
		if language := strings.TrimSpace(spec.GetLanguage()); language != "" {
			voiceSetting["language"] = language
		}
		if emotion := strings.TrimSpace(spec.GetEmotion()); emotion != "" {
			voiceSetting["emotion"] = emotion
		}
		if speed := spec.GetSpeed(); speed > 0 {
			voiceSetting["speed"] = speed
		}
		if pitch := spec.GetPitch(); pitch != 0 {
			voiceSetting["pitch"] = pitch
		}
		if volume := spec.GetVolume(); volume > 0 {
			voiceSetting["volume"] = volume
		}
		if len(voiceSetting) > 0 {
			miniMaxPayload["voice_setting"] = voiceSetting
		}
		audioSetting := map[string]any{}
		if audioFormat := strings.TrimSpace(spec.GetAudioFormat()); audioFormat != "" {
			audioSetting["format"] = audioFormat
			miniMaxPayload["audio_format"] = audioFormat
			miniMaxPayload["response_format"] = audioFormat
		}
		if sampleRate := spec.GetSampleRateHz(); sampleRate > 0 {
			audioSetting["sample_rate"] = sampleRate
			miniMaxPayload["sample_rate_hz"] = sampleRate
		}
		if len(audioSetting) > 0 {
			miniMaxPayload["audio_setting"] = audioSetting
		}
		openAIPayload := map[string]any{
			"model":          modelResolved,
			"input":          strings.TrimSpace(spec.GetText()),
			"text":           strings.TrimSpace(spec.GetText()),
			"voice":          strings.TrimSpace(spec.GetVoice()),
			"language":       strings.TrimSpace(spec.GetLanguage()),
			"emotion":        strings.TrimSpace(spec.GetEmotion()),
			"speed":          spec.GetSpeed(),
			"pitch":          spec.GetPitch(),
			"volume":         spec.GetVolume(),
			"sample_rate_hz": spec.GetSampleRateHz(),
		}
		if audioFormat := strings.TrimSpace(spec.GetAudioFormat()); audioFormat != "" {
			openAIPayload["audio_format"] = audioFormat
			openAIPayload["response_format"] = audioFormat
		}
		if len(providerOptions) > 0 {
			openAIPayload["provider_options"] = providerOptions
		}
		paths := resolveMiniMaxSpeechPaths(spec)
		var lastErr error
		for _, endpointPath := range paths {
			payload := openAIPayload
			if isMiniMaxNativeTTSPath(endpointPath) {
				payload = miniMaxPayload
			}
			body, err := doJSONOrBinaryRequest(ctx, http.MethodPost, joinURL(baseURL, endpointPath), apiKey, payload)
			if err != nil {
				if status.Code(err) == codes.NotFound {
					lastErr = err
					continue
				}
				return nil, nil, "", err
			}
			artifactBytes, mimeType := extractSpeechArtifactFromResponseBody(body)
			if len(artifactBytes) == 0 {
				lastErr = status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
				continue
			}
			if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "audio/") {
				mimeType = resolveSpeechArtifactMIME(spec, artifactBytes)
			}
			artifact := binaryArtifact(mimeType, artifactBytes, map[string]any{
				"adapter":          adapterMiniMaxTask,
				"endpoint":         endpointPath,
				"voice":            strings.TrimSpace(spec.GetVoice()),
				"language":         strings.TrimSpace(spec.GetLanguage()),
				"audio_format":     strings.TrimSpace(spec.GetAudioFormat()),
				"emotion":          strings.TrimSpace(spec.GetEmotion()),
				"provider_options": providerOptions,
			})
			applySpeechSpecMetadata(artifact, spec)
			return []*runtimev1.MediaArtifact{artifact}, artifactUsage(spec.GetText(), artifactBytes, 120), "", nil
		}
		if lastErr != nil {
			if status.Code(lastErr) == codes.NotFound {
				return nil, nil, "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
			}
			return nil, nil, "", lastErr
		}
		return nil, nil, "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	case runtimev1.Modal_MODAL_STT:
		spec := req.GetTranscriptionSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		audioBytes, mimeType, audioURI, err := resolveTranscriptionAudioSource(ctx, spec)
		if err != nil {
			return nil, nil, "", err
		}
		text, endpointPath, err := executeMiniMaxTranscribe(ctx, baseURL, apiKey, modelResolved, spec, audioBytes, mimeType)
		if err != nil {
			return nil, nil, "", err
		}
		usage := &runtimev1.UsageStats{
			InputTokens:  maxInt64(1, int64(len(audioBytes)/256)),
			OutputTokens: estimateTokens(text),
			ComputeMs:    maxInt64(10, int64(len(audioBytes)/64)),
		}
		artifact := binaryArtifact(resolveTranscriptionArtifactMIME(spec), []byte(text), map[string]any{
			"text":             text,
			"adapter":          adapterMiniMaxTask,
			"endpoint":         endpointPath,
			"language":         strings.TrimSpace(spec.GetLanguage()),
			"timestamps":       spec.GetTimestamps(),
			"diarization":      spec.GetDiarization(),
			"speaker_count":    spec.GetSpeakerCount(),
			"response_format":  strings.TrimSpace(spec.GetResponseFormat()),
			"mime_type":        mimeType,
			"audio_uri":        audioURI,
			"provider_options": structToMap(spec.GetProviderOptions()),
		})
		applyTranscriptionSpecMetadata(artifact, spec, audioURI)
		return []*runtimev1.MediaArtifact{artifact}, usage, "", nil
	}

	submitPath := "/v1/image_generation"
	queryPath := "/v1/query/image_generation"
	prompt := ""
	defaultMIME := "image/png"
	if req.GetModal() == runtimev1.Modal_MODAL_VIDEO {
		submitPath = "/v1/video_generation"
		queryPath = "/v1/query/video_generation"
		defaultMIME = "video/mp4"
	}
	if req.GetModal() != runtimev1.Modal_MODAL_IMAGE && req.GetModal() != runtimev1.Modal_MODAL_VIDEO {
		return nil, nil, "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
	if req.GetModal() == runtimev1.Modal_MODAL_IMAGE {
		spec := req.GetImageSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		prompt = spec.GetPrompt()
	} else {
		spec := req.GetVideoSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		prompt = spec.GetPrompt()
	}

	submitPayload := map[string]any{
		"model":  modelResolved,
		"prompt": prompt,
	}
	if imageSpec := req.GetImageSpec(); imageSpec != nil {
		submitPayload["negative_prompt"] = imageSpec.GetNegativePrompt()
		submitPayload["size"] = imageSpec.GetSize()
		submitPayload["aspect_ratio"] = imageSpec.GetAspectRatio()
		submitPayload["quality"] = imageSpec.GetQuality()
		submitPayload["style"] = imageSpec.GetStyle()
		submitPayload["response_format"] = imageSpec.GetResponseFormat()
	}
	if videoSpec := req.GetVideoSpec(); videoSpec != nil {
		submitPayload["negative_prompt"] = videoSpec.GetNegativePrompt()
		submitPayload["duration_sec"] = videoSpec.GetDurationSec()
		submitPayload["fps"] = videoSpec.GetFps()
		submitPayload["resolution"] = videoSpec.GetResolution()
		submitPayload["aspect_ratio"] = videoSpec.GetAspectRatio()
		submitPayload["first_frame_uri"] = videoSpec.GetFirstFrameUri()
		submitPayload["last_frame_uri"] = videoSpec.GetLastFrameUri()
		submitPayload["camera_motion"] = videoSpec.GetCameraMotion()
	}
	if opts := structToMap(extractProviderOptions(req)); len(opts) > 0 {
		submitPayload["provider_options"] = opts
	}
	submitResp := map[string]any{}
	if err := doJSONRequest(ctx, http.MethodPost, joinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp); err != nil {
		return nil, nil, "", err
	}
	providerJobID := firstNonEmptyString(
		valueAsString(submitResp["task_id"]),
		valueAsString(submitResp["taskId"]),
		valueAsString(submitResp["id"]),
	)
	if providerJobID == "" {
		return nil, nil, "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	s.updateMediaJobPollState(jobID, providerJobID, 0, timestamppb.New(time.Now().UTC().Add(500*time.Millisecond)), "")
	retryCount := int32(0)

	for {
		if ctx.Err() != nil {
			return nil, nil, providerJobID, mapProviderRequestError(ctx.Err())
		}
		retryCount++
		queryURL, err := url.Parse(joinURL(baseURL, queryPath))
		if err != nil {
			return nil, nil, providerJobID, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		values := queryURL.Query()
		values.Set("task_id", providerJobID)
		queryURL.RawQuery = values.Encode()

		pollResp := map[string]any{}
		if err := doJSONRequest(ctx, http.MethodGet, queryURL.String(), apiKey, nil, &pollResp); err != nil {
			return nil, nil, providerJobID, err
		}
		statusText := strings.ToLower(strings.TrimSpace(firstNonEmptyString(
			valueAsString(pollResp["status"]),
			valueAsString(pollResp["task_status"]),
			valueAsString(mapField(pollResp["result"], "status")),
		)))
		if isMiniMaxTaskPendingStatus(statusText) {
			s.updateMediaJobPollState(jobID, providerJobID, retryCount, timestamppb.New(time.Now().UTC().Add(500*time.Millisecond)), "")
			time.Sleep(500 * time.Millisecond)
			continue
		}
		if isMiniMaxTaskFailedStatus(statusText) {
			s.updateMediaJobPollState(jobID, providerJobID, retryCount, nil, statusText)
			return nil, nil, providerJobID, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
		}
		artifactBytes, mimeType, artifactURI := extractArtifactBytesAndMIME(pollResp)
		if len(artifactBytes) == 0 {
			s.updateMediaJobPollState(jobID, providerJobID, retryCount, nil, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
			return nil, nil, providerJobID, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		if mimeType == "" {
			mimeType = defaultMIME
		}
		providerRaw := map[string]any{
			"adapter":  adapterMiniMaxTask,
			"response": pollResp,
		}
		if artifactURI != "" {
			providerRaw["uri"] = artifactURI
		}
		artifact := binaryArtifact(mimeType, artifactBytes, providerRaw)
		if req.GetModal() == runtimev1.Modal_MODAL_IMAGE {
			applyImageSpecMetadata(artifact, req.GetImageSpec())
		}
		if req.GetModal() == runtimev1.Modal_MODAL_VIDEO {
			applyVideoSpecMetadata(artifact, req.GetVideoSpec())
		}
		computeMs := int64(180)
		if req.GetModal() == runtimev1.Modal_MODAL_VIDEO {
			computeMs = 420
		}
		s.updateMediaJobPollState(jobID, providerJobID, retryCount, nil, "")
		return []*runtimev1.MediaArtifact{artifact}, artifactUsage(prompt, artifactBytes, computeMs), providerJobID, nil
	}
}

func isMiniMaxTaskPendingStatus(statusText string) bool {
	switch strings.ToLower(strings.TrimSpace(statusText)) {
	case "", "queued", "pending", "running", "processing", "in_progress":
		return true
	default:
		return false
	}
}

func isMiniMaxTaskFailedStatus(statusText string) bool {
	switch strings.ToLower(strings.TrimSpace(statusText)) {
	case "failed", "error", "canceled", "cancelled":
		return true
	default:
		return false
	}
}

func resolveMiniMaxSpeechPaths(spec *runtimev1.SpeechSynthesisSpec) []string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = structToMap(spec.GetProviderOptions())
	}
	return resolveProviderEndpointPaths(
		providerOptions,
		[]string{"tts_path", "speech_path", "audio_speech_path"},
		[]string{"tts_paths", "speech_paths"},
		[]string{"/v1/t2a_v2", "/v1/audio/speech"},
	)
}

func resolveMiniMaxTranscriptionPaths(spec *runtimev1.SpeechTranscriptionSpec) []string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = structToMap(spec.GetProviderOptions())
	}
	return resolveProviderEndpointPaths(
		providerOptions,
		[]string{"stt_path", "transcription_path", "audio_transcriptions_path"},
		[]string{"stt_paths", "transcription_paths"},
		[]string{"/v1/audio/transcriptions", "/v1/stt/transcriptions", "/v1/stt"},
	)
}

func resolveProviderEndpointPaths(
	providerOptions map[string]any,
	singleKeys []string,
	listKeys []string,
	defaults []string,
) []string {
	paths := make([]string, 0, len(defaults)+len(singleKeys))
	seen := map[string]bool{}
	addPath := func(raw string) {
		normalized := normalizeProviderEndpointPath(raw)
		if normalized == "" || seen[normalized] {
			return
		}
		seen[normalized] = true
		paths = append(paths, normalized)
	}
	for _, key := range singleKeys {
		addPath(valueAsString(providerOptions[key]))
	}
	for _, key := range listKeys {
		switch typed := providerOptions[key].(type) {
		case string:
			addPath(typed)
		case []string:
			for _, item := range typed {
				addPath(item)
			}
		case []any:
			for _, item := range typed {
				addPath(valueAsString(item))
			}
		}
	}
	for _, item := range defaults {
		addPath(item)
	}
	return paths
}

func normalizeProviderEndpointPath(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		return trimmed
	}
	if !strings.HasPrefix(trimmed, "/") {
		trimmed = "/" + trimmed
	}
	return trimmed
}

func isMiniMaxNativeTTSPath(endpointPath string) bool {
	lower := strings.ToLower(strings.TrimSpace(endpointPath))
	return strings.Contains(lower, "t2a")
}

func extractSpeechArtifactFromResponseBody(body *jsonOrBinaryBody) ([]byte, string) {
	if body == nil {
		return nil, ""
	}
	if strings.TrimSpace(body.text) != "" {
		return nil, ""
	}
	mimeType := strings.TrimSpace(body.mime)
	payload := append([]byte(nil), body.bytes...)
	if len(payload) == 0 {
		return nil, mimeType
	}
	looksLikeJSON := payload[0] == '{' || payload[0] == '['
	if strings.Contains(strings.ToLower(mimeType), "application/json") || looksLikeJSON {
		parsed := map[string]any{}
		if err := json.Unmarshal(payload, &parsed); err == nil {
			if artifactBytes, parsedMIME, _ := extractArtifactBytesAndMIME(parsed); len(artifactBytes) > 0 {
				if strings.TrimSpace(parsedMIME) != "" {
					mimeType = strings.TrimSpace(parsedMIME)
				}
				return artifactBytes, mimeType
			}
			return nil, mimeType
		}
	}
	return payload, mimeType
}

func executeMiniMaxTranscribe(
	ctx context.Context,
	baseURL string,
	apiKey string,
	modelResolved string,
	spec *runtimev1.SpeechTranscriptionSpec,
	audioBytes []byte,
	mimeType string,
) (string, string, error) {
	paths := resolveMiniMaxTranscriptionPaths(spec)
	if len(paths) == 0 {
		return "", "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
	var lastErr error
	for _, endpointPath := range paths {
		text, err := executeGLMTranscribe(ctx, joinURL(baseURL, endpointPath), apiKey, modelResolved, spec, audioBytes, mimeType)
		if err == nil {
			return text, endpointPath, nil
		}
		if status.Code(err) == codes.NotFound {
			lastErr = err
			continue
		}
		return "", "", err
	}
	if lastErr != nil {
		return "", "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
	return "", "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
}

func (s *Service) executeGLMTask(
	ctx context.Context,
	jobID string,
	req *runtimev1.SubmitMediaJobRequest,
	modelResolved string,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(s.config.CloudGLMBaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	apiKey := strings.TrimSpace(s.config.CloudGLMAPIKey)
	if req.GetModal() != runtimev1.Modal_MODAL_VIDEO {
		return nil, nil, "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
	spec := req.GetVideoSpec()
	if spec == nil {
		return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}

	submitPath, queryPrefix := resolveGLMTaskPaths(baseURL)
	submitPayload := map[string]any{
		"model":           modelResolved,
		"prompt":          spec.GetPrompt(),
		"negative_prompt": spec.GetNegativePrompt(),
		"duration_sec":    spec.GetDurationSec(),
		"fps":             spec.GetFps(),
		"resolution":      spec.GetResolution(),
		"aspect_ratio":    spec.GetAspectRatio(),
		"first_frame_uri": spec.GetFirstFrameUri(),
		"last_frame_uri":  spec.GetLastFrameUri(),
		"camera_motion":   spec.GetCameraMotion(),
	}
	if opts := structToMap(extractProviderOptions(req)); len(opts) > 0 {
		submitPayload["provider_options"] = opts
	}
	submitResp := map[string]any{}
	if err := doJSONRequest(ctx, http.MethodPost, joinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp); err != nil {
		return nil, nil, "", err
	}
	providerJobID := firstNonEmptyString(
		valueAsString(submitResp["task_id"]),
		valueAsString(submitResp["taskId"]),
		valueAsString(submitResp["id"]),
		valueAsString(mapField(submitResp["data"], "id")),
	)
	if providerJobID == "" {
		return nil, nil, "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	s.updateMediaJobPollState(jobID, providerJobID, 0, timestamppb.New(time.Now().UTC().Add(500*time.Millisecond)), "")
	retryCount := int32(0)

	for {
		if ctx.Err() != nil {
			return nil, nil, providerJobID, mapProviderRequestError(ctx.Err())
		}
		retryCount++
		pollResp := map[string]any{}
		pollPath := joinURL(baseURL, queryPrefix+url.PathEscape(providerJobID))
		if err := doJSONRequest(ctx, http.MethodGet, pollPath, apiKey, nil, &pollResp); err != nil {
			return nil, nil, providerJobID, err
		}
		statusText := strings.ToLower(strings.TrimSpace(firstNonEmptyString(
			valueAsString(pollResp["status"]),
			valueAsString(pollResp["task_status"]),
			valueAsString(mapField(pollResp["result"], "status")),
		)))
		switch statusText {
		case "", "queued", "pending", "running", "processing", "in_progress":
			s.updateMediaJobPollState(jobID, providerJobID, retryCount, timestamppb.New(time.Now().UTC().Add(500*time.Millisecond)), "")
			time.Sleep(500 * time.Millisecond)
			continue
		case "failed", "error", "canceled", "cancelled":
			s.updateMediaJobPollState(jobID, providerJobID, retryCount, nil, statusText)
			return nil, nil, providerJobID, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
		}

		artifactBytes, mimeType, artifactURI := extractArtifactBytesAndMIME(pollResp)
		if len(artifactBytes) == 0 {
			s.updateMediaJobPollState(jobID, providerJobID, retryCount, nil, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
			return nil, nil, providerJobID, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		if mimeType == "" {
			mimeType = "video/mp4"
		}
		providerRaw := map[string]any{
			"adapter":  adapterGLMTask,
			"response": pollResp,
		}
		if artifactURI != "" {
			providerRaw["uri"] = artifactURI
		}
		artifact := binaryArtifact(mimeType, artifactBytes, providerRaw)
		applyVideoSpecMetadata(artifact, spec)
		s.updateMediaJobPollState(jobID, providerJobID, retryCount, nil, "")
		return []*runtimev1.MediaArtifact{artifact}, artifactUsage(spec.GetPrompt(), artifactBytes, 420), providerJobID, nil
	}
}

func resolveGLMTaskPaths(baseURL string) (string, string) {
	return resolveGLMAPIPath(baseURL, "videos/generations"), resolveGLMAPIPath(baseURL, "async-result") + "/"
}

func resolveGLMAPIPath(baseURL string, relative string) string {
	trimmed := strings.Trim(strings.TrimSpace(relative), "/")
	if trimmed == "" {
		return ""
	}
	normalized := strings.ToLower(strings.TrimSpace(baseURL))
	if strings.Contains(normalized, "/api/paas/v4") {
		return "/" + trimmed
	}
	return "/api/paas/v4/" + trimmed
}

func (s *Service) executeGLMNative(
	ctx context.Context,
	req *runtimev1.SubmitMediaJobRequest,
	modelResolved string,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(s.config.CloudGLMBaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	apiKey := strings.TrimSpace(s.config.CloudGLMAPIKey)

	switch req.GetModal() {
	case runtimev1.Modal_MODAL_IMAGE:
		spec := req.GetImageSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		payload := map[string]any{
			"model":  modelResolved,
			"prompt": strings.TrimSpace(spec.GetPrompt()),
		}
		if negativePrompt := strings.TrimSpace(spec.GetNegativePrompt()); negativePrompt != "" {
			payload["negative_prompt"] = negativePrompt
		}
		if size := strings.TrimSpace(spec.GetSize()); size != "" {
			payload["size"] = size
		}
		if n := spec.GetN(); n > 0 {
			payload["n"] = n
		}
		if options := structToMap(spec.GetProviderOptions()); len(options) > 0 {
			payload["provider_options"] = options
		}
		responsePayload := map[string]any{}
		if err := doJSONRequest(ctx, http.MethodPost, joinURL(baseURL, resolveGLMAPIPath(baseURL, "images/generations")), apiKey, payload, &responsePayload); err != nil {
			return nil, nil, "", err
		}
		artifactBytes, mimeType, artifactURI := extractBinaryArtifactBytesAndMIME(responsePayload)
		if len(artifactBytes) == 0 {
			artifactBytes, mimeType, artifactURI = extractImageArtifactFromAny(responsePayload["data"])
		}
		if len(artifactBytes) == 0 {
			return nil, nil, "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		if mimeType == "" {
			mimeType = resolveImageArtifactMIME(spec, artifactBytes)
		}
		providerRaw := map[string]any{
			"adapter":          adapterGLMNative,
			"response":         responsePayload,
			"prompt":           strings.TrimSpace(spec.GetPrompt()),
			"negative_prompt":  strings.TrimSpace(spec.GetNegativePrompt()),
			"size":             strings.TrimSpace(spec.GetSize()),
			"aspect_ratio":     strings.TrimSpace(spec.GetAspectRatio()),
			"quality":          strings.TrimSpace(spec.GetQuality()),
			"style":            strings.TrimSpace(spec.GetStyle()),
			"response_format":  strings.TrimSpace(spec.GetResponseFormat()),
			"reference_images": append([]string(nil), spec.GetReferenceImages()...),
			"mask":             strings.TrimSpace(spec.GetMask()),
			"provider_options": structToMap(spec.GetProviderOptions()),
		}
		if artifactURI != "" {
			providerRaw["uri"] = artifactURI
		}
		artifact := binaryArtifact(mimeType, artifactBytes, providerRaw)
		applyImageSpecMetadata(artifact, spec)
		return []*runtimev1.MediaArtifact{artifact}, artifactUsage(spec.GetPrompt(), artifactBytes, 180), "", nil
	case runtimev1.Modal_MODAL_TTS:
		spec := req.GetSpeechSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		payload := map[string]any{
			"model": modelResolved,
			"input": strings.TrimSpace(spec.GetText()),
		}
		if voice := strings.TrimSpace(spec.GetVoice()); voice != "" {
			payload["voice"] = voice
		}
		if language := strings.TrimSpace(spec.GetLanguage()); language != "" {
			payload["language"] = language
		}
		if speed := spec.GetSpeed(); speed > 0 {
			payload["speed"] = speed
		}
		if options := structToMap(spec.GetProviderOptions()); len(options) > 0 {
			payload["provider_options"] = options
		}
		body, err := doJSONOrBinaryRequest(ctx, http.MethodPost, joinURL(baseURL, resolveGLMAPIPath(baseURL, "audio/speech")), apiKey, payload)
		if err != nil {
			return nil, nil, "", err
		}
		if body == nil || len(body.bytes) == 0 || strings.TrimSpace(body.text) != "" {
			return nil, nil, "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		mimeType := resolveSpeechArtifactMIME(spec, body.bytes)
		if normalized := strings.TrimSpace(body.mime); strings.HasPrefix(normalized, "audio/") {
			mimeType = normalized
		}
		artifact := binaryArtifact(mimeType, body.bytes, map[string]any{
			"adapter":          adapterGLMNative,
			"voice":            strings.TrimSpace(spec.GetVoice()),
			"language":         strings.TrimSpace(spec.GetLanguage()),
			"audio_format":     strings.TrimSpace(spec.GetAudioFormat()),
			"emotion":          strings.TrimSpace(spec.GetEmotion()),
			"provider_options": structToMap(spec.GetProviderOptions()),
		})
		applySpeechSpecMetadata(artifact, spec)
		return []*runtimev1.MediaArtifact{artifact}, artifactUsage(spec.GetText(), body.bytes, 120), "", nil
	case runtimev1.Modal_MODAL_STT:
		spec := req.GetTranscriptionSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		audioBytes, mimeType, audioURI, err := resolveTranscriptionAudioSource(ctx, spec)
		if err != nil {
			return nil, nil, "", err
		}
		text, err := executeGLMTranscribe(ctx, joinURL(baseURL, resolveGLMAPIPath(baseURL, "audio/transcriptions")), apiKey, modelResolved, spec, audioBytes, mimeType)
		if err != nil {
			return nil, nil, "", err
		}
		usage := &runtimev1.UsageStats{
			InputTokens:  maxInt64(1, int64(len(audioBytes)/256)),
			OutputTokens: estimateTokens(text),
			ComputeMs:    maxInt64(10, int64(len(audioBytes)/64)),
		}
		artifact := binaryArtifact(resolveTranscriptionArtifactMIME(spec), []byte(text), map[string]any{
			"text":             text,
			"adapter":          adapterGLMNative,
			"language":         strings.TrimSpace(spec.GetLanguage()),
			"timestamps":       spec.GetTimestamps(),
			"diarization":      spec.GetDiarization(),
			"speaker_count":    spec.GetSpeakerCount(),
			"response_format":  strings.TrimSpace(spec.GetResponseFormat()),
			"mime_type":        mimeType,
			"audio_uri":        audioURI,
			"provider_options": structToMap(spec.GetProviderOptions()),
		})
		applyTranscriptionSpecMetadata(artifact, spec, audioURI)
		return []*runtimev1.MediaArtifact{artifact}, usage, "", nil
	default:
		return nil, nil, "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
}

func (s *Service) executeKimiImageChatMultimodal(
	ctx context.Context,
	req *runtimev1.SubmitMediaJobRequest,
	modelResolved string,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(s.config.CloudKimiBaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	if req.GetModal() != runtimev1.Modal_MODAL_IMAGE {
		return nil, nil, "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
	spec := req.GetImageSpec()
	if spec == nil {
		return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	apiKey := strings.TrimSpace(s.config.CloudKimiAPIKey)
	payload := buildKimiImageChatPayload(modelResolved, spec)
	responsePayload := map[string]any{}
	if err := doJSONRequest(ctx, http.MethodPost, joinURL(baseURL, "/v1/chat/completions"), apiKey, payload, &responsePayload); err != nil {
		return nil, nil, "", err
	}

	artifactBytes, mimeType, artifactURI := extractKimiImageArtifact(responsePayload)
	if len(artifactBytes) == 0 {
		return nil, nil, "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	if mimeType == "" {
		mimeType = resolveImageArtifactMIME(spec, artifactBytes)
	}
	providerRaw := map[string]any{
		"adapter":          adapterKimiChatMultimodal,
		"response":         responsePayload,
		"prompt":           strings.TrimSpace(spec.GetPrompt()),
		"negative_prompt":  strings.TrimSpace(spec.GetNegativePrompt()),
		"size":             strings.TrimSpace(spec.GetSize()),
		"aspect_ratio":     strings.TrimSpace(spec.GetAspectRatio()),
		"quality":          strings.TrimSpace(spec.GetQuality()),
		"style":            strings.TrimSpace(spec.GetStyle()),
		"response_format":  strings.TrimSpace(spec.GetResponseFormat()),
		"reference_images": append([]string(nil), spec.GetReferenceImages()...),
		"mask":             strings.TrimSpace(spec.GetMask()),
		"provider_options": structToMap(spec.GetProviderOptions()),
	}
	if artifactURI != "" {
		providerRaw["uri"] = artifactURI
	}
	artifact := binaryArtifact(mimeType, artifactBytes, providerRaw)
	applyImageSpecMetadata(artifact, spec)
	return []*runtimev1.MediaArtifact{artifact}, artifactUsage(spec.GetPrompt(), artifactBytes, 180), "", nil
}

func buildKimiImageChatPayload(modelResolved string, spec *runtimev1.ImageGenerationSpec) map[string]any {
	resolvedModelID := stripProviderModelPrefix(modelResolved, "kimi", "moonshot")
	contentParts := make([]any, 0, 1+len(spec.GetReferenceImages()))
	contentParts = append(contentParts, map[string]any{
		"type": "text",
		"text": strings.TrimSpace(spec.GetPrompt()),
	})
	for _, raw := range spec.GetReferenceImages() {
		uri := strings.TrimSpace(raw)
		if uri == "" {
			continue
		}
		contentParts = append(contentParts, map[string]any{
			"type": "image_url",
			"image_url": map[string]any{
				"url": uri,
			},
		})
	}

	response := map[string]any{
		"modalities": []string{"image"},
	}
	responseFormat := strings.TrimSpace(spec.GetResponseFormat())
	if responseFormat != "" {
		response["output_image_format"] = responseFormat
	}
	if spec.GetN() > 0 {
		response["n"] = spec.GetN()
	}

	payload := map[string]any{
		"model": resolvedModelID,
		"messages": []any{
			map[string]any{
				"role":    "user",
				"content": contentParts,
			},
		},
		"response": response,
	}
	if negativePrompt := strings.TrimSpace(spec.GetNegativePrompt()); negativePrompt != "" {
		payload["negative_prompt"] = negativePrompt
	}
	if size := strings.TrimSpace(spec.GetSize()); size != "" {
		payload["size"] = size
	}
	if aspectRatio := strings.TrimSpace(spec.GetAspectRatio()); aspectRatio != "" {
		payload["aspect_ratio"] = aspectRatio
	}
	if quality := strings.TrimSpace(spec.GetQuality()); quality != "" {
		payload["quality"] = quality
	}
	if style := strings.TrimSpace(spec.GetStyle()); style != "" {
		payload["style"] = style
	}
	if seed := spec.GetSeed(); seed != 0 {
		payload["seed"] = seed
	}
	if mask := strings.TrimSpace(spec.GetMask()); mask != "" {
		payload["mask"] = mask
	}
	if options := structToMap(spec.GetProviderOptions()); len(options) > 0 {
		payload["provider_options"] = options
	}
	return payload
}

func stripProviderModelPrefix(modelID string, prefixes ...string) string {
	trimmed := strings.TrimSpace(modelID)
	if trimmed == "" {
		return trimmed
	}
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) != 2 {
		return trimmed
	}
	prefix := strings.ToLower(strings.TrimSpace(parts[0]))
	rest := strings.TrimSpace(parts[1])
	if rest == "" {
		return trimmed
	}
	for _, candidate := range prefixes {
		if prefix == strings.ToLower(strings.TrimSpace(candidate)) {
			return rest
		}
	}
	return trimmed
}

func extractKimiImageArtifact(payload map[string]any) ([]byte, string, string) {
	if artifactBytes, mimeType, artifactURI := extractBinaryArtifactBytesAndMIME(payload); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	if artifactBytes, mimeType, artifactURI := extractImageArtifactFromAny(payload["choices"]); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	if artifactBytes, mimeType, artifactURI := extractImageArtifactFromAny(payload["output"]); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	if artifactBytes, mimeType, artifactURI := extractImageArtifactFromAny(payload["data"]); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	return nil, "", ""
}

func extractImageArtifactFromAny(value any) ([]byte, string, string) {
	switch typed := value.(type) {
	case map[string]any:
		return extractImageArtifactFromMap(typed)
	case []any:
		for _, item := range typed {
			if artifactBytes, mimeType, artifactURI := extractImageArtifactFromAny(item); len(artifactBytes) > 0 {
				return artifactBytes, mimeType, artifactURI
			}
		}
	case string:
		uri := strings.TrimSpace(typed)
		if strings.HasPrefix(uri, "http://") || strings.HasPrefix(uri, "https://") {
			return extractBinaryArtifactBytesAndMIME(map[string]any{
				"url": uri,
			})
		}
	}
	return nil, "", ""
}

func extractImageArtifactFromMap(payload map[string]any) ([]byte, string, string) {
	if payload == nil {
		return nil, "", ""
	}
	if artifactBytes, mimeType, artifactURI := extractBinaryArtifactBytesAndMIME(payload); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}

	mimeType := firstNonEmptyString(
		valueAsString(payload["mime_type"]),
		valueAsString(payload["content_type"]),
	)
	for _, key := range []string{"b64_json", "image_base64", "base64", "data", "image"} {
		if decoded, ok := decodeBase64ArtifactPayload(valueAsString(payload[key])); ok {
			return decoded, mimeType, ""
		}
	}
	if imageURL := payload["image_url"]; imageURL != nil {
		switch typed := imageURL.(type) {
		case string:
			return extractBinaryArtifactBytesAndMIME(map[string]any{
				"url":       typed,
				"mime_type": mimeType,
			})
		case map[string]any:
			if artifactBytes, nestedMIME, artifactURI := extractImageArtifactFromMap(typed); len(artifactBytes) > 0 {
				return artifactBytes, firstNonEmptyString(mimeType, nestedMIME), artifactURI
			}
		}
	}
	if artifactBytes, nestedMIME, artifactURI := extractImageArtifactFromAny(payload["content"]); len(artifactBytes) > 0 {
		return artifactBytes, firstNonEmptyString(mimeType, nestedMIME), artifactURI
	}
	if artifactBytes, nestedMIME, artifactURI := extractImageArtifactFromAny(payload["message"]); len(artifactBytes) > 0 {
		return artifactBytes, firstNonEmptyString(mimeType, nestedMIME), artifactURI
	}
	return nil, "", ""
}

func decodeBase64ArtifactPayload(raw string) ([]byte, bool) {
	encoded := strings.TrimSpace(raw)
	if encoded == "" {
		return nil, false
	}
	if strings.HasPrefix(strings.ToLower(encoded), "data:") {
		separator := strings.Index(encoded, ",")
		if separator <= 0 {
			return nil, false
		}
		encoded = strings.TrimSpace(encoded[separator+1:])
	}
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(decoded) == 0 {
		return nil, false
	}
	return decoded, true
}

func (s *Service) updateMediaJobPollState(
	jobID string,
	providerJobID string,
	retryCount int32,
	nextPollAt *timestamppb.Timestamp,
	lastError string,
) {
	_, _ = s.mediaJobs.transition(
		jobID,
		runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_UNSPECIFIED,
		runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_TYPE_UNSPECIFIED,
		func(job *runtimev1.MediaJob) {
			job.ProviderJobId = strings.TrimSpace(providerJobID)
			job.RetryCount = retryCount
			job.NextPollAt = nextPollAt
			job.ReasonDetail = strings.TrimSpace(lastError)
		},
	)
}

type jsonOrBinaryBody struct {
	bytes []byte
	text  string
	mime  string
}

func doJSONOrBinaryRequest(
	ctx context.Context,
	method string,
	targetURL string,
	apiKey string,
	body any,
) (*jsonOrBinaryBody, error) {
	requestBody, err := json.Marshal(body)
	if err != nil {
		return nil, mapProviderRequestError(err)
	}
	request, err := http.NewRequestWithContext(ctx, method, targetURL, strings.NewReader(string(requestBody)))
	if err != nil {
		return nil, mapProviderRequestError(err)
	}
	request.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(apiKey) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, mapProviderRequestError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return nil, mapProviderHTTPError(response.StatusCode, payload)
	}
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	contentType := strings.ToLower(strings.TrimSpace(response.Header.Get("Content-Type")))
	looksLikeJSON := len(raw) > 0 && (raw[0] == '{' || raw[0] == '[')
	if strings.Contains(contentType, "application/json") || looksLikeJSON {
		parsed := map[string]any{}
		if unmarshalErr := json.Unmarshal(raw, &parsed); unmarshalErr == nil {
			if text := strings.TrimSpace(firstNonEmptyString(
				valueAsString(parsed["text"]),
				valueAsString(mapField(parsed["result"], "text")),
			)); text != "" {
				return &jsonOrBinaryBody{bytes: []byte(text), text: text, mime: contentType}, nil
			}
			if b64 := strings.TrimSpace(firstNonEmptyString(
				valueAsString(parsed["audio"]),
				valueAsString(parsed["audio_base64"]),
				valueAsString(parsed["b64_json"]),
				valueAsString(mapField(parsed["result"], "audio")),
				valueAsString(mapField(parsed["result"], "audio_base64")),
				valueAsString(mapField(parsed["data"], "audio")),
				valueAsString(mapField(parsed["data"], "audio_base64")),
				valueAsString(mapField(parsed["output"], "audio")),
			)); b64 != "" {
				decoded, decodeErr := base64.StdEncoding.DecodeString(b64)
				if decodeErr == nil {
					return &jsonOrBinaryBody{bytes: decoded, mime: contentType}, nil
				}
			}
		}
	}
	return &jsonOrBinaryBody{bytes: raw, mime: contentType}, nil
}

func doJSONRequest(
	ctx context.Context,
	method string,
	targetURL string,
	apiKey string,
	body any,
	target *map[string]any,
) error {
	var requestBody io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return mapProviderRequestError(err)
		}
		requestBody = strings.NewReader(string(raw))
	}
	request, err := http.NewRequestWithContext(ctx, method, targetURL, requestBody)
	if err != nil {
		return mapProviderRequestError(err)
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(apiKey) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return mapProviderRequestError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return mapProviderHTTPError(response.StatusCode, payload)
	}
	if target == nil {
		return nil
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	return nil
}

func executeGLMTranscribe(
	ctx context.Context,
	targetURL string,
	apiKey string,
	modelID string,
	spec *runtimev1.SpeechTranscriptionSpec,
	audio []byte,
	mimeType string,
) (string, error) {
	if len(audio) == 0 {
		return "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if err := writer.WriteField("model", modelID); err != nil {
		return "", mapProviderRequestError(err)
	}
	if strings.TrimSpace(mimeType) != "" {
		if err := writer.WriteField("mime_type", strings.TrimSpace(mimeType)); err != nil {
			return "", mapProviderRequestError(err)
		}
	}
	if spec != nil {
		if language := strings.TrimSpace(spec.GetLanguage()); language != "" {
			if err := writer.WriteField("language", language); err != nil {
				return "", mapProviderRequestError(err)
			}
		}
		if prompt := strings.TrimSpace(spec.GetPrompt()); prompt != "" {
			if err := writer.WriteField("prompt", prompt); err != nil {
				return "", mapProviderRequestError(err)
			}
		}
		if format := strings.TrimSpace(spec.GetResponseFormat()); format != "" {
			if err := writer.WriteField("response_format", format); err != nil {
				return "", mapProviderRequestError(err)
			}
		}
		if spec.GetTimestamps() {
			if err := writer.WriteField("timestamps", "true"); err != nil {
				return "", mapProviderRequestError(err)
			}
		}
		if spec.GetDiarization() {
			if err := writer.WriteField("diarization", "true"); err != nil {
				return "", mapProviderRequestError(err)
			}
		}
		if spec.GetSpeakerCount() > 0 {
			if err := writer.WriteField("speaker_count", strconv.FormatInt(int64(spec.GetSpeakerCount()), 10)); err != nil {
				return "", mapProviderRequestError(err)
			}
		}
		if options := structToMap(spec.GetProviderOptions()); len(options) > 0 {
			raw, marshalErr := json.Marshal(options)
			if marshalErr != nil {
				return "", mapProviderRequestError(marshalErr)
			}
			if err := writer.WriteField("provider_options", string(raw)); err != nil {
				return "", mapProviderRequestError(err)
			}
		}
	}
	fileWriter, err := writer.CreateFormFile("file", "audio.bin")
	if err != nil {
		return "", mapProviderRequestError(err)
	}
	if _, err := fileWriter.Write(audio); err != nil {
		return "", mapProviderRequestError(err)
	}
	if err := writer.Close(); err != nil {
		return "", mapProviderRequestError(err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, body)
	if err != nil {
		return "", mapProviderRequestError(err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Accept", "application/json")
	if strings.TrimSpace(apiKey) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", mapProviderRequestError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return "", mapProviderHTTPError(response.StatusCode, payload)
	}
	payload := map[string]any{}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	text := strings.TrimSpace(firstNonEmptyString(
		valueAsString(payload["text"]),
		valueAsString(mapField(payload["result"], "text")),
		valueAsString(mapField(payload["data"], "text")),
	))
	if text == "" {
		return "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	return text, nil
}

func extractArtifactBytesAndMIME(payload map[string]any) ([]byte, string, string) {
	if payload == nil {
		return nil, "", ""
	}
	if artifactBytes, mimeType, artifactURI := extractBinaryArtifactBytesAndMIME(payload); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	if text := strings.TrimSpace(firstNonEmptyString(
		valueAsString(payload["artifact_text"]),
		valueAsString(payload["text"]),
		valueAsString(mapField(payload["result"], "text")),
	)); text != "" {
		return []byte(text), "text/plain", ""
	}
	return nil, "", ""
}

func extractBinaryArtifactBytesAndMIME(payload map[string]any) ([]byte, string, string) {
	if payload == nil {
		return nil, "", ""
	}
	paths := []string{
		valueAsString(payload["b64_json"]),
		valueAsString(payload["b64_mp4"]),
		valueAsString(payload["audio"]),
		valueAsString(payload["audio_base64"]),
		valueAsString(mapField(payload["artifact"], "b64_json")),
		valueAsString(mapField(payload["artifact"], "b64_mp4")),
		valueAsString(mapField(payload["artifact"], "audio")),
		valueAsString(mapField(payload["artifact"], "audio_base64")),
		valueAsString(mapField(payload["result"], "b64_json")),
		valueAsString(mapField(payload["result"], "b64_mp4")),
		valueAsString(mapField(payload["result"], "audio")),
		valueAsString(mapField(payload["result"], "audio_base64")),
		valueAsString(mapField(payload["data"], "audio")),
		valueAsString(mapField(payload["data"], "audio_base64")),
		valueAsString(mapField(payload["output"], "audio")),
	}
	for _, raw := range paths {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		decoded, err := base64.StdEncoding.DecodeString(trimmed)
		if err == nil && len(decoded) > 0 {
			return decoded, firstNonEmptyString(
				valueAsString(payload["mime_type"]),
				valueAsString(mapField(payload["artifact"], "mime_type")),
				valueAsString(mapField(payload["result"], "mime_type")),
			), ""
		}
	}
	artifactURI := strings.TrimSpace(firstNonEmptyString(
		valueAsString(payload["url"]),
		valueAsString(payload["audio_url"]),
		valueAsString(mapField(payload["artifact"], "url")),
		valueAsString(mapField(payload["artifact"], "audio_url")),
		valueAsString(mapField(payload["result"], "url")),
		valueAsString(mapField(payload["result"], "audio_url")),
		valueAsString(mapField(payload["data"], "url")),
		valueAsString(mapField(payload["data"], "audio_url")),
		valueAsString(mapField(payload["output"], "url")),
		valueAsString(mapField(payload["output"], "audio_url")),
	))
	if artifactURI != "" {
		response, err := http.Get(artifactURI)
		if err == nil {
			defer response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 300 {
				raw, readErr := io.ReadAll(response.Body)
				if readErr == nil && len(raw) > 0 {
					return raw, firstNonEmptyString(
						valueAsString(payload["mime_type"]),
						response.Header.Get("Content-Type"),
					), artifactURI
				}
			}
		}
	}
	return nil, "", ""
}

func joinURL(baseURL string, suffix string) string {
	base := strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	if base == "" {
		return ""
	}
	suffixPath := strings.TrimSpace(suffix)
	if suffixPath == "" {
		return base
	}
	if strings.HasPrefix(suffixPath, "http://") || strings.HasPrefix(suffixPath, "https://") {
		return suffixPath
	}
	if !strings.HasPrefix(suffixPath, "/") {
		suffixPath = "/" + suffixPath
	}
	return base + suffixPath
}

func structToMap(input *structpb.Struct) map[string]any {
	if input == nil {
		return map[string]any{}
	}
	return input.AsMap()
}

func mapField(value any, key string) any {
	object, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	return object[key]
}

func valueAsString(value any) string {
	switch item := value.(type) {
	case string:
		return item
	case fmt.Stringer:
		return item.String()
	default:
		return ""
	}
}

func valueAsBool(value any) bool {
	switch item := value.(type) {
	case bool:
		return item
	case string:
		lower := strings.ToLower(strings.TrimSpace(item))
		return lower == "true" || lower == "1" || lower == "yes"
	case float64:
		return item != 0
	default:
		return false
	}
}

func valueAsInt64(value any) int64 {
	switch item := value.(type) {
	case int:
		return int64(item)
	case int32:
		return int64(item)
	case int64:
		return item
	case float32:
		return int64(item)
	case float64:
		return int64(item)
	case string:
		parsed, err := strconv.ParseInt(strings.TrimSpace(item), 10, 64)
		if err == nil {
			return parsed
		}
		parsedFloat, floatErr := strconv.ParseFloat(strings.TrimSpace(item), 64)
		if floatErr == nil {
			return int64(parsedFloat)
		}
	}
	return 0
}

func valueAsInt32(value any) int32 {
	parsed := valueAsInt64(value)
	if parsed <= 0 {
		return 0
	}
	if parsed > int64(^uint32(0)>>1) {
		return 0
	}
	return int32(parsed)
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstNonEmptyString(values ...string) string {
	return firstNonEmpty(values...)
}
