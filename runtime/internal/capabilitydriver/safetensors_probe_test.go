package capabilitydriver

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type safetensorsProbeReadCounter struct {
	prefix []byte
	size   int64
	bytes  int64
	reads  int
}

func (r *safetensorsProbeReadCounter) ReadAt(p []byte, offset int64) (int, error) {
	if offset < 0 || offset >= r.size {
		return 0, io.EOF
	}
	n := len(p)
	if int64(n) > r.size-offset {
		n = int(r.size - offset)
	}
	clear(p[:n])
	if offset < int64(len(r.prefix)) {
		copy(p[:n], r.prefix[offset:])
	}
	r.bytes += int64(n)
	r.reads++
	if n != len(p) {
		return n, io.EOF
	}
	return n, nil
}

// Exercise the existing structured-or-bounded-prefix dispatch with a virtual
// large file. The byte counter measures format work, not full hash admission.
func safetensorsDriverProbeForTest(driver Driver, input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if structured, ok := driver.(ModelAssetStructuredProbeDriver); ok {
		return structured.ProbeModelAsset(input, source, size)
	}
	limit := int64(MaxAssetFormatProbeBytes)
	if scoped, ok := driver.(ModelAssetFormatProbeDriver); ok {
		limit = scoped.ModelAssetFormatProbeBytes(input)
	}
	return io.ReadAll(io.LimitReader(io.NewSectionReader(source, 0, size), limit))
}

func qwen3SafetensorsProbeDrivers() []Driver {
	return []Driver{Qwen3TTSDriver{}, Qwen3VoiceCreateDriver{}, Qwen3VoiceLibraryDriver{}, Qwen3ASRDriver{}, Qwen3ASRTransformersDriver{}, Qwen3ASRAlignedDriver{}}
}

func TestSafetensorsStructuredProbeReadCost(t *testing.T) {
	header := safetensorsProbeForTest([]byte(`{"model.weight":{"dtype":"F16","shape":[1],"data_offsets":[0,2]}}`))
	for _, driver := range append(qwen3SafetensorsProbeDrivers(), LocateAnythingDriver{}) {
		t.Run(fmt.Sprintf("%T", driver), func(t *testing.T) {
			source := &safetensorsProbeReadCounter{prefix: header, size: 64 << 20}
			probe, err := safetensorsDriverProbeForTest(driver, ModelAssetFormatProbeInput{RelativePath: "model.safetensors", Entry: true}, source, source.size)
			if err != nil || !bytes.Equal(probe, header) || source.bytes != int64(len(header)) || source.reads != 2 {
				t.Fatalf("format probe read %d bytes in %d reads for %d-byte header: returned=%d, err=%v", source.bytes, source.reads, len(header), len(probe), err)
			}
		})
	}
}

func TestSafetensorsStructuredProbeUnusedFiles(t *testing.T) {
	for _, driver := range append(qwen3SafetensorsProbeDrivers(), LocateAnythingDriver{}) {
		t.Run(fmt.Sprintf("%T", driver), func(t *testing.T) {
			for _, path := range []string{"tokenizer.json", "tokenizer_config.json", "preprocessor_config.json", "vocab.json", "merges.txt"} {
				source := &safetensorsProbeReadCounter{prefix: []byte(`{"ignored":true}`), size: 8 << 20}
				probe, err := safetensorsDriverProbeForTest(driver, ModelAssetFormatProbeInput{RelativePath: path}, source, source.size)
				if err != nil || len(probe) != 0 || source.bytes != 0 {
					t.Fatalf("unused %s: bytes=%d probe=%d err=%v", path, source.bytes, len(probe), err)
				}
			}
		})
	}
	for _, driver := range qwen3SafetensorsProbeDrivers() {
		for _, path := range []string{"config.json", "companion.safetensors"} {
			source := &safetensorsProbeReadCounter{size: 8 << 20}
			probe, err := safetensorsDriverProbeForTest(driver, ModelAssetFormatProbeInput{RelativePath: path}, source, source.size)
			if err != nil || len(probe) != 0 || source.bytes != 0 {
				t.Fatalf("%T unused %s: bytes=%d probe=%d err=%v", driver, path, source.bytes, len(probe), err)
			}
		}
	}
}

