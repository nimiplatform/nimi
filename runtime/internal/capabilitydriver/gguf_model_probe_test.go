package capabilitydriver

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
)

// This test harness follows the actual owner dispatch: structured Drivers use
// their reader, all other Drivers keep the still-supported bounded prefix API.
func readDriverProbeForTest(driver Driver, input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if structured, ok := driver.(ModelAssetStructuredProbeDriver); ok {
		return structured.ProbeModelAsset(input, source, size)
	}
	limit := int64(MaxAssetFormatProbeBytes)
	if scoped, ok := driver.(ModelAssetFormatProbeDriver); ok {
		limit = scoped.ModelAssetFormatProbeBytes(input)
	}
	return io.ReadAll(io.NewSectionReader(source, 0, min(size, limit)))
}

func projectLlamaBindingForTest(driver Driver, input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	raw := input.Entry.FormatProbe
	probe, err := readDriverProbeForTest(driver, ModelAssetFormatProbeInput{
		RecipeID: input.RecipeID, RequirementID: input.Requirement.GetRequirementId(), RelativePath: input.Entry.RelativePath, Entry: true,
	}, bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	input.Entry.FormatProbe = probe
	return driver.ProjectModelAssetBinding(input)
}

func appendGGUFProbeString(data []byte, value string) []byte {
	data = binary.LittleEndian.AppendUint64(data, uint64(len(value)))
	return append(data, value...)
}

func demandGGUFFixture(embedding, late bool) ([]byte, int) {
	architecture := "gemma4"
	if embedding {
		architecture = "bert"
	}
	entries := uint64(3)
	if embedding {
		entries = 4
	}
	if late {
		entries++
	}
	data := append([]byte(nil), "GGUF"...)
	data = binary.LittleEndian.AppendUint32(data, 3)
	data = binary.LittleEndian.AppendUint64(data, 0)
	data = binary.LittleEndian.AppendUint64(data, entries)
	stringEntry := func(key, value string) {
		data = appendGGUFProbeString(data, key)
		data = binary.LittleEndian.AppendUint32(data, uint32(ggufmeta.ValueTypeString))
		data = appendGGUFProbeString(data, value)
	}
	integerEntry := func(key string, value uint32) {
		data = appendGGUFProbeString(data, key)
		data = binary.LittleEndian.AppendUint32(data, uint32(ggufmeta.ValueTypeUint32))
		data = binary.LittleEndian.AppendUint32(data, value)
	}
	stringEntry("general.architecture", architecture)
	integerEntry(architecture+".context_length", 8192)
	if late {
		data = appendGGUFProbeString(data, "tokenizer.ggml.tokens")
		data = binary.LittleEndian.AppendUint32(data, uint32(ggufmeta.ValueTypeArray))
		data = binary.LittleEndian.AppendUint32(data, uint32(ggufmeta.ValueTypeString))
		data = binary.LittleEndian.AppendUint64(data, 65536)
		for i := 0; i < 65536; i++ {
			data = appendGGUFProbeString(data, "sixteen-byteword!")
		}
	}
	if embedding {
		integerEntry("bert.embedding_length", 768)
		integerEntry("bert.pooling_type", 1)
	} else {
		stringEntry("tokenizer.chat_template", "{{ messages }}")
	}
	metadataEnd := len(data)
	return append(data, make([]byte, (20<<20)-len(data))...), metadataEnd
}

func demandBindingInput(embedding bool, size int, probe []byte) (Driver, ModelAssetBindingInput) {
	var driver Driver = LlamaTextDriver{}
	recipe, slot := LlamaGemma4RecipeID, MainGGUFRequirementID
	if embedding {
		driver, recipe, slot = LlamaEmbedDriver{}, LlamaEmbedGGUFRecipeID, EmbeddingGGUFRequirementID
	}
	return driver, ModelAssetBindingInput{
		RecipeID: recipe, Requirement: &runtimev1.LocalCapabilityRequirement{RequirementId: slot},
		Binding: &runtimev1.ModelAssetExactBinding{RequirementId: slot, ModelAssetId: "fixture", VerifiedContentId: "sha256:" + strings.Repeat("a", 64), EntrySha256: strings.Repeat("b", 64)},
		Entry:   ModelAssetFileFact{RelativePath: "model.gguf", SizeBytes: int64(size), FormatProbe: probe},
	}
}

func TestLlamaGGUFProbeReadsOnlyNecessaryBytes(t *testing.T) {
	for _, embedding := range []bool{false, true} {
		for _, late := range []bool{false, true} {
			data, metadataEnd := demandGGUFFixture(embedding, late)
			driver, input := demandBindingInput(embedding, len(data), nil)
			reader := &countedONNXReader{source: bytes.NewReader(data)}
			probe, err := readDriverProbeForTest(driver, ModelAssetFormatProbeInput{RecipeID: input.RecipeID, RequirementID: input.Requirement.GetRequirementId(), RelativePath: input.Entry.RelativePath, Entry: true}, reader, int64(len(data)))
			if err != nil {
				t.Fatal(err)
			}
			input.Entry.FormatProbe = probe
			projection, reason := driver.ProjectModelAssetBinding(input)
			if reason != success || projection.ModelContextWindowTokens != 8192 || (embedding && projection.EmbeddingDimension != 768) || (!embedding && projection.TemplateIdentity == "") {
				t.Fatalf("embedding=%v late=%v lost facts: %+v / %v", embedding, late, projection, reason)
			}
			if reader.readBytes > int64(metadataEnd)+(128<<10) {
				t.Fatalf("embedding=%v late=%v read=%d metadataEnd=%d ops=%d", embedding, late, reader.readBytes, metadataEnd, reader.reads)
			}
		}
	}
}

func TestLlamaGGUFProbeSeparatesPhysicalShortSourceFromBoundedEOF(t *testing.T) {
	raw := boundedLLMGGUFProbeWithTruncatedTokenizer(t, "gemma4", 8192)
	driver := LlamaTextDriver{}
	input := ModelAssetFormatProbeInput{RecipeID: LlamaGemma4RecipeID, RequirementID: MainGGUFRequirementID, RelativePath: "model.gguf", Entry: true}
	// This exact finite prefix retains the established optional-template
	// behavior, rather than applying the strict embedding/tensor policy to it.
	probe, err := driver.ProbeModelAsset(input, bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	var facts llamaGGUFProbe
	if err := json.Unmarshal(probe, &facts); err != nil || facts.ContextWindow != 8192 || facts.TemplateIdentity != "" {
		t.Fatalf("bounded facts: %+v err=%v", facts, err)
	}
	// The same bytes cannot claim a larger actual source. In particular a
	// skipped tokenizer range cannot be accepted solely from the supplied size.
	if _, err := driver.ProbeModelAsset(input, bytes.NewReader(raw), MaxDriverAssetFormatProbeBytes); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("physical truncation hidden as optional metadata: %v", err)
	}
	reader, err := newGGUFProbeReader(bytes.NewReader(raw), MaxDriverAssetFormatProbeBytes, MaxDriverAssetFormatProbeBytes)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reader.Seek(int64(len(raw))+1, io.SeekStart); err == nil {
		t.Fatal("forward skip accepted an absent byte")
	}
	if reader.position != 0 {
		t.Fatal("failed forward skip changed position")
	}
}

func TestLlamaGGUFProbeKeepsOriginalScanLimitAndCancellation(t *testing.T) {
	var raw bytes.Buffer
	raw.WriteString("GGUF")
	mustWriteLlamaProbeValue(t, &raw, uint32(3))
	mustWriteLlamaProbeValue(t, &raw, uint64(0))
	mustWriteLlamaProbeValue(t, &raw, uint64(4))
	writeLlamaProbeString(t, &raw, "general.architecture")
	mustWriteLlamaProbeValue(t, &raw, uint32(ggufmeta.ValueTypeString))
	writeLlamaProbeString(t, &raw, "gemma4")
	writeLlamaProbeString(t, &raw, "gemma4.context_length")
	mustWriteLlamaProbeValue(t, &raw, uint32(ggufmeta.ValueTypeUint32))
	mustWriteLlamaProbeValue(t, &raw, uint32(8192))
	writeLlamaProbeString(t, &raw, "ignored.padding")
	mustWriteLlamaProbeValue(t, &raw, uint32(ggufmeta.ValueTypeArray))
	mustWriteLlamaProbeValue(t, &raw, uint32(ggufmeta.ValueTypeUint8))
	mustWriteLlamaProbeValue(t, &raw, uint64(MaxDriverAssetFormatProbeBytes))
	raw.Write(make([]byte, MaxDriverAssetFormatProbeBytes))
	writeLlamaProbeString(t, &raw, "tokenizer.chat_template")
	mustWriteLlamaProbeValue(t, &raw, uint32(ggufmeta.ValueTypeString))
	writeLlamaProbeString(t, &raw, "must remain outside the admitted scan")
	input := ModelAssetFormatProbeInput{RecipeID: LlamaGemma4RecipeID, RequirementID: MainGGUFRequirementID, RelativePath: "model.gguf", Entry: true}
	probe, err := (LlamaTextDriver{}).ProbeModelAsset(input, bytes.NewReader(raw.Bytes()), int64(raw.Len()))
	if err != nil {
		t.Fatal(err)
	}
	var facts llamaGGUFProbe
	if err := json.Unmarshal(probe, &facts); err != nil || facts.ContextWindow != 8192 || facts.TemplateIdentity != "" {
		t.Fatalf("scan crossed former prefix bound: %+v err=%v", facts, err)
	}
	data, _ := demandGGUFFixture(false, true)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	source := &countedONNXReader{source: bytes.NewReader(data), ctx: ctx}
	source.afterRead = func() {
		if source.reads == 2 {
			cancel()
		}
	}
	if _, err := (LlamaTextDriver{}).ProbeModelAsset(input, source, int64(len(data))); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled late metadata became base facts: %v", err)
	}
}

