package ai

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
)

type normalizedReasoningConfig struct {
	provided     bool
	mode         runtimev1.ReasoningMode
	traceMode    runtimev1.ReasoningTraceMode
	budgetTokens int32
}

func normalizeReasoningConfig(cfg *runtimev1.ReasoningConfig) normalizedReasoningConfig {
	normalized := normalizedReasoningConfig{
		mode:      runtimev1.ReasoningMode_REASONING_MODE_OFF,
		traceMode: runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_HIDE,
	}
	if cfg == nil {
		return normalized
	}
	normalized.provided = true
	switch cfg.GetMode() {
	case runtimev1.ReasoningMode_REASONING_MODE_ON:
		normalized.mode = runtimev1.ReasoningMode_REASONING_MODE_ON
	case runtimev1.ReasoningMode_REASONING_MODE_DEFAULT,
		runtimev1.ReasoningMode_REASONING_MODE_OFF:
		normalized.mode = runtimev1.ReasoningMode_REASONING_MODE_OFF
	default:
		normalized.mode = runtimev1.ReasoningMode_REASONING_MODE_OFF
	}
	switch cfg.GetTraceMode() {
	case runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_SEPARATE:
		normalized.traceMode = runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_SEPARATE
	case runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_HIDE,
		runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_UNSPECIFIED:
		normalized.traceMode = runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_HIDE
	default:
		normalized.traceMode = runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_HIDE
	}
	if cfg.GetBudgetTokens() > 0 {
		normalized.budgetTokens = cfg.GetBudgetTokens()
	}
	return normalized
}

func normalizeClonedReasoningConfig(spec *runtimev1.TextGenerateScenarioSpec) normalizedReasoningConfig {
	if spec == nil {
		return normalizeReasoningConfig(nil)
	}
	normalized := normalizeReasoningConfig(spec.GetReasoning())
	spec.Reasoning = &runtimev1.ReasoningConfig{
		Mode:         normalized.mode,
		TraceMode:    normalized.traceMode,
		BudgetTokens: normalized.budgetTokens,
	}
	return normalized
}

func validateReasoningConfig(spec *runtimev1.TextGenerateScenarioSpec) error {
	if spec == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	cfg := spec.GetReasoning()
	if cfg == nil {
		return nil
	}
	if cfg.GetBudgetTokens() < 0 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	normalized := normalizeReasoningConfig(cfg)
	if normalized.mode != runtimev1.ReasoningMode_REASONING_MODE_ON {
		if normalized.traceMode == runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_SEPARATE || normalized.budgetTokens > 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	}
	return nil
}

func requestedReasoningEnabled(spec *runtimev1.TextGenerateScenarioSpec) bool {
	return normalizeReasoningConfig(spec.GetReasoning()).mode == runtimev1.ReasoningMode_REASONING_MODE_ON
}

func requestedReasoningSeparate(spec *runtimev1.TextGenerateScenarioSpec) bool {
	return normalizeReasoningConfig(spec.GetReasoning()).traceMode == runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_SEPARATE
}

func reasoningCapabilityForRequest(modelResolved string, remoteTarget *nimillm.RemoteTarget, selected provider) nimillm.ReasoningCapability {
	providerType := inferScenarioProviderType(modelResolved, remoteTarget, selected, runtimev1.Modal_MODAL_TEXT)
	switch strings.ToLower(strings.TrimSpace(providerType)) {
	case "ollama":
		return nimillm.OllamaReasoningCapability()
	default:
		return nimillm.UnsupportedReasoningCapability()
	}
}

func validateReasoningRequest(
	spec *runtimev1.TextGenerateScenarioSpec,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
	executionMode runtimev1.ExecutionMode,
) error {
	if err := validateReasoningConfig(spec); err != nil {
		return err
	}
	normalized := normalizeReasoningConfig(spec.GetReasoning())
	if normalized.mode != runtimev1.ReasoningMode_REASONING_MODE_ON {
		return nil
	}
	capability := reasoningCapabilityForRequest(modelResolved, remoteTarget, selected)
	if !capability.SupportsModeToggle {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if normalized.traceMode == runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_SEPARATE {
		if executionMode != runtimev1.ExecutionMode_EXECUTION_MODE_STREAM || !capability.SupportsSeparateText || !capability.SupportsStreaming {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	}
	if normalized.budgetTokens > 0 && !capability.SupportsBudget {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return nil
}