func TestSafetensorsStructuredProbeRejectsIncompleteOrInvalidHeaders(t *testing.T) {
	valid := safetensorsProbeForTest([]byte(`{"weight":{"dtype":"F16","shape":[1],"data_offsets":[0,2]}}`))
	withLength := func(length uint64) []byte {
		data := bytes.Clone(valid)
		binary.LittleEndian.PutUint64(data, length)
		return data
	}
	for name, data := range map[string][]byte{
		"short-prefix": valid[:7], "short-header": valid[:len(valid)-1],
		"zero-length": withLength(0), "short-json-length": withLength(1),
		"over-bound": withLength(MaxSafetensorsHeaderBytes + 1), "overflow": withLength(^uint64(0)),
		"bad-json":        safetensorsProbeForTest([]byte(`{"weight":`)),
		"no-tensors":      safetensorsProbeForTest([]byte(`{"__metadata__":{"name":"empty"}}`)),
		"missing-dtype":   safetensorsProbeForTest([]byte(`{"weight":{"shape":[1],"data_offsets":[0,2]}}`)),
		"missing-shape":   safetensorsProbeForTest([]byte(`{"weight":{"dtype":"F16","data_offsets":[0,2]}}`)),
		"negative-offset": safetensorsProbeForTest([]byte(`{"weight":{"dtype":"F16","shape":[1],"data_offsets":[-1,2]}}`)),
		"reversed-offset": safetensorsProbeForTest([]byte(`{"weight":{"dtype":"F16","shape":[1],"data_offsets":[3,2]}}`)),
	} {
		t.Run(name, func(t *testing.T) {
			// A declared size larger than the available header must not conceal
			// a truncated ReaderAt source.
			if probe, err := probeSafetensorsHeader(bytes.NewReader(data), int64(len(data))+64); err == nil || probe != nil {
				t.Fatalf("invalid header accepted: bytes=%d err=%v", len(probe), err)
			}
		})
	}
	for _, size := range []int64{-1, 0, 7, int64(len(valid)) - 1, int64(len(valid)) + 1} {
		if probe, err := probeSafetensorsHeader(bytes.NewReader(valid), size); err == nil || probe != nil {
			t.Fatalf("header/tensor beyond file size %d accepted: %d bytes, %v", size, len(probe), err)
		}
	}
}

type canceledSafetensorsProbeReader struct{ reads int }

func (r *canceledSafetensorsProbeReader) ReadAt(p []byte, offset int64) (int, error) {
	r.reads++
	if offset == 0 {
		binary.LittleEndian.PutUint64(p, 2)
		return len(p), nil
	}
	return 0, context.Canceled
}

func TestSafetensorsStructuredProbePreservesReadCancellation(t *testing.T) {
	source := &canceledSafetensorsProbeReader{}
	if probe, err := probeSafetensorsHeader(source, 12); probe != nil || !errors.Is(err, context.Canceled) || source.reads != 2 {
		t.Fatalf("canceled header read: probe=%v err=%v reads=%d", probe, err, source.reads)
	}
}

func TestSafetensorsStructuredProbeAcceptsMaximumCompleteHeader(t *testing.T) {
	header := []byte(`{"weight":{"dtype":"F16","shape":[1],"data_offsets":[0,2]}}`)
	header = append(header, bytes.Repeat([]byte(" "), MaxSafetensorsHeaderBytes-len(header))...)
	prefix := safetensorsProbeForTest(header)
	source := &safetensorsProbeReadCounter{prefix: prefix, size: int64(len(prefix)) + 2}
	probe, err := probeSafetensorsHeader(source, source.size)
	if err != nil || len(probe) != MaxAssetFormatProbeBytes || source.bytes != MaxAssetFormatProbeBytes || source.reads != 2 {
		t.Fatalf("maximum valid header: len=%d bytes=%d reads=%d err=%v", len(probe), source.bytes, source.reads, err)
	}
}

func TestLocateStructuredProbeReadsWholeConfigAndEveryShard(t *testing.T) {
	driver := LocateAnythingDriver{}
	for _, path := range []string{"config.json", "model.safetensors.index.json"} {
		data := []byte(`{"weight_map":{"weight":"model-2.safetensors"}}`)
		source := &safetensorsProbeReadCounter{prefix: data, size: int64(len(data))}
		probe, err := driver.ProbeModelAsset(ModelAssetFormatProbeInput{RelativePath: path}, source, source.size)
		if err != nil || !bytes.Equal(probe, data) || source.bytes != source.size {
			t.Fatalf("complete %s: read=%d probe=%q err=%v", path, source.bytes, probe, err)
		}
		for _, invalid := range [][]byte{nil, data[:len(data)-1], append(bytes.Clone(data), []byte(`{}`)...)} {
			if _, err := driver.ProbeModelAsset(ModelAssetFormatProbeInput{RelativePath: path}, bytes.NewReader(invalid), int64(len(invalid))); err == nil {
				t.Fatalf("invalid complete %s accepted", path)
			}
		}
		if _, err := driver.ProbeModelAsset(ModelAssetFormatProbeInput{RelativePath: path}, bytes.NewReader(data), int64(len(data))+1); err == nil {
			t.Fatalf("truncated %s accepted", path)
		}
		if _, err := driver.ProbeModelAsset(ModelAssetFormatProbeInput{RelativePath: path}, bytes.NewReader(data), MaxAssetFormatProbeBytes+1); err == nil {
			t.Fatalf("oversized %s accepted", path)
		}
	}
	header := safetensorsProbeForTest([]byte(`{"weight":{"dtype":"F16","shape":[1],"data_offsets":[0,2]}}`))
	source := &safetensorsProbeReadCounter{prefix: header, size: 64 << 20}
	probe, err := driver.ProbeModelAsset(ModelAssetFormatProbeInput{RelativePath: "model-2.safetensors"}, source, source.size)
	if err != nil || !bytes.Equal(probe, header) || source.bytes != int64(len(header)) {
		t.Fatalf("non-entry shard was not fully checked: bytes=%d err=%v", source.bytes, err)
	}
}

