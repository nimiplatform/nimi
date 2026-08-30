package engine

import "strings"

// ManagedImageSupervisedPlatformSupported reports whether the daemon-managed
// stablediffusion-ggml image backend can be supervised on the current host.
func ManagedImageSupervisedPlatformSupported() bool {
	return ManagedImageSupervisedPlatformSupportedFor(
		currentGOOS(),
		currentGOARCH(),
		detectLocalGPUVendor(),
		detectLocalGPUModel(),
	)
}

// ManagedImageSupervisedPlatformSupportedFor reports whether the daemon-managed
// stablediffusion-ggml image backend can be supervised on the provided host tuple.
func ManagedImageSupervisedPlatformSupportedFor(goos string, goarch string, gpuVendor string, _ string) bool {
	normalizedGOOS := strings.ToLower(strings.TrimSpace(goos))
	normalizedGOARCH := strings.ToLower(strings.TrimSpace(goarch))
	normalizedVendor := strings.ToLower(strings.TrimSpace(gpuVendor))
	if normalizedGOOS == "" || normalizedGOARCH == "" {
		return false
	}
	return normalizedGOOS == "windows" && normalizedGOARCH == "amd64" && normalizedVendor == "nvidia" ||
		normalizedGOOS == "darwin" && normalizedGOARCH == "arm64" && normalizedVendor == "apple"
}

// ManagedImageSupervisedPlatformSupportDetailFor returns the host compatibility
// detail for the daemon-managed stablediffusion-ggml image backend.
func ManagedImageSupervisedPlatformSupportDetailFor(goos string, goarch string, gpuVendor string, gpuModel string) string {
	if ManagedImageSupervisedPlatformSupportedFor(goos, goarch, gpuVendor, gpuModel) {
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
	vendor, _ := detectMediaHostGPU()
	return strings.TrimSpace(vendor)
}

func detectLocalGPUModel() string {
	return ""
}
