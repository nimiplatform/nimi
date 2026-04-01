package modelregistry

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// NativeProjection summarizes the runtime-native execution metadata exposed
// for a model while resolved bundles are still inferred from installed inputs.
type NativeProjection struct {
	LogicalModelID   string
	Family           string
	ArtifactRoles    []string
	PreferredEngine  string
	FallbackEngines  []string
	BundleState      runtimev1.LocalBundleState
	WarmState        runtimev1.LocalWarmState
	HostRequirements *runtimev1.LocalHostRequirements
}

const (
	maxResolvedBundleSearchDepth   = 8
	maxResolvedBundleManifestReads = 256
	resolvedBundleManifestFileName = "asset.manifest.json"
)

type resolvedBundleManifestIndex struct {
	rootModTime    time.Time
	manifestByID   map[string]string
}

var (
	resolvedBundleManifestIndexMu    sync.Mutex
	resolvedBundleManifestIndexCache = make(map[string]*resolvedBundleManifestIndex)
)

func InferNativeProjection(modelID string, capabilities []string, files []string, status runtimev1.ModelStatus) (NativeProjection, error) {
	normalizedModelID := strings.TrimSpace(modelID)
	normalizedCaps := normalizeStrings(capabilities)
	normalizedFiles := normalizeStrings(files)

	if manifestProjection, ok, err := loadResolvedBundleProjection(normalizedModelID, status); err != nil {
		return NativeProjection{}, err
	} else if ok {
		return manifestProjection, nil
	}

	projection := NativeProjection{
		LogicalModelID:   normalizedModelID,
		Family:           inferModelFamily(normalizedModelID),
		ArtifactRoles:    inferArtifactRoles(normalizedCaps, normalizedFiles),
		PreferredEngine:  inferPreferredEngine(normalizedCaps),
		FallbackEngines:  inferFallbackEngines(normalizedCaps),
		BundleState:      bundleStateForModelStatus(status),
		WarmState:        warmStateForModelStatus(status),
		HostRequirements: inferHostRequirements(normalizedCaps),
	}
	return projection, nil
}

type resolvedBundleManifest struct {
	LogicalModelID   string                           `json:"logical_model_id"`
	ModelID          string                           `json:"model_id"`
	AssetID          string                           `json:"asset_id"`
	Family           string                           `json:"family"`
	Capabilities     []string                         `json:"capabilities"`
	ArtifactRoles    []string                         `json:"artifact_roles"`
	PreferredEngine  string                           `json:"preferred_engine"`
	FallbackEngines  []string                         `json:"fallback_engines"`
	HostRequirements *runtimev1.LocalHostRequirements `json:"-"`
}

type resolvedBundleManifestDisk struct {
	LogicalModelID   string         `json:"logical_model_id"`
	ModelID          string         `json:"model_id"`
	AssetID          string         `json:"asset_id"`
	Family           string         `json:"family"`
	Capabilities     []string       `json:"capabilities"`
	ArtifactRoles    []string       `json:"artifact_roles"`
	PreferredEngine  string         `json:"preferred_engine"`
	FallbackEngines  []string       `json:"fallback_engines"`
	HostRequirements map[string]any `json:"host_requirements"`
}

func loadResolvedBundleProjection(modelID string, status runtimev1.ModelStatus) (NativeProjection, bool, error) {
	manifestPath, err := resolvedBundleManifestPath(modelID)
	if err != nil {
		return NativeProjection{}, false, err
	}
	if strings.TrimSpace(manifestPath) == "" {
		return NativeProjection{}, false, nil
	}
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		return NativeProjection{}, false, fmt.Errorf("read resolved manifest %q: %w", manifestPath, err)
	}
	var disk resolvedBundleManifestDisk
	if err := json.Unmarshal(raw, &disk); err != nil {
		return NativeProjection{}, false, fmt.Errorf("parse resolved manifest %q: %w", manifestPath, err)
	}
	projection := NativeProjection{
		LogicalModelID:   firstNonEmpty(disk.LogicalModelID, disk.AssetID, disk.ModelID, modelID),
		Family:           firstNonEmpty(disk.Family, inferModelFamily(modelID)),
		ArtifactRoles:    normalizeStrings(disk.ArtifactRoles),
		PreferredEngine:  firstNonEmpty(disk.PreferredEngine, inferPreferredEngine(disk.Capabilities)),
		FallbackEngines:  publicFallbackEngines(disk.FallbackEngines),
		BundleState:      bundleStateForModelStatus(status),
		WarmState:        warmStateForModelStatus(status),
		HostRequirements: hostRequirementsFromDiskMap(disk.HostRequirements),
	}
	if projection.HostRequirements == nil {
		projection.HostRequirements = inferHostRequirements(disk.Capabilities)
	}
	return projection, true, nil
}

