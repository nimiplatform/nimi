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
	_, ok := llamaSupervisedAssetSuffix(goos, goarch)
	return ok
}

func llamaSupervisedAssetSuffix(goos string, goarch string) (string, bool) {
	switch strings.TrimSpace(strings.ToLower(goos)) {
	case "darwin":
		switch strings.TrimSpace(strings.ToLower(goarch)) {
		case "arm64":
			return "darwin-arm64", true
		case "amd64":
			return "darwin-amd64", true
		}
	case "linux":
		switch strings.TrimSpace(strings.ToLower(goarch)) {
		case "amd64":
			return "linux-amd64", true
		case "arm64":
			return "linux-arm64", true
		}
	}
	// Runtime only ships supervised llama sidecar assets for darwin/linux today.
	// Keep other platforms, including Windows, unsupported until there is a
	// supported packaging and update path for those managed binaries.
	return "", false
}
