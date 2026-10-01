package capabilitydriver

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

const gemini38ToolSignatureKind = "gemini.chat.tool-thought-signature"
const Gemini38ToolSignatureKind = gemini38ToolSignatureKind

type gemini38ToolSignature struct {
	CallID    string `json:"call_id"`
	Signature string `json:"thought_signature"`
}

func gemini38OutputInvalid() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r119
// The exact Chat Completions function call is stateless. Gemini 3 requires the
// signature on that call to be returned unchanged beside the matching result.
func Gemini38FlashToolRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	if stream || spec == nil || spec.GetIncludeRawChunks() || len(spec.GetTools()) != 1 ||
		(spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO &&
			spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED) ||
		spec.GetToolChoiceName() != "" || llamaBehaviorReasoningEnabled(spec) ||
		spec.Temperature != nil || spec.TopP != nil || spec.TopK != nil ||
		spec.MaxTokens != nil || spec.PresencePenalty != nil ||
		spec.FrequencyPenalty != nil || spec.Seed != nil || len(spec.GetStop()) != 0 ||
		(spec.GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED &&
			spec.GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT) {
		return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
	}
	tool := spec.GetTools()[0]
	if tool == nil || tool.GetKind() != runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION ||
		!deepseekFunctionName(tool.GetName()) || tool.GetProviderToolId() != "" ||
		tool.GetProviderArgs() != nil || tool.GetProviderMetadata() != nil {
		return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
	}
	inputSchema := map[string]any{"type": "object", "properties": map[string]any{}}
	if tool.GetInputSchema() != nil {
		inputSchema = tool.GetInputSchema().AsMap()
	}
	if !geminiSchemaSubset(inputSchema, 0) {
		return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
	}
	if _, err := textbehavior.CompileJSONSchema(inputSchema); err != nil {
		return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
	}
	messages := make([]map[string]any, 0, len(spec.GetInput())+3)
	if spec.GetSystemPrompt() != "" {
		messages = append(messages, map[string]any{"role": "system", "content": spec.GetSystemPrompt()})
	}
	seenToolTurn := false
	for _, message := range spec.GetInput() {
		if message == nil || len(message.GetParts()) != 0 {
			return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
		}
		if len(message.GetTurnItems()) == 0 {
			if seenToolTurn || (message.GetRole() != "user" && message.GetRole() != "system" && message.GetRole() != "assistant") {
				return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
			}
			messages = append(messages, map[string]any{"role": message.GetRole(), "content": message.GetContent()})
			continue
		}
		if seenToolTurn || message.GetRole() != "assistant" || message.GetContent() != "" || len(message.GetTurnItems()) != 3 {
			return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
		}
		items := message.GetTurnItems()
		call := items[0].GetOutput().GetToolCall()
		carrier := items[1].GetOutput().GetReasoningContinuity()
		result := items[2].GetToolResult()
		if call == nil || carrier == nil || result == nil || call.GetDynamic() || call.GetProviderMetadata() != nil ||
			call.GetName() != tool.GetName() || !deepseekCallID(call.GetId()) ||
			result.GetToolCallId() != call.GetId() || result.GetToolName() != call.GetName() ||
			result.GetDynamic() || result.GetPreliminary() || result.GetProviderMetadata() != nil ||
			!textbehavior.ValidContinuity(carrier) || carrier.GetKind() != gemini38ToolSignatureKind || carrier.GetVersion() != 1 {
			return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
		}
		if err := textbehavior.ValidateToolArguments(tool, call.GetArgumentsJson()); err != nil {
			return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
		}
		var signature gemini38ToolSignature
		decoder := json.NewDecoder(bytes.NewReader(carrier.GetPayload()))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&signature) != nil || decoder.Decode(new(any)) != io.EOF ||
			signature.CallID != call.GetId() || strings.TrimSpace(signature.Signature) == "" {
			return textbehavior.SerializedRequest{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID)
		}
		messages = append(messages, map[string]any{
			"role": "assistant", "content": nil,
			"tool_calls": []any{map[string]any{
				"id": call.GetId(), "type": "function",
				"function":      map[string]any{"name": call.GetName(), "arguments": call.GetArgumentsJson()},
				"extra_content": map[string]any{"google": map[string]any{"thought_signature": signature.Signature}},
			}},
		})
		var toolValue any
		if result.GetResult() != nil {
			toolValue = result.GetResult().AsInterface()
		}
		if result.GetIsError() {
			toolValue = map[string]any{"error": toolValue}
		}
		content, err := json.Marshal(toolValue)
		if err != nil {
			return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
		}
		messages = append(messages, map[string]any{
			"role": "tool", "name": call.GetName(), "tool_call_id": call.GetId(), "content": string(content),
		})
		seenToolTurn = true
	}
	if len(messages) == 0 {
		return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
	}
	payload, err := json.Marshal(map[string]any{
		"messages": messages, "stream": false,
		"tools": []any{map[string]any{"type": "function", "function": map[string]any{
			"name": tool.GetName(), "description": tool.GetDescription(), "parameters": inputSchema,
		}}},
		"tool_choice": "auto",
	})
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, err
}

