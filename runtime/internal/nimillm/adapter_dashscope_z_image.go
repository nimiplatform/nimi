package nimillm

import (
	"context"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r050
func executeDashscopeZImage(ctx context.Context, cfg MediaAdapterConfig, baseURL string, spec *runtimev1.ImageGenerateScenarioSpec) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	model := capabilitydriver.DashscopeZImageTurbo
	payload := map[string]any{"model": model, "input": map[string]any{"messages": []any{map[string]any{
		"role": "user", "content": []any{map[string]any{"text": spec.GetPrompt()}},
	}}}}
	parameters := map[string]any{}
	if size := normalizeDashScopeImageSize(spec.GetSize()); size != "" {
		parameters["size"] = size
	}
	if spec.Seed != nil {
		parameters["seed"] = spec.GetSeed()
	}
	if len(parameters) > 0 {
		payload["parameters"] = parameters
	}
	response := map[string]any{}
	if err := doJSONRequestWithHeadersAndObservation(ctx, http.MethodPost, JoinURL(baseURL, resolveAlibabaImageSubmitPath(model)), cfg.APIKey, payload, &response, cfg.Headers, 0, "dashscope-z-image"); err != nil {
		return nil, nil, "", err
	}
	imageURL, err := dashscopeZImageURL(response)
	if err != nil {
		return nil, nil, "", err
	}
	data, _, err := fetchBinaryArtifact(ctx, imageURL)
	if err != nil {
		return nil, nil, "", err
	}
	geometry, format, ok := decodedMediaImageConfig(data)
	if !ok || format != "png" || !capabilitydriver.DashscopeZImageGeometryAllowed(geometry.Width, geometry.Height) {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	artifact := BinaryArtifact("image/png", data, nil)
	artifact.Width, artifact.Height = int32(geometry.Width), int32(geometry.Height)
	return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
}

func dashscopeZImageURL(response map[string]any) (string, error) {
	invalid := grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	choices, _ := MapField(response["output"], "choices").([]any)
	if len(choices) != 1 || MapField(choices[0], "finish_reason") != "stop" {
		return "", invalid
	}
	message := MapField(choices[0], "message")
	if MapField(message, "role") != "assistant" {
		return "", invalid
	}
	content, _ := MapField(message, "content").([]any)
	var imageURL string
	for _, part := range content {
		if value := MapField(part, "image"); value != nil {
			uri, ok := value.(string)
			if !ok || !strings.HasPrefix(uri, "https://") || imageURL != "" {
				return "", invalid
			}
			imageURL = uri
		}
	}
	if imageURL == "" {
		return "", invalid
	}
	return imageURL, nil
}
