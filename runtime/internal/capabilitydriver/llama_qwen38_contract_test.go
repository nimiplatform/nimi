package capabilitydriver

import (
	"bytes"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
)

// Metadata and tensor shapes observed in ggml-org's fixed Q4_K_M header.
// This fixture exercises admission, not model inference or weight integrity.
func qwen38HeaderForTest(t *testing.T) []byte {
	t.Helper()
	var out bytes.Buffer
	out.WriteString("GGUF")
	for _, v := range []any{uint32(3), uint64(6), uint64(15)} {
		mustWriteLlamaProbeValue(t, &out, v)
	}
	for _, entry := range []struct{ key, value string }{
		{"general.architecture", "qwen35"}, {"general.type", "model"}, {"tokenizer.ggml.pre", "qwen35"}, {"tokenizer.chat_template", "<|im_start|>user<|im_end|><think>"},
	} {
		writeLlamaProbeString(t, &out, entry.key)
		mustWriteLlamaProbeValue(t, &out, uint32(ggufmeta.ValueTypeString))
		writeLlamaProbeString(t, &out, entry.value)
	}
	for _, entry := range []struct {
		key   string
		value uint32
	}{
		{"qwen35.context_length", 262144}, {"qwen35.block_count", 64}, {"qwen35.embedding_length", 5120}, {"qwen35.feed_forward_length", 17408},
		{"qwen35.attention.head_count", 24}, {"qwen35.attention.head_count_kv", 4}, {"qwen35.attention.key_length", 256}, {"qwen35.attention.value_length", 256},
		{"qwen35.full_attention_interval", 4}, {"qwen35.ssm.state_size", 128}, {"qwen35.ssm.inner_size", 6144},
	} {
		writeLlamaProbeString(t, &out, entry.key)
		mustWriteLlamaProbeValue(t, &out, uint32(ggufmeta.ValueTypeUint32))
		mustWriteLlamaProbeValue(t, &out, entry.value)
	}
	for _, tensor := range []struct {
		name  string
		shape []uint64
	}{
		{"token_embd.weight", []uint64{5120, 248320}}, {"output_norm.weight", []uint64{5120}},
		{"blk.0.attn_qkv.weight", []uint64{5120, 10240}}, {"blk.0.ssm_a", []uint64{48}},
		{"blk.63.attn_q.weight", []uint64{5120, 12288}}, {"blk.63.ffn_down.weight", []uint64{17408, 5120}},
	} {
		writeLlamaProbeString(t, &out, tensor.name)
		mustWriteLlamaProbeValue(t, &out, uint32(len(tensor.shape)))
		for _, v := range tensor.shape {
			mustWriteLlamaProbeValue(t, &out, v)
		}
		mustWriteLlamaProbeValue(t, &out, uint32(0))
		mustWriteLlamaProbeValue(t, &out, uint64(0))
	}
	return out.Bytes()
}

func TestQwen38ProbeDoesNotBroadenQwen35FourBContract(t *testing.T) {
	driver := LlamaTextDriver{}
	for _, test := range []struct {
		recipe string
		raw    []byte
		accept bool
	}{
		{LlamaQwen38RecipeID, qwen38HeaderForTest(t), true},
		{LlamaQwen35RecipeID, qwen38HeaderForTest(t), false},
		{LlamaQwen38RecipeID, qwen35GGUFHeaderForTest(t), false},
	} {
		probe, err := driver.ProbeModelAsset(ModelAssetFormatProbeInput{RecipeID: test.recipe, RequirementID: MainGGUFRequirementID, RelativePath: "model.gguf", Entry: true}, bytes.NewReader(test.raw), int64(len(test.raw)))
		if test.accept {
			if err != nil || len(probe) == 0 {
				t.Fatalf("27B probe=%s %v", probe, err)
			}
		} else if err == nil {
			t.Fatalf("different model admitted by %s", test.recipe)
		}
	}
	data := qwen38HeaderForTest(t)
	if _, err := driver.ProbeModelAsset(ModelAssetFormatProbeInput{RecipeID: LlamaQwen38RecipeID, RequirementID: MainGGUFRequirementID, RelativePath: "model.gguf", Entry: true}, bytes.NewReader(data[:len(data)-1]), int64(len(data))); err == nil {
		t.Fatal("truncated tensor table admitted")
	}
	if _, reason := driver.ProjectRecipeForHost(LlamaQwen38RecipeID, nil, nil, "darwin/arm64"); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED {
		t.Fatal("unverified platform admitted")
	}
	requirements, reason := driver.ProjectRecipe(LlamaQwen38RecipeID, nil, []string{inputImageFeature})
	if reason != success || len(requirements) != 2 || requirements[1].GetPresence() != runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_OPTIONAL_CONDITIONAL {
		t.Fatal("projector must remain an independent conditional slot")
	}
}

func TestQwen38VisionRequiresTheIndependentExactPair(t *testing.T) {
	main := &runtimev1.ModelAssetExactBinding{VerifiedContentId: Qwen38Q4ContentID, EntrySha256: Qwen38Q4ContentID[len("sha256:"):]}
	projector := &runtimev1.ModelAssetExactBinding{VerifiedContentId: Qwen38BF16ProjectorContentID, EntrySha256: Qwen38BF16ProjectorContentID[len("sha256:"):]}
	if !qwen38VisionPair(main, projector) {
		t.Fatal("exact pair rejected")
	}
	projector.VerifiedContentId = Qwen35Q4ProjectorContentID
	projector.EntrySha256 = Qwen35Q4ProjectorContentID[len("sha256:"):]
	if qwen38VisionPair(main, projector) {
		t.Fatal("4B projector inherited 27B compatibility")
	}
	projector.VerifiedContentId = Qwen38BF16ProjectorContentID
	if qwen38VisionPair(main, projector) {
		t.Fatal("content label replaced entry integrity")
	}
}
