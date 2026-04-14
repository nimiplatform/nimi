package localservice

import (
	"regexp"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

var probeDetailURLPattern = regexp.MustCompile("https?://[^\\s\"'`;]+")

func sanitizePublicProbeDetail(detail string) string {
	trimmed := strings.TrimSpace(detail)
	if trimmed == "" {
		return ""
	}
	return probeDetailURLPattern.ReplaceAllString(trimmed, "probe_endpoint")
}

func appendSanitizedPublicProbePlane(detail string, mode runtimev1.LocalEngineRuntimeMode) string {
	plane := ""
	switch normalizeRuntimeMode(mode) {
	case runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED:
		plane = "local-supervised"
	case runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT:
		plane = "attached-endpoint"
	}
	if plane == "" {
		return strings.TrimSpace(detail)
	}
	if strings.TrimSpace(detail) == "" {
		return "plane=" + plane
	}
	return strings.TrimSpace(detail) + "; plane=" + plane
}

func sanitizedServiceProbeDetail(
	detail string,
	mode runtimev1.LocalEngineRuntimeMode,
	bootstrapErr error,
) string {
	sanitized := sanitizePublicProbeDetail(detail)
	sanitized = appendSanitizedBootstrapFailureDetail(sanitized, bootstrapErr)
	return appendSanitizedPublicProbePlane(sanitized, mode)
}

func sanitizedModelProbeDetail(
	detail string,
	mode runtimev1.LocalEngineRuntimeMode,
	bootstrapErr error,
) string {
	return sanitizedServiceProbeDetail(detail, mode, bootstrapErr)
}
