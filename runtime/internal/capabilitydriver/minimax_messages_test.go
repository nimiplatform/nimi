package capabilitydriver

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
)

func miniMaxSpec(t *testing.T) *runtimev1.TextGenerateScenarioSpec {
	t.Helper()
	s := deepseekToolSpec(t)
	s.Temperature = nil
	return s
}
func miniMaxProfile(t *testing.T, model string) MiniMaxMessagesBehavior {
	t.Helper()
	p, err := NewMiniMaxMessagesBehavior(model)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestMiniMaxMessagesControlsHaveExactNativeMeaning(t *testing.T) {
	for _, model := range []string{"MiniMax-M3.1-Flash", "MiniMax-M3"} {
		p := miniMaxProfile(t, model)
		spec := miniMaxSpec(t)
		wire, err := p.Serialize(spec, false)
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]any
		_ = json.Unmarshal(wire.Payload, &body)
		if body["thinking"] != nil || body["output_config"] != nil || body["model"] != model || wire.Protocol != MiniMaxMessagesProtocol {
			t.Fatal("native default changed")
		}
		spec.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT}}
		wire, err = p.Serialize(spec, true)
		if err != nil {
			t.Fatal(err)
		}
		_ = json.Unmarshal(wire.Payload, &body)
		if body["thinking"].(map[string]any)["type"] != "adaptive" || body["output_config"] != nil {
			t.Fatal("native default intensity invented an effort")
		}
		for effort, native := range map[runtimev1.ReasoningEffort]string{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW: "low", runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM: "medium", runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH: "high", runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH: "xhigh", runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM: "max"} {
			copy := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
			copy.Reasoning.Intensity = &runtimev1.ReasoningConfig_Effort{Effort: effort}
			wire, err = p.Serialize(copy, true)
			if model == "MiniMax-M3" {
				if err == nil {
					t.Fatal("M3 ignored effort accepted")
				}
				continue
			}
			if err != nil {
				t.Fatal(err)
			}
			_ = json.Unmarshal(wire.Payload, &body)
			if body["output_config"].(map[string]any)["effort"] != native {
				t.Fatal("effort lost")
			}
		}
		for _, change := range []func(*runtimev1.TextGenerateScenarioSpec){func(s *runtimev1.TextGenerateScenarioSpec) { s.Temperature = proto.Float32(1) }, func(s *runtimev1.TextGenerateScenarioSpec) { s.TopP = proto.Float32(.95) }, func(s *runtimev1.TextGenerateScenarioSpec) { s.Stop = []string{"stop"} }, func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED
		}, func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning.Activation = runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED
		}, func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning.Presentation = runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY
		}, func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
		}} {
			bad := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
			change(bad)
			if _, err = p.Serialize(bad, false); err == nil {
				t.Fatal("unsupported control admitted")
			}
		}
		spec.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
		_, err = p.Serialize(spec, false)
		if (err == nil) != (model == "MiniMax-M3") {
			t.Fatal("thinking-off mapping changed")
		}
	}
}

func TestMiniMaxNativeBlocksReplayWithOriginalSignaturesAndOrder(t *testing.T) {
	p := miniMaxProfile(t, "MiniMax-M3.1-Flash")
	spec := miniMaxSpec(t)
	response := []byte(`{"type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[{"type":"thinking","thinking":"  原文\r\n😀 ","signature":"original-signature"},{"type":"text","text":"Checking."},{"type":"tool_use","id":"original-id","name":"lookup","input":{"city":"北京"}}],"stop_reason":"tool_use","usage":{"input_tokens":7,"output_tokens":11,"cache_read_input_tokens":3,"cache_creation_input_tokens":2}}`)
	r, err := p.Parse(response, spec)
	if err != nil || len(r.Items) != 3 || r.Items[0].Kind != textbehavior.OrderedItemReasoningContinuity || r.Usage.InputTokens != 12 {
		t.Fatalf("parsed=%v %v", r, err)
	}
	carrier := r.Items[0].ReasoningContinuity
	if !strings.Contains(string(carrier.Payload), `"signature":"original-signature"`) || strings.Contains(r.Items[1].Text, "原文") {
		t.Fatal("thinking altered or displayed")
	}
	spec.Input = append(spec.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: carrier}}}},
		{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: r.Items[2].ToolCall}}}},
	}})
	wire, err := p.Serialize(spec, false)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(wire.Payload, &body)
	thought := body["messages"].([]any)[1].(map[string]any)["content"].([]any)[0].(map[string]any)
	if thought["thinking"] != "  原文\r\n😀 " || thought["signature"] != "original-signature" {
		t.Fatal("native replay changed")
	}
	other := miniMaxProfile(t, "MiniMax-M3")
	if _, err := other.Serialize(spec, false); err == nil {
		t.Fatal("cross-model replay accepted")
	}
	for _, raw := range []string{`{"type":"thinking","thinking":"","signature":""}`, `{"type":"thinking","thinking":""}`, `{"type":"thinking","signature":"native-only-signature"}`, `{"type":"thinking"}`} {
		c, err := p.thinkingCarrier([]byte(raw))
		if err != nil || string(c.Payload) != raw {
			t.Fatal("native empty fields or absent signature changed")
		}
	}
	for _, raw := range []string{`{"type":"thinking","thinking":null}`, `{"type":"thinking","signature":null}`, `{"type":"thinking","thinking":"x","route":"untrusted"}`} {
		if _, err := p.thinkingCarrier([]byte(raw)); err == nil {
			t.Fatal("invalid native block field admitted")
		}
	}
	if _, err := p.thinkingCarrier([]byte(`{"type":"thinking","thinking":"` + strings.Repeat("a", 65536) + `"}`)); err == nil {
		t.Fatal("oversized thinking admitted")
	}
}

