package localservice

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func normalizeRuntimeMode(mode runtimev1.LocalEngineRuntimeMode) runtimev1.LocalEngineRuntimeMode {
	if mode == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_UNSPECIFIED {
		return runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT
	}
	return mode
}

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
