package localservice

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

func manifestString(input map[string]any, keys ...string) (string, bool) {
	for _, key := range keys {
		value, exists := input[key]
		if !exists {
			continue
		}
		text, ok := value.(string)
		if !ok {
			return "", false
		}
		return strings.TrimSpace(text), true
	}
	return "", false
}

func manifestStringDefault(input map[string]any, keys ...string) string {
	value, ok := manifestString(input, keys...)
	if !ok {
		return ""
	}
	return value
}

func manifestHasAnyKey(input map[string]any, keys ...string) bool {
	for _, key := range keys {
		if _, exists := input[key]; exists {
			return true
		}
	}
	return false
}

func manifestStringSliceKeys(input map[string]any, keys ...string) ([]string, error) {
	for _, key := range keys {
		items, err := manifestStringSlice(input, key)
		if err != nil {
			return nil, err
		}
		if len(items) > 0 {
			return items, nil
		}
	}
	return nil, nil
}

func manifestStringSlice(input map[string]any, key string) ([]string, error) {
	value, exists := input[key]
	if !exists || value == nil {
		return nil, nil
	}
	rawItems, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("invalid %s", key)
	}
	items := make([]string, 0, len(rawItems))
	for _, item := range rawItems {
		text, ok := item.(string)
		if !ok {
			return nil, fmt.Errorf("invalid %s entry", key)
		}
		items = append(items, strings.TrimSpace(text))
	}
	return normalizeStringSlice(items), nil
}

func manifestStringMap(input map[string]any, key string) (map[string]string, error) {
	value, exists := input[key]
	if !exists || value == nil {
		return map[string]string{}, nil
	}
	rawMap, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid %s", key)
	}
	result := make(map[string]string, len(rawMap))
	for k, v := range rawMap {
		text, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("invalid %s value", key)
		}
		result[k] = strings.TrimSpace(text)
	}
	return result, nil
}

func manifestStruct(input map[string]any, keys ...string) (*structpb.Struct, error) {
	for _, key := range keys {
		value, exists := input[key]
		if !exists || value == nil {
			continue
		}
		object, ok := value.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("invalid %s", key)
		}
		result, err := structpb.NewStruct(object)
		if err != nil {
			return nil, fmt.Errorf("invalid %s", key)
		}
		return result, nil
	}
	return nil, nil
}

func parseLocalAssetKindToken(raw string) (runtimev1.LocalAssetKind, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "chat":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, true
	case "image":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, true
	case "video":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO, true
	case "tts":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS, true
	case "stt":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT, true
	case "embedding":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING, true
	case "vae":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE, true
	case "clip":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CLIP, true
	case "lora":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_LORA, true
	case "controlnet":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CONTROLNET, true
	case "auxiliary":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY, true
	default:
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED, false
	}
}

func manifestAssetKind(input map[string]any, keys ...string) (runtimev1.LocalAssetKind, bool) {
	for _, key := range keys {
		value, exists := input[key]
		if !exists || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			kind, ok := parseLocalAssetKindToken(typed)
			if !ok {
				return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED, false
			}
			return kind, true
		case float64:
			kind := runtimev1.LocalAssetKind(int32(typed))
			if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
				return kind, false
			}
			return kind, true
		case int32:
			kind := runtimev1.LocalAssetKind(typed)
			if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
				return kind, false
			}
			return kind, true
		case int:
			kind := runtimev1.LocalAssetKind(typed)
			if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
				return kind, false
			}
			return kind, true
		case json.Number:
			parsed, err := strconv.Atoi(string(typed))
			if err != nil {
				return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED, false
			}
			kind := runtimev1.LocalAssetKind(parsed)
			if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
				return kind, false
			}
			return kind, true
		default:
			return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED, false
		}
	}
	return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED, false
}

func validateResolvedModelManifestPath(manifestPath string, modelsRoot string) error {
	cleanManifestPath := filepath.Clean(strings.TrimSpace(manifestPath))
	if cleanManifestPath == "." || cleanManifestPath == "" {
		return fmt.Errorf("manifest path required")
	}
	if !strings.EqualFold(filepath.Base(cleanManifestPath), "asset.manifest.json") {
		return fmt.Errorf("resolved manifest must be named asset.manifest.json")
	}
	cleanModelsRoot := filepath.Clean(strings.TrimSpace(modelsRoot))
	if cleanModelsRoot == "." || cleanModelsRoot == "" {
		return fmt.Errorf("models root required")
	}
	resolvedModelsRoot, err := filepath.EvalSymlinks(cleanModelsRoot)
	if err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("models root invalid: %w", err)
		}
		resolvedModelsRoot = cleanModelsRoot
	}
	resolvedManifestPath, err := filepath.EvalSymlinks(cleanManifestPath)
	if err != nil {
		return fmt.Errorf("manifest path invalid: %w", err)
	}
	rel, err := filepath.Rel(resolvedModelsRoot, resolvedManifestPath)
	if err != nil {
		return fmt.Errorf("manifest path invalid: %w", err)
	}
	if rel == "." || rel == "" || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("manifest path must stay under runtime models root")
	}
	if !strings.HasPrefix(rel, "resolved"+string(filepath.Separator)) {
		return fmt.Errorf("manifest path must stay under resolved/")
	}
	parent := filepath.Dir(rel)
	if parent == "resolved" || parent == "." {
		return fmt.Errorf("resolved manifest must live under resolved/<logical-model-id>/asset.manifest.json")
	}
	return nil
}

