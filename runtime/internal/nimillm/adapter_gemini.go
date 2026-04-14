package nimillm

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterGeminiOperation = "gemini_operation_adapter"

// ExecuteGeminiOperation executes a Gemini operation adapter request across
// Gemini async modalities (image, video, TTS). STT uses the dedicated
// chat/completions adapter path and bypasses /operations.
//
// extractScenarioExtensions is passed as a function parameter because it is
// defined in services/ai and extracts provider options from different spec
// types.
func ExecuteGeminiOperation(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
	extractScenarioExtensions func(*runtimev1.SubmitScenarioJobRequest) *structpb.Struct,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey := strings.TrimSpace(cfg.APIKey)
	if scenarioModal(req) == runtimev1.Modal_MODAL_STT {
		return ExecuteGeminiTranscribe(ctx, cfg, req, modelResolved)
	}
	if scenarioModal(req) == runtimev1.Modal_MODAL_IMAGE {
		return ExecuteGeminiImageGenerateContent(ctx, cfg, req, modelResolved)
	}

	submitPayload := map[string]any{
		"model": modelResolved,
		"modal": strings.ToLower(scenarioModal(req).String()),
	}
	scenarioExtensions := StructToMap(extractScenarioExtensions(req))
	prompt := ""
	defaultMIME := ""
	var computeMs int64
	switch scenarioModal(req) {
	case runtimev1.Modal_MODAL_VIDEO:
		spec := scenarioVideoSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		prompt = VideoPrompt(spec)
		defaultMIME = "video/mp4"
		computeMs = 420
		submitPayload["prompt"] = VideoPrompt(spec)
		submitPayload["negative_prompt"] = VideoNegativePrompt(spec)
		submitPayload["mode"] = strings.ToLower(strings.TrimPrefix(spec.GetMode().String(), "VIDEO_MODE_"))
		submitPayload["content"] = VideoContentPayload(spec)
		submitPayload["duration_sec"] = VideoDurationSec(spec)
		submitPayload["frames"] = VideoFrames(spec)
		submitPayload["fps"] = VideoFPS(spec)
		submitPayload["resolution"] = VideoResolution(spec)
		submitPayload["aspect_ratio"] = VideoRatio(spec)
		submitPayload["seed"] = VideoSeed(spec)
		submitPayload["first_frame_uri"] = VideoFirstFrameURI(spec)
		submitPayload["last_frame_uri"] = VideoLastFrameURI(spec)
		submitPayload["reference_images"] = VideoReferenceImageURIs(spec)
		submitPayload["camera_fixed"] = VideoCameraFixed(spec)
		submitPayload["watermark"] = VideoWatermark(spec)
		submitPayload["generate_audio"] = VideoGenerateAudio(spec)
		submitPayload["draft"] = VideoDraft(spec)
		submitPayload["service_tier"] = VideoServiceTier(spec)
		submitPayload["execution_expires_after_sec"] = VideoExecutionExpiresAfterSec(spec)
		submitPayload["return_last_frame"] = VideoReturnLastFrame(spec)
	case runtimev1.Modal_MODAL_TTS:
		spec := scenarioSpeechSynthesizeSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		prompt = spec.GetText()
		defaultMIME = ResolveSpeechArtifactMIME(spec, nil)
		computeMs = 120
		submitPayload["input"] = spec.GetText()
		submitPayload["text"] = spec.GetText()
		submitPayload["voice"] = scenarioVoiceRef(spec)
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
	default:
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	if len(scenarioExtensions) > 0 {
		submitPayload["extensions"] = scenarioExtensions
	}

	submitResp := map[string]any{}
	if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, "/operations"), apiKey, submitPayload, &submitResp); err != nil {
		return nil, nil, "", err
	}
	providerJobID := FirstNonEmpty(
		ValueAsString(submitResp["name"]),
		ValueAsString(submitResp["operation"]),
		ValueAsString(MapField(submitResp["operation"], "name")),
		ValueAsString(submitResp["id"]),
	)
	if providerJobID == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	updater.UpdatePollState(jobID, providerJobID, 0, timestamppb.New(time.Now().UTC().Add(providerPollDelay(0))), "")
	retryCount := int32(0)

	for {
		if ctx.Err() != nil {
			bestEffortDeleteProviderAsyncTask(AdapterGeminiOperation, baseURL, apiKey, providerJobID)
			return nil, nil, providerJobID, providerPollContextError(ctx.Err())
		}
		retryCount++
		pollResp := map[string]any{}
		pollPath := JoinURL(baseURL, path.Join("/operations", url.PathEscape(providerJobID)))
		if err := DoJSONRequest(ctx, http.MethodGet, pollPath, apiKey, nil, &pollResp); err != nil {
			return nil, nil, providerJobID, err
		}
		done := ValueAsBool(pollResp["done"])
		if !done {
			if providerPollRetryLimitReached(ctx, retryCount) {
				updater.UpdatePollState(jobID, providerJobID, retryCount, nil, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String())
				return nil, nil, providerJobID, providerPollTimeoutError()
			}
			delay := providerPollDelay(retryCount)
			updater.UpdatePollState(jobID, providerJobID, retryCount, timestamppb.New(time.Now().UTC().Add(delay)), "")
			if err := sleepWithContext(ctx, delay); err != nil {
				bestEffortDeleteProviderAsyncTask(AdapterGeminiOperation, baseURL, apiKey, providerJobID)
				return nil, nil, providerJobID, providerPollContextError(err)
			}
			continue
		}
		statusText := strings.ToLower(strings.TrimSpace(FirstNonEmpty(
			ValueAsString(pollResp["status"]),
			ValueAsString(MapField(pollResp["result"], "status")),
		)))
		if statusText == "failed" || statusText == "error" || statusText == "canceled" || statusText == "cancelled" {
			updater.UpdatePollState(jobID, providerJobID, retryCount, nil, statusText)
			return nil, nil, providerJobID, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		artifactBytes, mimeType, artifactURI := ExtractArtifactBytesAndMIME(pollResp)
		if len(artifactBytes) == 0 {
			updater.UpdatePollState(jobID, providerJobID, retryCount, nil, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
			return nil, nil, providerJobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if mimeType == "" {
			mimeType = defaultMIME
		}
		artifactMeta := map[string]any{
			"adapter":  AdapterGeminiOperation,
			"response": pollResp,
		}
		if artifactURI != "" {
			artifactMeta["uri"] = artifactURI
		}
		artifact := BinaryArtifact(mimeType, artifactBytes, artifactMeta)
		var usage *runtimev1.UsageStats
		if scenarioImageSpec(req) != nil {
			ApplyImageSpecMetadata(artifact, scenarioImageSpec(req))
		}
		if scenarioVideoSpec(req) != nil {
			ApplyVideoSpecMetadata(artifact, scenarioVideoSpec(req))
		}
		if scenarioSpeechSynthesizeSpec(req) != nil {
			spec := scenarioSpeechSynthesizeSpec(req)
			artifactMeta["voice"] = strings.TrimSpace(scenarioVoiceRef(spec))
			artifactMeta["language"] = strings.TrimSpace(spec.GetLanguage())
			artifactMeta["audio_format"] = strings.TrimSpace(spec.GetAudioFormat())
			artifactMeta["emotion"] = strings.TrimSpace(spec.GetEmotion())
			artifactMeta["extensions"] = scenarioExtensions
			ApplySpeechSpecMetadata(artifact, spec)
			if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(artifact.GetMimeType())), "audio/") {
				artifact.MimeType = ResolveSpeechArtifactMIME(spec, artifactBytes)
			}
			usage = ArtifactUsage(spec.GetText(), artifactBytes, computeMs)
		}
		if usage == nil {
			usage = ArtifactUsage(prompt, artifactBytes, computeMs)
		}
		updater.UpdatePollState(jobID, providerJobID, retryCount, nil, "")
		return []*runtimev1.ScenarioArtifact{artifact}, usage, providerJobID, nil
	}
}

