package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterWorldLabsNative = "worldlabs_world_adapter"

const worldLabsManifestMIME = "application/vnd.nimi.world+json"

// ExecuteWorldLabsWorld executes a world generation scenario job against the
// World Labs Marble API using provider-native async operation polling.
func ExecuteWorldLabsWorld(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.worldlabs.ai"
	}
	apiKey, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}
	if scenarioModal(req) != runtimev1.Modal_MODAL_WORLD {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioWorldGenerateSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	headers := map[string]string{}
	for key, value := range cfg.Headers {
		headers[key] = value
	}
	headers["WLT-Api-Key"] = apiKey

	requestBody, promptText, err := buildWorldLabsGeneratePayload(spec, modelResolved)
	if err != nil {
		return nil, nil, "", err
	}
	submitResp := map[string]any{}
	if err := DoJSONRequestWithHeaders(ctx, http.MethodPost, JoinURL(baseURL, "/marble/v1/worlds:generate"), "", requestBody, &submitResp, headers); err != nil {
		return nil, nil, "", err
	}
	operationID := strings.TrimSpace(ValueAsString(submitResp["operation_id"]))
	if operationID == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}

	initialDelay := providerPollDelay(0)
	updater.UpdatePollState(jobID, operationID, 0, timestamppb.New(time.Now().UTC().Add(initialDelay)), "")
	retryCount := int32(0)
	consecutiveErrors := int32(0)
	detached := isDetachedPollContext(ctx)
	for {
		if ctx.Err() != nil {
			return nil, nil, operationID, providerPollContextError(ctx.Err())
		}
		retryCount++
		operationResp := map[string]any{}
		pollURL := JoinURL(baseURL, "/marble/v1/operations/"+operationID)
		if err := DoJSONRequestWithHeadersAndTimeout(ctx, http.MethodGet, pollURL, "", nil, &operationResp, headers, 30*time.Second); err != nil {
			if detached && ctx.Err() == nil && isTransientPollError(err) {
				consecutiveErrors++
				if consecutiveErrors >= maxDetachedPollConsecutiveErrors {
					updater.UpdatePollState(jobID, operationID, retryCount, nil, err.Error())
					return nil, nil, operationID, err
				}
				delay := providerPollDelay(retryCount)
				updater.UpdatePollState(jobID, operationID, retryCount, timestamppb.New(time.Now().UTC().Add(delay)), err.Error())
				if sleepErr := sleepWithContext(ctx, delay); sleepErr != nil {
					return nil, nil, operationID, providerPollContextError(sleepErr)
				}
				continue
			}
			return nil, nil, operationID, err
		}
		consecutiveErrors = 0

		done, _ := operationResp["done"].(bool)
		if !done {
			statusText := worldLabsProgressStatus(operationResp)
			if providerPollRetryLimitReached(ctx, retryCount) {
				updater.UpdatePollState(jobID, operationID, retryCount, nil, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String())
				return nil, nil, operationID, providerPollTimeoutError()
			}
			delay := providerPollDelay(retryCount)
			updater.UpdatePollState(jobID, operationID, retryCount, timestamppb.New(time.Now().UTC().Add(delay)), statusText)
			if err := sleepWithContext(ctx, delay); err != nil {
				return nil, nil, operationID, providerPollContextError(err)
			}
			continue
		}

		if opErr := worldLabsOperationError(operationResp); opErr != nil {
			updater.UpdatePollState(jobID, operationID, retryCount, nil, opErr.Error())
			return nil, nil, operationID, opErr
		}

		worldPayload, err := fetchWorldLabsWorld(ctx, baseURL, headers, operationResp)
		if err != nil {
			updater.UpdatePollState(jobID, operationID, retryCount, nil, err.Error())
			return nil, nil, operationID, err
		}
		manifestBytes, manifestMeta, err := buildWorldLabsManifest(worldPayload, operationID)
		if err != nil {
			updater.UpdatePollState(jobID, operationID, retryCount, nil, err.Error())
			return nil, nil, operationID, err
		}
		artifact := BinaryArtifact(worldLabsManifestMIME, manifestBytes, manifestMeta)
		updater.UpdatePollState(jobID, operationID, retryCount, nil, "")
		return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(promptText, manifestBytes, 300000), operationID, nil
	}
}

