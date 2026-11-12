package capabilitydriver

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"slices"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	ImageUpscaleContract    = "image.upscale"
	VideoUpscaleContract    = "video.upscale"
	UpscaleImplementationID = "local.media.upscale.stable-diffusion-cpp"
	UpscaleDriverID         = "nimi.runtime.driver.stable-diffusion-cpp.upscale"
	UpscaleDriverDialect    = "stable-diffusion.cpp/media-upscale/v1"
	UpscaleTransformerSlot  = "upscale.transformer"
	UpscaleVAESlot          = "upscale.vae"
)

type UpscaleDriver struct{ Video bool }

func (d UpscaleDriver) contract() string {
	if d.Video {
		return VideoUpscaleContract
	}
	return ImageUpscaleContract
}

func (d UpscaleDriver) modelContract(recipe string) (string, bool) {
	model, ok := strings.CutSuffix(recipe, "."+d.contract())
	if !ok {
		return "", false
	}
	_, _, valid := upscaleRecipe(model)
	return model, valid
}

type UpscaleInvocationPlan struct {
	RecipeID     string
	Family       string
	Video        bool
	Scale        uint32
	Seed         int64
	Source       []byte
	MIMEType     string
	Bindings     []InvocationExactBinding
	Dependencies []InvocationExactDependencySource
}

func upscaleRecipe(recipe string) (family string, scale uint32, ok bool) {
	switch recipe {
	case "relayvsr-2x":
		return "relayvsr", 2, true
	case "relayvsr-4x":
		return "relayvsr", 4, true
	case "seedvr2-3b", "seedvr2-7b-sharp":
		return "seedvr2", 0, true
	default:
		return "", 0, false
	}
}

func (d UpscaleDriver) EffectiveRequestDefaults(recipe string, _ *structpb.Struct) map[string]string {
	scale := "2"
	if model, _ := d.modelContract(recipe); model == "relayvsr-4x" {
		scale = "4"
	}
	return map[string]string{"scale": scale, "seed": "42"}
}

