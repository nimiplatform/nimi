package capabilitydriver

import (
	"encoding/json"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.mimo-v26-tool-text
// MiMo's reviewed non-thinking function-call wire format shares the strict
// Chat Completions transcript and result parsers used by DeepSeek. Admission,
// sampling bounds, token-limit spelling and stream options remain MiMo-owned.
// https://mimo.mi.com/docs/zh-CN/api/chat/openai-api
func validateMimoChatSpec(spec *runtimev1.TextGenerateScenarioSpec) error {
	if spec == nil || len(spec.GetTools()) == 0 || llamaBehaviorReasoningEnabled(spec) || spec.TopK != nil || spec.Seed != nil {
		return deepseekUnsupported()
	}
	if spec.GetToolChoiceName() != "" || (spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO) {
		// Upstream silently treats other choices as auto; never promise them.
		return deepseekUnsupported()
	}
	format := spec.GetResponseFormat()
	if (format.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED && format.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT) || format.GetStrict() || format.GetJsonSchema() != nil {
		return deepseekUnsupported()
	}
	if (spec.Temperature != nil && !(spec.GetTemperature() >= 0 && spec.GetTemperature() <= 1.5)) ||
		(spec.TopP != nil && !(spec.GetTopP() >= 0.01 && spec.GetTopP() <= 1)) ||
		(spec.MaxTokens != nil && (spec.GetMaxTokens() < 1 || spec.GetMaxTokens() > 131072)) ||
		(spec.PresencePenalty != nil && !(spec.GetPresencePenalty() >= -2 && spec.GetPresencePenalty() <= 2)) ||
		(spec.FrequencyPenalty != nil && !(spec.GetFrequencyPenalty() >= -2 && spec.GetFrequencyPenalty() <= 2)) || len(spec.GetStop()) > 4 {
		return deepseekJSONInputError("MiMo sampling bounds")
	}
	return nil
}

func MimoChatRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	if err := validateMimoChatSpec(spec); err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	messages, err := deepseekChatMessages(spec)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	body := map[string]any{"messages": messages, "stream": stream, "thinking": map[string]string{"type": "disabled"}}
	if err := deepseekChatTools(body, spec); err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	if spec.MaxTokens != nil {
		body["max_completion_tokens"] = spec.GetMaxTokens()
	}
	if spec.Temperature != nil {
		body["temperature"] = spec.GetTemperature()
	}
	if spec.TopP != nil {
		body["top_p"] = spec.GetTopP()
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
	// MiMo documents usage on response chunks, not an include_usage request flag.
	payload, err := json.Marshal(body)
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, err
}

func mimoChatTruncation(payload []byte) error {
	if strings.TrimSpace(string(payload)) == "[DONE]" {
		return nil
	}
	value, err := decodeDeepseekJSONEnvelope(payload)
	if err != nil {
		return err
	}
	for _, choice := range value.Choices {
		if choice.FinishReason != nil && *choice.FinishReason == "repetition_truncation" {
			return deepseekIncomplete()
		}
	}
	return nil
}

func MimoChatNonStreamParser(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if err := validateMimoChatSpec(spec); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if err := mimoChatTruncation(payload); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	return parseDeepseekToolResponse(payload, spec)
}

type mimoToolStream struct {
	textbehavior.StreamFragmentAssembler
}

func (s *mimoToolStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	if err := mimoChatTruncation(payload); err != nil {
		return nil, err
	}
	return s.StreamFragmentAssembler.Append(payload)
}

func MimoChatStreamAssembler(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	if err := validateMimoChatSpec(spec); err != nil {
		return nil, err
	}
	return &mimoToolStream{StreamFragmentAssembler: newDeepseekToolStream(spec)}, nil
}