func resolvedBundleManifestPath(modelID string) (string, error) {
	normalizedModelID := strings.TrimSpace(modelID)
	if normalizedModelID == "" {
		return "", nil
	}
	modelsRoot := resolvedBundlesRoot()
	if strings.TrimSpace(modelsRoot) == "" {
		return "", nil
	}
	candidates := resolvedBundleManifestCandidates(modelsRoot, normalizedModelID)
	for _, candidate := range candidates {
		if fileExists(candidate) {
			return candidate, nil
		}
	}
	discovered, err := findResolvedBundleManifestByModelID(modelsRoot, normalizedModelID)
	if strings.TrimSpace(discovered) != "" || err != nil {
		return discovered, err
	}
	return "", nil
}

func resolvedBundlesRoot() string {
	if override := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_MODELS_PATH")); override != "" {
		return filepath.Join(override, "resolved")
	}
	if override := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_MODELS_ROOT")); override != "" {
		return filepath.Join(override, "resolved")
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, ".nimi", "data", "models", "resolved")
}

func resolvedBundleManifestCandidates(resolvedRoot string, modelID string) []string {
	normalized := strings.TrimSpace(modelID)
	if normalized == "" {
		return nil
	}
	candidates := make([]string, 0, 4)
	add := func(parts ...string) {
		candidate := filepath.Join(append([]string{resolvedRoot}, parts...)...)
		if !pathWithinRoot(resolvedRoot, candidate) {
			return
		}
		for _, existing := range candidates {
			if existing == candidate {
				return
			}
		}
		candidates = append(candidates, candidate)
	}
	add(filepath.FromSlash(normalized), "asset.manifest.json")
	if trimmed, ok := trimPublicLocalPrefix(normalized); ok {
		add(filepath.FromSlash(trimmed), "asset.manifest.json")
		add("nimi", filepath.FromSlash(trimmed), "asset.manifest.json")
	}
	return candidates
}

func trimPublicLocalPrefix(modelID string) (string, bool) {
	normalized := strings.TrimSpace(modelID)
	lower := strings.ToLower(normalized)
	for _, prefix := range []string{"local/", "llama/", "media/", "speech/", "sidecar/"} {
		if strings.HasPrefix(lower, prefix) {
			return strings.TrimSpace(normalized[len(prefix):]), true
		}
	}
	return normalized, false
}

func pathWithinRoot(root string, candidate string) bool {
	normalizedRoot := filepath.Clean(strings.TrimSpace(root))
	normalizedCandidate := filepath.Clean(strings.TrimSpace(candidate))
	if normalizedRoot == "" || normalizedCandidate == "" {
		return false
	}
	rel, err := filepath.Rel(normalizedRoot, normalizedCandidate)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

func relativePathDepth(path string) int {
	normalized := filepath.Clean(strings.TrimSpace(path))
	if normalized == "." || normalized == "" {
		return 0
	}
	return len(strings.Split(normalized, string(filepath.Separator)))
}

func findResolvedBundleManifestByModelID(resolvedRoot string, modelID string) (string, error) {
	expectedComparable := comparableResolvedModelID(modelID)
	if expectedComparable == "" {
		return "", nil
	}
	rootModTime, err := resolvedBundleRootModTime(resolvedRoot)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", err
	}
	if cachedPath, ok := resolvedBundleManifestFromIndex(resolvedRoot, rootModTime, expectedComparable); ok {
		return cachedPath, nil
	}
	index, err := buildResolvedBundleManifestIndex(resolvedRoot, rootModTime, modelID)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", err
	}
	storeResolvedBundleManifestIndex(resolvedRoot, index)
	return strings.TrimSpace(index.manifestByID[expectedComparable]), nil
}

func resolvedBundleRootModTime(resolvedRoot string) (time.Time, error) {
	info, err := os.Stat(resolvedRoot)
	if err != nil {
		return time.Time{}, err
	}
	if info == nil || !info.IsDir() {
		return time.Time{}, os.ErrNotExist
	}
	return info.ModTime(), nil
}

func resolvedBundleManifestFromIndex(resolvedRoot string, rootModTime time.Time, comparableModelID string) (string, bool) {
	resolvedBundleManifestIndexMu.Lock()
	defer resolvedBundleManifestIndexMu.Unlock()
	index := resolvedBundleManifestIndexCache[resolvedRoot]
	if index == nil || !index.rootModTime.Equal(rootModTime) {
		return "", false
	}
	return strings.TrimSpace(index.manifestByID[comparableModelID]), true
}

func storeResolvedBundleManifestIndex(resolvedRoot string, index *resolvedBundleManifestIndex) {
	if strings.TrimSpace(resolvedRoot) == "" || index == nil {
		return
	}
	resolvedBundleManifestIndexMu.Lock()
	resolvedBundleManifestIndexCache[resolvedRoot] = index
	resolvedBundleManifestIndexMu.Unlock()
}

