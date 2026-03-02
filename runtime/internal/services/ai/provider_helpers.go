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
		strings.HasPrefix(lower, "dashscope/") ||
		strings.HasPrefix(lower, "volcengine/") ||
		strings.HasPrefix(lower, "volcengine_openspeech/") ||
		strings.HasPrefix(lower, "gemini/") ||
		strings.HasPrefix(lower, "minimax/") ||
		strings.HasPrefix(lower, "kimi/") ||
		strings.HasPrefix(lower, "glm/") ||
		strings.HasPrefix(lower, "deepseek/") ||
		strings.HasPrefix(lower, "openrouter/") ||
		strings.HasPrefix(lower, "openai/") ||
		strings.HasPrefix(lower, "anthropic/") ||
		strings.HasPrefix(lower, "openai_compatible/") {
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