func TestLlamaGGUFBindingAcceptsOnlyItsStructuredContract(t *testing.T) {
	data, _ := demandGGUFFixture(false, false)
	driver, input := demandBindingInput(false, len(data), data[:1024])
	if _, reason := driver.ProjectModelAssetBinding(input); reason == success {
		t.Fatal("legacy raw prefix accepted by structured Driver")
	}
	probe, err := driver.(ModelAssetStructuredProbeDriver).ProbeModelAsset(ModelAssetFormatProbeInput{RecipeID: input.RecipeID, RequirementID: input.Requirement.GetRequirementId(), RelativePath: input.Entry.RelativePath, Entry: true}, bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	input.Entry.FormatProbe = probe
	if _, reason := driver.ProjectModelAssetBinding(input); reason != success {
		t.Fatal(reason)
	}
	input.RecipeID = LlamaQwen35RecipeID
	if _, reason := driver.ProjectModelAssetBinding(input); reason == success {
		t.Fatal("Gemma facts reused as Qwen Model Contract")
	}
	input.RecipeID = LlamaGemma4RecipeID
	input.Binding.EntrySha256 = ""
	if _, reason := driver.ProjectModelAssetBinding(input); reason == success {
		t.Fatal("structured metadata replaced exact binding verification")
	}
}

func BenchmarkLlamaGGUFProjectionReader(b *testing.B) {
	for _, tc := range []struct {
		name            string
		embedding, late bool
	}{{"gemma-early", false, false}, {"gemma-late-template", false, true}, {"embedding-complete", true, true}} {
		b.Run(tc.name, func(b *testing.B) {
			data, _ := demandGGUFFixture(tc.embedding, tc.late)
			name := filepath.Join(b.TempDir(), "metadata.gguf")
			if err := os.WriteFile(name, data, 0600); err != nil {
				b.Fatal(err)
			}
			file, err := os.Open(name)
			if err != nil {
				b.Fatal(err)
			}
			defer file.Close()
			reader := &countedONNXReader{source: file}
			driver, input := demandBindingInput(tc.embedding, len(data), nil)
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				probe, err := readDriverProbeForTest(driver, ModelAssetFormatProbeInput{RecipeID: input.RecipeID, RequirementID: input.Requirement.GetRequirementId(), RelativePath: input.Entry.RelativePath, Entry: true}, reader, int64(len(data)))
				if err != nil {
					b.Fatal(err)
				}
				input.Entry.FormatProbe = probe
				projection, reason := driver.ProjectModelAssetBinding(input)
				if reason != success || projection.ModelContextWindowTokens != 8192 {
					b.Fatalf("projection: %+v / %v", projection, reason)
				}
			}
			b.ReportMetric(float64(reader.reads)/float64(b.N), "read-at-ops/op")
			b.ReportMetric(float64(reader.readBytes)/float64(b.N), "read-at-bytes/op")
		})
	}
}
