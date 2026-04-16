package localservice

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func projectionReasonCodeForEngine(engine string, detail string) runtimev1.ReasonCode {
	if !strings.EqualFold(strings.TrimSpace(engine), "speech") {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	return projectionSpeechReasonCodeFromDetail(detail)
}

func projectionSpeechReasonCodeFromDetail(detail string) runtimev1.ReasonCode {
	lower := strings.ToLower(strings.TrimSpace(detail))
	if lower == "" {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}

	switch {
	case strings.Contains(lower, "speech-backed supervised mode is unavailable on this host"),
		strings.Contains(lower, "configure an attached endpoint instead"),
		strings.Contains(lower, "requires windows x64"),
		strings.Contains(lower, "requires an nvidia gpu"),
		strings.Contains(lower, "requires a cuda-ready nvidia runtime"):
		return runtimev1.ReasonCode_AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED
	case strings.Contains(lower, "explicit download confirmation"),
		strings.Contains(lower, "download confirmation required"),
		strings.Contains(lower, "confirm download before continuing"):
		return runtimev1.ReasonCode_AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED
	case strings.Contains(lower, "ensure uv for speech"),
		strings.Contains(lower, "ensure managed python for speech"),
		strings.Contains(lower, "write speech server script"),
		strings.Contains(lower, "install speech dependencies"),
		strings.Contains(lower, "write speech dependency stamp"):
		return runtimev1.ReasonCode_AI_LOCAL_SPEECH_ENV_INIT_FAILED
	case strings.Contains(lower, "speech probe missing expected model"):
		return runtimev1.ReasonCode_AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED
	case strings.Contains(lower, "speech probe missing required capability"),
		strings.Contains(lower, "managed bundle file"),
		strings.Contains(lower, "managed local model entry missing"),
		strings.Contains(lower, "managed speech endpoint missing"),
		strings.Contains(lower, "managed speech voices invalid"),
		strings.Contains(lower, "voices.json"):
		return runtimev1.ReasonCode_AI_LOCAL_SPEECH_BUNDLE_DEGRADED
	case strings.Contains(lower, "speech") &&
		(strings.Contains(lower, "probe request failed") ||
			strings.Contains(lower, "probe status not ok") ||
			strings.Contains(lower, "probe response parse failed") ||
			strings.Contains(lower, "catalog status not ok") ||
			strings.Contains(lower, "catalog parse failed") ||
			strings.Contains(lower, "connect") ||
			strings.Contains(lower, "timed out") ||
			strings.Contains(lower, "engine not ready")):
		return runtimev1.ReasonCode_AI_LOCAL_SPEECH_HOST_INIT_FAILED
	default:
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
}
