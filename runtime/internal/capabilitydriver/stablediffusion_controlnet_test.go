package capabilitydriver

import (
	"bytes"
	"image"
	"image/png"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestUnifiedSDXLUsesRequiredCheckpointAndConditionalControlNet(t *testing.T) {
	driver := StableDiffusionImageDriver{}
	features, reason := driver.ImplementationSupportedFeatures(StableDiffusionSDXLRecipeID)
	if reason != success || len(features) != 1 || features[0] != "input.image" {
		t.Fatalf("SDXL implementation features = %v reason=%v", features, reason)
	}
	requirements, reason := driver.ProjectRecipe(StableDiffusionSDXLRecipeID, nil, features)
	if reason != success || len(requirements) != 2 ||
		requirements[0].GetRequirementId() != StableDiffusionMainRequirementID ||
		requirements[0].GetPresence() != runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED ||
		requirements[1].GetRequirementId() != StableDiffusionControlNetRequirementID ||
		requirements[1].GetPresence() != runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_OPTIONAL_CONDITIONAL {
		t.Fatalf("unified SDXL requirements = %+v reason=%v", requirements, reason)
	}
	if _, retiredReason := driver.ProjectRecipe("sdxl-controlnet-union", nil, features); retiredReason == success {
		t.Fatal("retired sdxl-controlnet-union recipe was unexpectedly admitted")
	}

	main := map[string][]int64{
		"model.diffusion_model.input_blocks.0.0.weight":                                    {320, 4, 3, 3},
		"conditioner.embedders.0.transformer.text_model.embeddings.token_embedding.weight": {49408, 768},
		"conditioner.embedders.1.model.token_embedding.weight":                             {49408, 1280},
		"first_stage_model.decoder.conv_in.weight":                                         {512, 4, 3, 3},
	}
	mainProbe := fluxSafetensorsForTest(t, main)
	if !sdxlControlNetTensorContract("sdxl-base-checkpoint", mainProbe) {
		t.Fatal("complete SDXL checkpoint rejected")
	}
	mainSHA := strings.Repeat("a", 64)
	mainAsset := ModelAssetDescriptor{
		ModelAssetID: "sdxl-main", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, Engine: "media",
		Family: StableDiffusionSDXLRecipeID, ArtifactRoles: []string{"diffusion_model"},
		VerifiedContentID: "sha256:" + mainSHA, EntrySHA256: mainSHA, FormatProbe: mainProbe,
	}
	mainBinding := &runtimev1.ModelAssetExactBinding{
		RequirementId: StableDiffusionMainRequirementID, ModelAssetId: mainAsset.ModelAssetID,
		VerifiedContentId: mainAsset.VerifiedContentID, EntrySha256: mainAsset.EntrySHA256,
	}
	// Single-file SDXL combination (no ControlNet bound) must validate cleanly.
	if combReason := driver.ValidateCombination(requirements, []*runtimev1.ModelAssetExactBinding{mainBinding}, []ModelAssetDescriptor{mainAsset}); combReason != success {
		t.Fatalf("single-file SDXL ValidateCombination = %v", combReason)
	}

	delete(main, "conditioner.embedders.1.model.token_embedding.weight")
	if sdxlControlNetTensorContract("sdxl-base-checkpoint", fluxSafetensorsForTest(t, main)) {
		t.Fatal("checkpoint missing second text encoder admitted")
	}

	control := map[string][]int64{"task_embedding": {8, 320}, "controlnet_cond_embedding.conv_in.weight": {16, 3, 3, 3}, "controlnet_down_blocks.0.weight": {320, 320, 1, 1}}
	controlProbe := fluxSafetensorsForTest(t, control)
	if !sdxlControlNetTensorContract("sdxl-controlnet-union-promax", controlProbe) {
		t.Fatal("ProMax ControlNet rejected")
	}
	cnSHA := strings.Repeat("b", 64)
	cnAsset := ModelAssetDescriptor{
		ModelAssetID: "sdxl-cn", Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY, Engine: "media",
		Family:            "sdxl-controlnet-union-promax",
		VerifiedContentID: "sha256:" + cnSHA, EntrySHA256: cnSHA, FormatProbe: controlProbe,
	}
	cnBinding := &runtimev1.ModelAssetExactBinding{
		RequirementId: StableDiffusionControlNetRequirementID, ModelAssetId: cnAsset.ModelAssetID,
		VerifiedContentId: cnAsset.VerifiedContentID, EntrySha256: cnAsset.EntrySHA256,
	}
	if combReason := driver.ValidateCombination(requirements, []*runtimev1.ModelAssetExactBinding{mainBinding, cnBinding}, []ModelAssetDescriptor{mainAsset, cnAsset}); combReason != success {
		t.Fatalf("SDXL + ControlNet ValidateCombination = %v", combReason)
	}

	control["task_embedding"] = []int64{6, 320}
	if sdxlControlNetTensorContract("sdxl-controlnet-union-promax", fluxSafetensorsForTest(t, control)) {
		t.Fatal("six-type Union admitted as ProMax")
	}
}

func TestUnifiedSDXLPlansSingleFileTextToImageAndConditionalControlMap(t *testing.T) {
	var source bytes.Buffer
	if err := png.Encode(&source, image.NewRGBA(image.Rect(0, 0, 64, 64))); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	driver := StableDiffusionImageDriver{}
	mainBinding := stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "checkpoint", filepath.Join(root, "main.safetensors"), 'a')
	cnBinding := stableDiffusionInvocationBindingForTest(StableDiffusionControlNetRequirementID, "controlnet", filepath.Join(root, "controlnet.safetensors"), 'b')

	// 1. Single-file community SDXL checkpoint: pure text-to-image (no ControlNet bound).
	txtPlan, err := driver.PlanImageInvocation(ImageInvocationInput{
		RecipeID:          StableDiffusionSDXLRecipeID,
		SupportedFeatures: nil,
		ExactBindings:     []InvocationExactBinding{mainBinding},
		Request: &runtimev1.ImageGenerateScenarioSpec{
			Prompt: "A yellow cup", NegativePrompt: "blurry", Size: "64x64", N: proto.Int32(1),
		},
	})
	if err != nil {
		t.Fatalf("single-file SDXL PlanImageInvocation: %v", err)
	}
	if err := txtPlan.Validate(); err != nil {
		t.Fatalf("single-file SDXL plan validate: %v", err)
	}
	txtLoad := txtPlan.LoadPlan().(StableDiffusionCPPLoadPlan)
	if !txtLoad.Checkpoint() || len(txtPlan.ModelFiles()) != 1 {
		t.Fatalf("single-file SDXL load plan = %+v files=%d", txtLoad, len(txtPlan.ModelFiles()))
	}
	if _, hasCN := txtLoad.ControlNet(); hasCN {
		t.Fatal("single-file SDXL unexpectedly attached ControlNet")
	}

	// 2. ControlNet bound, plain text-to-image (no control_image) still succeeds.
	cnTxtPlan, err := driver.PlanImageInvocation(ImageInvocationInput{
		RecipeID:          StableDiffusionSDXLRecipeID,
		SupportedFeatures: []string{"input.image"},
		ExactBindings:     []InvocationExactBinding{mainBinding, cnBinding},
		Request:           &runtimev1.ImageGenerateScenarioSpec{Prompt: "A yellow cup", Size: "64x64"},
	})
	if err != nil || cnTxtPlan.Validate() != nil {
		t.Fatalf("SDXL with ControlNet plain txt2img: err=%v", err)
	}
	if _, ok := cnTxtPlan.RequestPlan().(StableDiffusionCPPTextToImageRequestPlan); !ok {
		t.Fatalf("expected text-to-image plan variant, got %T", cnTxtPlan.RequestPlan())
	}

	// 3. ControlNet bound + typed control map -> control-image plan.
	request := &runtimev1.ImageGenerateScenarioSpec{
		Prompt: "A yellow cup", Size: "64x64",
		ControlImage: &runtimev1.ImageControlInput{Type: runtimev1.ImageControlType_IMAGE_CONTROL_TYPE_CANNY},
	}
	input := ImageInvocationInput{
		RecipeID:          StableDiffusionSDXLRecipeID,
		SupportedFeatures: []string{"input.image"},
		Request:           request,
		ExactBindings:     []InvocationExactBinding{mainBinding, cnBinding},
		Inputs:            []ImageResolvedInput{{Role: ImageResolvedInputRoleControl, SourceIdentity: "owned-map", ImageBytes: source.Bytes()}},
	}
	plan, err := driver.PlanImageInvocation(input)
	if err != nil {
		t.Fatal(err)
	}
	if err := plan.Validate(); err != nil {
		t.Fatal(err)
	}
	load := plan.LoadPlan().(StableDiffusionCPPLoadPlan)
	control := plan.RequestPlan().(StableDiffusionCPPControlRequestPlan)
	if !load.Checkpoint() || len(plan.ModelFiles()) != 2 || control.ControlType() != "canny" || control.ControlStrength() != 1 || control.ImageCount() != 1 {
		t.Fatal("control map semantics changed")
	}
	input.Inputs[0].ImageBytes[0] = 0
	if control.ControlImage().ImageBytes[0] != 137 {
		t.Fatal("input mutation changed captured control map")
	}

	// 4. Rejects mask, ordinary reference image (even with ControlNet bound), and control_image without ControlNet.
	request.MaskArtifactId = "mask"
	if _, err := driver.PlanImageInvocation(input); err == nil {
		t.Fatal("mask was silently accepted")
	}
	if _, err := driver.PlanImageInvocation(ImageInvocationInput{
		RecipeID:          StableDiffusionSDXLRecipeID,
		SupportedFeatures: []string{"input.image"},
		ExactBindings:     []InvocationExactBinding{mainBinding, cnBinding},
		Request:           &runtimev1.ImageGenerateScenarioSpec{Prompt: "edit", Size: "64x64", ReferenceImageArtifactId: "ref-1"},
		Inputs:            []ImageResolvedInput{{Role: ImageResolvedInputRoleSource, SourceIdentity: "ref-1", ImageBytes: source.Bytes()}},
	}); err == nil {
		t.Fatal("SDXL admitted ordinary reference image")
	}
	if _, err := driver.PlanImageInvocation(ImageInvocationInput{
		RecipeID:          StableDiffusionSDXLRecipeID,
		SupportedFeatures: nil,
		ExactBindings:     []InvocationExactBinding{mainBinding},
		Request: &runtimev1.ImageGenerateScenarioSpec{
			Prompt: "control without slot", Size: "64x64",
			ControlImage: &runtimev1.ImageControlInput{Type: runtimev1.ImageControlType_IMAGE_CONTROL_TYPE_CANNY},
		},
		Inputs: []ImageResolvedInput{{Role: ImageResolvedInputRoleControl, SourceIdentity: "owned-map", ImageBytes: source.Bytes()}},
	}); err == nil {
		t.Fatal("SDXL admitted control_image without ControlNet binding")
	}
	if _, err := driver.PlanImageInvocation(ImageInvocationInput{
		RecipeID:          StableDiffusionSDXLRecipeID,
		SupportedFeatures: nil,
		ExactBindings:     []InvocationExactBinding{mainBinding},
		Request:           &runtimev1.ImageGenerateScenarioSpec{Prompt: "two images", Size: "64x64", N: proto.Int32(2)},
	}); err == nil {
		t.Fatal("SDXL admitted multi-image batch N=2")
	}
}

