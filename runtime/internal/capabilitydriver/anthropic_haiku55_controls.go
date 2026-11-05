package capabilitydriver

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

// @nimi-authority: rule.nimi.runtime.ai-provider.anthropic-haiku55-text-behaviors
func applyAnthropicHaiku55Reasoning(body map[string]any, config *runtimev1.ReasoningConfig) error {
	if config == nil {
		return nil
	}
	if config.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && config.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
		return anthropicBehaviorUnsupported("Haiku 5.5 reasoning presentation")
	}
	if config.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED && config.GetIntensity() == nil {
		return nil
	}
	if config.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE && config.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED {
		return anthropicBehaviorUnsupported("Haiku 5.5 reasoning activation")
	}
	if config.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED && config.GetIntensity() != nil {
		return anthropicBehaviorUnsupported("disabled reasoning with intensity")
	}
	if config.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE && config.GetIntensity() == nil {
		return anthropicBehaviorUnsupported("adaptive reasoning requires an exact effort")
	}
	if config.GetIntensity() != nil {
		if _, ok := config.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok {
			return anthropicBehaviorUnsupported("Haiku 5.5 token budget")
		}
		efforts := map[runtimev1.ReasoningEffort]string{
			runtimev1.ReasoningEffort_REASONING_EFFORT_LOW: "low", runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM: "medium", runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH: "high",
			runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH: "xhigh", runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM: "max",
		}
		effort, ok := efforts[config.GetEffort()]
		if !ok {
			return anthropicBehaviorUnsupported("Haiku 5.5 effort combination")
		}
		body["output_config"] = map[string]any{"effort": effort}
	}
	if config.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED {
		body["thinking"] = map[string]any{"type": "disabled"}
	}
	return nil
}
