package ai

import (
	"encoding/json"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

// textBehaviorAdapterRegistration is the one Runtime-private, versioned
// adapter contract shared by Cloud and Local text targets. A registration is
// exact: neither catalog labels nor execution-time probes participate in
// matching. Production intentionally registers no adapter yet.
type textBehaviorAdapterRegistration struct {
	AdapterID        string
	Version          string
	ImplementationID string
	DriverID         string
	DriverDialect    string

	CloudTarget *textBehaviorCloudTarget
	LocalTarget *textBehaviorLocalTarget

	Support            textBehaviorSupport
	ExecutionSemantics textBehaviorExecutionSemantics

	RequestSerializerID string
	RequestSerializer   textBehaviorRequestSerializer
	NonStreamParserID   string
	NonStreamParser     textBehaviorNonStreamParser
	StreamAssemblerID   string
	StreamAssembler     textBehaviorStreamAssemblerFactory
}

type textBehaviorCloudTarget struct {
	Provider        string
	ProviderModelID string
}

type textBehaviorLocalTarget struct {
	RecipeID       string
	RecipeRevision string
	ModelContents  []textBehaviorModelContent
}

// textBehaviorModelContent names canonical bound content, not a catalog offer,
// filename, family label, or mutable ModelAsset record id.
type textBehaviorModelContent struct {
	SlotID      string
	ContentID   string
	EntrySHA256 string
}

type textBehaviorLoadOption struct {
	Key            string
	CanonicalValue string
}

type textBehaviorRecipeCustody struct {
	CustodyID string
	ContentID string
}

type textBehaviorProcessIdentityImpact uint8

const (
	textBehaviorProcessIdentityUnspecified textBehaviorProcessIdentityImpact = iota
	textBehaviorProcessIdentityUnaffected
	textBehaviorProcessIdentityAdapter
	textBehaviorProcessIdentityTemplate
	textBehaviorProcessIdentityAdapterAndTemplate
)

// textBehaviorExecutionSemantics declares the fixed execution facts owned by
// the adapter. Local TemplateIdentity must come from Driver-owned verified
// model metadata (for GGUF, the authored chat-template identity), never from a
// model label, endpoint probe, or a trial prompt.
type textBehaviorExecutionSemantics struct {
	RequiredTemplateIdentity string
	RequiredRecipeCustody    []textBehaviorRecipeCustody
	RequiredLoadOptions      []textBehaviorLoadOption
	ProcessIdentityImpact    textBehaviorProcessIdentityImpact
}

type textBehaviorSupport struct {
	ToolUse          *textBehaviorToolUseSupport
	Reasoning        *textBehaviorReasoningSupport
	StructuredOutput *textBehaviorStructuredOutputSupport
	Combinations     []textBehaviorCombination
}

type textBehaviorToolUseSupport struct {
	SpecKinds           []runtimev1.ToolSpecKind
	ChoiceModes         []runtimev1.ToolChoiceMode
	SingleCall          bool
	MultipleCalls       bool
	ParallelCalls       bool
	ToolOnlyResponse    bool
	MixedTextAndCall    bool
	ToolResultRoundTrip bool
}

type textBehaviorReasoningSupport struct {
	Activations             []runtimev1.ReasoningActivation
	Presentations           []runtimev1.ReasoningPresentation
	Efforts                 []runtimev1.ReasoningEffort
	ExactBudget             bool
	SummaryTranscript       bool
	OpaqueContinuityCarrier bool
}

type textBehaviorStructuredOutputSupport struct {
	Kinds                    []runtimev1.ResponseFormatKind
	SupportsStrictJSONSchema bool
}

// Every admitted non-empty behavior combination and execution mode must be
// present explicitly. Request-time flags never select between adapters.
type textBehaviorCombination struct {
	ToolUse          bool
	Reasoning        bool
	StructuredOutput bool
	Modes            []runtimev1.ExecutionMode
}

type textBehaviorSerializedRequest = textbehavior.SerializedRequest
type textBehaviorRequestSerializer = textbehavior.RequestSerializer
type textBehaviorNonStreamParser = textbehavior.NonStreamParser
type textBehaviorStreamAssemblerFactory = textbehavior.StreamAssemblerFactory
type textBehaviorStreamFragmentAssembler = textbehavior.StreamFragmentAssembler

type textBehaviorAdapterCapture struct {
	AdapterID string `json:"adapter_id"`
	Version   string `json:"version"`
}

// Preserve the private Cloud assembly name while the adapter itself is no
// longer Cloud-owned.
type cloudTextBehaviorAdapterCapture = textBehaviorAdapterCapture

type textBehaviorAdapterResolutionFacts struct {
	ImplementationID string
	DriverID         string
	DriverDialect    string
	CloudTarget      *textBehaviorCloudTarget
	LocalTarget      *textBehaviorLocalResolutionTarget
}

type textBehaviorLocalResolutionTarget struct {
	RecipeID         string
	RecipeRevision   string
	ModelContents    []textBehaviorModelContent
	TemplateIdentity string
	RecipeCustody    []textBehaviorRecipeCustody
	LoadOptions      []textBehaviorLoadOption
}

type requestedTextBehaviors struct {
	toolUse              bool
	reasoning            bool
	structured           bool
	toolRoundTrip        bool
	reasoningSummaryTurn bool
	reasoningContinuity  bool
}

func (requested requestedTextBehaviors) any() bool {
	return requested.toolUse || requested.reasoning || requested.structured
}

type resolvedTextBehaviorAdapter struct {
	registration textBehaviorAdapterRegistration
	facts        textBehaviorAdapterResolutionFacts
	requested    requestedTextBehaviors
	mode         runtimev1.ExecutionMode
}

// resolveTextBehaviorAdapter preserves the Cloud consumer seam while routing
// it through the provider/model-neutral resolver.
func resolveTextBehaviorAdapter(
	registrations []textBehaviorAdapterRegistration,
	implementation *runtimev1.CapabilityImplementationIdentity,
	provider string,
	providerModelID string,
	mode runtimev1.ExecutionMode,
	spec *runtimev1.TextGenerateScenarioSpec,
) (*resolvedTextBehaviorAdapter, error) {
	facts := textBehaviorAdapterResolutionFacts{
		CloudTarget: &textBehaviorCloudTarget{Provider: provider, ProviderModelID: providerModelID},
	}
	if implementation != nil {
		facts.ImplementationID = implementation.GetImplementationId()
		facts.DriverID = implementation.GetDriverId()
		facts.DriverDialect = implementation.GetDriverDialect()
	}
	return resolveTextBehaviorAdapterForFacts(registrations, facts, mode, spec)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r119
// @nimi-authority: rule.nimi.runtime.ai-provider.r120
// @nimi-authority: rule.nimi.runtime.ai-provider.r123
func resolveTextBehaviorAdapterForFacts(
	registrations []textBehaviorAdapterRegistration,
	facts textBehaviorAdapterResolutionFacts,
	mode runtimev1.ExecutionMode,
	spec *runtimev1.TextGenerateScenarioSpec,
) (*resolvedTextBehaviorAdapter, error) {
	requested, err := requestedTextBehaviorsForSpec(spec)
	if err != nil {
		return nil, err
	}
	if !requested.any() {
		return nil, nil
	}
	if !validTextBehaviorResolutionFacts(facts) {
		return nil, textBehaviorUnavailableError()
	}

	// Adapter uniqueness is a property of the exact target, never of the
	// request combination. Otherwise request flags would implicitly choose an
	// adapter and make configured support unknowable before Job admission.
	matches := make([]textBehaviorAdapterRegistration, 0, 1)
	for _, registration := range registrations {
		if validTextBehaviorAdapterRegistration(registration) && textBehaviorAdapterMatchesFacts(registration, facts) {
			matches = append(matches, registration)
		}
	}
	switch len(matches) {
	case 0:
		return nil, textBehaviorUnavailableError()
	case 1:
		if !textBehaviorAdapterSupportsRequest(matches[0], requested, mode, spec) {
			return nil, textBehaviorUnavailableError()
		}
		return &resolvedTextBehaviorAdapter{registration: matches[0], facts: facts, requested: requested, mode: mode}, nil
	default:
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_AMBIGUOUS)
	}
}

func validTextBehaviorAdapterRegistration(registration textBehaviorAdapterRegistration) bool {
	for _, value := range []string{
		registration.AdapterID, registration.Version, registration.ImplementationID,
		registration.DriverID, registration.DriverDialect, registration.RequestSerializerID,
		registration.NonStreamParserID, registration.StreamAssemblerID,
	} {
		if !exactNonEmptyTextBehaviorValue(value) {
			return false
		}
	}
	if registration.RequestSerializer == nil || registration.NonStreamParser == nil || registration.StreamAssembler == nil ||
		(registration.CloudTarget == nil) == (registration.LocalTarget == nil) ||
		!validTextBehaviorExecutionSemantics(registration.ExecutionSemantics) ||
		!validTextBehaviorSupport(registration.Support) {
		return false
	}
	if registration.CloudTarget != nil {
		return validTextBehaviorCloudTarget(*registration.CloudTarget) &&
			registration.ExecutionSemantics.RequiredTemplateIdentity == "" &&
			len(registration.ExecutionSemantics.RequiredRecipeCustody) == 0 &&
			len(registration.ExecutionSemantics.RequiredLoadOptions) == 0
	}
	return validTextBehaviorLocalTarget(*registration.LocalTarget) &&
		exactNonEmptyTextBehaviorValue(registration.ExecutionSemantics.RequiredTemplateIdentity)
}

func validTextBehaviorResolutionFacts(facts textBehaviorAdapterResolutionFacts) bool {
	if !exactNonEmptyTextBehaviorValue(facts.ImplementationID) || !exactNonEmptyTextBehaviorValue(facts.DriverID) ||
		!exactNonEmptyTextBehaviorValue(facts.DriverDialect) || (facts.CloudTarget == nil) == (facts.LocalTarget == nil) {
		return false
	}
	if facts.CloudTarget != nil {
		return validTextBehaviorCloudTarget(*facts.CloudTarget)
	}
	return validTextBehaviorLocalResolutionTarget(*facts.LocalTarget)
}

func validTextBehaviorCloudTarget(target textBehaviorCloudTarget) bool {
	return exactNonEmptyTextBehaviorValue(target.Provider) && exactNonEmptyTextBehaviorValue(target.ProviderModelID)
}

func validTextBehaviorLocalTarget(target textBehaviorLocalTarget) bool {
	return exactNonEmptyTextBehaviorValue(target.RecipeID) && exactNonEmptyTextBehaviorValue(target.RecipeRevision) &&
		validTextBehaviorModelContents(target.ModelContents)
}

func validTextBehaviorLocalResolutionTarget(target textBehaviorLocalResolutionTarget) bool {
	return exactNonEmptyTextBehaviorValue(target.RecipeID) && exactNonEmptyTextBehaviorValue(target.RecipeRevision) &&
		exactNonEmptyTextBehaviorValue(target.TemplateIdentity) && validTextBehaviorModelContents(target.ModelContents) &&
		validTextBehaviorRecipeCustody(target.RecipeCustody) && validTextBehaviorLoadOptions(target.LoadOptions)
}

func validTextBehaviorModelContents(contents []textBehaviorModelContent) bool {
	if len(contents) == 0 {
		return false
	}
	previous := ""
	for _, content := range contents {
		if !exactNonEmptyTextBehaviorValue(content.SlotID) || !exactNonEmptyTextBehaviorValue(content.ContentID) ||
			!exactNonEmptyTextBehaviorValue(content.EntrySHA256) ||
			(previous != "" && content.SlotID <= previous) {
			return false
		}
		previous = content.SlotID
	}
	return true
}

func validTextBehaviorExecutionSemantics(semantics textBehaviorExecutionSemantics) bool {
	switch semantics.ProcessIdentityImpact {
	case textBehaviorProcessIdentityUnaffected, textBehaviorProcessIdentityAdapter,
		textBehaviorProcessIdentityTemplate, textBehaviorProcessIdentityAdapterAndTemplate:
	default:
		return false
	}
	if semantics.RequiredTemplateIdentity != "" && !exactNonEmptyTextBehaviorValue(semantics.RequiredTemplateIdentity) {
		return false
	}
	return validTextBehaviorRecipeCustody(semantics.RequiredRecipeCustody) && validTextBehaviorLoadOptions(semantics.RequiredLoadOptions)
}

func validTextBehaviorRecipeCustody(values []textBehaviorRecipeCustody) bool {
	previous := ""
	for _, value := range values {
		if !exactNonEmptyTextBehaviorValue(value.CustodyID) || !exactNonEmptyTextBehaviorValue(value.ContentID) ||
			(previous != "" && value.CustodyID <= previous) {
			return false
		}
		previous = value.CustodyID
	}
	return true
}

func validTextBehaviorLoadOptions(options []textBehaviorLoadOption) bool {
	previous := ""
	for _, option := range options {
		if !exactNonEmptyTextBehaviorValue(option.Key) || !exactNonEmptyTextBehaviorValue(option.CanonicalValue) ||
			(previous != "" && option.Key <= previous) {
			return false
		}
		previous = option.Key
	}
	return true
}

func exactNonEmptyTextBehaviorValue(value string) bool {
	return strings.TrimSpace(value) != "" && value == strings.TrimSpace(value)
}

func validTextBehaviorSupport(support textBehaviorSupport) bool {
	if support.ToolUse == nil && support.Reasoning == nil && support.StructuredOutput == nil || len(support.Combinations) == 0 {
		return false
	}
	if support.ToolUse != nil && !validTextBehaviorToolUseSupport(*support.ToolUse) ||
		support.Reasoning != nil && !validTextBehaviorReasoningSupport(*support.Reasoning) ||
		support.StructuredOutput != nil && !validTextBehaviorStructuredOutputSupport(*support.StructuredOutput) {
		return false
	}
	seenCombinationModes := map[string]struct{}{}
	coveredTool, coveredReasoning, coveredStructured := false, false, false
	for _, combination := range support.Combinations {
		if !combination.ToolUse && !combination.Reasoning && !combination.StructuredOutput || len(combination.Modes) == 0 ||
			combination.ToolUse && support.ToolUse == nil || combination.Reasoning && support.Reasoning == nil ||
			combination.StructuredOutput && support.StructuredOutput == nil {
			return false
		}
		modeSeen := map[runtimev1.ExecutionMode]struct{}{}
		for _, mode := range combination.Modes {
			switch mode {
			case runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
				runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
				runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB:
			default:
				return false
			}
			if _, duplicate := modeSeen[mode]; duplicate {
				return false
			}
			modeSeen[mode] = struct{}{}
			key := fmt.Sprintf("%t/%t/%t/%d", combination.ToolUse, combination.Reasoning, combination.StructuredOutput, mode)
			if _, duplicate := seenCombinationModes[key]; duplicate {
				return false
			}
			seenCombinationModes[key] = struct{}{}
		}
		coveredTool = coveredTool || combination.ToolUse
		coveredReasoning = coveredReasoning || combination.Reasoning
		coveredStructured = coveredStructured || combination.StructuredOutput
	}
	return (support.ToolUse == nil || coveredTool) && (support.Reasoning == nil || coveredReasoning) &&
		(support.StructuredOutput == nil || coveredStructured)
}

func validTextBehaviorToolUseSupport(support textBehaviorToolUseSupport) bool {
	if !support.SingleCall || support.ParallelCalls && !support.MultipleCalls || len(support.SpecKinds) == 0 || len(support.ChoiceModes) == 0 {
		return false
	}
	if !support.ToolOnlyResponse && !support.MixedTextAndCall {
		return false
	}
	seenKinds := map[runtimev1.ToolSpecKind]struct{}{}
	for _, kind := range support.SpecKinds {
		if kind != runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION && kind != runtimev1.ToolSpecKind_TOOL_SPEC_KIND_PROVIDER {
			return false
		}
		if _, duplicate := seenKinds[kind]; duplicate {
			return false
		}
		seenKinds[kind] = struct{}{}
	}
	seenChoices := map[runtimev1.ToolChoiceMode]struct{}{}
	for _, choice := range support.ChoiceModes {
		switch choice {
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE,
			runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL:
		default:
			return false
		}
		if _, duplicate := seenChoices[choice]; duplicate {
			return false
		}
		seenChoices[choice] = struct{}{}
	}
	return true
}

func validTextBehaviorReasoningSupport(support textBehaviorReasoningSupport) bool {
	if len(support.Activations) == 0 || len(support.Presentations) == 0 || len(support.Efforts) == 0 && !support.ExactBudget {
		return false
	}
	seenActivation := map[runtimev1.ReasoningActivation]struct{}{}
	for _, value := range support.Activations {
		if value != runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE && value != runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED {
			return false
		}
		if _, duplicate := seenActivation[value]; duplicate {
			return false
		}
		seenActivation[value] = struct{}{}
	}
	seenPresentation := map[runtimev1.ReasoningPresentation]struct{}{}
	for _, value := range support.Presentations {
		if value != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN && value != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY {
			return false
		}
		if _, duplicate := seenPresentation[value]; duplicate {
			return false
		}
		seenPresentation[value] = struct{}{}
	}
	seenEffort := map[runtimev1.ReasoningEffort]struct{}{}
	for _, value := range support.Efforts {
		switch value {
		case runtimev1.ReasoningEffort_REASONING_EFFORT_MINIMAL, runtimev1.ReasoningEffort_REASONING_EFFORT_LOW,
			runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM, runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH,
			runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM:
		default:
			return false
		}
		if _, duplicate := seenEffort[value]; duplicate {
			return false
		}
		seenEffort[value] = struct{}{}
	}
	return true
}

func validTextBehaviorStructuredOutputSupport(support textBehaviorStructuredOutputSupport) bool {
	if len(support.Kinds) == 0 {
		return false
	}
	seen := map[runtimev1.ResponseFormatKind]struct{}{}
	for _, kind := range support.Kinds {
		if kind != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT && kind != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
			return false
		}
		if _, duplicate := seen[kind]; duplicate {
			return false
		}
		seen[kind] = struct{}{}
	}
	return true
}

