package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestPublicChatReasoningContractUsesTypedAlgebra(t *testing.T) {
	if normalizePublicChatReasoning(nil) != nil || toProtoReasoningConfig(nil) != nil {
		t.Fatal("omitted public chat reasoning must remain omitted for Runtime defaults")
	}

	tests := []struct {
		name             string
		input            *publicChatReasoningPayload
		wantActivation   runtimev1.ReasoningActivation
		wantPresentation runtimev1.ReasoningPresentation
		wantEffort       runtimev1.ReasoningEffort
		wantBudget       uint32
	}{
		{
			name:             "disabled defaults hidden without intensity",
			input:            &publicChatReasoningPayload{Activation: "disabled"},
			wantActivation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED,
			wantPresentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN,
		},
		{
			name: "adaptive summary with effort",
			input: &publicChatReasoningPayload{
				Activation: "adaptive", Presentation: "summary", Effort: "high",
			},
			wantActivation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE,
			wantPresentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY,
			wantEffort:       runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH,
		},
		{
			name: "required hidden with exact budget",
			input: &publicChatReasoningPayload{
				Activation: "required", Presentation: "hidden", ExactBudgetTokens: 256,
			},
			wantActivation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
			wantPresentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN,
			wantBudget:       256,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validatePublicChatReasoningPayload(test.input); err != nil {
				t.Fatalf("validate reasoning: %v", err)
			}
			config := toProtoReasoningConfig(normalizePublicChatReasoning(test.input))
			if config.GetActivation() != test.wantActivation || config.GetPresentation() != test.wantPresentation ||
				config.GetEffort() != test.wantEffort || config.GetExactBudgetTokens() != test.wantBudget {
				t.Fatalf("typed reasoning config = %+v", config)
			}
			switch {
			case test.wantEffort != runtimev1.ReasoningEffort_REASONING_EFFORT_UNSPECIFIED:
				if _, ok := config.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok {
					t.Fatalf("effort was not encoded as the intensity oneof: %+v", config)
				}
			case test.wantBudget > 0:
				if _, ok := config.GetIntensity().(*runtimev1.ReasoningConfig_ExactBudgetTokens); !ok {
					t.Fatalf("exact budget was not encoded as the intensity oneof: %+v", config)
				}
			default:
				if config.GetIntensity() != nil {
					t.Fatalf("disabled reasoning carried intensity: %+v", config)
				}
			}
		})
	}
}

func TestPublicChatReasoningContractRejectsInvalidAndRetiredShapes(t *testing.T) {
	invalid := []struct {
		name  string
		input *publicChatReasoningPayload
	}{
		{name: "missing activation", input: &publicChatReasoningPayload{}},
		{name: "retired activation token", input: &publicChatReasoningPayload{Activation: "on", Effort: "low"}},
		{name: "disabled summary", input: &publicChatReasoningPayload{Activation: "disabled", Presentation: "summary"}},
		{name: "disabled intensity", input: &publicChatReasoningPayload{Activation: "disabled", Effort: "low"}},
		{name: "adaptive missing intensity", input: &publicChatReasoningPayload{Activation: "adaptive"}},
		{name: "required both intensities", input: &publicChatReasoningPayload{Activation: "required", Effort: "medium", ExactBudgetTokens: 64}},
		{name: "unknown presentation", input: &publicChatReasoningPayload{Activation: "required", Presentation: "raw", Effort: "low"}},
		{name: "unknown effort", input: &publicChatReasoningPayload{Activation: "adaptive", Effort: "extreme"}},
	}
	for _, test := range invalid {
		t.Run(test.name, func(t *testing.T) {
			if err := validatePublicChatReasoningPayload(test.input); status.Code(err) != codes.InvalidArgument {
				t.Fatalf("invalid reasoning error = %v", err)
			}
		})
	}

	_, err := decodePublicChatTurnRequestPayload(publicChatStructPayload(t, map[string]any{
		"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
		"owner_user_id":          "user-1",
		"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
		"conversation_anchor_id": "anchor-reasoning-hard-cut",
		"messages":               []any{map[string]any{"role": "user", "content": "hello"}},
		"reasoning": map[string]any{
			"mode": "on", "trace_mode": "separate", "budget_tokens": 128,
		},
	}))
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("retired reasoning payload shape was admitted: %v", err)
	}
}

func TestAIBackedPublicChatTurnExecutorCarriesTypedReasoningOneof(t *testing.T) {
	streamer := &capturePublicChatScenarioStreamer{}
	executor := NewAIBackedPublicChatTurnExecutor(streamer)
	err := executor.StreamChatTurn(context.Background(), &PublicChatTurnExecutionRequest{
		AppID:         "desktop.app",
		SubjectUserID: "user-1",
		Messages:      []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		Binding: publicChatExecutionBinding{
			ModelID: "local/default", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		},
		Reasoning: &publicChatReasoningConfig{
			Activation:        runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
			Presentation:      runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY,
			ExactBudgetTokens: 384,
		},
	}, nil)
	if err != nil {
		t.Fatalf("StreamChatTurn: %v", err)
	}
	reasoning := streamer.request.GetSpec().GetTextGenerate().GetReasoning()
	if reasoning.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED ||
		reasoning.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY ||
		reasoning.GetExactBudgetTokens() != 384 {
		t.Fatalf("executor reasoning = %+v", reasoning)
	}
	if _, ok := reasoning.GetIntensity().(*runtimev1.ReasoningConfig_ExactBudgetTokens); !ok {
		t.Fatalf("executor reasoning intensity is not exact budget oneof: %+v", reasoning)
	}
}
