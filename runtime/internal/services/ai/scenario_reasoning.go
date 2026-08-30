package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
)

type reasoningIntensityKind uint8

const (
	reasoningIntensityNone reasoningIntensityKind = iota
	reasoningIntensityEffort
	reasoningIntensityBudget
)

type normalizedReasoningConfig struct {
	provided     bool
	activation   runtimev1.ReasoningActivation
	presentation runtimev1.ReasoningPresentation
	intensity    reasoningIntensityKind
	effort       runtimev1.ReasoningEffort
	budget       uint32
}

func normalizeReasoningConfig(cfg *runtimev1.ReasoningConfig) normalizedReasoningConfig {
	normalized := normalizedReasoningConfig{
		activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED,
		presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN,
	}
	if cfg == nil {
		return normalized
	}
	normalized.provided = true
	if activation := cfg.GetActivation(); activation != runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED {
		normalized.activation = activation
	}
	if presentation := cfg.GetPresentation(); presentation != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED {
		normalized.presentation = presentation
	}
	switch intensity := cfg.GetIntensity().(type) {
	case *runtimev1.ReasoningConfig_Effort:
		normalized.intensity = reasoningIntensityEffort
		normalized.effort = intensity.Effort
	case *runtimev1.ReasoningConfig_ExactBudgetTokens:
		normalized.intensity = reasoningIntensityBudget
		normalized.budget = intensity.ExactBudgetTokens
	}
	return normalized
}

func normalizeClonedReasoningConfig(spec *runtimev1.TextGenerateScenarioSpec) normalizedReasoningConfig {
	if spec == nil {
		return normalizeReasoningConfig(nil)
	}
	normalized := normalizeReasoningConfig(spec.GetReasoning())
	canonical := &runtimev1.ReasoningConfig{
		Activation:   normalized.activation,
		Presentation: normalized.presentation,
	}
	switch normalized.intensity {
	case reasoningIntensityEffort:
		canonical.Intensity = &runtimev1.ReasoningConfig_Effort{Effort: normalized.effort}
	case reasoningIntensityBudget:
		canonical.Intensity = &runtimev1.ReasoningConfig_ExactBudgetTokens{ExactBudgetTokens: normalized.budget}
	}
	spec.Reasoning = canonical
	return normalized
}

func validateReasoningConfig(spec *runtimev1.TextGenerateScenarioSpec) error {
	if spec == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	normalized := normalizeReasoningConfig(spec.GetReasoning())
	switch normalized.presentation {
	case runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN,
		runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY:
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	switch normalized.activation {
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED:
		if normalized.presentation != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN || normalized.intensity != reasoningIntensityNone {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE,
		runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED:
		if normalized.intensity == reasoningIntensityNone {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		if normalized.intensity == reasoningIntensityEffort {
			switch normalized.effort {
			case runtimev1.ReasoningEffort_REASONING_EFFORT_MINIMAL,
				runtimev1.ReasoningEffort_REASONING_EFFORT_LOW,
				runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM,
				runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH,
				runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM:
			default:
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
			}
		}
		if normalized.intensity == reasoningIntensityBudget && normalized.budget == 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return nil
}

func requestedReasoningEnabled(spec *runtimev1.TextGenerateScenarioSpec) bool {
	if spec == nil {
		return false
	}
	return normalizeReasoningConfig(spec.GetReasoning()).activation != runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED
}

func validateReasoningRequest(
	spec *runtimev1.TextGenerateScenarioSpec,
	_ string,
	_ *nimillm.RemoteTarget,
	_ provider,
	_ runtimev1.ExecutionMode,
) error {
	return validateReasoningConfig(spec)
}
