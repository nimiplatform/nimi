package nimillm

import (
	"context"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterLumaTask = "luma_task_adapter"

// ExecuteLumaTask executes a video generation scenario job against the Luma Dream Machine API.
// Luma uses POST /dream-machine/v1/generations to submit, GET to poll.
func ExecuteLumaTask(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.lumalabs.ai"
	}
	apiKey, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}

	if scenarioModal(req) != runtimev1.Modal_MODAL_VIDEO {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioVideoSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	payload := map[string]any{
		"prompt": VideoPrompt(spec),
	}
	if resolvedModel := StripProviderModelPrefix(modelResolved, "luma"); resolvedModel != "" {
		payload["model"] = resolvedModel
	}
	if ratio := VideoRatio(spec); ratio != "" {
		payload["aspect_ratio"] = ratio
	}
	if resolution := VideoResolution(spec); resolution != "" {
		payload["resolution"] = resolution
	}
	contentPayload := VideoContentPayload(spec)
	if len(contentPayload) > 0 {
		for _, item := range contentPayload {
			if url := ValueAsString(item["image_url"]); url != "" {
				payload["keyframes"] = map[string]any{
					"frame0": map[string]any{"type": "image", "url": url},
				}
				break
			}
		}
	}

	submitPath := FirstProviderEndpointPath(nil,
		[]string{"video_submit_path"}, []string{"video_submit_paths"},
		[]string{"/dream-machine/v1/generations"})
	queryPathTemplate := ResolveTaskQueryPathTemplate(nil,
		[]string{"video_query_path"}, []string{"video_query_paths"},
		[]string{"/dream-machine/v1/generations/{task_id}"})

	submitResp := map[string]any{}
	if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, submitPath), apiKey, payload, &submitResp); err != nil {
		return nil, nil, "", err
	}
	providerJobID := ExtractTaskIDFromAdapterPayload(AdapterLumaTask, submitResp)
	if providerJobID == "" {
		artifactBytes, mimeType, artifactURI := ExtractTaskArtifactBytesAndMIME(submitResp)
		if len(artifactBytes) == 0 {
			return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if mimeType == "" {
			mimeType = ResolveVideoArtifactMIME(spec, artifactBytes)
		}
		meta := map[string]any{"adapter": AdapterLumaTask, "submit_endpoint": submitPath, "response": submitResp}
		if artifactURI != "" {
			meta["uri"] = artifactURI
		}
		artifact := BinaryArtifact(mimeType, artifactBytes, meta)
		ApplyVideoSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(VideoPrompt(spec), artifactBytes, 420), "", nil
	}
	return PollProviderTaskForArtifact(
		ctx, updater, jobID, baseURL, apiKey,
		AdapterLumaTask, providerJobID, submitPath, queryPathTemplate,
		"video/mp4", 420, VideoPrompt(spec),
		func(a *runtimev1.ScenarioArtifact) { ApplyVideoSpecMetadata(a, spec) }, nil,
	)
}
