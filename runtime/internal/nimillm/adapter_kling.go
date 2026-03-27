package nimillm

import (
	"context"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterKlingTask = "kling_task_adapter"

// ExecuteKlingTask executes an image or video generation scenario job against the Kling API.
// Kling uses async task-based generation: POST to submit, GET to poll.
func ExecuteKlingTask(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.klingai.com"
	}
	apiKey, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}

	switch scenarioModal(req) {
	case runtimev1.Modal_MODAL_IMAGE:
		return executeKlingImageTask(ctx, baseURL, apiKey, updater, jobID, req, modelResolved)
	case runtimev1.Modal_MODAL_VIDEO:
		return executeKlingVideoTask(ctx, baseURL, apiKey, updater, jobID, req, modelResolved)
	default:
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

func executeKlingImageTask(
	ctx context.Context,
	baseURL, apiKey string,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	spec := scenarioImageSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	payload := map[string]any{
		"model_name": StripProviderModelPrefix(modelResolved, "kling"),
		"prompt":     strings.TrimSpace(spec.GetPrompt()),
	}
	if negPrompt := strings.TrimSpace(spec.GetNegativePrompt()); negPrompt != "" {
		payload["negative_prompt"] = negPrompt
	}
	if n := spec.GetN(); n > 0 {
		payload["n"] = n
	}
	if aspectRatio := strings.TrimSpace(spec.GetAspectRatio()); aspectRatio != "" {
		payload["aspect_ratio"] = aspectRatio
	}
	if len(spec.GetReferenceImages()) > 0 {
		payload["image"] = spec.GetReferenceImages()[0]
	}

	submitPath := FirstProviderEndpointPath(nil,
		[]string{"image_submit_path"}, []string{"image_submit_paths"},
		[]string{"/v1/images/generations"})
	queryPathTemplate := ResolveTaskQueryPathTemplate(nil,
		[]string{"image_query_path"}, []string{"image_query_paths"},
		[]string{"/v1/images/generations/{task_id}"})

	submitResp := map[string]any{}
	if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, submitPath), apiKey, payload, &submitResp); err != nil {
		return nil, nil, "", err
	}
	providerJobID := ExtractTaskIDFromAdapterPayload(AdapterKlingTask, submitResp)
	if providerJobID == "" {
		artifactBytes, mimeType, artifactURI := ExtractTaskArtifactBytesAndMIME(submitResp)
		if len(artifactBytes) == 0 {
			return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if mimeType == "" {
			mimeType = ResolveImageArtifactMIME(spec, artifactBytes)
		}
		meta := map[string]any{"adapter": AdapterKlingTask, "submit_endpoint": submitPath, "response": submitResp}
		if artifactURI != "" {
			meta["uri"] = artifactURI
		}
		artifact := BinaryArtifact(mimeType, artifactBytes, meta)
		ApplyImageSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetPrompt(), artifactBytes, 180), "", nil
	}
	return PollProviderTaskForArtifact(
		ctx, updater, jobID, baseURL, apiKey,
		AdapterKlingTask, providerJobID, submitPath, queryPathTemplate,
		"image/png", 180, strings.TrimSpace(spec.GetPrompt()),
		func(a *runtimev1.ScenarioArtifact) { ApplyImageSpecMetadata(a, spec) }, nil,
	)
}

func executeKlingVideoTask(
	ctx context.Context,
	baseURL, apiKey string,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	spec := scenarioVideoSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	contentPayload := VideoContentPayload(spec)
	if len(contentPayload) == 0 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	payload := map[string]any{
		"model_name": StripProviderModelPrefix(modelResolved, "kling"),
		"content":    contentPayload,
	}
	if prompt := VideoPrompt(spec); prompt != "" {
		payload["prompt"] = prompt
	}
	if negPrompt := VideoNegativePrompt(spec); negPrompt != "" {
		payload["negative_prompt"] = negPrompt
	}
	if dur := VideoDurationSec(spec); dur > 0 {
		payload["duration"] = dur
	}
	if ratio := VideoRatio(spec); ratio != "" {
		payload["aspect_ratio"] = ratio
	}

	submitPath := FirstProviderEndpointPath(nil,
		[]string{"video_submit_path"}, []string{"video_submit_paths"},
		[]string{"/v1/videos/text2video"})
	queryPathTemplate := ResolveTaskQueryPathTemplate(nil,
		[]string{"video_query_path"}, []string{"video_query_paths"},
		[]string{"/v1/videos/text2video/{task_id}"})

	submitResp := map[string]any{}
	if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, submitPath), apiKey, payload, &submitResp); err != nil {
		return nil, nil, "", err
	}
	providerJobID := ExtractTaskIDFromAdapterPayload(AdapterKlingTask, submitResp)
	if providerJobID == "" {
		artifactBytes, mimeType, artifactURI := ExtractTaskArtifactBytesAndMIME(submitResp)
		if len(artifactBytes) == 0 {
			return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if mimeType == "" {
			mimeType = ResolveVideoArtifactMIME(spec, artifactBytes)
		}
		meta := map[string]any{"adapter": AdapterKlingTask, "submit_endpoint": submitPath, "response": submitResp}
		if artifactURI != "" {
			meta["uri"] = artifactURI
		}
		artifact := BinaryArtifact(mimeType, artifactBytes, meta)
		ApplyVideoSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(VideoPrompt(spec), artifactBytes, 420), "", nil
	}
	return PollProviderTaskForArtifact(
		ctx, updater, jobID, baseURL, apiKey,
		AdapterKlingTask, providerJobID, submitPath, queryPathTemplate,
		"video/mp4", 420, VideoPrompt(spec),
		func(a *runtimev1.ScenarioArtifact) { ApplyVideoSpecMetadata(a, spec) }, nil,
	)
}
