package capabilitydriver

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	StableDiffusionImplementationID   = "local.image.generate.stable-diffusion-cpp"
	StableDiffusionDriverID           = "nimi.runtime.driver.stable-diffusion-cpp"
	StableDiffusionDriverDialect      = "stable-diffusion.cpp/image-generate/v1"
	StableDiffusionCapabilityContract = "image.generate"

	StableDiffusionMainRequirementID            = "main.diffusion"
	StableDiffusionTextEncoderRequirementID     = "companion.text-encoder"
	StableDiffusionVAERequirementID             = "companion.vae"
	StableDiffusionUncondDiffusionRequirementID = "companion.uncond-diffusion"
)

const (
	stableDiffusionMainLabel            = "Diffusion model"
	stableDiffusionTextEncoderLabel     = "Text encoder"
	stableDiffusionVAELabel             = "VAE"
	stableDiffusionUncondDiffusionLabel = "Unconditional diffusion model"
)

// StableDiffusionLoRARequirementID returns the deterministic identity for one
// explicitly declared one-based LoRA occurrence.
func StableDiffusionLoRARequirementID(ordinal uint32) string {
	return "companion.lora." + strconv.FormatUint(uint64(ordinal), 10)
}

// StableDiffusionImageDriver owns the stable-diffusion.cpp portable dialect.
type StableDiffusionImageDriver struct{}

type stableDiffusionFamilySpec struct {
	name           string
	requiresUncond bool
	compatibleVAEs []string
}

func stableDiffusionFamily(value string) (stableDiffusionFamilySpec, bool) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.ReplaceAll(normalized, "_", "-")
	switch normalized {
	case "z-image-base", "z-image-turbo":
		// Z-Image base and turbo GGUFs share the lumina2 architecture; GGUF
		// metadata cannot distinguish the variants, so both collapse to the
		// canonical z-image family.
		normalized = "z-image"
	}
	switch normalized {
	case "z-image":
		// Z-Image consumes the FLUX.1 VAE (ae.safetensors): its decoder conv_in
		// weight projects the 16-channel latent shape as flux1-vae.
		return stableDiffusionFamilySpec{name: normalized, compatibleVAEs: []string{"flux1-vae"}}, true
	case "ideogram4":
		return stableDiffusionFamilySpec{name: normalized, requiresUncond: true, compatibleVAEs: []string{"flux2-vae"}}, true
	default:
		return stableDiffusionFamilySpec{}, false
	}
}

type stableDiffusionRequirementIntent struct {
	policy            runtimev1.LocalCapabilityRequirementPolicy
	verifiedContentID string
}

type stableDiffusionLoRAIntent struct {
	displayLabel      string
	policy            runtimev1.LocalCapabilityRequirementPolicy
	verifiedContentID string
	weight            float64
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
}

type stableDiffusionPortableConfig struct {
	family           stableDiffusionFamilySpec
	enableInputImage bool
	main             stableDiffusionRequirementIntent
	textEncoder      stableDiffusionRequirementIntent
	vae              stableDiffusionRequirementIntent
	uncond           stableDiffusionRequirementIntent
	loras            []stableDiffusionLoRAIntent
	execution        stableDiffusionExecutionOptions
}

