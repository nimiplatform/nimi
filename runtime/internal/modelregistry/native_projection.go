package modelregistry

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

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

func InferNativeProjection(modelID string, capabilities []string, files []string, status runtimev1.ModelStatus) NativeProjection {
	normalizedModelID := strings.TrimSpace(modelID)
	normalizedCaps := normalizeStrings(capabilities)
	normalizedFiles := normalizeStrings(files)

	if manifestProjection, ok := loadResolvedBundleProjection(normalizedModelID, status); ok {
		return manifestProjection
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
	if projection.LogicalModelID == "" {
		projection.LogicalModelID = normalizedModelID
	}
	return projection
}

type resolvedBundleManifest struct {
	LogicalModelID   string                 `json:"logical_model_id"`
	ModelID          string                 `json:"model_id"`
	Family           string                 `json:"family"`
	Capabilities     []string               `json:"capabilities"`
	ArtifactRoles    []string               `json:"artifact_roles"`
	PreferredEngine  string                 `json:"preferred_engine"`
	FallbackEngines  []string               `json:"fallback_engines"`
	HostRequirements *runtimev1.LocalHostRequirements `json:"-"`
}

type resolvedBundleManifestDisk struct {
	LogicalModelID   string            `json:"logical_model_id"`
	ModelID          string            `json:"model_id"`
	Family           string            `json:"family"`
	Capabilities     []string          `json:"capabilities"`
	ArtifactRoles    []string          `json:"artifact_roles"`
	PreferredEngine  string            `json:"preferred_engine"`
	FallbackEngines  []string          `json:"fallback_engines"`
	HostRequirements map[string]any    `json:"host_requirements"`
}

func loadResolvedBundleProjection(modelID string, status runtimev1.ModelStatus) (NativeProjection, bool) {
	manifestPath := resolvedBundleManifestPath(modelID)
	if strings.TrimSpace(manifestPath) == "" {
		return NativeProjection{}, false
	}
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		return NativeProjection{}, false
	}
	var disk resolvedBundleManifestDisk
	if err := json.Unmarshal(raw, &disk); err != nil {
		return NativeProjection{}, false
	}
	projection := NativeProjection{
		LogicalModelID:   firstNonEmpty(disk.LogicalModelID, disk.ModelID, modelID),
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
	return projection, true
}

func resolvedBundleManifestPath(modelID string) string {
	normalizedModelID := strings.TrimSpace(modelID)
	if normalizedModelID == "" {
		return ""
	}
	modelsRoot := resolvedBundlesRoot()
	if strings.TrimSpace(modelsRoot) == "" {
		return ""
	}
	candidates := resolvedBundleManifestCandidates(modelsRoot, normalizedModelID)
	for _, candidate := range candidates {
		if fileExists(candidate) {
			return candidate
		}
	}
	if discovered := findResolvedBundleManifestByModelID(modelsRoot, normalizedModelID); strings.TrimSpace(discovered) != "" {
		return discovered
	}
	return ""
}

func resolvedBundlesRoot() string {
	if override := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_MODELS_ROOT")); override != "" {
		return filepath.Join(override, "resolved")
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, ".nimi", "models", "resolved")
}

func resolvedBundleManifestCandidates(resolvedRoot string, modelID string) []string {
	normalized := strings.TrimSpace(modelID)
	if normalized == "" {
		return nil
	}
	candidates := make([]string, 0, 4)
	add := func(parts ...string) {
		candidate := filepath.Join(append([]string{resolvedRoot}, parts...)...)
		if candidate == "" {
			return
		}
		for _, existing := range candidates {
			if existing == candidate {
				return
			}
		}
		candidates = append(candidates, candidate)
	}
	add(filepath.FromSlash(normalized), "manifest.json")
	if trimmed, ok := trimPublicLocalPrefix(normalized); ok {
		add(filepath.FromSlash(trimmed), "manifest.json")
		add("nimi", filepath.FromSlash(trimmed), "manifest.json")
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

func findResolvedBundleManifestByModelID(resolvedRoot string, modelID string) string {
	expectedComparable := comparableResolvedModelID(modelID)
	if expectedComparable == "" {
		return ""
	}
	var discovered string
	_ = filepath.WalkDir(resolvedRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil || discovered != "" {
			return nil
		}
		if d == nil || d.IsDir() || !strings.EqualFold(d.Name(), "manifest.json") {
			return nil
		}
		raw, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil
		}
		var disk resolvedBundleManifestDisk
		if jsonErr := json.Unmarshal(raw, &disk); jsonErr != nil {
			return nil
		}
		if comparableResolvedModelID(disk.ModelID) == expectedComparable || comparableResolvedModelID(disk.LogicalModelID) == expectedComparable {
			discovered = path
		}
		return nil
	})
	return discovered
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
	for _, capability := range capabilities {
		switch strings.ToLower(strings.TrimSpace(capability)) {
		case "image.generate", "image.edit", "video.generate", "i2v":
			requirements.GpuRequired = true
			requirements.PythonRuntimeRequired = true
			requirements.RequiredBackends = []string{"stable-diffusion.cpp", "diffusers"}
		case "audio.transcribe":
			requirements.RequiredBackends = []string{"whispercpp"}
		case "audio.synthesize":
			requirements.RequiredBackends = []string{"kokoro"}
		case "voice_workflow.tts_v2v", "voice_workflow.tts_t2v":
			requirements.GpuRequired = true
			requirements.PythonRuntimeRequired = true
			requirements.RequiredBackends = []string{"qwen3tts"}
		}
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
