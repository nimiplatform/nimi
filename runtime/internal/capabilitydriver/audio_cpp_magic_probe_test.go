package capabilitydriver

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func magicOnlyAudioDriversForTest() []struct {
	name         string
	driver       Driver
	recipe, slot string
} {
	return []struct {
		name         string
		driver       Driver
		recipe, slot string
	}{
		{"minimax-music3", MiniMaxMusic3AudioCppDriver{}, MiniMaxMusic3RecipeID, MiniMaxMusic3RequirementID},
		{"htdemucs", HTDemucsAudioCppDriver{}, HTDemucsRecipeID, HTDemucsModelRequirementID},
		{"yue2", YuE2AudioCppDriver{}, YuE2RecipeID, YuE2RequirementID},
		{"sheetsage2", SheetSage2AudioCppDriver{}, SheetSage2RecipeID, SheetSage2RequirementID},
		{"vevo2", VeVo2AudioCppDriver{}, VeVo2RecipeID, VeVo2RequirementID},
		{"qwen3-tts-audio-cpp", Qwen3TTSAudioCppDriver{}, Qwen3TTSAudioCppRecipeID, Qwen3TTSAudioCppModelRequirementID},
	}
}

func TestMagicOnlyAudioProbeConsumesOnlyItsExistingFourByteContract(t *testing.T) {
	data := make([]byte, 8<<20)
	copy(data, "GGUF")
	for _, tc := range magicOnlyAudioDriversForTest() {
		t.Run(tc.name, func(t *testing.T) {
			reader := &countedONNXReader{source: bytes.NewReader(data)}
			probe, err := readDriverProbeForTest(tc.driver, ModelAssetFormatProbeInput{RecipeID: tc.recipe, RequirementID: tc.slot, RelativePath: "model.gguf", Entry: true}, reader, int64(len(data)))
			if err != nil || !musicGGUFProbe(probe) {
				t.Fatalf("existing magic contract changed: %v", err)
			}
			if reader.readBytes != 4 || len(probe) != 4 {
				t.Fatalf("probe consumed %d bytes/output=%d for four-byte contract", reader.readBytes, len(probe))
			}
			for _, invalid := range [][]byte{nil, []byte("G"), []byte("GGU"), []byte("gguf"), []byte("NOPE extra bytes")} {
				probe, err := readDriverProbeForTest(tc.driver, ModelAssetFormatProbeInput{RecipeID: tc.recipe, RequirementID: tc.slot, RelativePath: "model.gguf", Entry: true}, bytes.NewReader(invalid), int64(len(invalid)))
				if err == nil && musicGGUFProbe(probe) {
					t.Fatal("short/wrong-magic input admitted")
				}
			}
		})
	}
}

func TestMagicOnlyProbeBudgetDoesNotSpreadToMetadataSpeechDrivers(t *testing.T) {
	for _, driver := range []Driver{AudioCppTTSDriver{}, AudioCppASRDriver{}, AudioCppReferenceVoiceDriver{}} {
		if scoped, ok := driver.(ModelAssetFormatProbeDriver); ok && scoped.ModelAssetFormatProbeBytes(ModelAssetFormatProbeInput{Entry: true}) == 4 {
			t.Fatal("family/name metadata Driver inherited a magic-only budget")
		}
	}
}

func BenchmarkMiniMaxMagicProbeReader(b *testing.B) {
	data := make([]byte, 8<<20)
	copy(data, "GGUF")
	name := filepath.Join(b.TempDir(), "model.gguf")
	if err := os.WriteFile(name, data, 0600); err != nil {
		b.Fatal(err)
	}
	file, err := os.Open(name)
	if err != nil {
		b.Fatal(err)
	}
	defer file.Close()
	reader := &countedONNXReader{source: file}
	input := ModelAssetFormatProbeInput{RecipeID: MiniMaxMusic3RecipeID, RequirementID: MiniMaxMusic3RequirementID, RelativePath: "language_model_q4_0.gguf", Entry: true}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		probe, err := readDriverProbeForTest(MiniMaxMusic3AudioCppDriver{}, input, reader, int64(len(data)))
		if err != nil || !musicGGUFProbe(probe) {
			b.Fatalf("probe: %v", err)
		}
	}
	b.ReportMetric(float64(reader.reads)/float64(b.N), "read-at-ops/op")
	b.ReportMetric(float64(reader.readBytes)/float64(b.N), "read-at-bytes/op")
}