func TestMiniMaxOwnedMediaPlanningAndNativeBounds(t *testing.T) {
	p := miniMaxProfile(t, "MiniMax-M3.1-Flash")
	image := deepseekVisionImage(t, 2)
	spec := deepseekVisionSpec(image)
	video := base64.StdEncoding.EncodeToString([]byte("\x00\x00\x00\x18ftypisom00000000"))
	spec.Input[0].Parts = append(spec.Input[0].Parts, &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL, Content: &runtimev1.ChatContentPart_VideoUrl{VideoUrl: "data:video/mp4;base64," + video}})
	wire, err := p.Serialize(spec, false)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	_ = json.Unmarshal(wire.Payload, &body)
	parts := body["messages"].([]any)[0].(map[string]any)["content"].([]any)
	if len(parts) != 3 || parts[1].(map[string]any)["source"].(map[string]any)["data"] != strings.SplitN(image, ",", 2)[1] || parts[2].(map[string]any)["source"].(map[string]any)["data"] != video {
		t.Fatal("native media order or bytes changed")
	}
	owned := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Parts: []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: "owned", MimeType: "video/mp4"}}}}}}}
	captured, budget, err := p.PlanMaterialization(context.Background(), owned, false)
	if err != nil || captured == owned || budget == nil {
		t.Fatal("owned planning failed")
	}
	if err := budget.Reserve(50_000_000); err == nil {
		t.Fatal("video bytes ignored native base64/body budget")
	}
	bad := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
	bad.Input[0].Parts[2].Content = &runtimev1.ChatContentPart_VideoUrl{VideoUrl: "mm_file://foreign-file"}
	if _, err := p.Serialize(bad, false); err == nil {
		t.Fatal("provider file accepted")
	}
}

func TestMiniMaxMessagesStreamingSealsNativeThinkingBeforeToolCalls(t *testing.T) {
	p := miniMaxProfile(t, "MiniMax-M3.1-Flash")
	spec := miniMaxSpec(t)
	s, _ := p.Stream(spec)
	steps := []string{
		`{"type":"message_start","message":{"type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"usage":{"input_tokens":2,"cache_creation_input_tokens":0,"cache_read_input_tokens":1}}}`,
		`{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}`,
		`{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" keep\n原文 "}}`,
		`{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-part"}}`,
		`{"type":"content_block_stop","index":0}`,
		`{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call-1","name":"lookup","input":{}}}`,
		`{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"city\":"}}`,
		`{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"London\"}"}}`,
		`{"type":"content_block_stop","index":1}`,
		`{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}`,
	}
	var emitted []textbehavior.OrderedDelta
	for i, step := range steps {
		ds, err := s.Append([]byte(step))
		if err != nil {
			t.Fatalf("step%d: %v", i, err)
		}
		for _, d := range ds {
			if d.HasPublicPayload() {
				if i < 4 {
					t.Fatal("unsealed thinking exposed")
				}
				if d.Kind == textbehavior.OrderedItemText || d.Kind == textbehavior.OrderedItemReasoningSummary {
					t.Fatal("thinking text became visible")
				}
				emitted = append(emitted, d)
			}
		}
	}
	if _, err := s.Finish(); err == nil {
		t.Fatal("missing message_stop accepted")
	}
	if _, err := s.Append([]byte(`{"type":"message_stop"}`)); err != nil {
		t.Fatal(err)
	}
	r, err := s.Finish()
	if err != nil || len(r.Items) != 2 || len(emitted) != 2 || r.Items[1].ToolCall.GetArgumentsJson() != `{"city":"London"}` || r.Usage.InputTokens != 3 || r.Usage.OutputTokens != 5 {
		t.Fatalf("result=%v err=%v", r, err)
	}
	var thought map[string]any
	_ = json.Unmarshal(r.Items[0].ReasoningContinuity.Payload, &thought)
	if thought["thinking"] != " keep\n原文 " || thought["signature"] != "sig-part" {
		t.Fatal("streamed native block changed")
	}
	if _, err := s.Append([]byte(`{"type":"ping"}`)); err == nil {
		t.Fatal("post-terminal event admitted")
	}
}
