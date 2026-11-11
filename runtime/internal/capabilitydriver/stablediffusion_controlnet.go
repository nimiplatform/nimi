package capabilitydriver

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"image"
	"io"
	"math"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	SDXLControlNetRecipeID = "sdxl-controlnet-union"
	SDXLControlNetDialect  = "stable-diffusion.cpp/sdxl-controlnet-union/v1"
	SDXLControlNetSlot     = "companion.controlnet"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.sdxl-controlnet-union
type SDXLControlNetDriver struct{}

func (driver SDXLControlNetDriver) ProjectRecipeForHost(recipe string, options *structpb.Struct, features []string, platform string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if platform != "windows/amd64" {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return driver.ProjectRecipe(recipe, options, features)
}

func (SDXLControlNetDriver) ImplementationSupportedFeatures(recipe string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipe != SDXLControlNetRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return []string{"input.image"}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver SDXLControlNetDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.ProjectRecipe(input.RecipeID, input.PortableConfig, input.SupportedFeatures)
}

func sdxlControlNetOptions(options *structpb.Struct) (stableDiffusionExecutionOptions, runtimev1.LocalCapabilityReason) {
	defaults := stableDiffusionExecutionOptions{steps: 20, cfgScale: 7, width: 1024, height: 1024, seed: 42, sampler: "euler", scheduler: "discrete", diffusionFlashAttention: true, offloadParamsToCPU: true}
	for key := range options.GetFields() {
		if key != "executionOptions" {
			return defaults, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
		}
	}
	return stableDiffusionExecutionOptionsFromValue(options.GetFields()["executionOptions"], defaults)
}

func (SDXLControlNetDriver) EffectiveRequestDefaults(_ string, options *structpb.Struct) map[string]string {
	parsed, reason := sdxlControlNetOptions(options)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil
	}
	return map[string]string{"n": "1", "size": fmt.Sprintf("%dx%d", parsed.width, parsed.height), "seed": strconv.FormatInt(parsed.seed, 10)}
}

func (SDXLControlNetDriver) ProjectRecipe(recipe string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if recipe != SDXLControlNetRecipeID || !slices.Equal(features, []string{"input.image"}) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if _, reason := sdxlControlNetOptions(options); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, reason
	}
	return []*runtimev1.LocalCapabilityRequirement{
		stableDiffusionRequirement(StableDiffusionMainRequirementID, runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, "image", 0, "SDXL Base checkpoint", map[string]any{"format": "safetensors", "tensor_contract": "sdxl-base-checkpoint", "asset_kind": "image"}),
		stableDiffusionRequirement(SDXLControlNetSlot, runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION, "auxiliary", 0, "ControlNet Union ProMax", map[string]any{"format": "safetensors", "tensor_contract": "sdxl-controlnet-union-promax", "asset_kind": "auxiliary"}),
	}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (SDXLControlNetDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if !input.Entry {
		return nil, nil
	}
	if input.RecipeID != SDXLControlNetRecipeID || filepath.Ext(input.RelativePath) != ".safetensors" || input.RequirementID != StableDiffusionMainRequirementID && input.RequirementID != SDXLControlNetSlot {
		return nil, fmt.Errorf("SDXL ControlNet model probe is unsupported")
	}
	return readSDDeclaredSafetensorsHeader(source, size)
}

func sdxlControlNetTensorContract(contract string, probe []byte) bool {
	tensors, ok := safetensorsTensorFacts(probe)
	if !ok {
		return false
	}
	var expected map[string][]int64
	switch contract {
	case "sdxl-base-checkpoint":
		expected = map[string][]int64{
			"model.diffusion_model.input_blocks.0.0.weight":                                    {320, 4, 3, 3},
			"conditioner.embedders.0.transformer.text_model.embeddings.token_embedding.weight": {49408, 768},
			"conditioner.embedders.1.model.token_embedding.weight":                             {49408, 1280},
			"first_stage_model.decoder.conv_in.weight":                                         {512, 4, 3, 3},
		}
	case "sdxl-controlnet-union-promax":
		expected = map[string][]int64{"task_embedding": {8, 320}, "controlnet_cond_embedding.conv_in.weight": {16, 3, 3, 3}, "controlnet_down_blocks.0.weight": {320, 320, 1, 1}}
	default:
		return false
	}
	for name, shape := range expected {
		if !slices.Equal(tensors[name].Shape, shape) {
			return false
		}
	}
	return true
}

