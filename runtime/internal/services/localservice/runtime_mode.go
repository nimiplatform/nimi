package localservice

import (
	"strings"
)

func supportsSupervisedEngine(engine string) bool {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "llama", "media", "speech":
		return true
	default:
		return false
	}
}

func managedDefaultEndpointForEngine(engine string) string {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "llama":
		return defaultLocalEndpoint
	case "media":
		return defaultMediaEndpoint
	case "speech":
		return defaultSpeechEndpoint
	default:
		return ""
	}
}
