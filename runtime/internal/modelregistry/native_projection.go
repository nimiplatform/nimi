package modelregistry

import (
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
		}
	}
	return "llama"
}

func inferFallbackEngines(capabilities []string) []string {
	if inferPreferredEngine(capabilities) == "media" {
		return []string{"media.diffusers"}
	}
	return nil
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