func TestStableDiffusionHostPlatformGateAndSamplerValidation(t *testing.T) {
	driver := StableDiffusionImageDriver{}
	// SDXL is supported on windows/amd64 and darwin/arm64, unsupported on linux/amd64.
	for _, platform := range []string{"windows/amd64", "darwin/arm64"} {
		if reqs, reason := driver.ProjectRecipeForHost(StableDiffusionSDXLRecipeID, nil, []string{"input.image"}, platform); reason != success || len(reqs) != 2 {
			t.Fatalf("ProjectRecipeForHost(sdxl, %s) = %d reason=%v", platform, len(reqs), reason)
		}
	}
	if _, reason := driver.ProjectRecipeForHost(StableDiffusionSDXLRecipeID, nil, []string{"input.image"}, "linux/amd64"); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED {
		t.Fatalf("ProjectRecipeForHost(sdxl, linux/amd64) = %v, want DRIVER_DIALECT_UNSUPPORTED", reason)
	}
	// flux3-klein is admitted on windows/amd64 only.
	if _, reason := driver.ProjectRecipeForHost(StableDiffusionFlux3KleinRecipeID, nil, []string{"input.image"}, "windows/amd64"); reason != success {
		t.Fatalf("ProjectRecipeForHost(flux3-klein, windows/amd64) = %v", reason)
	}
	if _, reason := driver.ProjectRecipeForHost(StableDiffusionFlux3KleinRecipeID, nil, []string{"input.image"}, "darwin/arm64"); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED {
		t.Fatalf("ProjectRecipeForHost(flux3-klein, darwin/arm64) = %v, want DRIVER_DIALECT_UNSUPPORTED", reason)
	}
	// Unknown sampler/scheduler typos must fail portable config validation (never silently ignored by sd-server).
	for _, bad := range []map[string]any{
		{"sampler": "euelr"},
		{"scheduler": "discret"},
	} {
		opts, err := structpb.NewStruct(map[string]any{"executionOptions": bad})
		if err != nil {
			t.Fatal(err)
		}
		if _, reason := driver.ProjectRecipe(StableDiffusionSDXLRecipeID, opts, []string{"input.image"}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID {
			t.Fatalf("typo %v admitted: reason=%v", bad, reason)
		}
	}
	goodOpts, err := structpb.NewStruct(map[string]any{"executionOptions": map[string]any{"sampler": "dpm++2m", "scheduler": "karras"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, reason := driver.ProjectRecipe(StableDiffusionSDXLRecipeID, goodOpts, []string{"input.image"}); reason != success {
		t.Fatalf("valid sampler/scheduler rejected: %v", reason)
	}
}
