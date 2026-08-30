package engine

import "strings"

// LlamaSupervisedPlatformSupported reports whether runtime can manage a
// llama binary for the current platform.
func LlamaSupervisedPlatformSupported() bool {
	return LlamaSupervisedPlatformSupportedFor(currentGOOS(), currentGOARCH())
}

// LlamaSupervisedPlatformSupportedFor reports whether runtime can manage a
// llama binary for the provided platform tuple.
func LlamaSupervisedPlatformSupportedFor(goos string, goarch string) bool {
	_, ok := llamaSupervisedAssetNameSuffix(goos, goarch)
	return ok
}

func LlamaSupervisedHostSupportedFor(goos string, goarch string, gpuVendor string, cudaReady bool) bool {
	normalizedOS := strings.ToLower(strings.TrimSpace(goos))
	normalizedArch := strings.ToLower(strings.TrimSpace(goarch))
	switch normalizedOS {
	case "windows":
		return normalizedArch == "amd64" && strings.EqualFold(strings.TrimSpace(gpuVendor), "nvidia") && cudaReady
	case "darwin":
		return normalizedArch == "arm64"
	default:
		return false
	}
}

func llamaSupervisedAssetNameSuffix(goos string, goarch string) (string, bool) {
	switch strings.TrimSpace(strings.ToLower(goos)) {
	case "darwin":
		switch strings.TrimSpace(strings.ToLower(goarch)) {
		case "arm64":
			return "bin-macos-arm64.tar.gz", true
		}
	case "windows":
		switch strings.TrimSpace(strings.ToLower(goarch)) {
		case "amd64":
			return "bin-win-cuda-12.4-x64.zip", true
		}
	}
	return "", false
}
