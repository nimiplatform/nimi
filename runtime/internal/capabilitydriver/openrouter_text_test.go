package capabilitydriver

import (
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
)

func TestOpenRouterPreservesSignedPlaintextAndCiphertextWithoutExposingHiddenThought(t *testing.T) {
	for _, model := range OpenRouterTextModels() {
		t.Run(model, func(t *testing.T) {
			p, _ := NewOpenRouterTextBehavior(model)
			spec := perplexitySpec(t)
			if model == "x-ai/grok-4.7" {
				spec.MaxTokens = nil
			}
			wire, err := p.Serialize(spec, false)
			if err != nil {
				t.Fatal(err)
			}
			var b map[string]any
			_ = json.Unmarshal(wire.Payload, &b)
			if b["store"] != false || b["stream"] != true || b["previous_response_id"] != nil || b["provider"].(map[string]any)["require_parameters"] != true || b["provider"].(map[string]any)["allow_fallbacks"] != false {
				t.Fatal(b)
			}
			stream, _ := p.Stream(spec)
			appendEvent := func(e any) {
				data, _ := json.Marshal(e)
				d, err := stream.Append(data)
				if err != nil {
					t.Fatal(err)
				}
				for _, item := range d {
					if item.Kind == textbehavior.OrderedItemReasoningSummary || strings.Contains(item.Text, "PRIVATE") {
						t.Fatal("raw reasoning leaked")
					}
				}
			}
			native := map[string]any{"type": "reasoning", "id": "r1", "status": "completed", "format": "anthropic-claude-v1", "signature": "opaque-signature", "content": []any{map[string]any{"type": "reasoning_text", "text": " PRIVATE 原文\r\n😀 "}}, "summary": []any{map[string]any{"type": "summary_text", "text": "native summary"}}}
			call := map[string]any{"type": "function_call", "id": "item-call", "call_id": "call-1", "name": "lookup", "arguments": `{"city":"北京"}`, "status": "completed"}
			appendEvent(map[string]any{"type": "response.created", "response": map[string]any{"model": model, "status": "in_progress"}})
			for i, item := range []map[string]any{native, call} {
				appendEvent(map[string]any{"type": "response.output_item.added", "output_index": i, "item": map[string]any{"type": item["type"], "id": item["id"], "name": item["name"], "call_id": item["call_id"]}})
				appendEvent(map[string]any{"type": "response.output_item.done", "output_index": i, "item": item})
			}
			appendEvent(map[string]any{"type": "response.completed", "response": map[string]any{"model": model, "status": "completed", "output": []any{native, call}, "usage": map[string]any{"input_tokens": 3, "output_tokens": 7}}})
			r, err := stream.Finish()
			if err != nil || len(r.Items) != 2 || r.Items[0].ReasoningContinuity == nil || r.Items[1].ToolCall.Id != "call-1" {
				t.Fatal(r, err)
			}
			raw, _ := json.Marshal(native)
			if string(r.Items[0].ReasoningContinuity.Payload) != string(raw) {
				t.Fatal("native replay bytes changed")
			}
			items := []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: r.Items[0].ReasoningContinuity}}}}, {Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: r.Items[1].ToolCall}}}}}
			spec.Input = append(spec.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: items})
			wire, err = p.Serialize(spec, false)
			if err != nil || !strings.Contains(string(wire.Payload), `"signature":"opaque-signature"`) || !strings.Contains(string(wire.Payload), `PRIVATE 原文`) {
				t.Fatal(string(wire.Payload), err)
			}
			r.Items[0].ReasoningContinuity.Kind = "openai.responses.encrypted-reasoning"
			if _, err = p.Serialize(spec, false); err == nil {
				t.Fatal("foreign carrier accepted")
			}
		})
	}
}

func TestOpenRouterRejectsUnsupportedOrCorruptNativeResults(t *testing.T) {
	p, _ := NewOpenRouterTextBehavior("openai/gpt-6.1-terra")
	s := perplexitySpec(t)
	for _, bad := range []string{`{"type":"reasoning","id":"r","summary":[],"encrypted_content":"[REDACTED]"}`, `{"type":"reasoning","id":"r","summary":[],"format":"invented"}`, `{"type":"reasoning","id":"r","summary":[],"content":[{"type":"output_text","text":"secret"}]}`} {
		if _, err := p.carrier([]byte(bad)); err == nil {
			t.Fatal("bad carrier accepted")
		}
	}
	stream, _ := p.Stream(s)
	_, err := stream.Append([]byte(`{"type":"response.created","response":{"model":"wrong","status":"in_progress"}}`))
	if err == nil {
		t.Fatal("wrong model accepted")
	}
	stream, _ = p.Stream(s)
	_, err = stream.Append([]byte(`{"type":"error","code":429}`))
	if err == nil {
		t.Fatal("error became success")
	}
	xai, _ := NewOpenRouterTextBehavior("x-ai/grok-4.7")
	if _, err := xai.Serialize(s, false); err == nil {
		t.Fatal("visible-only cap presented as total output cap")
	}
	s.MaxTokens = nil
	s.Temperature = proto.Float32(.5)
	if _, err := p.Serialize(s, false); err == nil {
		t.Fatal("unreviewed sampling accepted")
	}
}
