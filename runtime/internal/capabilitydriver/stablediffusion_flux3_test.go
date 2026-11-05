package capabilitydriver

import (
	"bytes"
	"encoding/binary"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"path/filepath"
	"strings"
	"testing"
)

func TestFlux3KleinModelContractsRejectBaseAndWrongEncoder(t *testing.T) {
	driver := StableDiffusionImageDriver{}
	requirements, reason := driver.Interpret(InterpretInput{RecipeID: StableDiffusionFlux3KleinRecipeID, SupportedFeatures: []string{"input.image"}})
	if reason != success || len(requirements) != 3 || !validStableDiffusionRequirementSequence(requirements) {
		t.Fatal(reason, requirements)
	}
	project := func(index int, probe []byte) runtimev1.LocalCapabilityReason {
		_, why := projectLlamaBindingForTest(driver, ModelAssetBindingInput{RecipeID: StableDiffusionFlux3KleinRecipeID, Requirement: requirements[index], Binding: &runtimev1.ModelAssetExactBinding{RequirementId: requirements[index].RequirementId, ModelAssetId: "asset", VerifiedContentId: "sha256:" + strings.Repeat("a", 64), EntrySha256: strings.Repeat("a", 64)}, Entry: ModelAssetFileFact{RelativePath: "model.gguf", SizeBytes: 1 << 30, FormatProbe: probe}})
		return why
	}
	shapes := map[string][]uint64{
		"emb_in.image.weight": {128, 3072}, "emb_in.image_cond.weight": {128, 3072}, "txt_in.weight": {20480, 3072}, "ref_time_in.in_layer.weight": {256, 3072},
		"content_mode_blocks.image.4.q_proj.weight": {3072, 3072}, "content_mode_blocks.image_cond.0.q_proj.weight": {3072, 3072}, "content_mode_blocks.image_cond.4.q_proj.weight": {3072, 3072}, "txt_mode_blocks.4.q_proj.weight": {3072, 3072},
		"single_blocks.0.mlp_in.weight": {3072, 18432}, "single_blocks.27.mlp_out.weight": {9216, 3072}, "final_layer.image.linear.weight": {3072, 128},
	}
	if why := project(0, fluxGGUFForTest("", nil, shapes)); why != success {
		t.Fatal("metadata-free current transformer rejected", why)
	}
	delete(shapes, "ref_time_in.in_layer.weight")
	if why := project(0, fluxGGUFForTest("", nil, shapes)); why == success {
		t.Fatal("undistilled base admitted as Klein")
	}
	shapes["ref_time_in.in_layer.weight"] = []uint64{256, 3072}
	shapes["single_blocks.28.q_proj.weight"] = []uint64{3072, 3072}
	if why := project(0, fluxGGUFForTest("", nil, shapes)); why == success {
		t.Fatal("different depth admitted")
	}
	metadata := map[string]uint32{"qwen3vl.embedding_length": 2560, "qwen3vl.block_count": 36, "qwen3vl.feed_forward_length": 9728, "qwen3vl.attention.head_count": 32, "qwen3vl.attention.head_count_kv": 8}
	encoder := map[string][]uint64{"token_embd.weight": {2560, 151936}, "output_norm.weight": {2560}, "blk.0.attn_q.weight": {2560, 4096}, "blk.35.attn_output.weight": {4096, 2560}, "blk.35.ffn_up.weight": {2560, 9728}}
	if why := project(1, fluxGGUFForTest("qwen3vl", metadata, encoder)); why != success {
		t.Fatal("exact encoder rejected", why)
	}
	encoder["token_embd.weight"] = []uint64{4096, 151936}
	if why := project(1, fluxGGUFForTest("qwen3vl", metadata, encoder)); why == success {
		t.Fatal("metadata hid incompatible actual encoder width")
	}
	if why := project(1, fluxGGUFForTest("qwen3", metadata, encoder)); why == success {
		t.Fatal("text-only Qwen accepted as VL encoder")
	}
}