func ExecuteGeminiImageGenerateContent(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := resolveGeminiNativeBaseURL(cfg.BaseURL)
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	apiKey := strings.TrimSpace(cfg.APIKey)
	if apiKey == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	spec := scenarioImageSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	prompt := strings.TrimSpace(spec.GetPrompt())
	if prompt == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	resolvedModel := normalizeGeminiGenerateContentModel(modelResolved)
	generationConfig := map[string]any{
		"responseModalities": []string{"IMAGE"},
	}
	if aspectRatio := resolveGeminiImageAspectRatio(spec); aspectRatio != "" {
		generationConfig["imageConfig"] = map[string]any{
			"aspectRatio": aspectRatio,
		}
	}

	payload := map[string]any{
		"contents": []map[string]any{
			{
				"parts": []map[string]any{{"text": prompt}},
			},
		},
		"generationConfig": generationConfig,
	}
	if referenceParts, err := buildGeminiReferenceImageParts(ctx, spec.GetReferenceImages()); err != nil {
		return nil, nil, "", err
	} else if len(referenceParts) > 0 {
		content := payload["contents"].([]map[string]any)
		content[0]["parts"] = append(content[0]["parts"].([]map[string]any), referenceParts...)
	}

	responsePayload := map[string]any{}
	targetURL := JoinURL(baseURL, fmt.Sprintf("/models/%s:generateContent", url.PathEscape(resolvedModel)))
	if err := DoJSONRequestWithHeadersAndTimeout(
		ctx,
		http.MethodPost,
		targetURL,
		"",
		payload,
		&responsePayload,
		map[string]string{"x-goog-api-key": apiKey},
		resolveGeminiGenerateContentHTTPTimeout(req),
	); err != nil {
		return nil, nil, "", err
	}

	artifactBytes, mimeType, artifactURI := ExtractImageArtifactFromAny(responsePayload["candidates"])
	if len(artifactBytes) == 0 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if mimeType == "" {
		mimeType = "image/png"
	}

	artifactMeta := map[string]any{
		"adapter":  AdapterGeminiOperation,
		"endpoint": ":generateContent",
		"response": responsePayload,
	}
	if artifactURI != "" {
		artifactMeta["uri"] = artifactURI
	}

	artifact := BinaryArtifact(mimeType, artifactBytes, artifactMeta)
	ApplyImageSpecMetadata(artifact, spec)
	usage := ArtifactUsage(prompt, artifactBytes, 180)
	return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil
}

