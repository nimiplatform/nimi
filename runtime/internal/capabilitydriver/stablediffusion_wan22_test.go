package capabilitydriver

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestWan22UMT5ProbeReadsTensorTableBeyondFourMiB(t *testing.T) {
	data := append([]byte("GGUF"), 0, 0, 0, 0)
	binary.LittleEndian.PutUint32(data[4:], 3)
	data = binary.LittleEndian.AppendUint64(data, 2)
	data = binary.LittleEndian.AppendUint64(data, 2)
	for _, entry := range []struct{ key, value string }{{"general.architecture", "t5encoder"}} {
		data = appendGGUFProbeString(data, entry.key)
		data = binary.LittleEndian.AppendUint32(data, 8)
		data = appendGGUFProbeString(data, entry.value)
	}
	data = appendGGUFProbeString(data, "tokenizer.padding")
	data = binary.LittleEndian.AppendUint32(data, 9)
	data = binary.LittleEndian.AppendUint32(data, 12)
	data = binary.LittleEndian.AppendUint64(data, (5<<20)/8)
	data = append(data, make([]byte, 5<<20)...)
	for _, tensor := range []struct {
		name  string
		shape []uint64
	}{{"token_embd.weight", []uint64{4096, 256384}}, {"enc.blk.23.attn_q.weight", []uint64{4096, 4096}}} {
		data = appendGGUFProbeString(data, tensor.name)
		data = binary.LittleEndian.AppendUint32(data, uint32(len(tensor.shape)))
		for _, dim := range tensor.shape {
			data = binary.LittleEndian.AppendUint64(data, dim)
		}
		data = binary.LittleEndian.AppendUint32(data, 8)
		data = binary.LittleEndian.AppendUint64(data, 0)
	}
	input := ModelAssetFormatProbeInput{Entry: true, RecipeID: Wan22VideoRecipeID, RequirementID: wan22EncoderSlot, RelativePath: "encoder.gguf"}
	probe, err := (Wan22VideoDriver{}).ProbeModelAsset(input, bytes.NewReader(data), int64(len(data)))
	if err != nil || !wan22ProbeValid(wan22EncoderSlot, probe) {
		t.Fatalf("bounded encoder probe: %v", err)
	}
	input.RequirementID = wan22MainSlot
	if _, err = (Wan22VideoDriver{}).ProbeModelAsset(input, bytes.NewReader(data), int64(len(data))); err == nil {
		t.Fatal("unrelated slot inherited extended metadata budget")
	}
}

func wan22BindingsForTest(root string) []InvocationExactBinding {
	return []InvocationExactBinding{stableDiffusionInvocationBindingForTest(wan22MainSlot, "wan", filepath.Join(root, "main.gguf"), 'a'), stableDiffusionInvocationBindingForTest(wan22EncoderSlot, "umt5", filepath.Join(root, "encoder.gguf"), 'b'), stableDiffusionInvocationBindingForTest(StableDiffusionVideoVAERequirementID, "vae", filepath.Join(root, "vae.safetensors"), 'c')}
}