func TestFlux3KleinTextAndOwnedEditUseSameIndependentResourceAxes(t *testing.T) {
	root := t.TempDir()
	bindings := []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "main", filepath.Join(root, "main.gguf"), 'a'),
		stableDiffusionInvocationBindingForTest(StableDiffusionTextEncoderRequirementID, "encoder", filepath.Join(root, "encoder.gguf"), 'b'),
		stableDiffusionInvocationBindingForTest(StableDiffusionVAERequirementID, "vae", filepath.Join(root, "vae.safetensors"), 'c'),
	}
	driver := StableDiffusionImageDriver{}
	input := ImageInvocationInput{RecipeID: StableDiffusionFlux3KleinRecipeID, SupportedFeatures: []string{"input.image"}, ExactBindings: bindings, Request: &runtimev1.ImageGenerateScenarioSpec{Prompt: "A blue cup on stone.", Size: "512x512"}}
	plan, err := driver.PlanImageInvocation(input)
	if err != nil {
		t.Fatal(err)
	}
	if err := (stableDiffusionImageTranslator{}).validateImagePlan(plan); err != nil {
		t.Fatal(err)
	}
	if plan.RequestPlan().Steps() != 16 || plan.RequestPlan().CFGScale() != 1 || plan.RequestPlan().Sampler() != "euler" {
		t.Fatal("distilled defaults changed")
	}
	input.Inputs = []ImageResolvedInput{{Role: ImageResolvedInputRoleSource, SourceIdentity: "owned-image", ImageBytes: []byte("already-authorized-source")}}
	plan, err = driver.PlanImageInvocation(input)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := plan.RequestPlan().(StableDiffusionCPPInstructionEditRequestPlan); !ok {
		t.Fatal("owned edit was turned into text-only generation")
	}
	if err := (stableDiffusionImageTranslator{}).validateImagePlan(plan); err != nil {
		t.Fatal(err)
	}
	input.Request.NegativePrompt = "blur"
	if _, err := driver.PlanImageInvocation(input); err == nil {
		t.Fatal("unsupported negative prompt admitted")
	}
}

func TestFlux3EncoderProbeReachesTensorTableBeyondGenericPrefix(t *testing.T) {
	driver := StableDiffusionImageDriver{}
	metadata := map[string]uint32{"qwen3vl.embedding_length": 2560, "qwen3vl.block_count": 36, "qwen3vl.feed_forward_length": 9728, "qwen3vl.attention.head_count": 32, "qwen3vl.attention.head_count_kv": 8}
	shapes := map[string][]uint64{"token_embd.weight": {2560, 151936}, "output_norm.weight": {2560}, "blk.0.attn_q.weight": {2560, 4096}, "blk.35.attn_output.weight": {4096, 2560}, "blk.35.ffn_up.weight": {2560, 9728}}
	header := fluxGGUFForTest("qwen3vl", metadata, shapes)
	binary.LittleEndian.PutUint64(header[16:24], binary.LittleEndian.Uint64(header[16:24])+1)
	var raw bytes.Buffer
	raw.Write(header[:24])
	key := "tokenizer.padding"
	_ = binary.Write(&raw, binary.LittleEndian, uint64(len(key)))
	raw.WriteString(key)
	_ = binary.Write(&raw, binary.LittleEndian, uint32(9))
	_ = binary.Write(&raw, binary.LittleEndian, uint32(0))
	_ = binary.Write(&raw, binary.LittleEndian, uint64(5<<20))
	raw.Write(make([]byte, 5<<20))
	raw.Write(header[24:])
	input := ModelAssetFormatProbeInput{RecipeID: StableDiffusionFlux3KleinRecipeID, RequirementID: StableDiffusionTextEncoderRequirementID, Entry: true, RelativePath: "encoder.gguf"}
	probe, err := driver.ProbeModelAsset(input, bytes.NewReader(raw.Bytes()), int64(raw.Len()))
	if err != nil {
		t.Fatal("real-size header window rejected", err)
	}
	if len(probe) > 4096 {
		t.Fatal("raw tokenizer payload leaked into captured facts")
	}
	input.RequirementID = StableDiffusionMainRequirementID
	if driver.ModelAssetFormatProbeBytes(input) != MaxAssetFormatProbeBytes {
		t.Fatal("encoder budget widened unrelated main model")
	}
	input.RecipeID = "ideogram4"
	input.RequirementID = StableDiffusionTextEncoderRequirementID
	if driver.ModelAssetFormatProbeBytes(input) != MaxAssetFormatProbeBytes {
		t.Fatal("encoder budget widened another recipe")
	}
}
