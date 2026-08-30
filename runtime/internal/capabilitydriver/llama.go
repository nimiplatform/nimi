package capabilitydriver

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/types/known/structpb"
)

const inputImageFeature = "input.image"

// LlamaTextDriver projects only llama.cpp text resource intent.
type LlamaTextDriver struct{}

func (LlamaTextDriver) ModelAssetFormatProbeBytes(input ModelAssetFormatProbeInput) int64 {
	if strings.TrimSpace(input.RecipeID) == LlamaGemma4RecipeID &&
		input.RequirementID == MainGGUFRequirementID && input.Entry &&
		filepath.Ext(strings.ToLower(input.RelativePath)) == ".gguf" {
		return MaxDriverAssetFormatProbeBytes
	}
	return MaxAssetFormatProbeBytes
}

func (driver LlamaTextDriver) ImplementationSupportedFeatures(recipeID string) ([]string, runtimev1.LocalCapabilityReason) {
	if len(driver.recipeModelArchitectures(recipeID, MainGGUFRequirementID)) == 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	if strings.TrimSpace(recipeID) == LlamaGemma4RecipeID {
		return []string{inputImageFeature}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver LlamaTextDriver) TextBehaviorCapabilities(recipeID string) ([]*runtimev1.TextBehaviorCapabilityProjection, runtimev1.LocalCapabilityReason) {
	if len(driver.recipeModelArchitectures(recipeID, MainGGUFRequirementID)) == 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	if strings.TrimSpace(recipeID) == LlamaGemma4RecipeID {
		return gemma4TextBehaviorProjections(runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_UNAVAILABLE), runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
	result := make([]*runtimev1.TextBehaviorCapabilityProjection, 0, 3)
	for _, kind := range []runtimev1.TextBehaviorKind{
		runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_TOOL_USE,
		runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_REASONING,
		runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_STRUCTURED_OUTPUT,
	} {
		result = append(result, &runtimev1.TextBehaviorCapabilityProjection{
			Kind: kind, ImplementationSupported: false,
			ConfigurationState: runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_UNAVAILABLE,
			Reasons:            []runtimev1.LocalCapabilityReason{runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_TEXT_BEHAVIOR_UNAVAILABLE},
		})
	}
	return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver LlamaTextDriver) TextBehaviorCapabilitiesForBindings(recipeID string, facts []TextBehaviorBindingFacts) ([]*runtimev1.TextBehaviorCapabilityProjection, runtimev1.LocalCapabilityReason) {
	base, reason := driver.TextBehaviorCapabilities(recipeID)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || strings.TrimSpace(recipeID) != LlamaGemma4RecipeID {
		return base, reason
	}
	var main []TextBehaviorBindingFacts
	for _, fact := range facts {
		if fact.RequirementID == MainGGUFRequirementID {
			main = append(main, fact)
		}
	}
	switch len(main) {
	case 0:
		return base, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	case 1:
		if _, ok := gemma4CohortEntryForMain(main[0].VerifiedContentID, main[0].EntrySHA256, main[0].TemplateIdentity); !ok {
			return base, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
		}
		return gemma4TextBehaviorProjections(runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_CONFIGURED), runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	default:
		return gemma4TextBehaviorProjections(runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_AMBIGUOUS), runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
}

func gemma4TextBehaviorProjections(state runtimev1.TextBehaviorConfigurationState) []*runtimev1.TextBehaviorCapabilityProjection {
	result := make([]*runtimev1.TextBehaviorCapabilityProjection, 0, 3)
	for _, kind := range []runtimev1.TextBehaviorKind{
		runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_TOOL_USE,
		runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_REASONING,
		runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_STRUCTURED_OUTPUT,
	} {
		projection := &runtimev1.TextBehaviorCapabilityProjection{Kind: kind, ImplementationSupported: true, ConfigurationState: state}
		switch state {
		case runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_UNAVAILABLE:
			projection.Reasons = []runtimev1.LocalCapabilityReason{runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_TEXT_BEHAVIOR_UNAVAILABLE}
		case runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_AMBIGUOUS:
			projection.Reasons = []runtimev1.LocalCapabilityReason{runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_TEXT_BEHAVIOR_AMBIGUOUS}
		}
		if kind == runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_TOOL_USE {
			projection.ImplementationToolUse = Gemma4ToolUseCapabilityProjection()
			if state == runtimev1.TextBehaviorConfigurationState_TEXT_BEHAVIOR_CONFIGURATION_STATE_CONFIGURED {
				projection.ConfiguredToolUse = Gemma4ToolUseCapabilityProjection()
			}
		}
		result = append(result, projection)
	}
	return result
}

func (LlamaTextDriver) EffectiveRequestDefaults(_ string, _ *structpb.Struct) map[string]string {
	// These are the request defaults owned by the pinned llama-server dialect
	// when llamaTextRequestBody omits unset sampling fields.
	return map[string]string{
		"temperature":      "0.8",
		"topP":             "0.95",
		"topK":             "40",
		"maxTokens":        "-1",
		"presencePenalty":  "0",
		"frequencyPenalty": "0",
		"seed":             "random",
	}
}

func (driver LlamaTextDriver) ProjectRecipe(recipeID string, options *structpb.Struct, supportedFeatures []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if len(driver.recipeModelArchitectures(recipeID, MainGGUFRequirementID)) == 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return driver.Interpret(InterpretInput{RecipeID: recipeID, PortableConfig: options, SupportedFeatures: supportedFeatures})
}

func (LlamaTextDriver) recipeModelArchitectures(recipeID string, slotID string) []string {
	if slotID != MainGGUFRequirementID {
		return nil
	}
	switch strings.TrimSpace(recipeID) {
	case LlamaGemma4RecipeID:
		return []string{"gemma4"}
	default:
		return nil
	}
}

func (driver LlamaTextDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	probe := input.Entry.FormatProbe
	probeLimit := driver.ModelAssetFormatProbeBytes(ModelAssetFormatProbeInput{
		RecipeID: input.RecipeID, RequirementID: input.Requirement.GetRequirementId(),
		RelativePath: input.Entry.RelativePath, Entry: true,
	})
	if filepath.Ext(strings.ToLower(input.Entry.RelativePath)) != ".gguf" || len(probe) < 4 || int64(len(probe)) > probeLimit || !bytes.Equal(probe[:4], []byte("GGUF")) {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	descriptor := ModelAssetDescriptor{Engine: "llama", FormatProbe: probe}
	var contextWindow uint64
	var templateIdentity string
	switch input.Requirement.GetRequirementId() {
	case MainGGUFRequirementID:
		summary, err := ggufmeta.InspectLLMMetadataWithChatTemplate(bytes.NewReader(probe))
		if err != nil || !contains(driver.recipeModelArchitectures(input.RecipeID, MainGGUFRequirementID), ggufmeta.LLMDetectedArchitecture(summary)) {
			return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
		contextWindow, _ = ggufmeta.LLMContextLength(summary)
		templateIdentity, _ = ggufmeta.LLMChatTemplateIdentity(summary)
		descriptor.Kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT
		descriptor.ArtifactRoles = []string{"llm"}
	case CompanionMMProjRequirementID:
		descriptor.Kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY
		descriptor.ArtifactRoles = []string{"mmproj"}
	default:
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	projection, reason := validatedModelAssetBindingProjection(input, descriptor, contextWindow, driver.ValidateBinding)
	if reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		projection.TemplateIdentity = templateIdentity
	}
	return projection, reason
}

func (LlamaTextDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	features, reason := normalizedFeatures(input.SupportedFeatures)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, reason
	}
	_, reason = parsePortableConfig(input.PortableConfig, contains(features, inputImageFeature))
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, reason
	}

	main := llamaRequirement(
		MainGGUFRequirementID,
		runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		"gguf",
		"llm",
		"Main model",
	)
	if strings.TrimSpace(input.RecipeID) == LlamaGemma4RecipeID {
		main.CompatibilityConstraints.Fields["gemma4_contract"] = structpb.NewStringValue("v1")
	}
	requirements := []*runtimev1.LocalCapabilityRequirement{main}
	if contains(features, inputImageFeature) {
		projector := llamaRequirement(
			CompanionMMProjRequirementID,
			runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
			"mmproj",
			"mmproj",
			"Vision projector",
		)
		projector.Presence = runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_OPTIONAL_CONDITIONAL
		projector.ConditionalFeatures = []string{inputImageFeature}
		if strings.TrimSpace(input.RecipeID) == LlamaGemma4RecipeID {
			projector.CompatibilityConstraints.Fields["gemma4_contract"] = structpb.NewStringValue("v1")
		}
		requirements = append(requirements, projector)
	}
	return requirements, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver LlamaTextDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement == nil || binding == nil || binding.GetRequirementId() != requirement.GetRequirementId() {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if binding.GetModelAssetId() == "" || asset.ModelAssetID == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if binding.GetVerifiedContentId() == "" || binding.GetEntrySha256() == "" || asset.VerifiedContentID == "" || asset.EntrySHA256 == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED
	}
	if binding.GetModelAssetId() != asset.ModelAssetID || binding.GetVerifiedContentId() != asset.VerifiedContentID || binding.GetEntrySha256() != asset.EntrySHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	if !llamaCompatible(requirement, asset) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver LlamaTextDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) == 0 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
	}
	if len(bindings) > len(requirements) || len(assets) > len(bindings) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if len(assets) < len(bindings) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	byRequirement := make(map[string]struct{}, len(requirements))
	for _, requirement := range requirements {
		if requirement == nil || requirement.GetRequirementId() == "" {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		if _, exists := byRequirement[requirement.GetRequirementId()]; exists {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		byRequirement[requirement.GetRequirementId()] = struct{}{}
	}
	byBinding := make(map[string]int, len(bindings))
	for index, binding := range bindings {
		if binding == nil || binding.GetRequirementId() == "" {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		if _, exists := byRequirement[binding.GetRequirementId()]; !exists {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		if _, exists := byBinding[binding.GetRequirementId()]; exists {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		byBinding[binding.GetRequirementId()] = index
	}
	for _, requirement := range requirements {
		index, exists := byBinding[requirement.GetRequirementId()]
		if !exists {
			if requirement.GetPresence() == runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_OPTIONAL_CONDITIONAL {
				continue
			}
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
		}
		if reason := driver.ValidateBinding(requirement, bindings[index], assets[index]); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			return reason
		}
	}
	if gemma4CombinationContract(requirements) {
		mainIndex, ok := byBinding[MainGGUFRequirementID]
		if !ok {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
		}
		expectedProjector, ok := gemma4ProjectorForMainContent(bindings[mainIndex].GetVerifiedContentId())
		if !ok {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
		if projectorIndex, configured := byBinding[CompanionMMProjRequirementID]; configured && bindings[projectorIndex].GetVerifiedContentId() != expectedProjector {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func gemma4CombinationContract(requirements []*runtimev1.LocalCapabilityRequirement) bool {
	for _, requirement := range requirements {
		if requirement != nil && requirement.GetCompatibilityConstraints().GetFields()["gemma4_contract"].GetStringValue() == "v1" {
			return true
		}
	}
	return false
}

func (driver LlamaTextDriver) PlanTextInvocation(input TextInvocationInput) (*TextInvocationPlan, error) {
	bindings, hasMMProj, err := exactLlamaInvocationBindings(input.ExactBindings)
	if err != nil {
		return nil, invocationError(InvocationFailureInvalidBinding, err)
	}
	behaviorMatch, err := driver.validateTextBehaviorAdapterMatchFacts(input.BehaviorMatch, bindings[MainGGUFRequirementID])
	if err != nil {
		return nil, invocationError(InvocationFailureInvalidBinding, err)
	}
	portable, reason := parsePortableConfig(input.PortableConfig, hasMMProj)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("llama portable config: %s", reason.String()))
	}
	requestContentType := "application/json"
	var requestBody []byte
	var behaviorInvocation *textbehavior.Invocation
	if input.BehaviorAdapter == nil {
		requestBody, err = llamaTextRequestBody(input.Request, input.Stream, hasMMProj)
		if err != nil {
			return nil, err
		}
	} else {
		if err := validateLlamaTextRequestCommon(input.Request, hasMMProj); err != nil {
			return nil, err
		}
		if err := input.BehaviorAdapter.ValidateTemplateIdentity(behaviorMatch.TemplateIdentity); err != nil {
			return nil, invocationError(InvocationFailureInvalidBinding, err)
		}
		behaviorInvocation, err = input.BehaviorAdapter.Bind(input.Request)
		if err != nil {
			return nil, invocationError(InvocationFailureTextBehaviorUnsupported, err)
		}
		serialized, serializeErr := behaviorInvocation.Serialize(input.Stream)
		if serializeErr != nil {
			if _, typed := grpcerr.ExtractReasonCode(serializeErr); typed {
				return nil, serializeErr
			}
			return nil, invocationError(InvocationFailureInvalidRequest, serializeErr)
		}
		requestContentType = serialized.ContentType
		requestBody = serialized.Payload
	}
	contextWindow, err := driver.TextContextWindow(input.PortableConfig, input.ModelContextWindowTokens)
	if err != nil {
		return nil, err
	}

	const modelAlias = "nimi-selected-local"
	reasoningArgs := []string{"--reasoning", "off"}
	if input.BehaviorAdapter != nil && llamaBehaviorReasoningEnabled(input.Request) {
		reasoningArgs = []string{"--reasoning", "on", "--reasoning-format", "deepseek"}
	}
	processArgs := append(reasoningArgs,
		"--model", bindings[MainGGUFRequirementID].AbsolutePath,
		"--alias", modelAlias,
		"--ctx-size", strconv.FormatUint(contextWindow, 10),
	)
	if companion, ok := bindings[CompanionMMProjRequirementID]; ok {
		processArgs = append(processArgs, "--mmproj", companion.AbsolutePath)
	}
	if portable.cacheTypeK != "" {
		processArgs = append(processArgs, "--cache-type-k", portable.cacheTypeK)
	}
	if portable.cacheTypeV != "" {
		processArgs = append(processArgs, "--cache-type-v", portable.cacheTypeV)
	}
	if portable.flashAttention != nil {
		value := "off"
		if *portable.flashAttention {
			value = "on"
		}
		processArgs = append(processArgs, "--flash-attn", value)
	}
	if portable.gpuLayers != nil {
		processArgs = append(processArgs, "--n-gpu-layers", strconv.Itoa(*portable.gpuLayers))
	}

	hash := sha256.New()
	for _, arg := range processArgs {
		_, _ = hash.Write([]byte(arg))
		_, _ = hash.Write([]byte{0})
	}
	for _, requirementID := range []string{MainGGUFRequirementID, CompanionMMProjRequirementID} {
		binding, ok := bindings[requirementID]
		if !ok {
			continue
		}
		for _, value := range invocationExactBindingIdentity(binding) {
			_, _ = hash.Write([]byte(value))
			_, _ = hash.Write([]byte{0})
		}
	}
	for _, source := range input.ExactDependencySources {
		for _, value := range invocationExactDependencySourceIdentity(source) {
			_, _ = hash.Write([]byte(value))
			_, _ = hash.Write([]byte{0})
		}
	}
	if input.BehaviorAdapter != nil {
		identityValues, identityErr := input.BehaviorAdapter.ProcessIdentityValues(behaviorMatch.TemplateIdentity)
		if identityErr != nil {
			return nil, invocationError(InvocationFailureInvalidBinding, identityErr)
		}
		for _, value := range identityValues {
			_, _ = hash.Write([]byte(value))
			_, _ = hash.Write([]byte{0})
		}
	}
	modelFiles := make([]InvocationExactBinding, 0, len(bindings))
	for _, requirementID := range []string{MainGGUFRequirementID, CompanionMMProjRequirementID} {
		if binding, ok := bindings[requirementID]; ok {
			modelFiles = append(modelFiles, cloneInvocationExactBindings([]InvocationExactBinding{binding})[0])
		}
	}
	return &TextInvocationPlan{
		processKey:         hex.EncodeToString(hash.Sum(nil)),
		processArgs:        processArgs,
		modelFiles:         modelFiles,
		dependencySources:  cloneInvocationExactDependencySources(input.ExactDependencySources),
		requestPath:        "/v1/chat/completions",
		requestContentType: requestContentType,
		requestBody:        requestBody,
		stream:             input.Stream,
		contextWindow:      contextWindow,
		behaviorMatch:      behaviorMatch,
		behaviorInvocation: behaviorInvocation,
	}, nil
}

func (driver LlamaTextDriver) validateTextBehaviorAdapterMatchFacts(facts TextBehaviorAdapterMatchFacts, main InvocationExactBinding) (TextBehaviorAdapterMatchFacts, error) {
	for _, value := range []string{facts.RecipeID, facts.RecipeRevision, facts.DriverDialect, facts.ModelAssetID, facts.VerifiedContentID, facts.EntrySHA256} {
		if value == "" || value != strings.TrimSpace(value) {
			return TextBehaviorAdapterMatchFacts{}, fmt.Errorf("llama text behavior match facts are incomplete")
		}
	}
	if len(driver.recipeModelArchitectures(facts.RecipeID, MainGGUFRequirementID)) == 0 || facts.DriverDialect != LlamaDriverDialect ||
		facts.ModelAssetID != main.ModelAssetID || facts.VerifiedContentID != main.VerifiedContentID || facts.EntrySHA256 != main.EntrySHA256 ||
		facts.TemplateIdentity != main.TemplateIdentity || !canonicalInvocationSHA256(facts.VerifiedContentID, facts.EntrySHA256) ||
		facts.TemplateIdentity != "" && !canonicalSHA256Identity(facts.TemplateIdentity) {
		return TextBehaviorAdapterMatchFacts{}, fmt.Errorf("llama text behavior match facts do not match the exact main GGUF binding")
	}
	return facts, nil
}

func (LlamaTextDriver) TextContextWindow(value *structpb.Struct, modelContextWindowTokens uint64) (uint64, error) {
	if modelContextWindowTokens == 0 {
		return 0, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("llama model-authored context capacity is unavailable"))
	}
	fields := map[string]*structpb.Value(nil)
	if value != nil {
		fields = value.GetFields()
	}
	if reason := validatePortableExecutionOptions(fields); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return 0, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("llama portable config: %s", reason.String()))
	}
	if contextSize := fields["contextSize"]; contextSize != nil {
		fixed := uint64(contextSize.GetNumberValue())
		if fixed > modelContextWindowTokens {
			return 0, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("llama fixed context capacity %d exceeds model-authored capacity %d", fixed, modelContextWindowTokens))
		}
		return fixed, nil
	}
	return modelContextWindowTokens, nil
}

func exactLlamaInvocationBindings(values []InvocationExactBinding) (map[string]InvocationExactBinding, bool, error) {
	bindings := make(map[string]InvocationExactBinding, len(values))
	for _, binding := range values {
		requirementID := strings.TrimSpace(binding.RequirementID)
		if requirementID != binding.RequirementID || (requirementID != MainGGUFRequirementID && requirementID != CompanionMMProjRequirementID) {
			return nil, false, fmt.Errorf("llama invocation contains an unknown requirement %q", binding.RequirementID)
		}
		if _, exists := bindings[requirementID]; exists {
			return nil, false, fmt.Errorf("llama invocation contains duplicate requirement %q", requirementID)
		}
		if binding.ModelAssetID == "" || binding.ModelAssetID != strings.TrimSpace(binding.ModelAssetID) ||
			binding.VerifiedContentID == "" || binding.VerifiedContentID != strings.TrimSpace(binding.VerifiedContentID) ||
			binding.EntrySHA256 == "" || binding.EntrySHA256 != strings.TrimSpace(binding.EntrySHA256) ||
			!canonicalInvocationSHA256(binding.VerifiedContentID, binding.EntrySHA256) ||
			binding.TemplateIdentity != "" && !canonicalSHA256Identity(binding.TemplateIdentity) ||
			!filepath.IsAbs(binding.AbsolutePath) || filepath.Clean(binding.AbsolutePath) != binding.AbsolutePath {
			return nil, false, fmt.Errorf("llama invocation requirement %q is not an exact absolute binding", requirementID)
		}
		bindings[requirementID] = cloneInvocationExactBindings([]InvocationExactBinding{binding})[0]
	}
	if _, exists := bindings[MainGGUFRequirementID]; !exists {
		return nil, false, fmt.Errorf("llama invocation main GGUF binding is required")
	}
	if len(bindings) > 2 {
		return nil, false, fmt.Errorf("llama invocation contains ambiguous bindings")
	}
	_, hasMMProj := bindings[CompanionMMProjRequirementID]
	return bindings, hasMMProj, nil
}

func canonicalInvocationSHA256(verifiedContentID string, entrySHA256 string) bool {
	if !strings.HasPrefix(verifiedContentID, "sha256:") || verifiedContentID != strings.ToLower(verifiedContentID) ||
		len(verifiedContentID) != len("sha256:")+64 || entrySHA256 != strings.ToLower(entrySHA256) || len(entrySHA256) != 64 {
		return false
	}
	_, verifiedErr := hex.DecodeString(strings.TrimPrefix(verifiedContentID, "sha256:"))
	_, entryErr := hex.DecodeString(entrySHA256)
	return verifiedErr == nil && entryErr == nil
}

func canonicalSHA256Identity(value string) bool {
	if !strings.HasPrefix(value, "sha256:") || value != strings.ToLower(value) || len(value) != len("sha256:")+64 {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(value, "sha256:"))
	return err == nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func llamaTextRequestBody(spec *runtimev1.TextGenerateScenarioSpec, stream bool, hasMMProj bool) ([]byte, error) {
	if spec == nil {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("text.generate request is required"))
	}
	if err := validateLlamaTextRequest(spec, hasMMProj); err != nil {
		return nil, err
	}
	messages := make([]map[string]any, 0, len(spec.GetInput())+1)
	if systemPrompt := strings.TrimSpace(spec.GetSystemPrompt()); systemPrompt != "" {
		messages = append(messages, map[string]any{"role": "system", "content": systemPrompt})
	}
	for _, message := range spec.GetInput() {
		projected, ok, err := projectLlamaTextMessage(message)
		if err != nil {
			return nil, err
		}
		if ok {
			messages = append(messages, projected)
		}
	}
	if len(messages) == 0 {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("text.generate request has no renderable input"))
	}
	body := map[string]any{
		"model":    "nimi-selected-local",
		"messages": messages,
		"stream":   stream,
	}
	if stream {
		body["stream_options"] = map[string]any{"include_usage": true}
	}
	if spec.Temperature != nil {
		body["temperature"] = spec.GetTemperature()
	}
	if spec.TopP != nil {
		body["top_p"] = spec.GetTopP()
	}
	if spec.MaxTokens != nil {
		body["max_tokens"] = spec.GetMaxTokens()
	}
	if spec.TopK != nil {
		body["top_k"] = spec.GetTopK()
	}
	if spec.PresencePenalty != nil {
		body["presence_penalty"] = spec.GetPresencePenalty()
	}
	if spec.FrequencyPenalty != nil {
		body["frequency_penalty"] = spec.GetFrequencyPenalty()
	}
	if len(spec.GetStop()) > 0 {
		body["stop"] = append([]string(nil), spec.GetStop()...)
	}
	if spec.Seed != nil {
		body["seed"] = spec.GetSeed()
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("encode llama text request: %w", err))
	}
	return payload, nil
}

func validateLlamaTextRequest(spec *runtimev1.TextGenerateScenarioSpec, hasMMProj bool) error {
	if err := validateLlamaTextRequestCommon(spec, hasMMProj); err != nil {
		return err
	}
	if len(spec.GetTools()) > 0 || spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED ||
		strings.TrimSpace(spec.GetToolChoiceName()) != "" {
		return invocationError(InvocationFailureTextBehaviorUnsupported, fmt.Errorf("llama text behavior adapter does not support Tool Use"))
	}
	if format := spec.GetResponseFormat(); format != nil &&
		format.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED &&
		format.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT {
		return invocationError(InvocationFailureTextBehaviorUnsupported, fmt.Errorf("llama text behavior adapter does not support the requested response format"))
	}
	return validateLlamaReasoningConfig(spec.GetReasoning())
}

func validateLlamaTextRequestCommon(spec *runtimev1.TextGenerateScenarioSpec, hasMMProj bool) error {
	if spec == nil {
		return invocationError(InvocationFailureInvalidRequest, fmt.Errorf("text.generate request is required"))
	}
	for name, value := range map[string]float64{
		"temperature":       float64(spec.GetTemperature()),
		"top_p":             float64(spec.GetTopP()),
		"presence_penalty":  float64(spec.GetPresencePenalty()),
		"frequency_penalty": float64(spec.GetFrequencyPenalty()),
	} {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return invocationError(InvocationFailureInvalidRequest, fmt.Errorf("text.generate %s must be finite", name))
		}
	}
	if spec.GetTemperature() < 0 || spec.GetTemperature() > 2 || spec.GetTopP() < 0 || spec.GetTopP() > 1 ||
		spec.GetMaxTokens() < 0 || spec.GetTopK() < 0 ||
		spec.GetPresencePenalty() < -2 || spec.GetPresencePenalty() > 2 ||
		spec.GetFrequencyPenalty() < -2 || spec.GetFrequencyPenalty() > 2 {
		return invocationError(InvocationFailureInvalidRequest, fmt.Errorf("text.generate sampling parameters are outside the supported range"))
	}
	for _, stop := range spec.GetStop() {
		if strings.TrimSpace(stop) == "" {
			return invocationError(InvocationFailureInvalidRequest, fmt.Errorf("text.generate stop values must be non-empty"))
		}
	}
	if spec.GetIncludeRawChunks() {
		return invocationError(InvocationFailureUnsupported, fmt.Errorf("llama text invocation does not support raw chunks"))
	}
	for _, message := range spec.GetInput() {
		for _, part := range message.GetParts() {
			switch part.GetType() {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT:
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
				if !hasMMProj {
					return invocationError(InvocationFailureUnsupported, fmt.Errorf("text.generate input.image requires the configured mmproj binding"))
				}
			default:
				return invocationError(InvocationFailureUnsupported, fmt.Errorf("llama text invocation does not support content part %s", part.GetType().String()))
			}
		}
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func validateLlamaReasoningConfig(reasoning *runtimev1.ReasoningConfig) error {
	activation := runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED
	presentation := runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN
	if reasoning != nil {
		activation = reasoning.GetActivation()
		presentation = reasoning.GetPresentation()
	}
	if activation == runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED {
		activation = runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED
	}
	if presentation == runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED {
		presentation = runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN
	}
	if presentation != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN &&
		presentation != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY {
		return invocationError(InvocationFailureInvalidRequest, fmt.Errorf("text.generate reasoning presentation is invalid"))
	}

	switch activation {
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED:
		if presentation != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN ||
			(reasoning != nil && reasoning.GetIntensity() != nil) {
			return invocationError(InvocationFailureInvalidRequest, fmt.Errorf("disabled reasoning admits only hidden presentation and no intensity"))
		}
		return nil
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE,
		runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED:
		if err := validateLlamaReasoningIntensity(reasoning); err != nil {
			return invocationError(InvocationFailureInvalidRequest, err)
		}
		return invocationError(InvocationFailureTextBehaviorUnsupported, fmt.Errorf("llama text behavior adapter does not support reasoning"))
	default:
		return invocationError(InvocationFailureInvalidRequest, fmt.Errorf("text.generate reasoning activation is invalid"))
	}
}

func validateLlamaReasoningIntensity(reasoning *runtimev1.ReasoningConfig) error {
	if reasoning == nil || reasoning.GetIntensity() == nil {
		return fmt.Errorf("adaptive or required reasoning requires exactly one intensity")
	}
	switch intensity := reasoning.GetIntensity().(type) {
	case *runtimev1.ReasoningConfig_Effort:
		switch intensity.Effort {
		case runtimev1.ReasoningEffort_REASONING_EFFORT_MINIMAL,
			runtimev1.ReasoningEffort_REASONING_EFFORT_LOW,
			runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM,
			runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH,
			runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM:
			return nil
		default:
			return fmt.Errorf("reasoning effort is invalid")
		}
	case *runtimev1.ReasoningConfig_ExactBudgetTokens:
		if intensity.ExactBudgetTokens == 0 {
			return fmt.Errorf("reasoning exact budget must be positive")
		}
		return nil
	default:
		return fmt.Errorf("reasoning intensity is invalid")
	}
}

func projectLlamaTextMessage(message *runtimev1.ChatMessage) (map[string]any, bool, error) {
	if message == nil {
		return nil, false, nil
	}
	if len(message.GetTurnItems()) > 0 {
		return projectLlamaTextTurnMessage(message)
	}
	role := strings.TrimSpace(message.GetRole())
	if role == "" {
		role = "user"
	}
	projected := map[string]any{"role": role}
	if name := strings.TrimSpace(message.GetName()); name != "" {
		projected["name"] = name
	}
	if len(message.GetParts()) == 0 {
		content := strings.TrimSpace(message.GetContent())
		if content != "" {
			projected["content"] = content
		}
		return projected, content != "", nil
	}
	parts := make([]map[string]any, 0, len(message.GetParts()))
	for _, part := range message.GetParts() {
		switch part.GetType() {
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT:
			if text := strings.TrimSpace(part.GetText()); text != "" {
				parts = append(parts, map[string]any{"type": "text", "text": text})
			}
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
			if imageURL := strings.TrimSpace(part.GetImageUrl().GetUrl()); imageURL != "" {
				image := map[string]any{"url": imageURL}
				if detail := strings.TrimSpace(part.GetImageUrl().GetDetail()); detail != "" {
					image["detail"] = detail
				}
				parts = append(parts, map[string]any{"type": "image_url", "image_url": image})
			}
		}
	}
	if len(parts) > 0 {
		projected["content"] = parts
	}
	return projected, len(parts) > 0, nil
}

func projectLlamaTextTurnMessage(message *runtimev1.ChatMessage) (map[string]any, bool, error) {
	if message.GetContent() != "" || len(message.GetParts()) != 0 {
		return nil, false, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("ordered text turn items conflict with content or parts"))
	}
	role := strings.TrimSpace(message.GetRole())
	if role != "assistant" && role != "tool" {
		return nil, false, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("ordered text turn items require assistant or tool role"))
	}
	var text strings.Builder
	for _, item := range message.GetTurnItems() {
		if item == nil {
			return nil, false, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("ordered text turn item is missing"))
		}
		if output := item.GetOutput(); output != nil {
			if role != "assistant" {
				return nil, false, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("tool turn cannot contain text output items"))
			}
			switch value := output.GetItem().(type) {
			case *runtimev1.TextOutputItem_Text:
				if value.Text == nil {
					return nil, false, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("text output item is missing"))
				}
				text.WriteString(value.Text.GetText())
			case *runtimev1.TextOutputItem_ToolCall:
				if value.ToolCall == nil {
					return nil, false, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("tool call output item is missing"))
				}
				return nil, false, invocationError(InvocationFailureTextBehaviorUnsupported, fmt.Errorf("llama text behavior adapter does not support tool-call transcript items"))
			case *runtimev1.TextOutputItem_ReasoningSummary:
				return nil, false, invocationError(InvocationFailureTextBehaviorUnsupported, fmt.Errorf("llama text behavior adapter does not support reasoning summary transcript items"))
			case *runtimev1.TextOutputItem_ReasoningContinuity:
				return nil, false, invocationError(InvocationFailureTextBehaviorUnsupported, fmt.Errorf("llama text behavior adapter does not support reasoning continuity transcript items"))
			default:
				return nil, false, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("text output item kind is unspecified"))
			}
			continue
		}
		if result := item.GetToolResult(); result != nil {
			if role != "tool" {
				return nil, false, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("assistant turn cannot contain tool result items"))
			}
			if result.GetPreliminary() {
				return nil, false, invocationError(InvocationFailureTextBehaviorUnsupported, fmt.Errorf("llama text behavior adapter does not support preliminary tool-result fragments"))
			}
			return nil, false, invocationError(InvocationFailureTextBehaviorUnsupported, fmt.Errorf("llama text behavior adapter does not support tool-result transcript items"))
		}
		return nil, false, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("ordered text turn item kind is unspecified"))
	}
	content := strings.TrimSpace(text.String())
	if content == "" {
		return nil, false, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("ordered assistant text turn has no renderable output"))
	}
	projected := map[string]any{"role": role, "content": content}
	if name := strings.TrimSpace(message.GetName()); name != "" {
		projected["name"] = name
	}
	return projected, true, nil
}

