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

// SpacyTrfDriver shares one curated-transformer protocol across exact language
// pipelines, with Model Contracts and a CPU profile distinct from medium models.
// @nimi-authority: rule.nimi.runtime.ai-provider.spacy-local-annotation
type SpacyTrfDriver struct{ SpacyDriver }

func (SpacyTrfDriver) ImplementationSupportedFeatures(recipeID string) ([]string, runtimev1.LocalCapabilityReason) {
	if _, ok := spacyTrfModelForRecipe(recipeID); !ok {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver SpacyTrfDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.ProjectRecipe(input.RecipeID, input.PortableConfig, input.SupportedFeatures)
}

func (SpacyTrfDriver) ProjectRecipe(recipeID string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	model, ok := spacyTrfModelForRecipe(recipeID)
	if !ok {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	if len(options.GetFields()) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(features) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	constraints, _ := structpb.NewStruct(map[string]any{"family": "spacy", "language": model.language, "artifact_role": "text_analysis_model", "pipeline": "curated_transformer"})
	return []*runtimev1.LocalCapabilityRequirement{{
		RequirementId: SpacyModelSlot, DisplayLabel: "Curated transformer analysis model (" + model.language + ")", ResourceKind: "auxiliary",
		Role:                     runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		Presence:                 runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
		Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT,
		CompatibilityConstraints: constraints,
	}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (SpacyTrfDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	invalid := runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	model, ok := spacyTrfModelForRecipe(input.RecipeID)
	if !ok || input.Binding == nil || input.Binding.GetVerifiedContentId() != model.contentID ||
		input.Binding.GetEntrySha256() != model.configSHA256 {
		return ModelAssetBindingProjection{}, invalid
	}
	config, configOK := modelAssetFileFact(input, "config.cfg")
	metadata, metadataOK := modelAssetFileFact(input, "meta.json")
	if !configOK || !metadataOK || config.SizeBytes != int64(len(config.FormatProbe)) {
		return ModelAssetBindingProjection{}, invalid
	}
	digest := sha256.Sum256(config.FormatProbe)
	if hex.EncodeToString(digest[:]) != model.configSHA256 {
		return ModelAssetBindingProjection{}, invalid
	}
	var meta struct {
		Language string `json:"lang"`
		Version  string `json:"version"`
		Name     string `json:"name"`
	}
	if json.Unmarshal(metadata.FormatProbe, &meta) != nil || meta.Language != model.language || meta.Version != "3.8.0" || meta.Name != model.name {
		return ModelAssetBindingProjection{}, invalid
	}
	for _, name := range model.requiredFiles {
		if _, exists := modelAssetFileFact(input, name); !exists {
			return ModelAssetBindingProjection{}, invalid
		}
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{
		Kind:   runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY,
		Family: "spacy", ArtifactRoles: []string{"text_analysis_model"}, FormatProbe: []byte(model.language),
	}, 0, (SpacyTrfDriver{}).ValidateBinding)
}

func (SpacyTrfDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	model, ok := spacyTrfModelForLanguage(requirement.GetCompatibilityConstraints().GetFields()["language"].GetStringValue())
	if !ok || requirement.GetCompatibilityConstraints().GetFields()["pipeline"].GetStringValue() != "curated_transformer" ||
		binding.GetVerifiedContentId() != model.contentID || binding.GetEntrySha256() != model.configSHA256 ||
		asset.VerifiedContentID != model.contentID || asset.EntrySHA256 != model.configSHA256 {
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
	model, _ := spacyTrfModelForRecipe(input.RecipeID)
	return planSpacyAnnotationInvocation(input, model.language, SpacyTrfConsumerID)
}

type spacyTrfModelContract struct {
	language, name, contentID, configSHA256 string
	requiredFiles                           []string
}

func spacyTrfModelForRecipe(recipeID string) (spacyTrfModelContract, bool) {
	switch recipeID {
	case SpacyTrfRecipeID:
		return spacyTrfModelForLanguage("en")
	case SpacyTrfGermanRecipeID:
		return spacyTrfModelForLanguage("de")
	case SpacyTrfChineseRecipeID:
		return spacyTrfModelForLanguage("zh")
	default:
		return spacyTrfModelContract{}, false
	}
}

func spacyTrfModelForLanguage(language string) (spacyTrfModelContract, bool) {
	model := spacyTrfModelContract{language: language, requiredFiles: []string{
		"transformer/cfg", "transformer/model", "tagger/model", "parser/model", "vocab/strings.json",
	}}
	switch language {
	case "en":
		model.name, model.contentID, model.configSHA256 = "core_web_trf", spacyTrfModelContentID, spacyTrfConfigSHA256
		model.requiredFiles = append(model.requiredFiles, "tokenizer", "ner/model")
	case "de":
		model.name = "dep_news_trf"
		model.contentID = "sha256:d3258748991f3119b823b6c9bc8e4815129a939f08e02b22d4f8d1ad383727b0" // pragma: allowlist secret -- official 3.8.0 data content digest
		model.configSHA256 = "f32a73529de2ce52c167e4b12479a904c4559dd03942e1359623a0de5eeb097f"     // pragma: allowlist secret -- official model config digest
		model.requiredFiles = append(model.requiredFiles, "tokenizer", "morphologizer/model", "lemmatizer/model", "lemmatizer/trees")
	case "zh":
		model.name = "core_web_trf"
		model.contentID = "sha256:44b533804828afb1afa5267c87fe7ab7e8412bc8485b7a5c8d16bbd7f0c8ada3" // pragma: allowlist secret -- official 3.8.0 data content digest
		model.configSHA256 = "5443fc0518bcd3dbcf52e8c2fc21348e3e88ff99276d5e85e945cced174d6000"     // pragma: allowlist secret -- official model config digest
		model.requiredFiles = append(model.requiredFiles, "ner/model", "tokenizer/cfg", "tokenizer/pkuseg_model/features.msgpack", "tokenizer/pkuseg_model/weights.npz", "tokenizer/pkuseg_processors")
	default:
		return spacyTrfModelContract{}, false
	}
	return model, true
}
