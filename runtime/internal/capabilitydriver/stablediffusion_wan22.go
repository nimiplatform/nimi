package capabilitydriver

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	Wan22VideoImplementationID = "local.video.generate.wan22.stable-diffusion-cpp"
	Wan22VideoDialect          = "stable-diffusion.cpp/wan22-ti2v-video-generate/v1"
	Wan22VideoRecipeID         = "wan22-ti2v-5b"
	wan22MainSlot              = "diffusion.wan22-ti2v"
	wan22EncoderSlot           = "encoder.umt5-xxl"
)

type Wan22VideoDriver struct{}

var wan22Slots = []stableDiffusionVideoSlotSpec{
	{id: wan22MainSlot, role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, resourceKind: "video", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO, artifactRole: "diffusion_transformer", format: "gguf", displayLabel: "Wan2.2 TI2V 5B transformer"},
	{id: wan22EncoderSlot, role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION, resourceKind: "auxiliary", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY, artifactRole: "text_encoder", format: "gguf", displayLabel: "UMT5 XXL text encoder"},
	{id: StableDiffusionVideoVAERequirementID, role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION, resourceKind: "vae", assetKind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE, format: "safetensors", displayLabel: "Wan2.2 48-channel video VAE"},
}

func wan22Slot(id string) (stableDiffusionVideoSlotSpec, bool) {
	for _, slot := range wan22Slots {
		if slot.id == id {
			return slot, true
		}
	}
	return stableDiffusionVideoSlotSpec{}, false
}

