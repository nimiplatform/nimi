package capabilitydriver

import (
	"encoding/json"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.deepseek-v4-json-output
func DeepseekJSONRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	if spec == nil || spec.GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT ||
		spec.GetResponseFormat().GetJsonSchema() != nil || spec.GetResponseFormat().GetStrict() ||
		len(spec.GetTools()) != 0 || spec.GetToolChoiceName() != "" ||
		(spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE) ||
		llamaBehaviorReasoningEnabled(spec) || spec.TopK != nil || spec.Seed != nil {
		return textbehavior.SerializedRequest{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
	}
	messages := make([]map[string]string, 0, len(spec.GetInput())+2)
	jsonCue := false
	appendText := func(role, text string) {
		jsonCue = jsonCue || strings.Contains(strings.ToLower(text), "json")
		messages = append(messages, map[string]string{"role": role, "content": text})
	}
	if spec.GetSystemPrompt() != "" {
		appendText("system", spec.GetSystemPrompt())
	}
	for _, message := range spec.GetInput() {
		if message == nil || (message.Role != "system" && message.Role != "user" && message.Role != "assistant") {
			return textbehavior.SerializedRequest{}, deepseekJSONInputError("unsupported message role")
		}
		if len(message.GetTurnItems()) > 0 {
			for _, item := range message.GetTurnItems() {
				value := item.GetOutput().GetText()
				if value == nil || message.Role != "assistant" {
					return textbehavior.SerializedRequest{}, deepseekJSONInputError("unsupported ordered content")
				}
				appendText("assistant", value.GetText())
			}
			continue
		}
		content := message.GetContent()
		if len(message.GetParts()) > 0 {
			if content != "" {
				return textbehavior.SerializedRequest{}, deepseekJSONInputError("conflicting message content")
			}
			var text strings.Builder
			for _, part := range message.GetParts() {
				if part.GetType() != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
					return textbehavior.SerializedRequest{}, deepseekJSONInputError("JSON behavior requires text input")
				}
				text.WriteString(part.GetText())
			}
			content = text.String()
		}
		appendText(message.Role, content)
	}
	if len(messages) == 0 {
		return textbehavior.SerializedRequest{}, deepseekJSONInputError("missing text input")
	}
	if !jsonCue {
		messages = append([]map[string]string{{"role": "system", "content": "Return a JSON object."}}, messages...)
	}
	body := map[string]any{"messages": messages, "stream": stream, "thinking": map[string]string{"type": "disabled"}, "response_format": map[string]string{"type": "json_object"}}
	if stream {
		body["stream_options"] = map[string]bool{"include_usage": true}
	}
	if spec.Temperature != nil {
		body["temperature"] = spec.GetTemperature()
	}
	if spec.TopP != nil {
		body["top_p"] = spec.GetTopP()
	}
	if spec.MaxTokens != nil {
		body["max_tokens"] = spec.GetMaxTokens()
	}
	if spec.PresencePenalty != nil {
		body["presence_penalty"] = spec.GetPresencePenalty()
	}
	if spec.FrequencyPenalty != nil {
		body["frequency_penalty"] = spec.GetFrequencyPenalty()
	}
	if len(spec.GetStop()) > 0 {
		body["stop"] = append([]string(nil), spec.GetStop()...)
	}
	payload, err := json.Marshal(body)
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, err
}

type deepseekJSONMessage struct {
	Content          *string         `json:"content"`
	ReasoningContent *string         `json:"reasoning_content"`
	ToolCalls        json.RawMessage `json:"tool_calls"`
}