func invocationError(kind InvocationFailureKind, err error) error {
	return &InvocationError{Kind: kind, Err: err}
}

type portableConfig struct {
	contextSize    int
	cacheTypeK     string
	cacheTypeV     string
	flashAttention *bool
	gpuLayers      *int
}

func parsePortableConfig(value *structpb.Struct, _ bool) (portableConfig, runtimev1.LocalCapabilityReason) {
	result := portableConfig{}
	if value == nil {
		return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
	fields := value.GetFields()
	for key := range fields {
		switch key {
		case "contextSize", "cacheTypeK", "cacheTypeV", "flashAttention", "gpuLayers":
		default:
			return portableConfig{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
	}
	var reason runtimev1.LocalCapabilityReason
	if reason = validatePortableExecutionOptions(fields); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return portableConfig{}, reason
	}
	if value, exists := fields["contextSize"]; exists {
		result.contextSize = int(value.GetNumberValue())
	}
	if value, exists := fields["cacheTypeK"]; exists {
		result.cacheTypeK = value.GetStringValue()
	}
	if value, exists := fields["cacheTypeV"]; exists {
		result.cacheTypeV = value.GetStringValue()
	}
	if value, exists := fields["flashAttention"]; exists {
		enabled := value.GetBoolValue()
		result.flashAttention = &enabled
	}
	if value, exists := fields["gpuLayers"]; exists {
		layers := int(value.GetNumberValue())
		result.gpuLayers = &layers
	}
	return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func validatePortableExecutionOptions(fields map[string]*structpb.Value) runtimev1.LocalCapabilityReason {
	if value, exists := fields["contextSize"]; exists && !portableIntegerInRange(value, 1) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	for _, key := range []string{"cacheTypeK", "cacheTypeV"} {
		if value, exists := fields[key]; exists {
			text, ok := portableStringValue(value)
			if !ok || !supportedCacheType(text) {
				return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
			}
		}
	}
	if value, exists := fields["flashAttention"]; exists {
		if _, ok := value.Kind.(*structpb.Value_BoolValue); !ok {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
	}
	if value, exists := fields["gpuLayers"]; exists && !portableIntegerInRange(value, -1) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func portableIntegerInRange(value *structpb.Value, minimum float64) bool {
	const maximum = float64(1<<31 - 1)
	if value == nil {
		return false
	}
	if _, ok := value.Kind.(*structpb.Value_NumberValue); !ok {
		return false
	}
	number := value.GetNumberValue()
	return !math.IsNaN(number) && !math.IsInf(number, 0) && math.Trunc(number) == number && number >= minimum && number <= maximum
}

func portableStringValue(value *structpb.Value) (string, bool) {
	if value == nil {
		return "", false
	}
	if _, ok := value.Kind.(*structpb.Value_StringValue); !ok {
		return "", false
	}
	return value.GetStringValue(), true
}

func supportedCacheType(value string) bool {
	switch value {
	case "f32", "f16", "bf16", "q8_0", "q4_0":
		return true
	default:
		return false
	}
}

func portableString(fields map[string]*structpb.Value, key string) (string, runtimev1.LocalCapabilityReason) {
	value, exists := fields[key]
	if !exists {
		return "", runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
	text, isString := portableStringValue(value)
	if !isString {
		return "", runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	return text, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func normalizedFeatures(features []string) ([]string, runtimev1.LocalCapabilityReason) {
	set := map[string]struct{}{}
	for _, feature := range features {
		if feature != inputImageFeature {
			return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
		}
		set[feature] = struct{}{}
	}
	result := make([]string, 0, len(set))
	for feature := range set {
		result = append(result, feature)
	}
	sort.Strings(result)
	return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func llamaRequirement(id string, role runtimev1.LocalCapabilityRequirementRole, resourceKind, artifactRole, displayLabel string) *runtimev1.LocalCapabilityRequirement {
	constraintFields := map[string]any{"artifact_role": artifactRole}
	if id == MainGGUFRequirementID {
		constraintFields["engine"] = "llama"
	}
	constraints, _ := structpb.NewStruct(constraintFields)
	return &runtimev1.LocalCapabilityRequirement{
		RequirementId:            id,
		Role:                     role,
		ResourceKind:             resourceKind,
		Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
		CompatibilityConstraints: constraints,
		OccurrenceOrdinal:        0,
		DisplayLabel:             displayLabel,
		Presence:                 runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
	}
}

func llamaCompatible(requirement *runtimev1.LocalCapabilityRequirement, asset ModelAssetDescriptor) bool {
	switch requirement.GetRequirementId() {
	case MainGGUFRequirementID:
		return asset.Kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT && asset.Engine == "llama" && contains(asset.ArtifactRoles, "llm")
	case CompanionMMProjRequirementID:
		return asset.Kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY && contains(asset.ArtifactRoles, "mmproj")
	default:
		return false
	}
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
