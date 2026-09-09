package capabilitydriver

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.local-compute.r116
const (
	VisionLocateContract           = "vision.locate"
	LocateAnythingImplementationID = "local.vision.locate.locateanything"
	LocateAnythingDriverID         = "nimi.runtime.driver.locateanything"
	LocateAnythingDriverDialect    = "locateanything/vision-locate/v1"
	LocateAnythingRecipeID         = "locateanything.vision-locate.v1"
	LocateAnythingModelSlot        = "vision.model"
	LocateAnythingConsumerID       = "vision.locateanything.python"
	LocateAnythingProtocol         = "nimi-vision-locate/1"
)

type LocateAnythingDriver struct{}

func (LocateAnythingDriver) ImplementationSupportedFeatures(recipeID string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipeID != LocateAnythingRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (LocateAnythingDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}

func (driver LocateAnythingDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.ProjectRecipe(input.RecipeID, input.PortableConfig, input.SupportedFeatures)
}

func (driver LocateAnythingDriver) ProjectRecipe(recipeID string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.ProjectRecipeForHost(recipeID, options, features, "windows/amd64")
}

func (LocateAnythingDriver) ProjectRecipeForHost(recipeID string, options *structpb.Struct, features []string, platformTuple string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if recipeID != LocateAnythingRecipeID || len(options.GetFields()) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(features) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	backend, err := LocateAnythingBackendForPlatform(platformTuple)
	if err != nil {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	constraints, _ := structpb.NewStruct(map[string]any{
		"format": "safetensors", "model_type": "locateanything", "driver_backend": backend,
	})
	return []*runtimev1.LocalCapabilityRequirement{{
		RequirementId: LocateAnythingModelSlot,
		Role:          runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		Presence:      runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
		ResourceKind:  "vision", DisplayLabel: "LocateAnything model",
		Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
		CompatibilityConstraints: constraints,
	}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func LocateAnythingBackendForPlatform(platformTuple string) (string, error) {
	switch platformTuple {
	case "windows/amd64":
		return "transformers", nil
	case "darwin/arm64":
		return "mlx", nil
	default:
		return "", fmt.Errorf("LocateAnything is not supported on %s", platformTuple)
	}
}

func (driver LocateAnythingDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	invalid := runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	if input.RecipeID != LocateAnythingRecipeID || input.Requirement.GetRequirementId() != LocateAnythingModelSlot || filepath.Ext(input.Entry.RelativePath) != ".safetensors" {
		return ModelAssetBindingProjection{}, invalid
	}
	backend := input.Requirement.GetCompatibilityConstraints().GetFields()["driver_backend"].GetStringValue()
	if backend != "transformers" && backend != "mlx" {
		return ModelAssetBindingProjection{}, invalid
	}
	config, ok := modelAssetFileFact(input, "config.json")
	if !ok {
		return ModelAssetBindingProjection{}, invalid
	}
	var modelConfig struct {
		ModelType     string          `json:"model_type"`
		Architectures []string        `json:"architectures"`
		ModelFile     json.RawMessage `json:"model_file"`
		TextConfig    struct {
			HiddenSize int `json:"hidden_size"`
			VocabSize  int `json:"vocab_size"`
		} `json:"text_config"`
		VisionConfig struct {
			HiddenSize int `json:"hidden_size"`
			PatchSize  int `json:"patch_size"`
		} `json:"vision_config"`
		Quantization json.RawMessage `json:"quantization"`
	}
	if json.Unmarshal(config.FormatProbe, &modelConfig) != nil || modelConfig.ModelType != "locateanything" ||
		!contains(modelConfig.Architectures, "LocateAnythingForConditionalGeneration") ||
		modelConfig.TextConfig.HiddenSize != 2048 || modelConfig.TextConfig.VocabSize < 152681 ||
		modelConfig.VisionConfig.HiddenSize != 1152 || modelConfig.VisionConfig.PatchSize != 14 {
		return ModelAssetBindingProjection{}, invalid
	}
	// MLX-VLM 0.7.0 honors model_file independently of trust_remote_code.
	// ModelAsset files must never select executable loader code.
	if backend == "mlx" && len(modelConfig.ModelFile) != 0 {
		return ModelAssetBindingProjection{}, invalid
	}
	if backend == "transformers" && len(modelConfig.Quantization) != 0 && string(modelConfig.Quantization) != "null" {
		return ModelAssetBindingProjection{}, invalid
	}
	for _, name := range []string{"tokenizer_config.json", "preprocessor_config.json"} {
		if _, exists := modelAssetFileFact(input, name); !exists {
			return ModelAssetBindingProjection{}, invalid
		}
	}
	if _, exists := modelAssetFileFact(input, "tokenizer.json"); !exists {
		for _, name := range []string{"vocab.json", "merges.txt"} {
			if _, exists := modelAssetFileFact(input, name); !exists {
				return ModelAssetBindingProjection{}, invalid
			}
		}
	}
	tensorGroups := map[string]bool{}
	shards := make(map[string]map[string]safetensorsTensorFact)
	for _, file := range input.Files {
		if filepath.Ext(file.RelativePath) != ".safetensors" {
			continue
		}
		tensors, valid := safetensorsTensorFacts(file.FormatProbe)
		if !valid {
			return ModelAssetBindingProjection{}, invalid
		}
		shards[file.RelativePath] = tensors
		for name := range tensors {
			for _, prefix := range []string{"language_model.", "vision_model.", "mlp1.", "vision_tower.", "multi_modal_projector."} {
				if strings.HasPrefix(name, prefix) {
					tensorGroups[prefix] = true
				}
			}
		}
	}
	if index, exists := modelAssetFileFact(input, "model.safetensors.index.json"); exists {
		var declared struct {
			WeightMap map[string]string `json:"weight_map"`
		}
		if json.Unmarshal(index.FormatProbe, &declared) != nil || len(declared.WeightMap) == 0 {
			return ModelAssetBindingProjection{}, invalid
		}
		for name, shard := range declared.WeightMap {
			if _, exists := shards[shard][name]; !exists {
				return ModelAssetBindingProjection{}, invalid
			}
		}
	}
	if !tensorGroups["language_model."] || (backend == "transformers" && (!tensorGroups["vision_model."] || !tensorGroups["mlp1."])) ||
		(backend == "mlx" && (!tensorGroups["vision_tower."] || !tensorGroups["multi_modal_projector."])) {
		return ModelAssetBindingProjection{}, invalid
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{
		Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VISION, Family: "locateanything",
		ArtifactRoles: []string{"vision_model"}, FormatProbe: input.Entry.FormatProbe,
	}, 0, driver.ValidateBinding)
}

func (LocateAnythingDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement.GetRequirementId() != LocateAnythingModelSlot || binding.GetRequirementId() != LocateAnythingModelSlot {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if binding.GetModelAssetId() == "" || binding.GetModelAssetId() != asset.ModelAssetID {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if binding.GetVerifiedContentId() == "" || binding.GetEntrySha256() == "" ||
		binding.GetVerifiedContentId() != asset.VerifiedContentID || binding.GetEntrySha256() != asset.EntrySHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	if asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VISION || asset.Family != "locateanything" || !contains(asset.ArtifactRoles, "vision_model") {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver LocateAnythingDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 || len(bindings) != 1 || len(assets) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return driver.ValidateBinding(requirements[0], bindings[0], assets[0])
}

type VisionLocateInvocationInput struct {
	RecipeID          string
	PlatformTuple     string
	Request           *runtimev1.VisionLocateScenarioSpec
	ImageBytes        []byte
	Width, Height     uint32
	Bindings          []InvocationExactBinding
	DependencySources []InvocationExactDependencySource
}

type VisionLocateInvocationPlan struct {
	Backend            string
	ProfileRoot        string
	ProfileDigest      string
	DriverBundleDigest string
	DriverProtocol     string
	Request            *runtimev1.VisionLocateScenarioSpec
	ImageBytes         []byte
	Width, Height      uint32
	Binding            InvocationExactBinding
	DependencySources  []InvocationExactDependencySource
}

func (LocateAnythingDriver) PlanVisionLocateInvocation(input VisionLocateInvocationInput) (*VisionLocateInvocationPlan, error) {
	if input.RecipeID != LocateAnythingRecipeID || len(input.Bindings) != 1 ||
		input.Bindings[0].RequirementID != LocateAnythingModelSlot || input.Request == nil ||
		len(input.ImageBytes) == 0 || input.Width == 0 || input.Height == 0 {
		return nil, fmt.Errorf("Locate invocation has incomplete captured input")
	}
	backend, err := LocateAnythingBackendForPlatform(input.PlatformTuple)
	if err != nil {
		return nil, err
	}
	var profile *InvocationExactDependencySource
	for index := range input.DependencySources {
		source := &input.DependencySources[index]
		if source.DependencyFamily == "python.package-set" && source.ConsumerScope == LocateAnythingConsumerID {
			if profile != nil {
				return nil, fmt.Errorf("Locate profile capture is ambiguous")
			}
			profile = source
		}
	}
	if profile == nil || !filepath.IsAbs(profile.CanonicalRoot) || profile.SelectedSourceRecordID == "" ||
		profile.Hashes["profile_digest"] == "" || profile.Hashes["driver_bundle_sha256"] == "" ||
		profile.Version != profile.Hashes["profile_digest"] {
		return nil, fmt.Errorf("Locate invocation has no exact managed profile")
	}
	return &VisionLocateInvocationPlan{
		Backend: backend, Request: proto.Clone(input.Request).(*runtimev1.VisionLocateScenarioSpec),
		ProfileRoot: profile.CanonicalRoot, ProfileDigest: profile.Version,
		DriverBundleDigest: profile.Hashes["driver_bundle_sha256"], DriverProtocol: LocateAnythingProtocol,
		ImageBytes: append([]byte(nil), input.ImageBytes...), Width: input.Width, Height: input.Height,
		Binding:           cloneInvocationExactBindings(input.Bindings)[0],
		DependencySources: cloneInvocationExactDependencySources(input.DependencySources),
	}, nil
}
