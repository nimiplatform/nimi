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

func TestStableDiffusionMetadataIssueAcceptsIdeogram4TensorSignatureWithoutMetadata(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ideogram4.gguf")
	payload := buildTestGGUF(t,
		[]string{
			"embed_image_indicator.weight",
			"llm_cond_proj.weight",
			"final_layer.adaln_modulation.weight",
		},
	)
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatalf("write gguf fixture: %v", err)
	}

	summary, err := InspectPath(path)
	if err != nil {
		t.Fatalf("InspectPath: %v", err)
	}
	if summary.KVCount != 0 {
		t.Fatalf("kv_count = %d", summary.KVCount)
	}
	if got := StableDiffusionMetadataIssue(summary); got != "" {
		t.Fatalf("unexpected stable diffusion metadata issue: %q", got)
	}
	if got, want := StableDiffusionTensorSignaturesPresent(summary), []string{"ideogram4:llm_cond_proj.weight"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("tensor signatures = %#v want %#v", got, want)
	}
	if got := StableDiffusionDetectedFamily(summary); got != "ideogram4" {
		t.Fatalf("detected family = %q", got)
	}
}

func TestStableDiffusionDetectedFamilyFlux(t *testing.T) {
	path := filepath.Join(t.TempDir(), "flux.gguf")
	payload := buildTestGGUF(t,
		[]string{"double_blocks.0.img_mod.lin.weight"},
		metadataKV{Key: "general.architecture", Type: ValueTypeString, String: "flux"},
	)
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatalf("write gguf fixture: %v", err)
	}

	summary, err := InspectPath(path)
	if err != nil {
		t.Fatalf("InspectPath: %v", err)
	}
	if got := StableDiffusionDetectedFamily(summary); got != "flux" {
		t.Fatalf("detected family = %q, want %q", got, "flux")
	}
	if got, want := StableDiffusionTensorSignaturesPresent(summary), []string{"flux:double_blocks.0.img_mod.lin.weight"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("tensor signatures = %#v want %#v", got, want)
	}
	if got := StableDiffusionMetadataIssue(summary); got != "" {
		t.Fatalf("unexpected metadata issue: %q", got)
	}
}

func TestStableDiffusionDetectedFamilyChroma(t *testing.T) {
	path := filepath.Join(t.TempDir(), "chroma.gguf")
	payload := buildTestGGUF(t,
		[]string{"distilled_guidance_layer.in_proj.weight"},
		metadataKV{Key: "general.architecture", Type: ValueTypeString, String: "chroma"},
	)
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatalf("write gguf fixture: %v", err)
	}

	summary, err := InspectPath(path)
	if err != nil {
		t.Fatalf("InspectPath: %v", err)
	}
	if got := StableDiffusionDetectedFamily(summary); got != "chroma" {
		t.Fatalf("detected family = %q, want %q", got, "chroma")
	}
	if got, want := StableDiffusionTensorSignaturesPresent(summary), []string{"chroma:distilled_guidance_layer.in_proj.weight"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("tensor signatures = %#v want %#v", got, want)
	}
}

func TestStableDiffusionDetectedFamilyFluxNotMatchedAsOvis(t *testing.T) {
	path := filepath.Join(t.TempDir(), "flux-only.gguf")
	payload := buildTestGGUF(t,
		[]string{"double_blocks.0.img_mod.lin.weight"},
	)
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatalf("write gguf fixture: %v", err)
	}

	summary, err := InspectPath(path)
	if err != nil {
		t.Fatalf("InspectPath: %v", err)
	}
	if got := StableDiffusionDetectedFamily(summary); got != "flux" {
		t.Fatalf("detected family = %q, want %q (should not match ovis-image)", got, "flux")
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

func TestLLMDetectedArchitecturePresent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gemma4.gguf")
	payload := buildTestGGUF(t,
		[]string{"token_embd.weight"},
		metadataKV{Key: "general.architecture", Type: ValueTypeString, String: "gemma4"},
	)
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatalf("write gguf fixture: %v", err)
	}
	summary, err := InspectPath(path)
	if err != nil {
		t.Fatalf("InspectPath: %v", err)
	}
	if got := LLMDetectedArchitecture(summary); got != "gemma4" {
		t.Fatalf("LLMDetectedArchitecture = %q, want %q", got, "gemma4")
	}
}

func TestLLMDetectedArchitectureMissing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "noarch.gguf")
	payload := buildTestGGUF(t,
		[]string{"token_embd.weight"},
		metadataKV{Key: "general.name", Type: ValueTypeString, String: "test"},
	)
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatalf("write gguf fixture: %v", err)
	}
	summary, err := InspectPath(path)
	if err != nil {
		t.Fatalf("InspectPath: %v", err)
	}
	if got := LLMDetectedArchitecture(summary); got != "" {
		t.Fatalf("LLMDetectedArchitecture = %q, want empty", got)
	}
}

