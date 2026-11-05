package capabilitydriver

import (
	"context"
	"encoding/json"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

const mistralRequestBytes = 48 << 20

type MistralTextBehavior struct {
	model string
	large bool
}

func NewMistralTextBehavior(model string) (MistralTextBehavior, error) {
	switch model {
	case "mistral-large-4", "mistral-large-4-0":
		return MistralTextBehavior{model: model, large: true}, nil
	case "mistral-small-2603":
		return MistralTextBehavior{model: model}, nil
	default:
		return MistralTextBehavior{}, deepseekUnsupported()
	}
}

func (p MistralTextBehavior) ContinuityKind() string {
	return "mistral.chat.native-thinking-replay." + p.model
}

// @nimi-authority: rule.nimi.runtime.ai-provider.mistral-native-text
func (p MistralTextBehavior) validate(spec *runtimev1.TextGenerateScenarioSpec) (string, error) {
	if p.model == "" || spec == nil || spec.GetIncludeRawChunks() {
		return "", deepseekUnsupported()
	}
	if len(spec.GetTools()) == 0 && (spec.GetToolChoiceName() != "" || spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE) {
		return "", deepseekUnsupported()
	}
	f := spec.GetResponseFormat()
	switch f.GetKind() {
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT:
		if f.GetStrict() || f.GetJsonSchema() != nil || f.GetSchemaName() != "" || f.GetSchemaDescription() != "" {
			return "", deepseekUnsupported()
		}
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA:
		if !f.GetStrict() || f.GetJsonSchema() == nil {
			return "", deepseekUnsupported()
		}
		if _, err := textbehavior.CompileJSONSchema(f.GetJsonSchema().AsMap()); err != nil {
			return "", deepseekJSONInputError("Mistral JSON schema")
		}
	default:
		return "", deepseekUnsupported()
	}
	if len(spec.GetTools()) > 0 && f.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED && f.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT {
		return "", deepseekUnsupported()
	}
	if spec.Temperature != nil && !(spec.GetTemperature() >= 0 && spec.GetTemperature() <= 1.5) || spec.TopP != nil && !(spec.GetTopP() > 0 && spec.GetTopP() <= 1) || spec.TopK != nil && spec.GetTopK() < -1 || spec.Seed != nil && spec.GetSeed() < 0 || spec.MaxTokens != nil && spec.GetMaxTokens() <= 0 || spec.PresencePenalty != nil && !(spec.GetPresencePenalty() >= -2 && spec.GetPresencePenalty() <= 2) || spec.FrequencyPenalty != nil && !(spec.GetFrequencyPenalty() >= -2 && spec.GetFrequencyPenalty() <= 2) {
		return "", deepseekJSONInputError("Mistral sampling bounds")
	}
	r := spec.GetReasoning()
	if r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
		return "", deepseekUnsupported()
	}
	switch r.GetActivation() {
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED:
		if r.GetIntensity() == nil {
			return "", nil
		}
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED:
		if !p.large && r.GetIntensity() == nil {
			return "none", nil
		}
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED:
		if _, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_Effort); ok {
			switch r.GetEffort() {
			case runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT:
				if p.large {
					return "", nil
				}
			case runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH:
				return "high", nil
			case runtimev1.ReasoningEffort_REASONING_EFFORT_LOW:
				if p.large {
					return "low", nil
				}
			case runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM:
				if p.large {
					return "medium", nil
				}
			}
		}
	}
	return "", deepseekUnsupported()
}

func (p MistralTextBehavior) Serialize(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	return p.serialize(spec, stream, false)
}

