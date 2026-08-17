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
	"google.golang.org/protobuf/types/known/structpb"
)

const inputImageFeature = "input.image"

// LlamaTextDriver projects only llama.cpp text resource intent.
type LlamaTextDriver struct{}

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
	case LlamaGemma4E2BRecipeID, LlamaGemma426BRecipeID:
		return []string{"gemma4"}
	default:
		return nil
	}
}

func (driver LlamaTextDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	probe := input.Entry.FormatProbe
	if filepath.Ext(strings.ToLower(input.Entry.RelativePath)) != ".gguf" || len(probe) < 4 || len(probe) > MaxAssetFormatProbeBytes || !bytes.Equal(probe[:4], []byte("GGUF")) {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	descriptor := ModelAssetDescriptor{Engine: "llama", FormatProbe: probe}
	var contextWindow uint64
	switch input.Requirement.GetRequirementId() {
	case MainGGUFRequirementID:
		summary, err := ggufmeta.InspectLLMMetadata(bytes.NewReader(probe))
		if err != nil || !contains(driver.recipeModelArchitectures(input.RecipeID, MainGGUFRequirementID), ggufmeta.LLMDetectedArchitecture(summary)) {
			return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
		contextWindow, _ = ggufmeta.LLMContextLength(summary)
		descriptor.Kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT
		descriptor.ArtifactRoles = []string{"llm"}
	case CompanionMMProjRequirementID:
		descriptor.Kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY
		descriptor.ArtifactRoles = []string{"mmproj"}
	default:
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return validatedModelAssetBindingProjection(input, descriptor, contextWindow, driver.ValidateBinding)
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

	requirements := []*runtimev1.LocalCapabilityRequirement{llamaRequirement(
		MainGGUFRequirementID,
		runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		"gguf",
		"llm",
		"Main model",
	)}
	if contains(features, inputImageFeature) {
		requirements = append(requirements, llamaRequirement(
			CompanionMMProjRequirementID,
			runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
			"mmproj",
			"mmproj",
			"Vision projector",
		))
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
	if len(requirements) == 0 || len(bindings) < len(requirements) {
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
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
		}
		if reason := driver.ValidateBinding(requirement, bindings[index], assets[index]); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			return reason
		}
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver LlamaTextDriver) PlanTextInvocation(input TextInvocationInput) (*TextInvocationPlan, error) {
	bindings, hasMMProj, err := exactLlamaInvocationBindings(input.ExactBindings)
	if err != nil {
		return nil, invocationError(InvocationFailureInvalidBinding, err)
	}
	portable, reason := parsePortableConfig(input.PortableConfig, hasMMProj)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("llama portable config: %s", reason.String()))
	}
	requestBody, err := llamaTextRequestBody(input.Request, input.Stream, hasMMProj)
	if err != nil {
		return nil, err
	}
	contextWindow, err := driver.TextContextWindow(input.PortableConfig, input.ModelContextWindowTokens)
	if err != nil {
		return nil, err
	}

	const modelAlias = "nimi-selected-local"
	processArgs := []string{
		"--reasoning", "off",
		"--model", bindings[MainGGUFRequirementID].AbsolutePath,
		"--alias", modelAlias,
		"--ctx-size", strconv.FormatUint(contextWindow, 10),
	}
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
	modelFiles := make([]InvocationExactBinding, 0, len(bindings))
	for _, requirementID := range []string{MainGGUFRequirementID, CompanionMMProjRequirementID} {
		if binding, ok := bindings[requirementID]; ok {
			modelFiles = append(modelFiles, cloneInvocationExactBindings([]InvocationExactBinding{binding})[0])
		}
	}
	return &TextInvocationPlan{
		processKey:    hex.EncodeToString(hash.Sum(nil)),
		processArgs:   processArgs,
		modelFiles:    modelFiles,
		requestPath:   "/v1/chat/completions",
		requestBody:   requestBody,
		stream:        input.Stream,
		contextWindow: contextWindow,
	}, nil
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
		projected, ok := projectLlamaTextMessage(message)
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
	if spec.GetTemperature() > 0 {
		body["temperature"] = spec.GetTemperature()
	}
	if spec.GetTopP() > 0 {
		body["top_p"] = spec.GetTopP()
	}
	if spec.GetMaxTokens() > 0 {
		body["max_tokens"] = spec.GetMaxTokens()
	}
	if spec.GetTopK() > 0 {
		body["top_k"] = spec.GetTopK()
	}
	if spec.GetPresencePenalty() != 0 {
		body["presence_penalty"] = spec.GetPresencePenalty()
	}
	if spec.GetFrequencyPenalty() != 0 {
		body["frequency_penalty"] = spec.GetFrequencyPenalty()
	}
	if len(spec.GetStop()) > 0 {
		body["stop"] = append([]string(nil), spec.GetStop()...)
	}
	if spec.GetSeed() != 0 {
		body["seed"] = spec.GetSeed()
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("encode llama text request: %w", err))
	}
	return payload, nil
}

