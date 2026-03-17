package localservice

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
	switch strings.ToLower(strings.TrimSpace(engineName)) {
	case "media":
		return classifyMediaHostSupport(profile)
	case "llama":
		if profile == nil {
			return localEngineSupportUnsupported, "device profile unavailable"
		}
		if engine.LlamaSupervisedPlatformSupportedFor(profile.GetOs(), profile.GetArch()) {
			return localEngineSupportSupportedSupervised, ""
		}
		return localEngineSupportAttachedOnly, "llama supervised mode requires macOS or Linux; configure an attached endpoint instead"
	default:
		return localEngineSupportUnsupported, "unknown managed engine"
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
	classification, detail := classifyManagedEngineSupport(engineName, profile)
	if !strings.EqualFold(strings.TrimSpace(engineName), "media") {
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