func validateLocalAssetManifestPath(manifestPath string, modelsRoot string) error {
	cleanManifestPath := filepath.Clean(strings.TrimSpace(manifestPath))
	if cleanManifestPath == "." || cleanManifestPath == "" {
		return fmt.Errorf("manifest path required")
	}
	if !strings.EqualFold(filepath.Base(cleanManifestPath), "asset.manifest.json") {
		return fmt.Errorf("asset manifest must be named asset.manifest.json")
	}
	cleanModelsRoot := filepath.Clean(strings.TrimSpace(modelsRoot))
	if cleanModelsRoot == "." || cleanModelsRoot == "" {
		return fmt.Errorf("models root required")
	}
	resolvedModelsRoot, err := filepath.EvalSymlinks(cleanModelsRoot)
	if err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("models root invalid: %w", err)
		}
		resolvedModelsRoot = cleanModelsRoot
	}
	resolvedManifestPath, err := filepath.EvalSymlinks(cleanManifestPath)
	if err != nil {
		return fmt.Errorf("manifest path invalid: %w", err)
	}
	rel, err := filepath.Rel(resolvedModelsRoot, resolvedManifestPath)
	if err != nil {
		return fmt.Errorf("manifest path invalid: %w", err)
	}
	if rel == "." || rel == "" || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("asset manifest must stay under runtime models root")
	}
	parent := filepath.Dir(rel)
	if parent == "." {
		return fmt.Errorf("asset manifest must live under <asset-dir>/asset.manifest.json")
	}
	return nil
}

func (s *Service) RemoveLocalAsset(_ context.Context, req *runtimev1.RemoveLocalAssetRequest) (*runtimev1.RemoveLocalAssetResponse, error) {
	localModelID := strings.TrimSpace(req.GetLocalAssetId())
	if localModelID == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "set_local_model_id",
		})
	}
	current := s.modelByID(localModelID)
	if current == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "install_or_select_existing_local_model",
		})
	}
	if boundServiceID := s.findBoundServiceID(localModelID); boundServiceID != "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION)
	}
	model, err := s.updateModelStatus(localModelID, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED, "model removed")
	if err != nil {
		return nil, err
	}
	if syncErr := s.SyncManagedLlamaAssets(context.Background()); syncErr != nil {
		s.logger.Warn("sync llama assets after remove failed", "local_model_id", localModelID, "error", syncErr)
	}
	s.cleanupRemovedModelBundle(current)
	return &runtimev1.RemoveLocalAssetResponse{Asset: model}, nil
}

func (s *Service) cleanupRemovedModelBundle(model *runtimev1.LocalAssetRecord) {
	if model == nil {
		return
	}
	modelsRoot := s.resolvedLocalModelsPath()
	if strings.TrimSpace(modelsRoot) == "" {
		return
	}
	logicalModelID := strings.Trim(strings.TrimSpace(model.GetLogicalModelId()), "/")
	if logicalModelID == "" {
		return
	}
	bundleDir := filepath.Join(modelsRoot, "resolved", filepath.FromSlash(logicalModelID))
	info, err := os.Stat(bundleDir)
	if err != nil || !info.IsDir() {
		return
	}
	rootAbs, err := filepath.Abs(modelsRoot)
	if err != nil {
		return
	}
	bundleAbs, err := filepath.Abs(bundleDir)
	if err != nil {
		return
	}
	if !strings.HasPrefix(bundleAbs, rootAbs+string(filepath.Separator)) {
		s.logger.Warn("skip model bundle cleanup: path escapes models root", "bundle", bundleAbs, "root", rootAbs)
		return
	}
	if err := os.RemoveAll(bundleDir); err != nil {
		s.logger.Warn("cleanup removed model bundle failed", "path", bundleDir, "error", err)
	}
}

func (s *Service) CollectDeviceProfile(_ context.Context, req *runtimev1.CollectDeviceProfileRequest) (*runtimev1.CollectDeviceProfileResponse, error) {
	return &runtimev1.CollectDeviceProfileResponse{Profile: collectDeviceProfile(req.GetExtraPorts()...)}, nil
}

func localModelSortCategory(model *runtimev1.LocalAssetRecord) string {
	if model == nil {
		return "zzzz"
	}
	has := func(keys ...string) bool {
		for _, capability := range model.GetCapabilities() {
			capability = strings.ToLower(strings.TrimSpace(capability))
			for _, key := range keys {
				if capability == key {
					return true
				}
			}
		}
		return false
	}

	switch {
	case has("custom"):
		return "custom"
	case has("vision", "vl", "multimodal", "image.understand", "audio_chat", "video_chat", "text.generate.vision", "text.generate.audio", "text.generate.video"):
		return "vision"
	case has("image", "image.generate"):
		return "image"
	case has("tts", "speech.synthesize", "audio.synthesize"):
		return "tts"
	case has("stt", "speech.transcribe", "audio.transcribe"):
		return "stt"
	default:
		return "llm"
	}
}

func (s *Service) findBoundServiceID(localModelID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, service := range s.services {
		if service == nil {
			continue
		}
		if service.GetStatus() == runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED {
			continue
		}
		if strings.TrimSpace(service.GetLocalModelId()) == localModelID {
			return service.GetServiceId()
		}
	}
	return ""
}