func buildResolvedBundleManifestIndex(resolvedRoot string, rootModTime time.Time, modelID string) (*resolvedBundleManifestIndex, error) {
	index := &resolvedBundleManifestIndex{
		rootModTime:  rootModTime,
		manifestByID: make(map[string]string),
	}
	manifestReads := 0
	err := filepath.WalkDir(resolvedRoot, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d == nil {
			return nil
		}
		rel, err := filepath.Rel(resolvedRoot, path)
		if err != nil {
			return err
		}
		if d.IsDir() && relativePathDepth(rel) > maxResolvedBundleSearchDepth {
			return fs.SkipDir
		}
		if d.IsDir() || !strings.EqualFold(d.Name(), resolvedBundleManifestFileName) {
			return nil
		}
		manifestReads++
		if manifestReads > maxResolvedBundleManifestReads {
			return fmt.Errorf("resolved manifest search exceeded %d files for %q", maxResolvedBundleManifestReads, modelID)
		}
		raw, readErr := os.ReadFile(path)
		if readErr != nil {
			return fmt.Errorf("read resolved manifest %q: %w", path, readErr)
		}
		var disk resolvedBundleManifestDisk
		if jsonErr := json.Unmarshal(raw, &disk); jsonErr != nil {
			return fmt.Errorf("parse resolved manifest %q: %w", path, jsonErr)
		}
		for _, comparableID := range []string{
			comparableResolvedModelID(disk.AssetID),
			comparableResolvedModelID(disk.ModelID),
			comparableResolvedModelID(disk.LogicalModelID),
		} {
			if comparableID == "" {
				continue
			}
			if _, exists := index.manifestByID[comparableID]; !exists {
				index.manifestByID[comparableID] = path
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return index, nil
}

func comparableResolvedModelID(modelID string) string {
	trimmed := strings.TrimSpace(modelID)
	if trimmed == "" {
		return ""
	}
	if value, ok := trimPublicLocalPrefix(trimmed); ok {
		trimmed = value
	}
	return strings.ToLower(strings.TrimSpace(trimmed))
}

func fileExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func hostRequirementsFromDiskMap(input map[string]any) *runtimev1.LocalHostRequirements {
	if len(input) == 0 {
		return nil
	}
	requirements := &runtimev1.LocalHostRequirements{}
	if value, ok := input["gpu_required"].(bool); ok {
		requirements.GpuRequired = value
	}
	if value, ok := input["python_runtime_required"].(bool); ok {
		requirements.PythonRuntimeRequired = value
	}
	if list, ok := input["supported_platforms"].([]any); ok {
		for _, item := range list {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				requirements.SupportedPlatforms = append(requirements.SupportedPlatforms, strings.TrimSpace(text))
			}
		}
	}
	if list, ok := input["required_backends"].([]any); ok {
		for _, item := range list {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				requirements.RequiredBackends = append(requirements.RequiredBackends, strings.TrimSpace(text))
			}
		}
	}
	return requirements
}

func normalizeStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		normalized := strings.TrimSpace(value)
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		out = append(out, normalized)
	}
	sort.Strings(out)
	return out
}

func inferModelFamily(modelID string) string {
	lower := strings.ToLower(strings.TrimSpace(modelID))
	switch {
	case strings.Contains(lower, "wan"):
		return "wan"
	case strings.Contains(lower, "flux"):
		return "flux"
	case strings.Contains(lower, "qwen") && strings.Contains(lower, "image"):
		return "qwen-image"
	case strings.Contains(lower, "qwen") && strings.Contains(lower, "vl"):
		return "qwen-vl"
	case strings.Contains(lower, "qwen"):
		return "qwen"
	case strings.Contains(lower, "llama"):
		return "llama"
	case strings.Contains(lower, "whisper"):
		return "whisper"
	case strings.Contains(lower, "sd") || strings.Contains(lower, "diffusion"):
		return "diffusion"
	default:
		return "generic"
	}
}

func inferArtifactRoles(capabilities []string, files []string) []string {
	roles := make([]string, 0, 6)
	seen := make(map[string]struct{}, 6)
	add := func(role string) {
		if role == "" {
			return
		}
		if _, ok := seen[role]; ok {
			return
		}
		seen[role] = struct{}{}
		roles = append(roles, role)
	}

	for _, capability := range capabilities {
		switch strings.ToLower(strings.TrimSpace(capability)) {
		case "chat", "text.generate", "text.embed", "text.generate.vision", "text.generate.audio", "text.generate.video":
			add("llm")
		case "image.generate", "image.edit", "video.generate", "i2v":
			add("diffusion_transformer")
			add("text_encoder")
			add("vae")
		}
	}

	for _, file := range files {
		lower := strings.ToLower(strings.TrimSpace(file))
		switch {
		case strings.Contains(lower, "mmproj"):
			add("mmproj")
		case strings.Contains(lower, "tokenizer"):
			add("tokenizer")
		case strings.Contains(lower, "vae"):
			add("vae")
		case strings.Contains(lower, "controlnet"):
			add("controlnet")
		case strings.Contains(lower, "lora"):
			add("lora")
		case strings.HasSuffix(lower, ".gguf") && !strings.Contains(lower, "mmproj"):
			add("llm")
		}
	}

	sort.Strings(roles)
	return roles
}

