package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/types/known/structpb"
)

func geminiSchemaTestSpec(t *testing.T) *runtimev1.TextGenerateScenarioSpec {
	t.Helper()
	schema, err := structpb.NewStruct(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"title":    map[string]any{"type": "string"},
			"priority": map[string]any{"type": "string", "enum": []any{"low", "medium", "high"}},
			"tags":     map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		},
		"required": []any{"title", "priority", "tags"}, "additionalProperties": false,
	})
	if err != nil {
		t.Fatal(err)
	}
	return &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Write a release note."}},
		ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA,
			JsonSchema: schema, Strict: true, SchemaName: "lab_release_note"},
	}
}

func TestGemini38FlashSchemaWireAndStrictResult(t *testing.T) {
	spec := geminiSchemaTestSpec(t)
	serialized, err := Gemini38FlashSchemaRequestSerializer(spec, false)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(serialized.Payload, &wire); err != nil {
		t.Fatal(err)
	}
	format, ok := wire["response_format"].(map[string]any)
	if !ok || format["type"] != "json_schema" || wire["stream"] != false ||
		wire["model"] != nil || wire["enable_thinking"] != nil || wire["thinking"] != nil {
		t.Fatalf("Gemini schema wire changed: %+v", wire)
	}
	wrapper, ok := format["json_schema"].(map[string]any)
	if !ok || wrapper["strict"] != true || wrapper["name"] != "lab_release_note" {
		t.Fatalf("Gemini schema wrapper changed: %+v", format)
	}
	for _, test := range []struct {
		name string
		text string
		ok   bool
	}{
		{"valid", `{"title":"Nimi","priority":"high","tags":["cloud"]}`, true},
		{"missing property", `{"title":"Nimi","priority":"high"}`, false},
		{"extra property", `{"title":"Nimi","priority":"high","tags":[],"extra":1}`, false},
		{"second value", `{"title":"Nimi","priority":"high","tags":[]}{}`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			payload, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{
				"index": 0, "finish_reason": "stop", "message": map[string]any{"content": test.text}}}})
			result, err := Gemini38FlashSchemaNonStreamParser(payload, spec)
			if test.ok && (err != nil || len(result.Items) != 1 || result.Items[0].Text != test.text) {
				t.Fatalf("valid Gemini schema result=%+v err=%v", result, err)
			}
			if !test.ok {
				if reason, present := grpcerr.ExtractReasonCode(err); !present || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
					t.Fatalf("invalid Gemini schema result=%+v err=%v", result, err)
				}
			}
		})
	}
}

func TestGemini38FlashSchemaRejectsUncapturedModesAndKeywords(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*runtimev1.TextGenerateScenarioSpec)
		stream bool
	}{
		{"stream", func(*runtimev1.TextGenerateScenarioSpec) {}, true},
		{"tool", func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Tools = []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup"}}
		}, false},
		{"sampling", func(s *runtimev1.TextGenerateScenarioSpec) {
			value := float32(0.5)
			s.Temperature = &value
		}, false},
		{"unsupported schema keyword", func(s *runtimev1.TextGenerateScenarioSpec) {
			schema := s.ResponseFormat.JsonSchema.AsMap()
			schema["properties"].(map[string]any)["title"].(map[string]any)["pattern"] = "^Nimi"
			s.ResponseFormat.JsonSchema, _ = structpb.NewStruct(schema)
		}, false},
		{"open object", func(s *runtimev1.TextGenerateScenarioSpec) {
			schema := s.ResponseFormat.JsonSchema.AsMap()
			delete(schema, "additionalProperties")
			s.ResponseFormat.JsonSchema, _ = structpb.NewStruct(schema)
		}, false},
		{"optional property", func(s *runtimev1.TextGenerateScenarioSpec) {
			schema := s.ResponseFormat.JsonSchema.AsMap()
			schema["required"] = []any{"title", "priority"}
			s.ResponseFormat.JsonSchema, _ = structpb.NewStruct(schema)
		}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			spec := geminiSchemaTestSpec(t)
			test.change(spec)
			_, err := Gemini38FlashSchemaRequestSerializer(spec, test.stream)
			if reason, present := grpcerr.ExtractReasonCode(err); !present || reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
				t.Fatalf("unsupported Gemini schema request: %v", err)
			}
		})
	}
}