func resolveGeminiNativeBaseURL(baseURL string) string {
	normalized := strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	lower := strings.ToLower(normalized)
	if strings.HasSuffix(lower, "/openai") {
		return strings.TrimSuffix(normalized, "/openai")
	}
	return normalized
}

func normalizeGeminiGenerateContentModel(modelResolved string) string {
	normalized := strings.TrimSpace(modelResolved)
	normalized = strings.TrimPrefix(normalized, "models/")
	if idx := strings.Index(normalized, "/"); idx > 0 {
		prefix := strings.TrimSpace(normalized[:idx])
		if strings.EqualFold(prefix, "gemini") {
			normalized = strings.TrimSpace(normalized[idx+1:])
		}
	}
	return strings.TrimSpace(normalized)
}

func resolveGeminiImageAspectRatio(spec *runtimev1.ImageGenerateScenarioSpec) string {
	if spec == nil {
		return ""
	}
	if aspectRatio := strings.TrimSpace(spec.GetAspectRatio()); aspectRatio != "" {
		return aspectRatio
	}
	size := strings.ToLower(strings.TrimSpace(spec.GetSize()))
	if size == "" {
		return ""
	}
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		return ""
	}
	width, widthErr := strconv.Atoi(strings.TrimSpace(parts[0]))
	height, heightErr := strconv.Atoi(strings.TrimSpace(parts[1]))
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return ""
	}
	divisor := greatestCommonDivisor(width, height)
	if divisor <= 0 {
		return ""
	}
	return fmt.Sprintf("%d:%d", width/divisor, height/divisor)
}

func greatestCommonDivisor(left int, right int) int {
	for right != 0 {
		left, right = right, left%right
	}
	if left < 0 {
		return -left
	}
	return left
}

func resolveGeminiGenerateContentHTTPTimeout(req *runtimev1.SubmitScenarioJobRequest) time.Duration {
	timeoutMS := int32(0)
	if req != nil && req.GetHead() != nil {
		timeoutMS = req.GetHead().GetTimeoutMs()
	}
	if timeoutMS <= 0 {
		return defaultHTTPTimeout
	}
	return time.Duration(timeoutMS) * time.Millisecond
}

func buildGeminiReferenceImageParts(ctx context.Context, referenceImages []string) ([]map[string]any, error) {
	parts := make([]map[string]any, 0, len(referenceImages))
	for _, raw := range referenceImages {
		location := strings.TrimSpace(raw)
		if location == "" {
			continue
		}
		payload, mimeType, err := resolveGeminiReferenceImageBytes(ctx, location)
		if err != nil {
			return nil, err
		}
		if len(payload) == 0 {
			continue
		}
		if mimeType == "" {
			mimeType = "image/png"
		}
		parts = append(parts, map[string]any{
			"inline_data": map[string]any{
				"mime_type": mimeType,
				"data":      base64.StdEncoding.EncodeToString(payload),
			},
		})
	}
	return parts, nil
}