func TestLLMContextLengthUsesDetectedArchitectureNumericMetadata(t *testing.T) {
	payload := buildTestGGUF(t,
		[]string{"token_embd.weight"},
		metadataKV{Key: "general.architecture", Type: ValueTypeString, String: "gemma4"},
		metadataKV{Key: "gemma4.context_length", Type: ValueTypeUint32, Uint32: 262144},
	)
	summary, err := Inspect(bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}
	if got, ok := LLMContextLength(summary); !ok || got != 262144 {
		t.Fatalf("LLMContextLength = %d ok=%v, want 262144", got, ok)
	}
}

func TestInspectMetadataReturnsExactCanonicalIdentity(t *testing.T) {
	payload := buildTestGGUF(t,
		nil,
		metadataKV{Key: "general.architecture", Type: ValueTypeString, String: "gemma4"},
		metadataKV{Key: "gemma4.context_length", Type: ValueTypeUint32, Uint32: 262144},
		metadataKV{Key: "tokenizer.chat_template", Type: ValueTypeString, String: "{{ messages }}"},
	)
	summary, err := InspectMetadata(bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("InspectMetadata: %v", err)
	}
	if got, ok := LLMChatTemplateIdentity(summary); !ok || got != "sha256:f24189f08c85a1eb19a737306c3a13e85462ee33d964f28108d64a2485fa2171" {
		t.Fatalf("LLMChatTemplateIdentity = %q ok=%v", got, ok)
	}
}

func TestInspectMetadataRejectsTruncatedLateTokenizerArray(t *testing.T) {
	prefix := buildTestGGUF(t, nil,
		metadataKV{Key: "general.architecture", Type: ValueTypeString, String: "gemma4"},
		metadataKV{Key: "gemma4.context_length", Type: ValueTypeUint32, Uint32: 262144},
	)
	binary.LittleEndian.PutUint64(prefix[16:24], 3)
	var truncated bytes.Buffer
	writeTestString(t, &truncated, "tokenizer.ggml.tokens")
	mustBinaryWrite(t, &truncated, uint32(ValueTypeArray))
	mustBinaryWrite(t, &truncated, uint32(ValueTypeString))
	mustBinaryWrite(t, &truncated, uint64(1<<30))
	prefix = append(prefix, truncated.Bytes()...)

	if _, err := InspectMetadata(bytes.NewReader(prefix)); err == nil {
		t.Fatal("InspectMetadata accepted truncated tokenizer array")
	}
}

func TestInspectLLMMetadataStopsBeforeTruncatedLargeLaterMetadata(t *testing.T) {
	prefix := buildTestGGUF(t, nil,
		metadataKV{Key: "general.architecture", Type: ValueTypeString, String: "gemma4"},
		metadataKV{Key: "gemma4.context_length", Type: ValueTypeUint32, Uint32: 262144},
	)
	// Declare one additional tokenizer array whose payload is outside the
	// bounded prefix. LLM identity parsing must not traverse it after both
	// execution facts have already been read.
	binary.LittleEndian.PutUint64(prefix[16:24], 3)
	var truncated bytes.Buffer
	writeTestString(t, &truncated, "tokenizer.ggml.tokens")
	mustBinaryWrite(t, &truncated, uint32(ValueTypeArray))
	mustBinaryWrite(t, &truncated, uint32(ValueTypeString))
	mustBinaryWrite(t, &truncated, uint64(1<<30))
	prefix = append(prefix, truncated.Bytes()...)

	summary, err := InspectLLMMetadata(bytes.NewReader(prefix))
	if err != nil {
		t.Fatalf("InspectLLMMetadata: %v", err)
	}
	if got := LLMDetectedArchitecture(summary); got != "gemma4" {
		t.Fatalf("LLMDetectedArchitecture = %q, want gemma4", got)
	}
	if got, ok := LLMContextLength(summary); !ok || got != 262144 {
		t.Fatalf("LLMContextLength = %d ok=%v, want 262144", got, ok)
	}
	if _, err := Inspect(bytes.NewReader(prefix)); err == nil {
		t.Fatal("full GGUF inspection unexpectedly accepted the truncated tokenizer metadata")
	}
}

