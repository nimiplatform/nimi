package engine

import "strings"

// LocalAISupervisedPlatformSupported reports whether runtime can manage a
// LocalAI binary for the current platform.
func LocalAISupervisedPlatformSupported() bool {
	return LocalAISupervisedPlatformSupportedFor(currentGOOS(), currentGOARCH())
}

// LocalAISupervisedPlatformSupportedFor reports whether runtime can manage a
// LocalAI binary for the provided platform tuple.
func LocalAISupervisedPlatformSupportedFor(goos string, goarch string) bool {
	_, ok := localAISupervisedAssetSuffix(goos, goarch)
	return ok
}

func localAISupervisedAssetSuffix(goos string, goarch string) (string, bool) {
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
	return "", false
}
