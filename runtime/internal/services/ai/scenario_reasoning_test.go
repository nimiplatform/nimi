package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestReasoningValidationAndAdapterAdmissionStaySeparate(t *testing.T) {
	spec := &runtimev1.TextGenerateScenarioSpec{Reasoning: &runtimev1.ReasoningConfig{
		Activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
		Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY,
		Intensity: &runtimev1.ReasoningConfig_Effort{
			Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH,
		},
	}}
	if err := validateReasoningRequest(
		spec,
		"runtime-agent-live-e2e",
		nil,
		newStaticProvider(runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL),
		runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
	); err != nil {
		t.Fatalf("valid reasoning algebra = %v", err)
	}
	_, err := resolveTextBehaviorAdapter(
		nil,
		&runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.text", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai-chat/v1"},
		"openai", "model-a", runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, spec,
	)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("unregistered reasoning adapter error = %v", err)
	}
}

func TestReasoningValidationRejectsUnknownEnumsAsInputInvalid(t *testing.T) {
	tests := []struct {
		name string
		cfg  *runtimev1.ReasoningConfig
	}{
		{
			name: "activation",
			cfg: &runtimev1.ReasoningConfig{
				Activation: runtimev1.ReasoningActivation(99), Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN,
				Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_LOW},
			},
		},
		{
			name: "presentation",
			cfg: &runtimev1.ReasoningConfig{
				Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Presentation: runtimev1.ReasoningPresentation(99),
				Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_LOW},
			},
		},
		{
			name: "effort",
			cfg: &runtimev1.ReasoningConfig{
				Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE, Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN,
				Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort(99)},
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateReasoningConfig(&runtimev1.TextGenerateScenarioSpec{Reasoning: test.cfg})
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
				t.Fatalf("unknown %s error = %v reason=%v present=%v", test.name, err, reason, ok)
			}
		})
	}
}
