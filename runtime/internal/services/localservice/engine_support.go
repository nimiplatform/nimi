package localservice

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
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
		profile,
	)
}

func classifyManagedEngineSupportForAsset(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	profile *runtimev1.LocalDeviceProfile,
) (string, string) {
	if isCanonicalSupervisedImageAsset(engineName, capabilities, kind) {
		selection := canonicalSupervisedImageSelectionForAsset(engineName, capabilities, kind, profile)
		if !selection.Matched || selection.Conflict || selection.Entry == nil {
			detail := strings.TrimSpace(selection.CompatibilityDetail)
			if detail == "" {
				detail = "managed image supervised mode is unavailable on this host"
			}
			return localEngineSupportUnsupported, detail
		}
		if selection.Entry.ProductState == engine.ImageProductStateSupported {
			return localEngineSupportSupportedSupervised, ""
		}
		detail := strings.TrimSpace(selection.CompatibilityDetail)
		if detail == "" {
			detail = fmt.Sprintf("image topology %s is recognized but not supported on current product surface", selection.Entry.EntryID)
		}
		return localEngineSupportUnsupported, detail
	}

	managedEngine := managedRuntimeEngineForAsset(engineName, capabilities, kind)
	switch managedEngine {
	case "media":
		return classifyMediaHostSupport(profile)
	case "llama":
		if profile == nil {
			return localEngineSupportUnsupported, "device profile unavailable"
		}
		if engine.LlamaSupervisedPlatformSupportedFor(profile.GetOs(), profile.GetArch()) {
			return localEngineSupportSupportedSupervised, ""
		}
		return localEngineSupportAttachedOnly, "llama-backed supervised mode is unavailable on this host; configure an attached endpoint instead"
	case "speech":
		if profile == nil {
			return localEngineSupportUnsupported, "device profile unavailable"
		}
		if engine.SpeechSupervisedPlatformSupportedFor(profile.GetOs(), profile.GetArch()) {
			return localEngineSupportSupportedSupervised, ""
		}
		return localEngineSupportAttachedOnly, "speech-backed supervised mode is unavailable on this host; configure an attached endpoint instead"
	default:
		return localEngineSupportUnsupported, "unknown managed engine"
	}
}

func normalizeLocalCapabilityToken(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if catalogCapability, err := aicapabilities.NormalizeCatalogCapability(normalized); err == nil {
		return catalogCapability
	}
	return normalized
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

// isCanonicalSupervisedImageAsset determines whether an asset is a canonical
// supervised image asset using only canonical facts (engine, kind, capabilities).
// Per K-LENG-012 the v2 resolver determines the actual backend/mode; this
// function only answers "is this an image asset on the media engine?".
func isCanonicalSupervisedImageAsset(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
) bool {
	if !strings.EqualFold(strings.TrimSpace(engineName), "media") {
		return false
	}
	if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE {
		return true
	}
	return localAssetHasCapability(capabilities, "image.generate")
}

func managedRuntimeEngineForAsset(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
) string {
	if isCanonicalSupervisedImageAsset(engineName, capabilities, kind) {
		selection := canonicalSupervisedImageSelectionForAsset(engineName, capabilities, kind, collectDeviceProfile())
		if resolved := managedRuntimeEngineForSelection(selection); strings.TrimSpace(resolved) != "" {
			return resolved
		}
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
) string {
	if isCanonicalSupervisedImageAsset(engineName, capabilities, kind) {
		selection := canonicalSupervisedImageSelectionForAsset(engineName, capabilities, kind, collectDeviceProfile())
		if resolved := executionRuntimeEngineForSelection(selection); strings.TrimSpace(resolved) != "" {
			return resolved
		}
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

func managedRuntimeEngineForSelection(selection engine.ImageSupervisedMatrixSelection) string {
	if selection.Entry == nil || selection.ControlPlane == engine.ImageControlPlaneRuntime {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(string(selection.ExecutionPlane)))
}

func executionRuntimeEngineForSelection(selection engine.ImageSupervisedMatrixSelection) string {
	if selection.Entry == nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(string(selection.ExecutionPlane)))
}

func requiresGPU(engineName string) bool {
	normalized := strings.ToLower(strings.TrimSpace(engineName))
	return normalized == "media" || normalized == "media.diffusers" || strings.Contains(normalized, "cuda") || strings.Contains(normalized, "nvidia") || strings.Contains(normalized, "gpu")
}

func requiresPython(engineName string) bool {
	normalized := strings.ToLower(strings.TrimSpace(engineName))
	return normalized == "media" || normalized == "media.diffusers" || strings.Contains(normalized, "python") || strings.Contains(normalized, "py")
}

func requiresNPU(engineName string) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(engineName)), "npu")
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

func managedEngineSupportWarningsForAsset(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	profile *runtimev1.LocalDeviceProfile,
) []string {
	classification, detail := classifyManagedEngineSupportForAsset(engineName, capabilities, kind, profile)
	if isCanonicalSupervisedImageAsset(engineName, capabilities, kind) {
		return nil
	}
	if !strings.EqualFold(executionRuntimeEngineForAsset(engineName, capabilities, kind), "media") {
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

func attachedEndpointRequiredDetailForAsset(
	engineName string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	profile *runtimev1.LocalDeviceProfile,
) string {
	if !supportsSupervisedEngine(engineName) {
		return ""
	}
	classification, detail := classifyManagedEngineSupportForAsset(engineName, capabilities, kind, profile)
	if classification == localEngineSupportAttachedOnly || classification == localEngineSupportUnsupported {
		return strings.TrimSpace(detail)
	}
	return ""
}
