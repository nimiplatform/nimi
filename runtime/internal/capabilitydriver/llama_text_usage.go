package capabilitydriver

import (
	"encoding/json"
	"math"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// LlamaTextTokenUsage projects reported aggregate counters from a llama
// response decoded with json.Decoder.UseNumber.
// @nimi-authority: rule.nimi.runtime.ai-provider.local-app-text-behaviors
func LlamaTextTokenUsage(value any) *runtimev1.UsageStats {
	usage, _ := value.(map[string]any)
	input, hasInput := llamaTokenCount(usage["prompt_tokens"])
	if !hasInput {
		return nil
	}
	rawOutput, hasOutput := usage["completion_tokens"]
	if hasOutput {
		output, valid := llamaTokenCount(rawOutput)
		if !valid {
			return nil
		}
		return &runtimev1.UsageStats{InputTokens: input, OutputTokens: output}
	}
	total, hasTotal := llamaTokenCount(usage["total_tokens"])
	if !hasTotal || total < input {
		return nil
	}
	return &runtimev1.UsageStats{InputTokens: input, OutputTokens: total - input}
}

func llamaTokenCount(value any) (int64, bool) {
	number, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	count, err := number.Int64()
	return count, err == nil && count >= 0
}

// LlamaTextComputeMS reads engine timings independently of token counters.
// The engine may report either explicit compute_ms or separate prompt and
// prediction durations.
func LlamaTextComputeMS(root map[string]any) int64 {
	usage, _ := root["usage"].(map[string]any)
	if compute := llamaDurationMS(usage["compute_ms"]); compute > 0 {
		return compute
	}
	timings, _ := root["timings"].(map[string]any)
	prompt := llamaDurationMS(timings["prompt_ms"])
	prediction := llamaDurationMS(timings["predicted_ms"])
	if prediction > math.MaxInt64-prompt {
		return 0
	}
	return prompt + prediction
}

func llamaDurationMS(value any) int64 {
	number, ok := value.(json.Number)
	if !ok {
		return 0
	}
	if ms, err := number.Float64(); err == nil && ms > 0 && ms < float64(math.MaxInt64) {
		return int64(ms)
	}
	return 0
}
