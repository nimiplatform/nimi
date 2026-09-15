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

// @nimi-authority: rule.nimi.runtime.ai-provider.spacy-local-annotation
const (
	TextAnnotateContract  = "text.annotate"
	SpacyImplementationID = "local.text.annotate.spacy"
	SpacyDriverID         = "nimi.runtime.driver.spacy"
	SpacyDriverDialect    = "spacy/text-annotate/v1"
	SpacyConsumerID       = "text.spacy.python"
	SpacyProtocol         = "nimi-text-annotate/1"
	SpacyModelSlot        = "text.model"
)

type SpacyDriver struct{}

func SpacyRecipeLanguage(recipeID string) string {
	for _, language := range []string{"en", "de", "es", "fr", "it", "ru", "zh", "ja"} {
		if recipeID == "spacy-md-"+language {
			return language
		}
	}
	return ""
}

func (SpacyDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string { return nil }

func (SpacyDriver) ImplementationSupportedFeatures(recipeID string) ([]string, runtimev1.LocalCapabilityReason) {
	if SpacyRecipeLanguage(recipeID) == "" {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver SpacyDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.ProjectRecipe(input.RecipeID, input.PortableConfig, input.SupportedFeatures)
}

func (SpacyDriver) ProjectRecipe(recipeID string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	language := SpacyRecipeLanguage(recipeID)
	if language == "" || len(options.GetFields()) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(features) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	constraints, _ := structpb.NewStruct(map[string]any{"family": "spacy", "language": language, "artifact_role": "text_analysis_model"})
	return []*runtimev1.LocalCapabilityRequirement{{
		RequirementId: SpacyModelSlot, DisplayLabel: "Language analysis model (" + language + ")", ResourceKind: "auxiliary",
		Role:                     runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		Presence:                 runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
		Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
		CompatibilityConstraints: constraints,
	}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (SpacyDriver) ModelAssetFormatProbeBytes(input ModelAssetFormatProbeInput) int64 {
	if input.RelativePath == "meta.json" || input.RelativePath == "config.cfg" {
		return 64 << 10
	}
	return 4096
}

func (driver SpacyDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	invalid := runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	if SpacyRecipeLanguage(input.RecipeID) == "" {
		return ModelAssetBindingProjection{}, invalid
	}
	if _, exists := modelAssetFileFact(input, "config.cfg"); !exists {
		return ModelAssetBindingProjection{}, invalid
	}
	metadata, ok := modelAssetFileFact(input, "meta.json")
	if !ok {
		return ModelAssetBindingProjection{}, invalid
	}
	var meta struct {
		Language string `json:"lang"`
		Version  string `json:"version"`
		Name     string `json:"name"`
	}
	if json.Unmarshal(metadata.FormatProbe, &meta) != nil || meta.Language != SpacyRecipeLanguage(input.RecipeID) || meta.Version != "3.8.0" || !strings.HasSuffix(meta.Name, "_md") {
		return ModelAssetBindingProjection{}, invalid
	}
	tokenizer := "tokenizer"
	if meta.Language == "zh" {
		tokenizer = "tokenizer/cfg"
	}
	for _, name := range []string{tokenizer, "parser/model", "tok2vec/model", "vocab/strings.json"} {
		if _, exists := modelAssetFileFact(input, name); !exists {
			return ModelAssetBindingProjection{}, invalid
		}
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{
		Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY, Family: "spacy", ArtifactRoles: []string{"text_analysis_model"}, FormatProbe: []byte(meta.Language),
	}, 0, driver.ValidateBinding)
}

func (SpacyDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement.GetRequirementId() != SpacyModelSlot || binding.GetRequirementId() != SpacyModelSlot {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if binding.GetModelAssetId() == "" || binding.GetModelAssetId() != asset.ModelAssetID {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if binding.GetVerifiedContentId() == "" || binding.GetEntrySha256() == "" || binding.GetVerifiedContentId() != asset.VerifiedContentID || binding.GetEntrySha256() != asset.EntrySHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	if asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY || asset.Family != "spacy" || !contains(asset.ArtifactRoles, "text_analysis_model") ||
		string(asset.FormatProbe) != requirement.GetCompatibilityConstraints().GetFields()["language"].GetStringValue() {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver SpacyDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 || len(bindings) != 1 || len(assets) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return driver.ValidateBinding(requirements[0], bindings[0], assets[0])
}

type TextAnnotationInvocationInput struct {
	RecipeID          string
	Request           *runtimev1.TextAnnotateScenarioSpec
	Bindings          []InvocationExactBinding
	DependencySources []InvocationExactDependencySource
}

type TextAnnotationInvocationPlan struct {
	Request            *runtimev1.TextAnnotateScenarioSpec
	Binding            InvocationExactBinding
	ProfileRoot        string
	ProfileDigest      string
	DriverBundleDigest string
	DriverProtocol     string
}

func (SpacyDriver) PlanTextAnnotationInvocation(input TextAnnotationInvocationInput) (*TextAnnotationInvocationPlan, error) {
	language := SpacyRecipeLanguage(input.RecipeID)
	if language == "" || input.Request == nil || input.Request.Language != language || len(input.Bindings) != 1 || input.Bindings[0].RequirementID != SpacyModelSlot {
		return nil, fmt.Errorf("annotation language must match its captured model recipe")
	}
	var profile *InvocationExactDependencySource
	for index := range input.DependencySources {
		source := &input.DependencySources[index]
		if source.DependencyFamily == "python.package-set" && source.ConsumerScope == SpacyConsumerID {
			if profile != nil {
				return nil, fmt.Errorf("annotation profile capture is ambiguous")
			}
			profile = source
		}
	}
	if profile == nil || !filepath.IsAbs(profile.CanonicalRoot) || profile.SelectedSourceRecordID == "" || profile.Hashes["profile_digest"] == "" ||
		profile.Hashes["driver_bundle_sha256"] == "" || profile.Version != profile.Hashes["profile_digest"] {
		return nil, fmt.Errorf("annotation requires an exact managed CPU profile")
	}
	return &TextAnnotationInvocationPlan{
		Request: proto.Clone(input.Request).(*runtimev1.TextAnnotateScenarioSpec), Binding: cloneInvocationExactBindings(input.Bindings)[0],
		ProfileRoot: profile.CanonicalRoot, ProfileDigest: profile.Version, DriverBundleDigest: profile.Hashes["driver_bundle_sha256"], DriverProtocol: SpacyProtocol,
	}, nil
}