type deepseekJSONEnvelope struct {
	Choices []struct {
		Index        int                  `json:"index"`
		Message      *deepseekJSONMessage `json:"message"`
		Delta        *deepseekJSONMessage `json:"delta"`
		FinishReason *string              `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int64 `json:"prompt_tokens"`
		CompletionTokens int64 `json:"completion_tokens"`
	} `json:"usage"`
}

func decodeDeepseekJSONEnvelope(payload []byte) (deepseekJSONEnvelope, error) {
	var value deepseekJSONEnvelope
	if json.Unmarshal(payload, &value) != nil {
		return value, deepseekJSONOutputError()
	}
	if value.Usage != nil && (value.Usage.PromptTokens < 0 || value.Usage.CompletionTokens < 0) {
		return value, deepseekJSONOutputError()
	}
	return value, nil
}

func deepseekJSONMessageText(message *deepseekJSONMessage) (string, error) {
	if message == nil {
		return "", deepseekJSONOutputError()
	}
	calls := strings.TrimSpace(string(message.ToolCalls))
	if (message.ReasoningContent != nil && *message.ReasoningContent != "") || (calls != "" && calls != "null" && calls != "[]") {
		return "", deepseekJSONOutputError()
	}
	if message.Content == nil {
		return "", nil
	}
	return *message.Content, nil
}

func deepseekJSONFinish(reason *string) error {
	if reason == nil {
		return deepseekJSONOutputError()
	}
	switch *reason {
	case "stop":
		return nil
	case "length":
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE)
	case "content_filter":
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
	default:
		return deepseekJSONOutputError()
	}
}

func deepseekJSONObject(text string) error {
	var object map[string]json.RawMessage
	if json.Unmarshal([]byte(text), &object) != nil || object == nil {
		return deepseekJSONOutputError()
	}
	return nil
}

func deepseekJSONUsage(value deepseekJSONEnvelope) *runtimev1.UsageStats {
	if value.Usage == nil {
		return nil
	}
	return &runtimev1.UsageStats{InputTokens: value.Usage.PromptTokens, OutputTokens: value.Usage.CompletionTokens}
}

func DeepseekJSONNonStreamParser(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if spec == nil || spec.GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT {
		return textbehavior.NormalizedResult{}, deepseekJSONInputError("JSON-object request is required")
	}
	value, err := decodeDeepseekJSONEnvelope(payload)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if len(value.Choices) != 1 || value.Choices[0].Index != 0 {
		return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
	}
	choice := value.Choices[0]
	if err := deepseekJSONFinish(choice.FinishReason); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	text, err := deepseekJSONMessageText(choice.Message)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if err := deepseekJSONObject(text); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	return textbehavior.NormalizedResult{Items: []textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemText, Text: text}}, FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP, Usage: deepseekJSONUsage(value)}, nil
}

func DeepseekJSONStreamAssembler(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	if spec == nil || spec.GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT {
		return nil, deepseekJSONInputError("JSON-object request is required")
	}
	return &deepseekJSONStream{}, nil
}

type deepseekJSONStream struct {
	text      strings.Builder
	finished  bool
	done      bool
	usageTail bool
	usage     *runtimev1.UsageStats
}

func (stream *deepseekJSONStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	if stream.done {
		return nil, deepseekJSONOutputError()
	}
	if strings.TrimSpace(string(payload)) == "[DONE]" {
		if !stream.finished {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE)
		}
		stream.done = true
		return nil, nil
	}
	value, err := decodeDeepseekJSONEnvelope(payload)
	if err != nil {
		return nil, err
	}
	if stream.finished {
		if len(value.Choices) != 0 || value.Usage == nil || stream.usageTail {
			return nil, deepseekJSONOutputError()
		}
		stream.usage = deepseekJSONUsage(value)
		stream.usageTail = true
		return nil, nil
	}
	if len(value.Choices) != 1 || value.Choices[0].Index != 0 {
		return nil, deepseekJSONOutputError()
	}
	choice := value.Choices[0]
	text := ""
	if choice.Delta != nil || choice.FinishReason == nil {
		text, err = deepseekJSONMessageText(choice.Delta)
		if err != nil {
			return nil, err
		}
	}
	if value.Usage != nil {
		stream.usage = deepseekJSONUsage(value)
	}
	var deltas []textbehavior.OrderedDelta
	if text != "" {
		stream.text.WriteString(text)
		deltas = append(deltas, textbehavior.OrderedDelta{ItemIndex: 0, Kind: textbehavior.OrderedItemText, Text: text})
	}
	if choice.FinishReason != nil {
		if err := deepseekJSONFinish(choice.FinishReason); err != nil {
			return nil, err
		}
		if err := deepseekJSONObject(stream.text.String()); err != nil {
			return nil, err
		}
		stream.finished = true
		deltas = append(deltas, textbehavior.OrderedDelta{ItemIndex: 0, Kind: textbehavior.OrderedItemText, ItemCompleted: true})
	}
	return deltas, nil
}

func (stream *deepseekJSONStream) Finish() (textbehavior.NormalizedResult, error) {
	if !stream.done || !stream.finished {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE)
	}
	return textbehavior.NormalizedResult{Items: []textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemText, Text: stream.text.String()}}, FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP, Usage: stream.usage}, nil
}

func deepseekJSONInputError(detail string) error {
	return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, fmt.Errorf("DeepSeek JSON input: %s", detail), grpcerr.ReasonOptions{})
}

func deepseekJSONOutputError() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}
