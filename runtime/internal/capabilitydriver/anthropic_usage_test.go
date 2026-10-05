package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestAnthropicNativeUsageIncludesReportedCache(t *testing.T) {
	for _, test := range []struct {
		name, report string
		want         *runtimev1.UsageStats
	}{
		{name: "unknown_cache", report: `{"input_tokens":7,"output_tokens":3}`},
		{name: "partial_cache", report: `{"input_tokens":7,"output_tokens":3,"cache_read_input_tokens":100}`},
		{name: "zero", report: `{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}`, want: &runtimev1.UsageStats{}},
		{name: "reported_cache", report: `{"input_tokens":7,"output_tokens":3,"cache_creation_input_tokens":11,"cache_read_input_tokens":100}`, want: &runtimev1.UsageStats{InputTokens: 118, OutputTokens: 3, CachedInputTokens: 100}},
		{name: "negative_cache", report: `{"input_tokens":7,"output_tokens":3,"cache_creation_input_tokens":-1,"cache_read_input_tokens":100}`},
		{name: "overflow", report: `{"input_tokens":9223372036854775807,"output_tokens":3,"cache_creation_input_tokens":0,"cache_read_input_tokens":1}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			payload := []byte(`{"content":[{"type":"text","text":"Provider text"}],"stop_reason":"end_turn","usage":` + test.report + `}`)
			result, err := AnthropicTextBehaviorNonStreamParser(payload, &runtimev1.TextGenerateScenarioSpec{})
			if err != nil || len(result.Items) != 1 || result.Items[0].Text != "Provider text" {
				t.Fatalf("result=%+v err=%v", result, err)
			}
			if (result.Usage == nil) != (test.want == nil) || result.Usage.GetInputTokens() != test.want.GetInputTokens() ||
				result.Usage.GetOutputTokens() != test.want.GetOutputTokens() || result.Usage.GetCachedInputTokens() != test.want.GetCachedInputTokens() {
				t.Fatalf("usage=%v want=%v", result.Usage, test.want)
			}
		})
	}
}