func TestWan22VideoIndependentSlotsAndExactModelContracts(t *testing.T) {
	d := Wan22VideoDriver{}
	requirements, reason := d.ProjectRecipe(Wan22VideoRecipeID, nil, []string{"input.image"})
	if reason != 0 || len(requirements) != 3 {
		t.Fatalf("projection %v %v", requirements, reason)
	}
	main, _ := json.Marshal(wan22Probe{Schema: "wan22-gguf/v1", Slot: wan22MainSlot, Architecture: "wan", Shapes: map[string][]uint64{"patch_embedding.weight": {2, 2, 1, 48, 3072}, "head.head.weight": {3072, 192}, "text_embedding.0.weight": {4096, 3072}, "blocks.29.self_attn.q.weight": {3072, 3072}}})
	encoder, _ := json.Marshal(wan22Probe{Schema: "wan22-gguf/v1", Slot: wan22EncoderSlot, Architecture: "t5encoder", Shapes: map[string][]uint64{"token_embd.weight": {4096, 256384}, "enc.blk.23.attn_q.weight": {4096, 4096}}})
	header := []byte(`{"decoder.conv1.weight":{"shape":[1024,48,3,3,3]},"encoder.conv1.weight":{"shape":[160,12,3,3,3]},"conv2.weight":{"shape":[48,48,1,1,1]}}`)
	vae := make([]byte, 8)
	binary.LittleEndian.PutUint64(vae, uint64(len(header)))
	vae = append(vae, header...)
	bindings := []*runtimev1.ModelAssetExactBinding{}
	assets := []ModelAssetDescriptor{}
	for i, probe := range [][]byte{main, encoder, vae} {
		slot := wan22Slots[i]
		digest := strings.Repeat(string(rune('a'+i)), 64)
		bindings = append(bindings, &runtimev1.ModelAssetExactBinding{RequirementId: slot.id, ModelAssetId: slot.id, VerifiedContentId: "sha256:" + digest, EntrySha256: digest})
		assets = append(assets, ModelAssetDescriptor{ModelAssetID: slot.id, Kind: slot.assetKind, ArtifactRoles: []string{slot.artifactRole}, VerifiedContentID: "sha256:" + digest, EntrySHA256: digest, FormatProbe: probe})
	}
	if reason = d.ValidateCombination(requirements, bindings, assets); reason != 0 {
		t.Fatal(reason)
	}
	for i, wrong := range [][]byte{[]byte(strings.ReplaceAll(string(main), "48,3072", "16,3072")), []byte(strings.ReplaceAll(string(encoder), "256384", "32128")), append(append([]byte(nil), vae[:8]...), []byte(strings.ReplaceAll(string(header), "48", "16"))...)} {
		bad := append([]ModelAssetDescriptor(nil), assets...)
		bad[i].FormatProbe = wrong
		if d.ValidateCombination(requirements, bindings, bad) == 0 {
			t.Fatalf("incompatible slot %d accepted", i)
		}
	}
	if d.ModelAssetFormatProbeBytes(ModelAssetFormatProbeInput{Entry: true, RecipeID: Wan22VideoRecipeID, RequirementID: wan22EncoderSlot}) != 8<<20 {
		t.Fatal("UMT5 tokenizer table exceeds generic probe")
	}
	if d.ModelAssetFormatProbeBytes(ModelAssetFormatProbeInput{Entry: true, RecipeID: Wan22VideoRecipeID, RequirementID: wan22MainSlot}) != MaxAssetFormatProbeBytes {
		t.Fatal("unrelated slot probe widened")
	}
}

func TestWan22VideoPlanOwnsSilentFrameGridAndFirstImage(t *testing.T) {
	d := Wan22VideoDriver{}
	input := VideoInvocationInput{LoadoutID: "wan-loadout", ExactBindings: wan22BindingsForTest(t.TempDir()), Request: VideoInvocationRequest{Prompt: "a boat"}}
	plan, err := d.PlanVideoInvocation(input)
	if err != nil {
		t.Fatal(err)
	}
	w, h := plan.Size()
	if w != 832 || h != 480 || plan.FrameCount() != 33 || plan.SampleSteps() != 50 || plan.AudioRequired() || plan.AudioVAEPath() != "" || len(plan.ModelFiles()) != 3 {
		t.Fatal("wrong Wan defaults")
	}
	input.Request.DurationSec = 1
	duration, err := d.PlanVideoInvocation(input)
	if err != nil || duration.FrameCount() != 25 {
		t.Fatalf("frame grid %v %v", duration, err)
	}
	input.Request.DurationSec = 0
	input.Request.Inputs = []VideoResolvedInput{{Role: VideoInputRoleReferenceImage, SourceIdentity: "owned-source", ImageBytes: []byte{1, 2, 3}}}
	image, err := d.PlanVideoInvocation(input)
	if err != nil || image.ConditioningMode() != VideoConditioningModeWan22Image || image.ProcessKey() == plan.ProcessKey() {
		t.Fatalf("image plan %v %v", image, err)
	}
	input.Request.Inputs[0].ImageBytes[0] = 9
	ref, _ := image.ReferenceImage()
	if ref.ImageBytes[0] != 1 {
		t.Fatal("mutable source aliased")
	}
	for _, mutate := range []func(*VideoInvocationInput){
		func(i *VideoInvocationInput) { i.Request.GenerateAudio = proto.Bool(true) },
		func(i *VideoInvocationInput) { i.Request.FrameCount = 22 },
		func(i *VideoInvocationInput) { i.Request.Width = 833; i.Request.Height = 480 },
		func(i *VideoInvocationInput) { i.Request.Seed = -1 },
		func(i *VideoInvocationInput) { i.ExactBindings = i.ExactBindings[:2] },
	} {
		bad := input
		bad.Request.Inputs = nil
		mutate(&bad)
		if _, err = d.PlanVideoInvocation(bad); err == nil {
			t.Fatal("invalid Wan request admitted")
		}
	}
}
