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
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
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

// StableDiffusionImageDriver owns the stable-diffusion.cpp portable dialect.
// nimi-authority: definition.nimi.platform.core-protocol.capability-implementation-driver
// nimi-authority: rule.nimi.runtime.ai-provider.r063
// nimi-authority: rule.nimi.runtime.ai-provider.r064
type StableDiffusionImageDriver struct{}

func (StableDiffusionImageDriver) EffectiveRequestDefaults(value *structpb.Struct) map[string]string {
	portable, reason := parseStableDiffusionPortableConfig(value)
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
	name           string
	requiresUncond bool
	compatibleVAEs []string
}

// stableDiffusionRequirementIntent remains the video Driver's portable
// requirement intent. Image authoring does not admit these fields.
type stableDiffusionRequirementIntent struct {
	policy            runtimev1.LocalCapabilityRequirementPolicy
	verifiedContentID string
}

func stableDiffusionFamily(value string) (stableDiffusionFamilySpec, bool) {
	if value == "" || value != strings.TrimSpace(value) {
		return stableDiffusionFamilySpec{}, false
	}
	switch value {
	case "z-image":
		// Z-Image consumes the FLUX.1 VAE (ae.safetensors): its decoder conv_in
		// weight projects the 16-channel latent shape as flux1-vae.
		return stableDiffusionFamilySpec{name: value, compatibleVAEs: []string{"flux1-vae"}}, true
	case "ideogram4":
		return stableDiffusionFamilySpec{name: value, requiresUncond: true, compatibleVAEs: []string{"flux2-vae"}}, true
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
}

type stableDiffusionPortableConfig struct {
	family           stableDiffusionFamilySpec
	enableInputImage bool
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
	if portable.enableInputImage != contains(features, aicapabilities.FeatureInputImage) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}

	requirements := []*runtimev1.LocalCapabilityRequirement{
		stableDiffusionRequirement(
			StableDiffusionMainRequirementID,
			runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
			"image",
			0,
			stableDiffusionMainLabel,
			map[string]any{"asset_kind": "image", "model_family": portable.family.name},
		),
		stableDiffusionRequirement(
			StableDiffusionTextEncoderRequirementID,
			runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
			"chat",
			0,
			stableDiffusionTextEncoderLabel,
			map[string]any{"asset_kind": "chat"},
		),
		stableDiffusionRequirement(
			StableDiffusionVAERequirementID,
			runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
			"vae",
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
			0,
			stableDiffusionUncondDiffusionLabel,
			map[string]any{"asset_kind": "image", "model_family": portable.family.name, "artifact_role": "uncond_diffusion_model"},
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
	ordinal uint32,
	displayLabel string,
	constraints map[string]any,
) *runtimev1.LocalCapabilityRequirement {
	compatibility, _ := structpb.NewStruct(constraints)
	return &runtimev1.LocalCapabilityRequirement{
		RequirementId:            id,
		Role:                     role,
		ResourceKind:             resourceKind,
		Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
		CompatibilityConstraints: compatibility,
		OccurrenceOrdinal:        ordinal,
		DisplayLabel:             displayLabel,
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
	return index == len(requirements)
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
		return false
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
	portable, reason := parseStableDiffusionPortableConfig(input.PortableConfig)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("stable-diffusion portable config: %s", reason.String()))
	}
	features, reason := normalizedStableDiffusionFeatures(input.SupportedFeatures)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED ||
		portable.enableInputImage != contains(features, aicapabilities.FeatureInputImage) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("stable-diffusion supported features do not match the portable configuration"))
	}
	bindings, orderedIDs, err := exactStableDiffusionInvocationBindings(portable, input.ExactBindings)
	if err != nil {
		return nil, invocationError(InvocationFailureInvalidBinding, err)
	}
	request, err := normalizeStableDiffusionImageRequest(input.Request, portable, features)
	if err != nil {
		return nil, err
	}

	modelFiles := make([]ImageModelFile, 0, len(orderedIDs))
	for _, requirementID := range orderedIDs {
		modelFiles = append(modelFiles, stableDiffusionImageModelFile(bindings[requirementID]))
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
	for _, requirementID := range orderedIDs {
		binding := bindings[requirementID]
		for _, value := range []string{binding.RequirementID, binding.LocalAssetID, binding.AbsolutePath, binding.VerifiedContentID, binding.EntrySHA256} {
			_, _ = hasher.Write([]byte(value))
			_, _ = hasher.Write([]byte{0})
		}
	}
	load := StableDiffusionCPPLoadPlan{
		main:                    stableDiffusionImageModelFile(bindings[StableDiffusionMainRequirementID]),
		textEncoder:             stableDiffusionImageModelFile(bindings[StableDiffusionTextEncoderRequirementID]),
		vae:                     stableDiffusionImageModelFile(bindings[StableDiffusionVAERequirementID]),
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
	var requestPlan ImageRequestPlan = StableDiffusionCPPTextToImageRequestPlan{stableDiffusionCPPRequestFields: requestFields}
	if request.inputImage != "" {
		requestPlan = StableDiffusionCPPImageToImageRequestPlan{
			stableDiffusionCPPRequestFields: requestFields,
			inputImage:                      request.inputImage,
			mask:                            request.mask,
		}
	}
	return &ImageInvocationPlan{
		processKey:  hex.EncodeToString(hasher.Sum(nil)),
		modelFiles:  modelFiles,
		loadPlan:    load,
		requestPlan: requestPlan,
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
		localAssetID:      binding.LocalAssetID,
		absolutePath:      binding.AbsolutePath,
		verifiedContentID: binding.VerifiedContentID,
		entrySHA256:       binding.EntrySHA256,
	}
}

type stableDiffusionImageTranslator struct{}

func (stableDiffusionImageTranslator) validateImagePlan(plan *ImageInvocationPlan) error {
	if plan == nil || strings.TrimSpace(plan.processKey) == "" || len(plan.modelFiles) < 3 || len(plan.modelFiles) > 4 {
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
	if load.threads < 0 || load.threads > 1024 || load.cfgScale != request.cfgScale ||
		load.sampler != request.sampler || load.scheduler != request.scheduler {
		return fmt.Errorf("stable-diffusion image load and request variants are inconsistent")
	}
	files := []ImageModelFile{load.main, load.textEncoder, load.vae}
	if uncond, exists := load.UncondDiffusion(); exists {
		files = append(files, uncond)
	}
	if len(files) != len(plan.modelFiles) {
		return fmt.Errorf("stable-diffusion image load content is inconsistent")
	}
	for index, file := range files {
		if file.localAssetID == "" || file.verifiedContentID == "" || file.entrySHA256 == "" ||
			!filepath.IsAbs(file.absolutePath) || filepath.Clean(file.absolutePath) != file.absolutePath ||
			!canonicalInvocationSHA256(file.verifiedContentID, file.entrySHA256) {
			return fmt.Errorf("stable-diffusion image load content is not exact")
		}
		if file != plan.modelFiles[index] {
			return fmt.Errorf("stable-diffusion image load content does not match custody inputs")
		}
	}
	if imageToImage, isImageToImage := plan.requestPlan.(StableDiffusionCPPImageToImageRequestPlan); isImageToImage {
		if strings.TrimSpace(imageToImage.inputImage) == "" || (imageToImage.mask != "" && strings.TrimSpace(imageToImage.mask) == "") {
			return fmt.Errorf("stable-diffusion image-to-image request is incomplete")
		}
	}
	return nil
}

func stableDiffusionCPPRequestFieldsFromPlan(plan ImageRequestPlan) (stableDiffusionCPPRequestFields, error) {
	switch typed := plan.(type) {
	case StableDiffusionCPPTextToImageRequestPlan:
		return typed.stableDiffusionCPPRequestFields, nil
	case StableDiffusionCPPImageToImageRequestPlan:
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
		observation.Format != constraints.format || observation.Width != constraints.width || observation.Height != constraints.height {
		return ImageArtifact{}, fmt.Errorf("stable-diffusion backend artifact violates result constraints")
	}
	return ImageArtifact{Index: observation.Index, Payload: append([]byte(nil), observation.Payload...), MediaType: constraints.mediaType}, nil
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
	if inputImage != "" && !contains(features, aicapabilities.FeatureInputImage) {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureUnsupported, fmt.Errorf("image.generate input.image is not declared by this configuration"))
	}
	if mask != "" && !contains(features, aicapabilities.FeatureInputMask) {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureUnsupported, fmt.Errorf("image.generate input.mask is not declared by this configuration"))
	}
	if mask != "" && inputImage == "" {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("image.generate mask requires an input image"))
	}
	seed := portable.execution.seed
	if spec.Seed != nil {
		seed = spec.GetSeed()
	}
	if seed < math.MinInt32 || seed > math.MaxInt32 {
		return normalizedStableDiffusionImageRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("image.generate seed is outside the stable-diffusion.cpp signed-int32 range"))
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

// StableDiffusionImageSizeSupported reports whether value is an exact size
// admitted by the stable-diffusion.cpp Local Driver.
func StableDiffusionImageSizeSupported(value string) bool {
	_, _, ok := parseStableDiffusionSize(value)
	return ok
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
		case "modelFamily", "enableInputImage", "executionOptions":
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
		if feature != aicapabilities.FeatureInputImage && feature != aicapabilities.FeatureInputMask {
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
