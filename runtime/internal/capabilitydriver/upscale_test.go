package capabilitydriver

import (
	"encoding/json"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestUpscaleRecipesKeepIndependentModelsAndCapabilities(t *testing.T) {
	for _, video := range []bool{false, true} {
		driver := UpscaleDriver{Video: video}
		for _, model := range []string{"relayvsr-2x", "relayvsr-4x", "seedvr2-3b", "seedvr2-7b-sharp"} {
			recipe := model + "." + driver.contract()
			requirements, reason := driver.ProjectRecipe(recipe, nil, nil)
			if reason != success || len(requirements) != 2 || requirements[0].RequirementId != UpscaleTransformerSlot || requirements[1].RequirementId != UpscaleVAESlot {
				t.Fatal(recipe, reason, requirements)
			}
			if requirements[0].Policy != runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE || requirements[1].PreferredVerifiedContentId != "" {
				t.Fatal("catalog recommendation became an execution content pin")
			}
		}
		if _, reason := driver.ProjectRecipe("seedvr2-3b", nil, nil); reason == success {
			t.Fatal("capability-free recipe alias admitted")
		}
	}
}

func TestUpscalePlanUsesMatchingScaleAndCapturesImmutableInput(t *testing.T) {
	driver := UpscaleDriver{}
	root := t.TempDir()
	bindings := []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(UpscaleTransformerSlot, "transformer", filepath.Join(root, "main.safetensors"), 'a'),
		stableDiffusionInvocationBindingForTest(UpscaleVAESlot, "vae", filepath.Join(root, "vae.safetensors"), 'b'),
	}
	source := []byte{1, 2, 3}
	request := &runtimev1.MediaUpscaleScenarioSpec{SourceArtifactId: "owned-source", Scale: 2, Seed: proto.Int64(17)}
	plan, err := driver.PlanUpscale("relayvsr-2x.image.upscale", request, source, "image/png", bindings, nil)
	if err != nil || plan.Scale != 2 || plan.Seed != 17 || plan.Video {
		t.Fatal(plan, err)
	}
	source[0] = 9
	bindings[0].AbsolutePath = "changed"
	if plan.Source[0] != 1 || plan.Bindings[0].AbsolutePath == "changed" {
		t.Fatal("captured invocation changed after caller mutation")
	}
	request.Scale = 4
	if _, err := driver.PlanUpscale("relayvsr-2x.image.upscale", request, plan.Source, "image/png", plan.Bindings, nil); err == nil {
		t.Fatal("scale-specific RelayVSR accepted a mismatched factor")
	}
	request.Scale = 2
	request.Seed = proto.Int64(-1)
	if _, err := driver.PlanUpscale("seedvr2-3b.image.upscale", request, plan.Source, "image/png", plan.Bindings, nil); err == nil {
		t.Fatal("negative super-resolution seed admitted")
	}
}

func TestUpscaleTensorContractsRejectOtherModelsAndDecoderKinds(t *testing.T) {
	seed := map[string][]int64{"vid_in.proj.weight": {2560, 132}, "vid_out.proj.weight": {64, 2560}, "txt_in.weight": {2560, 5120}}
	probe := fluxSafetensorsForTest(t, seed)
	if !upscaleTensorContractValid("seedvr2-3b", probe) || upscaleTensorContractValid("seedvr2-7b-sharp", probe) || upscaleTensorContractValid("relayvsr-2x", probe) {
		t.Fatal("super-resolution transformer family or width was flattened")
	}
	vae := fluxSafetensorsForTest(t, map[string][]int64{"decoder.conv_in.weight": {512, 16, 3, 3, 3}, "decoder.conv_out.weight": {3, 128, 3, 3, 3}})
	if !upscaleTensorContractValid("seedvr2-vae", vae) || upscaleTensorContractValid("relayvsr-vae", vae) {
		t.Fatal("different VAE architectures were treated as interchangeable")
	}
}

func TestRelayVSRVAEScaleComesFromModelAuthoredMetadata(t *testing.T) {
	base := fluxSafetensorsForTest(t, map[string][]int64{
		"condition_encoder.projection.weight": {512, 48, 1, 1},
		"residual_projection.weight":          {768, 1024}, "video_type_embedding": {1, 1, 512},
	})
	var header map[string]any
	if err := json.Unmarshal(base[8:], &header); err != nil {
		t.Fatal(err)
	}
	for _, scale := range []int{2, 4} {
		config, err := json.Marshal(map[string]int{"upscale_factor": scale})
		if err != nil {
			t.Fatal(err)
		}
		header["__metadata__"] = map[string]string{"config": string(config)}
		raw, err := json.Marshal(header)
		if err != nil {
			t.Fatal(err)
		}
		probe := safetensorsProbeForTest(raw)
		if upscaleTensorContractValid("relayvsr-2x-vae", probe) != (scale == 2) ||
			upscaleTensorContractValid("relayvsr-4x-vae", probe) != (scale == 4) {
			t.Fatalf("same-shaped RelayVSR VAE did not retain scale %d", scale)
		}
	}
	if upscaleTensorContractValid("relayvsr-2x-vae", base) || upscaleTensorContractValid("relayvsr-4x-vae", base) {
		t.Fatal("a missing scale was inferred from compatible tensor shapes")
	}
}
