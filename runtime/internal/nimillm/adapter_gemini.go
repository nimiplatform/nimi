package nimillm

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterGeminiOperation = "gemini_operation_adapter"

// ExecuteGeminiOperation retains the private dispatcher label for finite Gemini
// image and transcription requests. TTS uses its dedicated generateContent or
// interactions adapter; video belongs to the separately admitted Veo provider.
func ExecuteGeminiOperation(
	ctx context.Context,
	cfg MediaAdapterConfig,
	_ JobStateUpdater,
	_ string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
	_ func(*runtimev1.SubmitScenarioJobRequest) *structpb.Struct,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	switch scenarioModal(req) {
	case runtimev1.Modal_MODAL_STT:
		return ExecuteGeminiTranscribe(ctx, cfg, req, modelResolved)
	case runtimev1.Modal_MODAL_IMAGE:
		return ExecuteGeminiImageGenerateContent(ctx, cfg, req, modelResolved)
	default:
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

func ExecuteGeminiImageGenerateContent(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
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

	resolvedModel := strings.TrimSpace(modelResolved)
	referenceParts, err := buildGeminiReferenceImageParts(ctx, spec.GetReferenceImages())
	if err != nil {
		return nil, nil, "", err
	}
	if artifactID := spec.GetReferenceImageArtifactId(); artifactID != "" {
		reference, _ := ctx.Value(imageReferenceContextKey{}).(*ImageReference)
		if err := ValidateGeminiImageReferenceRequest(spec, reference); err != nil {
			return nil, nil, "", err
		}
		referenceParts = append(referenceParts, geminiOwnedImagePart(reference))
	}
	payload := geminiImageGeneratePayload(spec, referenceParts)
	if err := validateGeminiImagePayloadSize(payload); err != nil {
		return nil, nil, "", err
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

	artifactBytes, _, artifactURI := geminiFinalInlineImage(ctx, responsePayload["candidates"])
	if len(artifactBytes) == 0 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	imageConfig, imageFormat, valid := decodedMediaImageConfig(artifactBytes)
	if !valid {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	var mimeType string
	switch imageFormat {
	case "jpeg", "png":
		mimeType = "image/" + imageFormat
	default:
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
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
	artifact.Width = int32(imageConfig.Width)
	artifact.Height = int32(imageConfig.Height)
	usage, err := geminiMediaUsage(responsePayload)
	if err != nil {
		return nil, nil, "", err
	}
	return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil
}

// Gemini image models may include intermediate thought images. Only one final
// inline image is a committed image.generate result.
func geminiFinalInlineImage(ctx context.Context, candidates any) ([]byte, string, string) {
	parts, ok := geminiCompletedCandidateParts(candidates)
	if !ok {
		return nil, "", ""
	}
	var artifactBytes []byte
	var mimeType, artifactURI string
	for _, item := range parts {
		part, ok := item.(map[string]any)
		if !ok || part["thought"] == true {
			continue
		}
		inline := part["inlineData"]
		if inline == nil {
			inline = part["inline_data"]
		}
		if inline == nil {
			continue
		}
		data, mime, uri := ExtractImageArtifactFromAny(ctx, inline)
		if len(data) == 0 || len(artifactBytes) != 0 {
			return nil, "", ""
		}
		artifactBytes, mimeType, artifactURI = data, mime, uri
	}
	return artifactBytes, mimeType, artifactURI
}

func resolveGeminiNativeBaseURL(baseURL string) string {
	normalized := strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	lower := strings.ToLower(normalized)
	if strings.HasSuffix(lower, "/openai") {
		return strings.TrimSuffix(normalized, "/openai")
	}
	return normalized
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
		payload, mimeType, err := resolveReferenceImageBytes(ctx, location)
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

func resolveReferenceImageBytes(ctx context.Context, location string) ([]byte, string, error) {
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
		defer func() { _ = response.Body.Close() }()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return nil, "", MapProviderHTTPError(response.StatusCode, nil)
		}
		payload, err := readLimitedResponseBody(response.Body, maxDecodedMediaURLBytes)
		if err != nil {
			return nil, "", grpcerr.WrapWithReasonCode(
				codes.Unavailable,
				runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
				err,
				grpcerr.ReasonOptions{Message: "provider media response body could not be read"},
			)
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
	if err != nil {
		return nil, "", grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_INPUT_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "provider media payload could not be decoded"},
		)
	}
	if len(decoded) == 0 {
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
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
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
	usage := reportedChatCompletionUsage(responsePayload)
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
	ApplyTranscriptionSpecMetadata(artifact, spec)
	return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil
}

func base64AudioString(audio []byte) string {
	return base64.StdEncoding.EncodeToString(audio)
}