func buildWorldLabsGeneratePayload(spec *runtimev1.WorldGenerateScenarioSpec, modelResolved string) (map[string]any, string, error) {
	if spec == nil {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	textPrompt := strings.TrimSpace(spec.GetTextPrompt())
	worldPrompt := map[string]any{}
	switch conditioning := spec.GetConditioning().(type) {
	case nil:
		if textPrompt == "" {
			return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		worldPrompt["type"] = "text"
		worldPrompt["text_prompt"] = textPrompt
	case *runtimev1.WorldGenerateScenarioSpec_ImagePrompt:
		worldPrompt["type"] = "image"
		worldPrompt["image_prompt"] = worldLabsAssetSourcePayload(conditioning.ImagePrompt.GetContent())
		if textPrompt != "" {
			worldPrompt["text_prompt"] = textPrompt
		}
	case *runtimev1.WorldGenerateScenarioSpec_MultiImagePrompt:
		images := make([]map[string]any, 0, len(conditioning.MultiImagePrompt.GetImages()))
		for _, item := range conditioning.MultiImagePrompt.GetImages() {
			if item == nil {
				continue
			}
			images = append(images, map[string]any{
				"azimuth": item.GetAzimuth(),
				"content": worldLabsAssetSourcePayload(item.GetContent()),
			})
		}
		worldPrompt["type"] = "multi-image"
		worldPrompt["multi_image_prompt"] = images
		if textPrompt != "" {
			worldPrompt["text_prompt"] = textPrompt
		}
	case *runtimev1.WorldGenerateScenarioSpec_VideoPrompt:
		worldPrompt["type"] = "video"
		worldPrompt["video_prompt"] = worldLabsAssetSourcePayload(conditioning.VideoPrompt.GetContent())
		if textPrompt != "" {
			worldPrompt["text_prompt"] = textPrompt
		}
	default:
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	modelID := strings.TrimSpace(StripProviderModelPrefix(modelResolved, "worldlabs"))
	if modelID == "" {
		modelID = strings.TrimSpace(modelResolved)
	}
	payload := map[string]any{
		"world_prompt": worldPrompt,
	}
	if displayName := strings.TrimSpace(spec.GetDisplayName()); displayName != "" {
		payload["display_name"] = displayName
	}
	if modelID != "" {
		payload["model"] = modelID
	}
	if len(spec.GetTags()) > 0 {
		payload["tags"] = append([]string(nil), spec.GetTags()...)
	}
	if seed := spec.GetSeed(); seed > 0 {
		payload["seed"] = seed
	}
	return payload, textPrompt, nil
}

func worldLabsAssetSourcePayload(source *runtimev1.WorldGenerateAssetSource) map[string]any {
	if source == nil {
		return nil
	}
	switch typed := source.GetSource().(type) {
	case *runtimev1.WorldGenerateAssetSource_Uri:
		return map[string]any{
			"source": "uri",
			"uri":    strings.TrimSpace(typed.Uri),
		}
	case *runtimev1.WorldGenerateAssetSource_MediaAssetId:
		return map[string]any{
			"source":         "media_asset",
			"media_asset_id": strings.TrimSpace(typed.MediaAssetId),
		}
	default:
		return nil
	}
}

func worldLabsProgressStatus(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	progress := MapField(payload["metadata"], "progress")
	return strings.ToLower(strings.TrimSpace(FirstNonEmpty(
		ValueAsString(MapField(progress, "status")),
		ValueAsString(payload["status"]),
		"in_progress",
	)))
}

func worldLabsOperationError(payload map[string]any) error {
	errPayload, ok := payload["error"].(map[string]any)
	if !ok || len(errPayload) == 0 {
		return nil
	}
	message := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(errPayload["message"]),
		ValueAsString(errPayload["detail"]),
		runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String(),
	))
	return grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
		Message: message,
	})
}

