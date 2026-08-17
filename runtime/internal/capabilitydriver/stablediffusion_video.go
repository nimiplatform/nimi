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
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	StableDiffusionVideoImplementationID   = StableDiffusionImplementationID
	StableDiffusionVideoDriverID           = StableDiffusionDriverID
	StableDiffusionVideoDriverDialect      = "stable-diffusion.cpp/minimax-h3-video-generate/v1"
	StableDiffusionVideoCapabilityContract = "video.generate"
	StableDiffusionVideoRecipeID           = "minimax-h3"

	StableDiffusionVideoFL2VARequirementID   = "diffusion.fl2va"
	StableDiffusionVideoRef2VARequirementID  = "diffusion.ref2va"
	StableDiffusionVideoEncoderRequirementID = "encoder.h3-combined"
	StableDiffusionVideoVAERequirementID     = "vae.video"
	StableDiffusionAudioVAERequirementID     = "vae.audio"
	stableDiffusionVideoMaxFrames            = 512
	stableDiffusionVideoMaxDurationSec       = 20
)

const stableDiffusionVideoReferenceImageFeature = "input.image"

// StableDiffusionVideoDriver owns the stable-diffusion.cpp MiniMax-H3 video
// dialect. Configuration always binds both diffusion routes and all shared
// components; each invocation loads exactly one route transformer.
type StableDiffusionVideoDriver struct{}

func (StableDiffusionVideoDriver) EffectiveRequestDefaults(_ string, _ *structpb.Struct) map[string]string {
	return map[string]string{
		"options.resolution": "512x288",
		"options.frames":     "22",
		"options.seed":       "0",
	}
}

// ProjectRecipe keeps the MiniMax-H3 recipe identity in the versioned Driver
// dialect. Catalog metadata decorates the five projected slots but cannot
// create a second topology or pin a model content identity.
func (driver StableDiffusionVideoDriver) ProjectRecipe(recipeID string, options *structpb.Struct, supportedFeatures []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if strings.TrimSpace(recipeID) != StableDiffusionVideoRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	return driver.Interpret(InterpretInput{RecipeID: recipeID, PortableConfig: options, SupportedFeatures: supportedFeatures})
}