func inferPreferredEngine(capabilities []string) string {
	for _, capability := range capabilities {
		switch strings.ToLower(strings.TrimSpace(capability)) {
		case "image.generate", "image.edit", "video.generate", "i2v":
			return "media"
		case "audio.transcribe", "audio.synthesize", "voice_workflow.tts_v2v", "voice_workflow.tts_t2v":
			return "speech"
		}
	}
	return "llama"
}

func inferFallbackEngines(capabilities []string) []string {
	// Inferred projections only expose a preferred engine. Fallback engines are
	// sourced from resolved bundle manifests once the runtime has typed metadata.
	_ = capabilities
	return nil
}

func publicFallbackEngines(values []string) []string {
	filtered := make([]string, 0, len(values))
	for _, value := range normalizeStrings(values) {
		if strings.EqualFold(strings.TrimSpace(value), "media.diffusers") {
			continue
		}
		filtered = append(filtered, value)
	}
	return filtered
}

func bundleStateForModelStatus(status runtimev1.ModelStatus) runtimev1.LocalBundleState {
	switch status {
	case runtimev1.ModelStatus_MODEL_STATUS_PULLING:
		return runtimev1.LocalBundleState_LOCAL_BUNDLE_STATE_RESOLVING
	case runtimev1.ModelStatus_MODEL_STATUS_INSTALLED:
		return runtimev1.LocalBundleState_LOCAL_BUNDLE_STATE_READY
	case runtimev1.ModelStatus_MODEL_STATUS_FAILED:
		return runtimev1.LocalBundleState_LOCAL_BUNDLE_STATE_INVALID
	case runtimev1.ModelStatus_MODEL_STATUS_REMOVED:
		return runtimev1.LocalBundleState_LOCAL_BUNDLE_STATE_REMOVED
	default:
		return runtimev1.LocalBundleState_LOCAL_BUNDLE_STATE_UNSPECIFIED
	}
}

func warmStateForModelStatus(status runtimev1.ModelStatus) runtimev1.LocalWarmState {
	switch status {
	case runtimev1.ModelStatus_MODEL_STATUS_PULLING:
		return runtimev1.LocalWarmState_LOCAL_WARM_STATE_WARMING
	case runtimev1.ModelStatus_MODEL_STATUS_INSTALLED:
		return runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD
	case runtimev1.ModelStatus_MODEL_STATUS_FAILED:
		return runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED
	default:
		return runtimev1.LocalWarmState_LOCAL_WARM_STATE_UNSPECIFIED
	}
}

func inferHostRequirements(capabilities []string) *runtimev1.LocalHostRequirements {
	requirements := &runtimev1.LocalHostRequirements{}
	requiredBackends := make(map[string]struct{})
	addBackends := func(values ...string) {
		for _, value := range values {
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				requiredBackends[trimmed] = struct{}{}
			}
		}
	}
	for _, capability := range capabilities {
		switch strings.ToLower(strings.TrimSpace(capability)) {
		case "image.generate", "image.edit", "video.generate", "i2v":
			requirements.GpuRequired = true
			requirements.PythonRuntimeRequired = true
			addBackends("stable-diffusion.cpp", "diffusers")
		case "audio.transcribe":
			addBackends("whispercpp")
		case "audio.synthesize":
			addBackends("kokoro")
		case "voice_workflow.tts_v2v", "voice_workflow.tts_t2v":
			requirements.GpuRequired = true
			requirements.PythonRuntimeRequired = true
			addBackends("qwen3tts")
		}
	}
	if len(requiredBackends) > 0 {
		requirements.RequiredBackends = make([]string, 0, len(requiredBackends))
		for backend := range requiredBackends {
			requirements.RequiredBackends = append(requirements.RequiredBackends, backend)
		}
		sort.Strings(requirements.RequiredBackends)
	}
	if !requirements.GetGpuRequired() && !requirements.GetPythonRuntimeRequired() && len(requirements.GetRequiredBackends()) == 0 {
		return &runtimev1.LocalHostRequirements{
			GpuRequired:           false,
			PythonRuntimeRequired: false,
			RequiredBackends:      []string{"llama.cpp"},
		}
	}
	return requirements
}
