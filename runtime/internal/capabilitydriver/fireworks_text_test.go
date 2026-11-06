package capabilitydriver

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestFireworksExactReasoningAndJSONControls(t *testing.T) {
	p, _ := NewFireworksTextBehavior("accounts/fireworks/models/deepseek-v4p1-flash-1017")
	base := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "  Return JSON.\r\n"}}, MaxTokens: proto.Int32(4096)}
	for _, tc := range []struct {
		budget uint32
		valid  bool
	}{{100, false}, {101, false}, {1023, false}, {1024, true}, {4096, true}} {
		s := proto.Clone(base).(*runtimev1.TextGenerateScenarioSpec)
		s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_ExactBudgetTokens{ExactBudgetTokens: tc.budget}}
		wire, err := p.Serialize(s, true)
		if (err == nil) != tc.valid {
			t.Fatal(tc, err)
		}
		if err == nil {
			var b map[string]any
			_ = json.Unmarshal(wire.Payload, &b)
			if b["reasoning_effort"] != float64(tc.budget) || b["context_length_exceeded_behavior"] != "error" || b["stream_options"].(map[string]any)["include_usage"] != true {
				t.Fatal(b)
			}
		}
	}
	for _, effort := range []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM, runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH} {
		s := proto.Clone(base).(*runtimev1.TextGenerateScenarioSpec)
		s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: effort}}
		if _, err := p.Serialize(s, false); err == nil {
			t.Fatal("promoted tier accepted", effort)
		}
	}
	for _, model := range FireworksTextModels() {
		p, _ := NewFireworksTextBehavior(model)
		wire, err := p.Serialize(base, false)
		if err != nil {
			t.Fatal(model, err)
		}
		var b map[string]any
		_ = json.Unmarshal(wire.Payload, &b)
		if b["reasoning_effort"] != nil || b["messages"].([]any)[0].(map[string]any)["content"] != "  Return JSON.\r\n" {
			t.Fatal("default or whitespace changed", b)
		}
	}
	schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"text": map[string]any{"type": "string", "pattern": "(?=x)x"}}, "required": []any{"text"}, "additionalProperties": false})
	base.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, Strict: true, JsonSchema: schema}
	if _, err := p.Serialize(base, false); err == nil {
		t.Fatal("best-effort regex accepted as strict")
	}
	delete(schema.Fields["properties"].GetStructValue().Fields["text"].GetStructValue().Fields, "pattern")
	if _, err := p.Serialize(base, false); err != nil {
		t.Fatal(err)
	}
	delete(schema.Fields, "additionalProperties")
	if _, err := p.Serialize(base, false); err == nil {
		t.Fatal("native implicit object closure accepted")
	}
}

func TestFireworksImageMaterializationBoundsAndTextOnlyModel(t *testing.T) {
	p, _ := NewFireworksTextBehavior("accounts/fireworks/models/kimi-k3p1-pro")
	part := &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: "owned", MimeType: "image/png"}}}
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Parts: []*runtimev1.ChatContentPart{part}}}}
	_, budget, err := p.PlanMaterialization(context.Background(), spec, false)
	if err != nil {
		t.Fatal(err)
	}
	if err = budget.Reserve(7_499_997); err != nil {
		t.Fatal(err)
	}
	if err = budget.Reserve(3); err == nil {
		t.Fatal("ten million encoded bytes admitted")
	}
	for len(spec.Input[0].Parts) < 121 {
		spec.Input[0].Parts = append(spec.Input[0].Parts, part)
	}
	if _, _, err := p.PlanMaterialization(context.Background(), spec, false); err == nil {
		t.Fatal("too many images")
	}
	spec.Input[0].Parts = spec.Input[0].Parts[:1]
	textOnly, _ := NewFireworksTextBehavior("accounts/fireworks/models/glm-5p3")
	if _, _, err := textOnly.PlanMaterialization(context.Background(), spec, false); err == nil {
		t.Fatal("text model admitted image")
	}
	spec.Input[0].Parts[0] = &runtimev1.ChatContentPart{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL, Content: &runtimev1.ChatContentPart_ImageUrl{ImageUrl: &runtimev1.ChatContentImageURL{Url: "data:image/png;base64,"}}}
	if _, err := p.Serialize(spec, false); err == nil {
		t.Fatal("unmaterialized placeholder accepted")
	}
}

func TestFireworksRejectsChangedModelAndIncompleteNativeOutput(t *testing.T) {
	p, _ := NewFireworksTextBehavior("accounts/fireworks/models/deepseek-v4p1-flash")
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hi"}}}
	for _, defect := range []string{"wrong model", "length", "provider error"} {
		body := map[string]any{"model": p.model, "choices": []any{map[string]any{"index": 0, "finish_reason": "stop", "message": map[string]any{"content": "answer", "reasoning_content": "native"}}}}
		if defect == "wrong model" {
			body["model"] = "another"
		}
		if defect == "length" {
			body["choices"].([]any)[0].(map[string]any)["finish_reason"] = "length"
		}
		if defect == "provider error" {
			body["error"] = map[string]any{"code": 500}
		}
		data, _ := json.Marshal(body)
		_, err := p.Parse(data, spec)
		if err == nil {
			t.Fatal(defect)
		}
		if defect == "length" {
			r, _ := grpcerr.ExtractReasonCode(err)
			if r != runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE {
				t.Fatal(err)
			}
		}
	}
	stream, _ := p.Stream(spec)
	data := `{"model":"` + p.model + `","choices":[{"index":0,"delta":{"reasoning_content":"` + strings.Repeat("x", 65536) + `"}}]}`
	if _, err := stream.Append([]byte(data)); err == nil {
		_, err = stream.Append([]byte(`{"model":"` + p.model + `","choices":[{"index":0,"delta":{"content":"answer"},"finish_reason":"stop"}]}`))
		if err == nil {
			t.Fatal("oversized native carrier")
		}
	}
}