func validateLlamaTextRequest(spec *runtimev1.TextGenerateScenarioSpec, hasMMProj bool) error {
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
	if len(spec.GetTools()) > 0 || spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED ||
		strings.TrimSpace(spec.GetToolChoiceName()) != "" || spec.GetIncludeRawChunks() {
		return invocationError(InvocationFailureUnsupported, fmt.Errorf("llama text invocation does not support the requested tool or raw-chunk surface"))
	}
	if format := spec.GetResponseFormat(); format != nil &&
		format.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED &&
		format.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT {
		return invocationError(InvocationFailureUnsupported, fmt.Errorf("llama text invocation does not support the requested response format"))
	}
	if reasoning := spec.GetReasoning(); reasoning != nil {
		if reasoning.GetMode() == runtimev1.ReasoningMode_REASONING_MODE_ON ||
			reasoning.GetTraceMode() == runtimev1.ReasoningTraceMode_REASONING_TRACE_MODE_SEPARATE ||
			reasoning.GetBudgetTokens() > 0 {
			return invocationError(InvocationFailureUnsupported, fmt.Errorf("llama text invocation does not support requested reasoning semantics"))
		}
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

func projectLlamaTextMessage(message *runtimev1.ChatMessage) (map[string]any, bool) {
	if message == nil {
		return nil, false
	}
	role := strings.TrimSpace(message.GetRole())
	if role == "" {
		role = "user"
	}
	projected := map[string]any{"role": role}
	if name := strings.TrimSpace(message.GetName()); name != "" {
		projected["name"] = name
	}
	if toolCallID := strings.TrimSpace(message.GetToolCallId()); toolCallID != "" {
		projected["tool_call_id"] = toolCallID
	}
	if len(message.GetToolCalls()) > 0 {
		toolCalls := make([]map[string]any, 0, len(message.GetToolCalls()))
		for _, call := range message.GetToolCalls() {
			if call == nil || strings.TrimSpace(call.GetName()) == "" {
				continue
			}
			toolCalls = append(toolCalls, map[string]any{
				"id":   strings.TrimSpace(call.GetId()),
				"type": "function",
				"function": map[string]any{
					"name":      strings.TrimSpace(call.GetName()),
					"arguments": call.GetArgumentsJson(),
				},
			})
		}
		if len(toolCalls) > 0 {
			projected["tool_calls"] = toolCalls
		}
	}
	if len(message.GetParts()) == 0 {
		content := strings.TrimSpace(message.GetContent())
		if content != "" {
			projected["content"] = content
		}
		_, hasToolCalls := projected["tool_calls"]
		_, hasToolCallID := projected["tool_call_id"]
		return projected, content != "" || hasToolCalls || hasToolCallID
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
	_, hasToolCalls := projected["tool_calls"]
	_, hasToolCallID := projected["tool_call_id"]
	return projected, len(parts) > 0 || hasToolCalls || hasToolCallID
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
