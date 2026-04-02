package engine

import "strings"

// LlamaImageSupervisedPlatformSupported reports whether the daemon-managed
// stablediffusion-ggml image backend can be supervised on the current host.
func LlamaImageSupervisedPlatformSupported() bool {
	return LlamaImageSupervisedPlatformSupportedFor(
		currentGOOS(),
		currentGOARCH(),
		detectLocalGPUVendor(),
		detectLocalGPUModel(),
	)
}

// LlamaImageSupervisedPlatformSupportedFor reports whether the daemon-managed
// stablediffusion-ggml image backend can be supervised on the provided host tuple.
func LlamaImageSupervisedPlatformSupportedFor(goos string, goarch string, _ string, _ string) bool {
	normalizedGOOS := strings.ToLower(strings.TrimSpace(goos))
	normalizedGOARCH := strings.ToLower(strings.TrimSpace(goarch))
	if normalizedGOOS == "" || normalizedGOARCH == "" {
		return false
	}
	if !LlamaSupervisedPlatformSupportedFor(normalizedGOOS, normalizedGOARCH) {
		return false
	}
	if normalizedGOOS != "darwin" {
		return true
	}
	return normalizedGOARCH == "arm64"
}

// LlamaImageSupervisedPlatformSupportDetailFor returns the host compatibility
// detail for the daemon-managed stablediffusion-ggml image backend.
func LlamaImageSupervisedPlatformSupportDetailFor(goos string, goarch string, _ string, _ string) string {
	if LlamaImageSupervisedPlatformSupportedFor(goos, goarch, "", "") {
		return ""
	}
	return "managed image supervised mode is unavailable on this host for the daemon-managed stablediffusion-ggml backend"
}

func detectLocalGPUVendor() string {
	normalizedGOOS := strings.ToLower(strings.TrimSpace(currentGOOS()))
	normalizedGOARCH := strings.ToLower(strings.TrimSpace(currentGOARCH()))
	if normalizedGOOS == "darwin" && normalizedGOARCH == "arm64" {
		return "Apple"
	}
	return ""
}

func detectLocalGPUModel() string {
	return ""
}
