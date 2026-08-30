// @nimi-authority: rule.nimi.runtime.local-compute.r107

package capabilitydriver

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	StableDiffusionImplementationID   = "local.image.generate.stable-diffusion-cpp"
	StableDiffusionDriverID           = "nimi.runtime.driver.stable-diffusion-cpp"
	StableDiffusionDriverDialect      = "stable-diffusion.cpp/image-generate/v3"
	StableDiffusionCapabilityContract = "image.generate"

	StableDiffusionMainRequirementID            = "main.diffusion"
	StableDiffusionTextEncoderRequirementID     = "companion.text-encoder"
	StableDiffusionVAERequirementID             = "companion.vae"
	StableDiffusionUncondDiffusionRequirementID = "companion.uncond-diffusion"

	StableDiffusionQwenImageRecipeID     = "qwen-image"
	StableDiffusionQwenImageEditRecipeID = "qwen-image-edit-2511"
)

const (
	stableDiffusionMainLabel            = "Diffusion model"
	stableDiffusionTextEncoderLabel     = "Text encoder"
	stableDiffusionVAELabel             = "VAE"
	stableDiffusionUncondDiffusionLabel = "Unconditional diffusion model"
)

// @nimi-authority: definition.nimi.platform.core-protocol.capability-implementation-driver
// @nimi-authority: rule.nimi.runtime.ai-provider.r063
// @nimi-authority: rule.nimi.runtime.ai-provider.r064
// StableDiffusionImageDriver owns the stable-diffusion.cpp portable dialect.
type StableDiffusionImageDriver struct{}

func (StableDiffusionImageDriver) ImplementationSupportedFeatures(recipeID string) ([]string, runtimev1.LocalCapabilityReason) {
	if _, ok := StableDiffusionImageRecipeModelFamily(recipeID); !ok {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	if stableDiffusionRecipeSupportsInputImage(recipeID) {
		return []string{aicapabilities.FeatureInputImage}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (StableDiffusionImageDriver) EffectiveRequestDefaults(recipeID string, value *structpb.Struct) map[string]string {
	portable, reason := parseStableDiffusionPortableConfig(recipeID, value)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil
	}
	return map[string]string{
		"n":    "1",
		"size": strconv.Itoa(portable.execution.width) + "x" + strconv.Itoa(portable.execution.height),
		"seed": strconv.FormatInt(portable.execution.seed, 10),
	}
}

type stableDiffusionFamilySpec struct {
	name                            string
	mainArtifactRole                string
	requiresUncond                  bool
	mainGGUFArchitectures           []string
	mainGGUFFamilies                []string
	compatibleTextEncoders          []string
	textEncoderGGUFArchitectures    []string
	textEncoderArchitectureFamilies []string
	compatibleVAEs                  []string
	vaeTensorContract               string
}

func stableDiffusionFamily(value string) (stableDiffusionFamilySpec, bool) {
	if value == "" || value != strings.TrimSpace(value) {
		return stableDiffusionFamilySpec{}, false
	}
	switch value {
	case "z-image":
		// Z-Image consumes the FLUX.1 VAE (ae.safetensors): its decoder conv_in
		// weight projects the 16-channel latent shape as flux1-vae.
		return stableDiffusionFamilySpec{
			name: value, mainArtifactRole: "diffusion_model", mainGGUFFamilies: []string{"z-image"},
			compatibleTextEncoders: []string{"qwen"}, textEncoderArchitectureFamilies: []string{"qwen"},
			compatibleVAEs: []string{"flux1-vae"}, vaeTensorContract: "flux1-vae-16ch",
		}, true
	case "ideogram4":
		return stableDiffusionFamilySpec{
			name: value, mainArtifactRole: "diffusion_model", requiresUncond: true, mainGGUFFamilies: []string{"ideogram4"},
			compatibleTextEncoders: []string{"qwen-vl"}, textEncoderArchitectureFamilies: []string{"qwen-vl"},
			compatibleVAEs: []string{"flux2-vae"}, vaeTensorContract: "flux2-vae",
		}, true
	case "qwen-image":
		return stableDiffusionFamilySpec{
			name: value, mainArtifactRole: "diffusion_model", mainGGUFArchitectures: []string{"qwen_image"},
			compatibleTextEncoders: []string{"qwen-vl"}, textEncoderGGUFArchitectures: []string{"qwen2vl"},
			compatibleVAEs: []string{"qwen-image-vae"}, vaeTensorContract: "qwen-image-vae-3d",
		}, true
	default:
		return stableDiffusionFamilySpec{}, false
	}
}

type stableDiffusionExecutionOptions struct {
	steps                   int
	cfgScale                float64
	width                   int
	height                  int
	seed                    int64
	sampler                 string
	scheduler               string
	threads                 int
	diffusionFlashAttention bool
	offloadParamsToCPU      bool
	flowShift               float64
}

type stableDiffusionPortableConfig struct {
	family        stableDiffusionFamilySpec
	recipeID      string
	qwenZeroCondT bool
	execution     stableDiffusionExecutionOptions
}

func stableDiffusionRecipe(family stableDiffusionFamilySpec, recipeID string) (stableDiffusionFamilySpec, bool, bool) {
	switch recipeID {
	case "z-image":
		return family, family.name == "z-image", false
	case "ideogram4":
		return family, family.name == "ideogram4", false
	case "qwen-image":
		return family, family.name == "qwen-image", false
	case "qwen-image-edit-2511":
		if family.name != "qwen-image" {
			return stableDiffusionFamilySpec{}, false, false
		}
		family.mainArtifactRole = "edit_diffusion_model"
		return family, true, true
	default:
		return stableDiffusionFamilySpec{}, false, false
	}
}

// StableDiffusionImageRecipeModelFamily returns the exact managed package
// family required by one closed image recipe. It is a static dialect fact, not
// a live package or catalog selector.
func StableDiffusionImageRecipeModelFamily(recipeID string) (string, bool) {
	recipeID = strings.TrimSpace(recipeID)
	familyName := recipeID
	if recipeID == StableDiffusionQwenImageEditRecipeID {
		familyName = StableDiffusionQwenImageRecipeID
	}
	family, ok := stableDiffusionFamily(familyName)
	if !ok {
		return "", false
	}
	resolved, ok, _ := stableDiffusionRecipe(family, recipeID)
	if !ok {
		return "", false
	}
	return resolved.name, true
}

func stableDiffusionRecipeSupportsInputImage(recipeID string) bool {
	return recipeID == "qwen-image-edit-2511"
}

func (StableDiffusionImageDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	portable, reason := parseStableDiffusionPortableConfig(input.RecipeID, input.PortableConfig)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, reason
	}
	features, reason := normalizedStableDiffusionFeatures(input.SupportedFeatures)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, reason
	}
	if stableDiffusionRecipeSupportsInputImage(portable.recipeID) != contains(features, aicapabilities.FeatureInputImage) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}

	mainConstraints := map[string]any{
		"asset_kind": "image", "model_family": portable.family.name, "recipe_id": portable.recipeID,
		"artifact_role": portable.family.mainArtifactRole, "format": "gguf",
	}
	if len(portable.family.mainGGUFArchitectures) > 0 {
		mainConstraints["gguf_architectures"] = stableDiffusionAnyStrings(portable.family.mainGGUFArchitectures)
	}
	if len(portable.family.mainGGUFFamilies) > 0 {
		mainConstraints["gguf_families"] = stableDiffusionAnyStrings(portable.family.mainGGUFFamilies)
	}
	textEncoderConstraints := map[string]any{
		"asset_kind": "auxiliary", "artifact_role": "text_encoder",
		"compatible_families": stableDiffusionAnyStrings(portable.family.compatibleTextEncoders), "format": "gguf",
	}
	if len(portable.family.textEncoderGGUFArchitectures) > 0 {
		textEncoderConstraints["gguf_architectures"] = stableDiffusionAnyStrings(portable.family.textEncoderGGUFArchitectures)
	}
	if len(portable.family.textEncoderArchitectureFamilies) > 0 {
		textEncoderConstraints["gguf_architecture_families"] = stableDiffusionAnyStrings(portable.family.textEncoderArchitectureFamilies)
	}
	requirements := []*runtimev1.LocalCapabilityRequirement{
		stableDiffusionRequirement(
			StableDiffusionMainRequirementID,
			runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
			"image",
			0,
			stableDiffusionMainLabel,
			mainConstraints,
		),
		stableDiffusionRequirement(
			StableDiffusionTextEncoderRequirementID,
			runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
			"auxiliary",
			0,
			stableDiffusionTextEncoderLabel,
			textEncoderConstraints,
		),
		stableDiffusionRequirement(
			StableDiffusionVAERequirementID,
			runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
			"vae",
			0,
			stableDiffusionVAELabel,
			map[string]any{
				"asset_kind": "vae", "compatible_families": stableDiffusionAnyStrings(portable.family.compatibleVAEs),
				"format": "safetensors", "tensor_contract": portable.family.vaeTensorContract,
			},
		),
	}
	if portable.family.requiresUncond {
		requirements = append(requirements, stableDiffusionRequirement(
			StableDiffusionUncondDiffusionRequirementID,
			runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
			"image",
			0,
			stableDiffusionUncondDiffusionLabel,
			map[string]any{
				"asset_kind": "image", "model_family": portable.family.name, "artifact_role": "uncond_diffusion_model", "format": "gguf",
				"gguf_families": stableDiffusionAnyStrings(portable.family.mainGGUFFamilies),
			},
		))
	}
	return requirements, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

