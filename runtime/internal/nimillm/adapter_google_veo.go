package nimillm

import (
	"context"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterGoogleVeoOperation = "google_veo_operation_adapter"

// ExecuteGoogleVeoOperation executes a video generation scenario job against the Google Veo API.
// Veo uses async operation-based generation: POST to submit, GET to poll.
func ExecuteGoogleVeoOperation(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://generativelanguage.googleapis.com"
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

	resolvedModel := StripProviderModelPrefix(modelResolved, "google_veo", "google-veo")
	if resolvedModel == "" {
		resolvedModel = "veo-2.0-generate-001"
	}
	instances := []map[string]any{
		{"prompt": VideoPrompt(spec)},
	}
	contentPayload := VideoContentPayload(spec)
	if len(contentPayload) > 0 {
		for _, item := range contentPayload {
			if url := ValueAsString(item["image_url"]); url != "" {
				instances[0]["image"] = map[string]any{"bytesBase64Encoded": "", "gcsUri": url}
				break
			}
		}
	}
	parameters := map[string]any{}
	if ratio := VideoRatio(spec); ratio != "" {
		parameters["aspectRatio"] = ratio
	}
	if dur := VideoDurationSec(spec); dur > 0 {
		parameters["durationSeconds"] = dur
	}
	if seed := VideoSeed(spec); seed != 0 {
		parameters["seed"] = seed
	}

	payload := map[string]any{
		"instances":  instances,
		"parameters": parameters,
	}

	submitPath := FirstProviderEndpointPath(nil,
		[]string{"video_submit_path"}, []string{"video_submit_paths"},
		[]string{"/v1beta/models/" + resolvedModel + ":predictLongRunning"})
	queryPathTemplate := ResolveTaskQueryPathTemplate(nil,
		[]string{"video_query_path", "operation_query_path"}, []string{"video_query_paths", "operation_query_paths"},
		[]string{"/v1beta/operations/{task_id}"})

	submitResp := map[string]any{}
	if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, submitPath), apiKey, payload, &submitResp); err != nil {
		return nil, nil, "", err
	}
	providerJobID := ExtractTaskIDFromAdapterPayload(AdapterGoogleVeoOperation, submitResp)
	if providerJobID == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return PollProviderTaskForArtifact(
		ctx, updater, jobID, baseURL, apiKey,
		AdapterGoogleVeoOperation, providerJobID, submitPath, queryPathTemplate,
		"video/mp4", 420, VideoPrompt(spec),
		func(a *runtimev1.ScenarioArtifact) { ApplyVideoSpecMetadata(a, spec) }, nil,
	)
}
