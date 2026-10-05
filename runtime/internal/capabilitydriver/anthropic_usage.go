package capabilitydriver

import (
	"math"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// AnthropicReportedUsage contains only counters actually provided by Messages.
// A delta is cumulative; an omitted counter leaves the earlier report intact.
type AnthropicReportedUsage struct {
	Input         *int64 `json:"input_tokens"`
	Output        *int64 `json:"output_tokens"`
	CacheCreation *int64 `json:"cache_creation_input_tokens"`
	CacheRead     *int64 `json:"cache_read_input_tokens"`
}

func (usage AnthropicReportedUsage) WithUpdate(update AnthropicReportedUsage) AnthropicReportedUsage {
	if update.Input != nil {
		usage.Input = update.Input
	}
	if update.Output != nil {
		usage.Output = update.Output
	}
	if update.CacheCreation != nil {
		usage.CacheCreation = update.CacheCreation
	}
	if update.CacheRead != nil {
		usage.CacheRead = update.CacheRead
	}
	return usage
}

// @nimi-authority: rule.nimi.runtime.ai-provider.anthropic-messages-text-behaviors
func (usage AnthropicReportedUsage) Stats() *runtimev1.UsageStats {
	// input_tokens excludes both cache categories. Without their reports, the
	// total input is unknown and cannot be projected as an observed zero.
	if usage.Input == nil || usage.Output == nil || usage.CacheCreation == nil || usage.CacheRead == nil ||
		*usage.Input < 0 || *usage.Output < 0 || *usage.CacheCreation < 0 || *usage.CacheRead < 0 {
		return nil
	}
	input := *usage.Input
	if *usage.CacheCreation > math.MaxInt64-input {
		return nil
	}
	input += *usage.CacheCreation
	if *usage.CacheRead > math.MaxInt64-input {
		return nil
	}
	input += *usage.CacheRead
	return &runtimev1.UsageStats{InputTokens: input, OutputTokens: *usage.Output, CachedInputTokens: *usage.CacheRead}
}
