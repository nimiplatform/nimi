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
		strings.HasPrefix(lower, "azure/") ||
		strings.HasPrefix(lower, "mistral/") ||
		strings.HasPrefix(lower, "groq/") ||
		strings.HasPrefix(lower, "xai/") ||
		strings.HasPrefix(lower, "qianfan/") ||
		strings.HasPrefix(lower, "hunyuan/") ||
		strings.HasPrefix(lower, "spark/") ||
		strings.HasPrefix(lower, "openai_compatible/") {
		return runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD
	}
	return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
}

// Delegate to nimillm exports.
var (
	artifactUsage           = nimillm.ArtifactUsage
	mapProviderRequestError = nimillm.MapProviderRequestError
	mapProviderHTTPError    = nimillm.MapProviderHTTPError
)
