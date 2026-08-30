package engine

import "strings"

type MediaHostSupport string

const (
	MediaHostSupportSupportedSupervised MediaHostSupport = "supported_supervised"
	MediaHostSupportUnsupported         MediaHostSupport = "unsupported"
)

func MediaSupervisedPlatformSupported() bool {
	return MediaSupervisedPlatformSupportedFor(currentGOOS(), currentGOARCH())
}

func MediaSupervisedPlatformSupportedFor(goos string, goarch string) bool {
	normalizedOS := strings.ToLower(strings.TrimSpace(goos))
	normalizedArch := strings.ToLower(strings.TrimSpace(goarch))
	return normalizedOS == "windows" && normalizedArch == "amd64" ||
		normalizedOS == "darwin" && normalizedArch == "arm64"
}

func ClassifyMediaHost(goos string, goarch string, gpuVendor string, cudaReady bool) MediaHostSupport {
	normalizedGOOS := strings.ToLower(strings.TrimSpace(goos))
	normalizedGOARCH := strings.ToLower(strings.TrimSpace(goarch))
	if normalizedGOOS == "" || normalizedGOARCH == "" {
		return MediaHostSupportUnsupported
	}
	if !MediaSupervisedPlatformSupportedFor(normalizedGOOS, normalizedGOARCH) {
		return MediaHostSupportUnsupported
	}
	vendor := strings.ToLower(strings.TrimSpace(gpuVendor))
	if normalizedGOOS == "windows" {
		if vendor != "nvidia" || !cudaReady {
			return MediaHostSupportUnsupported
		}
		return MediaHostSupportSupportedSupervised
	}
	if normalizedGOOS == "darwin" && vendor == "apple" {
		return MediaHostSupportSupportedSupervised
	}
	return MediaHostSupportUnsupported
}

func MediaHostSupportDetail(goos string, goarch string, gpuVendor string, cudaReady bool) string {
	switch ClassifyMediaHost(goos, goarch, gpuVendor, cudaReady) {
	case MediaHostSupportSupportedSupervised:
		return ""
	default:
		if !MediaSupervisedPlatformSupportedFor(goos, goarch) {
			return "media supervised mode is unsupported on the exact host tuple"
		}
		if strings.EqualFold(strings.TrimSpace(goos), "darwin") {
			return "media supervised mode requires the admitted Apple Metal backend"
		}
		if !strings.EqualFold(strings.TrimSpace(gpuVendor), "nvidia") {
			return "media supervised mode requires the admitted NVIDIA CUDA backend"
		}
		if !cudaReady {
			return "media supervised mode requires a CUDA-ready admitted dependency"
		}
		return "media supervised mode is unsupported on the exact host tuple"
	}
}

func DetectMediaHostSupport() (MediaHostSupport, string) {
	gpuVendor, cudaReady := detectMediaHostGPU()
	support := ClassifyMediaHost(currentGOOS(), currentGOARCH(), gpuVendor, cudaReady)
	return support, MediaHostSupportDetail(currentGOOS(), currentGOARCH(), gpuVendor, cudaReady)
}
