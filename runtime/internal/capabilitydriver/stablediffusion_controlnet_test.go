package capabilitydriver

import (
	"bytes"
	"image"
	"image/png"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestSDXLControlNetUsesCompleteCheckpointAndIndependentControlModel(t *testing.T) {
	driver := SDXLControlNetDriver{}
	requirements, reason := driver.ProjectRecipe(SDXLControlNetRecipeID, nil, []string{"input.image"})
	if reason != success || len(requirements) != 2 || requirements[1].RequirementId != SDXLControlNetSlot {
		t.Fatal(reason, requirements)
	}
	if _, why := driver.ProjectRecipeForHost(SDXLControlNetRecipeID, nil, []string{"input.image"}, "darwin/arm64"); why == success {
		t.Fatal("pre-1088 Mac package admitted for ControlNet Union")
	}
	main := map[string][]int64{
		"model.diffusion_model.input_blocks.0.0.weight":                                    {320, 4, 3, 3},
		"conditioner.embedders.0.transformer.text_model.embeddings.token_embedding.weight": {49408, 768},
		"conditioner.embedders.1.model.token_embedding.weight":                             {49408, 1280},
		"first_stage_model.decoder.conv_in.weight":                                         {512, 4, 3, 3},
	}
	if !sdxlControlNetTensorContract("sdxl-base-checkpoint", fluxSafetensorsForTest(t, main)) {
		t.Fatal("complete SDXL checkpoint rejected")
	}
	delete(main, "conditioner.embedders.1.model.token_embedding.weight")
	if sdxlControlNetTensorContract("sdxl-base-checkpoint", fluxSafetensorsForTest(t, main)) {
		t.Fatal("checkpoint missing second text encoder admitted")
	}
	control := map[string][]int64{"task_embedding": {8, 320}, "controlnet_cond_embedding.conv_in.weight": {16, 3, 3, 3}, "controlnet_down_blocks.0.weight": {320, 320, 1, 1}}
	if !sdxlControlNetTensorContract("sdxl-controlnet-union-promax", fluxSafetensorsForTest(t, control)) {
		t.Fatal("ProMax ControlNet rejected")
	}
	control["task_embedding"] = []int64{6, 320}
	if sdxlControlNetTensorContract("sdxl-controlnet-union-promax", fluxSafetensorsForTest(t, control)) {
		t.Fatal("six-type Union admitted as ProMax")
	}
}

func TestSDXLControlNetRequestCapturesTypedControlMap(t *testing.T) {
	var source bytes.Buffer
	if err := png.Encode(&source, image.NewRGBA(image.Rect(0, 0, 64, 64))); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	request := &runtimev1.ImageGenerateScenarioSpec{Prompt: "A yellow cup", Size: "64x64", ControlImage: &runtimev1.ImageControlInput{Type: runtimev1.ImageControlType_IMAGE_CONTROL_TYPE_CANNY}}
	input := ImageInvocationInput{
		RecipeID: SDXLControlNetRecipeID, SupportedFeatures: []string{"input.image"}, Request: request,
		ExactBindings: []InvocationExactBinding{
			stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "checkpoint", filepath.Join(root, "main.safetensors"), 'a'),
			stableDiffusionInvocationBindingForTest(SDXLControlNetSlot, "controlnet", filepath.Join(root, "controlnet.safetensors"), 'b'),
		},
		Inputs: []ImageResolvedInput{{Role: ImageResolvedInputRoleControl, SourceIdentity: "owned-map", ImageBytes: source.Bytes()}},
	}
	plan, err := (SDXLControlNetDriver{}).PlanImageInvocation(input)
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
	request.MaskArtifactId = "mask"
	if _, err := (SDXLControlNetDriver{}).PlanImageInvocation(input); err == nil {
		t.Fatal("mask was silently accepted")
	}
}
