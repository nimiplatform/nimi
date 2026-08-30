package capabilitydriver

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
	"google.golang.org/protobuf/types/known/structpb"
)

const llamaEmbedModelAlias = "nimi-selected-local-embedding"

// LlamaEmbedDriver owns the exact llama.cpp text.embed configuration and
// invocation dialect. It shares no route, machine-selection, asset-discovery,
// process, endpoint, or fallback authority with the llama ExecutionHost.
type LlamaEmbedDriver struct{}

func (LlamaEmbedDriver) ImplementationSupportedFeatures(recipeID string) ([]string, runtimev1.LocalCapabilityReason) {
	if strings.TrimSpace(recipeID) != LlamaEmbedGGUFRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (LlamaEmbedDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}

func (driver LlamaEmbedDriver) ProjectRecipe(recipeID string, options *structpb.Struct, supportedFeatures []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if len(driver.recipeModelArchitectures(recipeID, EmbeddingGGUFRequirementID)) == 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return driver.Interpret(InterpretInput{RecipeID: recipeID, PortableConfig: options, SupportedFeatures: supportedFeatures})
}

func (LlamaEmbedDriver) recipeModelArchitectures(recipeID string, slotID string) []string {
	if strings.TrimSpace(recipeID) != LlamaEmbedGGUFRecipeID || slotID != EmbeddingGGUFRequirementID {
		return nil
	}
	return []string{"bert", "nomic-bert", "qwen3"}
}

func (driver LlamaEmbedDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	probe := input.Entry.FormatProbe
	if filepath.Ext(strings.ToLower(input.Entry.RelativePath)) != ".gguf" || len(probe) < 4 || len(probe) > MaxAssetFormatProbeBytes || !bytes.Equal(probe[:4], []byte("GGUF")) {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	summary, err := ggufmeta.InspectLLMMetadata(bytes.NewReader(probe))
	if err != nil || !contains(driver.recipeModelArchitectures(input.RecipeID, EmbeddingGGUFRequirementID), ggufmeta.LLMDetectedArchitecture(summary)) {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	contextWindow, _ := ggufmeta.LLMContextLength(summary)
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{
		Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING, Engine: "llama", ArtifactRoles: []string{"embedding"}, FormatProbe: probe,
	}, contextWindow, driver.ValidateBinding)
}

func (LlamaEmbedDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if len(input.SupportedFeatures) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	_, reason := parsePortableConfig(input.PortableConfig, false)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, reason
	}
	return []*runtimev1.LocalCapabilityRequirement{llamaRequirement(
		EmbeddingGGUFRequirementID,
		runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		"gguf",
		"embedding",
		"Embedding model",
	)}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (LlamaEmbedDriver) ValidateBinding(
	requirement *runtimev1.LocalCapabilityRequirement,
	binding *runtimev1.ModelAssetExactBinding,
	asset ModelAssetDescriptor,
) runtimev1.LocalCapabilityReason {
	if requirement == nil || binding == nil ||
		requirement.GetRequirementId() != EmbeddingGGUFRequirementID ||
		binding.GetRequirementId() != requirement.GetRequirementId() {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if binding.GetModelAssetId() == "" || asset.ModelAssetID == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if binding.GetVerifiedContentId() == "" || binding.GetEntrySha256() == "" ||
		asset.VerifiedContentID == "" || asset.EntrySHA256 == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED
	}
	if binding.GetModelAssetId() != asset.ModelAssetID ||
		binding.GetVerifiedContentId() != asset.VerifiedContentID ||
		binding.GetEntrySha256() != asset.EntrySHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	if asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING ||
		asset.Engine != "llama" || !contains(asset.ArtifactRoles, "embedding") {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver LlamaEmbedDriver) ValidateCombination(
	requirements []*runtimev1.LocalCapabilityRequirement,
	bindings []*runtimev1.ModelAssetExactBinding,
	assets []ModelAssetDescriptor,
) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 {
		if len(requirements) == 0 || len(bindings) < len(requirements) {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
		}
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if len(bindings) != 1 {
		if len(bindings) == 0 {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
		}
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if len(assets) != 1 {
		if len(assets) == 0 {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
		}
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return driver.ValidateBinding(requirements[0], bindings[0], assets[0])
}

func (driver LlamaEmbedDriver) PlanEmbedInvocation(input EmbedInvocationInput) (*EmbedInvocationPlan, error) {
	binding, err := exactLlamaEmbedInvocationBinding(input.ExactBindings)
	if err != nil {
		return nil, invocationError(InvocationFailureInvalidBinding, err)
	}
	portable, reason := parsePortableConfig(input.PortableConfig, false)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("llama embedding portable config: %s", reason.String()))
	}
	requestBody, inputCount, err := llamaEmbedRequestBody(input.Request)
	if err != nil {
		return nil, err
	}
	contextWindow, err := (LlamaTextDriver{}).TextContextWindow(input.PortableConfig, input.ModelContextWindowTokens)
	if err != nil {
		return nil, err
	}

	processArgs := []string{
		"--model", binding.AbsolutePath,
		"--alias", llamaEmbedModelAlias,
		"--ctx-size", strconv.FormatUint(contextWindow, 10),
		"--ubatch-size", strconv.FormatUint(contextWindow, 10),
		"--embedding",
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
	for _, value := range invocationExactBindingIdentity(binding) {
		_, _ = hash.Write([]byte(value))
		_, _ = hash.Write([]byte{0})
	}
	for _, source := range input.ExactDependencySources {
		for _, value := range invocationExactDependencySourceIdentity(source) {
			_, _ = hash.Write([]byte(value))
			_, _ = hash.Write([]byte{0})
		}
	}
	return &EmbedInvocationPlan{
		processKey:        hex.EncodeToString(hash.Sum(nil)),
		processArgs:       processArgs,
		modelFiles:        cloneInvocationExactBindings([]InvocationExactBinding{binding}),
		dependencySources: cloneInvocationExactDependencySources(input.ExactDependencySources),
		requestPath:       "/v1/embeddings",
		requestBody:       requestBody,
		expectedCount:     inputCount,
	}, nil
}

func exactLlamaEmbedInvocationBinding(values []InvocationExactBinding) (InvocationExactBinding, error) {
	if len(values) != 1 {
		return InvocationExactBinding{}, fmt.Errorf("llama embedding invocation requires exactly one binding")
	}
	binding := values[0]
	if binding.RequirementID != EmbeddingGGUFRequirementID ||
		binding.ModelAssetID == "" || binding.ModelAssetID != strings.TrimSpace(binding.ModelAssetID) ||
		binding.VerifiedContentID == "" || binding.VerifiedContentID != strings.TrimSpace(binding.VerifiedContentID) ||
		binding.EntrySHA256 == "" || binding.EntrySHA256 != strings.TrimSpace(binding.EntrySHA256) ||
		!canonicalInvocationSHA256(binding.VerifiedContentID, binding.EntrySHA256) ||
		!filepath.IsAbs(binding.AbsolutePath) || filepath.Clean(binding.AbsolutePath) != binding.AbsolutePath {
		return InvocationExactBinding{}, fmt.Errorf("llama embedding invocation binding is not exact")
	}
	return cloneInvocationExactBindings([]InvocationExactBinding{binding})[0], nil
}

func llamaEmbedRequestBody(spec *runtimev1.TextEmbedScenarioSpec) ([]byte, int, error) {
	if spec == nil || len(spec.GetInputs()) == 0 {
		return nil, 0, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("text.embed inputs are required"))
	}
	if len(spec.GetInputs()) > CloudEmbedMaxInputsPerRequest {
		return nil, 0, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("text.embed supports at most %d inputs per request", CloudEmbedMaxInputsPerRequest))
	}
	inputs := make([]string, 0, len(spec.GetInputs()))
	for _, input := range spec.GetInputs() {
		trimmed := strings.TrimSpace(input)
		if trimmed == "" {
			return nil, 0, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("text.embed inputs must be non-empty"))
		}
		inputs = append(inputs, trimmed)
	}
	payload, err := json.Marshal(map[string]any{
		"input":           inputs,
		"model":           llamaEmbedModelAlias,
		"encoding_format": "float",
	})
	if err != nil {
		return nil, 0, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("encode llama embedding request: %w", err))
	}
	return payload, len(inputs), nil
}
