package capabilitydriver

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
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

	StableDiffusionVideoFL2VARequirementID   = "diffusion.fl2va"
	StableDiffusionVideoRef2VARequirementID  = "diffusion.ref2va"
	StableDiffusionVideoEncoderRequirementID = "encoder.h3-combined"
	StableDiffusionVideoVAERequirementID     = "vae.video"
	StableDiffusionAudioVAERequirementID     = "vae.audio"

	// MaxSafetensorsHeaderBytes is the largest safetensors JSON header accepted
	// by bounded binding validation. Callers provide the verified entry prefix.
	MaxSafetensorsHeaderBytes = MaxAssetFormatProbeBytes - 8
)

const stableDiffusionVideoReferenceImageFeature = "input.image"

// StableDiffusionVideoDriver owns the stable-diffusion.cpp MiniMax-H3 video
// dialect. Configuration always binds both diffusion routes and all shared
// components; each invocation loads exactly one route transformer.
type StableDiffusionVideoDriver struct{}

type stableDiffusionVideoSlotSpec struct {
	id           string
	role         runtimev1.LocalCapabilityRequirementRole
	resourceKind string
	assetKind    runtimev1.LocalAssetKind
	artifactRole string
	format       string
	displayLabel string
	policyKey    string
	contentIDKey string
}

var stableDiffusionVideoSlots = []stableDiffusionVideoSlotSpec{
	{
		id: StableDiffusionVideoFL2VARequirementID, role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		resourceKind: "video", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO, artifactRole: "diffusion_transformer",
		format: "gguf", displayLabel: "MiniMax-H3 FL2VA transformer", policyKey: "fl2vaRequirementPolicy", contentIDKey: "fl2vaVerifiedContentId",
	},
	{
		id: StableDiffusionVideoRef2VARequirementID, role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
		resourceKind: "video", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO, artifactRole: "diffusion_transformer",
		format: "gguf", displayLabel: "MiniMax-H3 Ref2VA transformer", policyKey: "ref2vaRequirementPolicy", contentIDKey: "ref2vaVerifiedContentId",
	},
	{
		id: StableDiffusionVideoEncoderRequirementID, role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
		resourceKind: "chat", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, artifactRole: "llm",
		format: "gguf", displayLabel: "MiniMax-H3 combined Qwen3-VL encoder", policyKey: "encoderRequirementPolicy", contentIDKey: "encoderVerifiedContentId",
	},
	{
		id: StableDiffusionVideoVAERequirementID, role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
		resourceKind: "vae", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
		format: "safetensors", displayLabel: "MiniMax-H3 video VAE", policyKey: "videoVAERequirementPolicy", contentIDKey: "videoVAEVerifiedContentId",
	},
	{
		id: StableDiffusionAudioVAERequirementID, role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION,
		resourceKind: "vae", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
		format: "safetensors", displayLabel: "MiniMax-H3 audio VAE", policyKey: "audioVAERequirementPolicy", contentIDKey: "audioVAEVerifiedContentId",
	},
}

type stableDiffusionVideoPortableConfig struct {
	intents map[string]stableDiffusionRequirementIntent
}