func resolveGeminiReferenceImageBytes(ctx context.Context, location string) ([]byte, string, error) {
	value := strings.TrimSpace(location)
	if value == "" {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if strings.HasPrefix(strings.ToLower(value), "data:") {
		return decodeGeminiDataURL(value)
	}
	if isRemoteHTTPURL(value) {
		client, request, err := newSecuredHTTPRequest(ctx, http.MethodGet, value, nil)
		if err != nil {
			return nil, "", err
		}
		response, err := client.Do(request)
		if err != nil {
			return nil, "", MapProviderRequestError(err)
		}
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return nil, "", MapProviderHTTPError(response.StatusCode, nil)
		}
		payload, err := readLimitedResponseBody(response.Body, maxDecodedMediaURLBytes)
		if err != nil {
			return nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		if len(payload) == 0 {
			return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		return payload, strings.TrimSpace(response.Header.Get("Content-Type")), nil
	}
	pathValue := value
	if strings.HasPrefix(strings.ToLower(value), "file://") {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if looksLikeLocalFilesystemPath(pathValue) {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
}

func decodeGeminiDataURL(value string) ([]byte, string, error) {
	commaIndex := strings.Index(value, ",")
	if commaIndex <= 5 {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	header := strings.TrimSpace(value[:commaIndex])
	payload := strings.TrimSpace(value[commaIndex+1:])
	if !strings.HasSuffix(strings.ToLower(header), ";base64") {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	mimeType := strings.TrimPrefix(strings.Split(header, ";")[0], "data:")
	decoded, err := base64.StdEncoding.DecodeString(payload)
	if err != nil || len(decoded) == 0 {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if len(decoded) > maxDecodedMediaURLBytes {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if strings.TrimSpace(mimeType) == "" {
		mimeType = strings.TrimSpace(http.DetectContentType(decoded))
	}
	return decoded, mimeType, nil
}

func ExecuteGeminiTranscribe(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	spec := scenarioSpeechTranscribeSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if err := validateCoreTranscriptionOnly("gemini", spec); err != nil {
		return nil, nil, "", err
	}

	audioBytes, mimeType, audioURI, err := ResolveTranscriptionAudioSource(ctx, spec)
	if err != nil {
		return nil, nil, "", err
	}
	resolvedInlineMIME := resolveInlineAudioMIME(mimeType, audioBytes)
	if resolvedInlineMIME == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	resolvedInlineFormat := resolveInlineAudioFormat(mimeType, audioBytes)
	if resolvedInlineFormat == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	payload := map[string]any{
		"model": modelResolved,
		"messages": []map[string]any{
			{
				"role": "user",
				"content": []map[string]any{
					{
						"type": "text",
						"text": buildCoreTranscriptionInstruction(spec),
					},
					{
						"type": "input_audio",
						"input_audio": map[string]any{
							"data":   base64AudioString(audioBytes),
							"format": resolvedInlineFormat,
						},
					},
				},
			},
		},
		"stream": false,
	}

	responsePayload := map[string]any{}
	if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, "/chat/completions"), strings.TrimSpace(cfg.APIKey), payload, &responsePayload); err != nil {
		return nil, nil, "", err
	}

	text := extractChatCompletionMessageText(responsePayload)
	if text == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	usage := usageFromChatCompletionTranscription(responsePayload, audioBytes, text)
	artifact := BinaryArtifact(ResolveTranscriptionArtifactMIME(spec), []byte(text), map[string]any{
		"text":            text,
		"adapter":         AdapterGeminiChatTranscribe,
		"endpoint":        "/chat/completions",
		"language":        strings.TrimSpace(spec.GetLanguage()),
		"prompt":          strings.TrimSpace(spec.GetPrompt()),
		"response_format": strings.TrimSpace(spec.GetResponseFormat()),
		"mime_type":       resolvedInlineMIME,
		"audio_uri":       audioURI,
		"response":        responsePayload,
	})
	ApplyTranscriptionSpecMetadata(artifact, spec, audioURI)
	return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil
}

func base64AudioString(audio []byte) string {
	return base64.StdEncoding.EncodeToString(audio)
}
