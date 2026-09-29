package capabilitydriver

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

const spacyTrfModelContentID = "sha256:80bfecfec7ba882fc5439ccfe1f477d659d22d9fe08a61d9d4eda646430f6a9c" // pragma: allowlist secret -- exact public model content digest
const spacyTrfConfigSHA256 = "ec6d73663a9a137377402267eaff233e24aa06ed5079af80caf01566e56e858e"          // pragma: allowlist secret -- exact public model config digest

// SpacyTrfDriver retains the annotation result contract but uses a distinct
// Model Contract and managed dependency profile from the medium pipelines.
// @nimi-authority: rule.nimi.runtime.ai-provider.spacy-local-annotation
type SpacyTrfDriver struct{ SpacyDriver }

func (SpacyTrfDriver) ImplementationSupportedFeatures(recipeID string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipeID != SpacyTrfRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver SpacyTrfDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.ProjectRecipe(input.RecipeID, input.PortableConfig, input.SupportedFeatures)
}

func (SpacyTrfDriver) ProjectRecipe(recipeID string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if recipeID != SpacyTrfRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	if len(options.GetFields()) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(features) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	constraints, _ := structpb.NewStruct(map[string]any{"family": "spacy", "language": "en", "artifact_role": "text_analysis_model", "pipeline": "curated_transformer"})
	return []*runtimev1.LocalCapabilityRequirement{{
		RequirementId: SpacyModelSlot, DisplayLabel: "English curated transformer analysis model", ResourceKind: "auxiliary",
		Role:                     runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		Presence:                 runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
		Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT,
		CompatibilityConstraints: constraints,
	}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (SpacyTrfDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	invalid := runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	if input.RecipeID != SpacyTrfRecipeID || input.Binding == nil || input.Binding.GetVerifiedContentId() != spacyTrfModelContentID ||
		input.Binding.GetEntrySha256() != spacyTrfConfigSHA256 {
		return ModelAssetBindingProjection{}, invalid
	}
	config, configOK := modelAssetFileFact(input, "config.cfg")
	metadata, metadataOK := modelAssetFileFact(input, "meta.json")
	if !configOK || !metadataOK || config.SizeBytes != int64(len(config.FormatProbe)) {
		return ModelAssetBindingProjection{}, invalid
	}
	digest := sha256.Sum256(config.FormatProbe)
	if hex.EncodeToString(digest[:]) != spacyTrfConfigSHA256 {
		return ModelAssetBindingProjection{}, invalid
	}
	var meta struct {
		Language string `json:"lang"`
		Version  string `json:"version"`
		Name     string `json:"name"`
	}
	if json.Unmarshal(metadata.FormatProbe, &meta) != nil || meta.Language != "en" || meta.Version != "3.8.0" || meta.Name != "core_web_trf" {
		return ModelAssetBindingProjection{}, invalid
	}
	for _, name := range []string{"tokenizer", "transformer/cfg", "transformer/model", "tagger/model", "parser/model", "ner/model", "vocab/strings.json"} {
		if _, exists := modelAssetFileFact(input, name); !exists {
			return ModelAssetBindingProjection{}, invalid
		}
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{
		Kind:   runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY,
		Family: "spacy", ArtifactRoles: []string{"text_analysis_model"}, FormatProbe: []byte("en"),
	}, 0, (SpacyTrfDriver{}).ValidateBinding)
}

func (SpacyTrfDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement.GetCompatibilityConstraints().GetFields()["pipeline"].GetStringValue() != "curated_transformer" ||
		binding.GetVerifiedContentId() != spacyTrfModelContentID || binding.GetEntrySha256() != spacyTrfConfigSHA256 ||
		asset.VerifiedContentID != spacyTrfModelContentID || asset.EntrySHA256 != spacyTrfConfigSHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return (SpacyDriver{}).ValidateBinding(requirement, binding, asset)
}

func (driver SpacyTrfDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 || len(bindings) != 1 || len(assets) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return driver.ValidateBinding(requirements[0], bindings[0], assets[0])
}

func (SpacyTrfDriver) PlanTextAnnotationInvocation(input TextAnnotationInvocationInput) (*TextAnnotationInvocationPlan, error) {
	if input.RecipeID != SpacyTrfRecipeID {
		return planSpacyAnnotationInvocation(input, "", SpacyTrfConsumerID)
	}
	return planSpacyAnnotationInvocation(input, "en", SpacyTrfConsumerID)
}
