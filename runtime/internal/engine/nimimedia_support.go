package engine

import "strings"

type NimiMediaHostSupport string

const (
	NimiMediaHostSupportSupportedSupervised NimiMediaHostSupport = "supported_supervised"
	NimiMediaHostSupportAttachedOnly        NimiMediaHostSupport = "attached_only"
	NimiMediaHostSupportUnsupported         NimiMediaHostSupport = "unsupported"
)

func NimiMediaSupervisedPlatformSupported() bool {
	return NimiMediaSupervisedPlatformSupportedFor(currentGOOS(), currentGOARCH())
}

func NimiMediaSupervisedPlatformSupportedFor(goos string, goarch string) bool {
	return strings.EqualFold(strings.TrimSpace(goos), "windows") &&
		strings.EqualFold(strings.TrimSpace(goarch), "amd64")
}

func ClassifyNimiMediaHost(goos string, goarch string, gpuVendor string, cudaReady bool) NimiMediaHostSupport {
	normalizedGOOS := strings.ToLower(strings.TrimSpace(goos))
	normalizedGOARCH := strings.ToLower(strings.TrimSpace(goarch))
	if normalizedGOOS == "" || normalizedGOARCH == "" {
		return NimiMediaHostSupportUnsupported
	}
	if !NimiMediaSupervisedPlatformSupportedFor(normalizedGOOS, normalizedGOARCH) {
		return NimiMediaHostSupportAttachedOnly
	}
	if !strings.EqualFold(strings.TrimSpace(gpuVendor), "nvidia") {
		return NimiMediaHostSupportAttachedOnly
	}
	if !cudaReady {
		return NimiMediaHostSupportAttachedOnly
	}
	return NimiMediaHostSupportSupportedSupervised
}

func NimiMediaHostSupportDetail(goos string, goarch string, gpuVendor string, cudaReady bool) string {
	switch ClassifyNimiMediaHost(goos, goarch, gpuVendor, cudaReady) {
	case NimiMediaHostSupportSupportedSupervised:
		return ""
	case NimiMediaHostSupportAttachedOnly:
		if !NimiMediaSupervisedPlatformSupportedFor(goos, goarch) {
			return "media supervised mode requires Windows x64; configure an attached endpoint instead"
		}
		if !strings.EqualFold(strings.TrimSpace(gpuVendor), "nvidia") {
			return "media supervised mode requires an NVIDIA GPU; configure an attached endpoint instead"
		}
		if !cudaReady {
			return "media supervised mode requires a CUDA-ready NVIDIA runtime; configure an attached endpoint instead"
		}
		return "media supervised mode is unavailable on this host; configure an attached endpoint instead"
	default:
		return "media is unsupported on this host"
	}
}

func DetectNimiMediaHostSupport() (NimiMediaHostSupport, string) {
	gpuVendor, cudaReady := detectNimiMediaHostGPU()
	support := ClassifyNimiMediaHost(currentGOOS(), currentGOARCH(), gpuVendor, cudaReady)
	return support, NimiMediaHostSupportDetail(currentGOOS(), currentGOARCH(), gpuVendor, cudaReady)
}