func textBehaviorAdapterMatchesFacts(registration textBehaviorAdapterRegistration, facts textBehaviorAdapterResolutionFacts) bool {
	if registration.ImplementationID != facts.ImplementationID || registration.DriverID != facts.DriverID ||
		registration.DriverDialect != facts.DriverDialect {
		return false
	}
	if registration.CloudTarget != nil {
		return facts.CloudTarget != nil && registration.CloudTarget.Provider == facts.CloudTarget.Provider &&
			registration.CloudTarget.ProviderModelID == facts.CloudTarget.ProviderModelID
	}
	if facts.LocalTarget == nil || registration.LocalTarget.RecipeID != facts.LocalTarget.RecipeID ||
		registration.LocalTarget.RecipeRevision != facts.LocalTarget.RecipeRevision ||
		!equalTextBehaviorModelContents(registration.LocalTarget.ModelContents, facts.LocalTarget.ModelContents) ||
		registration.ExecutionSemantics.RequiredTemplateIdentity != facts.LocalTarget.TemplateIdentity {
		return false
	}
	return containsAllTextBehaviorRecipeCustody(facts.LocalTarget.RecipeCustody, registration.ExecutionSemantics.RequiredRecipeCustody) &&
		containsAllTextBehaviorLoadOptions(facts.LocalTarget.LoadOptions, registration.ExecutionSemantics.RequiredLoadOptions)
}

