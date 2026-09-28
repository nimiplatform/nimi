package capabilitydriver

import (
	"encoding/json"
	"io"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r119
// Qwen3.8-Flash's first advanced Chat Completions cell uses non-thinking
// function calls or JSON objects. The ordered message and result parser is
// shared with the proven OpenAI-compatible DeepSeek dialect; its request
// controls differ and are captured here explicitly.
func DashscopeQwen38RequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	unsupported := func() (textbehavior.SerializedRequest, error) {
		return textbehavior.SerializedRequest{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	if spec == nil || spec.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE || spec.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED ||
		spec.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL || spec.GetToolChoiceName() != "" ||
		spec.Temperature != nil || spec.TopP != nil || spec.MaxTokens != nil || spec.PresencePenalty != nil ||
		spec.FrequencyPenalty != nil || len(spec.GetStop()) != 0 {
		return unsupported()
	}
	if format := spec.GetResponseFormat(); format.GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
		if stream || len(spec.GetTools()) != 0 || llamaBehaviorReasoningEnabled(spec) || format.GetJsonSchema() == nil || !format.GetStrict() ||
			spec.TopK != nil || spec.Seed != nil {
			return unsupported()
		}
		schema := format.GetJsonSchema().AsMap()
		if _, err := textbehavior.CompileJSONSchema(schema); err != nil {
			return unsupported()
		}
		messages, err := deepseekChatMessages(spec)
		if err != nil {
			return textbehavior.SerializedRequest{}, err
		}
		name := strings.TrimSpace(format.GetSchemaName())
		if name == "" {
			name = "nimi_response"
		}
		wrapper := map[string]any{"name": name, "strict": true, "schema": schema}
		if description := strings.TrimSpace(format.GetSchemaDescription()); description != "" {
			wrapper["description"] = description
		}
		payload, err := json.Marshal(map[string]any{"messages": messages, "stream": false, "enable_thinking": false,
			"response_format": map[string]any{"type": "json_schema", "json_schema": wrapper}})
		return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, err
	}
	if spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT {
		return unsupported()
	}
	serialized, err := DeepseekChatRequestSerializer(spec, stream)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	body := map[string]json.RawMessage{}
	if json.Unmarshal(serialized.Payload, &body) != nil {
		return unsupported()
	}
	delete(body, "thinking")
	body["enable_thinking"] = json.RawMessage("false")
	if len(spec.GetTools()) > 0 {
		body["parallel_tool_calls"] = json.RawMessage("false")
	}
	serialized.Payload, err = json.Marshal(body)
	return serialized, err
}

func DashscopeQwen38NonStreamParser(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if spec.GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
		result, err := DeepseekChatNonStreamParser(payload, spec)
		if err != nil {
			return textbehavior.NormalizedResult{}, err
		}
		calls, hasText := 0, false
		for _, item := range result.Items {
			if item.Kind == textbehavior.OrderedItemToolCall {
				calls++
			}
			if item.Kind == textbehavior.OrderedItemText && item.Text != "" {
				hasText = true
			}
		}
		if calls > 1 || calls > 0 && hasText {
			return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		return result, nil
	}
	invalid := func() error { return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID) }
	format := spec.GetResponseFormat()
	if len(spec.GetTools()) != 0 || format.GetJsonSchema() == nil || !format.GetStrict() {
		return textbehavior.NormalizedResult{}, invalid()
	}
	value, err := decodeDeepseekJSONEnvelope(payload)
	if err != nil || len(value.Choices) != 1 || value.Choices[0].Index == nil || *value.Choices[0].Index != 0 {
		return textbehavior.NormalizedResult{}, invalid()
	}
	choice := value.Choices[0]
	if err := deepseekJSONFinish(choice.FinishReason); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	answer, err := deepseekJSONMessageText(choice.Message)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	var instance any
	decoder := json.NewDecoder(strings.NewReader(answer))
	decoder.UseNumber()
	if decoder.Decode(&instance) != nil || decoder.Decode(new(any)) != io.EOF {
		return textbehavior.NormalizedResult{}, invalid()
	}
	schema, err := textbehavior.CompileJSONSchema(format.GetJsonSchema().AsMap())
	if err != nil || schema.Validate(instance) != nil {
		return textbehavior.NormalizedResult{}, invalid()
	}
	return textbehavior.NormalizedResult{Items: []textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemText, Text: answer}},
		FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP, Usage: deepseekJSONUsage(value)}, nil
}