// ProjectRecipe projects only stable facts owned by this exact Driver dialect.
// Recommended ModelAsset identities remain catalog metadata and never become
// slot-admission pins.
func (driver StableDiffusionImageDriver) ProjectRecipe(recipeID string, options *structpb.Struct, supportedFeatures []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.Interpret(InterpretInput{RecipeID: recipeID, PortableConfig: options, SupportedFeatures: supportedFeatures})
}

func (driver StableDiffusionImageDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	requirement := input.Requirement
	if requirement == nil || requirement.GetCompatibilityConstraints() == nil {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	format, ok := stableDiffusionRequirementConstraintString(requirement, "format")
	if !ok || filepath.Ext(strings.ToLower(input.Entry.RelativePath)) != "."+format {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	descriptor := ModelAssetDescriptor{Engine: "media", FormatProbe: input.Entry.FormatProbe}
	assetKind, ok := stableDiffusionRequirementConstraintString(requirement, "asset_kind")
	if !ok {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	descriptor.Kind = stableDiffusionAssetKind(assetKind)
	if descriptor.Kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	if role, exists := stableDiffusionRequirementConstraintString(requirement, "artifact_role"); exists {
		descriptor.ArtifactRoles = []string{role}
	}
	switch format {
	case "gguf":
		_, familyConstrained := stableDiffusionRequirementConstraintStrings(requirement, "gguf_families")
		_, architectureConstrained := stableDiffusionRequirementConstraintStrings(requirement, "gguf_architectures")
		_, architectureFamilyConstrained := stableDiffusionRequirementConstraintStrings(requirement, "gguf_architecture_families")
		var summary ggufmeta.Summary
		var err error
		if !familyConstrained && (architectureConstrained || architectureFamilyConstrained) {
			summary, err = ggufmeta.InspectLLMMetadata(bytes.NewReader(input.Entry.FormatProbe))
		} else {
			summary, err = ggufmeta.Inspect(bytes.NewReader(input.Entry.FormatProbe))
		}
		if err != nil {
			return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
		architecture := ggufmeta.LLMDetectedArchitecture(summary)
		if expected, exists := stableDiffusionRequirementConstraintStrings(requirement, "gguf_architectures"); exists && !contains(expected, architecture) {
			return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
		if expected, exists := stableDiffusionRequirementConstraintStrings(requirement, "gguf_families"); exists && !stableDiffusionGGUFFamilyMatches(summary, expected) {
			return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
		if expected, exists := stableDiffusionRequirementConstraintStrings(requirement, "gguf_architecture_families"); exists {
			detected := stableDiffusionGGUFArchitectureFamily(architecture)
			if !contains(expected, detected) {
				return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
			}
			descriptor.Family = detected
		}
		if family, exists := stableDiffusionRequirementConstraintString(requirement, "model_family"); exists {
			descriptor.Family = family
		} else if descriptor.Family == "" {
			families, exists := stableDiffusionRequirementConstraintStrings(requirement, "compatible_families")
			if !exists || len(families) != 1 {
				return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
			}
			descriptor.Family = families[0]
		}
	case "safetensors":
		contract, ok := stableDiffusionRequirementConstraintString(requirement, "tensor_contract")
		if !ok {
			return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
		family, valid := stableDiffusionVAETensorContractFamily(contract, input.Entry.FormatProbe)
		if !valid {
			return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
		descriptor.Family = family
	default:
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return validatedModelAssetBindingProjection(input, descriptor, 0, driver.ValidateBinding)
}

func stableDiffusionGGUFFamilyMatches(summary ggufmeta.Summary, expected []string) bool {
	if contains(expected, ggufmeta.StableDiffusionDetectedFamily(summary)) {
		return true
	}
	for _, signature := range ggufmeta.StableDiffusionTensorSignaturesPresent(summary) {
		for _, family := range expected {
			if strings.HasPrefix(signature, family+":") {
				return true
			}
		}
	}
	return false
}

func stableDiffusionGGUFArchitectureFamily(architecture string) string {
	architecture = strings.ToLower(strings.TrimSpace(architecture))
	if !strings.HasPrefix(architecture, "qwen") {
		return ""
	}
	if strings.Contains(architecture, "vl") {
		return "qwen-vl"
	}
	return "qwen"
}

func stableDiffusionVAETensorContractFamily(contract string, probe []byte) (string, bool) {
	tensors, ok := safetensorsTensorFacts(probe)
	if !ok {
		return "", false
	}
	switch contract {
	case "qwen-image-vae-3d":
		decoder, decoderOK := tensors["decoder.conv1.weight"]
		output, outputOK := tensors["decoder.head.2.weight"]
		if !decoderOK || !outputOK || len(output.Shape) == 0 || output.Shape[0] != 3 {
			return "", false
		}
		if len(decoder.Shape) == 5 && len(output.Shape) == 5 && len(decoder.Shape) > 1 && decoder.Shape[1] == 16 {
			return "qwen-image-vae", true
		}
	case "flux1-vae-16ch", "flux2-vae":
		decoder, decoderOK := tensors["decoder.conv_in.weight"]
		output, outputOK := tensors["decoder.conv_out.weight"]
		if !decoderOK || !outputOK || len(output.Shape) == 0 || output.Shape[0] != 3 {
			return "", false
		}
		if len(decoder.Shape) != 4 || len(output.Shape) != 4 || len(decoder.Shape) < 2 {
			return "", false
		}
		family := ""
		switch decoder.Shape[1] {
		case 16:
			family = "flux1-vae"
		case 32:
			family = "flux2-vae"
		}
		if (contract == "flux1-vae-16ch" && family == "flux1-vae") || (contract == "flux2-vae" && family == "flux2-vae") {
			return family, true
		}
	}
	return "", false
}

func stableDiffusionAnyStrings(values []string) []any {
	result := make([]any, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}

func stableDiffusionRequirement(
	id string,
	role runtimev1.LocalCapabilityRequirementRole,
	resourceKind string,
	ordinal uint32,
	displayLabel string,
	constraints map[string]any,
) *runtimev1.LocalCapabilityRequirement {
	compatibility, _ := structpb.NewStruct(constraints)
	return &runtimev1.LocalCapabilityRequirement{
		RequirementId:            id,
		Role:                     role,
		Presence:                 runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
		ResourceKind:             resourceKind,
		Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
		CompatibilityConstraints: compatibility,
		OccurrenceOrdinal:        ordinal,
		DisplayLabel:             displayLabel,
	}
}

func (StableDiffusionImageDriver) ValidateBinding(
	requirement *runtimev1.LocalCapabilityRequirement,
	binding *runtimev1.ModelAssetExactBinding,
	asset ModelAssetDescriptor,
) runtimev1.LocalCapabilityReason {
	if requirement == nil || binding == nil || binding.GetRequirementId() != requirement.GetRequirementId() {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if strings.TrimSpace(binding.GetModelAssetId()) == "" || strings.TrimSpace(asset.ModelAssetID) == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if !canonicalInvocationSHA256(binding.GetVerifiedContentId(), binding.GetEntrySha256()) ||
		!canonicalInvocationSHA256(asset.VerifiedContentID, asset.EntrySHA256) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED
	}
	if binding.GetModelAssetId() != asset.ModelAssetID ||
		binding.GetVerifiedContentId() != asset.VerifiedContentID ||
		binding.GetEntrySha256() != asset.EntrySHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	if !stableDiffusionAssetCompatible(requirement, asset) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver StableDiffusionImageDriver) ValidateCombination(
	requirements []*runtimev1.LocalCapabilityRequirement,
	bindings []*runtimev1.ModelAssetExactBinding,
	assets []ModelAssetDescriptor,
) runtimev1.LocalCapabilityReason {
	if len(requirements) == 0 || len(bindings) < len(requirements) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
	}
	if len(bindings) != len(requirements) || len(assets) != len(bindings) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if !validStableDiffusionRequirementSequence(requirements) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}

	byRequirement := make(map[string]*runtimev1.LocalCapabilityRequirement, len(requirements))
	for _, requirement := range requirements {
		if requirement == nil || strings.TrimSpace(requirement.GetRequirementId()) == "" {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		if _, exists := byRequirement[requirement.GetRequirementId()]; exists {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		byRequirement[requirement.GetRequirementId()] = requirement
	}
	seenBindings := make(map[string]struct{}, len(bindings))
	for index, binding := range bindings {
		if binding == nil {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		requirement := byRequirement[binding.GetRequirementId()]
		if requirement == nil {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		if _, exists := seenBindings[binding.GetRequirementId()]; exists {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		seenBindings[binding.GetRequirementId()] = struct{}{}
		if reason := driver.ValidateBinding(requirement, binding, assets[index]); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			return reason
		}
	}
	if len(seenBindings) != len(byRequirement) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func validStableDiffusionRequirementSequence(requirements []*runtimev1.LocalCapabilityRequirement) bool {
	if len(requirements) < 3 || !stableDiffusionRequirementShape(requirements[0], StableDiffusionMainRequirementID, "image", 0) ||
		!stableDiffusionRequirementShape(requirements[1], StableDiffusionTextEncoderRequirementID, "auxiliary", 0) ||
		!stableDiffusionRequirementShape(requirements[2], StableDiffusionVAERequirementID, "vae", 0) {
		return false
	}
	family, ok := stableDiffusionRequirementConstraintString(requirements[0], "model_family")
	if !ok {
		return false
	}
	familySpec, ok := stableDiffusionFamily(family)
	if !ok || familySpec.name != family {
		return false
	}
	recipeID, ok := stableDiffusionRequirementConstraintString(requirements[0], "recipe_id")
	if !ok {
		return false
	}
	familySpec, ok, _ = stableDiffusionRecipe(familySpec, recipeID)
	if !ok {
		return false
	}
	mainRole, mainRoleOK := stableDiffusionRequirementConstraintString(requirements[0], "artifact_role")
	mainFormat, mainFormatOK := stableDiffusionRequirementConstraintString(requirements[0], "format")
	textRole, textRoleOK := stableDiffusionRequirementConstraintString(requirements[1], "artifact_role")
	textFormat, textFormatOK := stableDiffusionRequirementConstraintString(requirements[1], "format")
	textFamilies, textFamiliesOK := stableDiffusionRequirementConstraintStrings(requirements[1], "compatible_families")
	vaeFormat, vaeFormatOK := stableDiffusionRequirementConstraintString(requirements[2], "format")
	vaeTensorContract, vaeTensorContractOK := stableDiffusionRequirementConstraintString(requirements[2], "tensor_contract")
	if !mainRoleOK || mainRole != familySpec.mainArtifactRole || !mainFormatOK || mainFormat != "gguf" ||
		!stableDiffusionRequirementConstraintStringsMatch(requirements[0], "gguf_architectures", familySpec.mainGGUFArchitectures) ||
		!stableDiffusionRequirementConstraintStringsMatch(requirements[0], "gguf_families", familySpec.mainGGUFFamilies) ||
		!textRoleOK || textRole != "text_encoder" || !textFormatOK || textFormat != "gguf" ||
		!textFamiliesOK || !stableDiffusionStringSlicesEqual(textFamilies, familySpec.compatibleTextEncoders) ||
		!stableDiffusionRequirementConstraintStringsMatch(requirements[1], "gguf_architectures", familySpec.textEncoderGGUFArchitectures) ||
		!stableDiffusionRequirementConstraintStringsMatch(requirements[1], "gguf_architecture_families", familySpec.textEncoderArchitectureFamilies) ||
		!vaeFormatOK || vaeFormat != "safetensors" || !vaeTensorContractOK || vaeTensorContract != familySpec.vaeTensorContract {
		return false
	}
	vaeFamilies, ok := stableDiffusionRequirementConstraintStrings(requirements[2], "compatible_families")
	if !ok || !stableDiffusionStringSlicesEqual(vaeFamilies, familySpec.compatibleVAEs) {
		return false
	}
	index := 3
	if familySpec.requiresUncond {
		if len(requirements) <= index || !stableDiffusionRequirementShape(requirements[index], StableDiffusionUncondDiffusionRequirementID, "image", 0) {
			return false
		}
		if uncondFamily, ok := stableDiffusionRequirementConstraintString(requirements[index], "model_family"); !ok || uncondFamily != family {
			return false
		}
		if format, ok := stableDiffusionRequirementConstraintString(requirements[index], "format"); !ok || format != "gguf" {
			return false
		}
		if role, ok := stableDiffusionRequirementConstraintString(requirements[index], "artifact_role"); !ok || role != "uncond_diffusion_model" {
			return false
		}
		if !stableDiffusionRequirementConstraintStringsMatch(requirements[index], "gguf_families", familySpec.mainGGUFFamilies) {
			return false
		}
		index++
	} else if len(requirements) > index && requirements[index].GetRequirementId() == StableDiffusionUncondDiffusionRequirementID {
		return false
	}
	return index == len(requirements)
}

func validStableDiffusionRequirementSequenceForPortable(requirements []*runtimev1.LocalCapabilityRequirement, portable stableDiffusionPortableConfig) bool {
	if !validStableDiffusionRequirementSequence(requirements) || len(requirements) < 3 {
		return false
	}
	return portable.family.name == stableDiffusionRequirementModelFamily(requirements[0]) &&
		portable.family.requiresUncond == stableDiffusionRequirementPresent(requirements, StableDiffusionUncondDiffusionRequirementID)
}

func stableDiffusionRequirementModelFamily(requirement *runtimev1.LocalCapabilityRequirement) string {
	value, _ := stableDiffusionRequirementConstraintString(requirement, "model_family")
	return value
}

func stableDiffusionRequirementPresent(requirements []*runtimev1.LocalCapabilityRequirement, id string) bool {
	for _, requirement := range requirements {
		if requirement != nil && requirement.GetRequirementId() == id {
			return true
		}
	}
	return false
}

func stableDiffusionRequirementShape(requirement *runtimev1.LocalCapabilityRequirement, id, resourceKind string, ordinal uint32) bool {
	if requirement == nil || requirement.GetRequirementId() != id || requirement.GetResourceKind() != resourceKind ||
		requirement.GetOccurrenceOrdinal() != ordinal || strings.TrimSpace(requirement.GetDisplayLabel()) == "" ||
		requirement.GetDisplayLabel() != strings.TrimSpace(requirement.GetDisplayLabel()) ||
		requirement.GetPolicy() != runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE ||
		requirement.GetPreferredVerifiedContentId() != "" {
		return false
	}
	if id == StableDiffusionMainRequirementID {
		return requirement.GetRole() == runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN
	}
	return requirement.GetRole() == runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION
}

func stableDiffusionAssetCompatible(requirement *runtimev1.LocalCapabilityRequirement, asset ModelAssetDescriptor) bool {
	constraints := requirement.GetCompatibilityConstraints()
	if constraints == nil || !stableDiffusionConstraintKeysValid(requirement, constraints.GetFields()) {
		return false
	}
	assetKind, ok := stableDiffusionRequirementConstraintString(requirement, "asset_kind")
	if !ok || assetKind != requirement.GetResourceKind() || asset.Kind != stableDiffusionAssetKind(assetKind) {
		return false
	}
	if family, exists := stableDiffusionRequirementConstraintString(requirement, "model_family"); exists {
		if asset.Family != family {
			return false
		}
	}
	if families, exists := stableDiffusionRequirementConstraintStrings(requirement, "compatible_families"); exists {
		matched := false
		for _, family := range families {
			if asset.Family == family {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	if role, exists := stableDiffusionRequirementConstraintString(requirement, "artifact_role"); exists && !contains(asset.ArtifactRoles, role) {
		return false
	}
	if format, exists := stableDiffusionRequirementConstraintString(requirement, "format"); exists && !stableDiffusionImageFormatValid(format, asset.FormatProbe) {
		return false
	}
	return true
}

func stableDiffusionConstraintKeysValid(requirement *runtimev1.LocalCapabilityRequirement, fields map[string]*structpb.Value) bool {
	allowed := map[string]struct{}{"asset_kind": {}}
	required := map[string]struct{}{"asset_kind": {}}
	expectedCount := 0
	switch requirement.GetRequirementId() {
	case StableDiffusionMainRequirementID:
		allowed["model_family"] = struct{}{}
		allowed["recipe_id"] = struct{}{}
		allowed["artifact_role"] = struct{}{}
		allowed["format"] = struct{}{}
		allowed["gguf_architectures"] = struct{}{}
		allowed["gguf_families"] = struct{}{}
		for _, key := range []string{"model_family", "recipe_id", "artifact_role", "format"} {
			required[key] = struct{}{}
		}
		expectedCount = 6
	case StableDiffusionTextEncoderRequirementID:
		allowed["artifact_role"] = struct{}{}
		allowed["compatible_families"] = struct{}{}
		allowed["format"] = struct{}{}
		allowed["gguf_architectures"] = struct{}{}
		allowed["gguf_architecture_families"] = struct{}{}
		for _, key := range []string{"artifact_role", "compatible_families", "format"} {
			required[key] = struct{}{}
		}
		expectedCount = 5
	case StableDiffusionVAERequirementID:
		allowed["compatible_families"] = struct{}{}
		allowed["format"] = struct{}{}
		allowed["tensor_contract"] = struct{}{}
		for _, key := range []string{"compatible_families", "format", "tensor_contract"} {
			required[key] = struct{}{}
		}
		expectedCount = 4
	case StableDiffusionUncondDiffusionRequirementID:
		allowed["model_family"] = struct{}{}
		allowed["artifact_role"] = struct{}{}
		allowed["format"] = struct{}{}
		allowed["gguf_families"] = struct{}{}
		for _, key := range []string{"model_family", "artifact_role", "format", "gguf_families"} {
			required[key] = struct{}{}
		}
		expectedCount = 5
	default:
		return false
	}
	if len(fields) != expectedCount {
		return false
	}
	for key := range required {
		if fields[key] == nil {
			return false
		}
	}
	for key := range fields {
		if _, ok := allowed[key]; !ok {
			return false
		}
	}
	return true
}

func stableDiffusionImageFormatValid(format string, probe []byte) bool {
	if len(probe) > MaxAssetFormatProbeBytes {
		return false
	}
	switch format {
	case "gguf":
		return len(probe) >= 4 && bytes.Equal(probe[:4], []byte("GGUF"))
	case "safetensors":
		if len(probe) < 10 {
			return false
		}
		headerLength := binary.LittleEndian.Uint64(probe[:8])
		if headerLength < 2 || headerLength > MaxSafetensorsHeaderBytes || headerLength > uint64(len(probe)-8) {
			return false
		}
		var header map[string]json.RawMessage
		return json.Unmarshal(probe[8:8+headerLength], &header) == nil && len(header) > 0
	default:
		return false
	}
}

func stableDiffusionRequirementConstraintStringsMatch(requirement *runtimev1.LocalCapabilityRequirement, key string, expected []string) bool {
	actual, exists := stableDiffusionRequirementConstraintStrings(requirement, key)
	if len(expected) == 0 {
		return !exists
	}
	return exists && stableDiffusionStringSlicesEqual(actual, expected)
}

func stableDiffusionStringSlicesEqual(left, right []string) bool {
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

func stableDiffusionAssetKind(value string) runtimev1.LocalAssetKind {
	switch value {
	case "image":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE
	case "auxiliary":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY
	case "vae":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE
	default:
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED
	}
}

func stableDiffusionRequirementConstraintString(requirement *runtimev1.LocalCapabilityRequirement, key string) (string, bool) {
	if requirement == nil || requirement.GetCompatibilityConstraints() == nil {
		return "", false
	}
	value := requirement.GetCompatibilityConstraints().GetFields()[key]
	if value == nil {
		return "", false
	}
	text, ok := portableStringValue(value)
	if !ok || text == "" || text != strings.TrimSpace(text) {
		return "", false
	}
	return text, true
}

func stableDiffusionRequirementConstraintStrings(requirement *runtimev1.LocalCapabilityRequirement, key string) ([]string, bool) {
	if requirement == nil || requirement.GetCompatibilityConstraints() == nil {
		return nil, false
	}
	value := requirement.GetCompatibilityConstraints().GetFields()[key]
	if value == nil || value.GetListValue() == nil || len(value.GetListValue().GetValues()) == 0 {
		return nil, false
	}
	result := make([]string, 0, len(value.GetListValue().GetValues()))
	for _, item := range value.GetListValue().GetValues() {
		text, ok := portableStringValue(item)
		if !ok || text == "" || text != strings.TrimSpace(text) {
			return nil, false
		}
		result = append(result, text)
	}
	return result, true
}

func (StableDiffusionImageDriver) PlanImageInvocation(input ImageInvocationInput) (*ImageInvocationPlan, error) {
	portable, reason := parseStableDiffusionPortableConfig(input.RecipeID, input.PortableConfig)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("stable-diffusion portable config: %s", reason.String()))
	}
	features, reason := normalizedStableDiffusionFeatures(input.SupportedFeatures)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED ||
		stableDiffusionRecipeSupportsInputImage(portable.recipeID) != contains(features, aicapabilities.FeatureInputImage) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("stable-diffusion supported features do not match the portable configuration"))
	}
	bindings, orderedIDs, err := exactStableDiffusionInvocationBindings(portable, input.ExactBindings)
	if err != nil {
		return nil, invocationError(InvocationFailureInvalidBinding, err)
	}
	request, err := normalizeStableDiffusionImageRequest(input.Request, input.Inputs, portable, features)
	if err != nil {
		return nil, err
	}

	modelFiles := make([]InvocationExactBinding, 0, len(orderedIDs))
	for _, requirementID := range orderedIDs {
		modelFiles = append(modelFiles, cloneInvocationExactBindings([]InvocationExactBinding{bindings[requirementID]})[0])
	}
	hasher := sha256.New()
	for _, value := range []string{
		portable.family.name,
		portable.recipeID,
		strconv.Itoa(portable.execution.threads),
		strconv.FormatFloat(portable.execution.cfgScale, 'g', -1, 64),
		portable.execution.sampler,
		portable.execution.scheduler,
		strconv.FormatBool(portable.execution.diffusionFlashAttention),
		strconv.FormatBool(portable.execution.offloadParamsToCPU),
		strconv.FormatFloat(portable.execution.flowShift, 'g', -1, 64),
		strconv.FormatBool(portable.qwenZeroCondT),
	} {
		_, _ = hasher.Write([]byte(value))
		_, _ = hasher.Write([]byte{0})
	}
	for _, requirementID := range orderedIDs {
		binding := bindings[requirementID]
		for _, value := range invocationExactBindingIdentity(binding) {
			_, _ = hasher.Write([]byte(value))
			_, _ = hasher.Write([]byte{0})
		}
	}
	for _, source := range input.ExactDependencySources {
		for _, value := range invocationExactDependencySourceIdentity(source) {
			_, _ = hasher.Write([]byte(value))
			_, _ = hasher.Write([]byte{0})
		}
	}
	load := StableDiffusionCPPLoadPlan{
		recipeID:                portable.recipeID,
		main:                    stableDiffusionImageModelFile(bindings[StableDiffusionMainRequirementID]),
		textEncoder:             stableDiffusionImageModelFile(bindings[StableDiffusionTextEncoderRequirementID]),
		vae:                     stableDiffusionImageModelFile(bindings[StableDiffusionVAERequirementID]),
		flowShift:               portable.execution.flowShift,
		qwenImageZeroCondT:      portable.qwenZeroCondT,
		threads:                 portable.execution.threads,
		cfgScale:                portable.execution.cfgScale,
		sampler:                 portable.execution.sampler,
		scheduler:               portable.execution.scheduler,
		diffusionFlashAttention: portable.execution.diffusionFlashAttention,
		offloadParamsToCPU:      portable.execution.offloadParamsToCPU,
	}
	if binding, ok := bindings[StableDiffusionUncondDiffusionRequirementID]; ok {
		value := stableDiffusionImageModelFile(binding)
		load.uncondDiffusion = &value
	}
	requestFields := stableDiffusionCPPRequestFields{
		prompt: request.prompt, negativePrompt: request.negativePrompt,
		width: request.width, height: request.height, steps: portable.execution.steps,
		cfgScale: portable.execution.cfgScale, seed: request.seed, imageCount: request.imageCount,
		sampler: portable.execution.sampler, scheduler: portable.execution.scheduler,
	}
	var requestPlan ImageRequestPlan
	switch request.kind {
	case stableDiffusionRequestTextToImage:
		requestPlan = StableDiffusionCPPTextToImageRequestPlan{stableDiffusionCPPRequestFields: requestFields}
	case stableDiffusionRequestInstructionEdit:
		requestPlan = StableDiffusionCPPInstructionEditRequestPlan{
			stableDiffusionCPPRequestFields: requestFields,
			sourceImage:                     cloneImageResolvedInput(request.sourceImage),
		}
	default:
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("stable-diffusion image recipe request variant is unsupported"))
	}
	return &ImageInvocationPlan{
		processKey:        hex.EncodeToString(hasher.Sum(nil)),
		modelFiles:        modelFiles,
		dependencySources: cloneInvocationExactDependencySources(input.ExactDependencySources),
		loadPlan:          load,
		requestPlan:       requestPlan,
		resultConstraints: StableDiffusionCPPResultConstraints{
			artifactCount: request.imageCount,
			mediaType:     "image/png",
			format:        "png",
			width:         request.width,
			height:        request.height,
		},
		translator: stableDiffusionImageTranslator{},
	}, nil
}

func stableDiffusionImageModelFile(binding InvocationExactBinding) ImageModelFile {
	return ImageModelFile{
		modelAssetID:      binding.ModelAssetID,
		absolutePath:      binding.AbsolutePath,
		verifiedContentID: binding.VerifiedContentID,
		entrySHA256:       binding.EntrySHA256,
	}
}

type stableDiffusionImageTranslator struct{}

func (stableDiffusionImageTranslator) validateImagePlan(plan *ImageInvocationPlan) error {
	if plan == nil || strings.TrimSpace(plan.processKey) == "" || len(plan.modelFiles) < 3 || len(plan.modelFiles) > 5 {
		return fmt.Errorf("stable-diffusion image plan is incomplete")
	}
	load, ok := plan.loadPlan.(StableDiffusionCPPLoadPlan)
	if !ok {
		return fmt.Errorf("stable-diffusion image load variant is unknown")
	}
	request, err := stableDiffusionCPPRequestFieldsFromPlan(plan.requestPlan)
	if err != nil {
		return err
	}
	constraints, ok := plan.resultConstraints.(StableDiffusionCPPResultConstraints)
	if !ok || constraints.artifactCount != request.imageCount || constraints.mediaType != "image/png" || constraints.format != "png" ||
		constraints.width != request.width || constraints.height != request.height {
		return fmt.Errorf("stable-diffusion image result constraints are inconsistent")
	}
	if request.prompt == "" || request.prompt != strings.TrimSpace(request.prompt) ||
		!stableDiffusionDimension(request.width) || !stableDiffusionDimension(request.height) ||
		request.steps < 1 || request.steps > 150 || math.IsNaN(request.cfgScale) || math.IsInf(request.cfgScale, 0) ||
		request.cfgScale < 0 || request.cfgScale > 30 || request.seed < math.MinInt32 || request.seed > math.MaxInt32 ||
		request.imageCount < 1 || request.imageCount > 4 ||
		(request.sampler != "" && !stableDiffusionOptionToken(request.sampler)) ||
		(request.scheduler != "" && !stableDiffusionOptionToken(request.scheduler)) {
		return fmt.Errorf("stable-diffusion image request variant is incomplete")
	}
	if request.seed != -1 {
		if _, err := (stableDiffusionImageTranslator{}).resolveImageArtifactSeed(plan, request.seed, int32(request.imageCount)); err != nil {
			return err
		}
	}
	if load.recipeID == "" || load.recipeID != strings.TrimSpace(load.recipeID) ||
		math.IsNaN(load.flowShift) || math.IsInf(load.flowShift, 0) || load.flowShift < -100 || load.flowShift > 100 ||
		load.threads < 0 || load.threads > 1024 || load.cfgScale != request.cfgScale ||
		load.sampler != request.sampler || load.scheduler != request.scheduler {
		return fmt.Errorf("stable-diffusion image load and request variants are inconsistent")
	}
	if (load.recipeID == "qwen-image-edit-2511") != load.qwenImageZeroCondT ||
		((load.recipeID == "qwen-image" || load.recipeID == "qwen-image-edit-2511") && load.flowShift != 3) {
		return fmt.Errorf("stable-diffusion image recipe load facts are inconsistent")
	}
	files := []ImageModelFile{load.main, load.textEncoder, load.vae}
	if uncond, exists := load.UncondDiffusion(); exists {
		files = append(files, uncond)
	}
	if len(files) != len(plan.modelFiles) {
		return fmt.Errorf("stable-diffusion image load content is inconsistent")
	}
	for index, file := range files {
		if file.modelAssetID == "" || file.verifiedContentID == "" || file.entrySHA256 == "" ||
			!filepath.IsAbs(file.absolutePath) || filepath.Clean(file.absolutePath) != file.absolutePath ||
			!canonicalInvocationSHA256(file.verifiedContentID, file.entrySHA256) {
			return fmt.Errorf("stable-diffusion image load content is not exact")
		}
		if file != stableDiffusionImageModelFile(plan.modelFiles[index]) {
			return fmt.Errorf("stable-diffusion image load content does not match custody inputs")
		}
	}
	if edit, isEdit := plan.requestPlan.(StableDiffusionCPPInstructionEditRequestPlan); isEdit {
		if load.recipeID != "qwen-image-edit-2511" || edit.sourceImage.SourceIdentity == "" ||
			edit.sourceImage.SourceIdentity != strings.TrimSpace(edit.sourceImage.SourceIdentity) || len(edit.sourceImage.ImageBytes) == 0 {
			return fmt.Errorf("stable-diffusion instruction-edit request is incomplete")
		}
	}
	return nil
}

func (stableDiffusionImageTranslator) resolveImageArtifactSeed(plan *ImageInvocationPlan, baseSeed int64, index int32) (int64, error) {
	request, err := stableDiffusionCPPRequestFieldsFromPlan(plan.RequestPlan())
	if err != nil {
		return 0, err
	}
	if index < 1 || int(index) > request.imageCount || baseSeed < math.MinInt32 || baseSeed > math.MaxInt32 || baseSeed == -1 {
		return 0, fmt.Errorf("stable-diffusion artifact seed input is invalid")
	}
	seed := baseSeed + int64(index-1)
	if seed < math.MinInt32 || seed > math.MaxInt32 {
		return 0, fmt.Errorf("stable-diffusion artifact seed overflows signed int32")
	}
	return seed, nil
}

func stableDiffusionCPPRequestFieldsFromPlan(plan ImageRequestPlan) (stableDiffusionCPPRequestFields, error) {
	switch typed := plan.(type) {
	case StableDiffusionCPPTextToImageRequestPlan:
		return typed.stableDiffusionCPPRequestFields, nil
	case StableDiffusionCPPInstructionEditRequestPlan:
		return typed.stableDiffusionCPPRequestFields, nil
	default:
		return stableDiffusionCPPRequestFields{}, fmt.Errorf("stable-diffusion image request variant is unknown")
	}
}

func (stableDiffusionImageTranslator) translateImageProgress(plan *ImageInvocationPlan, observation ImageBackendProgressObservation) (ImageProgress, error) {
	request, err := stableDiffusionCPPRequestFieldsFromPlan(plan.RequestPlan())
	if err != nil {
		return ImageProgress{}, err
	}
	if observation.CurrentStep <= 0 || observation.TotalSteps != int32(request.steps) || observation.CurrentStep > observation.TotalSteps ||
		observation.ProgressPercent < 0 || observation.ProgressPercent > 100 {
		return ImageProgress{}, fmt.Errorf("stable-diffusion backend progress is invalid")
	}
	expectedPercent := int32((int64(observation.CurrentStep) * 100) / int64(observation.TotalSteps))
	if observation.ProgressPercent != expectedPercent {
		return ImageProgress{}, fmt.Errorf("stable-diffusion backend progress percent is inconsistent")
	}
	return ImageProgress(observation), nil
}

func (stableDiffusionImageTranslator) translateImageArtifact(plan *ImageInvocationPlan, observation ImageBackendArtifactObservation) (ImageArtifact, error) {
	constraints, ok := plan.ResultConstraints().(StableDiffusionCPPResultConstraints)
	if !ok {
		return ImageArtifact{}, fmt.Errorf("stable-diffusion result constraints are unavailable")
	}
	if observation.Index < 1 || int(observation.Index) > constraints.artifactCount || len(observation.Payload) == 0 ||
		observation.Seed < math.MinInt32 || observation.Seed > math.MaxInt32 || observation.Seed == -1 ||
		observation.Format != constraints.format || observation.Width != constraints.width || observation.Height != constraints.height {
		return ImageArtifact{}, fmt.Errorf("stable-diffusion backend artifact violates result constraints")
	}
	return ImageArtifact{Index: observation.Index, Seed: observation.Seed, Payload: append([]byte(nil), observation.Payload...), MediaType: constraints.mediaType}, nil
}

func (stableDiffusionImageTranslator) translateImageFailure(stage ImageBackendFailureStage, err error) error {
	if err == nil {
		return fmt.Errorf("stable-diffusion backend %s failed without an error", stage)
	}
	switch stage {
	case ImageBackendFailureLoad, ImageBackendFailureProgress, ImageBackendFailureGenerate, ImageBackendFailureResult:
		return fmt.Errorf("stable-diffusion backend %s: %w", stage, err)
	default:
		return fmt.Errorf("stable-diffusion backend failure stage is unknown: %w", err)
	}
}

func exactStableDiffusionInvocationBindings(
	portable stableDiffusionPortableConfig,
	values []InvocationExactBinding,
) (map[string]InvocationExactBinding, []string, error) {
	expected := []string{
		StableDiffusionMainRequirementID,
		StableDiffusionTextEncoderRequirementID,
		StableDiffusionVAERequirementID,
	}
	if portable.family.requiresUncond {
		expected = append(expected, StableDiffusionUncondDiffusionRequirementID)
	}
	expectedSet := make(map[string]struct{}, len(expected))
	for _, requirementID := range expected {
		expectedSet[requirementID] = struct{}{}
	}
	bindings := make(map[string]InvocationExactBinding, len(values))
	for _, binding := range values {
		requirementID := strings.TrimSpace(binding.RequirementID)
		if requirementID != binding.RequirementID {
			return nil, nil, fmt.Errorf("stable-diffusion invocation contains a non-canonical requirement %q", binding.RequirementID)
		}
		if _, ok := expectedSet[requirementID]; !ok {
			return nil, nil, fmt.Errorf("stable-diffusion invocation contains an unknown requirement %q", binding.RequirementID)
		}
		if _, exists := bindings[requirementID]; exists {
			return nil, nil, fmt.Errorf("stable-diffusion invocation contains duplicate requirement %q", requirementID)
		}
		if binding.ModelAssetID == "" || binding.ModelAssetID != strings.TrimSpace(binding.ModelAssetID) ||
			binding.VerifiedContentID == "" || binding.VerifiedContentID != strings.TrimSpace(binding.VerifiedContentID) ||
			binding.EntrySHA256 == "" || binding.EntrySHA256 != strings.TrimSpace(binding.EntrySHA256) ||
			!canonicalInvocationSHA256(binding.VerifiedContentID, binding.EntrySHA256) ||
			!filepath.IsAbs(binding.AbsolutePath) || filepath.Clean(binding.AbsolutePath) != binding.AbsolutePath {
			return nil, nil, fmt.Errorf("stable-diffusion invocation requirement %q is not an exact absolute binding", requirementID)
		}
		bindings[requirementID] = cloneInvocationExactBindings([]InvocationExactBinding{binding})[0]
	}
	for _, requirementID := range expected {
		if _, exists := bindings[requirementID]; !exists {
			return nil, nil, fmt.Errorf("stable-diffusion invocation requirement %q is required", requirementID)
		}
	}
	if len(bindings) != len(expected) {
		return nil, nil, fmt.Errorf("stable-diffusion invocation contains ambiguous bindings")
	}
	return bindings, expected, nil
}

type stableDiffusionRequestKind uint8

const (
	stableDiffusionRequestTextToImage stableDiffusionRequestKind = iota + 1
	stableDiffusionRequestInstructionEdit
)

type normalizedStableDiffusionImageRequest struct {
	kind           stableDiffusionRequestKind
	prompt         string
	negativePrompt string
	sourceImage    ImageResolvedInput
	responseFormat string
	width          int
	height         int
	seed           int64
	imageCount     int
}

func normalizeStableDiffusionImageRequest(
	spec *runtimev1.ImageGenerateScenarioSpec,
	inputs []ImageResolvedInput,
	portable stableDiffusionPortableConfig,
	features []string,
) (normalizedStableDiffusionImageRequest, error) {
	if spec == nil {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("image.generate request is required"))
	}
	prompt := strings.TrimSpace(spec.GetPrompt())
	if prompt == "" {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("image.generate prompt is required"))
	}
	imageCount := 1
	if spec.N != nil {
		imageCount = int(spec.GetN())
		if imageCount < 1 || imageCount > 4 {
			return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidOption, fmt.Errorf("image.generate image count is outside the supported range"))
		}
	}
	width := portable.execution.width
	height := portable.execution.height
	if size := strings.TrimSpace(spec.GetSize()); size != "" {
		var ok bool
		width, height, ok = parseStableDiffusionSize(size)
		if !ok {
			return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidOption, fmt.Errorf("image.generate size must be WIDTHxHEIGHT with multiples of eight from 64 through 4096"))
		}
	}
	if strings.TrimSpace(spec.GetAspectRatio()) != "" || strings.TrimSpace(spec.GetQuality()) != "" || strings.TrimSpace(spec.GetStyle()) != "" {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureUnsupported, fmt.Errorf("stable-diffusion invocation does not support aspect_ratio, quality, or style"))
	}
	responseFormat := strings.ToLower(strings.TrimSpace(spec.GetResponseFormat()))
	switch responseFormat {
	case "", "b64_json", "url":
	case "base64":
		responseFormat = "b64_json"
	default:
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidOption, fmt.Errorf("stable-diffusion invocation does not support response format %q", responseFormat))
	}
	mask := strings.TrimSpace(spec.GetMask())
	maskArtifactID := strings.TrimSpace(spec.GetMaskArtifactId())
	sourceInputs := make([]ImageResolvedInput, 0, len(inputs))
	maskInputs := make([]ImageResolvedInput, 0, 1)
	for _, input := range inputs {
		switch input.Role {
		case ImageResolvedInputRoleSource:
			sourceInputs = append(sourceInputs, input)
		case ImageResolvedInputRoleMask:
			maskInputs = append(maskInputs, input)
		default:
			return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("image.generate resolved input role is invalid"))
		}
	}
	if len(sourceInputs) > 0 && !contains(features, aicapabilities.FeatureInputImage) {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureUnsupported, fmt.Errorf("image.generate input.image is not declared by this configuration"))
	}
	if len(maskInputs) > 0 && !contains(features, aicapabilities.FeatureInputMask) {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureUnsupported, fmt.Errorf("image.generate input.mask is not declared by this configuration"))
	}
	if mask != "" || maskArtifactID != "" || len(maskInputs) > 0 || spec.Strength != nil {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureUnsupported, fmt.Errorf("selected stable-diffusion recipe does not admit a mask"))
	}
	negativePrompt := strings.TrimSpace(spec.GetNegativePrompt())
	if (portable.recipeID == "qwen-image" || portable.recipeID == "qwen-image-edit-2511") && negativePrompt != "" {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureUnsupported, fmt.Errorf("selected Qwen Image recipe does not admit negative_prompt"))
	}
	kind := stableDiffusionRequestTextToImage
	sourceImage := ImageResolvedInput{}
	switch portable.recipeID {
	case "qwen-image-edit-2511":
		if len(sourceInputs) != 1 || imageCount != 1 {
			return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureUnsupported, fmt.Errorf("Qwen Image Edit 2511 requires exactly one source image, one output, and no mask"))
		}
		if sourceInputs[0].SourceIdentity == "" || sourceInputs[0].SourceIdentity != strings.TrimSpace(sourceInputs[0].SourceIdentity) || len(sourceInputs[0].ImageBytes) == 0 {
			return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("image.generate resolved input.image is incomplete"))
		}
		sourceImage = cloneImageResolvedInput(sourceInputs[0])
		kind = stableDiffusionRequestInstructionEdit
	case "z-image", "ideogram4", "qwen-image":
		if len(sourceInputs) != 0 {
			return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureUnsupported, fmt.Errorf("selected text-to-image recipe does not admit input.image"))
		}
	default:
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("stable-diffusion recipe is unsupported"))
	}
	seed := portable.execution.seed
	if spec.Seed != nil {
		seed = spec.GetSeed()
	}
	if seed < math.MinInt32 || seed > math.MaxInt32 {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("image.generate seed is outside the stable-diffusion.cpp signed-int32 range"))
	}
	if seed != -1 && seed+int64(imageCount-1) > math.MaxInt32 {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("image.generate batch seed progression overflows the stable-diffusion.cpp signed-int32 range"))
	}
	return normalizedStableDiffusionImageRequest{
		kind:           kind,
		prompt:         prompt,
		negativePrompt: negativePrompt,
		sourceImage:    sourceImage,
		responseFormat: responseFormat,
		width:          width,
		height:         height,
		seed:           seed,
		imageCount:     imageCount,
	}, nil
}