func equalTextBehaviorModelContents(left, right []textBehaviorModelContent) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func containsAllTextBehaviorRecipeCustody(actual, required []textBehaviorRecipeCustody) bool {
	available := make(map[string]string, len(actual))
	for _, value := range actual {
		available[value.CustodyID] = value.ContentID
	}
	for _, value := range required {
		if available[value.CustodyID] != value.ContentID {
			return false
		}
	}
	return true
}

func containsAllTextBehaviorLoadOptions(actual, required []textBehaviorLoadOption) bool {
	available := make(map[string]string, len(actual))
	for _, option := range actual {
		available[option.Key] = option.CanonicalValue
	}
	for _, option := range required {
		if available[option.Key] != option.CanonicalValue {
			return false
		}
	}
	return true
}

func textBehaviorAdapterSupportsRequest(registration textBehaviorAdapterRegistration, requested requestedTextBehaviors, mode runtimev1.ExecutionMode, spec *runtimev1.TextGenerateScenarioSpec) bool {
	combinationSupported := false
	for _, combination := range registration.Support.Combinations {
		if combination.ToolUse == requested.toolUse && combination.Reasoning == requested.reasoning &&
			combination.StructuredOutput == requested.structured && containsTextBehaviorExecutionMode(combination.Modes, mode) {
			combinationSupported = true
			break
		}
	}
	if !combinationSupported {
		return false
	}
	if requested.toolUse && !textBehaviorToolUseSupportsRequest(registration.Support.ToolUse, requested, spec) {
		return false
	}
	if requested.reasoning && !textBehaviorReasoningSupportsRequest(registration.Support.Reasoning, requested, spec) {
		return false
	}
	return !requested.structured || textBehaviorStructuredOutputSupportsRequest(registration.Support.StructuredOutput, spec)
}

