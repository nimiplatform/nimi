package capabilitydriver

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func xaiTestSpec() *runtimev1.TextGenerateScenarioSpec {
	return &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Compute"}}}
}
func xaiWire(t *testing.T, s *runtimev1.TextGenerateScenarioSpec) map[string]any {
	t.Helper()
	wire, err := NewXAIResponsesBehavior().Serialize(s, false)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if json.Unmarshal(wire.Payload, &out) != nil {
		t.Fatal("invalid wire")
	}
	return out
}
func TestXAIGrok47CapturesStatelessDefaultsAndOrderedSystemMessages(t *testing.T) {
	spec := xaiTestSpec()
	spec.SystemPrompt = "Root"
	spec.Input = append(spec.Input, &runtimev1.ChatMessage{Role: "system", Content: "Later rule"}, &runtimev1.ChatMessage{Role: "user", Content: "Continue"})
	body := xaiWire(t, spec)
	input := body["input"].([]any)
	if body["store"] != false || body["stream"] != true || body["instructions"] != "Root" || body["reasoning"].(map[string]any)["effort"] != "high" || input[1].(map[string]any)["role"] != "system" || body["max_output_tokens"] != nil || spec.Reasoning != nil {
		t.Fatalf("capture changed semantics: %+v", body)
	}
	if body["include"].([]any)[0] != "reasoning.encrypted_content" {
		t.Fatal("native stateless encrypted continuity not requested")
	}
	p := NewXAIResponsesBehavior()
	prepared := textbehavior.ApplyInternalOutputBudget(textbehavior.WithInternalOutputBudget(context.Background(), 64), spec, p.Serialize, false)
	if prepared.MaxTokens != nil {
		t.Fatal("internal reserve became a false caller hard limit")
	}
	for name, modify := range map[string]func(*runtimev1.TextGenerateScenarioSpec){
		"caller limit":      func(s *runtimev1.TextGenerateScenarioSpec) { s.MaxTokens = proto.Int32(32) },
		"temperature clamp": func(s *runtimev1.TextGenerateScenarioSpec) { s.Temperature = proto.Float32(1.5) },
		"top p clamp":       func(s *runtimev1.TextGenerateScenarioSpec) { s.TopP = proto.Float32(1) },
		"reasoning off": func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
		},
		"unsupported max effort": func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM}}
		},
	} {
		t.Run(name, func(t *testing.T) {
			request := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
			modify(request)
			_, err := p.Serialize(request, true)
			if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
				t.Fatalf("silently accepted unsupported value: %v", err)
			}
		})
	}
}
func TestXAISchemaPreservesOpenObjectsAndOptionalProperties(t *testing.T) {
	schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"value": map[string]any{"type": []any{"string", "null"}, "maxLength": 2048}}})
	spec := xaiTestSpec()
	spec.Tools = []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}
	spec.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, Strict: true, JsonSchema: schema}
	body := xaiWire(t, spec)
	tool := body["tools"].([]any)[0].(map[string]any)
	output := body["text"].(map[string]any)["format"].(map[string]any)["schema"].(map[string]any)
	if tool["strict"] != true || tool["parameters"].(map[string]any)["additionalProperties"] != true || output["additionalProperties"] != true || output["required"] != nil || schema.GetFields()["additionalProperties"] != nil {
		t.Fatal("native object defaults changed caller schema")
	}
	for name, node := range map[string]map[string]any{
		"standard pattern":               {"type": "string", "pattern": "^a$"},
		"best effort not":                {"not": map[string]any{"type": "string"}},
		"one of has different semantics": {"oneOf": []any{map[string]any{"type": "number"}, map[string]any{"type": "integer"}}},
		"long string bound":              {"type": "string", "maxLength": 2049.0},
		"large array bound":              {"type": "array", "maxItems": 257.0},
		"many properties":                {"type": "object", "maxProperties": 65.0},
		"unsupported format":             {"type": "string", "format": "hostname"},
		"circular reference":             {"$defs": map[string]any{"self": map[string]any{"$ref": "#/$defs/self"}}, "$ref": "#/$defs/self"},
		"external ref":                   {"$ref": "https://example.test/schema"},
		"multiple allOf":                 {"allOf": []any{map[string]any{"type": "string"}, map[string]any{"type": "string"}}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := mapXAISchema(node); err == nil {
				t.Fatal("native weak constraint accepted")
			}
		})
	}
	referenced := map[string]any{"type": "object", "$defs": map[string]any{"item": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}}}}, "properties": map[string]any{"value": map[string]any{"$ref": "#/$defs/item"}}}
	mapped, err := mapXAISchema(referenced)
	if err != nil || mapped["$defs"].(map[string]any)["item"].(map[string]any)["additionalProperties"] != true {
		t.Fatalf("noncircular object ref mapping: %v %v", mapped, err)
	}
}
func TestXAIGrok47RequiresModelClaimAndKeepsRawReasoningHidden(t *testing.T) {
	p := NewXAIResponsesBehavior()
	spec := xaiTestSpec()
	spec.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_LOW}}
	stream, _ := p.Stream(spec)
	appendEvent := func(event map[string]any) []textbehavior.OrderedDelta {
		t.Helper()
		raw, _ := json.Marshal(event)
		delta, err := stream.Append(raw)
		if err != nil {
			t.Fatal(err)
		}
		return delta
	}
	appendEvent(map[string]any{"type": "response.created", "response": map[string]any{"id": "response-1", "model": XAIGrok47Model, "status": "in_progress"}})
	appendEvent(map[string]any{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"type": "reasoning", "id": "r-1"}})
	rawText := "private raw stream must not become a summary"
	if got := appendEvent(map[string]any{"type": "response.reasoning_text.delta", "output_index": 0, "delta": rawText}); len(got) != 0 {
		t.Fatal("raw reasoning escaped")
	}
	native := responsesEncryptedReasoning{Type: "reasoning", ID: "r-1", Encrypted: "native-cipher", Summary: []responsesSummaryPart{{Type: "summary_text", Text: "Native summary"}}}
	appendEvent(map[string]any{"type": "response.output_item.done", "output_index": 0, "item": native})
	message := map[string]any{"type": "message", "id": "m-1", "content": []any{map[string]any{"type": "output_text", "text": "391"}}}
	appendEvent(map[string]any{"type": "response.output_item.added", "output_index": 1, "item": map[string]any{"type": "message", "id": "m-1"}})
	appendEvent(map[string]any{"type": "response.output_item.done", "output_index": 1, "item": message})
	appendEvent(map[string]any{"type": "response.completed", "response": map[string]any{"model": XAIGrok47Model, "status": "completed", "output": []any{native, message}, "usage": map[string]any{"input_tokens": 4, "output_tokens": 9}}})
	result, err := stream.Finish()
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), rawText) || len(result.Items) != 3 || result.Usage.GetOutputTokens() != 9 {
		t.Fatalf("ordered native result: %+v", result)
	}
	var transcript []*runtimev1.TextTurnItem
	for _, item := range result.Items {
		output := &runtimev1.TextOutputItem{}
		switch item.Kind {
		case textbehavior.OrderedItemReasoningSummary:
			output.Item = &runtimev1.TextOutputItem_ReasoningSummary{ReasoningSummary: &runtimev1.ReasoningSummary{Text: item.Text}}
		case textbehavior.OrderedItemReasoningContinuity:
			output.Item = &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: item.ReasoningContinuity}
		case textbehavior.OrderedItemText:
			output.Item = &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: item.Text}}
		}
		transcript = append(transcript, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: output}})
	}
	spec.Input = append(spec.Input, &runtimev1.ChatMessage{Role: "assistant", TurnItems: transcript}, &runtimev1.ChatMessage{Role: "user", Content: "Continue"})
	if _, err := p.Serialize(spec, true); err != nil {
		t.Fatal("native replay failed", err)
	}
	transcript[1].GetOutput().GetReasoningContinuity().Kind = OpenAIResponsesContinuityKind
	if _, err := p.Serialize(spec, true); err == nil {
		t.Fatal("foreign route carrier accepted")
	}
	for _, event := range []map[string]any{{"type": "response.created", "response": map[string]any{"model": "grok-4.6"}}, {"type": "response.output_item.added", "output_index": 0, "item": message}} {
		other, _ := p.Stream(xaiTestSpec())
		raw, _ := json.Marshal(event)
		if _, err := other.Append(raw); err == nil {
			t.Fatal("output accepted before exact native model evidence")
		}
	}
}
func TestXAIImagePlanningDoesNotTurnPlaceholderIntoInferenceInput(t *testing.T) {
	p := NewXAIResponsesBehavior()
	spec := xaiTestSpec()
	spec.Input[0].Content = ""
	spec.Input[0].Parts = []*runtimev1.ChatContentPart{{Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF, Content: &runtimev1.ChatContentPart_ArtifactRef{ArtifactRef: &runtimev1.ChatContentArtifactRef{ArtifactId: "owned", MimeType: "image/png"}}}}
	prepared, budget, err := p.PlanMaterialization(context.Background(), spec, false)
	if err != nil || budget == nil || prepared.GetInput()[0].GetParts()[0].GetArtifactRef().GetArtifactId() != "owned" {
		t.Fatalf("input planning %v %v", prepared, err)
	}
	if _, err := p.Serialize(prepared, false); err == nil {
		t.Fatal("unmaterialized image dispatched")
	}
}