func TestIsGGUFExtension(t *testing.T) {
	for _, path := range []string{"model.gguf", "MODEL.GGUF", "Inkling-2-Mini.gguf_file", "path/to/model.GGUF_FILE"} {
		if !IsGGUFExtension(path) {
			t.Fatalf("IsGGUFExtension(%q) = false, want true", path)
		}
	}
	for _, path := range []string{"model.bin", "model.onnx", "model.safetensors", "gguf", ""} {
		if IsGGUFExtension(path) {
			t.Fatalf("IsGGUFExtension(%q) = true, want false", path)
		}
	}
}

func TestInspectMetadataRejectsCorruptOrTruncatedAndReadsRoleAndEffectiveTemplate(t *testing.T) {
	defaultTmpl := "{{ messages }}"
	withToolUse := buildTestGGUF(t, nil,
		metadataKV{Key: "general.architecture", Type: ValueTypeString, String: "gemma4"},
		metadataKV{Key: "general.type", Type: ValueTypeString, String: "model"},
		metadataKV{Key: "gemma4.context_length", Type: ValueTypeUint32, Uint32: 131072},
		metadataKV{Key: "gemma4.embedding_length", Type: ValueTypeUint32, Uint32: 1536},
		metadataKV{Key: "tokenizer.chat_template", Type: ValueTypeString, String: defaultTmpl},
		metadataKV{Key: "tokenizer.chat_template.tool_use", Type: ValueTypeString, String: "{{ tools }}"},
	)
	summary, err := InspectMetadata(bytes.NewReader(withToolUse))
	if err != nil {
		t.Fatalf("InspectMetadata: %v", err)
	}
	if width, ok := LLMEmbeddingLength(summary); !ok || width != 1536 {
		t.Fatalf("LLMEmbeddingLength = %d/%v, want 1536", width, ok)
	}
	rawID, ok := LLMChatTemplateIdentity(summary)
	if !ok || rawID == "" {
		t.Fatalf("LLMChatTemplateIdentity missing")
	}
	toolID, ok := LLMChatTemplateToolUseIdentity(summary)
	if !ok || toolID == "" {
		t.Fatalf("LLMChatTemplateToolUseIdentity missing")
	}
	effectiveID, ok := LLMEffectiveChatTemplateIdentity(summary)
	if !ok || effectiveID == "" || effectiveID == rawID {
		t.Fatalf("LLMEffectiveChatTemplateIdentity = %q (raw=%q), want distinct digest when tool_use exists", effectiveID, rawID)
	}

	withoutToolUse := buildTestGGUF(t, nil,
		metadataKV{Key: "general.architecture", Type: ValueTypeString, String: "gemma4"},
		metadataKV{Key: "gemma4.context_length", Type: ValueTypeUint32, Uint32: 131072},
		metadataKV{Key: "tokenizer.chat_template", Type: ValueTypeString, String: defaultTmpl},
	)
	baseSummary, err := InspectMetadata(bytes.NewReader(withoutToolUse))
	if err != nil {
		t.Fatalf("InspectMetadata(withoutToolUse): %v", err)
	}
	if eff, ok := LLMEffectiveChatTemplateIdentity(baseSummary); !ok || eff != rawID {
		t.Fatalf("LLMEffectiveChatTemplateIdentity without tool_use = %q, want %q", eff, rawID)
	}

	// Unrelated named templates (such as tokenizer.chat_template.tts) do not
	// alter LLMEffectiveChatTemplateIdentity because llama.cpp b12648 consumes
	// only default and tool_use templates for chat/tools.
	withUnrelatedTTS := buildTestGGUF(t, nil,
		metadataKV{Key: "general.architecture", Type: ValueTypeString, String: "gemma4"},
		metadataKV{Key: "gemma4.context_length", Type: ValueTypeUint32, Uint32: 131072},
		metadataKV{Key: "gemma4.n_deepstack_layers", Type: ValueTypeUint32, Uint32: 3},
		metadataKV{Key: "tokenizer.chat_template", Type: ValueTypeString, String: defaultTmpl},
		metadataKV{Key: "tokenizer.chat_template.tts", Type: ValueTypeString, String: "{{ tts }}"},
	)
	ttsSummary, err := InspectMetadata(bytes.NewReader(withUnrelatedTTS))
	if err != nil {
		t.Fatalf("InspectMetadata(withUnrelatedTTS): %v", err)
	}
	if eff, ok := LLMEffectiveChatTemplateIdentity(ttsSummary); !ok || eff != rawID {
		t.Fatalf("LLMEffectiveChatTemplateIdentity with .tts = %q, want %q", eff, rawID)
	}
	if ds, ok := LLMDeepstackLayers(ttsSummary); !ok || ds != 3 {
		t.Fatalf("LLMDeepstackLayers = %d/%v, want 3", ds, ok)
	}

	// Corrupt KV wire type after architecture must fail InspectMetadata.
	corrupt := buildTestGGUF(t, nil, metadataKV{Key: "general.architecture", Type: ValueTypeString, String: "gemma4"})
	binary.LittleEndian.PutUint64(corrupt[16:24], 2)
	var badKV bytes.Buffer
	writeTestString(t, &badKV, "bad.field")
	mustBinaryWrite(t, &badKV, uint32(99))
	corrupt = append(corrupt, badKV.Bytes()...)
	if _, err := InspectMetadata(bytes.NewReader(corrupt)); err == nil {
		t.Fatal("InspectMetadata accepted corrupt wire type")
	}
	// Truncated metadata must fail InspectMetadata.
	if _, err := InspectMetadata(bytes.NewReader(withoutToolUse[:len(withoutToolUse)-5])); err == nil {
		t.Fatal("InspectMetadata accepted truncated metadata")
	}
}