func (d UpscaleDriver) ImplementationSupportedFeatures(recipe string) ([]string, runtimev1.LocalCapabilityReason) {
	if _, ok := d.modelContract(recipe); !ok {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (d UpscaleDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return d.ProjectRecipe(input.RecipeID, input.PortableConfig, input.SupportedFeatures)
}

func (d UpscaleDriver) ProjectRecipeForHost(recipe string, options *structpb.Struct, features []string, platform string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if platform != "windows/amd64" && platform != "darwin/arm64" {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return d.ProjectRecipe(recipe, options, features)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.media-upscale-contract
func (d UpscaleDriver) ProjectRecipe(recipe string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	model, valid := d.modelContract(recipe)
	family, _, ok := upscaleRecipe(model)
	if !valid || !ok || len(options.GetFields()) != 0 || len(features) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	vaeContract := family + "-vae"
	if family == "relayvsr" {
		vaeContract = model + "-vae"
	}
	var result []*runtimev1.LocalCapabilityRequirement
	for _, slot := range []struct{ id, kind, label, contract string }{
		{UpscaleTransformerSlot, "image", "Super-resolution model", model},
		{UpscaleVAESlot, "vae", "Super-resolution VAE", vaeContract},
	} {
		role := runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION
		if slot.id == UpscaleTransformerSlot {
			role = runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN
		}
		constraints, _ := structpb.NewStruct(map[string]any{"format": "safetensors", "tensor_contract": slot.contract, "asset_kind": slot.kind})
		result = append(result, &runtimev1.LocalCapabilityRequirement{
			RequirementId: slot.id, ResourceKind: slot.kind, DisplayLabel: slot.label, Role: role,
			Presence:                 runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
			Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
			CompatibilityConstraints: constraints,
		})
	}
	return result, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (d UpscaleDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if !input.Entry {
		return nil, nil
	}
	_, validRecipe := d.modelContract(input.RecipeID)
	if !validRecipe || (input.RequirementID != UpscaleTransformerSlot && input.RequirementID != UpscaleVAESlot) || filepath.Ext(input.RelativePath) != ".safetensors" {
		return nil, fmt.Errorf("unsupported super-resolution model probe")
	}
	return readSDDeclaredSafetensorsHeader(source, size)
}

func (d UpscaleDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	invalid := runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	if input.Requirement == nil || filepath.Ext(input.Entry.RelativePath) != ".safetensors" {
		return ModelAssetBindingProjection{}, invalid
	}
	contract := input.Requirement.GetCompatibilityConstraints().GetFields()["tensor_contract"].GetStringValue()
	if !upscaleTensorContractValid(contract, input.Entry.FormatProbe) {
		return ModelAssetBindingProjection{}, invalid
	}
	descriptor := ModelAssetDescriptor{Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, Engine: "media", Family: contract, FormatProbe: input.Entry.FormatProbe}
	if input.Requirement.RequirementId == UpscaleVAESlot {
		descriptor.Kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE
	}
	return validatedModelAssetBindingProjection(input, descriptor, 0, d.ValidateBinding)
}

func (d UpscaleDriver) ValidateBinding(req *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	bad := runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	if req == nil || binding == nil || req.RequirementId != binding.RequirementId || binding.ModelAssetId == "" || binding.ModelAssetId != asset.ModelAssetID ||
		binding.VerifiedContentId != asset.VerifiedContentID || binding.EntrySha256 != asset.EntrySHA256 || !canonicalInvocationSHA256(asset.VerifiedContentID, asset.EntrySHA256) {
		return bad
	}
	contract := req.GetCompatibilityConstraints().GetFields()["tensor_contract"].GetStringValue()
	expectedKind := runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE
	switch req.RequirementId {
	case UpscaleTransformerSlot:
	case UpscaleVAESlot:
		expectedKind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE
	default:
		return bad
	}
	if asset.Kind != expectedKind || asset.Family != contract || !upscaleTensorContractValid(contract, asset.FormatProbe) {
		return bad
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (d UpscaleDriver) ValidateCombination(reqs []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	invalid := runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	if len(reqs) != 2 || len(bindings) != 2 || len(assets) != 2 {
		return invalid
	}
	recipe := reqs[0].GetCompatibilityConstraints().GetFields()["tensor_contract"].GetStringValue()
	expected, reason := d.ProjectRecipe(recipe+"."+d.contract(), nil, nil)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return reason
	}
	for i, req := range reqs {
		if !proto.Equal(req, expected[i]) {
			return invalid
		}
		if reason := d.ValidateBinding(req, bindings[i], assets[i]); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			return reason
		}
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (d UpscaleDriver) PlanUpscale(recipe string, spec *runtimev1.MediaUpscaleScenarioSpec, source []byte, mime string, bindings []InvocationExactBinding, dependencies []InvocationExactDependencySource) (*UpscaleInvocationPlan, error) {
	model, valid := d.modelContract(recipe)
	family, requiredScale, ok := upscaleRecipe(model)
	if !valid || !ok || spec == nil || (spec.Scale != 2 && spec.Scale != 4) || (requiredScale != 0 && spec.Scale != requiredScale) || len(source) == 0 || len(bindings) != 2 {
		return nil, fmt.Errorf("super-resolution recipe, source or scale is invalid")
	}
	seed := int64(42)
	if spec.Seed != nil {
		seed = *spec.Seed
	}
	if seed < 0 || seed > 2147483647 || (d.Video && mime != "video/mp4") || (!d.Video && mime != "image/png" && mime != "image/jpeg") {
		return nil, fmt.Errorf("super-resolution media type or seed is invalid")
	}
	for index, slot := range []string{UpscaleTransformerSlot, UpscaleVAESlot} {
		binding := bindings[index]
		if binding.RequirementID != slot || !filepath.IsAbs(binding.AbsolutePath) || filepath.Clean(binding.AbsolutePath) != binding.AbsolutePath || !canonicalInvocationSHA256(binding.VerifiedContentID, binding.EntrySHA256) {
			return nil, fmt.Errorf("super-resolution requires exact ordered model bindings")
		}
	}
	return &UpscaleInvocationPlan{RecipeID: recipe, Family: family, Video: d.Video, Scale: spec.Scale, Seed: seed,
		Source: append([]byte(nil), source...), MIMEType: mime, Bindings: cloneInvocationExactBindings(bindings), Dependencies: cloneInvocationExactDependencySources(dependencies)}, nil
}

func upscaleTensorContractValid(contract string, probe []byte) bool {
	tensors, ok := safetensorsTensorFacts(probe)
	if !ok {
		return false
	}
	var shapes map[string][]int64
	switch contract {
	case "relayvsr-2x", "relayvsr-4x":
		width := int64(192)
		if contract == "relayvsr-4x" {
			width = 768
		}
		shapes = map[string][]int64{"patch_embedding.weight": {3072, 48, 1, 2, 2}, "lq_proj_in.conv1.weight": {768, width, 1, 1}, "positive_conditioning": {512, 4096}}
	case "relayvsr-2x-vae", "relayvsr-4x-vae":
		scale := 2
		if contract == "relayvsr-4x-vae" {
			scale = 4
		}
		if !relayVSRVAEMetadataMatches(probe, scale) {
			return false
		}
		shapes = map[string][]int64{"condition_encoder.projection.weight": {512, 48, 1, 1}, "residual_projection.weight": {768, 1024}, "video_type_embedding": {1, 1, 512}}
	case "seedvr2-3b", "seedvr2-7b-sharp":
		width := int64(2560)
		if contract == "seedvr2-7b-sharp" {
			width = 3072
		}
		shapes = map[string][]int64{"vid_in.proj.weight": {width, 132}, "vid_out.proj.weight": {64, width}, "txt_in.weight": {width, 5120}}
	case "seedvr2-vae":
		shapes = map[string][]int64{"decoder.conv_in.weight": {512, 16, 3, 3, 3}, "decoder.conv_out.weight": {3, 128, 3, 3, 3}}
	default:
		return false
	}
	for name, shape := range shapes {
		fact := tensors[name]
		if !slices.Equal(fact.Shape, shape) || (fact.DType != "F16" && fact.DType != "F32" && fact.DType != "BF16") {
			return false
		}
	}
	return true
}

// Both RelayVSR VAE variants have the same tensor shapes. The model-authored
// configuration distinguishes their training scale without a content pin.
// The enclosing tensor parser has already bounded this header.
func relayVSRVAEMetadataMatches(probe []byte, scale int) bool {
	length := binary.LittleEndian.Uint64(probe[:8])
	var header struct {
		Metadata struct {
			Config string `json:"config"`
		} `json:"__metadata__"`
	}
	if json.Unmarshal(probe[8:8+length], &header) != nil {
		return false
	}
	var config struct {
		UpscaleFactor int `json:"upscale_factor"`
	}
	return json.Unmarshal([]byte(header.Metadata.Config), &config) == nil && config.UpscaleFactor == scale
}
