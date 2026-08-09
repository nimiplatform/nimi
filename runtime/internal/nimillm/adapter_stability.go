package nimillm

import (
	"context"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterStabilityNative = "stability_native_adapter"

// ExecuteStabilityImage executes an image generation scenario job against the Stability AI API.
// Stability uses POST /v2beta/stable-image/generate/{engine}. Auth via Bearer token.
func ExecuteStabilityImage(
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
	apiKey := strings.TrimSpace(cfg.APIKey)

	if scenarioModal(req) != runtimev1.Modal_MODAL_IMAGE {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioImageSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	resolvedModel := strings.TrimSpace(modelResolved)
	payload := map[string]any{
		"prompt": strings.TrimSpace(spec.GetPrompt()),
	}
	if negPrompt := strings.TrimSpace(spec.GetNegativePrompt()); negPrompt != "" {
		payload["negative_prompt"] = negPrompt
	}
	if aspectRatio := strings.TrimSpace(spec.GetAspectRatio()); aspectRatio != "" {
		payload["aspect_ratio"] = aspectRatio
	}
	if style := strings.TrimSpace(spec.GetStyle()); style != "" {
		payload["style_preset"] = style
	}
	if seed := spec.GetSeed(); seed != 0 {
		payload["seed"] = seed
	}
	outputFormat := "png"
	if rf := strings.TrimSpace(spec.GetResponseFormat()); rf != "" {
		outputFormat = rf
	}
	payload["output_format"] = outputFormat

	engine := "core"
	if resolvedModel != "" {
		engine = resolvedModel
	}
	endpoint := firstProviderEndpointPath([]string{"/v2beta/stable-image/generate/" + engine})

	resp := map[string]any{}
	if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, endpoint), apiKey, payload, &resp); err != nil {
		return nil, nil, "", err
	}
	artifactBytes, mimeType, artifactURI := ExtractTaskArtifactSource(ctx, resp)
	if len(artifactBytes) == 0 && strings.TrimSpace(artifactURI) == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if mimeType == "" {
		mimeType = ResolveImageArtifactMIME(spec, artifactBytes)
	}
	artifactMeta := map[string]any{
		"adapter":  AdapterStabilityNative,
		"endpoint": endpoint,
		"prompt":   strings.TrimSpace(spec.GetPrompt()),
		"response": resp,
	}
	if artifactURI != "" {
		artifactMeta["uri"] = artifactURI
	}
	artifact := BinaryArtifact(mimeType, artifactBytes, artifactMeta)
	ApplyImageSpecMetadata(artifact, spec)
	return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetPrompt(), artifactBytes, 180), "", nil
}
