package nimillm

import (
	"context"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterIdeogramNative = "ideogram_native_adapter"

// ExecuteIdeogramImage executes an image generation scenario job against the Ideogram API.
// Ideogram uses POST /generate with JSON body. Auth via Bearer token. Sync response.
func ExecuteIdeogramImage(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.ideogram.ai"
	}
	apiKey := strings.TrimSpace(cfg.APIKey)

	if scenarioModal(req) != runtimev1.Modal_MODAL_IMAGE {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioImageSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	imageRequest := map[string]any{
		"prompt": strings.TrimSpace(spec.GetPrompt()),
		"model":  StripProviderModelPrefix(modelResolved, "ideogram"),
	}
	if negPrompt := strings.TrimSpace(spec.GetNegativePrompt()); negPrompt != "" {
		imageRequest["negative_prompt"] = negPrompt
	}
	if aspectRatio := strings.TrimSpace(spec.GetAspectRatio()); aspectRatio != "" {
		imageRequest["aspect_ratio"] = aspectRatio
	}
	if style := strings.TrimSpace(spec.GetStyle()); style != "" {
		imageRequest["style_type"] = style
	}
	if seed := spec.GetSeed(); seed != 0 {
		imageRequest["seed"] = seed
	}

	payload := map[string]any{
		"image_request": imageRequest,
	}

	endpoint := FirstProviderEndpointPath(
		nil,
		[]string{"image_path"},
		[]string{"image_paths"},
		[]string{"/generate"},
	)
	resp := map[string]any{}
	if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, endpoint), apiKey, payload, &resp); err != nil {
		return nil, nil, "", err
	}
	artifactBytes, mimeType, artifactURI := ExtractTaskArtifactBytesAndMIME(resp)
	if len(artifactBytes) == 0 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if mimeType == "" {
		mimeType = ResolveImageArtifactMIME(spec, artifactBytes)
	}
	artifactMeta := map[string]any{
		"adapter":  AdapterIdeogramNative,
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