func Gemini38FlashToolNonStreamParser(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if spec == nil || len(spec.GetTools()) != 1 {
		return textbehavior.NormalizedResult{}, gemini38OutputInvalid()
	}
	var envelope struct {
		Choices []struct {
			Index        *int    `json:"index"`
			FinishReason *string `json:"finish_reason"`
			Message      *struct {
				Content   *string `json:"content"`
				Refusal   *string `json:"refusal"`
				ToolCalls []struct {
					ID       string `json:"id"`
					Type     string `json:"type"`
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
					ExtraContent struct {
						Google struct {
							ThoughtSignature string `json:"thought_signature"`
						} `json:"google"`
					} `json:"extra_content"`
				} `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
		Usage *struct {
			PromptTokens     int64 `json:"prompt_tokens"`
			CompletionTokens int64 `json:"completion_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(payload, &envelope) != nil || len(envelope.Choices) != 1 ||
		envelope.Choices[0].Index == nil || *envelope.Choices[0].Index != 0 ||
		envelope.Choices[0].Message == nil || envelope.Choices[0].FinishReason == nil {
		return textbehavior.NormalizedResult{}, gemini38OutputInvalid()
	}
	choice := envelope.Choices[0]
	if choice.Message.Refusal != nil && *choice.Message.Refusal != "" {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
	}
	if *choice.FinishReason == "length" {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE)
	}
	output := textbehavior.NormalizedResult{}
	if envelope.Usage != nil {
		if envelope.Usage.PromptTokens < 0 || envelope.Usage.CompletionTokens < 0 {
			return textbehavior.NormalizedResult{}, gemini38OutputInvalid()
		}
		output.Usage = &runtimev1.UsageStats{InputTokens: envelope.Usage.PromptTokens, OutputTokens: envelope.Usage.CompletionTokens}
	}
	if len(choice.Message.ToolCalls) == 0 {
		if *choice.FinishReason != "stop" || choice.Message.Content == nil || strings.TrimSpace(*choice.Message.Content) == "" {
			return textbehavior.NormalizedResult{}, gemini38OutputInvalid()
		}
		output.FinishReason = runtimev1.FinishReason_FINISH_REASON_STOP
		output.Items = []textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemText, Text: *choice.Message.Content}}
		return output, nil
	}
	if *choice.FinishReason != "tool_calls" || len(choice.Message.ToolCalls) != 1 ||
		choice.Message.Content != nil && strings.TrimSpace(*choice.Message.Content) != "" {
		return textbehavior.NormalizedResult{}, gemini38OutputInvalid()
	}
	for _, message := range spec.GetInput() {
		if message == nil || len(message.GetTurnItems()) != 0 {
			return textbehavior.NormalizedResult{}, gemini38OutputInvalid()
		}
	}
	call := choice.Message.ToolCalls[0]
	if !deepseekCallID(call.ID) || call.Type != "function" || call.Function.Name != spec.GetTools()[0].GetName() ||
		strings.TrimSpace(call.ExtraContent.Google.ThoughtSignature) == "" ||
		textbehavior.ValidateToolArguments(spec.GetTools()[0], call.Function.Arguments) != nil {
		return textbehavior.NormalizedResult{}, gemini38OutputInvalid()
	}
	signature, err := json.Marshal(gemini38ToolSignature{CallID: call.ID, Signature: call.ExtraContent.Google.ThoughtSignature})
	if err != nil || len(signature) > textbehavior.MaxReasoningContinuityPayloadBytes {
		return textbehavior.NormalizedResult{}, gemini38OutputInvalid()
	}
	output.FinishReason = runtimev1.FinishReason_FINISH_REASON_TOOL_CALL
	output.Items = []textbehavior.OrderedItem{
		{Kind: textbehavior.OrderedItemToolCall, ToolCall: &runtimev1.ToolCall{Id: call.ID, Name: call.Function.Name, ArgumentsJson: call.Function.Arguments}},
		{Kind: textbehavior.OrderedItemReasoningContinuity, ReasoningContinuity: &runtimev1.ReasoningContinuityCarrier{Kind: gemini38ToolSignatureKind, Version: 1, Payload: signature}},
	}
	return output, nil
}
