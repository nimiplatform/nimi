package nimillm

import (
	"context"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const AdapterKimiChatMultimodal = "kimi_chat_multimodal_adapter"

// ExecuteKimiImageChatMultimodal executes a Kimi chat-completions multimodal
// image generation request. Only MODAL_IMAGE is supported; all other modals
// return FailedPrecondition.
func ExecuteKimiImageChatMultimodal(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitMediaJobRequest,
	modelResolved string,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
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
	apiKey := strings.TrimSpace(cfg.APIKey)
	payload := buildKimiImageChatPayload(modelResolved, spec)
	responsePayload := map[string]any{}
	if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, "/v1/chat/completions"), apiKey, payload, &responsePayload); err != nil {
		return nil, nil, "", err
	}

	artifactBytes, mimeType, artifactURI := extractKimiImageArtifact(responsePayload)
	if len(artifactBytes) == 0 {
		return nil, nil, "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	if mimeType == "" {
		mimeType = ResolveImageArtifactMIME(spec, artifactBytes)
	}
	providerRaw := map[string]any{
		"adapter":          AdapterKimiChatMultimodal,
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
}

// buildKimiImageChatPayload constructs the chat-completions payload for Kimi
// image generation, building a multimodal message with text and reference
// images.
func buildKimiImageChatPayload(modelResolved string, spec *runtimev1.ImageGenerationSpec) map[string]any {
	resolvedModelID := StripProviderModelPrefix(modelResolved, "kimi", "moonshot")
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
	if options := StructToMap(spec.GetProviderOptions()); len(options) > 0 {
		payload["provider_options"] = options
	}
	return payload
}

// extractKimiImageArtifact extracts image artifact bytes, MIME type, and URI
// from a Kimi chat-completions response, searching choices, output, and data
// fields.
func extractKimiImageArtifact(payload map[string]any) ([]byte, string, string) {
	if artifactBytes, mimeType, artifactURI := ExtractBinaryArtifactBytesAndMIME(payload); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	if artifactBytes, mimeType, artifactURI := ExtractImageArtifactFromAny(payload["choices"]); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	if artifactBytes, mimeType, artifactURI := ExtractImageArtifactFromAny(payload["output"]); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	if artifactBytes, mimeType, artifactURI := ExtractImageArtifactFromAny(payload["data"]); len(artifactBytes) > 0 {
		return artifactBytes, mimeType, artifactURI
	}
	return nil, "", ""
}
