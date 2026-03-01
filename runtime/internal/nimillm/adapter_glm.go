package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterGLMTask = "glm_task_adapter"
const AdapterGLMNative = "glm_native_adapter"

// ExecuteGLMTask handles GLM async video generation via task submission and
// polling. Only MODAL_VIDEO is supported.
func ExecuteGLMTask(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitMediaJobRequest,
	modelResolved string,
	extractProviderOptions func(*runtimev1.SubmitMediaJobRequest) *structpb.Struct,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey := strings.TrimSpace(cfg.APIKey)
	if req.GetModal() != runtimev1.Modal_MODAL_VIDEO {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := req.GetVideoSpec()
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
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
	if opts := StructToMap(extractProviderOptions(req)); len(opts) > 0 {
		submitPayload["provider_options"] = opts
	}
	submitResp := map[string]any{}
	if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp); err != nil {
		return nil, nil, "", err
	}
	providerJobID := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(submitResp["task_id"]),
		ValueAsString(submitResp["taskId"]),
		ValueAsString(submitResp["id"]),
		ValueAsString(MapField(submitResp["data"], "id")),
	))
	if providerJobID == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	updater.UpdatePollState(jobID, providerJobID, 0, timestamppb.New(time.Now().UTC().Add(500*time.Millisecond)), "")
	retryCount := int32(0)

	for {
		if ctx.Err() != nil {
			return nil, nil, providerJobID, MapProviderRequestError(ctx.Err())
		}
		retryCount++
		pollResp := map[string]any{}
		pollPath := JoinURL(baseURL, queryPrefix+url.PathEscape(providerJobID))
		if err := DoJSONRequest(ctx, http.MethodGet, pollPath, apiKey, nil, &pollResp); err != nil {
			return nil, nil, providerJobID, err
		}
		statusText := strings.ToLower(strings.TrimSpace(FirstNonEmpty(
			ValueAsString(pollResp["status"]),
			ValueAsString(pollResp["task_status"]),
			ValueAsString(MapField(pollResp["result"], "status")),
		)))
		switch statusText {
		case "", "queued", "pending", "running", "processing", "in_progress":
			updater.UpdatePollState(jobID, providerJobID, retryCount, timestamppb.New(time.Now().UTC().Add(500*time.Millisecond)), "")
			time.Sleep(500 * time.Millisecond)
			continue
		case "failed", "error", "canceled", "cancelled":
			updater.UpdatePollState(jobID, providerJobID, retryCount, nil, statusText)
			return nil, nil, providerJobID, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}

		artifactBytes, mimeType, artifactURI := ExtractArtifactBytesAndMIME(pollResp)
		if len(artifactBytes) == 0 {
			updater.UpdatePollState(jobID, providerJobID, retryCount, nil, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
			return nil, nil, providerJobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if mimeType == "" {
			mimeType = "video/mp4"
		}
		providerRaw := map[string]any{
			"adapter":  AdapterGLMTask,
			"response": pollResp,
		}
		if artifactURI != "" {
			providerRaw["uri"] = artifactURI
		}
		artifact := BinaryArtifact(mimeType, artifactBytes, providerRaw)
		ApplyVideoSpecMetadata(artifact, spec)
		updater.UpdatePollState(jobID, providerJobID, retryCount, nil, "")
		return []*runtimev1.MediaArtifact{artifact}, ArtifactUsage(spec.GetPrompt(), artifactBytes, 420), providerJobID, nil
	}
}

// ExecuteGLMNative handles synchronous GLM media requests for image, TTS, and
// STT modalities.
func ExecuteGLMNative(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitMediaJobRequest,
	modelResolved string,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey := strings.TrimSpace(cfg.APIKey)

	switch req.GetModal() {
	case runtimev1.Modal_MODAL_IMAGE:
		spec := req.GetImageSpec()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
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
		if options := StructToMap(spec.GetProviderOptions()); len(options) > 0 {
			payload["provider_options"] = options
		}
		responsePayload := map[string]any{}
		if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, resolveGLMAPIPath(baseURL, "images/generations")), apiKey, payload, &responsePayload); err != nil {
			return nil, nil, "", err
		}
		artifactBytes, mimeType, artifactURI := ExtractBinaryArtifactBytesAndMIME(responsePayload)
		if len(artifactBytes) == 0 {
			artifactBytes, mimeType, artifactURI = ExtractImageArtifactFromAny(responsePayload["data"])
		}
		if len(artifactBytes) == 0 {
			return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if mimeType == "" {
			mimeType = ResolveImageArtifactMIME(spec, artifactBytes)
		}
		providerRaw := map[string]any{
			"adapter":          AdapterGLMNative,
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
			"provider_options": StructToMap(spec.GetProviderOptions()),
		}
		if artifactURI != "" {
			providerRaw["uri"] = artifactURI
		}
		artifact := BinaryArtifact(mimeType, artifactBytes, providerRaw)
		ApplyImageSpecMetadata(artifact, spec)
		return []*runtimev1.MediaArtifact{artifact}, ArtifactUsage(spec.GetPrompt(), artifactBytes, 180), "", nil
	case runtimev1.Modal_MODAL_TTS:
		spec := req.GetSpeechSpec()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
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
		if options := StructToMap(spec.GetProviderOptions()); len(options) > 0 {
			payload["provider_options"] = options
		}
		body, err := DoJSONOrBinaryRequest(ctx, http.MethodPost, JoinURL(baseURL, resolveGLMAPIPath(baseURL, "audio/speech")), apiKey, payload)
		if err != nil {
			return nil, nil, "", err
		}
		if body == nil || len(body.Bytes) == 0 || strings.TrimSpace(body.Text) != "" {
			return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		mimeType := ResolveSpeechArtifactMIME(spec, body.Bytes)
		if normalized := strings.TrimSpace(body.MIME); strings.HasPrefix(normalized, "audio/") {
			mimeType = normalized
		}
		artifact := BinaryArtifact(mimeType, body.Bytes, map[string]any{
			"adapter":          AdapterGLMNative,
			"voice":            strings.TrimSpace(spec.GetVoice()),
			"language":         strings.TrimSpace(spec.GetLanguage()),
			"audio_format":     strings.TrimSpace(spec.GetAudioFormat()),
			"emotion":          strings.TrimSpace(spec.GetEmotion()),
			"provider_options": StructToMap(spec.GetProviderOptions()),
		})
		ApplySpeechSpecMetadata(artifact, spec)
		return []*runtimev1.MediaArtifact{artifact}, ArtifactUsage(spec.GetText(), body.Bytes, 120), "", nil
	case runtimev1.Modal_MODAL_STT:
		spec := req.GetTranscriptionSpec()
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		audioBytes, mimeType, audioURI, err := ResolveTranscriptionAudioSource(ctx, spec)
		if err != nil {
			return nil, nil, "", err
		}
		text, err := ExecuteGLMTranscribe(ctx, JoinURL(baseURL, resolveGLMAPIPath(baseURL, "audio/transcriptions")), apiKey, modelResolved, spec, audioBytes, mimeType)
		if err != nil {
			return nil, nil, "", err
		}
		usage := &runtimev1.UsageStats{
			InputTokens:  MaxInt64(1, int64(len(audioBytes)/256)),
			OutputTokens: EstimateTokens(text),
			ComputeMs:    MaxInt64(10, int64(len(audioBytes)/64)),
		}
		artifact := BinaryArtifact(ResolveTranscriptionArtifactMIME(spec), []byte(text), map[string]any{
			"text":             text,
			"adapter":          AdapterGLMNative,
			"language":         strings.TrimSpace(spec.GetLanguage()),
			"timestamps":       spec.GetTimestamps(),
			"diarization":      spec.GetDiarization(),
			"speaker_count":    spec.GetSpeakerCount(),
			"response_format":  strings.TrimSpace(spec.GetResponseFormat()),
			"mime_type":        mimeType,
			"audio_uri":        audioURI,
			"provider_options": StructToMap(spec.GetProviderOptions()),
		})
		ApplyTranscriptionSpecMetadata(artifact, spec, audioURI)
		return []*runtimev1.MediaArtifact{artifact}, usage, "", nil
	default:
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

// ExecuteGLMTranscribe performs a multipart form POST for speech transcription
// against a GLM-compatible endpoint.
func ExecuteGLMTranscribe(
	ctx context.Context,
	targetURL string,
	apiKey string,
	modelID string,
	spec *runtimev1.SpeechTranscriptionSpec,
	audio []byte,
	mimeType string,
) (string, error) {
	if len(audio) == 0 {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if err := writer.WriteField("model", modelID); err != nil {
		return "", MapProviderRequestError(err)
	}
	if strings.TrimSpace(mimeType) != "" {
		if err := writer.WriteField("mime_type", strings.TrimSpace(mimeType)); err != nil {
			return "", MapProviderRequestError(err)
		}
	}
	if spec != nil {
		if language := strings.TrimSpace(spec.GetLanguage()); language != "" {
			if err := writer.WriteField("language", language); err != nil {
				return "", MapProviderRequestError(err)
			}
		}
		if prompt := strings.TrimSpace(spec.GetPrompt()); prompt != "" {
			if err := writer.WriteField("prompt", prompt); err != nil {
				return "", MapProviderRequestError(err)
			}
		}
		if format := strings.TrimSpace(spec.GetResponseFormat()); format != "" {
			if err := writer.WriteField("response_format", format); err != nil {
				return "", MapProviderRequestError(err)
			}
		}
		if spec.GetTimestamps() {
			if err := writer.WriteField("timestamps", "true"); err != nil {
				return "", MapProviderRequestError(err)
			}
		}
		if spec.GetDiarization() {
			if err := writer.WriteField("diarization", "true"); err != nil {
				return "", MapProviderRequestError(err)
			}
		}
		if spec.GetSpeakerCount() > 0 {
			if err := writer.WriteField("speaker_count", strconv.FormatInt(int64(spec.GetSpeakerCount()), 10)); err != nil {
				return "", MapProviderRequestError(err)
			}
		}
		if options := StructToMap(spec.GetProviderOptions()); len(options) > 0 {
			raw, marshalErr := json.Marshal(options)
			if marshalErr != nil {
				return "", MapProviderRequestError(marshalErr)
			}
			if err := writer.WriteField("provider_options", string(raw)); err != nil {
				return "", MapProviderRequestError(err)
			}
		}
	}
	fileWriter, err := writer.CreateFormFile("file", "audio.bin")
	if err != nil {
		return "", MapProviderRequestError(err)
	}
	if _, err := fileWriter.Write(audio); err != nil {
		return "", MapProviderRequestError(err)
	}
	if err := writer.Close(); err != nil {
		return "", MapProviderRequestError(err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, body)
	if err != nil {
		return "", MapProviderRequestError(err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Accept", "application/json")
	if strings.TrimSpace(apiKey) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", MapProviderRequestError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return "", MapProviderHTTPError(response.StatusCode, payload)
	}
	payload := map[string]any{}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	text := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(payload["text"]),
		ValueAsString(MapField(payload["result"], "text")),
		ValueAsString(MapField(payload["data"], "text")),
	))
	if text == "" {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return text, nil
}

// ---------------------------------------------------------------------------
// Package-private helpers
// ---------------------------------------------------------------------------

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
