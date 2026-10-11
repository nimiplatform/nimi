package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestMimoToolsResolveOnlyReviewedTargetsAndModes(t *testing.T) {
	identity := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "mimo", DriverId: "nimillm", DriverDialect: "mimo"}
	for _, model := range []string{"mimo-v2.6-flash", "mimo-v2.6-pro"} {
		for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM} {
			spec := testTextBehaviorToolSpec()
			spec.ToolChoice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO
			adapter, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "mimo", model, mode, spec)
			if err != nil || adapter == nil || adapter.registration.Version != "1" {
				t.Fatalf("%s/%v: adapter=%v err=%v", model, mode, adapter, err)
			}
		}
	}
	for _, model := range []string{"mimo-v2.5", "mimo-v2.6-pro-ultraspeed", "other"} {
		if _, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "mimo", model, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, testTextBehaviorToolSpec()); err == nil {
			t.Fatalf("unreviewed target %q admitted", model)
		}
	}
	for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, runtimev1.ExecutionMode_EXECUTION_MODE_UNSPECIFIED} {
		if _, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "mimo", "mimo-v2.6-flash", mode, testTextBehaviorToolSpec()); err == nil {
			t.Fatal("unsupported mode admitted")
		}
	}
}

func TestMimoToolsRejectIgnoredChoicesAndOtherBehaviorCombinations(t *testing.T) {
	identity := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "mimo", DriverId: "nimillm", DriverDialect: "mimo"}
	for _, choice := range []runtimev1.ToolChoiceMode{runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL} {
		spec := testTextBehaviorToolSpec()
		spec.ToolChoice = choice
		if choice == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL {
			spec.ToolChoiceName = spec.Tools[0].Name
		}
		if _, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "mimo", "mimo-v2.6-flash", runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, spec); err == nil {
			t.Fatal("upstream-ignored tool choice admitted")
		}
	}
	for _, mutate := range []func(*runtimev1.TextGenerateScenarioSpec){
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.ResponseFormat = &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
		},
		func(s *runtimev1.TextGenerateScenarioSpec) {
			s.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED}
		},
	} {
		spec := testTextBehaviorToolSpec()
		mutate(spec)
		if _, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "mimo", "mimo-v2.6-flash", runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, spec); err == nil {
			t.Fatal("unsupported combination admitted")
		}
	}
}
