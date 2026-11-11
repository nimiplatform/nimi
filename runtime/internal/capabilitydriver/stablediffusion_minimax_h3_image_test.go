package capabilitydriver

import (
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestMiniMaxH3ImageModelContracts(t *testing.T) {
	driver := StableDiffusionImageDriver{}
	recipe := StableDiffusionMiniMaxH3ImageRecipeID
	requirements, reason := driver.ProjectRecipe(recipe, nil, []string{"input.image"})
	if reason != success || len(requirements) != 3 || !validStableDiffusionRequirementSequence(requirements) {
		t.Fatalf("H3 Image requirements = %v, reason = %v", requirements, reason)
	}
	project := func(index int, path string, probe []byte) ModelAssetBindingProjection {
		t.Helper()
		binding := &runtimev1.ModelAssetExactBinding{
			RequirementId: requirements[index].GetRequirementId(), ModelAssetId: "test-asset",
			VerifiedContentId: "sha256:" + strings.Repeat("a", 64), EntrySha256: strings.Repeat("a", 64),
		}
		projection, _ := projectLlamaBindingForTest(driver, ModelAssetBindingInput{
			RecipeID: recipe, Requirement: requirements[index], Binding: binding,
			Entry: ModelAssetFileFact{RelativePath: path, SizeBytes: 1 << 30, FormatProbe: probe},
		})
		return projection
	}
	main := map[string][]int64{
		"condition_proj.weight": {5376, 5120}, "video_patch_proj.weight": {5376, 96},
		"blocks.0.attn.qkv_proj.weight": {21504, 5376}, "blocks.49.attn.qkv_proj.weight": {21504, 5376},
		"final_layer.video_out.weight": {576, 5376},
	}
	if got := project(0, "dit.safetensors", fluxSafetensorsForTest(t, main)); got.Descriptor.Family != recipe {
		t.Fatalf("H3 Image transformer projection = %+v", got)
	}
	main["audio_patch_proj.weight"] = []int64{5376, 96}
	if got := project(0, "video.safetensors", fluxSafetensorsForTest(t, main)); got.Descriptor.Family != "" {
		t.Fatal("audio-video transformer admitted as H3 Image")
	}
	encoder := map[string][]uint64{
		"model.embed_tokens.weight": {5120, 151936}, "model.layers.0.self_attn.q_proj.weight": {5120, 8192},
		"model.layers.49.mlp.up_proj.weight":               {5120, 25600},
		"visual.deepstack_merger_list.0.linear_fc2.weight": {4608, 5120},
		"visual.deepstack_merger_list.1.linear_fc2.weight": {4608, 5120},
		"visual.deepstack_merger_list.2.linear_fc2.weight": {4608, 5120},
	}
	if got := project(1, "encoder.gguf", fluxGGUFForTest("", nil, encoder)); got.Descriptor.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT {
		t.Fatalf("shared H3 encoder projection = %+v", got)
	}
	delete(encoder, "visual.deepstack_merger_list.2.linear_fc2.weight")
	if got := project(1, "encoder.gguf", fluxGGUFForTest("", nil, encoder)); got.Descriptor.Family != "" {
		t.Fatal("encoder without all DeepStack mergers admitted")
	}
	vae := map[string][]int64{
		"decoder.x_embedder.weight": {1024, 24}, "decoder.proj_out.weight": {768, 1024},
		"encoder.conv_out.weight": {48, 1024, 3, 3, 3},
	}
	if got := project(2, "vae.safetensors", fluxSafetensorsForTest(t, vae)); got.Descriptor.Family != "minimax-h3-image-vae" {
		t.Fatalf("H3 Image VAE projection = %+v", got)
	}
	vae["decoder.proj_out.weight"] = []int64{1536, 1024}
	if got := project(2, "vae.safetensors", fluxSafetensorsForTest(t, vae)); got.Descriptor.Family != "" {
		t.Fatal("different VAE decoder admitted")
	}
}

func TestMiniMaxH3ImageInvocation(t *testing.T) {
	root := t.TempDir()
	driver := StableDiffusionImageDriver{}
	input := ImageInvocationInput{
		RecipeID: StableDiffusionMiniMaxH3ImageRecipeID, SupportedFeatures: []string{"input.image"},
		ExactBindings: []InvocationExactBinding{
			stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "main", filepath.Join(root, "main.safetensors"), 'a'),
			stableDiffusionInvocationBindingForTest(StableDiffusionTextEncoderRequirementID, "encoder", filepath.Join(root, "encoder.gguf"), 'b'),
			stableDiffusionInvocationBindingForTest(StableDiffusionVAERequirementID, "vae", filepath.Join(root, "vae.safetensors"), 'c'),
		},
		Request: &runtimev1.ImageGenerateScenarioSpec{Prompt: "A blue cup on stone."},
	}
	plan, err := driver.PlanImageInvocation(input)
	if err != nil {
		t.Fatal(err)
	}
	request := plan.RequestPlan()
	if _, ok := request.(StableDiffusionCPPTextToImageRequestPlan); !ok || request.Steps() != 6 || request.CFGScale() != 1 || request.Sampler() != "euler" || request.Scheduler() != "discrete" {
		t.Fatalf("H3 Image generation plan = %+v", request)
	}
	input.Inputs = []ImageResolvedInput{{Role: ImageResolvedInputRoleSource, SourceIdentity: "owned-image", ImageBytes: []byte("authorized source")}}
	plan, err = driver.PlanImageInvocation(input)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := plan.RequestPlan().(StableDiffusionCPPInstructionEditRequestPlan); !ok {
		t.Fatal("H3 Image reference was omitted from the edit plan")
	}
	if err := (stableDiffusionImageTranslator{}).validateImagePlan(plan); err != nil {
		t.Fatal(err)
	}
	input.Request.Size = "1016x1024"
	if _, err := driver.PlanImageInvocation(input); err == nil {
		t.Fatal("unaligned canvas admitted")
	}
	input.Request.Size = "1024x1024"
	input.PortableConfig, err = structpb.NewStruct(map[string]any{"executionOptions": map[string]any{"steps": 8}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := driver.PlanImageInvocation(input); err == nil {
		t.Fatal("non-PDD step count admitted")
	}
}