func (StableDiffusionImageDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	portable, reason := parseStableDiffusionPortableConfig(input.PortableConfig)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, reason
	}
	features, reason := normalizedStableDiffusionFeatures(input.SupportedFeatures)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, reason
	}
	if portable.enableInputImage != contains(features, inputImageFeature) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}

	requirements := []*runtimev1.LocalCapabilityRequirement{
		stableDiffusionRequirement(
			StableDiffusionMainRequirementID,
			runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
			"image",
			portable.main,
			0,
			stableDiffusionMainLabel,
			map[string]any{"asset_kind": "image", "model_family": portable.family.name},
		),
		stableDiffusionRequirement(
			StableDiffusionTextEncoderRequirementID,
			runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
			"chat",
			portable.textEncoder,
			0,
			stableDiffusionTextEncoderLabel,
			map[string]any{"asset_kind": "chat"},
		),
		stableDiffusionRequirement(
			StableDiffusionVAERequirementID,
			runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
			"vae",
			portable.vae,
			0,
			stableDiffusionVAELabel,
			map[string]any{"asset_kind": "vae", "compatible_families": stableDiffusionAnyStrings(portable.family.compatibleVAEs)},
		),
	}
	if portable.family.requiresUncond {
		requirements = append(requirements, stableDiffusionRequirement(
			StableDiffusionUncondDiffusionRequirementID,
			runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
			"image",
			portable.uncond,
			0,
			stableDiffusionUncondDiffusionLabel,
			map[string]any{"asset_kind": "image", "model_family": portable.family.name, "artifact_role": "uncond_diffusion_model"},
		))
	}
	for index, lora := range portable.loras {
		ordinal := uint32(index + 1)
		requirements = append(requirements, stableDiffusionRequirement(
			StableDiffusionLoRARequirementID(ordinal),
			runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
			"lora",
			stableDiffusionRequirementIntent{policy: lora.policy, verifiedContentID: lora.verifiedContentID},
			ordinal,
			lora.displayLabel,
			map[string]any{"asset_kind": "lora", "model_family": portable.family.name},
		))
	}
	return requirements, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
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
	intent stableDiffusionRequirementIntent,
	ordinal uint32,
	displayLabel string,
	constraints map[string]any,
) *runtimev1.LocalCapabilityRequirement {
	compatibility, _ := structpb.NewStruct(constraints)
	return &runtimev1.LocalCapabilityRequirement{
		RequirementId:              id,
		Role:                       role,
		ResourceKind:               resourceKind,
		Policy:                     intent.policy,
		PreferredVerifiedContentId: intent.verifiedContentID,
		CompatibilityConstraints:   compatibility,
		OccurrenceOrdinal:          ordinal,
		DisplayLabel:               displayLabel,
	}
}

func (StableDiffusionImageDriver) ValidateBinding(
	requirement *runtimev1.LocalCapabilityRequirement,
	binding *runtimev1.LocalAssetExactBinding,
	asset AssetDescriptor,
) runtimev1.LocalCapabilityReason {
	if requirement == nil || binding == nil || binding.GetRequirementId() != requirement.GetRequirementId() {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if strings.TrimSpace(binding.GetLocalAssetId()) == "" || strings.TrimSpace(asset.LocalAssetID) == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if !canonicalInvocationSHA256(binding.GetVerifiedContentId(), binding.GetEntrySha256()) ||
		!canonicalInvocationSHA256(asset.VerifiedContentID, asset.EntrySHA256) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED
	}
	if binding.GetLocalAssetId() != asset.LocalAssetID ||
		binding.GetVerifiedContentId() != asset.VerifiedContentID ||
		binding.GetEntrySha256() != asset.EntrySHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	if len(asset.BundleEntries) > 0 {
		digest, err := CanonicalBundleSHA256(asset.BundleEntries)
		if err != nil || digest != asset.EntrySHA256 || asset.VerifiedContentID != "sha256:"+digest {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
		}
	}
	if requirement.GetPolicy() == runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT &&
		binding.GetVerifiedContentId() != requirement.GetPreferredVerifiedContentId() {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	if !stableDiffusionAssetCompatible(requirement, asset) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver StableDiffusionImageDriver) ValidateCombination(
	requirements []*runtimev1.LocalCapabilityRequirement,
	bindings []*runtimev1.LocalAssetExactBinding,
	assets []AssetDescriptor,
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
		!stableDiffusionRequirementShape(requirements[1], StableDiffusionTextEncoderRequirementID, "chat", 0) ||
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
		index++
	} else if len(requirements) > index && requirements[index].GetRequirementId() == StableDiffusionUncondDiffusionRequirementID {
		return false
	}
	ordinal := uint32(1)
	for ; index < len(requirements); index++ {
		if !stableDiffusionRequirementShape(requirements[index], StableDiffusionLoRARequirementID(ordinal), "lora", ordinal) {
			return false
		}
		if loraFamily, ok := stableDiffusionRequirementConstraintString(requirements[index], "model_family"); !ok || loraFamily != family {
			return false
		}
		ordinal++
	}
	return true
}