func fetchWorldLabsWorld(ctx context.Context, baseURL string, headers map[string]string, operationResp map[string]any) (map[string]any, error) {
	worldID := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(MapField(MapField(operationResp["metadata"], "world_id"), "id")),
		ValueAsString(MapField(operationResp["metadata"], "world_id")),
		ValueAsString(MapField(operationResp["response"], "id")),
		ValueAsString(MapField(operationResp["response"], "world_id")),
	))
	if worldID != "" {
		getResp := map[string]any{}
		if err := DoJSONRequestWithHeadersAndTimeout(
			ctx,
			http.MethodGet,
			JoinURL(baseURL, "/marble/v1/worlds/"+worldID),
			"",
			nil,
			&getResp,
			headers,
			30*time.Second,
		); err == nil {
			if world, ok := getResp["world"].(map[string]any); ok && len(world) > 0 {
				return world, nil
			}
			if len(getResp) > 0 {
				return getResp, nil
			}
		}
	}
	if response, ok := operationResp["response"].(map[string]any); ok && len(response) > 0 {
		return response, nil
	}
	return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}

func buildWorldLabsManifest(world map[string]any, operationID string) ([]byte, map[string]any, error) {
	if len(world) == 0 {
		return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	assets := MapField(world, "assets")
	splats := MapField(assets, "splats")
	imagery := MapField(assets, "imagery")
	mesh := MapField(assets, "mesh")
	manifest := map[string]any{
		"provider":            "worldlabs",
		"provider_operation":  strings.TrimSpace(operationID),
		"world_id":            strings.TrimSpace(FirstNonEmpty(ValueAsString(world["world_id"]), ValueAsString(world["id"]))),
		"display_name":        strings.TrimSpace(ValueAsString(world["display_name"])),
		"world_marble_url":    strings.TrimSpace(ValueAsString(world["world_marble_url"])),
		"caption":             strings.TrimSpace(ValueAsString(MapField(assets, "caption"))),
		"thumbnail_url":       strings.TrimSpace(ValueAsString(MapField(assets, "thumbnail_url"))),
		"pano_url":            strings.TrimSpace(ValueAsString(MapField(imagery, "pano_url"))),
		"collider_mesh_url":   strings.TrimSpace(ValueAsString(MapField(mesh, "collider_mesh_url"))),
		"spz_urls":            normalizeStringMap(MapField(splats, "spz_urls")),
		"model":               strings.TrimSpace(ValueAsString(world["model"])),
		"semantics_metadata":  normalizeWorldSemanticsMetadata(MapField(splats, "semantics_metadata")),
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		return nil, nil, MapProviderRequestError(err)
	}
	meta := map[string]any{
		"adapter":            AdapterWorldLabsNative,
		"world_id":           manifest["world_id"],
		"world_marble_url":   manifest["world_marble_url"],
		"thumbnail_url":      manifest["thumbnail_url"],
		"pano_url":           manifest["pano_url"],
		"collider_mesh_url":  manifest["collider_mesh_url"],
		"spz_urls":           manifest["spz_urls"],
		"model":              manifest["model"],
		"provider_operation": strings.TrimSpace(operationID),
	}
	return raw, meta, nil
}

func normalizeStringMap(input any) map[string]string {
	values, ok := input.(map[string]any)
	if !ok || len(values) == 0 {
		return map[string]string{}
	}
	out := make(map[string]string, len(values))
	for key, value := range values {
		trimmed := strings.TrimSpace(ValueAsString(value))
		if trimmed == "" {
			continue
		}
		out[key] = trimmed
	}
	return out
}

func normalizeWorldSemanticsMetadata(input any) map[string]any {
	values, ok := input.(map[string]any)
	if !ok || len(values) == 0 {
		return nil
	}
	out := map[string]any{}
	if ground := ValueAsFloat64(values["ground_plane_offset"]); ground != 0 {
		out["ground_plane_offset"] = ground
	}
	if scale := ValueAsFloat64(values["metric_scale_factor"]); scale != 0 {
		out["metric_scale_factor"] = scale
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
