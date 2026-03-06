package nimillm

import (
	"context"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterPikaTask = "pika_task_adapter"

// ExecutePikaTask executes a video generation scenario job against the Pika API.
// Pika uses async task-based generation: POST to submit, GET to poll.
func ExecutePikaTask(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.pika.art"
	}
	apiKey := strings.TrimSpace(cfg.APIKey)

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
	if resolvedModel := StripProviderModelPrefix(modelResolved, "pika"); resolvedModel != "" {
		payload["model"] = resolvedModel
	}
	if ratio := VideoRatio(spec); ratio != "" {
		payload["aspect_ratio"] = ratio
	}
	if dur := VideoDurationSec(spec); dur > 0 {
		payload["duration"] = dur
	}
	if seed := VideoSeed(spec); seed != 0 {
		payload["seed"] = seed
	}
	contentPayload := VideoContentPayload(spec)
	if len(contentPayload) > 0 {
		payload["content"] = contentPayload
	}

	submitPath := FirstProviderEndpointPath(nil,
		[]string{"video_submit_path"}, []string{"video_submit_paths"},
		[]string{"/v1/generate"})
	queryPathTemplate := ResolveTaskQueryPathTemplate(nil,
		[]string{"video_query_path"}, []string{"video_query_paths"},
		[]string{"/v1/generate/{task_id}"})

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
			mimeType = ResolveVideoArtifactMIME(spec, artifactBytes)
		}
		meta := map[string]any{"adapter": AdapterPikaTask, "submit_endpoint": submitPath, "response": submitResp}
		if artifactURI != "" {
			meta["uri"] = artifactURI
		}
		artifact := BinaryArtifact(mimeType, artifactBytes, meta)
		ApplyVideoSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(VideoPrompt(spec), artifactBytes, 420), "", nil
	}
	return PollProviderTaskForArtifact(
		ctx, updater, jobID, baseURL, apiKey,
		AdapterPikaTask, providerJobID, submitPath, queryPathTemplate,
		"video/mp4", 420, VideoPrompt(spec),
		func(a *runtimev1.ScenarioArtifact) { ApplyVideoSpecMetadata(a, spec) }, nil,
	)
}
