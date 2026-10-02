package nimillm

import (
	"encoding/json"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// Keep the same reported prompt/total semantics as Gemini text. Output tokens
// include reported reasoning, which also has its own typed counter. Container
// size and elapsed-time constants are never substitutes for provider usage.
func geminiMediaUsage(response map[string]any) (*runtimev1.UsageStats, error) {
	raw := response["usageMetadata"]
	if raw == nil {
		return nil, nil
	}
	var usage struct {
		Prompt    *int64 `json:"promptTokenCount"`
		Total     *int64 `json:"totalTokenCount"`
		Cached    int64  `json:"cachedContentTokenCount"`
		Reasoning int64  `json:"thoughtsTokenCount"`
	}
	encoded, err := json.Marshal(raw)
	if err != nil || json.Unmarshal(encoded, &usage) != nil || usage.Cached < 0 || usage.Reasoning < 0 ||
		(usage.Prompt != nil && *usage.Prompt < 0) || (usage.Total != nil && *usage.Total < 0) {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if usage.Prompt == nil || usage.Total == nil {
		return nil, nil
	}
	if *usage.Total < *usage.Prompt || usage.Cached > *usage.Prompt || usage.Reasoning > *usage.Total-*usage.Prompt {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return &runtimev1.UsageStats{InputTokens: *usage.Prompt, OutputTokens: *usage.Total - *usage.Prompt,
		CachedInputTokens: usage.Cached, ReasoningOutputTokens: usage.Reasoning}, nil
}
