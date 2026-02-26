package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"strings"
)

func preferredRoute(modelID string) runtimev1.RoutePolicy {
	lower := strings.ToLower(strings.TrimSpace(modelID))
	if strings.HasPrefix(lower, "cloud/") ||
		strings.HasPrefix(lower, "token/") ||
		strings.HasPrefix(lower, "litellm/") ||
		strings.HasPrefix(lower, "aliyun/") ||
		strings.HasPrefix(lower, "alibaba/") ||
		strings.HasPrefix(lower, "bytedance/") ||
		strings.HasPrefix(lower, "byte/") ||
		strings.HasPrefix(lower, "gemini/") ||
		strings.HasPrefix(lower, "minimax/") {
		return runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API
	}
	return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME
}

func checkModelAvailabilityWithScope(modelID string, route runtimev1.RoutePolicy) error {
	lower := strings.ToLower(modelID)
	switch {
	case strings.Contains(lower, "missing"), strings.Contains(lower, "not-found"):
		return status.Error(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND.String())
	case strings.Contains(lower, "not-ready"), strings.Contains(lower, "warming"):
		return status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODEL_NOT_READY.String())
	case strings.Contains(lower, "provider-down"), strings.Contains(lower, "provider-unavailable"), strings.Contains(lower, "unavailable"):
		return status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	case strings.Contains(lower, "provider-timeout"), strings.Contains(lower, "timeout"):
		return status.Error(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String())
	case strings.Contains(lower, "content-filter"), strings.Contains(lower, "blocked"):
		return status.Error(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED.String())
	}

	if route == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME && strings.Contains(lower, "cloud-only") {
		return status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
	if route == runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API && strings.Contains(lower, "local-only") {
		return status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
	return nil
}

func normalizeFallbackText(input string) string {
	text := strings.TrimSpace(input)
	if text == "" {
		return "empty input"
	}
	return text
}

func fallbackEmbed(inputs []string) []*structpb.ListValue {
	vectors := make([]*structpb.ListValue, 0, len(inputs))
	for _, input := range inputs {
		trimmed := strings.TrimSpace(input)
		vector := &structpb.ListValue{
			Values: []*structpb.Value{
				structpb.NewNumberValue(float64(len(trimmed))),
				structpb.NewNumberValue(float64(wordCount(trimmed))),
				structpb.NewNumberValue(float64(vowelCount(trimmed))),
				structpb.NewNumberValue(float64(consonantCount(trimmed))),
			},
		}
		vectors = append(vectors, vector)
	}
	return vectors
}

func artifactUsage(inputText string, artifactBytes []byte, computeMs int64) *runtimev1.UsageStats {
	return &runtimev1.UsageStats{
		InputTokens:  estimateTokens(strings.TrimSpace(inputText)),
		OutputTokens: estimateTokens(string(artifactBytes)),
		ComputeMs:    computeMs,
	}
}
