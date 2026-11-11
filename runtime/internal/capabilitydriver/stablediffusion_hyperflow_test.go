package capabilitydriver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestHyperFlowProjectsIndependentSafetensorsAndSixStepVideo(t *testing.T) {
	driver := StableDiffusionVideoDriver{hyperFlow: true}
	requirements, reason := driver.ProjectRecipe(HyperFlowH3VideoRecipeID, nil, []string{"input.image"})
	if reason != success || len(requirements) != 5 {
		t.Fatal(reason, requirements)
	}
	for _, requirement := range requirements[:2] {
		if requirement.GetCompatibilityConstraints().GetFields()["format"].GetStringValue() != "safetensors" {
			t.Fatal("HyperFlow transformer must use its combined safetensors contract")
		}
	}
	plan, err := driver.PlanVideoInvocation(VideoInvocationInput{LoadoutID: "hyperflow-test", ExactBindings: stableDiffusionVideoInvocationBindingsForTest(t.TempDir()), Request: stableDiffusionVideoRequestForTest()})
	if err != nil {
		t.Fatal(err)
	}
	if plan.RecipeID() != HyperFlowH3VideoRecipeID || plan.SampleSteps() != 6 || plan.SampleMethod() != "euler" || !plan.AudioRequired() {
		t.Fatal("HyperFlow generation did not retain its distilled audio-video recipe")
	}
	_, reason = driver.ProjectRecipe(HyperFlowH3VideoRecipeID, stableDiffusionVideoPortableForTest(t, map[string]any{"sampleMethod": "heun"}), []string{"input.image"})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID {
		t.Fatal("conflicting HyperFlow sampler admitted", reason)
	}
}

func TestSolH3VAEBindingRequiresImageEncoderAndDistilledVideoDecoder(t *testing.T) {
	shapes := map[string][]int64{
		"encoder.conv_out.weight":   {48, 1024, 3, 3, 3},
		"decoder.x_embedder.weight": {2048, 24}, "decoder.proj_out.weight": {3072, 2048},
	}
	if !stableDiffusionVideoSlotFormatValid(StableDiffusionVideoVAERequirementID, "safetensors", fluxSafetensorsForTest(t, shapes)) {
		t.Fatal("Sol video VAE rejected")
	}
	shapes["decoder.proj_out.weight"] = []int64{768, 1024}
	if stableDiffusionVideoSlotFormatValid(StableDiffusionVideoVAERequirementID, "safetensors", fluxSafetensorsForTest(t, shapes)) {
		t.Fatal("image decoder accepted as Sol video VAE")
	}
}
