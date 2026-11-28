package ai

import (
	"slices"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r121
func projectCloudTextBehaviors(
	registrations []textBehaviorAdapterRegistration,
	facts textBehaviorAdapterResolutionFacts,
	targetReady bool,
) []*runtimev1.TextBehaviorCapabilityProjection {
	if !validTextBehaviorResolutionFacts(facts) {
		return nil
	}
	matches := 0
	var toolUse *runtimev1.ToolUseCapabilityProjection
	var supportsReasoning, supportsStructuredOutput bool
	for _, registration := range registrations {
		if !validTextBehaviorAdapterRegistration(registration) || !textBehaviorAdapterMatchesFacts(registration, facts) {
			continue
		}
		matches++
		support := registration.Support
		if tools := projectAdapterToolUseCapability(support); tools != nil {
			toolUse = tools
		}
		supportsReasoning = supportsReasoning || (support.Reasoning != nil &&
			hasCombinationBehavior(support.Combinations, func(c textBehaviorCombination) bool { return c.Reasoning }))
		supportsStructuredOutput = supportsStructuredOutput || (support.StructuredOutput != nil &&
			hasCombinationBehavior(support.Combinations, func(c textBehaviorCombination) bool { return c.StructuredOutput }))
	}
	result := []*runtimev1.TextBehaviorCapabilityProjection{
		{Kind: runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_TOOL_USE, ImplementationSupported: toolUse != nil},
		{Kind: runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_REASONING, ImplementationSupported: supportsReasoning},
		{Kind: runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_STRUCTURED_OUTPUT, ImplementationSupported: supportsStructuredOutput},
	}
	if matches == 1 {
		result[0].ImplementationToolUse = toolUse
		if targetReady && toolUse != nil {
			result[0].ConfiguredToolUse = proto.Clone(toolUse).(*runtimev1.ToolUseCapabilityProjection)
		}
	}
	for _, behavior := range result {
		switch {
		case !targetReady || !behavior.ImplementationSupported:
			behavior.ConfigurationState = runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_UNAVAILABLE
			behavior.Reasons = []runtimev1.LocalCapabilityReason{runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_TEXT_BEHAVIOR_UNAVAILABLE}
		case matches > 1:
			behavior.ConfigurationState = runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_AMBIGUOUS
			behavior.Reasons = []runtimev1.LocalCapabilityReason{runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_TEXT_BEHAVIOR_AMBIGUOUS}
		default:
			behavior.ConfigurationState = runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_CONFIGURED
		}
	}
	return result
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r121
func projectStructuredOutput(adapter *textBehaviorAdapterRegistration) *runtimev1.StructuredOutputCapabilityProjection {
	if adapter == nil {
		return nil
	}
	projection := &runtimev1.StructuredOutputCapabilityProjection{}
	formats := adapter.Support.StructuredOutput
	if formats == nil {
		return projection
	}
	var sync, stream bool
	for _, combination := range adapter.Support.Combinations {
		if combination.StructuredOutput {
			sync = sync || slices.Contains(combination.Modes, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC)
			stream = stream || slices.Contains(combination.Modes, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM)
		}
	}
	for _, kind := range formats.Kinds {
		switch kind {
		case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT:
			projection.JsonObjectSync, projection.JsonObjectStream = sync, stream
		case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA:
			projection.StrictJsonSchemaSync = sync && formats.SupportsStrictJSONSchema
			projection.StrictJsonSchemaStream = stream && formats.SupportsStrictJSONSchema
		}
	}
	return projection
}

func projectAdapterToolUseCapability(support textBehaviorSupport) *runtimev1.ToolUseCapabilityProjection {
	if support.ToolUse == nil {
		return nil
	}
	supportsSync := false
	supportsStream := false
	for _, combination := range support.Combinations {
		if !combination.ToolUse {
			continue
		}
		for _, mode := range combination.Modes {
			if mode == runtimev1.ExecutionMode_EXECUTION_MODE_SYNC {
				supportsSync = true
			}
			if mode == runtimev1.ExecutionMode_EXECUTION_MODE_STREAM {
				supportsStream = true
			}
		}
	}
	if !supportsSync && !supportsStream {
		return nil
	}
	return &runtimev1.ToolUseCapabilityProjection{
		SupportedToolSpecKinds:        append([]runtimev1.ToolSpecKind(nil), support.ToolUse.SpecKinds...),
		SupportedToolChoiceModes:      append([]runtimev1.ToolChoiceMode(nil), support.ToolUse.ChoiceModes...),
		SupportsSingleCall:            support.ToolUse.SingleCall,
		SupportsMultipleCalls:         support.ToolUse.MultipleCalls,
		SupportsParallelCalls:         support.ToolUse.ParallelCalls,
		SupportsSync:                  supportsSync,
		SupportsStream:                supportsStream,
		SupportsToolOnlyResponse:      support.ToolUse.ToolOnlyResponse,
		SupportsToolResultRoundTrip:   support.ToolUse.ToolResultRoundTrip,
		SupportsMixedTextAndToolCalls: support.ToolUse.MixedTextAndCall,
	}
}

func hasCombinationBehavior(combinations []textBehaviorCombination, predicate func(textBehaviorCombination) bool) bool {
	for _, combination := range combinations {
		if predicate(combination) && len(combination.Modes) > 0 {
			return true
		}
	}
	return false
}