func (driver StableDiffusionVideoDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	slot, ok := stableDiffusionVideoSlot(input.Requirement.GetRequirementId())
	if !ok || filepath.Ext(strings.ToLower(input.Entry.RelativePath)) != "."+slot.format {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	descriptor := ModelAssetDescriptor{Kind: slot.assetKind, Engine: "media", FormatProbe: input.Entry.FormatProbe}
	if slot.artifactRole != "" {
		descriptor.ArtifactRoles = []string{slot.artifactRole}
	}
	return validatedModelAssetBindingProjection(input, descriptor, 0, driver.ValidateBinding)
}

type stableDiffusionVideoSlotSpec struct {
	id           string
	role         runtimev1.LocalCapabilityRequirementRole
	resourceKind string
	assetKind    runtimev1.LocalAssetKind
	artifactRole string
	format       string
	displayLabel string
}

var stableDiffusionVideoSlots = []stableDiffusionVideoSlotSpec{
	{
		id: StableDiffusionVideoFL2VARequirementID, role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		resourceKind: "video", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO, artifactRole: "diffusion_transformer",
		format: "gguf", displayLabel: "MiniMax-H3 FL2VA transformer",
	},
	{
		id: StableDiffusionVideoRef2VARequirementID, role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
		resourceKind: "video", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO, artifactRole: "diffusion_transformer",
		format: "gguf", displayLabel: "MiniMax-H3 Ref2VA transformer",
	},
	{
		id: StableDiffusionVideoEncoderRequirementID, role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
		resourceKind: "chat", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, artifactRole: "llm",
		format: "gguf", displayLabel: "MiniMax-H3 combined Qwen3-VL encoder",
	},
	{
		id: StableDiffusionVideoVAERequirementID, role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
		resourceKind: "vae", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
		format: "safetensors", displayLabel: "MiniMax-H3 video VAE",
	},
	{
		id: StableDiffusionAudioVAERequirementID, role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
		resourceKind: "vae", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
		format: "safetensors", displayLabel: "MiniMax-H3 audio VAE",
	},
}

type stableDiffusionVideoPortableConfig struct {
	recipe stableDiffusionVideoRecipe
}

type stableDiffusionVideoRecipe struct {
	cfgScale                float64
	flowShift               float64
	sampleMethod            string
	scheduler               string
	diffusionFlashAttention bool
	offloadToCPU            bool
	rng                     string
}

func defaultStableDiffusionVideoRecipe() stableDiffusionVideoRecipe {
	return stableDiffusionVideoRecipe{
		cfgScale:                1,
		flowShift:               12,
		diffusionFlashAttention: true,
		offloadToCPU:            true,
		rng:                     "cpu",
	}
}

func (StableDiffusionVideoDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	_, reason := parseStableDiffusionVideoPortableConfig(input.PortableConfig)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, reason
	}
	for _, feature := range input.SupportedFeatures {
		if feature != stableDiffusionVideoReferenceImageFeature {
			return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
		}
	}
	requirements := make([]*runtimev1.LocalCapabilityRequirement, 0, len(stableDiffusionVideoSlots))
	for _, slot := range stableDiffusionVideoSlots {
		constraintValues := map[string]any{
			"asset_kind": slot.resourceKind,
			"format":     slot.format,
		}
		// Constraints stay limited to generic facts that asset projection can
		// actually produce: imported assets carry engines such as media/llama
		// and no minimax-h3 family projection exists, so engine/model_family
		// constraints would be unsatisfiable. Exact H3 admission is owned by
		// the bounded content probe in stableDiffusionVideoSlotFormatValid.
		// Passive VAE file imports project no artifact roles. DiT and encoder
		// requirements use only the generic roles produced by formal import.
		if slot.artifactRole != "" {
			constraintValues["artifact_role"] = slot.artifactRole
		}
		constraints, _ := structpb.NewStruct(constraintValues)
		requirements = append(requirements, &runtimev1.LocalCapabilityRequirement{
			RequirementId:            slot.id,
			Role:                     slot.role,
			ResourceKind:             slot.resourceKind,
			Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
			CompatibilityConstraints: constraints,
			OccurrenceOrdinal:        0,
			DisplayLabel:             slot.displayLabel,
		})
	}
	return requirements, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (StableDiffusionVideoDriver) ValidateBinding(
	requirement *runtimev1.LocalCapabilityRequirement,
	binding *runtimev1.ModelAssetExactBinding,
	asset ModelAssetDescriptor,
) runtimev1.LocalCapabilityReason {
	if requirement == nil || binding == nil || binding.GetRequirementId() != requirement.GetRequirementId() {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	slot, ok := stableDiffusionVideoSlot(requirement.GetRequirementId())
	if !ok || !validStableDiffusionVideoRequirement(requirement, slot) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	if strings.TrimSpace(binding.GetModelAssetId()) == "" || strings.TrimSpace(asset.ModelAssetID) == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if !canonicalInvocationSHA256(binding.GetVerifiedContentId(), binding.GetEntrySha256()) ||
		!canonicalInvocationSHA256(asset.VerifiedContentID, asset.EntrySHA256) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED
	}
	if binding.GetModelAssetId() != asset.ModelAssetID || binding.GetVerifiedContentId() != asset.VerifiedContentID ||
		binding.GetEntrySha256() != asset.EntrySHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	if asset.Kind != slot.assetKind || (slot.artifactRole != "" && !contains(asset.ArtifactRoles, slot.artifactRole)) ||
		!stableDiffusionVideoSlotFormatValid(slot.id, slot.format, asset.FormatProbe) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver StableDiffusionVideoDriver) ValidateCombination(
	requirements []*runtimev1.LocalCapabilityRequirement,
	bindings []*runtimev1.ModelAssetExactBinding,
	assets []ModelAssetDescriptor,
) runtimev1.LocalCapabilityReason {
	if len(bindings) < len(stableDiffusionVideoSlots) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
	}
	if len(requirements) != len(stableDiffusionVideoSlots) || len(bindings) != len(stableDiffusionVideoSlots) || len(assets) != len(bindings) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	byRequirement := make(map[string]*runtimev1.LocalCapabilityRequirement, len(requirements))
	for index, slot := range stableDiffusionVideoSlots {
		requirement := requirements[index]
		if !validStableDiffusionVideoRequirement(requirement, slot) {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
		byRequirement[slot.id] = requirement
	}
	seen := make(map[string]struct{}, len(bindings))
	for index, binding := range bindings {
		if binding == nil || byRequirement[binding.GetRequirementId()] == nil {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		if _, exists := seen[binding.GetRequirementId()]; exists {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		seen[binding.GetRequirementId()] = struct{}{}
		if reason := driver.ValidateBinding(byRequirement[binding.GetRequirementId()], binding, assets[index]); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			return reason
		}
	}
	if len(seen) != len(stableDiffusionVideoSlots) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func stableDiffusionVideoSlot(requirementID string) (stableDiffusionVideoSlotSpec, bool) {
	for _, slot := range stableDiffusionVideoSlots {
		if slot.id == requirementID {
			return slot, true
		}
	}
	return stableDiffusionVideoSlotSpec{}, false
}

func validStableDiffusionVideoRequirement(requirement *runtimev1.LocalCapabilityRequirement, slot stableDiffusionVideoSlotSpec) bool {
	if requirement == nil || requirement.GetRequirementId() != slot.id || requirement.GetRole() != slot.role ||
		requirement.GetResourceKind() != slot.resourceKind || requirement.GetOccurrenceOrdinal() != 0 ||
		requirement.GetDisplayLabel() != slot.displayLabel ||
		requirement.GetPolicy() != runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE ||
		requirement.GetPreferredVerifiedContentId() != "" {
		return false
	}
	constraints := requirement.GetCompatibilityConstraints()
	want := map[string]string{
		"asset_kind": slot.resourceKind,
		"format":     slot.format,
	}
	if slot.artifactRole != "" {
		want["artifact_role"] = slot.artifactRole
	}
	if constraints == nil || len(constraints.GetFields()) != len(want) {
		return false
	}
	for key, expected := range want {
		value := constraints.GetFields()[key]
		text, ok := portableStringValue(value)
		if !ok || text != expected {
			return false
		}
	}
	return true
}

func stableDiffusionVideoSlotFormatValid(requirementID, format string, probe []byte) bool {
	if len(probe) > MaxAssetFormatProbeBytes {
		return false
	}
	switch format {
	case "gguf":
		if len(probe) < 4 || !bytes.Equal(probe[:4], []byte("GGUF")) {
			return false
		}
		switch requirementID {
		case StableDiffusionVideoFL2VARequirementID, StableDiffusionVideoRef2VARequirementID:
			// The real FL2VA and Ref2VA files share these H3 DiT tensors. Their
			// time_embedder versus adaln_t_table difference is a DiT variant marker,
			// not a task-family marker, and neither file contains a reference tensor
			// name. Therefore content can reject non-H3/wrong-kind files but cannot
			// distinguish these two declared route bindings.
			return probeContainsAll(probe,
				"blocks.0.adaln_proj.linear.",
				"condition_proj.",
				"audio_patch_proj.",
			)
		case StableDiffusionVideoEncoderRequirementID:
			return bytes.Contains(probe, []byte("visual.deepstack_merger_list."))
		default:
			return false
		}
	case "safetensors":
		if len(probe) < 10 {
			return false
		}
		headerLength := binary.LittleEndian.Uint64(probe[:8])
		if headerLength < 2 || headerLength > MaxSafetensorsHeaderBytes || headerLength > uint64(len(probe)-8) {
			return false
		}
		var header map[string]json.RawMessage
		if json.Unmarshal(probe[8:8+headerLength], &header) != nil || header == nil {
			return false
		}
		switch requirementID {
		case StableDiffusionVideoVAERequirementID:
			_, ok := header["decoder.mask_token"]
			return ok
		case StableDiffusionAudioVAERequirementID:
			for name := range header {
				if strings.HasPrefix(name, "dec_in_proj.") {
					return true
				}
			}
			return false
		default:
			return false
		}
	default:
		return false
	}
}

func probeContainsAll(probe []byte, signatures ...string) bool {
	for _, signature := range signatures {
		if !bytes.Contains(probe, []byte(signature)) {
			return false
		}
	}
	return true
}

func parseStableDiffusionVideoPortableConfig(value *structpb.Struct) (stableDiffusionVideoPortableConfig, runtimev1.LocalCapabilityReason) {
	result := stableDiffusionVideoPortableConfig{
		recipe: defaultStableDiffusionVideoRecipe(),
	}
	if value == nil {
		return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
	for key := range value.GetFields() {
		if key != "executionOptions" {
			return stableDiffusionVideoPortableConfig{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
	}
	var reason runtimev1.LocalCapabilityReason
	result.recipe, reason = stableDiffusionVideoRecipeFromValue(value.GetFields()["executionOptions"], result.recipe)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return stableDiffusionVideoPortableConfig{}, reason
	}
	return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func stableDiffusionVideoRecipeFromValue(
	value *structpb.Value,
	defaults stableDiffusionVideoRecipe,
) (stableDiffusionVideoRecipe, runtimev1.LocalCapabilityReason) {
	if value == nil {
		return defaults, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
	object := value.GetStructValue()
	if object == nil {
		return stableDiffusionVideoRecipe{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	fields := object.GetFields()
	for key := range fields {
		switch key {
		case "cfgScale", "flowShift", "sampleMethod", "scheduler", "diffusionFlashAttention", "offloadParamsToCPU", "rng":
		default:
			return stableDiffusionVideoRecipe{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
	}
	result := defaults
	for key, target := range map[string]*float64{"cfgScale": &result.cfgScale, "flowShift": &result.flowShift} {
		field := fields[key]
		if field == nil {
			continue
		}
		if _, ok := field.Kind.(*structpb.Value_NumberValue); !ok {
			return stableDiffusionVideoRecipe{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
		number := field.GetNumberValue()
		if math.IsNaN(number) || math.IsInf(number, 0) || number < 0 || number > math.MaxFloat32 || (key == "cfgScale" && number > 30) {
			return stableDiffusionVideoRecipe{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
		*target = number
	}
	for key, target := range map[string]*string{"sampleMethod": &result.sampleMethod, "scheduler": &result.scheduler} {
		field := fields[key]
		if field == nil {
			continue
		}
		text, ok := portableStringValue(field)
		if !ok || !stableDiffusionOptionToken(text) {
			return stableDiffusionVideoRecipe{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
		if text == "engine-default" {
			text = ""
		}
		*target = text
	}
	for key, target := range map[string]*bool{
		"diffusionFlashAttention": &result.diffusionFlashAttention,
		"offloadParamsToCPU":      &result.offloadToCPU,
	} {
		field := fields[key]
		if field == nil {
			continue
		}
		if _, ok := field.Kind.(*structpb.Value_BoolValue); !ok {
			return stableDiffusionVideoRecipe{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
		*target = field.GetBoolValue()
	}
	if field := fields["rng"]; field != nil {
		text, ok := portableStringValue(field)
		if !ok || (text != "std_default" && text != "cuda" && text != "cpu") {
			return stableDiffusionVideoRecipe{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
		result.rng = text
	}
	return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func stableDiffusionVideoEngineOptionIdentity(value string) string {
	if value == "" {
		return "engine-default"
	}
	return value
}

func (StableDiffusionVideoDriver) PlanVideoInvocation(input VideoInvocationInput) (*VideoInvocationPlan, error) {
	if input.LoadoutID == "" || input.LoadoutID != strings.TrimSpace(input.LoadoutID) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("stable-diffusion video Loadout identity is required"))
	}
	portable, reason := parseStableDiffusionVideoPortableConfig(input.PortableConfig)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("stable-diffusion video portable config: %s", reason.String()))
	}
	bindings, err := exactStableDiffusionVideoInvocationBindings(input.ExactBindings)
	if err != nil {
		return nil, invocationError(InvocationFailureInvalidBinding, err)
	}
	request, err := normalizeStableDiffusionVideoRequest(input.Request)
	if err != nil {
		return nil, err
	}

	allBindings := make([]InvocationExactBinding, 0, len(stableDiffusionVideoSlots))
	for _, slot := range stableDiffusionVideoSlots {
		allBindings = append(allBindings, bindings[slot.id])
	}
	diffusionRequirementID := StableDiffusionVideoFL2VARequirementID
	if request.conditioningMode == VideoConditioningModeRef2VAImage {
		diffusionRequirementID = StableDiffusionVideoRef2VARequirementID
	}
	loadedIDs := []string{
		diffusionRequirementID,
		StableDiffusionVideoEncoderRequirementID,
		StableDiffusionVideoVAERequirementID,
		StableDiffusionAudioVAERequirementID,
	}
	modelFiles := make([]InvocationExactBinding, 0, len(loadedIDs))
	for _, requirementID := range loadedIDs {
		modelFiles = append(modelFiles, bindings[requirementID])
	}

	identity := Identity{
		ImplementationID: StableDiffusionVideoImplementationID,
		DriverID:         StableDiffusionVideoDriverID,
		DriverDialect:    StableDiffusionVideoDriverDialect,
	}
	hasher := sha256.New()
	for _, value := range []string{
		identity.ImplementationID,
		identity.DriverID,
		identity.DriverDialect,
		string(request.conditioningMode),
		strconv.FormatFloat(portable.recipe.cfgScale, 'g', -1, 64),
		strconv.FormatFloat(portable.recipe.flowShift, 'g', -1, 64),
		stableDiffusionVideoEngineOptionIdentity(portable.recipe.sampleMethod),
		stableDiffusionVideoEngineOptionIdentity(portable.recipe.scheduler),
		strconv.FormatBool(portable.recipe.diffusionFlashAttention),
		strconv.FormatBool(portable.recipe.offloadToCPU),
		portable.recipe.rng,
	} {
		_, _ = hasher.Write([]byte(value))
		_, _ = hasher.Write([]byte{0})
	}
	for _, binding := range modelFiles {
		for _, value := range invocationExactBindingIdentity(binding) {
			_, _ = hasher.Write([]byte(value))
			_, _ = hasher.Write([]byte{0})
		}
	}

	return &VideoInvocationPlan{
		processKey:              hex.EncodeToString(hasher.Sum(nil)),
		loadoutID:               input.LoadoutID,
		driverIdentity:          identity,
		portableConfig:          cloneStruct(input.PortableConfig),
		exactBindings:           allBindings,
		modelFiles:              modelFiles,
		diffusionModelPath:      bindings[diffusionRequirementID].AbsolutePath,
		encoderPath:             bindings[StableDiffusionVideoEncoderRequirementID].AbsolutePath,
		videoVAEPath:            bindings[StableDiffusionVideoVAERequirementID].AbsolutePath,
		audioVAEPath:            bindings[StableDiffusionAudioVAERequirementID].AbsolutePath,
		prompt:                  request.prompt,
		negativePrompt:          request.negativePrompt,
		width:                   request.width,
		height:                  request.height,
		frameCount:              request.frameCount,
		fps:                     24,
		seed:                    request.seed,
		audioRequired:           true,
		returnLastFrame:         request.returnLastFrame,
		conditioningMode:        request.conditioningMode,
		referenceImage:          request.referenceImage,
		cfgScale:                portable.recipe.cfgScale,
		flowShift:               portable.recipe.flowShift,
		sampleMethod:            portable.recipe.sampleMethod,
		scheduler:               portable.recipe.scheduler,
		diffusionFlashAttention: portable.recipe.diffusionFlashAttention,
		offloadToCPU:            portable.recipe.offloadToCPU,
		rng:                     portable.recipe.rng,
	}, nil
}

func exactStableDiffusionVideoInvocationBindings(values []InvocationExactBinding) (map[string]InvocationExactBinding, error) {
	expected := make(map[string]struct{}, len(stableDiffusionVideoSlots))
	for _, slot := range stableDiffusionVideoSlots {
		expected[slot.id] = struct{}{}
	}
	bindings := make(map[string]InvocationExactBinding, len(values))
	for _, binding := range values {
		requirementID := strings.TrimSpace(binding.RequirementID)
		if requirementID != binding.RequirementID {
			return nil, fmt.Errorf("stable-diffusion video invocation contains a non-canonical requirement %q", binding.RequirementID)
		}
		if _, ok := expected[requirementID]; !ok {
			return nil, fmt.Errorf("stable-diffusion video invocation contains an unknown requirement %q", binding.RequirementID)
		}
		if _, exists := bindings[requirementID]; exists {
			return nil, fmt.Errorf("stable-diffusion video invocation contains duplicate requirement %q", requirementID)
		}
		if binding.ModelAssetID == "" || binding.ModelAssetID != strings.TrimSpace(binding.ModelAssetID) ||
			binding.VerifiedContentID == "" || binding.VerifiedContentID != strings.TrimSpace(binding.VerifiedContentID) ||
			binding.EntrySHA256 == "" || binding.EntrySHA256 != strings.TrimSpace(binding.EntrySHA256) ||
			!canonicalInvocationSHA256(binding.VerifiedContentID, binding.EntrySHA256) ||
			!filepath.IsAbs(binding.AbsolutePath) || filepath.Clean(binding.AbsolutePath) != binding.AbsolutePath {
			return nil, fmt.Errorf("stable-diffusion video invocation requirement %q is not an exact absolute binding", requirementID)
		}
		bindings[requirementID] = cloneInvocationExactBindings([]InvocationExactBinding{binding})[0]
	}
	for _, slot := range stableDiffusionVideoSlots {
		if _, ok := bindings[slot.id]; !ok {
			return nil, fmt.Errorf("stable-diffusion video invocation requirement %q is required", slot.id)
		}
	}
	if len(bindings) != len(stableDiffusionVideoSlots) {
		return nil, fmt.Errorf("stable-diffusion video invocation contains ambiguous bindings")
	}
	return bindings, nil
}

type normalizedStableDiffusionVideoRequest struct {
	prompt           string
	negativePrompt   string
	width            int
	height           int
	frameCount       int
	seed             int64
	returnLastFrame  bool
	conditioningMode VideoConditioningMode
	referenceImage   *VideoResolvedInput
}

func normalizeStableDiffusionVideoRequest(request VideoInvocationRequest) (normalizedStableDiffusionVideoRequest, error) {
	prompt := strings.TrimSpace(request.Prompt)
	if prompt == "" {
		return normalizedStableDiffusionVideoRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("video.generate prompt is required"))
	}
	// The canonical ratio profiles keep the 288px short-edge baseline while
	// remaining exactly 32-aligned. Square uses the balanced 384px profile:
	// 16:9=512x288, 4:3=384x288, 1:1=384x384, 3:4=288x384,
	// 9:16=288x512, and 21:9=672x288.
	width, height := request.Width, request.Height
	ratio := strings.TrimSpace(request.Ratio)
	if width == 0 && height == 0 {
		if ratio == "" {
			width, height = 512, 288
		} else {
			var ok bool
			width, height, ok = stableDiffusionVideoSizeForRatio(ratio)
			if !ok {
				return normalizedStableDiffusionVideoRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("video.generate ratio %q cannot determine a local resolution", ratio))
			}
		}
	}
	if width <= 0 || height <= 0 || width%32 != 0 || height%32 != 0 {
		return normalizedStableDiffusionVideoRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("video.generate width and height must be positive multiples of 32"))
	}
	if ratio != "" && !stableDiffusionVideoResolutionMatchesRatio(width, height, ratio) {
		return normalizedStableDiffusionVideoRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("video.generate resolution %dx%d contradicts ratio %q", width, height, ratio))
	}
	fps := request.FPS
	if fps == 0 {
		fps = 24
	}
	if fps != 24 {
		return normalizedStableDiffusionVideoRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("video.generate fps must be 24"))
	}
	if request.DurationSec < 0 || request.DurationSec > stableDiffusionVideoMaxDurationSec || (request.DurationSec > 0 && request.FrameCount > 0) {
		return normalizedStableDiffusionVideoRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("video.generate duration and frame count are invalid"))
	}
	frameCount := request.FrameCount
	if request.DurationSec > 0 {
		frameCount = stableDiffusionVideoDurationFrameCount(request.DurationSec)
	} else if frameCount == 0 {
		frameCount = 22
	}
	if frameCount < 5 || frameCount > stableDiffusionVideoMaxFrames || (frameCount-5)%17 != 0 {
		return normalizedStableDiffusionVideoRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("video.generate frame count must be 17k+5 and no greater than %d", stableDiffusionVideoMaxFrames))
	}
	// GenerateAudio stays a typed reject when false: proto3 erases bool
	// presence upstream, so the driver cannot distinguish "absent" from an
	// explicit opt-out, and silently overriding an explicit false would break
	// fail-closed packet semantics. The first-party absent-to-true default is
	// applied by the Kit caller instead.
	if !request.GenerateAudio {
		return normalizedStableDiffusionVideoRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("video.generate audio is required for MiniMax-H3"))
	}
	result := normalizedStableDiffusionVideoRequest{
		prompt:           prompt,
		negativePrompt:   strings.TrimSpace(request.NegativePrompt),
		width:            width,
		height:           height,
		frameCount:       frameCount,
		seed:             request.Seed,
		returnLastFrame:  request.ReturnLastFrame,
		conditioningMode: VideoConditioningModeFL2VAT2VA,
	}
	if len(request.Inputs) == 0 {
		return result, nil
	}
	if len(request.Inputs) != 1 || request.Inputs[0].Role != VideoInputRoleReferenceImage {
		return normalizedStableDiffusionVideoRequest{}, invocationError(InvocationFailureUnsupported, fmt.Errorf("stable-diffusion H3 supports prompt-only or exactly one reference image"))
	}
	reference := request.Inputs[0]
	if reference.SourceIdentity == "" || reference.SourceIdentity != strings.TrimSpace(reference.SourceIdentity) || len(reference.ImageBytes) == 0 {
		return normalizedStableDiffusionVideoRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("video.generate resolved reference image is incomplete"))
	}
	reference.ImageBytes = append([]byte(nil), reference.ImageBytes...)
	result.conditioningMode = VideoConditioningModeRef2VAImage
	result.referenceImage = &reference
	return result, nil
}

func stableDiffusionVideoDurationFrameCount(durationSec int) int {
	target := int(math.Ceil(float64(durationSec) * 24))
	if target <= 5 {
		return 5
	}
	return ((target-5+16)/17)*17 + 5
}

func stableDiffusionVideoSizeForRatio(ratio string) (int, int, bool) {
	switch strings.TrimSpace(ratio) {
	case "16:9":
		return 512, 288, true
	case "4:3":
		return 384, 288, true
	case "1:1":
		return 384, 384, true
	case "3:4":
		return 288, 384, true
	case "9:16":
		return 288, 512, true
	case "21:9":
		return 672, 288, true
	default:
		return 0, 0, false
	}
}

func stableDiffusionVideoResolutionMatchesRatio(width int, height int, ratio string) bool {
	var numerator, denominator int
	switch strings.TrimSpace(ratio) {
	case "16:9":
		numerator, denominator = 16, 9
	case "4:3":
		numerator, denominator = 4, 3
	case "1:1":
		numerator, denominator = 1, 1
	case "3:4":
		numerator, denominator = 3, 4
	case "9:16":
		numerator, denominator = 9, 16
	case "21:9":
		numerator, denominator = 21, 9
	default:
		return false
	}
	return width*denominator == height*numerator
}
