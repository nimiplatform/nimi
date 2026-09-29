package capabilitydriver

import (
	"encoding/json"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

func geminiSchemaUnsupported() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
}

func Gemini38FlashRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	if spec != nil && len(spec.GetTools()) > 0 {
		return Gemini38FlashToolRequestSerializer(spec, stream)
	}
	return Gemini38FlashSchemaRequestSerializer(spec, stream)
}

func Gemini38FlashNonStreamParser(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if spec != nil && len(spec.GetTools()) > 0 {
		return Gemini38FlashToolNonStreamParser(payload, spec)
	}
	return Gemini38FlashSchemaNonStreamParser(payload, spec)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r123
// This captures the documented Chat Completions JSON Schema wire shape.
// No tool, reasoning, stream, media, or sampling mode is inferred from the
// model card. Unsupported schema keywords fail before provider dispatch.
func Gemini38FlashSchemaRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	if stream || spec == nil || len(spec.GetTools()) != 0 ||
		spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED ||
		spec.GetToolChoiceName() != "" || llamaBehaviorReasoningEnabled(spec) ||
		spec.Temperature != nil || spec.TopP != nil || spec.TopK != nil ||
		spec.MaxTokens != nil || spec.PresencePenalty != nil ||
		spec.FrequencyPenalty != nil || spec.Seed != nil || len(spec.GetStop()) != 0 {
		return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
	}
	format := spec.GetResponseFormat()
	if format.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA ||
		!format.GetStrict() || format.GetJsonSchema() == nil {
		return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
	}
	for _, message := range spec.GetInput() {
		if message == nil || len(message.GetTurnItems()) != 0 {
			return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
		}
	}
	schema := format.GetJsonSchema().AsMap()
	if !geminiSchemaSubset(schema, 0) {
		return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
	}
	if _, err := textbehavior.CompileJSONSchema(schema); err != nil {
		return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
	}
	messages, err := deepseekChatMessages(spec)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	name := format.GetSchemaName()
	if name == "" {
		name = "nimi_response"
	}
	wrapper := map[string]any{"name": name, "strict": true, "schema": schema}
	if format.GetSchemaDescription() != "" {
		wrapper["description"] = format.GetSchemaDescription()
	}
	payload, err := json.Marshal(map[string]any{
		"messages": messages, "stream": false,
		"response_format": map[string]any{"type": "json_schema", "json_schema": wrapper},
	})
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, err
}

// A deliberately bounded subset of Google's documented JSON Schema fields.
// The original schema is sent unchanged and independently validates output.
func geminiSchemaSubset(schema map[string]any, depth int) bool {
	if depth > 8 || schema == nil {
		return false
	}
	typeName, ok := schema["type"].(string)
	if !ok {
		return false
	}
	switch typeName {
	case "object", "array", "string", "number", "integer", "boolean":
	default:
		return false
	}
	if typeName == "object" {
		properties, ok := schema["properties"].(map[string]any)
		if !ok || len(properties) == 0 || schema["additionalProperties"] != false {
			return false
		}
		required, ok := schema["required"].([]any)
		if !ok || len(required) != len(properties) {
			return false
		}
		seen := make(map[string]bool, len(required))
		for _, value := range required {
			name, ok := value.(string)
			if !ok || seen[name] {
				return false
			}
			if _, ok := properties[name]; !ok {
				return false
			}
			seen[name] = true
		}
	}
	for key, value := range schema {
		switch key {
		case "type":
		case "title", "description":
			if _, ok := value.(string); !ok {
				return false
			}
		case "properties":
			if typeName != "object" {
				return false
			}
			properties, ok := value.(map[string]any)
			if !ok {
				return false
			}
			for _, child := range properties {
				childSchema, ok := child.(map[string]any)
				if !ok || !geminiSchemaSubset(childSchema, depth+1) {
					return false
				}
			}
		case "required":
			if typeName != "object" {
				return false
			}
			items, ok := value.([]any)
			if !ok {
				return false
			}
			for _, item := range items {
				if _, ok := item.(string); !ok {
					return false
				}
			}
		case "additionalProperties":
			if typeName != "object" || value != false {
				return false
			}
		case "items":
			child, ok := value.(map[string]any)
			if typeName != "array" || !ok || !geminiSchemaSubset(child, depth+1) {
				return false
			}
		case "enum":
			items, ok := value.([]any)
			if typeName != "string" || !ok || len(items) == 0 {
				return false
			}
			for _, item := range items {
				if _, ok := item.(string); !ok {
					return false
				}
			}
		default:
			return false
		}
	}
	return depth != 0 || typeName == "object"
}

func Gemini38FlashSchemaNonStreamParser(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	return parseStrictChatJSONSchema(payload, spec)
}

func Gemini38FlashSchemaStreamAssembler(_ *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	return nil, geminiSchemaUnsupported()
}
