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

func llamaSupervisedAssetNameSuffix(goos string, goarch string) (string, bool) {
	switch strings.TrimSpace(strings.ToLower(goos)) {
	case "darwin":
		switch strings.TrimSpace(strings.ToLower(goarch)) {
		case "arm64":
			return "bin-macos-arm64.tar.gz", true
		case "amd64":
			return "bin-macos-x64.tar.gz", true
		}
	case "linux":
		switch strings.TrimSpace(strings.ToLower(goarch)) {
		case "amd64":
			return "bin-ubuntu-x64.tar.gz", true
		}
	case "windows":
		switch strings.TrimSpace(strings.ToLower(goarch)) {
		case "amd64":
			return "bin-win-cpu-x64.zip", true
		case "arm64":
			return "bin-win-cpu-arm64.zip", true
		}
	}
	return "", false
}