func containsTextBehaviorExecutionMode(values []runtimev1.ExecutionMode, expected runtimev1.ExecutionMode) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func textBehaviorToolUseSupportsRequest(support *textBehaviorToolUseSupport, requested requestedTextBehaviors, spec *runtimev1.TextGenerateScenarioSpec) bool {
	if support == nil || spec == nil || requested.toolRoundTrip && !support.ToolResultRoundTrip {
		return false
	}
	for _, tool := range spec.GetTools() {
		if tool == nil || !containsToolSpecKind(support.SpecKinds, tool.GetKind()) {
			return false
		}
	}
	choice := spec.GetToolChoice()
	if choice == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && len(spec.GetTools()) > 0 {
		choice = runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO
	}
	return choice == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED || containsToolChoiceMode(support.ChoiceModes, choice)
}

func containsToolSpecKind(values []runtimev1.ToolSpecKind, expected runtimev1.ToolSpecKind) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func containsToolChoiceMode(values []runtimev1.ToolChoiceMode, expected runtimev1.ToolChoiceMode) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func textBehaviorReasoningSupportsRequest(support *textBehaviorReasoningSupport, requested requestedTextBehaviors, spec *runtimev1.TextGenerateScenarioSpec) bool {
	if support == nil || spec == nil || requested.reasoningSummaryTurn && !support.SummaryTranscript ||
		requested.reasoningContinuity && !support.OpaqueContinuityCarrier {
		return false
	}
	normalized := normalizeReasoningConfig(spec.GetReasoning())
	if normalized.activation == runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED {
		return requested.reasoningSummaryTurn || requested.reasoningContinuity
	}
	if !containsReasoningActivation(support.Activations, normalized.activation) ||
		!containsReasoningPresentation(support.Presentations, normalized.presentation) {
		return false
	}
	switch normalized.intensity {
	case reasoningIntensityEffort:
		return containsReasoningEffort(support.Efforts, normalized.effort)
	case reasoningIntensityBudget:
		return support.ExactBudget
	default:
		return false
	}
}