func (Wan22VideoDriver) ImplementationSupportedFeatures(recipe string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipe != Wan22VideoRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return []string{"input.image"}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (Wan22VideoDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return map[string]string{"options.resolution": "832x480", "options.frames": "33", "options.seed": "0"}
}

func (d Wan22VideoDriver) ProjectRecipe(recipe string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return d.Interpret(InterpretInput{RecipeID: recipe, PortableConfig: options, SupportedFeatures: features})
}

func (d Wan22VideoDriver) ProjectRecipeForHost(recipe string, options *structpb.Struct, features []string, platform string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if platform != "windows/amd64" {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return d.ProjectRecipe(recipe, options, features)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.wan22-local-video
func (Wan22VideoDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if input.RecipeID != Wan22VideoRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if _, _, reason := parseWan22Options(input.PortableConfig); reason != 0 {
		return nil, reason
	}
	for _, feature := range input.SupportedFeatures {
		if feature != "input.image" {
			return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
		}
	}
	result := make([]*runtimev1.LocalCapabilityRequirement, 0, 3)
	for _, slot := range wan22Slots {
		facts := map[string]any{"asset_kind": slot.resourceKind, "format": slot.format}
		if slot.artifactRole != "" {
			facts["artifact_role"] = slot.artifactRole
		}
		constraints, _ := structpb.NewStruct(facts)
		result = append(result, &runtimev1.LocalCapabilityRequirement{RequirementId: slot.id, Role: slot.role, Presence: runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED, ResourceKind: slot.resourceKind, Policy: runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE, CompatibilityConstraints: constraints, DisplayLabel: slot.displayLabel})
	}
	return result, 0
}

func parseWan22Options(value *structpb.Struct) (stableDiffusionVideoRecipe, int, runtimev1.LocalCapabilityReason) {
	recipe := stableDiffusionVideoRecipe{cfgScale: 6, flowShift: 3, sampleMethod: "euler", diffusionFlashAttention: true, offloadToCPU: true, rng: "cpu"}
	steps := 50
	invalid := runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	if value == nil {
		return recipe, steps, 0
	}
	for key := range value.Fields {
		if key != "executionOptions" {
			return recipe, 0, invalid
		}
	}
	options := value.Fields["executionOptions"]
	if options == nil {
		return recipe, steps, 0
	}
	if options.GetStructValue() == nil {
		return recipe, 0, invalid
	}
	copy := proto.Clone(options).(*structpb.Value)
	if field := copy.GetStructValue().Fields["steps"]; field != nil {
		n, ok := field.Kind.(*structpb.Value_NumberValue)
		if !ok || n.NumberValue < 1 || n.NumberValue > 100 || float64(int(n.NumberValue)) != n.NumberValue {
			return recipe, 0, invalid
		}
		steps = int(n.NumberValue)
		delete(copy.GetStructValue().Fields, "steps")
	}
	recipe, reason := stableDiffusionVideoRecipeFromValue(copy, recipe)
	return recipe, steps, reason
}

func (d Wan22VideoDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	slot, ok := wan22Slot(input.Requirement.GetRequirementId())
	if !ok || filepath.Ext(strings.ToLower(input.Entry.RelativePath)) != "."+slot.format {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	descriptor := ModelAssetDescriptor{Kind: slot.assetKind, Engine: "media", FormatProbe: input.Entry.FormatProbe}
	if slot.artifactRole != "" {
		descriptor.ArtifactRoles = []string{slot.artifactRole}
	}
	return validatedModelAssetBindingProjection(input, descriptor, 0, d.ValidateBinding)
}

func (Wan22VideoDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	slot, ok := wan22Slot(requirement.GetRequirementId())
	if !ok || !validStableDiffusionVideoRequirement(requirement, slot) || binding == nil || binding.RequirementId != slot.id {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	if binding.ModelAssetId == "" || asset.ModelAssetID == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if !canonicalInvocationSHA256(binding.VerifiedContentId, binding.EntrySha256) || !canonicalInvocationSHA256(asset.VerifiedContentID, asset.EntrySHA256) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED
	}
	if binding.ModelAssetId != asset.ModelAssetID || binding.VerifiedContentId != asset.VerifiedContentID || binding.EntrySha256 != asset.EntrySHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	if asset.Kind != slot.assetKind || slot.artifactRole != "" && !contains(asset.ArtifactRoles, slot.artifactRole) || !wan22ProbeValid(slot.id, asset.FormatProbe) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return 0
}

func (d Wan22VideoDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(bindings) < 3 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
	}
	if len(requirements) != 3 || len(bindings) != 3 || len(assets) != 3 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	byID := map[string]*runtimev1.LocalCapabilityRequirement{}
	for i, slot := range wan22Slots {
		if !validStableDiffusionVideoRequirement(requirements[i], slot) {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
		byID[slot.id] = requirements[i]
	}
	seen := map[string]bool{}
	for i, binding := range bindings {
		if binding == nil || seen[binding.GetRequirementId()] || byID[binding.GetRequirementId()] == nil {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		seen[binding.RequirementId] = true
		if reason := d.ValidateBinding(byID[binding.RequirementId], binding, assets[i]); reason != 0 {
			return reason
		}
	}
	return 0
}

type wan22Probe struct {
	Schema       string              `json:"schema"`
	Slot         string              `json:"slot"`
	Architecture string              `json:"architecture"`
	Shapes       map[string][]uint64 `json:"shapes"`
}

func (Wan22VideoDriver) ModelAssetFormatProbeBytes(input ModelAssetFormatProbeInput) int64 {
	if input.Entry && input.RecipeID == Wan22VideoRecipeID && input.RequirementID == wan22EncoderSlot {
		return 8 << 20
	}
	return MaxAssetFormatProbeBytes
}

func (d Wan22VideoDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if !input.Entry {
		return nil, nil
	}
	slot, ok := wan22Slot(input.RequirementID)
	if !ok || input.RecipeID != Wan22VideoRecipeID || filepath.Ext(strings.ToLower(input.RelativePath)) != "."+slot.format {
		return nil, fmt.Errorf("Wan2.2 probe contract mismatch")
	}
	if slot.format == "safetensors" {
		return readSDDeclaredSafetensorsHeader(source, size)
	}
	reader, err := newGGUFProbeReader(source, size, d.ModelAssetFormatProbeBytes(input))
	if err != nil {
		return nil, err
	}
	summary, err := ggufmeta.Inspect(reader)
	if err != nil {
		return nil, err
	}
	if err = reader.actualFailure(); err != nil {
		return nil, err
	}
	architecture, _ := summary.StringValue("general.architecture")
	facts := wan22Probe{Schema: "wan22-gguf/v1", Slot: slot.id, Architecture: architecture, Shapes: map[string][]uint64{}}
	for _, name := range []string{"patch_embedding.weight", "head.head.weight", "text_embedding.0.weight", "blocks.29.self_attn.q.weight", "token_embd.weight", "enc.blk.23.attn_q.weight"} {
		if shape, ok := summary.TensorShapes[name]; ok {
			facts.Shapes[name] = shape
		}
	}
	data, err := json.Marshal(facts)
	if err != nil {
		return nil, err
	}
	if !wan22ProbeValid(slot.id, data) {
		return nil, fmt.Errorf("Wan2.2 model tensor contract mismatch")
	}
	return data, nil
}

func wan22ProbeValid(slot string, data []byte) bool {
	if len(data) > MaxAssetFormatProbeBytes {
		return false
	}
	if slot == StableDiffusionVideoVAERequirementID {
		if len(data) < 10 {
			return false
		}
		size := binary.LittleEndian.Uint64(data[:8])
		if size < 2 || size > uint64(len(data)-8) {
			return false
		}
		var tensors map[string]struct {
			Shape []uint64 `json:"shape"`
		}
		if json.Unmarshal(data[8:8+size], &tensors) != nil {
			return false
		}
		return slices.Equal(tensors["decoder.conv1.weight"].Shape, []uint64{1024, 48, 3, 3, 3}) && slices.Equal(tensors["encoder.conv1.weight"].Shape, []uint64{160, 12, 3, 3, 3}) && slices.Equal(tensors["conv2.weight"].Shape, []uint64{48, 48, 1, 1, 1})
	}
	var facts wan22Probe
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&facts) != nil || decoder.Decode(new(any)) != io.EOF || facts.Schema != "wan22-gguf/v1" || facts.Slot != slot {
		return false
	}
	if slot == wan22MainSlot {
		return facts.Architecture == "wan" && slices.Equal(facts.Shapes["patch_embedding.weight"], []uint64{2, 2, 1, 48, 3072}) && slices.Equal(facts.Shapes["head.head.weight"], []uint64{3072, 192}) && slices.Equal(facts.Shapes["text_embedding.0.weight"], []uint64{4096, 3072}) && slices.Equal(facts.Shapes["blocks.29.self_attn.q.weight"], []uint64{3072, 3072})
	}
	return slot == wan22EncoderSlot && facts.Architecture == "t5encoder" && slices.Equal(facts.Shapes["token_embd.weight"], []uint64{4096, 256384}) && slices.Equal(facts.Shapes["enc.blk.23.attn_q.weight"], []uint64{4096, 4096})
}

func (Wan22VideoDriver) PlanVideoInvocation(input VideoInvocationInput) (*VideoInvocationPlan, error) {
	bad := func(kind InvocationFailureKind, message string) (*VideoInvocationPlan, error) {
		return nil, invocationError(kind, fmt.Errorf("%s", message))
	}
	if input.LoadoutID == "" || input.LoadoutID != strings.TrimSpace(input.LoadoutID) {
		return bad(InvocationFailureInvalidConfig, "Wan2.2 Loadout identity is required")
	}
	recipe, steps, reason := parseWan22Options(input.PortableConfig)
	if reason != 0 {
		return bad(InvocationFailureInvalidConfig, "invalid Wan2.2 options")
	}
	bindings := map[string]InvocationExactBinding{}
	for _, binding := range input.ExactBindings {
		_, known := wan22Slot(binding.RequirementID)
		_, duplicate := bindings[binding.RequirementID]
		if !known || duplicate || binding.ModelAssetID == "" || !canonicalInvocationSHA256(binding.VerifiedContentID, binding.EntrySHA256) || !filepath.IsAbs(binding.AbsolutePath) || filepath.Clean(binding.AbsolutePath) != binding.AbsolutePath {
			return bad(InvocationFailureInvalidBinding, "Wan2.2 requires three exact independent bindings")
		}
		bindings[binding.RequirementID] = binding
	}
	if len(bindings) != 3 {
		return bad(InvocationFailureInvalidBinding, "Wan2.2 requires transformer, UMT5 and VAE")
	}
	r := input.Request
	if strings.TrimSpace(r.Prompt) == "" || r.Seed < 0 || r.Seed > 2147483647 || r.GenerateAudio != nil && *r.GenerateAudio {
		return bad(InvocationFailureInvalidRequest, "Wan2.2 requires a prompt, nonnegative 31-bit seed and silent output")
	}
	width, height := r.Width, r.Height
	if width == 0 && height == 0 {
		width, height = 832, 480
		if r.Ratio != "" {
			var ok bool
			width, height, ok = stableDiffusionVideoSizeForRatio(r.Ratio)
			if !ok {
				return bad(InvocationFailureInvalidRequest, "unsupported Wan2.2 aspect ratio")
			}
		}
	}
	if width < 32 || height < 32 || width%32 != 0 || height%32 != 0 || int64(width)*int64(height) > 1280*768 || r.Ratio != "" && !stableDiffusionVideoResolutionMatchesRatio(width, height, r.Ratio) {
		return bad(InvocationFailureInvalidRequest, "Wan2.2 dimensions must be multiples of 32 within the admitted pixel bound")
	}
	if r.FPS != 0 && r.FPS != 24 || r.DurationSec < 0 || r.DurationSec > 5 || r.DurationSec > 0 && r.FrameCount > 0 {
		return bad(InvocationFailureInvalidRequest, "invalid Wan2.2 frame rate or duration")
	}
	frames := r.FrameCount
	if r.DurationSec > 0 {
		frames = ((r.DurationSec*24-1+3)/4)*4 + 1
	} else if frames == 0 {
		frames = 33
	}
	if frames < 5 || frames > 121 || (frames-1)%4 != 0 {
		return bad(InvocationFailureInvalidRequest, "Wan2.2 frames must be 4n+1 between 5 and 121")
	}
	mode := VideoConditioningModeWan22Text
	var reference *VideoResolvedInput
	if len(r.Inputs) > 0 {
		if len(r.Inputs) != 1 || r.Inputs[0].Role != VideoInputRoleReferenceImage || r.Inputs[0].SourceIdentity == "" || len(r.Inputs[0].ImageBytes) == 0 {
			return bad(InvocationFailureUnsupported, "Wan2.2 admits at most one owned first image")
		}
		copy := r.Inputs[0]
		copy.ImageBytes = append([]byte(nil), copy.ImageBytes...)
		reference = &copy
		mode = VideoConditioningModeWan22Image
	}
	identity := Identity{ImplementationID: Wan22VideoImplementationID, DriverID: StableDiffusionVideoDriverID, DriverDialect: Wan22VideoDialect}
	modelFiles := make([]InvocationExactBinding, 0, 3)
	for _, slot := range wan22Slots {
		modelFiles = append(modelFiles, bindings[slot.id])
	}
	hasher := sha256.New()
	values := []string{identity.ImplementationID, identity.DriverID, identity.DriverDialect, string(mode), strconv.Itoa(steps), strconv.FormatFloat(recipe.cfgScale, 'g', -1, 64), strconv.FormatFloat(recipe.flowShift, 'g', -1, 64), recipe.sampleMethod, recipe.scheduler, strconv.FormatBool(recipe.diffusionFlashAttention), strconv.FormatBool(recipe.offloadToCPU), recipe.rng}
	for _, binding := range modelFiles {
		values = append(values, invocationExactBindingIdentity(binding)...)
	}
	for _, source := range input.ExactDependencySources {
		values = append(values, invocationExactDependencySourceIdentity(source)...)
	}
	for _, value := range values {
		_, _ = hasher.Write([]byte(value))
		_, _ = hasher.Write([]byte{0})
	}
	return &VideoInvocationPlan{processKey: hex.EncodeToString(hasher.Sum(nil)), loadoutID: input.LoadoutID, recipeID: Wan22VideoRecipeID, driverIdentity: identity, portableConfig: cloneStruct(input.PortableConfig), exactBindings: cloneInvocationExactBindings(modelFiles), modelFiles: cloneInvocationExactBindings(modelFiles), dependencySources: cloneInvocationExactDependencySources(input.ExactDependencySources), diffusionModelPath: bindings[wan22MainSlot].AbsolutePath, encoderPath: bindings[wan22EncoderSlot].AbsolutePath, videoVAEPath: bindings[StableDiffusionVideoVAERequirementID].AbsolutePath, prompt: strings.TrimSpace(r.Prompt), negativePrompt: r.NegativePrompt, width: width, height: height, frameCount: frames, fps: 24, seed: r.Seed, audioRequired: false, returnLastFrame: r.ReturnLastFrame, conditioningMode: mode, referenceImage: reference, cfgScale: recipe.cfgScale, flowShift: recipe.flowShift, sampleMethod: recipe.sampleMethod, sampleSteps: steps, scheduler: recipe.scheduler, diffusionFlashAttention: recipe.diffusionFlashAttention, offloadToCPU: recipe.offloadToCPU, rng: recipe.rng}, nil
}