func TestInspectMetadataCapturesTokenizerFactsAndQwen3VLProjectorDimensions(t *testing.T) {
	// Put bos/eos IDs and token_type BEFORE tokenizer.ggml.tokens to prove KV order independence.
	var buf bytes.Buffer
	buf.WriteString("GGUF")
	mustBinaryWrite(t, &buf, uint32(3))
	mustBinaryWrite(t, &buf, uint64(4)) // 4 tensors
	mustBinaryWrite(t, &buf, uint64(5)) // 5 KVs
	writeTestString(t, &buf, "general.architecture")
	mustBinaryWrite(t, &buf, uint32(ValueTypeString))
	writeTestString(t, &buf, "gemma4")
	writeTestString(t, &buf, "tokenizer.ggml.bos_token_id")
	mustBinaryWrite(t, &buf, uint32(ValueTypeUint32))
	mustBinaryWrite(t, &buf, uint32(1))
	writeTestString(t, &buf, "tokenizer.ggml.eos_token_id")
	mustBinaryWrite(t, &buf, uint32(ValueTypeUint32))
	mustBinaryWrite(t, &buf, uint32(3))
	writeTestString(t, &buf, "tokenizer.ggml.token_type")
	mustBinaryWrite(t, &buf, uint32(ValueTypeArray))
	mustBinaryWrite(t, &buf, uint32(ValueTypeInt32))
	mustBinaryWrite(t, &buf, uint64(4))
	for _, tt := range []int32{1, 3, 4, 3} {
		mustBinaryWrite(t, &buf, tt)
	}
	writeTestString(t, &buf, "tokenizer.ggml.tokens")
	mustBinaryWrite(t, &buf, uint32(ValueTypeArray))
	mustBinaryWrite(t, &buf, uint32(ValueTypeString))
	mustBinaryWrite(t, &buf, uint64(4))
	for _, tok := range []string{"hello", "<bos>", "<|channel>", "<turn|>"} {
		writeTestString(t, &buf, tok)
	}
	writeTensor := func(name string, dims ...uint64) {
		writeTestString(t, &buf, name)
		mustBinaryWrite(t, &buf, uint32(len(dims)))
		for _, d := range dims {
			mustBinaryWrite(t, &buf, d)
		}
		mustBinaryWrite(t, &buf, uint32(0)) // type
		mustBinaryWrite(t, &buf, uint64(0)) // offset
	}
	writeTensor("mm.2.bias", 2560)
	writeTensor("v.deepstack.5.fc1.weight", 4096, 4096)
	writeTensor("v.deepstack.11.fc1.weight", 4096, 4096)
	writeTensor("v.deepstack.17.fc1.weight", 4096, 4096)

	summary, err := InspectMetadataAndTensors(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatalf("InspectMetadataAndTensors: %v", err)
	}
	if summary.Tokenizer.BOSToken != "<bos>" || summary.Tokenizer.EOSToken != "<turn|>" {
		t.Fatalf("Tokenizer BOS/EOS = %+v", summary.Tokenizer)
	}
	if len(summary.Tokenizer.SpecialTokens) != 3 ||
		summary.Tokenizer.SpecialTokens[0] != "<bos>" ||
		summary.Tokenizer.SpecialTokens[1] != "<turn|>" ||
		summary.Tokenizer.SpecialTokens[2] != "<|channel>" {
		t.Fatalf("Tokenizer SpecialTokens = %v", summary.Tokenizer.SpecialTokens)
	}
	mergerWidth, deepstackLayers, ok := Qwen3VLProjectorDimensions(summary)
	if !ok || mergerWidth != 2560 || deepstackLayers != 3 {
		t.Fatalf("Qwen3VLProjectorDimensions = width=%d deepstack=%d ok=%v, want 2560/3/true", mergerWidth, deepstackLayers, ok)
	}
}
