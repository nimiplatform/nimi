package capabilitydriver

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestGroqVisionPlansOwnedMediaAndEnforcesImageCounts(t *testing.T) {
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		model string
		limit int
	}{{"qwen/qwen3.8-27b", 3}, {"meta-models/muse-spark-open", 5}} {
		p, _ := NewGroqTextBehavior(tc.model)
		part := &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL, Content: &runtimev1.ChatContentPart_ImageUrl{ImageUrl: &runtimev1.ChatContentImageURL{Url: "data:image/png;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes())}}}
		s := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user"}}}
		for i := 0; i < tc.limit; i++ {
			s.Input[0].Parts = append(s.Input[0].Parts, part)
		}
		if _, err := p.Serialize(s, false); err != nil {
			t.Fatal(err)
		}
		s.Input[0].Parts = append(s.Input[0].Parts, part)
		if _, err := p.Serialize(s, false); err == nil {
			t.Fatal("excess image count accepted")
		}
		s.Input[0].Parts = []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: "owned-image", MimeType: "image/png"}}}}
		if _, budget, err := p.PlanMaterialization(context.Background(), s, false); err != nil || budget == nil {
			t.Fatal("owned media planning failed", err)
		}
		if _, err := p.Serialize(s, false); err == nil {
			t.Fatal("planning placeholder was accepted as execution input")
		}
		part.GetImageUrl().Url = "https://unowned.example/image.png"
		s.Input[0].Parts = []*runtimev1.ChatContentPart{part}
		if _, err := p.Serialize(s, false); err == nil {
			t.Fatal("unowned image URL accepted")
		}
	}
}

func groqTestJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestGroqNativeControlsAndHiddenToolRoundTrip(t *testing.T) {
	for _, model := range []string{"openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "meta-models/muse-spark-open", "minimaxai/minimax-m2.7"} {
		t.Run(model, func(t *testing.T) {
			p, _ := NewGroqTextBehavior(model)
			s := deepseekToolSpec(t)
			s.MaxTokens = proto.Int32(256)
			wire, err := p.Serialize(s, true)
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]any
			_ = json.Unmarshal(wire.Payload, &body)
			if body["reasoning_format"] != "hidden" || body["include_reasoning"] != nil || body["max_completion_tokens"] != float64(256) || body["max_tokens"] != nil || body["parallel_tool_calls"] != p.ParallelTools() {
				t.Fatal(body)
			}
			wantEffort := "medium"
			switch model {
			case "qwen/qwen3.8-27b":
				wantEffort = "none"
			case "meta-models/muse-spark-open":
				wantEffort = "xhigh"
			case "minimaxai/minimax-m2.7":
				wantEffort = ""
			}
			if wantEffort == "" {
				if body["reasoning_effort"] != nil {
					t.Fatal(body)
				}
			} else if body["reasoning_effort"] != wantEffort {
				t.Fatal(body)
			}
			message := map[string]any{"role": "assistant", "content": "", "reasoning": "PRIVATE NATIVE THOUGHT", "tool_calls": []any{map[string]any{"id": "call-1", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"北京"}`}}}}
			payload := groqTestJSON(t, map[string]any{"model": model, "choices": []any{map[string]any{"index": 0, "message": message, "finish_reason": "tool_calls"}}, "usage": map[string]any{"prompt_tokens": 3, "completion_tokens": 7}})
			result, err := p.Parse(payload, s)
			if err != nil || len(result.Items) != 1 || result.Items[0].Kind != textbehavior.OrderedItemToolCall || result.Usage.GetOutputTokens() != 7 {
				t.Fatalf("hidden tool result %v %v", result, err)
			}
			assistant := &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: result.Items[0].ToolCall}}}}, {Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-1", ToolName: "lookup", Result: structpb.NewNumberValue(19)}}}}}
			s.Input = append(s.Input, assistant)
			wire, err = p.Serialize(s, false)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(wire.Payload), "PRIVATE") || strings.Contains(string(wire.Payload), "reasoning_content") {
				t.Fatal("invented reasoning replay")
			}
			_ = json.Unmarshal(wire.Payload, &body)
			messages := body["messages"].([]any)
			if len(messages) != 3 || messages[2].(map[string]any)["tool_call_id"] != "call-1" {
				t.Fatal(messages)
			}
			if !p.ParallelTools() {
				message["tool_calls"] = append(message["tool_calls"].([]any), map[string]any{"id": "call-2", "type": "function", "function": map[string]any{"name": "lookup", "arguments": `{"city":"上海"}`}})
				bad := groqTestJSON(t, map[string]any{"model": model, "choices": []any{map[string]any{"index": 0, "message": message, "finish_reason": "tool_calls"}}})
				if _, err := p.Parse(bad, s); err == nil {
					t.Fatal("parallel GPT-OSS calls accepted")
				}
			}
			for _, change := range []func(*runtimev1.TextGenerateScenarioSpec){func(v *runtimev1.TextGenerateScenarioSpec) { v.Temperature = proto.Float32(0) }, func(v *runtimev1.TextGenerateScenarioSpec) { v.PresencePenalty = proto.Float32(0) }, func(v *runtimev1.TextGenerateScenarioSpec) {
				v.Reasoning = &runtimev1.ReasoningConfig{Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY}
			}, func(v *runtimev1.TextGenerateScenarioSpec) { v.MaxTokens = proto.Int32(p.maxOutput + 1) }} {
				bad := proto.Clone(s).(*runtimev1.TextGenerateScenarioSpec)
				change(bad)
				if _, err := p.Serialize(bad, false); err == nil {
					t.Fatal("unsupported native controls accepted")
				}
			}
		})
	}
}

func TestGroqStreamUsesNativeUsageAndDoesNotPublishRawReasoning(t *testing.T) {
	p, _ := NewGroqTextBehavior("openai/gpt-oss-120b")
	s := deepseekToolSpec(t)
	s.Tools = nil
	s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED
	for _, nativeError := range []bool{false, true} {
		stream, err := p.Stream(s)
		if err != nil {
			t.Fatal(err)
		}
		if delta, err := stream.Append(groqTestJSON(t, map[string]any{"model": p.model, "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"reasoning": "not a summary"}, "finish_reason": nil}}})); err != nil || len(delta) != 0 {
			t.Fatalf("reasoning leaked: %v %v", delta, err)
		}
		_, err = stream.Append(groqTestJSON(t, map[string]any{"model": p.model, "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": "answer"}, "finish_reason": nil}}}))
		if err != nil {
			t.Fatal(err)
		}
		metadata := map[string]any{"usage": map[string]any{"prompt_tokens": 11, "completion_tokens": 13}}
		if nativeError {
			metadata["error"] = "native stream stopped"
		}
		_, err = stream.Append(groqTestJSON(t, map[string]any{"model": p.model, "choices": []any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": "stop"}}, "x_groq": metadata}))
		if nativeError {
			if err == nil {
				t.Fatal("native error ignored")
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		if _, err = stream.Append([]byte("[DONE]")); err != nil {
			t.Fatal(err)
		}
		result, err := stream.Finish()
		if err != nil || result.Usage.GetInputTokens() != 11 || result.Usage.GetOutputTokens() != 13 || len(result.Items) != 1 || result.Items[0].Text != "answer" {
			t.Fatalf("stream result %v %v", result, err)
		}
	}
	stream, _ := p.Stream(s)
	if _, err := stream.Append([]byte(`{"model":"another-model","choices":[{"index":0,"delta":{"content":"wrong"},"finish_reason":null}]}`)); err == nil {
		t.Fatal("wrong model content exposed")
	}
	for _, model := range []string{"openai/gpt-oss-120b", "qwen/qwen3.8-27b"} {
		p, _ := NewGroqTextBehavior(model)
		_, err := p.Parse(groqTestJSON(t, map[string]any{"model": model, "choices": []any{map[string]any{"index": 0, "message": map[string]any{"role": "assistant", "content": "partial"}, "finish_reason": "length"}}}), s)
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE {
			t.Fatalf("budget exhaustion: %v", err)
		}
	}
}

func TestGroqStrictSchemaIsSyncWithoutToolsAndQwenDefaultThinkingIsNotInvented(t *testing.T) {
	schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"answer": map[string]any{"type": "integer"}}, "required": []any{"answer"}, "additionalProperties": false})
	for _, model := range []string{"openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "meta-models/muse-spark-open"} {
		p, _ := NewGroqTextBehavior(model)
		s := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Return an answer."}}, ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, Strict: true, JsonSchema: schema}}
		if _, err := p.Serialize(s, false); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Serialize(s, true); err == nil {
			t.Fatal("strict schema stream accepted")
		}
		for _, answer := range []string{`{"answer":19}`, `{"answer":"wrong"}`} {
			payload := groqTestJSON(t, map[string]any{"model": model, "choices": []any{map[string]any{"index": 0, "message": map[string]any{"role": "assistant", "content": answer}, "finish_reason": "stop"}}})
			_, err := p.Parse(payload, s)
			if (err == nil) != (answer == `{"answer":19}`) {
				t.Fatalf("schema enforcement %s: %v", answer, err)
			}
		}
		s.Tools = deepseekToolSpec(t).Tools
		if _, err := p.Serialize(s, false); err == nil {
			t.Fatal("strict schema tool combination accepted")
		}
	}
	p, _ := NewGroqTextBehavior("qwen/qwen3.8-27b")
	s := deepseekToolSpec(t)
	s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}}
	if _, err := p.Serialize(s, false); err == nil {
		t.Fatal("required thinking silently became default-none")
	}
	s.Reasoning.Intensity = &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH}
	if _, err := p.Serialize(s, false); err != nil {
		t.Fatal(err)
	}
}
