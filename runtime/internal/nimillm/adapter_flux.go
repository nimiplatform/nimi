package nimillm

import (
	"context"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterFluxNative = "flux_native_adapter"

// ExecuteFluxImage executes an image generation scenario job against the Flux (Black Forest Labs) API.
// Flux uses async task-based generation: POST to submit, GET to poll.
func ExecuteFluxImage(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.bfl.ml"
	}
	apiKey := strings.TrimSpace(cfg.APIKey)

	if scenarioModal(req) != runtimev1.Modal_MODAL_IMAGE {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioImageSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	resolvedModel := StripProviderModelPrefix(modelResolved, "flux")
	if resolvedModel == "" {
		resolvedModel = "flux-pro-1.1"
	}
	payload := map[string]any{
		"prompt": strings.TrimSpace(spec.GetPrompt()),
	}
	if size := strings.TrimSpace(spec.GetSize()); size != "" {
		parts := strings.SplitN(size, "x", 2)
		if len(parts) == 2 {
			payload["width"] = parts[0]
			payload["height"] = parts[1]
		}
	}
	if aspectRatio := strings.TrimSpace(spec.GetAspectRatio()); aspectRatio != "" {
		payload["aspect_ratio"] = aspectRatio
	}
	if seed := spec.GetSeed(); seed != 0 {
		payload["seed"] = seed
	}

	submitPath := FirstProviderEndpointPath(
		nil,
		[]string{"image_path", "image_submit_path"},
		[]string{"image_paths", "image_submit_paths"},
		[]string{"/v1/" + resolvedModel},
	)
	queryPathTemplate := ResolveTaskQueryPathTemplate(
		nil,
		[]string{"image_query_path", "task_query_path"},
		[]string{"image_query_paths", "task_query_paths"},
		[]string{"/v1/get_result"},
	)

	submitResp := map[string]any{}
	if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, submitPath), apiKey, payload, &submitResp); err != nil {
		return nil, nil, "", err
	}
	providerJobID := ExtractTaskIDFromPayload(submitResp)
	if providerJobID == "" {
		artifactBytes, mimeType, artifactURI := ExtractTaskArtifactBytesAndMIME(submitResp)
		if len(artifactBytes) == 0 {
			return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if mimeType == "" {
			mimeType = ResolveImageArtifactMIME(spec, artifactBytes)
		}
		artifactMeta := map[string]any{
			"adapter":          AdapterFluxNative,
			"submit_endpoint":  submitPath,
			"response":         submitResp,
		}
		if artifactURI != "" {
			artifactMeta["uri"] = artifactURI
		}
		artifact := BinaryArtifact(mimeType, artifactBytes, artifactMeta)
		ApplyImageSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetPrompt(), artifactBytes, 180), "", nil
	}
	return PollProviderTaskForArtifact(
		ctx, updater, jobID, baseURL, apiKey,
		AdapterFluxNative, providerJobID, submitPath, queryPathTemplate,
		"image/png", 180, strings.TrimSpace(spec.GetPrompt()),
		func(artifact *runtimev1.ScenarioArtifact) {
			ApplyImageSpecMetadata(artifact, spec)
		},
		nil,
	)
}
