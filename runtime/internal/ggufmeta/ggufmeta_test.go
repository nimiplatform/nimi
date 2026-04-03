package ggufmeta

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestInspectPathReadsMetadataEntries(t *testing.T) {
	path := filepath.Join(t.TempDir(), "model.gguf")
	payload := buildTestGGUF(t,
		[]string{"token_embd.weight"},
		metadataKV{Key: "general.architecture", Type: ValueTypeString, String: "qwen"},
		metadataKV{Key: "general.name", Type: ValueTypeString, String: "Qwen"},
		metadataKV{Key: "sd.version", Type: ValueTypeString, String: "sdxl"},
		metadataKV{Key: "tokenizer.chat_template", Type: ValueTypeArray, ArrayType: ValueTypeString, ArrayStrings: []string{"a", "b"}},
	)
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatalf("write gguf fixture: %v", err)
	}

	summary, err := InspectPath(path)
	if err != nil {
		t.Fatalf("InspectPath: %v", err)
	}
	if summary.Magic != magicHeader {
		t.Fatalf("magic = %q", summary.Magic)
	}
	if summary.Version != 3 {
		t.Fatalf("version = %d", summary.Version)
	}
	if summary.TensorCount != 1 {
		t.Fatalf("tensor_count = %d", summary.TensorCount)
	}
	if summary.KVCount != 4 {
		t.Fatalf("kv_count = %d", summary.KVCount)
	}
	if got, want := summary.Keys(), []string{"general.architecture", "general.name", "sd.version", "tokenizer.chat_template"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("keys = %#v want %#v", got, want)
	}
	if value, ok := summary.StringValue("general.name"); !ok || value != "Qwen" {
		t.Fatalf("general.name = %q ok=%v", value, ok)
	}
	if issue := StableDiffusionMetadataIssue(summary); issue != "" {
		t.Fatalf("unexpected metadata issue: %q", issue)
	}
	if got, want := StableDiffusionIdentityKeysPresent(summary), []string{"general.architecture", "general.name", "sd.version"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("identity keys = %#v want %#v", got, want)
	}
	if got, want := StableDiffusionVersionKeysPresent(summary), []string{"sd.version"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("version keys = %#v want %#v", got, want)
	}
	if got := StableDiffusionDetectedFamily(summary); got != "metadata-versioned" {
		t.Fatalf("detected family = %q", got)
	}
}

func TestStableDiffusionMetadataIssueReportsZeroKV(t *testing.T) {
	path := filepath.Join(t.TempDir(), "image.gguf")
	if err := os.WriteFile(path, buildTestGGUF(t, []string{"random.weight"}), 0o600); err != nil {
		t.Fatalf("write gguf fixture: %v", err)
	}

	summary, err := InspectPath(path)
	if err != nil {
		t.Fatalf("InspectPath: %v", err)
	}
	if summary.KVCount != 0 {
		t.Fatalf("kv_count = %d", summary.KVCount)
	}
	if got := StableDiffusionMetadataIssue(summary); got == "" {
		t.Fatal("expected stable diffusion metadata issue for zero-kv gguf")
	}
}

func TestStableDiffusionMetadataIssueAcceptsZImageTensorSignatureWithoutVersionKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "lumina2.gguf")
	payload := buildTestGGUF(t,
		[]string{"cap_embedder.0.weight"},
		metadataKV{Key: "general.architecture", Type: ValueTypeString, String: "lumina2"},
		metadataKV{Key: "general.quantization_version", Type: ValueTypeUint32, Uint32: 2},
		metadataKV{Key: "general.file_type", Type: ValueTypeUint32, Uint32: 15},
	)
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatalf("write gguf fixture: %v", err)
	}

	summary, err := InspectPath(path)
	if err != nil {
		t.Fatalf("InspectPath: %v", err)
	}
	if got := StableDiffusionMetadataIssue(summary); got != "" {
		t.Fatalf("unexpected stable diffusion metadata issue: %q", got)
	}
	if got, want := StableDiffusionTensorSignaturesPresent(summary), []string{"z-image:cap_embedder.0.weight"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("tensor signatures = %#v want %#v", got, want)
	}
	if got := StableDiffusionDetectedFamily(summary); got != "z-image" {
		t.Fatalf("detected family = %q", got)
	}
}

type metadataKV struct {
	Key          string
	Type         ValueType
	String       string
	Uint32       uint32
	ArrayType    ValueType
	ArrayStrings []string
}

func buildTestGGUF(t *testing.T, tensorNames []string, entries ...metadataKV) []byte {
	t.Helper()
	var buf bytes.Buffer
	buf.WriteString(magicHeader)
	mustBinaryWrite(t, &buf, uint32(3))
	mustBinaryWrite(t, &buf, uint64(len(tensorNames)))
	mustBinaryWrite(t, &buf, uint64(len(entries)))
	for _, entry := range entries {
		writeTestString(t, &buf, entry.Key)
		mustBinaryWrite(t, &buf, uint32(entry.Type))
		switch entry.Type {
		case ValueTypeString:
			writeTestString(t, &buf, entry.String)
		case ValueTypeUint32:
			mustBinaryWrite(t, &buf, entry.Uint32)
		case ValueTypeArray:
			mustBinaryWrite(t, &buf, uint32(entry.ArrayType))
			mustBinaryWrite(t, &buf, uint64(len(entry.ArrayStrings)))
			for _, item := range entry.ArrayStrings {
				writeTestString(t, &buf, item)
			}
		default:
			t.Fatalf("unsupported test metadata type %d", entry.Type)
		}
	}
	for idx, name := range tensorNames {
		writeTestString(t, &buf, name)
		mustBinaryWrite(t, &buf, uint32(1))
		mustBinaryWrite(t, &buf, uint64(idx+1))
		mustBinaryWrite(t, &buf, uint32(0))
		mustBinaryWrite(t, &buf, uint64(0))
	}
	return buf.Bytes()
}

func writeTestString(t *testing.T, buf *bytes.Buffer, value string) {
	t.Helper()
	mustBinaryWrite(t, buf, uint64(len(value)))
	if _, err := buf.WriteString(value); err != nil {
		t.Fatalf("write string %q: %v", value, err)
	}
}

func mustBinaryWrite(t *testing.T, buf *bytes.Buffer, value any) {
	t.Helper()
	if err := binary.Write(buf, binary.LittleEndian, value); err != nil {
		t.Fatalf("binary.Write(%T): %v", value, err)
	}
}