func cloneImageResolvedInput(input ImageResolvedInput) ImageResolvedInput {
	input.ImageBytes = append([]byte(nil), input.ImageBytes...)
	return input
}

func parseStableDiffusionSize(value string) (int, int, bool) {
	left, right, ok := strings.Cut(strings.ToLower(strings.TrimSpace(value)), "x")
	if !ok || left == "" || right == "" || strings.Contains(right, "x") {
		return 0, 0, false
	}
	width, widthErr := strconv.Atoi(left)
	height, heightErr := strconv.Atoi(right)
	if widthErr != nil || heightErr != nil || !stableDiffusionDimension(width) || !stableDiffusionDimension(height) {
		return 0, 0, false
	}
	return width, height, true
}

// StableDiffusionImageSizeSupported reports whether value is an exact size
// admitted by the stable-diffusion.cpp Local Driver.
func StableDiffusionImageSizeSupported(value string) bool {
	_, _, ok := parseStableDiffusionSize(value)
	return ok
}

func stableDiffusionDimension(value int) bool {
	return value >= 64 && value <= 4096 && value%8 == 0
}

func parseStableDiffusionPortableConfig(recipeID string, value *structpb.Struct) (stableDiffusionPortableConfig, runtimev1.LocalCapabilityReason) {
	recipeID = strings.TrimSpace(recipeID)
	familyName := recipeID
	if recipeID == StableDiffusionQwenImageEditRecipeID {
		familyName = "qwen-image"
	}
	family, ok := stableDiffusionFamily(familyName)
	if !ok {
		return stableDiffusionPortableConfig{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	family, ok, qwenZeroCondT := stableDiffusionRecipe(family, recipeID)
	if !ok {
		return stableDiffusionPortableConfig{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if value == nil {
		value = &structpb.Struct{}
	}
	fields := value.GetFields()
	for key := range fields {
		if key != "executionOptions" {
			return stableDiffusionPortableConfig{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
	}
	result := stableDiffusionPortableConfig{
		family:        family,
		recipeID:      recipeID,
		qwenZeroCondT: qwenZeroCondT,
		execution: stableDiffusionExecutionOptions{
			steps:    20,
			cfgScale: 7,
			width:    1024,
			height:   1024,
			seed:     42,
		},
	}
	switch recipeID {
	case "z-image":
		result.execution.steps = 8
		result.execution.cfgScale = 1
	case "qwen-image", "qwen-image-edit-2511":
		result.execution.cfgScale = 2.5
		result.execution.sampler = "euler"
		result.execution.flowShift = 3
		result.execution.diffusionFlashAttention = true
		result.execution.offloadParamsToCPU = true
	}
	var reason runtimev1.LocalCapabilityReason
	if result.execution, reason = stableDiffusionExecutionOptionsFromValue(fields["executionOptions"], result.execution); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return stableDiffusionPortableConfig{}, reason
	}
	return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func stableDiffusionExecutionOptionsFromValue(
	value *structpb.Value,
	defaults stableDiffusionExecutionOptions,
) (stableDiffusionExecutionOptions, runtimev1.LocalCapabilityReason) {
	if value == nil {
		return defaults, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
	object := value.GetStructValue()
	if object == nil {
		return stableDiffusionExecutionOptions{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	fields := object.GetFields()
	for key := range fields {
		switch key {
		case "steps", "cfgScale", "width", "height", "seed", "sampler", "scheduler", "threads", "diffusionFlashAttention", "offloadParamsToCPU":
		default:
			return stableDiffusionExecutionOptions{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
	}
	result := defaults
	if field := fields["steps"]; field != nil {
		value, ok := stableDiffusionInteger(field, 1, 150)
		if !ok {
			return stableDiffusionExecutionOptions{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
		result.steps = int(value)
	}
	if field := fields["cfgScale"]; field != nil {
		if _, ok := field.Kind.(*structpb.Value_NumberValue); !ok {
			return stableDiffusionExecutionOptions{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
		result.cfgScale = field.GetNumberValue()
		if math.IsNaN(result.cfgScale) || math.IsInf(result.cfgScale, 0) || result.cfgScale < 0 || result.cfgScale > 30 {
			return stableDiffusionExecutionOptions{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
	}
	for key, target := range map[string]*int{"width": &result.width, "height": &result.height} {
		if field := fields[key]; field != nil {
			value, ok := stableDiffusionInteger(field, 64, 4096)
			if !ok || !stableDiffusionDimension(int(value)) {
				return stableDiffusionExecutionOptions{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
			}
			*target = int(value)
		}
	}
	if field := fields["seed"]; field != nil {
		value, ok := stableDiffusionInteger(field, math.MinInt32, math.MaxInt32)
		if !ok {
			return stableDiffusionExecutionOptions{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
		result.seed = value
	}
	for key, target := range map[string]*string{"sampler": &result.sampler, "scheduler": &result.scheduler} {
		if field := fields[key]; field != nil {
			text, ok := portableStringValue(field)
			if !ok || !stableDiffusionOptionToken(text) {
				return stableDiffusionExecutionOptions{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
			}
			*target = text
		}
	}
	if field := fields["threads"]; field != nil {
		value, ok := stableDiffusionInteger(field, 1, 1024)
		if !ok {
			return stableDiffusionExecutionOptions{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
		result.threads = int(value)
	}
	for key, target := range map[string]*bool{
		"diffusionFlashAttention": &result.diffusionFlashAttention,
		"offloadParamsToCPU":      &result.offloadParamsToCPU,
	} {
		if field := fields[key]; field != nil {
			if _, ok := field.Kind.(*structpb.Value_BoolValue); !ok {
				return stableDiffusionExecutionOptions{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
			}
			*target = field.GetBoolValue()
		}
	}
	return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func stableDiffusionInteger(value *structpb.Value, minimum, maximum int64) (int64, bool) {
	if value == nil {
		return 0, false
	}
	if _, ok := value.Kind.(*structpb.Value_NumberValue); !ok {
		return 0, false
	}
	number := value.GetNumberValue()
	if math.IsNaN(number) || math.IsInf(number, 0) || math.Trunc(number) != number || number < float64(minimum) || number > float64(maximum) {
		return 0, false
	}
	return int64(number), true
}

func stableDiffusionOptionToken(value string) bool {
	if value == "" || value != strings.TrimSpace(value) || len(value) > 64 {
		return false
	}
	for _, character := range value {
		if character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' || strings.ContainsRune("+_.-", character) {
			continue
		}
		return false
	}
	return true
}

func normalizedStableDiffusionFeatures(features []string) ([]string, runtimev1.LocalCapabilityReason) {
	set := make(map[string]struct{}, len(features))
	for _, feature := range features {
		feature = strings.TrimSpace(feature)
		if feature != aicapabilities.FeatureInputImage {
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
