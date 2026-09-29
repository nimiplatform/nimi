package capabilitydriver

import (
	"encoding/json"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r127
const (
	GroundingDinoImplementationID = "local.vision.locate.grounding-dino-tiny"
	GroundingDinoDriverID         = "nimi.runtime.driver.grounding-dino"
	GroundingDinoDriverDialect    = "grounding-dino/vision-locate/box-v1"
	GroundingDinoRecipeID         = "grounding-dino-tiny.vision-locate.box-v1"
	GroundingDinoModelSlot        = "vision.model"
	GroundingDinoConsumerID       = "vision.grounding-dino.python"
	GroundingDinoBackend          = "grounding-dino-transformers"
	GroundingDinoProtocol         = "nimi-vision-grounding-dino/1"
)

type GroundingDinoDriver struct{}

func (GroundingDinoDriver) ImplementationSupportedFeatures(recipeID string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipeID != GroundingDinoRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (GroundingDinoDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}

func (driver GroundingDinoDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.ProjectRecipe(input.RecipeID, input.PortableConfig, input.SupportedFeatures)
}

func (driver GroundingDinoDriver) ProjectRecipe(recipeID string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.ProjectRecipeForHost(recipeID, options, features, "windows/amd64")
}

func (GroundingDinoDriver) ProjectRecipeForHost(recipeID string, options *structpb.Struct, features []string, _ string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if recipeID != GroundingDinoRecipeID || len(options.GetFields()) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(features) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	constraints, _ := structpb.NewStruct(map[string]any{
		"format": "safetensors", "model_type": "grounding-dino", "driver_backend": GroundingDinoBackend,
	})
	return []*runtimev1.LocalCapabilityRequirement{{
		RequirementId: GroundingDinoModelSlot,
		Role:          runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		Presence:      runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
		ResourceKind:  "vision", DisplayLabel: "Grounding DINO Tiny model",
		Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
		CompatibilityConstraints: constraints,
	}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver GroundingDinoDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	invalid := runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	if input.RecipeID != GroundingDinoRecipeID || input.Requirement.GetRequirementId() != GroundingDinoModelSlot || input.Entry.RelativePath != "model.safetensors" ||
		input.Requirement.GetCompatibilityConstraints().GetFields()["driver_backend"].GetStringValue() != GroundingDinoBackend {
		return ModelAssetBindingProjection{}, invalid
	}
	config, ok := modelAssetFileFact(input, "config.json")
	if !ok {
		return ModelAssetBindingProjection{}, invalid
	}
	var modelConfig struct {
		ModelType     string   `json:"model_type"`
		Architectures []string `json:"architectures"`
		DModel        int      `json:"d_model"`
		Backbone      struct {
			ModelType string `json:"model_type"`
		} `json:"backbone_config"`
		Text struct {
			ModelType string `json:"model_type"`
		} `json:"text_config"`
		Quantization json.RawMessage `json:"quantization_config"`
		AutoMap      json.RawMessage `json:"auto_map"`
	}
	if json.Unmarshal(config.FormatProbe, &modelConfig) != nil || modelConfig.ModelType != "grounding-dino" ||
		!contains(modelConfig.Architectures, "GroundingDinoForObjectDetection") || modelConfig.DModel != 256 ||
		modelConfig.Backbone.ModelType != "swin" || modelConfig.Text.ModelType != "bert" ||
		len(modelConfig.Quantization) != 0 || len(modelConfig.AutoMap) != 0 {
		return ModelAssetBindingProjection{}, invalid
	}
	for _, name := range []string{"preprocessor_config.json", "tokenizer_config.json", "tokenizer.json", "vocab.txt", "special_tokens_map.json", "added_tokens.json"} {
		if _, ok := modelAssetFileFact(input, name); !ok {
			return ModelAssetBindingProjection{}, invalid
		}
	}
	tensors, ok := safetensorsTensorFacts(input.Entry.FormatProbe)
	if !ok {
		return ModelAssetBindingProjection{}, invalid
	}
	for name, shape := range map[string][]int64{
		"model.backbone.conv_encoder.model.embeddings.patch_embeddings.projection.weight": {96, 3, 4, 4},
		"model.text_backbone.embeddings.word_embeddings.weight":                           {30522, 768},
		"model.decoder.layers.0.fc1.weight":                                               {2048, 256},
		"bbox_embed.0.layers.0.weight":                                                    {256, 256},
	} {
		fact, exists := tensors[name]
		if !exists || fact.DType != "F32" || !int64SlicesEqual(fact.Shape, shape) {
			return ModelAssetBindingProjection{}, invalid
		}
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{
		Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VISION, Family: "grounding-dino-tiny",
		ArtifactRoles: []string{"vision_model"}, FormatProbe: input.Entry.FormatProbe,
	}, 0, driver.ValidateBinding)
}

func (GroundingDinoDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement.GetRequirementId() != GroundingDinoModelSlot || binding.GetRequirementId() != GroundingDinoModelSlot {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if binding.GetModelAssetId() == "" || binding.GetModelAssetId() != asset.ModelAssetID {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if binding.GetVerifiedContentId() == "" || binding.GetEntrySha256() == "" ||
		binding.GetVerifiedContentId() != asset.VerifiedContentID || binding.GetEntrySha256() != asset.EntrySHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	if asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VISION || asset.Family != "grounding-dino-tiny" || !contains(asset.ArtifactRoles, "vision_model") {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver GroundingDinoDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 || len(bindings) != 1 || len(assets) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return driver.ValidateBinding(requirements[0], bindings[0], assets[0])
}

func (GroundingDinoDriver) SupportsGeometry(geometry runtimev1.VisionLocateGeometry) bool {
	return geometry == runtimev1.VisionLocateGeometry_VISION_LOCATE_GEOMETRY_BOX
}

func (GroundingDinoDriver) PlanVisionLocateInvocation(input VisionLocateInvocationInput) (*VisionLocateInvocationPlan, error) {
	if input.RecipeID != GroundingDinoRecipeID || input.PlatformTuple != "windows/amd64" || input.Request == nil ||
		input.Request.Geometry != runtimev1.VisionLocateGeometry_VISION_LOCATE_GEOMETRY_BOX || len(input.Bindings) != 1 ||
		input.Bindings[0].RequirementID != GroundingDinoModelSlot {
		return nil, fmt.Errorf("Grounding DINO box invocation has incomplete captured input")
	}
	return planVisionLocateInvocation(input, GroundingDinoBackend, GroundingDinoConsumerID, GroundingDinoProtocol)
}
