package nimillm

import (
	"context"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterBytedanceARKTask = "bytedance_ark_task_adapter"

func ExecuteBytedanceARKTask(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey := strings.TrimSpace(cfg.APIKey)
	scenarioExtensions := scenarioExtensionPayloadForScenario(req)

	switch scenarioModal(req) {
	case runtimev1.Modal_MODAL_IMAGE:
		spec := scenarioImageSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		submitPath := resolveBytedanceARKImagePath(scenarioExtensions)
		submitPayload := map[string]any{
			"model":           modelResolved,
			"prompt":          spec.GetPrompt(),
			"negative_prompt": spec.GetNegativePrompt(),
			"size":            spec.GetSize(),
			"aspect_ratio":    spec.GetAspectRatio(),
			"quality":         spec.GetQuality(),
			"style":           spec.GetStyle(),
			"response_format": spec.GetResponseFormat(),
		}
		if spec.GetSeed() != 0 {
			submitPayload["seed"] = spec.GetSeed()
		}
		if len(spec.GetReferenceImages()) > 0 {
			submitPayload["reference_images"] = append([]string(nil), spec.GetReferenceImages()...)
		}
		if strings.TrimSpace(spec.GetMask()) != "" {
			submitPayload["mask"] = strings.TrimSpace(spec.GetMask())
		}
		submitPayload["input"] = map[string]any{
			"prompt":          spec.GetPrompt(),
			"negative_prompt": spec.GetNegativePrompt(),
		}
		if len(scenarioExtensions) > 0 {
			submitPayload["extensions"] = scenarioExtensions
		}

		submitResp := map[string]any{}
		if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp); err != nil {
			return nil, nil, "", err
		}
		artifactBytes, mimeType, artifactURI := ExtractTaskArtifactBytesAndMIME(submitResp)
		if len(artifactBytes) == 0 {
			return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if mimeType == "" {
			mimeType = ResolveImageArtifactMIME(spec, artifactBytes)
		}
		artifactMeta := map[string]any{
			"adapter":          AdapterBytedanceARKTask,
			"endpoint":         submitPath,
			"response":         submitResp,
			"prompt":           strings.TrimSpace(spec.GetPrompt()),
			"negative_prompt":  strings.TrimSpace(spec.GetNegativePrompt()),
			"size":             strings.TrimSpace(spec.GetSize()),
			"aspect_ratio":     strings.TrimSpace(spec.GetAspectRatio()),
			"quality":          strings.TrimSpace(spec.GetQuality()),
			"style":            strings.TrimSpace(spec.GetStyle()),
			"response_format":  strings.TrimSpace(spec.GetResponseFormat()),
			"reference_images": append([]string(nil), spec.GetReferenceImages()...),
			"mask":             strings.TrimSpace(spec.GetMask()),
			"extensions":       scenarioExtensions,
		}
		if artifactURI != "" {
			artifactMeta["uri"] = artifactURI
		}
		artifact := BinaryArtifact(mimeType, artifactBytes, artifactMeta)
		ApplyImageSpecMetadata(artifact, spec)
		return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetPrompt(), artifactBytes, 180), "", nil
	case runtimev1.Modal_MODAL_VIDEO:
		spec := scenarioVideoSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		submitPath := resolveBytedanceARKVideoSubmitPath()
		queryPathTemplate := resolveBytedanceARKVideoQueryPathTemplate()
		contentPayload := VideoContentPayload(spec)
		if len(contentPayload) == 0 {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		submitPayload := map[string]any{
			"model":   modelResolved,
			"content": contentPayload,
		}
		if prompt := VideoPrompt(spec); prompt != "" {
			submitPayload["prompt"] = prompt
		}
		if negativePrompt := VideoNegativePrompt(spec); negativePrompt != "" {
			submitPayload["negative_prompt"] = negativePrompt
		}
		if resolution := VideoResolution(spec); resolution != "" {
			submitPayload["resolution"] = resolution
		}
		if ratio := VideoRatio(spec); ratio != "" {
			submitPayload["ratio"] = ratio
		}
		if durationSec := VideoDurationSec(spec); durationSec > 0 {
			submitPayload["duration"] = durationSec
		}
		if frames := VideoFrames(spec); frames > 0 {
			submitPayload["frames"] = frames
		}
		if fps := VideoFPS(spec); fps > 0 {
			submitPayload["framespersecond"] = fps
		}
		if seed := VideoSeed(spec); seed != 0 {
			submitPayload["seed"] = seed
		}
		submitPayload["camera_fixed"] = VideoCameraFixed(spec)
		submitPayload["watermark"] = VideoWatermark(spec)
		submitPayload["generate_audio"] = VideoGenerateAudio(spec)
		submitPayload["draft"] = VideoDraft(spec)
		if serviceTier := VideoServiceTier(spec); serviceTier != "" {
			submitPayload["service_tier"] = serviceTier
		}
		if expiresAfter := VideoExecutionExpiresAfterSec(spec); expiresAfter > 0 {
			submitPayload["execution_expires_after"] = expiresAfter
		}
		submitPayload["return_last_frame"] = VideoReturnLastFrame(spec)

		submitResp := map[string]any{}
		if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp); err != nil {
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
			artifactMeta := map[string]any{
				"adapter":         AdapterBytedanceARKTask,
				"submit_endpoint": submitPath,
				"response":        submitResp,
			}
			if artifactURI != "" {
				artifactMeta["uri"] = artifactURI
			}
			artifact := BinaryArtifact(mimeType, artifactBytes, artifactMeta)
			ApplyVideoSpecMetadata(artifact, spec)
			return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetPrompt(), artifactBytes, 420), "", nil
		}
		return PollProviderTaskForArtifact(
			ctx, updater, jobID, baseURL, apiKey,
			AdapterBytedanceARKTask, providerJobID, submitPath, queryPathTemplate,
			"video/mp4", 420, VideoPrompt(spec),
			func(artifact *runtimev1.ScenarioArtifact) {
				ApplyVideoSpecMetadata(artifact, spec)
			},
			map[string]any{
				"mode":               spec.GetMode().String(),
				"content_item_count": len(contentPayload),
			},
		)
	default:
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

// Provider-specific path resolvers (package-private)

func resolveBytedanceARKImagePath(scenarioExtensions map[string]any) string {
	return FirstProviderEndpointPath(
		scenarioExtensions,
		[]string{"image_path", "image_submit_path"},
		[]string{"image_paths", "image_submit_paths"},
		[]string{"/api/v3/images/generations"},
	)
}

func resolveBytedanceARKVideoSubmitPath() string {
	return FirstProviderEndpointPath(
		nil,
		[]string{"video_path", "video_submit_path", "task_submit_path"},
		[]string{"video_paths", "video_submit_paths", "task_submit_paths"},
		[]string{"/api/v3/contents/generations/tasks"},
	)
}

func resolveBytedanceARKVideoQueryPathTemplate() string {
	return ResolveTaskQueryPathTemplate(
		nil,
		[]string{"video_query_path", "video_query_path_template", "task_query_path"},
		[]string{"video_query_paths", "video_query_path_templates", "task_query_paths"},
		[]string{"/api/v3/contents/generations/tasks/{task_id}"},
	)
}