func (p MistralTextBehavior) serialize(spec *runtimev1.TextGenerateScenarioSpec, stream, planning bool) (textbehavior.SerializedRequest, error) {
	effort, err := p.validate(spec)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	images := 0
	project := func(m *runtimev1.ChatMessage) (any, error) { return mistralMessageContent(m, planning, &images) }
	messages, err := chatCompletionMessagesWithReplay(spec, project, p.ContinuityKind(), false)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	for _, message := range messages {
		if raw, present := message["reasoning_content"]; present {
			encoded, ok := raw.(string)
			if !ok {
				return textbehavior.SerializedRequest{}, nativeReasoningReplayInvalid()
			}
			chunks, err := readMistralThinking([]byte(encoded))
			if err != nil {
				return textbehavior.SerializedRequest{}, err
			}
			if answer, ok := message["content"].(string); ok && answer != "" {
				chunks = append(chunks, map[string]any{"type": "text", "text": answer})
			}
			message["content"] = chunks
			delete(message, "reasoning_content")
		}
	}
	body := map[string]any{"model": p.model, "messages": messages, "stream": stream}
	if effort != "" {
		body["reasoning_effort"] = effort
	}
	if len(spec.GetTools()) > 0 {
		if err := deepseekChatTools(body, spec); err != nil {
			return textbehavior.SerializedRequest{}, err
		}
		if spec.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED {
			body["tool_choice"] = "any"
		}
	}
	f := spec.GetResponseFormat()
	if f.GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT {
		body["response_format"] = map[string]any{"type": "json_object"}
	}
	if f.GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
		name := f.GetSchemaName()
		if name == "" {
			name = "nimi_response"
		}
		wrapper := map[string]any{"name": name, "schema": f.GetJsonSchema().AsMap(), "strict": true}
		if f.GetSchemaDescription() != "" {
			wrapper["description"] = f.GetSchemaDescription()
		}
		body["response_format"] = map[string]any{"type": "json_schema", "json_schema": wrapper}
	}
	if spec.MaxTokens != nil {
		body["max_tokens"] = spec.GetMaxTokens()
	}
	if spec.Temperature != nil {
		body["temperature"] = spec.GetTemperature()
	}
	if spec.TopP != nil {
		body["top_p"] = spec.GetTopP()
	}
	if spec.TopK != nil {
		body["top_k"] = spec.GetTopK()
	}
	if spec.Seed != nil {
		body["random_seed"] = spec.GetSeed()
	}
	if spec.PresencePenalty != nil {
		body["presence_penalty"] = spec.GetPresencePenalty()
	}
	if spec.FrequencyPenalty != nil {
		body["frequency_penalty"] = spec.GetFrequencyPenalty()
	}
	if len(spec.GetStop()) > 0 {
		body["stop"] = spec.GetStop()
	}
	payload, err := json.Marshal(body)
	if len(payload) > mistralRequestBytes {
		return textbehavior.SerializedRequest{}, deepseekJSONInputError("Mistral request exceeds 48 MiB")
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, err
}

func (p MistralTextBehavior) PlanMaterialization(ctx context.Context, spec *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	serializer := func(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
		return p.serialize(s, stream, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, spec, serializer, stream)
	wire, err := serializer(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(mistralRequestBytes, int64(len(wire.Payload)))
	return prepared, budget, err
}

func (p MistralTextBehavior) Parse(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if _, err := p.validate(spec); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	state := &mistralThinkingState{}
	clean, _, err := state.transform(payload, false)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if spec.GetReasoning().GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED && len(state.chunks) > 0 {
		return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
	}
	var result textbehavior.NormalizedResult
	if len(spec.GetTools()) > 0 {
		result, err = parseDeepseekToolResponse(clean, spec)
	} else if spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
		result, err = parseStrictChatJSONSchema(clean, spec)
	} else {
		result, err = parseChatTextResponse(clean, spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT)
	}
	if err != nil {
		return result, err
	}
	carrier, err := state.carrier(p.ContinuityKind())
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if carrier != nil {
		result.Items = append([]textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemReasoningContinuity, ReasoningContinuity: carrier}}, result.Items...)
	}
	return result, nil
}

func (p MistralTextBehavior) Stream(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	if _, err := p.validate(spec); err != nil {
		return nil, err
	}
	var inner textbehavior.StreamFragmentAssembler
	if len(spec.GetTools()) > 0 {
		inner = newDeepseekToolStream(spec)
	} else {
		inner = &deepseekJSONStream{plainText: spec.GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
	}
	return &mistralTextStream{profile: p, spec: spec, inner: inner}, nil
}

func mistralIsDONE(payload []byte) bool { return strings.TrimSpace(string(payload)) == "[DONE]" }