func stableDiffusionRequirementShape(requirement *runtimev1.LocalCapabilityRequirement, id, resourceKind string, ordinal uint32) bool {
	if requirement == nil || requirement.GetRequirementId() != id || requirement.GetResourceKind() != resourceKind ||
		requirement.GetOccurrenceOrdinal() != ordinal || strings.TrimSpace(requirement.GetDisplayLabel()) == "" ||
		requirement.GetDisplayLabel() != strings.TrimSpace(requirement.GetDisplayLabel()) ||
		(requirement.GetPolicy() != runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT &&
			requirement.GetPolicy() != runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE) {
		return false
	}
	if id == StableDiffusionMainRequirementID {
		return requirement.GetRole() == runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN
	}
	return requirement.GetRole() == runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION
}

func stableDiffusionAssetCompatible(requirement *runtimev1.LocalCapabilityRequirement, asset AssetDescriptor) bool {
	constraints := requirement.GetCompatibilityConstraints()
	if constraints == nil || !stableDiffusionConstraintKeysValid(requirement, constraints.GetFields()) {
		return false
	}
	assetKind, ok := stableDiffusionRequirementConstraintString(requirement, "asset_kind")
	if !ok || assetKind != requirement.GetResourceKind() || asset.Kind != stableDiffusionAssetKind(assetKind) {
		return false
	}
	if family, exists := stableDiffusionRequirementConstraintString(requirement, "model_family"); exists {
		if normalizeStableDiffusionAssetFamily(asset.Family) != family {
			return false
		}
	}
	if families, exists := stableDiffusionRequirementConstraintStrings(requirement, "compatible_families"); exists {
		assetFamily := normalizeStableDiffusionAssetFamily(asset.Family)
		matched := false
		for _, family := range families {
			if assetFamily == family {
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
	return true
}

func stableDiffusionConstraintKeysValid(requirement *runtimev1.LocalCapabilityRequirement, fields map[string]*structpb.Value) bool {
	allowed := map[string]struct{}{"asset_kind": {}}
	switch requirement.GetRequirementId() {
	case StableDiffusionMainRequirementID:
		allowed["model_family"] = struct{}{}
	case StableDiffusionTextEncoderRequirementID:
	case StableDiffusionVAERequirementID:
		allowed["compatible_families"] = struct{}{}
	case StableDiffusionUncondDiffusionRequirementID:
		allowed["model_family"] = struct{}{}
		allowed["artifact_role"] = struct{}{}
	default:
		if !strings.HasPrefix(requirement.GetRequirementId(), "companion.lora.") {
			return false
		}
		allowed["model_family"] = struct{}{}
	}
	if len(fields) != len(allowed) {
		return false
	}
	for key := range fields {
		if _, ok := allowed[key]; !ok {
			return false
		}
	}
	return true
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
	case "chat":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT
	case "vae":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE
	case "lora":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_LORA
	default:
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED
	}
}

func normalizeStableDiffusionAssetFamily(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.ReplaceAll(normalized, "_", "-")
	switch normalized {
	case "z-image-base", "z-image-turbo":
		return "z-image"
	case "flux", "flux2", "flux-2", "flux-2-vae", "ideogram4-vae", "ideogram-4-vae":
		return "flux2-vae"
	default:
		return normalized
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
	portable, reason := parseStableDiffusionPortableConfig(input.PortableConfig)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("stable-diffusion portable config: %s", reason.String()))
	}
	bindings, orderedIDs, err := exactStableDiffusionInvocationBindings(portable, input.ExactBindings)
	if err != nil {
		return nil, invocationError(InvocationFailureInvalidBinding, err)
	}
	request, err := normalizeStableDiffusionImageRequest(input.Request, portable)
	if err != nil {
		return nil, err
	}

	modelFiles := make([]InvocationExactBinding, 0, len(orderedIDs))
	for _, requirementID := range orderedIDs {
		modelFiles = append(modelFiles, bindings[requirementID])
	}
	loras := make([]ImageInvocationLoRA, 0, len(portable.loras))
	for index, lora := range portable.loras {
		ordinal := uint32(index + 1)
		binding := bindings[StableDiffusionLoRARequirementID(ordinal)]
		loras = append(loras, ImageInvocationLoRA{
			RequirementID:     binding.RequirementID,
			OccurrenceOrdinal: ordinal,
			DisplayLabel:      lora.displayLabel,
			AbsolutePath:      binding.AbsolutePath,
			Weight:            lora.weight,
		})
	}

	hasher := sha256.New()
	for _, value := range []string{
		portable.family.name,
		strconv.Itoa(portable.execution.threads),
		strconv.FormatFloat(portable.execution.cfgScale, 'g', -1, 64),
		portable.execution.sampler,
		portable.execution.scheduler,
		strconv.FormatBool(portable.execution.diffusionFlashAttention),
		strconv.FormatBool(portable.execution.offloadParamsToCPU),
	} {
		_, _ = hasher.Write([]byte(value))
		_, _ = hasher.Write([]byte{0})
	}
	for _, binding := range modelFiles {
		for _, value := range []string{binding.RequirementID, binding.LocalAssetID, binding.AbsolutePath, binding.VerifiedContentID, binding.EntrySHA256} {
			_, _ = hasher.Write([]byte(value))
			_, _ = hasher.Write([]byte{0})
		}
	}
	for _, lora := range loras {
		_, _ = hasher.Write([]byte(strconv.FormatFloat(lora.Weight, 'g', -1, 64)))
		_, _ = hasher.Write([]byte{0})
	}

	return &ImageInvocationPlan{
		processKey:              hex.EncodeToString(hasher.Sum(nil)),
		modelFiles:              modelFiles,
		mainModelPath:           bindings[StableDiffusionMainRequirementID].AbsolutePath,
		textEncoderPath:         bindings[StableDiffusionTextEncoderRequirementID].AbsolutePath,
		vaePath:                 bindings[StableDiffusionVAERequirementID].AbsolutePath,
		uncondDiffusionPath:     bindings[StableDiffusionUncondDiffusionRequirementID].AbsolutePath,
		loras:                   loras,
		modelFamily:             portable.family.name,
		prompt:                  request.prompt,
		negativePrompt:          request.negativePrompt,
		inputImage:              request.inputImage,
		mask:                    request.mask,
		responseFormat:          request.responseFormat,
		width:                   request.width,
		height:                  request.height,
		steps:                   portable.execution.steps,
		cfgScale:                portable.execution.cfgScale,
		seed:                    request.seed,
		imageCount:              request.imageCount,
		sampler:                 portable.execution.sampler,
		scheduler:               portable.execution.scheduler,
		threads:                 portable.execution.threads,
		diffusionFlashAttention: portable.execution.diffusionFlashAttention,
		offloadParamsToCPU:      portable.execution.offloadParamsToCPU,
	}, nil
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
	for index := range portable.loras {
		expected = append(expected, StableDiffusionLoRARequirementID(uint32(index+1)))
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
		if binding.LocalAssetID == "" || binding.LocalAssetID != strings.TrimSpace(binding.LocalAssetID) ||
			binding.VerifiedContentID == "" || binding.VerifiedContentID != strings.TrimSpace(binding.VerifiedContentID) ||
			binding.EntrySHA256 == "" || binding.EntrySHA256 != strings.TrimSpace(binding.EntrySHA256) ||
			!canonicalInvocationSHA256(binding.VerifiedContentID, binding.EntrySHA256) ||
			!filepath.IsAbs(binding.AbsolutePath) || filepath.Clean(binding.AbsolutePath) != binding.AbsolutePath {
			return nil, nil, fmt.Errorf("stable-diffusion invocation requirement %q is not an exact absolute binding", requirementID)
		}
		bindings[requirementID] = binding
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

type normalizedStableDiffusionImageRequest struct {
	prompt         string
	negativePrompt string
	inputImage     string
	mask           string
	responseFormat string
	width          int
	height         int
	seed           int64
	imageCount     int
}

func normalizeStableDiffusionImageRequest(
	spec *runtimev1.ImageGenerateScenarioSpec,
	portable stableDiffusionPortableConfig,
) (normalizedStableDiffusionImageRequest, error) {
	if spec == nil {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("image.generate request is required"))
	}
	prompt := strings.TrimSpace(spec.GetPrompt())
	if prompt == "" {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("image.generate prompt is required"))
	}
	imageCount := int(spec.GetN())
	if imageCount == 0 {
		imageCount = 1
	}
	if imageCount < 1 || imageCount > 4 {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("image.generate image count is outside the supported range"))
	}
	width := portable.execution.width
	height := portable.execution.height
	if size := strings.TrimSpace(spec.GetSize()); size != "" {
		var ok bool
		width, height, ok = parseStableDiffusionSize(size)
		if !ok {
			return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("image.generate size must be WIDTHxHEIGHT with multiples of eight from 64 through 4096"))
		}
	}
	if strings.TrimSpace(spec.GetAspectRatio()) != "" || strings.TrimSpace(spec.GetQuality()) != "" || strings.TrimSpace(spec.GetStyle()) != "" {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureUnsupported, fmt.Errorf("stable-diffusion invocation does not support aspect_ratio, quality, or style"))
	}
	responseFormat := strings.TrimSpace(spec.GetResponseFormat())
	if responseFormat != "" && responseFormat != "b64_json" && responseFormat != "url" {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureUnsupported, fmt.Errorf("stable-diffusion invocation does not support response format %q", responseFormat))
	}
	if len(spec.GetReferenceImages()) > 1 {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureUnsupported, fmt.Errorf("stable-diffusion invocation supports at most one input image"))
	}
	inputImage := ""
	if len(spec.GetReferenceImages()) == 1 {
		inputImage = strings.TrimSpace(spec.GetReferenceImages()[0])
		if inputImage == "" {
			return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("image.generate input image must be non-empty"))
		}
	}
	mask := strings.TrimSpace(spec.GetMask())
	if (inputImage != "" || mask != "") && !portable.enableInputImage {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureUnsupported, fmt.Errorf("image.generate input.image is not declared by this configuration"))
	}
	if mask != "" && inputImage == "" {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("image.generate mask requires an input image"))
	}
	seed := portable.execution.seed
	if spec.Seed != nil {
		seed = spec.GetSeed()
	}
	return normalizedStableDiffusionImageRequest{
		prompt:         prompt,
		negativePrompt: strings.TrimSpace(spec.GetNegativePrompt()),
		inputImage:     inputImage,
		mask:           mask,
		responseFormat: responseFormat,
		width:          width,
		height:         height,
		seed:           seed,
		imageCount:     imageCount,
	}, nil
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

