package capabilitydriver

import (
	"context"
	"encoding/json"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
)

type DeepseekTextBehavior struct{ model string }

func NewDeepseekTextBehavior(model string) (DeepseekTextBehavior, error) {
	switch model {
	case "deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro":
		return DeepseekTextBehavior{model: model}, nil
	default:
		return DeepseekTextBehavior{}, deepseekUnsupported()
	}
}

func (p DeepseekTextBehavior) ContinuityKind() string {
	return "deepseek.chat.native-reasoning-replay." + p.model
}

// @nimi-authority: rule.nimi.runtime.ai-provider.deepseek-v4-json-output
func (p DeepseekTextBehavior) validate(spec *runtimev1.TextGenerateScenarioSpec) (bool, string, error) {
	if p.model == "" {
		return false, "", deepseekUnsupported()
	}
	if err := validateChatFunctionSpec(spec, true); err != nil {
		return false, "", err
	}
	if spec.GetIncludeRawChunks() || spec.PresencePenalty != nil || spec.FrequencyPenalty != nil {
		return false, "", deepseekUnsupported()
	}
	if spec.MaxTokens != nil && (spec.GetMaxTokens() <= 0 || spec.GetMaxTokens() > 393216) || len(spec.GetStop()) > 16 {
		return false, "", deepseekJSONInputError("DeepSeek output/stop bounds")
	}
	r := spec.GetReasoning()
	thinking := false
	effort := ""
	if r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
		return false, "", deepseekUnsupported()
	}
	switch r.GetActivation() {
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED, runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED:
		if r.GetIntensity() != nil {
			return false, "", deepseekUnsupported()
		}
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED:
		thinking = true
		if _, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok {
			return false, "", deepseekUnsupported()
		}
		switch r.GetEffort() {
		case runtimev1.ReasoningEffort_REASONING_EFFORT_LOW:
			effort = "low"
		case runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH:
			effort = "high"
		case runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM:
			effort = "max"
		default:
			return false, "", deepseekUnsupported()
		}
	default:
		return false, "", deepseekUnsupported()
	}
	if thinking && spec.Temperature != nil {
		return false, "", deepseekUnsupported()
	}
	if spec.TopP != nil {
		if thinking {
			if p.model == "deepseek-v4-pro" || !(spec.GetTopP() >= .95 && spec.GetTopP() <= 1) {
				return false, "", deepseekUnsupported()
			}
		} else if p.model != "deepseek-v4-pro" && spec.GetTopP() != 1 {
			return false, "", deepseekUnsupported()
		}
		if !(spec.GetTopP() > 0 && spec.GetTopP() <= 1) {
			return false, "", deepseekJSONInputError("DeepSeek top_p range")
		}
	}
	return thinking, effort, nil
}

func (p DeepseekTextBehavior) Serialize(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	return p.serialize(spec, stream, false)
}

func (p DeepseekTextBehavior) serialize(spec *runtimev1.TextGenerateScenarioSpec, stream, planning bool) (textbehavior.SerializedRequest, error) {
	thinking, effort, err := p.validate(spec)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	kind := ""
	if thinking {
		kind = p.ContinuityKind()
	}
	var messages []map[string]any
	if p.model == "deepseek-flash" {
		messages, err = deepseekFlashMessages(spec, planning, kind)
	} else {
		messages, err = chatCompletionMessages(spec, nil, kind)
	}
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	wire, err := deepseekChatSerializeMessages(spec, stream, messages, thinking, effort)
	if err != nil {
		return wire, err
	}
	var body map[string]any
	if err = json.Unmarshal(wire.Payload, &body); err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	body["model"] = p.model
	wire.Payload, err = json.Marshal(body)
	if len(wire.Payload) > DeepseekFlashMaxRequestBytes {
		return textbehavior.SerializedRequest{}, deepseekJSONInputError("48 MiB native request limit")
	}
	return wire, err
}

func (p DeepseekTextBehavior) PlanMaterialization(ctx context.Context, spec *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	serializer := func(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
		return p.serialize(s, stream, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, spec, serializer, stream)
	prepared = proto.Clone(prepared).(*runtimev1.TextGenerateScenarioSpec)
	wire, err := serializer(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(DeepseekFlashMaxRequestBytes, int64(len(wire.Payload)))
	return prepared, budget, err
}

func (p DeepseekTextBehavior) Parse(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	thinking, _, err := p.validate(spec)
	if err != nil {
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

func (p DeepseekTextBehavior) Stream(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	thinking, _, err := p.validate(spec)
	if err != nil {
		return nil, err
	}
	if thinking {
		return newReasoningChatStream(spec, p.ContinuityKind()), nil
	}
	if len(spec.GetTools()) > 0 {
		return newDeepseekToolStream(spec), nil
	}
	return &deepseekJSONStream{plainText: spec.GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}, nil
}
