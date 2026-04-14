package engine

import "strings"

// SpeechSupervisedPlatformSupported reports whether runtime can manage the
// supervised speech host on the current platform.
func SpeechSupervisedPlatformSupported() bool {
	return SpeechSupervisedPlatformSupportedFor(currentGOOS(), currentGOARCH())
}

// SpeechSupervisedPlatformSupportedFor reports whether runtime can manage the
// supervised speech host for the provided platform tuple.
func SpeechSupervisedPlatformSupportedFor(goos string, goarch string) bool {
	switch strings.TrimSpace(strings.ToLower(goos)) {
	case "darwin":
		switch strings.TrimSpace(strings.ToLower(goarch)) {
		case "arm64", "amd64":
			return true
		}
	case "linux":
		switch strings.TrimSpace(strings.ToLower(goarch)) {
		case "amd64", "arm64":
			return true
		}
	case "windows":
		return strings.EqualFold(strings.TrimSpace(goarch), "amd64")
	}
	return false
}
