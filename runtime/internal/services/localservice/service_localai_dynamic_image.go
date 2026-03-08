package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const (
	localAIImageWorkflowComponentsKey       = "components"
	localAIImageWorkflowProfileOverridesKey = "profile_overrides"
)

type localAIImageComponentSelection struct {
	Slot            string
	LocalArtifactID string
}

// ResolveLocalAIImageProfile renders a dynamic LocalAI image profile for the
// selected main model plus companion artifact selections supplied in the image
// scenario extension payload.
func (s *Service) ResolveLocalAIImageProfile(_ context.Context, requestedModelID string, scenarioExtensions map[string]any) (string, map[string]any, map[string]any, error) {
	model := s.resolveLocalAIImageModel(requestedModelID)
	if model == nil {
		return "", nil, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}

	defaults := structToMap(model.GetEngineConfig())
	if len(defaults) == 0 {
		return "", nil, nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "local image model missing engine_config defaults",
			ActionHint: "inspect_local_runtime_model_health",
		})
	}

	profileOverrides, err := localAIImageProfileOverrides(scenarioExtensions)
	if err != nil {
		return "", nil, nil, err
	}
	if err := validateLocalAIImageProfileOverrides(profileOverrides); err != nil {
		return "", nil, nil, err
	}

	profile := mergeMaps(defaults, profileOverrides)
	if strings.TrimSpace(valueAsString(profile["backend"])) == "" {
		profile["backend"] = "stablediffusion-ggml"
	}
	components, err := localAIImageComponents(scenarioExtensions)
	if err != nil {
		return "", nil, nil, err
	}

	modelPath, err := s.resolveLocalAIModelEntryPath(model)
	if err != nil {
		return "", nil, nil, err
	}

	parameters := valueAsObject(profile["parameters"])
	parameters["model"] = modelPath
	profile["parameters"] = parameters

	options := valueAsStringSlice(profile["options"])
	componentSlots := make(map[string]string, len(components))
	for _, component := range components {
		if component.Slot == "" || component.LocalArtifactID == "" {
			return "", nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		artifact := s.localArtifactByID(component.LocalArtifactID)
		if artifact == nil || artifact.GetStatus() == runtimev1.LocalArtifactStatus_LOCAL_ARTIFACT_STATUS_REMOVED {
			return "", nil, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
		}
		entryPath, resolveErr := s.resolveLocalAIArtifactEntryPath(artifact)
		if resolveErr != nil {
			return "", nil, nil, resolveErr
		}
		componentSlots[component.Slot] = entryPath
	}

	filteredOptions := make([]string, 0, len(options)+len(componentSlots))
	for _, option := range options {
		key, _, hasKV := strings.Cut(option, ":")
		if hasKV {
			key = strings.TrimSpace(key)
			if _, exists := componentSlots[key]; exists {
				continue
			}
		}
		filteredOptions = append(filteredOptions, option)
	}
	componentNames := make([]string, 0, len(componentSlots))
	for slot := range componentSlots {
		componentNames = append(componentNames, slot)
	}
	sort.Strings(componentNames)
	for _, slot := range componentNames {
		filteredOptions = append(filteredOptions, slot+":"+componentSlots[slot])
	}
	profile["options"] = filteredOptions

	profile["download_files"] = nil
	delete(profile, localAIImageWorkflowComponentsKey)
	delete(profile, localAIImageWorkflowProfileOverridesKey)

	canonical, err := json.Marshal(profile)
	if err != nil {
		return "", nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	sum := sha256.Sum256(canonical)
	alias := "nimi-img-" + hex.EncodeToString(sum[:8])
	profile["name"] = alias

	return alias, profile, localAIImageForwardedExtensions(scenarioExtensions), nil
}

func (s *Service) resolveLocalAIImageModel(requestedModelID string) *runtimev1.LocalModelRecord {
	normalizedID, explicitEngine, preferLocalAI := parseLocalAIRequestedModelID(requestedModelID)

	s.mu.RLock()
	defer s.mu.RUnlock()

	candidates := make([]*runtimev1.LocalModelRecord, 0, len(s.models))
	for _, model := range s.models {
		if model == nil {
			continue
		}
		if strings.TrimSpace(model.GetModelId()) != normalizedID {
			continue
		}
		if model.GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE &&
			model.GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNSPECIFIED {
			continue
		}
		if !hasCapability(model.GetCapabilities(), "image") {
			continue
		}
		candidates = append(candidates, cloneLocalModel(model))
	}
	if len(candidates) == 0 {
		return nil
	}
	sort.Slice(candidates, func(i, j int) bool {
		pi := localAIImageEnginePriority(candidates[i].GetEngine())
		pj := localAIImageEnginePriority(candidates[j].GetEngine())
		if pi != pj {
			return pi < pj
		}
		return candidates[i].GetLocalModelId() < candidates[j].GetLocalModelId()
	})

	if explicitEngine != "" {
		for _, candidate := range candidates {
			if strings.EqualFold(candidate.GetEngine(), explicitEngine) {
				return candidate
			}
		}
		return nil
	}
	if preferLocalAI {
		for _, candidate := range candidates {
			if strings.EqualFold(candidate.GetEngine(), "localai") {
				return candidate
			}
		}
	}
	return candidates[0]
}

func parseLocalAIRequestedModelID(requestedModelID string) (string, string, bool) {
	raw := strings.TrimSpace(requestedModelID)
	lower := strings.ToLower(raw)
	switch {
	case strings.HasPrefix(lower, "localai/"):
		return strings.TrimSpace(raw[len("localai/"):]), "localai", false
	case strings.HasPrefix(lower, "local/"):
		return strings.TrimSpace(raw[len("local/"):]), "", true
	case strings.HasPrefix(lower, "nexa/"):
		return strings.TrimSpace(raw[len("nexa/"):]), "nexa", false
	default:
		return raw, "", false
	}
}

func localAIImageEnginePriority(engine string) int {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "localai":
		return 0
	case "nexa":
		return 1
	default:
		return 9
	}
}

