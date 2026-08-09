package nimillm

import (
	"context"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterRunwayTask = "runway_task_adapter"

// ExecuteRunwayTask executes a video generation scenario job against the Runway API.
// Runway uses async task-based generation: POST /v1/image_to_video to submit, GET /v1/tasks/{id} to poll.
func ExecuteRunwayTask(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
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

	resolvedModel := strings.TrimSpace(modelResolved)
	if resolvedModel == "" {
		resolvedModel = "gen3a_turbo"
	}
	payload := map[string]any{
		"model":      resolvedModel,
		"promptText": VideoPrompt(spec),
	}
	if dur := VideoDurationSec(spec); dur > 0 {
		payload["duration"] = dur
	}
	if ratio := VideoRatio(spec); ratio != "" {
		payload["ratio"] = ratio
	}
	if seed := VideoSeed(spec); seed != 0 {
		payload["seed"] = seed
	}
	payload["watermark"] = VideoWatermark(spec)

	contentPayload := VideoContentPayload(spec)
	if len(contentPayload) > 0 {
		for _, item := range contentPayload {
			if url := ValueAsString(item["image_url"]); url != "" {
				payload["promptImage"] = url
				break
			}
		}
	}

	submitPath := firstProviderEndpointPath([]string{"/v1/image_to_video"})
	queryPathTemplate := resolveTaskQueryPathTemplate([]string{"/v1/tasks/{task_id}"})

	headers := map[string]string{
		"X-Runway-Version": "2024-11-06",
	}
	submitResp := map[string]any{}
	if err := DoJSONRequestWithHeaders(ctx, http.MethodPost, JoinURL(baseURL, submitPath), apiKey, payload, &submitResp, headers); err != nil {
		return nil, nil, "", err
	}
	providerJobID := ExtractTaskIDFromAdapterPayload(AdapterRunwayTask, submitResp)
	if providerJobID == "" {
		artifactBytes, mimeType, artifactURI := ExtractTaskArtifactSource(ctx, submitResp)
		if len(artifactBytes) == 0 && strings.TrimSpace(artifactURI) == "" {
			return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if mimeType == "" {
			mimeType = ResolveVideoArtifactMIME(spec, artifactBytes)
		}
		meta := map[string]any{"adapter": AdapterRunwayTask, "submit_endpoint": submitPath, "response": submitResp}
		if artifactURI != "" {
			meta["uri"] = artifactURI
		}
		artifact := BinaryArtifact(mimeType, artifactBytes, meta)
		ApplyVideoSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(VideoPrompt(spec), artifactBytes, 420), "", nil
	}
	return PollProviderTaskForArtifact(
		ctx, updater, jobID, baseURL, apiKey,
		AdapterRunwayTask, providerJobID, submitPath, queryPathTemplate,
		"video/mp4", 420, VideoPrompt(spec),
		func(a *runtimev1.ScenarioArtifact) { ApplyVideoSpecMetadata(a, spec) }, nil,
	)
}
