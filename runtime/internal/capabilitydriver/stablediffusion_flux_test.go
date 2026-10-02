package capabilitydriver

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestFluxSchnellModelContractsAndIndependentAxes(t *testing.T) {
	driver := StableDiffusionImageDriver{}
	requirements, reason := driver.Interpret(InterpretInput{RecipeID: StableDiffusionFluxSchnellRecipeID})
	if reason != success || len(requirements) != 4 || !validStableDiffusionRequirementSequence(requirements) {
		t.Fatalf("requirements=%+v reason=%v", requirements, reason)
	}
	if family, ok := StableDiffusionImageRecipeModelFamily(StableDiffusionFluxSchnellRecipeID); !ok || family != "flux" {
		t.Fatalf("family=%q ok=%v", family, ok)
	}
	mainShapes := fluxMainShapesForTest()
	t5Metadata := map[string]uint32{"t5encoder.embedding_length": 4096, "t5encoder.feed_forward_length": 10240, "t5encoder.block_count": 24, "t5encoder.attention.head_count": 64}
	t5Shapes := map[string][]uint64{"token_embd.weight": {4096, 32128}, "enc.blk.0.attn_q.weight": {4096, 4096}, "enc.blk.23.ffn_up.weight": {4096, 10240}, "enc.output_norm.weight": {4096}}
	clipShapes := map[string][]int64{
		"text_model.embeddings.token_embedding.weight":         {49408, 768},
		"text_model.embeddings.position_embedding.weight":      {77, 768},
		"text_model.encoder.layers.0.self_attn.q_proj.weight":  {768, 768},
		"text_model.encoder.layers.11.self_attn.q_proj.weight": {768, 768},
		"text_model.final_layer_norm.weight":                   {768},
	}
	project := func(index int, path string, probe []byte) runtimev1.LocalCapabilityReason {
		t.Helper()
		_, why := driver.ProjectModelAssetBinding(ModelAssetBindingInput{
			RecipeID: StableDiffusionFluxSchnellRecipeID, Requirement: requirements[index],
			Binding: &runtimev1.ModelAssetExactBinding{RequirementId: requirements[index].RequirementId, ModelAssetId: "asset", VerifiedContentId: "sha256:" + strings.Repeat("a", 64), EntrySha256: strings.Repeat("a", 64)},
			Entry:   ModelAssetFileFact{RelativePath: path, SizeBytes: 1 << 30, FormatProbe: probe},
		})
		return why
	}
	if why := project(0, "main.gguf", fluxGGUFForTest("flux", nil, mainShapes)); why != success {
		t.Fatalf("Schnell main=%v", why)
	}
	if why := project(1, "t5.gguf", fluxGGUFForTest("t5encoder", t5Metadata, t5Shapes)); why != success {
		t.Fatalf("T5=%v", why)
	}
	if why := project(3, "clip.safetensors", fluxSafetensorsForTest(t, clipShapes)); why != success {
		t.Fatalf("CLIP=%v", why)
	}
	if why := project(3, "t5.gguf", fluxGGUFForTest("t5encoder", t5Metadata, nil)); why == success {
		t.Fatal("T5 accepted in CLIP slot")
	}
	mainShapes["guidance_in.in_layer.weight"] = []uint64{256, 3072}
	if why := project(0, "renamed-schnell.gguf", fluxGGUFForTest("flux", nil, mainShapes)); why == success {
		t.Fatal("Dev guidance weights admitted by Schnell contract")
	}
	delete(mainShapes, "guidance_in.in_layer.weight")
	mainShapes["txt_in.weight"] = []uint64{2048, 3072}
	if why := project(0, "main.gguf", fluxGGUFForTest("flux", nil, mainShapes)); why == success {
		t.Fatal("incompatible conditioning width admitted")
	}
	t5Metadata["t5encoder.embedding_length"] = 2048
	if why := project(1, "t5.gguf", fluxGGUFForTest("t5encoder", t5Metadata, t5Shapes)); why == success {
		t.Fatal("smaller T5 admitted")
	}
	t5Metadata["t5encoder.embedding_length"] = 4096
	t5Shapes["token_embd.weight"] = []uint64{2048, 32128}
	if why := project(1, "t5.gguf", fluxGGUFForTest("t5encoder", t5Metadata, t5Shapes)); why == success {
		t.Fatal("T5 metadata hid incompatible actual tensor width")
	}
	clipShapes["text_model.embeddings.token_embedding.weight"] = []int64{49408, 1024}
	if why := project(3, "clip.safetensors", fluxSafetensorsForTest(t, clipShapes)); why == success {
		t.Fatal("incompatible CLIP width admitted")
	}
	if validStableDiffusionRequirementSequence(requirements[:3]) {
		t.Fatal("missing CLIP axis admitted")
	}
}

