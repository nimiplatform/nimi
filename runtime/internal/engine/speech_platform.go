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
	normalizedOS := strings.TrimSpace(strings.ToLower(goos))
	normalizedArch := strings.TrimSpace(strings.ToLower(goarch))
	return normalizedOS == "windows" && normalizedArch == "amd64" || normalizedOS == "darwin" && normalizedArch == "arm64"
}
