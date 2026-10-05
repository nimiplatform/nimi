package capabilitydriver

import (
	"encoding/json"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"testing"
)

func TestCloudBehaviorUsagePreservesPresence(t *testing.T) {
	for _, test := range []struct {
		name, report string
		want         *runtimev1.UsageStats
	}{
		{name: "absent", report: "null"},
		{name: "empty", report: "{}"},
		{name: "input_only", report: "{\"input\":3}"},
		{name: "output_only", report: "{\"output\":2}"},
		{name: "zero", report: "{\"input\":0,\"output\":0}", want: &runtimev1.UsageStats{}},
		{name: "reported", report: "{\"input\":3,\"output\":2}", want: &runtimev1.UsageStats{InputTokens: 3, OutputTokens: 2}},
	} {
		for _, group := range []string{"anthropic", "deepseek"} {
			t.Run(test.name+"/"+group, func(t *testing.T) {
				var report map[string]any
				if err := json.Unmarshal([]byte(test.report), &report); err != nil {
					t.Fatal(err)
				}
				var wire map[string]any
				var result textbehavior.NormalizedResult
				var err error
				spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Hello"}}}
				mapped := map[string]any{}
				if group == "anthropic" {
					if v, ok := report["input"]; ok {
						mapped["input_tokens"] = v
					}
					if v, ok := report["output"]; ok {
						mapped["output_tokens"] = v
					}
					if _, complete := report["output"]; complete {
						mapped["cache_creation_input_tokens"], mapped["cache_read_input_tokens"] = 0, 0
					}
					wire = map[string]any{"content": []any{map[string]any{"type": "text", "text": "Provider text"}}, "stop_reason": "end_turn", "usage": mapped}
				} else {
					spec.Input = append(spec.Input, &runtimev1.ChatMessage{Role: "system", Content: "Preserve this later instruction."})
					if v, ok := report["input"]; ok {
						mapped["prompt_tokens"] = v
					}
					if v, ok := report["output"]; ok {
						mapped["completion_tokens"] = v
					}
					wire = map[string]any{"choices": []any{map[string]any{"index": 0, "message": map[string]any{"content": "Provider text"}, "finish_reason": "stop"}}, "usage": mapped}
				}
				if report == nil {
					delete(wire, "usage")
				}
				payload, _ := json.Marshal(wire)
				if group == "anthropic" {
					result, err = AnthropicTextBehaviorNonStreamParser(payload, spec)
				} else {
					result, err = DeepseekChatNonStreamParser(payload, spec)
				}
				if err != nil || len(result.Items) != 1 || result.Items[0].Text != "Provider text" {
					t.Fatalf("result=%+v err=%v", result, err)
				}
				if (result.Usage == nil) != (test.want == nil) || result.Usage.GetInputTokens() != test.want.GetInputTokens() || result.Usage.GetOutputTokens() != test.want.GetOutputTokens() || result.Usage.GetCachedInputTokens() != test.want.GetCachedInputTokens() {
					t.Fatalf("usage=%v want=%v", result.Usage, test.want)
				}
			})
		}
	}
}

func TestAnthropicStreamUsageRequiresFinalOutputReport(t *testing.T) {
	for _, test := range []struct {
		name, tail string
		want       *runtimev1.UsageStats
	}{
		{name: "missing_final", tail: ""},
		{name: "zero_final", tail: ",\"usage\":{\"output_tokens\":0}", want: &runtimev1.UsageStats{InputTokens: 6}},
		{name: "reported_final", tail: ",\"usage\":{\"output_tokens\":2}", want: &runtimev1.UsageStats{InputTokens: 6, OutputTokens: 2}},
		{name: "input_and_cache_updated", tail: ",\"usage\":{\"input_tokens\":4,\"cache_creation_input_tokens\":5,\"cache_read_input_tokens\":7,\"output_tokens\":2}", want: &runtimev1.UsageStats{InputTokens: 16, OutputTokens: 2, CachedInputTokens: 7}},
	} {
		t.Run(test.name, func(t *testing.T) {
			stream, err := AnthropicTextBehaviorStreamAssembler(&runtimev1.TextGenerateScenarioSpec{})
			if err != nil {
				t.Fatal(err)
			}
			events := []string{
				"{\"type\":\"message_start\",\"message\":{\"content\":[],\"usage\":{\"input_tokens\":6,\"output_tokens\":0,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":0}}}",
				"{\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"Provider text\"}}",
				"{\"type\":\"content_block_stop\",\"index\":0}",
				"{\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}" + test.tail + "}",
				"{\"type\":\"message_stop\"}",
			}
			for _, event := range events {
				if _, err := stream.Append([]byte(event)); err != nil {
					t.Fatalf("event=%s err=%v", event, err)
				}
			}
			result, err := stream.Finish()
			if err != nil || len(result.Items) != 1 || result.Items[0].Text != "Provider text" {
				t.Fatalf("result=%+v err=%v", result, err)
			}
			if (result.Usage == nil) != (test.want == nil) || result.Usage.GetInputTokens() != test.want.GetInputTokens() || result.Usage.GetOutputTokens() != test.want.GetOutputTokens() || result.Usage.GetCachedInputTokens() != test.want.GetCachedInputTokens() {
				t.Fatalf("usage=%v want=%v", result.Usage, test.want)
			}
		})
	}
}