func TestFluxSchnellInvocationKeepsBothEncodersAndRejectsUnsupportedInput(t *testing.T) {
	root := t.TempDir()
	bindings := []InvocationExactBinding{
		stableDiffusionInvocationBindingForTest(StableDiffusionMainRequirementID, "main", filepath.Join(root, "main.gguf"), 'a'),
		stableDiffusionInvocationBindingForTest(StableDiffusionTextEncoderRequirementID, "t5", filepath.Join(root, "t5.gguf"), 'b'),
		stableDiffusionInvocationBindingForTest(StableDiffusionVAERequirementID, "vae", filepath.Join(root, "vae.safetensors"), 'c'),
		stableDiffusionInvocationBindingForTest(StableDiffusionCLIPLRequirementID, "clip", filepath.Join(root, "clip.safetensors"), 'd'),
	}
	input := ImageInvocationInput{RecipeID: StableDiffusionFluxSchnellRecipeID, ExactBindings: bindings, Request: &runtimev1.ImageGenerateScenarioSpec{Prompt: "A red paper boat", Size: "512x512"}}
	driver := StableDiffusionImageDriver{}
	plan, err := driver.PlanImageInvocation(input)
	if err != nil {
		t.Fatal(err)
	}
	if err := (stableDiffusionImageTranslator{}).validateImagePlan(plan); err != nil {
		t.Fatal(err)
	}
	load := plan.LoadPlan().(StableDiffusionCPPLoadPlan)
	clip, ok := load.CLIPL()
	if !ok || clip.AbsolutePath() != bindings[3].AbsolutePath || load.TextEncoder().AbsolutePath() != bindings[1].AbsolutePath || plan.RequestPlan().Steps() != 4 || plan.RequestPlan().CFGScale() != 1 || plan.RequestPlan().Sampler() != "euler" {
		t.Fatal("dual encoders or Schnell defaults were lost")
	}
	input.ExactBindings = bindings[:3]
	if _, err := driver.PlanImageInvocation(input); err == nil {
		t.Fatal("missing CLIP accepted")
	}
	input.ExactBindings = bindings
	input.Request.NegativePrompt = "fog"
	if _, err := driver.PlanImageInvocation(input); err == nil {
		t.Fatal("unsupported negative prompt silently admitted")
	}
	input.Request.NegativePrompt = ""
	input.SupportedFeatures = []string{"input.image"}
	if _, err := driver.PlanImageInvocation(input); err == nil {
		t.Fatal("image input silently admitted")
	}
}

func fluxMainShapesForTest() map[string][]uint64 {
	return map[string][]uint64{"img_in.weight": {64, 3072}, "txt_in.weight": {4096, 3072}, "vector_in.in_layer.weight": {768, 3072}, "double_blocks.18.img_attn.proj.weight": {3072, 3072}, "single_blocks.37.linear1.weight": {3072, 21504}, "final_layer.linear.weight": {3072, 64}}
}

func fluxGGUFForTest(architecture string, metadata map[string]uint32, tensors map[string][]uint64) []byte {
	var buffer bytes.Buffer
	write := func(value any) { _ = binary.Write(&buffer, binary.LittleEndian, value) }
	str := func(value string) { write(uint64(len(value))); buffer.WriteString(value) }
	buffer.WriteString("GGUF")
	write(uint32(3))
	write(uint64(len(tensors)))
	write(uint64(len(metadata) + 1))
	str("general.architecture")
	write(uint32(8))
	str(architecture)
	keys := make([]string, 0, len(metadata))
	for key := range metadata {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		str(key)
		write(uint32(4))
		write(metadata[key])
	}
	keys = keys[:0]
	for key := range tensors {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		str(key)
		write(uint32(len(tensors[key])))
		for _, dim := range tensors[key] {
			write(dim)
		}
		write(uint32(0))
		write(uint64(0))
	}
	return buffer.Bytes()
}

func fluxSafetensorsForTest(t *testing.T, shapes map[string][]int64) []byte {
	t.Helper()
	header := map[string]any{}
	var offset int64
	for name, shape := range shapes {
		size := int64(2)
		for _, dim := range shape {
			size *= dim
		}
		header[name] = map[string]any{"dtype": "F16", "shape": shape, "data_offsets": []int64{offset, offset + size}}
		offset += size
	}
	raw, err := json.Marshal(header)
	if err != nil {
		t.Fatal(err)
	}
	probe := make([]byte, 8+len(raw))
	binary.LittleEndian.PutUint64(probe, uint64(len(raw)))
	copy(probe[8:], raw)
	return probe
}
