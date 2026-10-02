package nimillm

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const dashscopeQwen3ImageModel = "qwen-image-3.0"
const dashscopeQwen3ImageProModel = "qwen-image-3.0-pro"
const dashscopeQwen3ImagePath = "/api/v1/services/aigc/multimodal-generation/generation"

func isDashscopeQwen3ImageModel(model string) bool {
	return model == dashscopeQwen3ImageModel || model == dashscopeQwen3ImageProModel
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r050
// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func executeDashscopeQwen3Image(ctx context.Context, baseURL, apiKey, model string, spec *runtimev1.ImageGenerateScenarioSpec) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	payload := dashscopeQwen3ImagePayload(model, spec)
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
		return nil, nil, "", dashscopeQwen3ImageInvalidOutput("download")
	}
	configuration, format, ok := decodedMediaImageConfig(imageBytes)
	if !ok || format != "png" {
		return nil, nil, "", dashscopeQwen3ImageInvalidOutput("png-decode")
	}
	if !dashscopeQwen3ImageGeometryAllowed(model, configuration.Width, configuration.Height) {
		pixels := int64(configuration.Width) * int64(configuration.Height)
		slog.Warn("Dashscope Qwen Image 3 PNG geometry outside admitted bounds", "model", model,
			"width", configuration.Width, "height", configuration.Height, "pixels", pixels)
		return nil, nil, "", dashscopeQwen3ImageInvalidOutput("png-geometry")
	}
	artifact := BinaryArtifact("image/png", imageBytes, nil)
	artifact.Width = int32(configuration.Width)
	artifact.Height = int32(configuration.Height)
	ApplyImageSpecMetadata(artifact, spec)
	return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
}

func dashscopeQwen3ImageGeometryAllowed(model string, width, height int) bool {
	if width <= 0 || height <= 0 ||
		int64(width) > 8*int64(height) || int64(height) > 8*int64(width) {
		return false
	}
	pixels := int64(width) * int64(height)
	maximum := int64(2048 * 2048)
	if model == dashscopeQwen3ImageProModel {
		// A real Pro auto-resolution returned 2528x1696, slightly above the
		// published total-pixel figure. Accept that bounded output without
		// allowing unbounded decoded geometry.
		maximum = 5_000_000
	}
	return pixels >= 512*512 && pixels <= maximum
}

func dashscopeQwen3ImagePayload(model string, spec *runtimev1.ImageGenerateScenarioSpec) map[string]any {
	content := make([]any, 0, 2)
	for _, reference := range spec.GetReferenceImages() {
		content = append(content, map[string]any{"image": reference})
	}
	content = append(content, map[string]any{"text": spec.GetPrompt()})
	return map[string]any{
		"model": model,
		"input": map[string]any{"messages": []any{map[string]any{"role": "user", "content": content}}},
	}
}

func dashscopeQwen3ImageURL(response map[string]any) (string, error) {
	output, ok := response["output"].(map[string]any)
	if !ok {
		return "", dashscopeQwen3ImageInvalidOutput("output-shape")
	}
	choices, ok := output["choices"].([]any)
	if !ok || len(choices) != 1 {
		return "", dashscopeQwen3ImageInvalidOutput("choice-count")
	}
	choice, ok := choices[0].(map[string]any)
	if !ok || ValueAsString(choice["finish_reason"]) != "stop" {
		return "", dashscopeQwen3ImageInvalidOutput("finish-reason")
	}
	message, ok := choice["message"].(map[string]any)
	if !ok || ValueAsString(message["role"]) != "assistant" {
		return "", dashscopeQwen3ImageInvalidOutput("message-role")
	}
	results, ok := message["content"].([]any)
	if !ok || len(results) != 1 {
		return "", dashscopeQwen3ImageInvalidOutput("content-count")
	}
	result, ok := results[0].(map[string]any)
	if !ok || result["type"] != nil && result["type"] != "image" {
		return "", dashscopeQwen3ImageInvalidOutput("content-kind")
	}
	imageURL := strings.TrimSpace(ValueAsString(result["image"]))
	if !strings.HasPrefix(imageURL, "https://") {
		return "", dashscopeQwen3ImageInvalidOutput("image-url")
	}
	if usage, ok := response["usage"].(map[string]any); ok && usage["output_image_count"] != nil && usage["output_image_count"] != float64(1) {
		return "", dashscopeQwen3ImageInvalidOutput("usage-count")
	}
	return imageURL, nil
}

func dashscopeQwen3ImageInvalidOutput(stage string) error {
	slog.Warn("Dashscope Qwen Image 3 output invalid", "stage", stage)
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}
