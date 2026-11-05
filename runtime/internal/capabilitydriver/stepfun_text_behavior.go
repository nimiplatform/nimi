package capabilitydriver

import (
	"context"
	"encoding/json"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

const stepfunRequestBytes = 48 << 20

type StepFunTextBehavior struct {
	model  string
	vision bool
}

func NewStepFunTextBehavior(model string) (StepFunTextBehavior, error) {
	switch model {
	case "step-5-preview", "step-3.7-flash":
		return StepFunTextBehavior{model: model, vision: true}, nil
	case "step-3.5-flash-2603":
		return StepFunTextBehavior{model: model}, nil
	default:
		return StepFunTextBehavior{}, deepseekUnsupported()
	}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.stepfun-current-text
func (p StepFunTextBehavior) validate(spec *runtimev1.TextGenerateScenarioSpec) (string, error) {
	if p.model == "" || spec == nil || spec.GetIncludeRawChunks() || spec.TopK != nil || spec.Seed != nil || spec.PresencePenalty != nil {
		return "", deepseekUnsupported()
	}
	if spec.GetToolChoiceName() != "" || spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO || len(spec.GetTools()) == 0 && spec.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO {
		return "", deepseekUnsupported()
	}
	if len(spec.GetTools()) > 128 {
		return "", deepseekJSONInputError("StepFun accepts at most 128 tools")
	}
	for _, tool := range spec.GetTools() {
		if tool.GetInputSchema() != nil && tool.GetInputSchema().AsMap()["type"] != "object" {
			return "", deepseekJSONInputError("StepFun tool parameter root must be object")
		}
	}
	f := spec.GetResponseFormat()
	switch f.GetKind() {
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT:
		if f.GetStrict() || f.GetJsonSchema() != nil || f.GetSchemaName() != "" || f.GetSchemaDescription() != "" {
			return "", deepseekUnsupported()
		}
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA:
		if !f.GetStrict() || f.GetJsonSchema() == nil || f.GetSchemaDescription() != "" {
			return "", deepseekUnsupported()
		}
		if _, err := textbehavior.CompileJSONSchema(f.GetJsonSchema().AsMap()); err != nil {
			return "", deepseekJSONInputError("StepFun JSON schema")
		}
	default:
		return "", deepseekUnsupported()
	}
	if len(spec.GetTools()) > 0 && f.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED && f.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT {
		return "", deepseekUnsupported()
	}
	if spec.Temperature != nil && !(spec.GetTemperature() >= 0 && spec.GetTemperature() <= 2) || spec.TopP != nil && !(spec.GetTopP() > 0 && spec.GetTopP() <= 1) || spec.FrequencyPenalty != nil && !(spec.GetFrequencyPenalty() >= 0 && spec.GetFrequencyPenalty() <= 1) || spec.MaxTokens != nil && (spec.GetMaxTokens() < 1) {
		return "", deepseekJSONInputError("StepFun generation bounds")
	}
	r := spec.GetReasoning()
	if r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
		return "", deepseekUnsupported()
	}
	if r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED && r.GetIntensity() == nil {
		return "", nil
	}
	if r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED {
		if _, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_Effort); ok {
			switch r.GetEffort() {
			case runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT:
				return "", nil
			case runtimev1.ReasoningEffort_REASONING_EFFORT_LOW:
				return "low", nil
			case runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH:
				return "high", nil
			case runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM:
				if p.vision {
					return "medium", nil
				}
			}
		}
	}
	return "", deepseekUnsupported()
}

func (p StepFunTextBehavior) Serialize(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	return p.serialize(spec, stream, false)
}
func (p StepFunTextBehavior) serialize(spec *runtimev1.TextGenerateScenarioSpec, stream, planning bool) (textbehavior.SerializedRequest, error) {
	effort, err := p.validate(spec)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	images, videos := 0, 0
	project := func(m *runtimev1.ChatMessage) (any, error) { return p.messageContent(m, planning, &images, &videos) }
	// The reviewed native assistant schema has no reasoning replay field.
	// Hidden output reasoning is not invented as a replay carrier or summary.
	messages, err := chatCompletionMessages(spec, project, "")
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	body := map[string]any{"model": p.model, "messages": messages, "stream": stream, "reasoning_format": "general"}
	if effort != "" {
		body["reasoning_effort"] = effort
	}
	if len(spec.GetTools()) > 0 {
		if err := deepseekChatTools(body, spec); err != nil {
			return textbehavior.SerializedRequest{}, err
		}
		delete(body, "tool_choice")
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
		body["response_format"] = map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": name, "strict": true, "schema": f.GetJsonSchema().AsMap()}}
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
	if spec.FrequencyPenalty != nil {
		body["frequency_penalty"] = spec.GetFrequencyPenalty()
	}
	if len(spec.GetStop()) > 0 {
		body["stop"] = spec.GetStop()
	}
	payload, err := json.Marshal(body)
	if len(payload) > stepfunRequestBytes {
		return textbehavior.SerializedRequest{}, deepseekJSONInputError("StepFun request exceeds 48 MiB")
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, err
}

func (p StepFunTextBehavior) PlanMaterialization(ctx context.Context, spec *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	serializer := func(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
		return p.serialize(s, stream, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, spec, serializer, stream)
	wire, err := serializer(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(stepfunRequestBytes, int64(len(wire.Payload)))
	return prepared, budget, err
}

func (p StepFunTextBehavior) Parse(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if _, err := p.validate(spec); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	hasCalls := false
	clean, err := stepfunHiddenReasoning(payload, &hasCalls)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if len(spec.GetTools()) > 0 {
		return parseDeepseekToolResponse(clean, spec)
	}
	if spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
		return parseStrictChatJSONSchema(clean, spec)
	}
	return parseChatTextResponse(clean, spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT)
}

func (p StepFunTextBehavior) Stream(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	if _, err := p.validate(spec); err != nil {
		return nil, err
	}
	var inner textbehavior.StreamFragmentAssembler
	if len(spec.GetTools()) > 0 {
		inner = newDeepseekToolStream(spec)
	} else {
		inner = &deepseekJSONStream{plainText: spec.GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
		if spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
			inner = &strictChatSchemaStream{StreamFragmentAssembler: inner, spec: spec}
		}
	}
	return &stepfunTextStream{StreamFragmentAssembler: inner}, nil
}
