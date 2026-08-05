package nimillm

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const (
	AdapterBytedanceARKTask                = "bytedance_ark_task_adapter"
	bytedanceARKSeedreamMinImagePixelCount = 3686400
)

func ExecuteBytedanceARKTask(
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
	apiKey := strings.TrimSpace(cfg.APIKey)
	scenarioExtensions := scenarioExtensionPayloadForScenario(req)

	switch scenarioModal(req) {
	case runtimev1.Modal_MODAL_IMAGE:
		spec := scenarioImageSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		submitPath := resolveBytedanceARKImagePath()
		submitPayload := map[string]any{
			"model":           modelResolved,
			"prompt":          spec.GetPrompt(),
			"negative_prompt": spec.GetNegativePrompt(),
			"size":            normalizeBytedanceARKImageSize(modelResolved, spec.GetSize()),
			"aspect_ratio":    spec.GetAspectRatio(),
			"quality":         spec.GetQuality(),
			"style":           spec.GetStyle(),
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
		artifactBytes, mimeType, artifactURI := ExtractTaskArtifactBytesAndMIME(ctx, submitResp)
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
			"model":     modelResolved,
			"content":   contentPayload,
			"watermark": VideoWatermark(spec),
		}
		if ratio := VideoRatio(spec); ratio != "" {
			submitPayload["ratio"] = ratio
		}
		if resolution := VideoResolution(spec); resolution != "" {
			submitPayload["resolution"] = resolution
		}
		if durationSec := VideoDurationSec(spec); durationSec > 0 {
			submitPayload["duration"] = durationSec
		}
		if VideoGenerateAudio(spec) {
			submitPayload["generate_audio"] = true
		}
		if seed := VideoSeed(spec); seed != 0 {
			submitPayload["seed"] = seed
		}
		if serviceTier := VideoServiceTier(spec); serviceTier != "" {
			submitPayload["service_tier"] = serviceTier
		}
		if expiresAfter := VideoExecutionExpiresAfterSec(spec); expiresAfter > 0 {
			submitPayload["execution_expires_after"] = expiresAfter
		}

		if debugPayload, _ := json.Marshal(submitPayload); len(debugPayload) > 0 {
			slog.Info("[volcengine-video-debug] submit request",
				"url", JoinURL(baseURL, submitPath),
				"payload", string(debugPayload),
			)
		}
		submitResp := map[string]any{}
		if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp); err != nil {
			slog.Warn("[volcengine-video-debug] submit failed", "error", err.Error())
			return nil, nil, "", err
		}
		providerJobID := ExtractTaskIDFromAdapterPayload(AdapterBytedanceARKTask, submitResp)
		if providerJobID == "" {
			artifactBytes, mimeType, artifactURI := ExtractTaskArtifactBytesAndMIME(ctx, submitResp)
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

func resolveBytedanceARKImagePath() string {
	return firstProviderEndpointPath([]string{"/images/generations"})
}

func resolveBytedanceARKVideoSubmitPath() string {
	return firstProviderEndpointPath([]string{"/contents/generations/tasks"})
}

func resolveBytedanceARKVideoQueryPathTemplate() string {
	return resolveTaskQueryPathTemplate([]string{"/contents/generations/tasks/{task_id}"})
}

func normalizeBytedanceARKImageSize(modelResolved string, rawSize string) string {
	size := strings.TrimSpace(rawSize)
	if !isBytedanceARKSeedreamImageModel(modelResolved) {
		return size
	}

	switch strings.ToLower(size) {
	case "", "auto", "default":
		return "2k"
	case "2k", "3k", "4k":
		return strings.ToLower(size)
	}

	width, height, normalized, ok := parseBytedanceARKImageDimensions(size)
	if !ok || width <= 0 || height <= 0 {
		return size
	}
	if int64(width)*int64(height) < bytedanceARKSeedreamMinImagePixelCount {
		return "2k"
	}
	return normalized
}

func isBytedanceARKSeedreamImageModel(modelResolved string) bool {
	normalized := strings.ToLower(strings.TrimSpace(modelResolved))
	return strings.Contains(normalized, "seedream")
}

func parseBytedanceARKImageDimensions(rawSize string) (int, int, string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(rawSize))
	normalized = strings.ReplaceAll(normalized, "*", "x")
	widthText, heightText, ok := strings.Cut(normalized, "x")
	if !ok || strings.TrimSpace(widthText) == "" || strings.TrimSpace(heightText) == "" {
		return 0, 0, "", false
	}
	width, err := strconv.Atoi(strings.TrimSpace(widthText))
	if err != nil {
		return 0, 0, "", false
	}
	height, err := strconv.Atoi(strings.TrimSpace(heightText))
	if err != nil {
		return 0, 0, "", false
	}
	return width, height, strconv.Itoa(width) + "x" + strconv.Itoa(height), true
}