func containsReasoningActivation(values []runtimev1.ReasoningActivation, expected runtimev1.ReasoningActivation) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func containsReasoningPresentation(values []runtimev1.ReasoningPresentation, expected runtimev1.ReasoningPresentation) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func containsReasoningEffort(values []runtimev1.ReasoningEffort, expected runtimev1.ReasoningEffort) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func textBehaviorStructuredOutputSupportsRequest(support *textBehaviorStructuredOutputSupport, spec *runtimev1.TextGenerateScenarioSpec) bool {
	if support == nil || spec == nil || spec.GetResponseFormat() == nil ||
		!containsResponseFormatKind(support.Kinds, spec.GetResponseFormat().GetKind()) {
		return false
	}
	return !spec.GetResponseFormat().GetStrict() ||
		spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA && support.SupportsStrictJSONSchema
}

func containsResponseFormatKind(values []runtimev1.ResponseFormatKind, expected runtimev1.ResponseFormatKind) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func requestedTextBehaviorsForSpec(spec *runtimev1.TextGenerateScenarioSpec) (requestedTextBehaviors, error) {
	if spec == nil {
		return requestedTextBehaviors{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := validateReasoningConfig(spec); err != nil {
		return requestedTextBehaviors{}, err
	}
	if err := validateTextBehaviorTurnTranscriptShape(spec); err != nil {
		return requestedTextBehaviors{}, err
	}
	if err := validateTextBehaviorToolRequestShape(spec); err != nil {
		return requestedTextBehaviors{}, err
	}
	requested := requestedTextBehaviors{
		toolUse: len(spec.GetTools()) > 0 ||
			spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED ||
			strings.TrimSpace(spec.GetToolChoiceName()) != "",
		reasoning: requestedReasoningEnabled(spec),
	}
	if format := spec.GetResponseFormat(); format != nil {
		switch format.GetKind() {
		case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED,
			runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT:
		case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT,
			runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA:
			requested.structured = true
		default:
			return requestedTextBehaviors{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	}
	for _, message := range spec.GetInput() {
		for _, item := range message.GetTurnItems() {
			if item.GetToolResult() != nil || item.GetOutput().GetToolCall() != nil {
				requested.toolUse = true
				requested.toolRoundTrip = true
			}
			if item.GetOutput().GetReasoningSummary() != nil {
				requested.reasoning = true
				requested.reasoningSummaryTurn = true
			}
			if item.GetOutput().GetReasoningContinuity() != nil {
				if !textbehavior.ValidContinuity(item.GetOutput().GetReasoningContinuity()) {
					return requestedTextBehaviors{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID)
				}
				requested.reasoning = true
				requested.reasoningContinuity = true
			}
		}
	}
	return requested, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r087
func validateTextBehaviorTurnTranscriptShape(spec *runtimev1.TextGenerateScenarioSpec) error {
	for _, message := range spec.GetInput() {
		if message == nil || len(message.GetTurnItems()) == 0 {
			continue
		}
		if message.GetContent() != "" || len(message.GetParts()) != 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		role := strings.TrimSpace(message.GetRole())
		if role != "assistant" && role != "tool" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		for _, turnItem := range message.GetTurnItems() {
			if turnItem == nil {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
			}
			if output := turnItem.GetOutput(); output != nil {
				if role == "tool" {
					return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
				}
				switch value := output.GetItem().(type) {
				case *runtimev1.TextOutputItem_Text:
					if value.Text == nil || value.Text.GetText() == "" {
						return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
					}
				case *runtimev1.TextOutputItem_ReasoningSummary:
					if value.ReasoningSummary == nil || value.ReasoningSummary.GetText() == "" {
						return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
					}
				case *runtimev1.TextOutputItem_ToolCall:
					if value.ToolCall == nil {
						return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
					}
				case *runtimev1.TextOutputItem_ReasoningContinuity:
					if value.ReasoningContinuity == nil {
						return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
					}
				default:
					return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
				}
				continue
			}
			if turnItem.GetToolResult() == nil {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
			}
		}
	}
	return nil
}

func validateTextBehaviorToolRequestShape(spec *runtimev1.TextGenerateScenarioSpec) error {
	declared := make(map[string]struct{}, len(spec.GetTools()))
	for _, tool := range spec.GetTools() {
		if tool == nil || !exactNonEmptyTextBehaviorValue(tool.GetName()) ||
			(tool.GetKind() != runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION && tool.GetKind() != runtimev1.ToolSpecKind_TOOL_SPEC_KIND_PROVIDER) {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		if _, duplicate := declared[tool.GetName()]; duplicate {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		declared[tool.GetName()] = struct{}{}
	}
	choice := spec.GetToolChoice()
	choiceName := strings.TrimSpace(spec.GetToolChoiceName())
	switch choice {
	case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED:
		if choiceName != "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE:
		if choiceName != "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO,
		runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED:
		if choiceName != "" || len(declared) == 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL:
		if !exactNonEmptyTextBehaviorValue(spec.GetToolChoiceName()) {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		if _, ok := declared[spec.GetToolChoiceName()]; !ok {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return validateTextBehaviorToolTranscript(spec, declared)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r119
func validateTextBehaviorToolTranscript(spec *runtimev1.TextGenerateScenarioSpec, declared map[string]struct{}) error {
	priorCalls := map[string]string{}
	for _, message := range spec.GetInput() {
		for _, item := range message.GetTurnItems() {
			if item == nil {
				continue
			}
			if call := item.GetOutput().GetToolCall(); call != nil {
				if !exactNonEmptyTextBehaviorValue(call.GetId()) || !exactNonEmptyTextBehaviorValue(call.GetName()) {
					return invalidTextBehaviorToolTranscriptError()
				}
				if _, ok := declared[call.GetName()]; !ok {
					return invalidTextBehaviorToolTranscriptError()
				}
				if _, duplicate := priorCalls[call.GetId()]; duplicate {
					return invalidTextBehaviorToolTranscriptError()
				}
				var arguments map[string]any
				if err := json.Unmarshal([]byte(call.GetArgumentsJson()), &arguments); err != nil || arguments == nil {
					return invalidTextBehaviorToolTranscriptError()
				}
				priorCalls[call.GetId()] = call.GetName()
				continue
			}
			if result := item.GetToolResult(); result != nil {
				if !exactNonEmptyTextBehaviorValue(result.GetToolCallId()) || !exactNonEmptyTextBehaviorValue(result.GetToolName()) ||
					priorCalls[result.GetToolCallId()] != result.GetToolName() {
					return invalidTextBehaviorToolTranscriptError()
				}
			}
		}
	}
	return nil
}

func invalidTextBehaviorToolTranscriptError() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TOOL_CALL_INVALID)
}

func textBehaviorUnavailableError() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
}

func (adapter *resolvedTextBehaviorAdapter) nimillmAdmission() *nimillm.TextBehaviorAdmission {
	if adapter == nil || adapter.facts.CloudTarget == nil {
		return nil
	}
	return &nimillm.TextBehaviorAdmission{
		AdapterID: adapter.registration.AdapterID, Version: adapter.registration.Version,
		Provider: adapter.facts.CloudTarget.Provider, ProviderModelID: adapter.facts.CloudTarget.ProviderModelID,
		ToolUse: adapter.requested.toolUse, Reasoning: adapter.requested.reasoning,
		StructuredOutput:          adapter.requested.structured,
		Sync:                      adapter.mode == runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Stream:                    adapter.mode == runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Async:                     adapter.mode == runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		ToolStructuredCombination: adapter.requested.toolUse && adapter.requested.structured,
	}
}

func (adapter *resolvedTextBehaviorAdapter) capture() *textBehaviorAdapterCapture {
	if adapter == nil {
		return nil
	}
	return &textBehaviorAdapterCapture{AdapterID: adapter.registration.AdapterID, Version: adapter.registration.Version}
}

// runtimeAdapter projects the exact resolver result into the lower-level,
// immutable execution hook bundle. It does not resolve, probe, or register an
// adapter; the unique match has already been established above this seam.
func (adapter *resolvedTextBehaviorAdapter) runtimeAdapter() (*textbehavior.Adapter, error) {
	if adapter == nil {
		return nil, nil
	}
	impact, err := runtimeTextBehaviorProcessIdentityImpact(adapter.registration.ExecutionSemantics.ProcessIdentityImpact)
	if err != nil {
		return nil, err
	}
	return textbehavior.NewAdapter(textbehavior.AdapterCapture{
		AdapterID:                adapter.registration.AdapterID,
		Version:                  adapter.registration.Version,
		RequestSerializerID:      adapter.registration.RequestSerializerID,
		NonStreamParserID:        adapter.registration.NonStreamParserID,
		StreamAssemblerID:        adapter.registration.StreamAssemblerID,
		RequiredTemplateIdentity: adapter.registration.ExecutionSemantics.RequiredTemplateIdentity,
		ProcessIdentityImpact:    impact,
	}, adapter.registration.RequestSerializer, adapter.registration.NonStreamParser, adapter.registration.StreamAssembler)
}

func runtimeTextBehaviorProcessIdentityImpact(value textBehaviorProcessIdentityImpact) (textbehavior.ProcessIdentityImpact, error) {
	switch value {
	case textBehaviorProcessIdentityUnaffected:
		return textbehavior.ProcessIdentityUnaffected, nil
	case textBehaviorProcessIdentityAdapter:
		return textbehavior.ProcessIdentityAdapter, nil
	case textBehaviorProcessIdentityTemplate:
		return textbehavior.ProcessIdentityTemplate, nil
	case textBehaviorProcessIdentityAdapterAndTemplate:
		return textbehavior.ProcessIdentityAdapterAndTemplate, nil
	default:
		return "", fmt.Errorf("text behavior adapter process identity impact is invalid")
	}
}

func matchingTextBehaviorAdapterCapture(adapter *resolvedTextBehaviorAdapter, capture *textBehaviorAdapterCapture) bool {
	if adapter == nil || capture == nil {
		return adapter == nil && capture == nil
	}
	return adapter.registration.AdapterID == capture.AdapterID && adapter.registration.Version == capture.Version
}

func validateTextBehaviorAdapterCapture(capture *textBehaviorAdapterCapture) error {
	if capture == nil {
		return nil
	}
	if !exactNonEmptyTextBehaviorValue(capture.AdapterID) || !exactNonEmptyTextBehaviorValue(capture.Version) {
		return fmt.Errorf("text behavior adapter capture is invalid")
	}
	return nil
}