func hasCapability(capabilities []string, target string) bool {
	for _, capability := range capabilities {
		if strings.EqualFold(strings.TrimSpace(capability), target) {
			return true
		}
	}
	return false
}

func localAIImageComponents(scenarioExtensions map[string]any) ([]localAIImageComponentSelection, error) {
	raw, ok := scenarioExtensions[localAIImageWorkflowComponentsKey]
	if !ok || raw == nil {
		return nil, nil
	}
	items, ok := raw.([]any)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	result := make([]localAIImageComponentSelection, 0, len(items))
	for _, item := range items {
		object, ok := item.(map[string]any)
		if !ok {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		slot := strings.TrimSpace(valueAsString(object["slot"]))
		localArtifactID := strings.TrimSpace(valueAsString(object["localArtifactId"]))
		if localArtifactID == "" {
			localArtifactID = strings.TrimSpace(valueAsString(object["local_artifact_id"]))
		}
		result = append(result, localAIImageComponentSelection{
			Slot:            slot,
			LocalArtifactID: localArtifactID,
		})
	}
	return result, nil
}

func localAIImageProfileOverrides(scenarioExtensions map[string]any) (map[string]any, error) {
	raw, ok := scenarioExtensions[localAIImageWorkflowProfileOverridesKey]
	if !ok || raw == nil {
		return map[string]any{}, nil
	}
	object, ok := raw.(map[string]any)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return cloneAnyMap(object), nil
}

func validateLocalAIImageProfileOverrides(overrides map[string]any) error {
	if len(overrides) == 0 {
		return nil
	}
	if _, exists := overrides["download_files"]; exists {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	parameters := valueAsObject(overrides["parameters"])
	if _, exists := parameters["model"]; exists {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	for _, option := range valueAsStringSlice(overrides["options"]) {
		key, _, hasKV := strings.Cut(option, ":")
		if hasKV && strings.HasSuffix(strings.TrimSpace(key), "_path") {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	}
	return nil
}

func localAIImageForwardedExtensions(scenarioExtensions map[string]any) map[string]any {
	if len(scenarioExtensions) == 0 {
		return nil
	}
	out := make(map[string]any, len(scenarioExtensions))
	for key, value := range scenarioExtensions {
		if key == localAIImageWorkflowComponentsKey || key == localAIImageWorkflowProfileOverridesKey {
			continue
		}
		out[key] = value
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (s *Service) localArtifactByID(localArtifactID string) *runtimev1.LocalArtifactRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneLocalArtifact(s.artifacts[strings.TrimSpace(localArtifactID)])
}

func (s *Service) resolveLocalAIModelEntryPath(model *runtimev1.LocalModelRecord) (string, error) {
	if model == nil {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	return resolveLocalAIEntryRelativePath(
		resolveLocalModelsPath(s.localModelsPath),
		model.GetModelId(),
		model.GetSource().GetRepo(),
		model.GetEntry(),
	)
}

func (s *Service) resolveLocalAIArtifactEntryPath(artifact *runtimev1.LocalArtifactRecord) (string, error) {
	if artifact == nil {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	return resolveLocalAIEntryRelativePath(
		resolveLocalModelsPath(s.localModelsPath),
		artifact.GetArtifactId(),
		artifact.GetSource().GetRepo(),
		artifact.GetEntry(),
	)
}

func resolveLocalAIEntryRelativePath(modelsRoot string, itemID string, sourceRepo string, entry string) (string, error) {
	root := strings.TrimSpace(modelsRoot)
	if root == "" {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	baseDir, err := resolveLocalAIBaseDir(rootAbs, itemID, sourceRepo)
	if err != nil {
		return "", err
	}
	cleanEntry := filepath.Clean(strings.TrimSpace(entry))
	if cleanEntry == "." || cleanEntry == "" || filepath.IsAbs(cleanEntry) || cleanEntry == ".." ||
		strings.HasPrefix(cleanEntry, ".."+string(filepath.Separator)) {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	absPath := filepath.Join(baseDir, cleanEntry)
	absPath, err = filepath.Abs(absPath)
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	if !strings.HasPrefix(absPath, rootAbs+string(filepath.Separator)) && absPath != rootAbs {
		return "", grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "dynamic localai image asset must reside under local models root",
			ActionHint: "reimport_under_local_models_root",
		})
	}
	if _, statErr := os.Stat(absPath); statErr != nil {
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	relPath, err := filepath.Rel(rootAbs, absPath)
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	return filepath.ToSlash(relPath), nil
}

func resolveLocalAIBaseDir(modelsRoot string, itemID string, sourceRepo string) (string, error) {
	repo := strings.TrimSpace(sourceRepo)
	if strings.HasPrefix(repo, "file://") {
		if parsed, err := url.Parse(repo); err == nil {
			path := parsed.Path
			if path != "" {
				baseDir := filepath.Dir(path)
				baseDir, err = filepath.Abs(baseDir)
				if err == nil {
					return baseDir, nil
				}
			}
		}
	}
	return filepath.Join(modelsRoot, slugifyLocalModelID(itemID)), nil
}

func valueAsString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	default:
		return ""
	}
}

func valueAsObject(value any) map[string]any {
	if object, ok := value.(map[string]any); ok {
		return cloneAnyMap(object)
	}
	return map[string]any{}
}

func valueAsStringSlice(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		if typed, ok := value.([]string); ok {
			return append([]string(nil), typed...)
		}
		return []string{}
	}
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		if text := valueAsString(item); text != "" {
			result = append(result, text)
		}
	}
	return result
}

func cloneAnyMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(input))
	for key, value := range input {
		switch typed := value.(type) {
		case map[string]any:
			out[key] = cloneAnyMap(typed)
		case []any:
			out[key] = append([]any(nil), typed...)
		default:
			out[key] = typed
		}
	}
	return out
}

func mergeMaps(base map[string]any, overrides map[string]any) map[string]any {
	out := cloneAnyMap(base)
	for key, value := range overrides {
		nextMap, nextIsMap := value.(map[string]any)
		currentMap, currentIsMap := out[key].(map[string]any)
		if nextIsMap && currentIsMap {
			out[key] = mergeMaps(currentMap, nextMap)
			continue
		}
		switch typed := value.(type) {
		case map[string]any:
			out[key] = cloneAnyMap(typed)
		case []any:
			out[key] = append([]any(nil), typed...)
		default:
			out[key] = typed
		}
	}
	return out
}
