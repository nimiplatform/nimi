package localservice

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	localEngineSupportSupportedSupervised = "supported_supervised"
	localEngineSupportAttachedOnly        = "attached_only"
	localEngineSupportUnsupported         = "unsupported"
	warnMediaAttachedOnly                 = "WARN_NIMI_MEDIA_ATTACHED_ONLY"
	warnCUDARequired                      = "WARN_CUDA_REQUIRED"
)

func classifyManagedEngineSupport(engineName string, profile *runtimev1.LocalDeviceProfile) (string, string) {
	return classifyManagedEngineSupportForAsset(
		engineName,
		nil,
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED,
		nil,
		"",
		profile,
	)
}

func classifyManagedEngineSupportForAsset(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
	profile *runtimev1.LocalDeviceProfile,
) (string, string) {
	managedEngine := managedRuntimeEngineForAsset(engineName, capabilities, kind, engineConfig, preferredEngine)
	switch managedEngine {
	case "media":
		return classifyMediaHostSupport(profile)
	case "llama":
		if profile == nil {
			return localEngineSupportUnsupported, "device profile unavailable"
		}
		if isManagedLlamaBackedImageAsset(engineName, capabilities, kind, engineConfig, preferredEngine) {
			selection := engine.ResolveImageSupervisedBackendMatrixSelection(
				profile.GetOs(),
				profile.GetArch(),
				profile.GetGpu().GetVendor(),
				profile.GetGpu().GetModel(),
			)
			if selection.Supported {
				return localEngineSupportSupportedSupervised, ""
			}
			return localEngineSupportUnsupported, strings.TrimSpace(selection.Detail)
		}
		if engine.LlamaSupervisedPlatformSupportedFor(profile.GetOs(), profile.GetArch()) {
			return localEngineSupportSupportedSupervised, ""
		}
		return localEngineSupportAttachedOnly, "llama-backed supervised mode is unavailable on this host; configure an attached endpoint instead"
	case "speech":
		if profile == nil {
			return localEngineSupportUnsupported, "device profile unavailable"
		}
		return localEngineSupportSupportedSupervised, ""
	default:
		return localEngineSupportUnsupported, "unknown managed engine"
	}
}

