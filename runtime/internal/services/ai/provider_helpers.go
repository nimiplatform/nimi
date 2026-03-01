package ai

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func preferredRoute(modelID string) runtimev1.RoutePolicy {
	lower := strings.ToLower(strings.TrimSpace(modelID))
	if strings.HasPrefix(lower, "cloud/") ||
		strings.HasPrefix(lower, "token/") ||
		strings.HasPrefix(lower, "nimillm/") ||
		strings.HasPrefix(lower, "aliyun/") ||
		strings.HasPrefix(lower, "alibaba/") ||
		strings.HasPrefix(lower, "bytedance/") ||
		strings.HasPrefix(lower, "byte/") ||
		strings.HasPrefix(lower, "gemini/") ||
		strings.HasPrefix(lower, "minimax/") ||
		strings.HasPrefix(lower, "kimi/") ||
		strings.HasPrefix(lower, "moonshot/") ||
		strings.HasPrefix(lower, "glm/") ||
		strings.HasPrefix(lower, "zhipu/") ||
		strings.HasPrefix(lower, "bigmodel/") ||
		strings.HasPrefix(lower, "deepseek/") {
		return runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API
	}
	return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME
}

// Delegate to nimillm exports.
var (
	checkModelAvailabilityWithScope = nimillm.CheckModelAvailabilityWithScope
	fallbackEmbed                   = nimillm.FallbackEmbed
	artifactUsage                   = nimillm.ArtifactUsage
	mapProviderRequestError         = nimillm.MapProviderRequestError
	mapProviderHTTPError            = nimillm.MapProviderHTTPError
)

func normalizeFallbackText(input string) string {
	text := strings.TrimSpace(input)
	if text == "" {
		return "empty input"
	}
	return text
}
