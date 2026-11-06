package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
)

func TestAzureResponsesChecksModelIdentityAndPreservesNativeControls(t *testing.T) {
	for _, model := range []string{"gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"} {
		t.Run(model, func(t *testing.T) {
			p, _ := NewAzureResponsesTextBehavior(model)
			spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Return JSON."}}, Temperature: proto.Float32(.4), TopP: proto.Float32(.9), MaxTokens: proto.Int32(128000), ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}}
			wire, err := p.Serialize(spec, false)
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]any
			_ = json.Unmarshal(wire.Payload, &body)
			if body["store"] != false || body["stream"] != true || body["temperature"] == nil || body["top_p"] == nil || body["max_output_tokens"] != float64(128000) || body["text"].(map[string]any)["format"].(map[string]any)["type"] != "json_object" {
				t.Fatal("Azure native fields changed")
			}
			if _, err := OpenAIResponsesTextBehaviorRequestSerializer(model, spec, false); err == nil {
				t.Fatal("Azure sampling leaked into another route")
			}
			bad := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
			bad.MaxTokens = proto.Int32(128001)
			if _, err := p.Serialize(bad, false); err == nil {
				t.Fatal("output bound ignored")
			}
			for _, claimed := range []string{model, model + "-" + p.version, "different-model", ""} {
				a, _ := p.Stream(spec)
				created, _ := json.Marshal(map[string]any{"type": "response.created", "response": map[string]any{"model": claimed}})
				_, err := a.Append(created)
				if claimed == "" || claimed == "different-model" {
					if err == nil {
						t.Fatal("unverified deployment model admitted")
					}
					continue
				}
				if err != nil {
					t.Fatal(err)
				}
				item := map[string]any{"type": "message", "id": "msg", "content": []any{map[string]any{"type": "output_text", "text": `{"answer":43}`}}}
				for _, e := range []map[string]any{{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"type": "message", "id": "msg"}}, {"type": "response.output_item.done", "output_index": 0, "item": item}, {"type": "response.completed", "response": map[string]any{"model": claimed, "status": "completed", "output": []any{item}}}} {
					b, _ := json.Marshal(e)
					if _, err := a.Append(b); err != nil {
						t.Fatal(err)
					}
				}
				r, err := a.Finish()
				if err != nil || len(r.Items) != 1 || r.Items[0].Text != `{"answer":43}` {
					t.Fatal(r, err)
				}
			}
		})
	}
}

func TestAzureResponsesOpaqueReplayCannotCrossProviderOrModel(t *testing.T) {
	p, _ := NewAzureResponsesTextBehavior("gpt-6.1-sol")
	payload := []byte(`{"type":"reasoning","id":"rs_original","encrypted_content":"native-opaque","summary":[]}`)
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Continue."}, {Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: &runtimev1.ReasoningContinuityCarrier{Kind: p.ContinuityKind(), Version: 1, Payload: payload}}}}}}}}}
	if _, err := p.Serialize(spec, true); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{OpenAIResponsesContinuityKind, "azure.responses.encrypted-reasoning.gpt-6-luna"} {
		bad := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
		bad.Input[1].TurnItems[0].GetOutput().GetReasoningContinuity().Kind = kind
		_, err := p.Serialize(bad, true)
		reason, _ := grpcerr.ExtractReasonCode(err)
		if reason != runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID {
			t.Fatal(err)
		}
	}
	bad := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
	bad.Input[1].TurnItems[0].GetOutput().GetReasoningContinuity().Payload = []byte(`{}`)
	_, err := p.Serialize(bad, false)
	reason, _ := grpcerr.ExtractReasonCode(err)
	if reason != runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID {
		t.Fatal(err)
	}
}