func TestLocateStructuredProbeKeepsTensorGroupsAndShardIndexValidation(t *testing.T) {
	driver := LocateAnythingDriver{}
	requirements, reason := driver.ProjectRecipeForHost(LocateAnythingRecipeID, nil, nil, "windows/amd64")
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal(reason)
	}
	headers := map[string][]byte{
		"model-1.safetensors": safetensorsProbeForTest([]byte(`{"language_model.weight":{"dtype":"F16","shape":[1],"data_offsets":[0,2]}}`)),
		"model-2.safetensors": safetensorsProbeForTest([]byte(`{"vision_model.weight":{"dtype":"F16","shape":[1],"data_offsets":[0,2]},"mlp1.weight":{"dtype":"F16","shape":[1],"data_offsets":[2,4]}}`)),
	}
	files := []ModelAssetFileFact{}
	for path, header := range headers {
		probe, err := driver.ProbeModelAsset(ModelAssetFormatProbeInput{RelativePath: path}, bytes.NewReader(header), int64(len(header))+4)
		if err != nil {
			t.Fatal(err)
		}
		files = append(files, ModelAssetFileFact{RelativePath: path, SizeBytes: int64(len(header)) + 4, FormatProbe: probe})
	}
	for path, body := range map[string]string{
		"config.json":                  `{"model_type":"locateanything","architectures":["LocateAnythingForConditionalGeneration"],"text_config":{"hidden_size":2048,"vocab_size":152681},"vision_config":{"hidden_size":1152,"patch_size":14}}`,
		"model.safetensors.index.json": `{"weight_map":{"language_model.weight":"model-1.safetensors","vision_model.weight":"model-2.safetensors","mlp1.weight":"model-2.safetensors"}}`,
		"tokenizer.json":               `{}`, "tokenizer_config.json": `{}`, "preprocessor_config.json": `{}`,
	} {
		probe, err := driver.ProbeModelAsset(ModelAssetFormatProbeInput{RelativePath: path}, strings.NewReader(body), int64(len(body)))
		if err != nil {
			t.Fatal(err)
		}
		files = append(files, ModelAssetFileFact{RelativePath: path, SizeBytes: int64(len(body)), FormatProbe: probe})
	}
	digest := strings.Repeat("a", 64)
	input := ModelAssetBindingInput{RecipeID: LocateAnythingRecipeID, Requirement: requirements[0], Files: files,
		Binding: &runtimev1.ModelAssetExactBinding{RequirementId: LocateAnythingModelSlot, ModelAssetId: "test", VerifiedContentId: "sha256:" + digest, EntrySha256: digest}}
	input.Entry, _ = modelAssetFileFact(input, "model-1.safetensors")
	if _, reason := driver.ProjectModelAssetBinding(input); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatalf("complete shards rejected: %v", reason)
	}
	for i := range input.Files {
		if input.Files[i].RelativePath != "model-2.safetensors" {
			continue
		}
		original := input.Files[i].FormatProbe
		input.Files[i].FormatProbe = safetensorsProbeForTest([]byte(`{"wrong.weight":{"dtype":"F16","shape":[1],"data_offsets":[0,2]}}`))
		if _, reason := driver.ProjectModelAssetBinding(input); reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			t.Fatal("wrong tensor groups and index targets accepted")
		}
		input.Files[i].FormatProbe = original
	}
	for i := range input.Files {
		if input.Files[i].RelativePath == "model.safetensors.index.json" {
			input.Files[i].FormatProbe = []byte(`{"weight_map":{"language_model.weight":"missing.safetensors"}}`)
		}
	}
	if _, reason := driver.ProjectModelAssetBinding(input); reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal("index referencing an undeclared shard accepted")
	}
}
