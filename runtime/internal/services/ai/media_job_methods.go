package ai

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
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
	adapterGeminiOperation     = "gemini_operation_adapter"
	adapterMiniMaxTask         = "minimax_task_adapter"
)

func (s *Service) SubmitMediaJob(ctx context.Context, req *runtimev1.SubmitMediaJobRequest) (*runtimev1.SubmitMediaJobResponse, error) {
	if err := validateSubmitMediaJobRequest(req); err != nil {
		return nil, err
	}
	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetAppId())
	if acquireErr != nil {
		return nil, status.Error(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("submit_media_job", req.GetAppId(), acquireResult)

	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProvider(req.GetRoutePolicy(), req.GetFallback(), req.GetModelId())
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
		JobId:          jobID,
		AppId:          req.GetAppId(),
		SubjectUserId:  req.GetSubjectUserId(),
		ModelId:        req.GetModelId(),
		Modal:          req.GetModal(),
		RoutePolicy:    req.GetRoutePolicy(),
		RouteDecision:  routeDecision,
		ModelResolved:  modelResolved,
		Status:         runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_SUBMITTED,
		ReasonCode:     runtimev1.ReasonCode_ACTION_EXECUTED,
		ProviderOptions: cloneStructPB(extractProviderOptions(req)),
		TraceId:        traceID,
		CreatedAt:      timestamppb.New(time.Now().UTC()),
		UpdatedAt:      timestamppb.New(time.Now().UTC()),
	}
	snapshot := s.mediaJobs.create(job, cancel)
	if snapshot == nil {
		cancel()
		return nil, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
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
	case adapterGeminiOperation:
		artifacts, usage, providerJobID, err = s.executeGeminiOperation(ctx, req, modelResolved)
	case adapterMiniMaxTask:
		artifacts, usage, providerJobID, err = s.executeMiniMaxTask(ctx, req, modelResolved)
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
		payload, usage, err := selectedProvider.generateImage(ctx, modelResolved, spec.GetPrompt())
		if err != nil {
			return nil, nil, "", err
		}
		return []*runtimev1.MediaArtifact{binaryArtifact("image/png", payload, nil)}, usage, "", nil
	case runtimev1.Modal_MODAL_VIDEO:
		spec := req.GetVideoSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		payload, usage, err := selectedProvider.generateVideo(ctx, modelResolved, spec.GetPrompt())
		if err != nil {
			return nil, nil, "", err
		}
		return []*runtimev1.MediaArtifact{binaryArtifact("video/mp4", payload, nil)}, usage, "", nil
	case runtimev1.Modal_MODAL_TTS:
		spec := req.GetSpeechSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		payload, usage, err := selectedProvider.synthesizeSpeech(ctx, modelResolved, spec.GetText())
		if err != nil {
			return nil, nil, "", err
		}
		mimeType := "audio/mpeg"
		if strings.TrimSpace(spec.GetAudioFormat()) != "" {
			mimeType = "audio/" + strings.TrimPrefix(strings.TrimSpace(spec.GetAudioFormat()), ".")
		}
		artifact := binaryArtifact(mimeType, payload, map[string]any{
			"adapter": adapterName,
			"voice":   strings.TrimSpace(spec.GetVoice()),
		})
		if spec.GetSampleRateHz() > 0 {
			artifact.SampleRateHz = spec.GetSampleRateHz()
		}
		return []*runtimev1.MediaArtifact{artifact}, usage, "", nil
	case runtimev1.Modal_MODAL_STT:
		spec := req.GetTranscriptionSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		audio := spec.GetAudioBytes()
		text, usage, err := selectedProvider.transcribe(ctx, modelResolved, audio, spec.GetMimeType())
		if err != nil {
			return nil, nil, "", err
		}
		artifact := binaryArtifact("text/plain", []byte(text), map[string]any{
			"text":        text,
			"adapter":     adapterName,
			"language":    strings.TrimSpace(spec.GetLanguage()),
			"timestamps":  spec.GetTimestamps(),
			"diarization": spec.GetDiarization(),
		})
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
	case strings.Contains(joined, "gemini/"):
		return adapterGeminiOperation
	case strings.Contains(joined, "minimax/"):
		return adapterMiniMaxTask
	case strings.Contains(joined, "bytedance/"), strings.Contains(joined, "byte/"):
		if modal == runtimev1.Modal_MODAL_TTS || modal == runtimev1.Modal_MODAL_STT {
			return adapterBytedanceOpenSpeech
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
	if req.GetModal() == runtimev1.Modal_MODAL_UNSPECIFIED {
		return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
	}
	switch req.GetModal() {
	case runtimev1.Modal_MODAL_IMAGE:
		if req.GetImageSpec() == nil || strings.TrimSpace(req.GetImageSpec().GetPrompt()) == "" {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
	case runtimev1.Modal_MODAL_VIDEO:
		if req.GetVideoSpec() == nil || strings.TrimSpace(req.GetVideoSpec().GetPrompt()) == "" {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
	case runtimev1.Modal_MODAL_TTS:
		if req.GetSpeechSpec() == nil || strings.TrimSpace(req.GetSpeechSpec().GetText()) == "" {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
	case runtimev1.Modal_MODAL_STT:
		spec := req.GetTranscriptionSpec()
		if spec == nil || (len(spec.GetAudioBytes()) == 0 && strings.TrimSpace(spec.GetAudioUri()) == "") {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
	default:
		return status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
	return nil
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

func binaryArtifact(mimeType string, payload []byte, providerRaw map[string]any) *runtimev1.MediaArtifact {
	if len(payload) == 0 {
		payload = []byte{}
	}
	sum := sha256.Sum256(payload)
	artifact := &runtimev1.MediaArtifact{
		ArtifactId: ulid.Make().String(),
		MimeType:   strings.TrimSpace(mimeType),
		Bytes:      append([]byte(nil), payload...),
		Sha256:     fmt.Sprintf("%x", sum),
		SizeBytes:  int64(len(payload)),
	}
	if len(providerRaw) > 0 {
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
		payload := map[string]any{
			"model": modelResolved,
			"text":  spec.GetText(),
			"voice": spec.GetVoice(),
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
		artifact := binaryArtifact("audio/mpeg", body.bytes, map[string]any{
			"adapter": adapterBytedanceOpenSpeech,
			"voice":   spec.GetVoice(),
		})
		if spec.GetSampleRateHz() > 0 {
			artifact.SampleRateHz = spec.GetSampleRateHz()
		}
		return []*runtimev1.MediaArtifact{artifact}, artifactUsage(spec.GetText(), body.bytes, 120), "", nil
	case runtimev1.Modal_MODAL_STT:
		spec := req.GetTranscriptionSpec()
		payload := map[string]any{
			"model":      modelResolved,
			"mime_type":  spec.GetMimeType(),
			"audio_base": base64.StdEncoding.EncodeToString(spec.GetAudioBytes()),
		}
		if spec.GetLanguage() != "" {
			payload["language"] = spec.GetLanguage()
		}
		if opts := structToMap(spec.GetProviderOptions()); len(opts) > 0 {
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
		artifact := binaryArtifact("text/plain", []byte(text), map[string]any{
			"text":    text,
			"adapter": adapterBytedanceOpenSpeech,
		})
		return []*runtimev1.MediaArtifact{artifact}, &runtimev1.UsageStats{
			InputTokens:  maxInt64(1, int64(len(spec.GetAudioBytes())/256)),
			OutputTokens: estimateTokens(text),
			ComputeMs:    maxInt64(10, int64(len(spec.GetAudioBytes())/64)),
		}, "", nil
	default:
		return nil, nil, "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
}

func (s *Service) executeGeminiOperation(
	ctx context.Context,
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
	switch req.GetModal() {
	case runtimev1.Modal_MODAL_IMAGE:
		submitPayload["prompt"] = req.GetImageSpec().GetPrompt()
	case runtimev1.Modal_MODAL_VIDEO:
		submitPayload["prompt"] = req.GetVideoSpec().GetPrompt()
	default:
		return nil, nil, "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
	if opts := structToMap(extractProviderOptions(req)); len(opts) > 0 {
		submitPayload["provider_options"] = opts
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

	for {
		if ctx.Err() != nil {
			return nil, nil, providerJobID, mapProviderRequestError(ctx.Err())
		}
		pollResp := map[string]any{}
		pollPath := joinURL(baseURL, path.Join("/operations", url.PathEscape(providerJobID)))
		if err := doJSONRequest(ctx, http.MethodGet, pollPath, apiKey, nil, &pollResp); err != nil {
			return nil, nil, providerJobID, err
		}
		done := valueAsBool(pollResp["done"])
		if !done {
			time.Sleep(500 * time.Millisecond)
			continue
		}
		statusText := strings.ToLower(strings.TrimSpace(valueAsString(pollResp["status"])))
		if statusText == "failed" || statusText == "error" {
			return nil, nil, providerJobID, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
		}
		artifactBytes, mimeType := extractArtifactBytesAndMIME(pollResp)
		if len(artifactBytes) == 0 {
			return nil, nil, providerJobID, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		if mimeType == "" {
			if req.GetModal() == runtimev1.Modal_MODAL_IMAGE {
				mimeType = "image/png"
			} else {
				mimeType = "video/mp4"
			}
		}
		artifact := binaryArtifact(mimeType, artifactBytes, map[string]any{
			"adapter": adapterGeminiOperation,
		})
		prompt := ""
		if req.GetImageSpec() != nil {
			prompt = req.GetImageSpec().GetPrompt()
		}
		if req.GetVideoSpec() != nil {
			prompt = req.GetVideoSpec().GetPrompt()
		}
		computeMs := int64(180)
		if req.GetModal() == runtimev1.Modal_MODAL_VIDEO {
			computeMs = 420
		}
		return []*runtimev1.MediaArtifact{artifact}, artifactUsage(prompt, artifactBytes, computeMs), providerJobID, nil
	}
}

func (s *Service) executeMiniMaxTask(
	ctx context.Context,
	req *runtimev1.SubmitMediaJobRequest,
	modelResolved string,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(s.config.CloudMiniMaxBaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	apiKey := strings.TrimSpace(s.config.CloudMiniMaxAPIKey)

	submitPath := "/v1/image_generation"
	queryPath := "/v1/query/image_generation"
	prompt := req.GetImageSpec().GetPrompt()
	defaultMIME := "image/png"
	if req.GetModal() == runtimev1.Modal_MODAL_VIDEO {
		submitPath = "/v1/video_generation"
		queryPath = "/v1/query/video_generation"
		prompt = req.GetVideoSpec().GetPrompt()
		defaultMIME = "video/mp4"
	}
	if req.GetModal() != runtimev1.Modal_MODAL_IMAGE && req.GetModal() != runtimev1.Modal_MODAL_VIDEO {
		return nil, nil, "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}

	submitPayload := map[string]any{
		"model":  modelResolved,
		"prompt": prompt,
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

	for {
		if ctx.Err() != nil {
			return nil, nil, providerJobID, mapProviderRequestError(ctx.Err())
		}
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
		statusText := strings.ToLower(strings.TrimSpace(valueAsString(pollResp["status"])))
		if statusText == "running" || statusText == "queued" || statusText == "processing" || statusText == "" {
			time.Sleep(500 * time.Millisecond)
			continue
		}
		if statusText == "failed" || statusText == "error" {
			return nil, nil, providerJobID, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
		}
		artifactBytes, mimeType := extractArtifactBytesAndMIME(pollResp)
		if len(artifactBytes) == 0 {
			return nil, nil, providerJobID, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		if mimeType == "" {
			mimeType = defaultMIME
		}
		artifact := binaryArtifact(mimeType, artifactBytes, map[string]any{
			"adapter": adapterMiniMaxTask,
		})
		computeMs := int64(180)
		if req.GetModal() == runtimev1.Modal_MODAL_VIDEO {
			computeMs = 420
		}
		return []*runtimev1.MediaArtifact{artifact}, artifactUsage(prompt, artifactBytes, computeMs), providerJobID, nil
	}
}

type jsonOrBinaryBody struct {
	bytes []byte
	text  string
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
	if strings.Contains(contentType, "application/json") {
		parsed := map[string]any{}
		if unmarshalErr := json.Unmarshal(raw, &parsed); unmarshalErr == nil {
			if text := strings.TrimSpace(firstNonEmptyString(
				valueAsString(parsed["text"]),
				valueAsString(mapField(parsed["result"], "text")),
			)); text != "" {
				return &jsonOrBinaryBody{bytes: []byte(text), text: text}, nil
			}
			if b64 := strings.TrimSpace(firstNonEmptyString(
				valueAsString(parsed["audio"]),
				valueAsString(parsed["audio_base64"]),
				valueAsString(parsed["b64_json"]),
				valueAsString(mapField(parsed["result"], "audio")),
			)); b64 != "" {
				decoded, decodeErr := base64.StdEncoding.DecodeString(b64)
				if decodeErr == nil {
					return &jsonOrBinaryBody{bytes: decoded}, nil
				}
			}
		}
	}
	return &jsonOrBinaryBody{bytes: raw}, nil
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

func extractArtifactBytesAndMIME(payload map[string]any) ([]byte, string) {
	if payload == nil {
		return nil, ""
	}
	paths := []string{
		valueAsString(payload["b64_json"]),
		valueAsString(payload["b64_mp4"]),
		valueAsString(mapField(payload["artifact"], "b64_json")),
		valueAsString(mapField(payload["artifact"], "b64_mp4")),
		valueAsString(mapField(payload["result"], "b64_json")),
		valueAsString(mapField(payload["result"], "b64_mp4")),
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
			)
		}
	}
	if text := strings.TrimSpace(firstNonEmptyString(
		valueAsString(payload["url"]),
		valueAsString(mapField(payload["artifact"], "url")),
		valueAsString(mapField(payload["result"], "url")),
	)); text != "" {
		response, err := http.Get(text)
		if err == nil {
			defer response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 300 {
				raw, readErr := io.ReadAll(response.Body)
				if readErr == nil && len(raw) > 0 {
					return raw, firstNonEmptyString(
						valueAsString(payload["mime_type"]),
						response.Header.Get("Content-Type"),
					)
				}
			}
		}
	}
	if text := strings.TrimSpace(firstNonEmptyString(
		valueAsString(payload["artifact_text"]),
		valueAsString(payload["text"]),
		valueAsString(mapField(payload["result"], "text")),
	)); text != "" {
		return []byte(text), "text/plain"
	}
	return nil, ""
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

func firstNonEmptyString(values ...string) string {
	return firstNonEmpty(values...)
}