func stableDiffusionDimension(value int) bool {
	return value >= 64 && value <= 4096 && value%8 == 0
}

func parseStableDiffusionPortableConfig(value *structpb.Struct) (stableDiffusionPortableConfig, runtimev1.LocalCapabilityReason) {
	if value == nil {
		return stableDiffusionPortableConfig{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	fields := value.GetFields()
	for key := range fields {
		switch key {
		case "modelFamily", "enableInputImage",
			"mainRequirementPolicy", "mainVerifiedContentId",
			"textEncoderRequirementPolicy", "textEncoderVerifiedContentId",
			"vaeRequirementPolicy", "vaeVerifiedContentId",
			"uncondDiffusionRequirementPolicy", "uncondDiffusionVerifiedContentId",
			"loras", "executionOptions":
		default:
			return stableDiffusionPortableConfig{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
	}
	familyValue, reason := portableString(fields, "modelFamily")
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || strings.TrimSpace(familyValue) == "" {
		return stableDiffusionPortableConfig{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	family, ok := stableDiffusionFamily(familyValue)
	if !ok {
		return stableDiffusionPortableConfig{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	result := stableDiffusionPortableConfig{
		family: family,
		execution: stableDiffusionExecutionOptions{
			steps:    20,
			cfgScale: 7,
			width:    1024,
			height:   1024,
			seed:     42,
		},
	}
	if feature := fields["enableInputImage"]; feature != nil {
		if _, ok := feature.Kind.(*structpb.Value_BoolValue); !ok {
			return stableDiffusionPortableConfig{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
		result.enableInputImage = feature.GetBoolValue()
	}
	if result.main, reason = stableDiffusionRequirementIntentFromFields(fields, "mainRequirementPolicy", "mainVerifiedContentId"); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return stableDiffusionPortableConfig{}, reason
	}
	if result.textEncoder, reason = stableDiffusionRequirementIntentFromFields(fields, "textEncoderRequirementPolicy", "textEncoderVerifiedContentId"); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return stableDiffusionPortableConfig{}, reason
	}
	if result.vae, reason = stableDiffusionRequirementIntentFromFields(fields, "vaeRequirementPolicy", "vaeVerifiedContentId"); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return stableDiffusionPortableConfig{}, reason
	}
	if result.uncond, reason = stableDiffusionRequirementIntentFromFields(fields, "uncondDiffusionRequirementPolicy", "uncondDiffusionVerifiedContentId"); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return stableDiffusionPortableConfig{}, reason
	}
	if !family.requiresUncond && (fields["uncondDiffusionRequirementPolicy"] != nil || fields["uncondDiffusionVerifiedContentId"] != nil) {
		return stableDiffusionPortableConfig{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if result.loras, reason = stableDiffusionLoRAs(fields["loras"]); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return stableDiffusionPortableConfig{}, reason
	}
	if result.execution, reason = stableDiffusionExecutionOptionsFromValue(fields["executionOptions"], result.execution); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return stableDiffusionPortableConfig{}, reason
	}
	return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func stableDiffusionRequirementIntentFromFields(
	fields map[string]*structpb.Value,
	policyKey string,
	contentKey string,
) (stableDiffusionRequirementIntent, runtimev1.LocalCapabilityReason) {
	policy, reason := portablePolicy(fields, policyKey)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return stableDiffusionRequirementIntent{}, reason
	}
	contentID, reason := portableString(fields, contentKey)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return stableDiffusionRequirementIntent{}, reason
	}
	contentID, reason = normalizeVerifiedContentID(contentID)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED ||
		(policy == runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT && contentID == "") {
		return stableDiffusionRequirementIntent{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	return stableDiffusionRequirementIntent{policy: policy, verifiedContentID: contentID}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func stableDiffusionLoRAs(value *structpb.Value) ([]stableDiffusionLoRAIntent, runtimev1.LocalCapabilityReason) {
	if value == nil {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
	list := value.GetListValue()
	if list == nil || len(list.GetValues()) > 32 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	result := make([]stableDiffusionLoRAIntent, 0, len(list.GetValues()))
	for index, item := range list.GetValues() {
		object := item.GetStructValue()
		if object == nil {
			return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
		fields := object.GetFields()
		for key := range fields {
			switch key {
			case "displayLabel", "requirementPolicy", "verifiedContentId", "weight":
			default:
				return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
			}
		}
		intent, reason := stableDiffusionRequirementIntentFromFields(fields, "requirementPolicy", "verifiedContentId")
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			return nil, reason
		}
		displayLabel := "LoRA " + strconv.Itoa(index+1)
		if fields["displayLabel"] != nil {
			label, ok := portableStringValue(fields["displayLabel"])
			if !ok || strings.TrimSpace(label) == "" || label != strings.TrimSpace(label) {
				return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
			}
			displayLabel = label
		}
		weight := 1.0
		if fields["weight"] != nil {
			if _, ok := fields["weight"].Kind.(*structpb.Value_NumberValue); !ok {
				return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
			}
			weight = fields["weight"].GetNumberValue()
			if math.IsNaN(weight) || math.IsInf(weight, 0) || weight < -4 || weight > 4 {
				return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
			}
		}
		result = append(result, stableDiffusionLoRAIntent{
			displayLabel:      displayLabel,
			policy:            intent.policy,
			verifiedContentID: intent.verifiedContentID,
			weight:            weight,
		})
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
		value, ok := stableDiffusionInteger(field, -9007199254740991, 9007199254740991)
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
