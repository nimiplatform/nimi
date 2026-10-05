package ai

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
// Primitive controls come from the unique selected adapter. They are not
// promises about combinations, positive token usage, or other model targets.
func projectReasoningInput(registrations []textBehaviorAdapterRegistration, facts textBehaviorAdapterResolutionFacts) *runtimev1.ReasoningInputCapabilities {
	if !validTextBehaviorResolutionFacts(facts) {
		return nil
	}
	var match *textBehaviorAdapterRegistration
	for i := range registrations {
		registration := &registrations[i]
		if validTextBehaviorAdapterRegistration(*registration) && textBehaviorAdapterMatchesFacts(*registration, facts) {
			if match != nil {
				return nil
			}
			match = registration
		}
	}
	if match == nil {
		return nil
	}
	result := &runtimev1.ReasoningInputCapabilities{FollowsModelDefault: true}
	if support := match.Support.Reasoning; support != nil {
		for _, activation := range support.Activations {
			switch activation {
			case runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED:
				result.SupportsDisabled = true
			case runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED:
				result.SupportsRequired = true
			case runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE:
				result.SupportsAdaptive = true
			}
		}
		for _, effort := range support.Efforts {
			result.Efforts = append(result.Efforts, map[runtimev1.ReasoningEffort]string{
				runtimev1.ReasoningEffort_REASONING_EFFORT_MINIMAL: "minimal",
				runtimev1.ReasoningEffort_REASONING_EFFORT_LOW:     "low",
				runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM:  "medium",
				runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH:    "high",
				runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH:   "xhigh",
				runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM: "maximum",
			}[effort])
		}
		result.SupportsBudget = support.ExactBudget
		for _, presentation := range support.Presentations {
			if presentation == runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
				result.Presentations = append(result.Presentations, "hidden")
			} else if presentation == runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY {
				result.Presentations = append(result.Presentations, "summary")
			}
		}
	}
	return result
}
