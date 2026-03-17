package engine

import "strings"

type MediaHostSupport string

const (
	MediaHostSupportSupportedSupervised MediaHostSupport = "supported_supervised"
	MediaHostSupportAttachedOnly        MediaHostSupport = "attached_only"
	MediaHostSupportUnsupported         MediaHostSupport = "unsupported"
)

func MediaSupervisedPlatformSupported() bool {
	return MediaSupervisedPlatformSupportedFor(currentGOOS(), currentGOARCH())
}

func MediaSupervisedPlatformSupportedFor(goos string, goarch string) bool {
	return strings.EqualFold(strings.TrimSpace(goos), "windows") &&
		strings.EqualFold(strings.TrimSpace(goarch), "amd64")
}

func ClassifyMediaHost(goos string, goarch string, gpuVendor string, cudaReady bool) MediaHostSupport {
	normalizedGOOS := strings.ToLower(strings.TrimSpace(goos))
	normalizedGOARCH := strings.ToLower(strings.TrimSpace(goarch))
	if normalizedGOOS == "" || normalizedGOARCH == "" {
		return MediaHostSupportUnsupported
	}
	if !MediaSupervisedPlatformSupportedFor(normalizedGOOS, normalizedGOARCH) {
		return MediaHostSupportAttachedOnly
	}
	if !strings.EqualFold(strings.TrimSpace(gpuVendor), "nvidia") {
		return MediaHostSupportAttachedOnly
	}
	if !cudaReady {
		return MediaHostSupportAttachedOnly
	}
	return MediaHostSupportSupportedSupervised
}

func MediaHostSupportDetail(goos string, goarch string, gpuVendor string, cudaReady bool) string {
	switch ClassifyMediaHost(goos, goarch, gpuVendor, cudaReady) {
	case MediaHostSupportSupportedSupervised:
		return ""
	case MediaHostSupportAttachedOnly:
		if !MediaSupervisedPlatformSupportedFor(goos, goarch) {
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

func DetectMediaHostSupport() (MediaHostSupport, string) {
	gpuVendor, cudaReady := detectMediaHostGPU()
	support := ClassifyMediaHost(currentGOOS(), currentGOARCH(), gpuVendor, cudaReady)
	return support, MediaHostSupportDetail(currentGOOS(), currentGOARCH(), gpuVendor, cudaReady)
}
