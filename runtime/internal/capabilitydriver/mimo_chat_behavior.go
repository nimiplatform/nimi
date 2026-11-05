package capabilitydriver

import (
	"context"
	"encoding/json"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

const mimoMaxRequestBytes = 48 << 20

type MimoTextBehavior struct{ model string }

func NewMimoTextBehavior(model string) (MimoTextBehavior, error) {
	switch model {
	case "mimo-v2.6-flash", "mimo-v2.6-pro":
		return MimoTextBehavior{model: model}, nil
	default:
		return MimoTextBehavior{}, deepseekUnsupported()
	}
}

func (p MimoTextBehavior) ContinuityKind() string {
	return "mimo.chat.native-reasoning-replay." + p.model
}

// @nimi-authority: rule.nimi.runtime.ai-provider.mimo-v26-tool-text
func (p MimoTextBehavior) validate(spec *runtimev1.TextGenerateScenarioSpec) (bool, error) {
	if p.model == "" {
		return false, deepseekUnsupported()
	}
	if err := validateChatFunctionSpec(spec, true); err != nil {
		return false, err
	}
	// MiMo silently treats other choices as auto; never promise them.
	if spec.GetIncludeRawChunks() || spec.GetToolChoiceName() != "" || (spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO) {
		return false, deepseekUnsupported()
	}
	format := spec.GetResponseFormat()
	if format.GetSchemaName() != "" || format.GetSchemaDescription() != "" {
		return false, deepseekUnsupported()
	}
	r := spec.GetReasoning()
	if r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
		return false, deepseekUnsupported()
	}
	thinking := false
	switch r.GetActivation() {
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED, runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED:
		if r.GetIntensity() != nil {
			return false, deepseekUnsupported()
		}
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED:
		if _, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok || r.GetEffort() != runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT {
			return false, deepseekUnsupported()
		}
		thinking = true
	default:
		return false, deepseekUnsupported()
	}
	if thinking && (spec.Temperature != nil || spec.TopP != nil) {
		return false, deepseekUnsupported()
	}
	if (spec.Temperature != nil && !(spec.GetTemperature() >= 0 && spec.GetTemperature() <= 1.5)) ||
		(spec.TopP != nil && !(spec.GetTopP() >= 0.01 && spec.GetTopP() <= 1)) ||
		(spec.MaxTokens != nil && (spec.GetMaxTokens() < 1 || spec.GetMaxTokens() > 131072)) ||
		(spec.PresencePenalty != nil && !(spec.GetPresencePenalty() >= -2 && spec.GetPresencePenalty() <= 2)) ||
		(spec.FrequencyPenalty != nil && !(spec.GetFrequencyPenalty() >= -2 && spec.GetFrequencyPenalty() <= 2)) || len(spec.GetStop()) > 4 {
		return false, deepseekJSONInputError("MiMo sampling bounds")
	}
	return thinking, nil
}

func (p MimoTextBehavior) Serialize(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	return p.serialize(spec, stream, false)
}

func (p MimoTextBehavior) serialize(spec *runtimev1.TextGenerateScenarioSpec, stream, planning bool) (textbehavior.SerializedRequest, error) {
	thinking, err := p.validate(spec)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	project := func(m *runtimev1.ChatMessage) (any, error) { return mimoMessageContent(m, planning) }
	messages, err := chatCompletionMessagesWithReplay(spec, project, p.ContinuityKind(), false)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	mode := "disabled"
	if thinking {
		mode = "enabled"
		// Historical tool calls still require replay in later user turns without tools.
		for _, m := range messages {
			if m["role"] == "assistant" && m["tool_calls"] != nil && m["reasoning_content"] == nil {
				return textbehavior.SerializedRequest{}, nativeReasoningReplayInvalid()
			}
		}
	}
	body := map[string]any{"model": p.model, "messages": messages, "stream": stream, "thinking": map[string]string{"type": mode}}
	if len(spec.GetTools()) > 0 {
		if err := deepseekChatTools(body, spec); err != nil {
			return textbehavior.SerializedRequest{}, err
		}
	}
	if spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT {
		body["response_format"] = map[string]string{"type": "json_object"}
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
	// Usage is returned on chunks; no undocumented include_usage request flag.
	payload, err := json.Marshal(body)
	if len(payload) > mimoMaxRequestBytes {
		return textbehavior.SerializedRequest{}, deepseekJSONInputError("MiMo request exceeds 48 MiB")
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, err
}

func (p MimoTextBehavior) PlanMaterialization(ctx context.Context, spec *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	serializer := func(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
		return p.serialize(s, stream, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, spec, serializer, stream)
	wire, err := serializer(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(mimoMaxRequestBytes, int64(len(wire.Payload)))
	return prepared, budget, err
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

func (p MimoTextBehavior) Parse(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	thinking, err := p.validate(spec)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if err := mimoChatTruncation(payload); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if thinking {
		return parseReasoningChatResponse(payload, spec, p.ContinuityKind())
	}
	if len(spec.GetTools()) > 0 {
		return parseDeepseekToolResponse(payload, spec)
	}
	return parseChatTextResponse(payload, spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT)
}

type mimoStream struct {
	textbehavior.StreamFragmentAssembler
}

func (s *mimoStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	if err := mimoChatTruncation(payload); err != nil {
		return nil, err
	}
	return s.StreamFragmentAssembler.Append(payload)
}
func (p MimoTextBehavior) Stream(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	thinking, err := p.validate(spec)
	if err != nil {
		return nil, err
	}
	var inner textbehavior.StreamFragmentAssembler
	if thinking {
		inner = newReasoningChatStream(spec, p.ContinuityKind())
	} else if len(spec.GetTools()) > 0 {
		inner = newDeepseekToolStream(spec)
	} else {
		inner = &deepseekJSONStream{plainText: spec.GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
	}
	return &mimoStream{StreamFragmentAssembler: inner}, nil
}
