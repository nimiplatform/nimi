package capabilitydriver

import (
	"encoding/json"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

const BedrockClaudeInvokeProtocol = "bedrock/claude-invoke-v1"

type BedrockClaudeBehavior struct {
	model   string
	profile anthropicMessagesProfile
}

func NewBedrockClaudeBehavior(model string) (BedrockClaudeBehavior, error) {
	switch model {
	case "anthropic.claude-haiku-5-5", "anthropic.claude-sonnet-5-5", "anthropic.claude-opus-5-5", "anthropic.claude-fable-5-1":
	default:
		return BedrockClaudeBehavior{}, anthropicBehaviorUnsupported("unreviewed Bedrock Claude model")
	}
	p := BedrockClaudeBehavior{model: model}
	p.profile = anthropicMessagesProfile{continuityKind: "bedrock.invoke.thinking." + model, adaptiveThinking: true, defaultMaxTokens: 16384, forcedToolChoice: model == "anthropic.claude-haiku-5-5", rejectAssistantPrefill: true, reasoningControls: p.reasoning}
	return p, nil
}

func (p BedrockClaudeBehavior) ContinuityKind() string { return p.profile.continuityKind }

// @nimi-authority: rule.nimi.runtime.ai-provider.bedrock-native-routing
// @nimi-authority: rule.nimi.runtime.ai-provider.bedrock-current-text
func (p BedrockClaudeBehavior) Serialize(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	if p.model == "" || spec.GetMaxTokens() > 128000 {
		return textbehavior.SerializedRequest{}, anthropicBehaviorUnsupported("Bedrock model or output limit")
	}
	// Every admitted source remains owner-authorized; this exact Bedrock path
	// uses inline image bytes, not provider-fetched URLs or file handles.
	images := 0
	for _, message := range spec.GetInput() {
		for _, part := range message.GetParts() {
			if part.GetImageUrl() != nil {
				images++
				if images > 20 || part.GetImageUrl().GetDetail() != "" {
					return textbehavior.SerializedRequest{}, anthropicBehaviorUnsupported("Bedrock image count or detail")
				}
				if _, _, err := bedrockInlineImage(part.GetImageUrl().GetUrl(), 3_750_000); err != nil {
					return textbehavior.SerializedRequest{}, err
				}
			}
		}
	}
	value, err := serializeAnthropicRequest(&p.profile, spec, stream)
	if err != nil {
		return value, err
	}
	var body map[string]any
	if err = json.Unmarshal(value.Payload, &body); err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	delete(body, "stream")
	body["anthropic_version"] = "bedrock-2023-05-31"
	value.Payload, err = json.Marshal(body)
	if len(value.Payload) > 25_000_000 {
		return textbehavior.SerializedRequest{}, anthropicBehaviorInput("Bedrock request size")
	}
	value.Protocol = BedrockClaudeInvokeProtocol
	return value, err
}

func (p BedrockClaudeBehavior) Parse(data []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	return parseAnthropicMessage(&p.profile, data, spec)
}
func (p BedrockClaudeBehavior) Stream(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	return newAnthropicBehaviorStream(&p.profile, spec), nil
}

func (p BedrockClaudeBehavior) reasoning(body map[string]any, c *runtimev1.ReasoningConfig) error {
	if c == nil {
		return nil
	}
	if c.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && c.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
		return anthropicBehaviorUnsupported("Bedrock Claude reasoning presentation")
	}
	switch c.GetActivation() {
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED:
		if c.GetIntensity() != nil {
			return anthropicBehaviorUnsupported("reasoning intensity without activation")
		}
		return nil
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED:
		if p.model != "anthropic.claude-haiku-5-5" || c.GetIntensity() != nil {
			return anthropicBehaviorUnsupported("Bedrock Claude disabled thinking")
		}
		body["thinking"] = map[string]any{"type": "disabled"}
		return nil
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE:
	default:
		return anthropicBehaviorUnsupported("Bedrock Claude reasoning activation")
	}
	if c.GetIntensity() == nil {
		return nil
	}
	if _, ok := c.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok {
		return anthropicBehaviorUnsupported("Bedrock Claude token budget")
	}
	efforts := map[runtimev1.ReasoningEffort]string{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW: "low", runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM: "medium", runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH: "high", runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH: "xhigh", runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM: "max"}
	effort, ok := efforts[c.GetEffort()]
	if !ok {
		return anthropicBehaviorUnsupported("Bedrock Claude effort")
	}
	body["output_config"] = map[string]any{"effort": effort}
	return nil
}