func normalizeLocalCapabilityToken(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func localAssetHasCapability(capabilities []string, targets ...string) bool {
	if len(capabilities) == 0 || len(targets) == 0 {
		return false
	}
	normalizedTargets := make(map[string]struct{}, len(targets))
	for _, target := range targets {
		if normalized := normalizeLocalCapabilityToken(target); normalized != "" {
			normalizedTargets[normalized] = struct{}{}
		}
	}
	for _, capability := range capabilities {
		if _, ok := normalizedTargets[normalizeLocalCapabilityToken(capability)]; ok {
			return true
		}
	}
	return false
}

func localAssetStructString(input *structpb.Struct, key string) string {
	if input == nil {
		return ""
	}
	fields := input.GetFields()
	if len(fields) == 0 {
		return ""
	}
	field, ok := fields[key]
	if !ok || field == nil {
		return ""
	}
	return strings.TrimSpace(field.GetStringValue())
}

func isManagedLlamaBackedImageAsset(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
) bool {
	if !strings.EqualFold(strings.TrimSpace(engineName), "media") {
		return false
	}
	if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE {
		return true
	}
	if localAssetHasCapability(capabilities, "image", "image.generate", "image.edit") {
		return true
	}
	if strings.EqualFold(localAssetStructString(engineConfig, "backend"), "stablediffusion-ggml") {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(preferredEngine), "llama")
}

func managedRuntimeEngineForAsset(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
) string {
	if isManagedLlamaBackedImageAsset(engineName, capabilities, kind, engineConfig, preferredEngine) {
		return "llama"
	}
	switch strings.ToLower(strings.TrimSpace(engineName)) {
	case "media":
		return "media"
	case "llama":
		return "llama"
	case "speech":
		return "speech"
	default:
		return strings.ToLower(strings.TrimSpace(engineName))
	}
}

func executionRuntimeEngineForAsset(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
) string {
	if isManagedLlamaBackedImageAsset(engineName, capabilities, kind, engineConfig, preferredEngine) {
		return "media"
	}
	switch strings.ToLower(strings.TrimSpace(engineName)) {
	case "media":
		return "media"
	case "llama":
		return "llama"
	case "speech":
		return "speech"
	default:
		return strings.ToLower(strings.TrimSpace(engineName))
	}
}

func classifyMediaHostSupport(profile *runtimev1.LocalDeviceProfile) (string, string) {
	cudaReady, _ := probeGPUCUDAReady()
	return classifyMediaHostSupportWithCUDA(profile, cudaReady)
}

func classifyMediaHostSupportWithCUDA(profile *runtimev1.LocalDeviceProfile, cudaReady bool) (string, string) {
	if profile == nil {
		return localEngineSupportUnsupported, "device profile unavailable"
	}
	support := engine.ClassifyMediaHost(profile.GetOs(), profile.GetArch(), profile.GetGpu().GetVendor(), cudaReady)
	switch support {
	case engine.MediaHostSupportSupportedSupervised:
		return localEngineSupportSupportedSupervised, ""
	case engine.MediaHostSupportAttachedOnly:
		return localEngineSupportAttachedOnly, engine.MediaHostSupportDetail(profile.GetOs(), profile.GetArch(), profile.GetGpu().GetVendor(), cudaReady)
	default:
		return localEngineSupportUnsupported, engine.MediaHostSupportDetail(profile.GetOs(), profile.GetArch(), profile.GetGpu().GetVendor(), cudaReady)
	}
}

func managedEngineSupportWarnings(engineName string, profile *runtimev1.LocalDeviceProfile) []string {
	return managedEngineSupportWarningsForAsset(
		engineName,
		nil,
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED,
		nil,
		"",
		profile,
	)
}

func managedEngineSupportWarningsForAsset(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
	profile *runtimev1.LocalDeviceProfile,
) []string {
	classification, detail := classifyManagedEngineSupportForAsset(engineName, capabilities, kind, engineConfig, preferredEngine, profile)
	if isCanonicalSupervisedImageAsset(engineName, capabilities, kind, engineConfig, preferredEngine) {
		return nil
	}
	if !strings.EqualFold(executionRuntimeEngineForAsset(engineName, capabilities, kind, engineConfig, preferredEngine), "media") {
		return nil
	}
	if classification == localEngineSupportSupportedSupervised {
		return nil
	}
	warnings := []string{warnMediaAttachedOnly}
	if strings.Contains(strings.ToLower(detail), "cuda") {
		warnings = append(warnings, warnCUDARequired)
	}
	return warnings
}

func shouldManageMediaEndpoint(endpoint string) bool {
	trimmed := strings.TrimSpace(endpoint)
	return trimmed == "" || strings.EqualFold(trimmed, defaultMediaEndpoint)
}

func normalizeEndpointForComparison(endpoint string) string {
	return strings.TrimRight(strings.TrimSpace(endpoint), "/")
}

func isManagedLoopbackEndpoint(engineName string, endpoint string) bool {
	managedEndpoint := managedDefaultEndpointForEngine(engineName)
	if managedEndpoint == "" {
		return false
	}
	return strings.EqualFold(
		normalizeEndpointForComparison(endpoint),
		normalizeEndpointForComparison(managedEndpoint),
	)
}

func attachedLoopbackConfigErrorDetail(
	engineName string,
	mode runtimev1.LocalEngineRuntimeMode,
	endpoint string,
	profile *runtimev1.LocalDeviceProfile,
) string {
	if normalizeRuntimeMode(mode) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT {
		return ""
	}
	engineName = strings.ToLower(strings.TrimSpace(engineName))
	if engineName != "media" && engineName != "speech" {
		return ""
	}
	if !isManagedLoopbackEndpoint(engineName, endpoint) {
		return ""
	}
	classification, detail := classifyManagedEngineSupport(engineName, profile)
	if classification == localEngineSupportSupportedSupervised {
		return ""
	}
	managedEndpoint := managedDefaultEndpointForEngine(engineName)
	hostDetail := strings.TrimSpace(detail)
	if hostDetail == "" {
		hostDetail = fmt.Sprintf("%s supervised mode is unavailable on this host; configure an attached endpoint instead", engineName)
	}
	return fmt.Sprintf(
		"attached endpoint %s is invalid on this host; %s",
		managedEndpoint,
		hostDetail,
	)
}

func attachedEndpointRequiredDetailForAsset(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
	profile *runtimev1.LocalDeviceProfile,
) string {
	if !supportsSupervisedEngine(engineName) {
		return ""
	}
	classification, detail := classifyManagedEngineSupportForAsset(engineName, capabilities, kind, engineConfig, preferredEngine, profile)
	if classification == localEngineSupportAttachedOnly || classification == localEngineSupportUnsupported {
		return strings.TrimSpace(detail)
	}
	return ""
}
