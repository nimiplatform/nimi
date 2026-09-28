package nimillm

import (
	"bytes"
	"context"
	"image/png"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const dashscopeQwen3ImageModel = "qwen-image-3.0"
const dashscopeQwen3ImagePath = "/api/v1/services/aigc/multimodal-generation/generation"

// @nimi-authority: rule.nimi.runtime.ai-provider.r050
// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func executeDashscopeQwen3Image(ctx context.Context, baseURL, apiKey string, spec *runtimev1.ImageGenerateScenarioSpec) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	payload := dashscopeQwen3ImagePayload(spec)
	response := map[string]any{}
	if err := DoJSONRequestWithHeaders(ctx, http.MethodPost, JoinURL(baseURL, dashscopeQwen3ImagePath), apiKey, payload, &response, nil); err != nil {
		return nil, nil, "", err
	}
	imageURL, err := dashscopeQwen3ImageURL(response)
	if err != nil {
		return nil, nil, "", err
	}
	imageBytes, _, err := fetchBinaryArtifact(ctx, imageURL)
	if err != nil || len(imageBytes) == 0 {
		return nil, nil, "", dashscopeQwen3ImageInvalidOutput()
	}
	configuration, err := png.DecodeConfig(bytes.NewReader(imageBytes))
	if err != nil || configuration.Width <= 0 || configuration.Height <= 0 {
		return nil, nil, "", dashscopeQwen3ImageInvalidOutput()
	}
	pixels := int64(configuration.Width) * int64(configuration.Height)
	if pixels < 512*512 || pixels > 2048*2048 ||
		int64(configuration.Width) > 8*int64(configuration.Height) || int64(configuration.Height) > 8*int64(configuration.Width) {
		return nil, nil, "", dashscopeQwen3ImageInvalidOutput()
	}
	artifact := BinaryArtifact("image/png", imageBytes, nil)
	artifact.Width = int32(configuration.Width)
	artifact.Height = int32(configuration.Height)
	ApplyImageSpecMetadata(artifact, spec)
	return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
}

func dashscopeQwen3ImagePayload(spec *runtimev1.ImageGenerateScenarioSpec) map[string]any {
	content := make([]any, 0, 2)
	for _, reference := range spec.GetReferenceImages() {
		content = append(content, map[string]any{"image": reference})
	}
	content = append(content, map[string]any{"text": spec.GetPrompt()})
	return map[string]any{
		"model": dashscopeQwen3ImageModel,
		"input": map[string]any{"messages": []any{map[string]any{"role": "user", "content": content}}},
	}
}

func dashscopeQwen3ImageURL(response map[string]any) (string, error) {
	output, ok := response["output"].(map[string]any)
	if !ok {
		return "", dashscopeQwen3ImageInvalidOutput()
	}
	choices, ok := output["choices"].([]any)
	if !ok || len(choices) != 1 {
		return "", dashscopeQwen3ImageInvalidOutput()
	}
	choice, ok := choices[0].(map[string]any)
	if !ok || ValueAsString(choice["finish_reason"]) != "stop" {
		return "", dashscopeQwen3ImageInvalidOutput()
	}
	message, ok := choice["message"].(map[string]any)
	if !ok || ValueAsString(message["role"]) != "assistant" {
		return "", dashscopeQwen3ImageInvalidOutput()
	}
	results, ok := message["content"].([]any)
	if !ok || len(results) != 1 {
		return "", dashscopeQwen3ImageInvalidOutput()
	}
	result, ok := results[0].(map[string]any)
	if !ok || result["type"] != nil && result["type"] != "image" {
		return "", dashscopeQwen3ImageInvalidOutput()
	}
	imageURL := strings.TrimSpace(ValueAsString(result["image"]))
	if !strings.HasPrefix(imageURL, "https://") {
		return "", dashscopeQwen3ImageInvalidOutput()
	}
	if usage, ok := response["usage"].(map[string]any); ok && usage["output_image_count"] != nil && usage["output_image_count"] != float64(1) {
		return "", dashscopeQwen3ImageInvalidOutput()
	}
	return imageURL, nil
}

func dashscopeQwen3ImageInvalidOutput() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}