func (StableDiffusionVideoDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	portable, reason := parseStableDiffusionVideoPortableConfig(input.PortableConfig)
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
		intent := portable.intents[slot.id]
		requirements = append(requirements, &runtimev1.LocalCapabilityRequirement{
			RequirementId:              slot.id,
			Role:                       slot.role,
			ResourceKind:               slot.resourceKind,
			Policy:                     intent.policy,
			PreferredVerifiedContentId: intent.verifiedContentID,
			CompatibilityConstraints:   constraints,
			OccurrenceOrdinal:          0,
			DisplayLabel:               slot.displayLabel,
		})
	}
	return requirements, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (StableDiffusionVideoDriver) ValidateBinding(
	requirement *runtimev1.LocalCapabilityRequirement,
	binding *runtimev1.LocalAssetExactBinding,
	asset AssetDescriptor,
) runtimev1.LocalCapabilityReason {
	if requirement == nil || binding == nil || binding.GetRequirementId() != requirement.GetRequirementId() {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	slot, ok := stableDiffusionVideoSlot(requirement.GetRequirementId())
	if !ok || !validStableDiffusionVideoRequirement(requirement, slot) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	if strings.TrimSpace(binding.GetLocalAssetId()) == "" || strings.TrimSpace(asset.LocalAssetID) == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if !canonicalInvocationSHA256(binding.GetVerifiedContentId(), binding.GetEntrySha256()) ||
		!canonicalInvocationSHA256(asset.VerifiedContentID, asset.EntrySHA256) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED
	}
	if binding.GetLocalAssetId() != asset.LocalAssetID || binding.GetVerifiedContentId() != asset.VerifiedContentID ||
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
	if asset.Kind != slot.assetKind || (slot.artifactRole != "" && !contains(asset.ArtifactRoles, slot.artifactRole)) ||
		!stableDiffusionVideoSlotFormatValid(slot.id, slot.format, asset.FormatProbe) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver StableDiffusionVideoDriver) ValidateCombination(
	requirements []*runtimev1.LocalCapabilityRequirement,
	bindings []*runtimev1.LocalAssetExactBinding,
	assets []AssetDescriptor,
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
		(requirement.GetPolicy() != runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_STRICT &&
			requirement.GetPolicy() != runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE) {
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
	result := stableDiffusionVideoPortableConfig{intents: make(map[string]stableDiffusionRequirementIntent, len(stableDiffusionVideoSlots))}
	if value == nil {
		for _, slot := range stableDiffusionVideoSlots {
			result.intents[slot.id] = stableDiffusionRequirementIntent{policy: runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE}
		}
		return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
	allowed := make(map[string]struct{}, len(stableDiffusionVideoSlots)*2)
	for _, slot := range stableDiffusionVideoSlots {
		allowed[slot.policyKey] = struct{}{}
		allowed[slot.contentIDKey] = struct{}{}
	}
	for key := range value.GetFields() {
		if _, ok := allowed[key]; !ok {
			return stableDiffusionVideoPortableConfig{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
	}
	for _, slot := range stableDiffusionVideoSlots {
		intent, reason := stableDiffusionRequirementIntentFromFields(value.GetFields(), slot.policyKey, slot.contentIDKey)
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			return stableDiffusionVideoPortableConfig{}, reason
		}
		result.intents[slot.id] = intent
	}
	return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (StableDiffusionVideoDriver) PlanVideoInvocation(input VideoInvocationInput) (*VideoInvocationPlan, error) {
	if input.ConfigurationID == "" || input.ConfigurationID != strings.TrimSpace(input.ConfigurationID) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("stable-diffusion video configuration identity is required"))
	}
	if _, reason := parseStableDiffusionVideoPortableConfig(input.PortableConfig); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
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
		strconv.FormatFloat(1.0, 'g', -1, 64),
		strconv.FormatFloat(12.0, 'g', -1, 64),
		"engine-default",
		"engine-default",
		strconv.FormatBool(true),
		strconv.FormatBool(true),
		"cpu",
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

	return &VideoInvocationPlan{
		processKey:              hex.EncodeToString(hasher.Sum(nil)),
		configurationID:         input.ConfigurationID,
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
		conditioningMode:        request.conditioningMode,
		referenceImage:          request.referenceImage,
		cfgScale:                1.0,
		flowShift:               12.0,
		sampleMethod:            "",
		scheduler:               "",
		diffusionFlashAttention: true,
		offloadToCPU:            true,
		rng:                     "cpu",
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
		if binding.LocalAssetID == "" || binding.LocalAssetID != strings.TrimSpace(binding.LocalAssetID) ||
			binding.VerifiedContentID == "" || binding.VerifiedContentID != strings.TrimSpace(binding.VerifiedContentID) ||
			binding.EntrySHA256 == "" || binding.EntrySHA256 != strings.TrimSpace(binding.EntrySHA256) ||
			!canonicalInvocationSHA256(binding.VerifiedContentID, binding.EntrySHA256) ||
			!filepath.IsAbs(binding.AbsolutePath) || filepath.Clean(binding.AbsolutePath) != binding.AbsolutePath {
			return nil, fmt.Errorf("stable-diffusion video invocation requirement %q is not an exact absolute binding", requirementID)
		}
		bindings[requirementID] = binding
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
	conditioningMode VideoConditioningMode
	referenceImage   *VideoResolvedInput
}

func normalizeStableDiffusionVideoRequest(request VideoInvocationRequest) (normalizedStableDiffusionVideoRequest, error) {
	prompt := strings.TrimSpace(request.Prompt)
	if prompt == "" {
		return normalizedStableDiffusionVideoRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("video.generate prompt is required"))
	}
	if request.Width <= 0 || request.Height <= 0 || request.Width%32 != 0 || request.Height%32 != 0 {
		return normalizedStableDiffusionVideoRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("video.generate width and height must be positive multiples of 32"))
	}
	if request.FPS != 24 {
		return normalizedStableDiffusionVideoRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("video.generate fps must be 24"))
	}
	if request.FrameCount < 5 || (request.FrameCount-5)%17 != 0 {
		return normalizedStableDiffusionVideoRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("video.generate frame count must be 17k+5 with k >= 0"))
	}
	if !request.GenerateAudio {
		return normalizedStableDiffusionVideoRequest{}, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("video.generate audio is required for MiniMax-H3"))
	}
	result := normalizedStableDiffusionVideoRequest{
		prompt:           prompt,
		negativePrompt:   strings.TrimSpace(request.NegativePrompt),
		width:            request.Width,
		height:           request.Height,
		frameCount:       request.FrameCount,
		seed:             request.Seed,
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
