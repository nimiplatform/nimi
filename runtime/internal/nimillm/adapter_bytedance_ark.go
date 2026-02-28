package nimillm

import (
	"context"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const AdapterBytedanceARKTask = "bytedance_ark_task_adapter"

func ExecuteBytedanceARKTask(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitMediaJobRequest,
	modelResolved string,
) ([]*runtimev1.MediaArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	apiKey := strings.TrimSpace(cfg.APIKey)

	switch req.GetModal() {
	case runtimev1.Modal_MODAL_IMAGE:
		spec := req.GetImageSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		providerOptions := StructToMap(spec.GetProviderOptions())
		submitPath := resolveBytedanceARKImagePath(spec)
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
		if len(providerOptions) > 0 {
			submitPayload["provider_options"] = providerOptions
		}

		submitResp := map[string]any{}
		if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp); err != nil {
			return nil, nil, "", err
		}
		artifactBytes, mimeType, artifactURI := ExtractTaskArtifactBytesAndMIME(submitResp)
		if len(artifactBytes) == 0 {
			return nil, nil, "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
		}
		if mimeType == "" {
			mimeType = ResolveImageArtifactMIME(spec, artifactBytes)
		}
		providerRaw := map[string]any{
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
			"provider_options": providerOptions,
		}
		if artifactURI != "" {
			providerRaw["uri"] = artifactURI
		}
		artifact := BinaryArtifact(mimeType, artifactBytes, providerRaw)
		ApplyImageSpecMetadata(artifact, spec)
		return []*runtimev1.MediaArtifact{artifact}, ArtifactUsage(spec.GetPrompt(), artifactBytes, 180), "", nil
	case runtimev1.Modal_MODAL_VIDEO:
		spec := req.GetVideoSpec()
		if spec == nil {
			return nil, nil, "", status.Error(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID.String())
		}
		providerOptions := StructToMap(spec.GetProviderOptions())
		submitPath := resolveBytedanceARKVideoSubmitPath(spec)
		queryPathTemplate := resolveBytedanceARKVideoQueryPathTemplate(spec)
		submitPayload := map[string]any{
			"model":           modelResolved,
			"prompt":          spec.GetPrompt(),
			"negative_prompt": spec.GetNegativePrompt(),
			"duration_sec":    spec.GetDurationSec(),
			"fps":             spec.GetFps(),
			"resolution":      spec.GetResolution(),
			"aspect_ratio":    spec.GetAspectRatio(),
			"first_frame_uri": spec.GetFirstFrameUri(),
			"last_frame_uri":  spec.GetLastFrameUri(),
			"camera_motion":   spec.GetCameraMotion(),
		}
		if spec.GetSeed() != 0 {
			submitPayload["seed"] = spec.GetSeed()
		}
		submitPayload["input"] = map[string]any{
			"prompt":          spec.GetPrompt(),
			"negative_prompt": spec.GetNegativePrompt(),
		}
		if len(providerOptions) > 0 {
			submitPayload["provider_options"] = providerOptions
		}

		submitResp := map[string]any{}
		if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp); err != nil {
			return nil, nil, "", err
		}
		providerJobID := ExtractTaskIDFromPayload(submitResp)
		if providerJobID == "" {
			artifactBytes, mimeType, artifactURI := ExtractTaskArtifactBytesAndMIME(submitResp)
			if len(artifactBytes) == 0 {
				return nil, nil, "", status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
			}
			if mimeType == "" {
				mimeType = ResolveVideoArtifactMIME(spec, artifactBytes)
			}
			providerRaw := map[string]any{
				"adapter":         AdapterBytedanceARKTask,
				"submit_endpoint": submitPath,
				"response":        submitResp,
			}
			if artifactURI != "" {
				providerRaw["uri"] = artifactURI
			}
			artifact := BinaryArtifact(mimeType, artifactBytes, providerRaw)
			ApplyVideoSpecMetadata(artifact, spec)
			return []*runtimev1.MediaArtifact{artifact}, ArtifactUsage(spec.GetPrompt(), artifactBytes, 420), "", nil
		}
		return PollProviderTaskForArtifact(
			ctx, updater, jobID, baseURL, apiKey,
			AdapterBytedanceARKTask, providerJobID, submitPath, queryPathTemplate,
			"video/mp4", 420, spec.GetPrompt(),
			func(artifact *runtimev1.MediaArtifact) {
				ApplyVideoSpecMetadata(artifact, spec)
			},
			map[string]any{"provider_options": providerOptions},
		)
	default:
		return nil, nil, "", status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
}

// Provider-specific path resolvers (package-private)

func resolveBytedanceARKImagePath(spec *runtimev1.ImageGenerationSpec) string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = StructToMap(spec.GetProviderOptions())
	}
	return FirstProviderEndpointPath(
		providerOptions,
		[]string{"image_path", "image_submit_path"},
		[]string{"image_paths", "image_submit_paths"},
		[]string{"/api/v3/images/generations"},
	)
}

func resolveBytedanceARKVideoSubmitPath(spec *runtimev1.VideoGenerationSpec) string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = StructToMap(spec.GetProviderOptions())
	}
	return FirstProviderEndpointPath(
		providerOptions,
		[]string{"video_path", "video_submit_path", "task_submit_path"},
		[]string{"video_paths", "video_submit_paths", "task_submit_paths"},
		[]string{"/api/v3/contents/generations/tasks"},
	)
}

func resolveBytedanceARKVideoQueryPathTemplate(spec *runtimev1.VideoGenerationSpec) string {
	providerOptions := map[string]any{}
	if spec != nil {
		providerOptions = StructToMap(spec.GetProviderOptions())
	}
	return ResolveTaskQueryPathTemplate(
		providerOptions,
		[]string{"video_query_path", "video_query_path_template", "task_query_path"},
		[]string{"video_query_paths", "video_query_path_templates", "task_query_paths"},
		[]string{"/api/v3/contents/generations/tasks/{task_id}"},
	)
}