func (driver SDXLControlNetDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	if input.RecipeID != SDXLControlNetRecipeID || input.Requirement == nil || input.Requirement.GetRequirementId() != StableDiffusionMainRequirementID && input.Requirement.GetRequirementId() != SDXLControlNetSlot {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	contract, ok := stableDiffusionRequirementConstraintString(input.Requirement, "tensor_contract")
	if !ok || filepath.Ext(input.Entry.RelativePath) != ".safetensors" || !sdxlControlNetTensorContract(contract, input.Entry.FormatProbe) {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	kind := runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE
	if input.Requirement.GetRequirementId() == SDXLControlNetSlot {
		kind = runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{Kind: kind, Engine: "media", Family: contract, FormatProbe: input.Entry.FormatProbe}, 0, driver.ValidateBinding)
}

func (SDXLControlNetDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	bad := runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	if requirement == nil || binding == nil || requirement.RequirementId != binding.RequirementId || binding.ModelAssetId != asset.ModelAssetID || binding.VerifiedContentId != asset.VerifiedContentID || binding.EntrySha256 != asset.EntrySHA256 || !canonicalInvocationSHA256(asset.VerifiedContentID, asset.EntrySHA256) {
		return bad
	}
	if requirement.GetRequirementId() != StableDiffusionMainRequirementID && requirement.GetRequirementId() != SDXLControlNetSlot {
		return bad
	}
	contract, ok := stableDiffusionRequirementConstraintString(requirement, "tensor_contract")
	if !ok || contract != asset.Family || !sdxlControlNetTensorContract(contract, asset.FormatProbe) {
		return bad
	}
	if requirement.GetRequirementId() == StableDiffusionMainRequirementID && (contract != "sdxl-base-checkpoint" || asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE) ||
		requirement.GetRequirementId() == SDXLControlNetSlot && (contract != "sdxl-controlnet-union-promax" || asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY) {
		return bad
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver SDXLControlNetDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 2 || len(bindings) != 2 || len(assets) != 2 || requirements[0].GetRequirementId() != StableDiffusionMainRequirementID || requirements[1].GetRequirementId() != SDXLControlNetSlot {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	for index, requirement := range requirements {
		if reason := driver.ValidateBinding(requirement, bindings[index], assets[index]); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			return reason
		}
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func validSDXLControlType(value string) bool {
	return slices.Contains([]string{"openpose", "depth", "scribble", "canny", "normal", "segment", "tile", "repaint"}, value)
}

func (driver SDXLControlNetDriver) PlanImageInvocation(input ImageInvocationInput) (*ImageInvocationPlan, error) {
	options, reason := sdxlControlNetOptions(input.PortableConfig)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || input.RecipeID != SDXLControlNetRecipeID || !slices.Equal(input.SupportedFeatures, []string{"input.image"}) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("SDXL ControlNet configuration is invalid"))
	}
	spec := input.Request
	if spec == nil || strings.TrimSpace(spec.Prompt) == "" || spec.ControlImage == nil || len(input.Inputs) != 1 || input.Inputs[0].Role != ImageResolvedInputRoleControl || input.Inputs[0].SourceIdentity == "" {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("SDXL ControlNet requires a prompt and one captured control image"))
	}
	if len(spec.ReferenceImages) != 0 || spec.ReferenceImageArtifactId != "" || spec.Mask != "" || spec.MaskArtifactId != "" || spec.Strength != nil || spec.Complexity != "" || spec.OutputFormat != "" || spec.Markup != "" || spec.MarkupArtifactId != "" || spec.FrameCount != nil || spec.FrameDurationMs != nil || spec.AspectRatio != "" || spec.Quality != "" || spec.Style != "" || spec.N != nil && spec.GetN() != 1 {
		return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("SDXL ControlNet does not admit these image controls"))
	}
	if spec.ResponseFormat != "" && spec.ResponseFormat != "b64_json" && spec.ResponseFormat != "url" {
		return nil, invocationError(InvocationFailureInvalidOption, fmt.Errorf("SDXL ControlNet response format is unsupported"))
	}
	width, height := options.width, options.height
	if spec.Size != "" {
		var ok bool
		width, height, ok = parseStableDiffusionSize(spec.Size)
		if !ok {
			return nil, invocationError(InvocationFailureInvalidOption, fmt.Errorf("invalid SDXL canvas size"))
		}
	}
	controlImage := cloneImageResolvedInput(input.Inputs[0])
	config, format, err := image.DecodeConfig(bytes.NewReader(controlImage.ImageBytes))
	if err != nil || format != "png" && format != "jpeg" || config.Width != width || config.Height != height {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("control map must be PNG or JPEG with the requested canvas dimensions"))
	}
	controlType := strings.TrimPrefix(strings.ToLower(spec.ControlImage.Type.String()), "image_control_type_")
	strength := float64(1)
	if spec.ControlImage.Strength != nil {
		strength = float64(spec.ControlImage.GetStrength())
	}
	if !validSDXLControlType(controlType) || math.IsNaN(strength) || math.IsInf(strength, 0) || strength < 0 || strength > 2 {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("control map type or strength is invalid"))
	}
	seed := options.seed
	if spec.Seed != nil {
		seed = spec.GetSeed()
	}
	if seed < -1 || seed > math.MaxInt32 {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("image seed is invalid"))
	}
	if len(input.ExactBindings) != 2 {
		return nil, invocationError(InvocationFailureInvalidBinding, fmt.Errorf("SDXL checkpoint and ControlNet bindings are required"))
	}
	bindings := make([]InvocationExactBinding, 2)
	for _, binding := range input.ExactBindings {
		index := 0
		if binding.RequirementID == SDXLControlNetSlot {
			index = 1
		} else if binding.RequirementID != StableDiffusionMainRequirementID {
			return nil, invocationError(InvocationFailureInvalidBinding, fmt.Errorf("unknown SDXL model slot"))
		}
		if bindings[index].ModelAssetID != "" || binding.ModelAssetID == "" || !filepath.IsAbs(binding.AbsolutePath) || filepath.Clean(binding.AbsolutePath) != binding.AbsolutePath || !canonicalInvocationSHA256(binding.VerifiedContentID, binding.EntrySHA256) {
			return nil, invocationError(InvocationFailureInvalidBinding, fmt.Errorf("invalid SDXL model binding"))
		}
		bindings[index] = binding
	}
	controlNet := stableDiffusionImageModelFile(bindings[1])
	load := StableDiffusionCPPLoadPlan{recipeID: SDXLControlNetRecipeID, checkpoint: true, main: stableDiffusionImageModelFile(bindings[0]), controlNet: &controlNet, threads: options.threads, cfgScale: options.cfgScale, sampler: options.sampler, scheduler: options.scheduler, diffusionFlashAttention: options.diffusionFlashAttention, offloadParamsToCPU: options.offloadParamsToCPU}
	hasher := sha256.New()
	for _, value := range []string{SDXLControlNetDialect, strconv.Itoa(options.threads), strconv.FormatFloat(options.cfgScale, 'g', -1, 64), options.sampler, options.scheduler, strconv.FormatBool(options.diffusionFlashAttention), strconv.FormatBool(options.offloadParamsToCPU)} {
		_, _ = hasher.Write([]byte(value + "\x00"))
	}
	for _, binding := range bindings {
		for _, value := range invocationExactBindingIdentity(binding) {
			_, _ = hasher.Write([]byte(value + "\x00"))
		}
	}
	for _, dependency := range input.ExactDependencySources {
		for _, value := range invocationExactDependencySourceIdentity(dependency) {
			_, _ = hasher.Write([]byte(value + "\x00"))
		}
	}
	return &ImageInvocationPlan{
		processKey: hex.EncodeToString(hasher.Sum(nil)), modelFiles: cloneInvocationExactBindings(bindings), dependencySources: cloneInvocationExactDependencySources(input.ExactDependencySources), loadPlan: load,
		requestPlan:       StableDiffusionCPPControlRequestPlan{stableDiffusionCPPRequestFields: stableDiffusionCPPRequestFields{prompt: strings.TrimSpace(spec.Prompt), negativePrompt: strings.TrimSpace(spec.NegativePrompt), width: width, height: height, steps: options.steps, cfgScale: options.cfgScale, seed: seed, imageCount: 1, sampler: options.sampler, scheduler: options.scheduler}, controlImage: controlImage, controlType: controlType, controlStrength: strength},
		resultConstraints: StableDiffusionCPPResultConstraints{artifactCount: 1, mediaType: "image/png", format: "png", width: width, height: height}, translator: stableDiffusionImageTranslator{},
	}, nil
}
