package capabilitydriver

import (
	"encoding/json"
	"fmt"
	"path"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.laya-local-decision
const (
	TextDecideContract   = aicapabilities.TextDecide
	LayaImplementationID = "local.text.decide.laya"
	LayaDriverID         = "nimi.runtime.driver.laya"
	LayaDriverDialect    = "laya/text-decide/v1"
	LayaModelSlot        = "decision.model"
	LayaConsumerID       = "text.laya.python"
	LayaProtocol         = "nimi-text-decide/1"
	LayaModelFamily      = "laya"
	LayaModelFormat      = "laya"
	LayaArtifactRole     = "decision_model"
)

// Checkpoint files the Laya decision model definition consumes, relative to
// the checkpoint directory that contains the model.safetensors entry.
const (
	layaWeightsFile         = "model.safetensors"
	layaAgentConfigFile     = "rl_agent_config.json"
	layaEncoderConfigFile   = "encoder/config.json"
	layaTokenizerFile       = "tokenizer/tokenizer.json"
	layaTokenizerConfigFile = "tokenizer/tokenizer_config.json"
	layaConfigProbeBytes    = 64 << 10
	layaMaxHeadLayers       = 16
	layaMaxEncoderPositions = 1 << 20
)

var layaRequiredCheckpointFiles = []string{layaAgentConfigFile, layaEncoderConfigFile, layaTokenizerFile, layaTokenizerConfigFile}

// Each Laya recipe recommends one purpose-specific checkpoint (English typed
// decisions, multilingual, browser steps); all share this Driver dialect and
// its single decision.model slot.
const (
	LayaTypedDecisionsRecipeID = "laya-typed-decisions"
	LayaMultilingualRecipeID   = "laya-multilingual"
	LayaBrowserV10sRecipeID    = "laya-browser-v10s"
)

func IsLayaRecipe(recipeID string) bool {
	switch recipeID {
	case LayaTypedDecisionsRecipeID, LayaMultilingualRecipeID, LayaBrowserV10sRecipeID:
		return true
	}
	return false
}

// LayaDriver projects one exact Laya checkpoint ModelAsset for text.decide.
// It owns checkpoint admission and invocation planning only; Runtime owns
// route, selection, capture and the resident execution Host.
type LayaDriver struct{}

func layaRegistrationKey() RegistrationKey {
	return RegistrationKey{CapabilityContract: TextDecideContract, Identity: Identity{ImplementationID: LayaImplementationID, DriverID: LayaDriverID, DriverDialect: LayaDriverDialect}}
}

func (LayaDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string { return nil }

func (LayaDriver) ImplementationSupportedFeatures(recipeID string) ([]string, runtimev1.LocalCapabilityReason) {
	if !IsLayaRecipe(recipeID) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver LayaDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.ProjectRecipe(input.RecipeID, input.PortableConfig, input.SupportedFeatures)
}

func (LayaDriver) ProjectRecipe(recipeID string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if !IsLayaRecipe(recipeID) || len(options.GetFields()) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(features) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	constraints, _ := structpb.NewStruct(map[string]any{"format": LayaModelFormat, "family": LayaModelFamily, "artifact_role": LayaArtifactRole})
	return []*runtimev1.LocalCapabilityRequirement{{
		RequirementId: LayaModelSlot, DisplayLabel: "Laya decision checkpoint", ResourceKind: "auxiliary",
		Role:                     runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		Presence:                 runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
		Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
		CompatibilityConstraints: constraints,
	}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

// ModelAssetFormatProbeBytes bounds the verified prefixes Runtime exposes:
// complete small JSON configurations, the safetensors header of the entry,
// and presence-only prefixes for everything else.
func (LayaDriver) ModelAssetFormatProbeBytes(input ModelAssetFormatProbeInput) int64 {
	if input.Entry {
		return MaxAssetFormatProbeBytes
	}
	for _, name := range []string{layaAgentConfigFile, layaEncoderConfigFile, layaTokenizerConfigFile} {
		if input.RelativePath == name || strings.HasSuffix(input.RelativePath, "/"+name) {
			return layaConfigProbeBytes
		}
	}
	return 4096
}

// layaCheckpointPrefix returns the slash-terminated directory holding the
// model.safetensors entry ("" when the checkpoint is the ModelAsset root).
func layaCheckpointPrefix(entry string) (string, bool) {
	if entry == "" || path.Base(entry) != layaWeightsFile || strings.Contains(entry, "\\") || path.Clean(entry) != entry || path.IsAbs(entry) || strings.HasPrefix(entry, "../") {
		return "", false
	}
	dir := path.Dir(entry)
	if dir == "." {
		return "", true
	}
	return dir + "/", true
}

type layaAgentConfig struct {
	Encoder              string                     `json:"encoder"`
	HeadLayers           *int                       `json:"head_layers"`
	ActCosts             map[string]json.RawMessage `json:"act_costs"`
	Temperature          []json.RawMessage          `json:"temperature"`
	TemperatureByOptions map[string]json.RawMessage `json:"temperature_by_options"`
}

type layaEncoderConfig struct {
	ModelType             string          `json:"model_type"`
	MaxPositionEmbeddings int             `json:"max_position_embeddings"`
	HiddenSize            int             `json:"hidden_size"`
	AutoMap               json.RawMessage `json:"auto_map"`
}

type layaTokenizerConfig struct {
	TokenizerClass string          `json:"tokenizer_class"`
	MaskToken      json.RawMessage `json:"mask_token"`
	ClsToken       json.RawMessage `json:"cls_token"`
	SepToken       json.RawMessage `json:"sep_token"`
	PadToken       json.RawMessage `json:"pad_token"`
	AutoMap        json.RawMessage `json:"auto_map"`
}

func layaStringToken(raw json.RawMessage) bool {
	var value string
	return json.Unmarshal(raw, &value) == nil && strings.TrimSpace(value) != ""
}

func (driver LayaDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	invalid := runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	if !IsLayaRecipe(input.RecipeID) || input.Requirement.GetRequirementId() != LayaModelSlot {
		return ModelAssetBindingProjection{}, invalid
	}
	prefix, ok := layaCheckpointPrefix(input.Entry.RelativePath)
	if !ok {
		return ModelAssetBindingProjection{}, invalid
	}
	facts := make(map[string]ModelAssetFileFact, len(layaRequiredCheckpointFiles))
	for _, name := range layaRequiredCheckpointFiles {
		fact, exists := modelAssetFileFact(input, prefix+name)
		if !exists {
			return ModelAssetBindingProjection{}, invalid
		}
		facts[name] = fact
	}
	var agent layaAgentConfig
	if json.Unmarshal(facts[layaAgentConfigFile].FormatProbe, &agent) != nil || strings.TrimSpace(agent.Encoder) == "" ||
		agent.HeadLayers == nil || *agent.HeadLayers < 0 || *agent.HeadLayers > layaMaxHeadLayers ||
		(agent.Temperature != nil && len(agent.Temperature) != 3) {
		return ModelAssetBindingProjection{}, invalid
	}
	var encoder layaEncoderConfig
	if json.Unmarshal(facts[layaEncoderConfigFile].FormatProbe, &encoder) != nil || encoder.ModelType != "modernbert" ||
		encoder.MaxPositionEmbeddings <= 0 || encoder.MaxPositionEmbeddings > layaMaxEncoderPositions || encoder.HiddenSize <= 0 || len(encoder.AutoMap) != 0 {
		return ModelAssetBindingProjection{}, invalid
	}
	var tokenizer layaTokenizerConfig
	if json.Unmarshal(facts[layaTokenizerConfigFile].FormatProbe, &tokenizer) != nil || tokenizer.TokenizerClass != "PreTrainedTokenizerFast" || len(tokenizer.AutoMap) != 0 ||
		!layaStringToken(tokenizer.MaskToken) || !layaStringToken(tokenizer.ClsToken) || !layaStringToken(tokenizer.SepToken) || !layaStringToken(tokenizer.PadToken) {
		return ModelAssetBindingProjection{}, invalid
	}
	tensors, valid := safetensorsTensorFacts(input.Entry.FormatProbe)
	if !valid {
		return ModelAssetBindingProjection{}, invalid
	}
	groups := map[string]bool{}
	for name := range tensors {
		for _, group := range []string{"encoder.", "type_emb.", "scorer.", "act_head.", "head."} {
			if strings.HasPrefix(name, group) {
				groups[group] = true
			}
		}
	}
	if !groups["encoder."] || !groups["type_emb."] || !groups["scorer."] || !groups["act_head."] || groups["head."] != (*agent.HeadLayers > 0) {
		return ModelAssetBindingProjection{}, invalid
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{
		Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY, Family: LayaModelFamily, ArtifactRoles: []string{LayaArtifactRole},
	}, 0, driver.ValidateBinding)
}

func (LayaDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement.GetRequirementId() != LayaModelSlot || binding.GetRequirementId() != LayaModelSlot {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if binding.GetModelAssetId() == "" || binding.GetModelAssetId() != asset.ModelAssetID {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if binding.GetVerifiedContentId() == "" || binding.GetEntrySha256() == "" ||
		binding.GetVerifiedContentId() != asset.VerifiedContentID || binding.GetEntrySha256() != asset.EntrySHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	if asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY || asset.Family != LayaModelFamily || !contains(asset.ArtifactRoles, LayaArtifactRole) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver LayaDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 || len(bindings) != 1 || len(assets) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return driver.ValidateBinding(requirements[0], bindings[0], assets[0])
}

// TextDecisionInvocationInput is the complete captured input of one Local
// text.decide invocation. It carries no route, device, port or fallback fact.
type TextDecisionInvocationInput struct {
	RecipeID          string
	Request           *runtimev1.TextDecideScenarioSpec
	Bindings          []InvocationExactBinding
	DependencySources []InvocationExactDependencySource
}

// TextDecisionInvocationPlan is the immutable Host input. ModelDir is the
// checkpoint directory of the captured entry inside its verified bundle.
type TextDecisionInvocationPlan struct {
	Request            *runtimev1.TextDecideScenarioSpec
	Binding            InvocationExactBinding
	ModelDir           string
	ProfileRoot        string
	ProfileDigest      string
	DriverBundleDigest string
	DriverProtocol     string
}

func (LayaDriver) PlanTextDecisionInvocation(input TextDecisionInvocationInput) (*TextDecisionInvocationPlan, error) {
	if !IsLayaRecipe(input.RecipeID) || input.Request == nil || len(input.Bindings) != 1 || input.Bindings[0].RequirementID != LayaModelSlot {
		return nil, fmt.Errorf("Laya decision invocation requires its captured recipe, request and one checkpoint binding")
	}
	binding := cloneInvocationExactBindings(input.Bindings)[0]
	modelDir, err := layaCheckpointDirectory(binding)
	if err != nil {
		return nil, err
	}
	var profile *InvocationExactDependencySource
	for index := range input.DependencySources {
		source := &input.DependencySources[index]
		if source.DependencyFamily == "python.package-set" && source.ConsumerScope == LayaConsumerID {
			if profile != nil {
				return nil, fmt.Errorf("Laya decision profile capture is ambiguous")
			}
			profile = source
		}
	}
	if profile == nil || !filepath.IsAbs(profile.CanonicalRoot) || filepath.Clean(profile.CanonicalRoot) != profile.CanonicalRoot || profile.SelectedSourceRecordID == "" ||
		profile.Hashes["profile_digest"] == "" || profile.Hashes["driver_bundle_sha256"] == "" || profile.Version != profile.Hashes["profile_digest"] {
		return nil, fmt.Errorf("Laya decision invocation requires an exact managed dependency profile")
	}
	return &TextDecisionInvocationPlan{
		Request: proto.Clone(input.Request).(*runtimev1.TextDecideScenarioSpec), Binding: binding, ModelDir: modelDir,
		ProfileRoot: profile.CanonicalRoot, ProfileDigest: profile.Version, DriverBundleDigest: profile.Hashes["driver_bundle_sha256"], DriverProtocol: LayaProtocol,
	}, nil
}

// layaCheckpointDirectory derives the checkpoint directory from the captured
// entry and requires every consumed checkpoint file to be a declared file of
// the same verified bundle.
func layaCheckpointDirectory(binding InvocationExactBinding) (string, error) {
	bundle, entry := binding.BundleDir, binding.AbsolutePath
	if !filepath.IsAbs(bundle) || filepath.Clean(bundle) != bundle || !filepath.IsAbs(entry) || filepath.Clean(entry) != entry ||
		binding.ModelAssetID == "" || binding.VerifiedContentID == "" || binding.EntrySHA256 == "" {
		return "", fmt.Errorf("Laya checkpoint binding is incomplete")
	}
	relative, err := filepath.Rel(bundle, entry)
	if err != nil {
		return "", fmt.Errorf("Laya checkpoint entry is outside its bundle")
	}
	relative = filepath.ToSlash(relative)
	prefix, ok := layaCheckpointPrefix(relative)
	if !ok {
		return "", fmt.Errorf("Laya checkpoint entry must be a model.safetensors file inside its bundle")
	}
	declared := make(map[string]struct{}, len(binding.DeclaredFiles))
	for _, file := range binding.DeclaredFiles {
		declared[file] = struct{}{}
	}
	for _, name := range append([]string{layaWeightsFile}, layaRequiredCheckpointFiles...) {
		if _, exists := declared[prefix+name]; !exists {
			return "", fmt.Errorf("Laya checkpoint file %s is not declared by the captured ModelAsset", prefix+name)
		}
	}
	return filepath.Dir(entry), nil
}
