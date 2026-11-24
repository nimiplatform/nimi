package capabilitydriver

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/types/known/structpb"
)

func writeLlamaProbeTensor(t *testing.T, buf *bytes.Buffer, name string, offset uint64, dims ...uint64) {
	t.Helper()
	writeLlamaProbeString(t, buf, name)
	mustWriteLlamaProbeValue(t, buf, uint32(len(dims)))
	for _, dim := range dims {
		mustWriteLlamaProbeValue(t, buf, dim)
	}
	mustWriteLlamaProbeValue(t, buf, uint32(0)) // ggml_type F32
	mustWriteLlamaProbeValue(t, buf, offset)
}

func writeLlamaProbePayload(buf *bytes.Buffer, size uint64) {
	padding := (32 - buf.Len()%32) % 32
	buf.Write(make([]byte, uint64(padding)+size))
}

func buildStructuralLLMGGUFWithDeepstackForTest(t *testing.T, arch, modelType string, ctxLen, embdLen, pooling, deepstack uint32, chatTemplate, toolUseTemplate string) []byte {
	t.Helper()
	type kv struct {
		key string
		val any
	}
	kvs := []kv{{"general.architecture", arch}}
	if modelType != "" {
		kvs = append(kvs, kv{"general.type", modelType})
	}
	if ctxLen > 0 {
		kvs = append(kvs, kv{arch + ".context_length", ctxLen})
	}
	if embdLen > 0 {
		kvs = append(kvs, kv{arch + ".embedding_length", embdLen})
	}
	if pooling > 0 {
		kvs = append(kvs, kv{arch + ".pooling_type", pooling})
	}
	if deepstack > 0 {
		kvs = append(kvs, kv{arch + ".n_deepstack_layers", deepstack})
	}
	if chatTemplate != "" {
		kvs = append(kvs, kv{"tokenizer.chat_template", chatTemplate})
	}
	if toolUseTemplate != "" {
		kvs = append(kvs, kv{"tokenizer.chat_template.tool_use", toolUseTemplate})
	}
	var out bytes.Buffer
	out.WriteString("GGUF")
	mustWriteLlamaProbeValue(t, &out, uint32(3))
	mustWriteLlamaProbeValue(t, &out, uint64(1))
	mustWriteLlamaProbeValue(t, &out, uint64(len(kvs)))
	for _, entry := range kvs {
		writeLlamaProbeString(t, &out, entry.key)
		switch value := entry.val.(type) {
		case string:
			mustWriteLlamaProbeValue(t, &out, uint32(ggufmeta.ValueTypeString))
			writeLlamaProbeString(t, &out, value)
		case uint32:
			mustWriteLlamaProbeValue(t, &out, uint32(ggufmeta.ValueTypeUint32))
			mustWriteLlamaProbeValue(t, &out, value)
		}
	}
	writeLlamaProbeTensor(t, &out, "token_embd.weight", 0, 4)
	writeLlamaProbePayload(&out, 16)
	return out.Bytes()
}

func buildStructuralLLMGGUFForTest(t *testing.T, arch, modelType string, ctxLen, embdLen, pooling uint32, chatTemplate, toolUseTemplate string) []byte {
	t.Helper()
	return buildStructuralLLMGGUFWithDeepstackForTest(t, arch, modelType, ctxLen, embdLen, pooling, 0, chatTemplate, toolUseTemplate)
}

func TestEmbeddingGemmaRequiresTensorPayload(t *testing.T) {
	var buf bytes.Buffer
	buf.WriteString("GGUF")
	mustWriteLlamaProbeValue(t, &buf, uint32(3))
	mustWriteLlamaProbeValue(t, &buf, uint64(2))
	mustWriteLlamaProbeValue(t, &buf, uint64(5))
	writeLlamaProbeString(t, &buf, "general.architecture")
	mustWriteLlamaProbeValue(t, &buf, uint32(ggufmeta.ValueTypeString))
	writeLlamaProbeString(t, &buf, "gemma-embedding2")
	for _, field := range []struct {
		key   string
		value uint32
	}{
		{"context_length", 8192}, {"embedding_length", 512}, {"embedding_length_out", 768}, {"pooling_type", 1},
	} {
		writeLlamaProbeString(t, &buf, "gemma-embedding2."+field.key)
		mustWriteLlamaProbeValue(t, &buf, uint32(ggufmeta.ValueTypeUint32))
		mustWriteLlamaProbeValue(t, &buf, field.value)
	}
	const projectionBytes = 512 * 768 * 4
	writeLlamaProbeTensor(t, &buf, "output.weight", 0, 512, 768)
	writeLlamaProbeTensor(t, &buf, "output_norm.weight", projectionBytes, 512)
	writeLlamaProbePayload(&buf, projectionBytes+512*4)
	data := buf.Bytes()
	input := ModelAssetFormatProbeInput{RecipeID: LlamaEmbeddingGemma2RecipeID, RequirementID: EmbeddingGGUFRequirementID, RelativePath: "community.gguf", Entry: true}
	driver := LlamaEmbedDriver{}
	if _, err := driver.ProbeModelAsset(input, bytes.NewReader(data), int64(len(data))); err != nil {
		t.Fatalf("complete model: %v", err)
	}
	if _, err := driver.ProbeModelAsset(input, bytes.NewReader(data[:len(data)-1]), int64(len(data)-1)); err == nil {
		t.Fatal("accepted a missing tensor byte")
	}
}

func TestLlamaV3RequiresCompleteTensorTableAndPayload(t *testing.T) {
	driver := LlamaTextDriver{}
	input := ModelAssetFormatProbeInput{RecipeID: LlamaGenericGGUFRecipeID, RequirementID: MainGGUFRequirementID, RelativePath: "model.gguf", Entry: true}
	valid := buildStructuralLLMGGUFForTest(t, "llama", "model", 4096, 512, 0, "", "")
	table := bytes.Index(valid, []byte("token_embd.weight")) - 8
	dimensions := table + 8 + len("token_embd.weight") + 4
	tensorType := dimensions + 8
	tensorOffset := tensorType + 4

	badOffset := bytes.Clone(valid)
	binary.LittleEndian.PutUint64(badOffset[tensorOffset:], 32)
	quantized := bytes.Clone(valid)
	binary.LittleEndian.PutUint64(quantized[dimensions:], 32)
	binary.LittleEndian.PutUint32(quantized[tensorType:], 2) // Q4_0, 18 bytes per 32 elements
	quantized = append(quantized, 0, 0)
	truncatedQuantized := quantized[:len(quantized)-1]
	for _, tc := range []struct {
		name string
		data []byte
	}{
		{"one byte of tensor table", valid[:table+1]},
		{"truncated payload", valid[:len(valid)-1]},
		{"incorrect tensor offset", badOffset},
		{"truncated quantized block", truncatedQuantized},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := driver.ProbeModelAsset(input, bytes.NewReader(tc.data), int64(len(tc.data))); err == nil {
				t.Fatal("incomplete GGUF was admitted")
			}
		})
	}
	if _, err := driver.ProbeModelAsset(input, bytes.NewReader(truncatedQuantized), int64(len(quantized))); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("physically absent tensor byte: %v, want unexpected EOF", err)
	}
	if _, err := driver.ProbeModelAsset(input, bytes.NewReader(quantized), int64(len(quantized))); err != nil {
		t.Fatalf("valid quantized block was rejected: %v", err)
	}
}

type structuralProjectorTensor struct {
	name string
	dims []uint64
}

func buildStructuralProjectorGGUFWithTensorsForTest(t *testing.T, visionProjType, audioProjType string, visionDim, audioDim uint32, tensors []structuralProjectorTensor) []byte {
	t.Helper()
	type kv struct {
		key string
		val any
	}
	kvs := []kv{
		{"general.architecture", "clip"},
		{"general.type", "mmproj"},
	}
	if visionProjType != "" {
		kvs = append(kvs, kv{"clip.vision.projector_type", visionProjType})
	}
	if audioProjType != "" {
		kvs = append(kvs, kv{"clip.audio.projector_type", audioProjType})
	}
	if visionDim > 0 {
		kvs = append(kvs, kv{"clip.vision.projection_dim", visionDim})
	}
	if audioDim > 0 {
		kvs = append(kvs, kv{"clip.audio.projection_dim", audioDim})
	}
	if len(tensors) == 0 {
		if visionProjType == "qwen3vl_merger" && visionDim > 0 {
			tensors = []structuralProjectorTensor{{name: "mm.2.bias", dims: []uint64{uint64(visionDim)}}}
		} else {
			tensors = []structuralProjectorTensor{{name: "mm.0.weight", dims: []uint64{16, 16}}}
		}
	}
	var out bytes.Buffer
	out.WriteString("GGUF")
	mustWriteLlamaProbeValue(t, &out, uint32(3))
	mustWriteLlamaProbeValue(t, &out, uint64(len(tensors)))
	mustWriteLlamaProbeValue(t, &out, uint64(len(kvs)))
	for _, entry := range kvs {
		writeLlamaProbeString(t, &out, entry.key)
		switch value := entry.val.(type) {
		case string:
			mustWriteLlamaProbeValue(t, &out, uint32(ggufmeta.ValueTypeString))
			writeLlamaProbeString(t, &out, value)
		case uint32:
			mustWriteLlamaProbeValue(t, &out, uint32(ggufmeta.ValueTypeUint32))
			mustWriteLlamaProbeValue(t, &out, value)
		}
	}
	var payloadSize uint64
	for _, tensor := range tensors {
		writeLlamaProbeTensor(t, &out, tensor.name, payloadSize, tensor.dims...)
		tensorBytes := uint64(4)
		for _, dim := range tensor.dims {
			tensorBytes *= dim
		}
		payloadSize += (tensorBytes + 31) &^ 31
	}
	writeLlamaProbePayload(&out, payloadSize)
	return out.Bytes()
}

func buildStructuralProjectorGGUFForTest(t *testing.T, visionProjType, audioProjType string, visionDim, audioDim uint32) []byte {
	t.Helper()
	return buildStructuralProjectorGGUFWithTensorsForTest(t, visionProjType, audioProjType, visionDim, audioDim, nil)
}

func TestLlamaV3RejectsEmbeddingPoolingZeroTensorsAndWrongType(t *testing.T) {
	driver := LlamaTextDriver{}
	input := ModelAssetFormatProbeInput{RecipeID: LlamaGenericGGUFRecipeID, RequirementID: MainGGUFRequirementID, RelativePath: "model.gguf", Entry: true}
	buildWrongTypeKV := func(extraKey string, extraType ggufmeta.ValueType, writeExtra func(*bytes.Buffer)) []byte {
		var out bytes.Buffer
		out.WriteString("GGUF")
		mustWriteLlamaProbeValue(t, &out, uint32(3))
		mustWriteLlamaProbeValue(t, &out, uint64(1))
		mustWriteLlamaProbeValue(t, &out, uint64(3))
		writeLlamaProbeString(t, &out, "general.architecture")
		mustWriteLlamaProbeValue(t, &out, uint32(ggufmeta.ValueTypeString))
		writeLlamaProbeString(t, &out, "gemma4")
		writeLlamaProbeString(t, &out, "gemma4.context_length")
		mustWriteLlamaProbeValue(t, &out, uint32(ggufmeta.ValueTypeUint32))
		mustWriteLlamaProbeValue(t, &out, uint32(8192))
		writeLlamaProbeString(t, &out, extraKey)
		mustWriteLlamaProbeValue(t, &out, uint32(extraType))
		writeExtra(&out)
		writeLlamaProbeTensor(t, &out, "token_embd.weight", 0, 4)
		writeLlamaProbePayload(&out, 16)
		return out.Bytes()
	}
	// Header-only GGUF declaring tensor_count=1 with 0 bytes remaining after KV must fail closed.
	var zeroTrailing bytes.Buffer
	zeroTrailing.WriteString("GGUF")
	mustWriteLlamaProbeValue(t, &zeroTrailing, uint32(3))
	mustWriteLlamaProbeValue(t, &zeroTrailing, uint64(1))
	mustWriteLlamaProbeValue(t, &zeroTrailing, uint64(2))
	writeLlamaProbeString(t, &zeroTrailing, "general.architecture")
	mustWriteLlamaProbeValue(t, &zeroTrailing, uint32(ggufmeta.ValueTypeString))
	writeLlamaProbeString(t, &zeroTrailing, "gemma4")
	writeLlamaProbeString(t, &zeroTrailing, "gemma4.context_length")
	mustWriteLlamaProbeValue(t, &zeroTrailing, uint32(ggufmeta.ValueTypeUint32))
	mustWriteLlamaProbeValue(t, &zeroTrailing, uint32(8192))

	for _, tc := range []struct {
		name string
		raw  []byte
	}{
		{"qwen3 embedding pooling_type=3", buildStructuralLLMGGUFForTest(t, "qwen3", "model", 32768, 1024, 3, "{{ messages }}", "")},
		{"general.type mmproj in main slot", buildStructuralLLMGGUFForTest(t, "gemma4", "mmproj", 131072, 1536, 0, "{{ messages }}", "")},
		{"missing context_length", buildStructuralLLMGGUFForTest(t, "gemma4", "model", 0, 1536, 0, "{{ messages }}", "")},
		{"non-LLM arch audiocpp", buildStructuralLLMGGUFForTest(t, "audiocpp", "model", 4096, 1024, 0, "", "")},
		{"wrong-type numeric general.type", buildWrongTypeKV("general.type", ggufmeta.ValueTypeUint32, func(b *bytes.Buffer) { mustWriteLlamaProbeValue(t, b, uint32(1)) })},
		{"wrong-type string pooling_type", buildWrongTypeKV("gemma4.pooling_type", ggufmeta.ValueTypeString, func(b *bytes.Buffer) { writeLlamaProbeString(t, b, "mean") })},
		{"wrong-type string n_deepstack_layers", buildWrongTypeKV("gemma4.n_deepstack_layers", ggufmeta.ValueTypeString, func(b *bytes.Buffer) { writeLlamaProbeString(t, b, "three") })},
		{"positive tensor_count with zero remaining bytes after KV", zeroTrailing.Bytes()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := driver.ProbeModelAsset(input, bytes.NewReader(tc.raw), int64(len(tc.raw))); err == nil {
				t.Fatalf("%s unexpectedly admitted", tc.name)
			}
		})
	}
	// Single-slot mmproj probe rejects unsupported projector families (such as pixtral) early.
	mmprojInput := ModelAssetFormatProbeInput{RecipeID: LlamaGenericGGUFRecipeID, RequirementID: CompanionMMProjRequirementID, RelativePath: "mmproj.gguf", Entry: true}
	pixtralProj := buildStructuralProjectorGGUFForTest(t, "pixtral", "", 4096, 0)
	if _, err := driver.ProbeModelAsset(mmprojInput, bytes.NewReader(pixtralProj), int64(len(pixtralProj))); err == nil {
		t.Fatal("unsupported pixtral projector was admitted at single-slot probe")
	}
}

func TestLlamaV3StructuralProjectorCompatibilityPairsFamiliesAndWidths(t *testing.T) {
	driver := LlamaTextDriver{}
	requirements, reason := driver.ProjectRecipe(LlamaGenericGGUFRecipeID, nil, []string{inputImageFeature})
	if reason != success || len(requirements) != 2 {
		t.Fatalf("ProjectRecipe = %v %v", requirements, reason)
	}
	pair := func(mainRaw, projRaw []byte) runtimev1.LocalCapabilityReason {
		mainSHA, projSHA := strings.Repeat("a", 64), strings.Repeat("b", 64)
		mainBind := &runtimev1.ModelAssetExactBinding{RequirementId: MainGGUFRequirementID, ModelAssetId: "main", VerifiedContentId: "sha256:" + mainSHA, EntrySha256: mainSHA}
		projBind := &runtimev1.ModelAssetExactBinding{RequirementId: CompanionMMProjRequirementID, ModelAssetId: "proj", VerifiedContentId: "sha256:" + projSHA, EntrySha256: projSHA}
		mainProj, r1 := projectLlamaBindingForTest(driver, ModelAssetBindingInput{RecipeID: LlamaGenericGGUFRecipeID, Requirement: requirements[0], Binding: mainBind, Entry: ModelAssetFileFact{RelativePath: "main.gguf_file", SizeBytes: int64(len(mainRaw)), FormatProbe: mainRaw}})
		if r1 != success {
			return r1
		}
		projProj, r2 := projectLlamaBindingForTest(driver, ModelAssetBindingInput{RecipeID: LlamaGenericGGUFRecipeID, Requirement: requirements[1], Binding: projBind, Entry: ModelAssetFileFact{RelativePath: "mmproj.gguf", SizeBytes: int64(len(projRaw)), FormatProbe: projRaw}})
		if r2 != success {
			return r2
		}
		return driver.ValidateCombination(requirements, []*runtimev1.ModelAssetExactBinding{mainBind, projBind}, []ModelAssetDescriptor{mainProj.Descriptor, projProj.Descriptor})
	}
	inklingMain := buildStructuralLLMGGUFForTest(t, "inkling2_loop", "model", 1048576, 2304, 0, "{{ messages }}", "")
	inklingProj := buildStructuralProjectorGGUFForTest(t, "inkling2v", "", 2304, 0)
	if got := pair(inklingMain, inklingProj); got != success {
		t.Fatalf("compatible inkling2_loop + inkling2v rejected: %v", got)
	}
	gemmaProj := buildStructuralProjectorGGUFForTest(t, "gemma4v", "", 1536, 0)
	if got := pair(inklingMain, gemmaProj); got != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("cross-family inkling2_loop + gemma4v admitted: %v", got)
	}
	qwen27B := buildStructuralLLMGGUFForTest(t, "qwen35", "model", 262144, 5120, 0, "{{ messages }}", "")
	qwen4BProj := buildStructuralProjectorGGUFForTest(t, "qwen3vl_merger", "", 2560, 0)
	if got := pair(qwen27B, qwen4BProj); got != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("width-mismatched qwen3.5 4B projector admitted on 27B main: %v", got)
	}
	qwen27BProj := buildStructuralProjectorGGUFForTest(t, "qwen3vl_merger", "", 5120, 0)
	if got := pair(qwen27B, qwen27BProj); got != success {
		t.Fatalf("width-matched qwen3.8 27B projector rejected: %v", got)
	}
	// Real counterexample: Qwen3.5-4B (n_embd=2560, deepstack=0 -> 2560) vs
	// Qwen3-VL-4B-Instruct mmproj (projection_dim=2560, mm.2.bias=[2560], 3
	// deepstack layers -> actual engine output 2560*(1+3)=10240) MUST fail.
	qwen354BMain := buildStructuralLLMGGUFWithDeepstackForTest(t, "qwen35", "model", 262144, 2560, 0, 0, "{{ messages }}", "")
	qwen3VL4BMain := buildStructuralLLMGGUFWithDeepstackForTest(t, "qwen3vl", "model", 262144, 2560, 0, 3, "{{ messages }}", "")
	qwen3VL4BProj := buildStructuralProjectorGGUFWithTensorsForTest(t, "qwen3vl_merger", "", 2560, 0, []structuralProjectorTensor{
		{name: "mm.2.bias", dims: []uint64{2560}},
		{name: "v.deepstack.5.fc1.weight", dims: []uint64{4096, 4096}},
		{name: "v.deepstack.11.fc1.weight", dims: []uint64{4096, 4096}},
		{name: "v.deepstack.17.fc1.weight", dims: []uint64{4096, 4096}},
	})
	if got := pair(qwen354BMain, qwen3VL4BProj); got != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("deepstack-mismatched Qwen3-VL-4B projector (10240) admitted on Qwen3.5-4B main (2560): %v", got)
	}
	if got := pair(qwen3VL4BMain, qwen3VL4BProj); got != success {
		t.Fatalf("matching Qwen3-VL-4B main + deepstack projector (10240 == 10240) rejected: %v", got)
	}
	if got := pair(qwen3VL4BMain, qwen4BProj); got != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("non-deepstack Qwen3.5-4B projector (2560) admitted on Qwen3-VL-4B main (10240): %v", got)
	}
}

func TestLlamaStructuredOutputSerializerOmitsTemplateKwargsAndRejectsExplicitDisabled(t *testing.T) {
	schema, _ := structpb.NewStruct(map[string]any{
		"type":       "object",
		"properties": map[string]any{"answer": map[string]any{"type": "integer"}},
		"required":   []any{"answer"},
	})
	spec := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "2+3?"}},
		ResponseFormat: &runtimev1.ResponseFormat{
			Kind:       runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA,
			SchemaName: "math",
			JsonSchema: schema,
			Strict:     true,
		},
	}
	wire, err := LlamaStructuredOutputRequestSerializer(spec, false)
	if err != nil {
		t.Fatalf("LlamaStructuredOutputRequestSerializer: %v", err)
	}
	var body map[string]any
	if err := json.Unmarshal(wire.Payload, &body); err != nil {
		t.Fatal(err)
	}
	if _, hasKwargs := body["chat_template_kwargs"]; hasKwargs {
		t.Fatalf("unknown-template serializer must not inject chat_template_kwargs: %s", wire.Payload)
	}
	if body["response_format"] == nil {
		t.Fatalf("missing response_format: %s", wire.Payload)
	}
	spec.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
	if _, err := LlamaStructuredOutputRequestSerializer(spec, false); err == nil {
		t.Fatal("unknown-template serializer accepted explicit REASONING_ACTIVATION_DISABLED")
	}
}

func TestONNXProbeRejectsExternalDataInsideNestedSubgraphAndNodeAttributes(t *testing.T) {
	// Build a minimal valid ONNX TensorProto with external data_location=1 (field 14).
	externalTensor := protowire.AppendTag(nil, 14, protowire.VarintType)
	externalTensor = protowire.AppendVarint(externalTensor, 1)

	makeModel := func(node []byte) []byte {
		// Minimal valid GraphProto with one input, one output, and the crafted node.
		makeValueInfo := func(name string) []byte {
			dim := protowire.AppendTag(nil, 1, protowire.VarintType)
			dim = protowire.AppendVarint(dim, 1)
			shape := protowire.AppendTag(nil, 1, protowire.BytesType)
			shape = protowire.AppendBytes(shape, dim)
			tensorType := protowire.AppendTag(nil, 1, protowire.VarintType)
			tensorType = protowire.AppendVarint(tensorType, 1)
			tensorType = protowire.AppendTag(tensorType, 2, protowire.BytesType)
			tensorType = protowire.AppendBytes(tensorType, shape)
			typeProto := protowire.AppendTag(nil, 1, protowire.BytesType)
			typeProto = protowire.AppendBytes(typeProto, tensorType)
			vi := protowire.AppendTag(nil, 1, protowire.BytesType)
			vi = protowire.AppendString(vi, name)
			vi = protowire.AppendTag(vi, 2, protowire.BytesType)
			vi = protowire.AppendBytes(vi, typeProto)
			return vi
		}
		var graph []byte
		graph = protowire.AppendTag(graph, 1, protowire.BytesType)
		graph = protowire.AppendBytes(graph, node)
		graph = protowire.AppendTag(graph, 11, protowire.BytesType)
		graph = protowire.AppendBytes(graph, makeValueInfo("in"))
		graph = protowire.AppendTag(graph, 12, protowire.BytesType)
		graph = protowire.AppendBytes(graph, makeValueInfo("out"))
		var model []byte
		model = protowire.AppendTag(model, 1, protowire.VarintType)
		model = protowire.AppendVarint(model, 8)
		model = protowire.AppendTag(model, 7, protowire.BytesType)
		model = protowire.AppendBytes(model, graph)
		return model
	}

	// Case 1: NodeProto.attribute (5) -> AttributeProto.t (5) carrying external tensor.
	attrT := protowire.AppendTag(nil, 5, protowire.BytesType)
	attrT = protowire.AppendBytes(attrT, externalTensor)
	nodeAttrT := protowire.AppendTag(nil, 4, protowire.BytesType)
	nodeAttrT = protowire.AppendString(nodeAttrT, "Constant")
	nodeAttrT = protowire.AppendTag(nodeAttrT, 5, protowire.BytesType)
	nodeAttrT = protowire.AppendBytes(nodeAttrT, attrT)
	raw1 := makeModel(nodeAttrT)
	if _, err := probeONNXModel(bytes.NewReader(raw1), int64(len(raw1))); err == nil {
		t.Fatal("external tensor in NodeProto.attribute.t was admitted")
	}

	// Case 2: NodeProto.attribute (5) -> AttributeProto.g (6) -> subgraph GraphProto.initializer (5) carrying external tensor.
	subgraph := protowire.AppendTag(nil, 5, protowire.BytesType)
	subgraph = protowire.AppendBytes(subgraph, externalTensor)
	attrG := protowire.AppendTag(nil, 6, protowire.BytesType)
	attrG = protowire.AppendBytes(attrG, subgraph)
	nodeAttrG := protowire.AppendTag(nil, 4, protowire.BytesType)
	nodeAttrG = protowire.AppendString(nodeAttrG, "If")
	nodeAttrG = protowire.AppendTag(nodeAttrG, 5, protowire.BytesType)
	nodeAttrG = protowire.AppendBytes(nodeAttrG, attrG)
	raw2 := makeModel(nodeAttrG)
	if _, err := probeONNXModel(bytes.NewReader(raw2), int64(len(raw2))); err == nil {
		t.Fatal("external tensor in nested subgraph initializer was admitted")
	}
}

func TestBasicPitchAdmitsUniqueONNXInDirectoryAndRejectsAmbiguousBundles(t *testing.T) {
	driver := BasicPitchDriver{}
	reqs, reason := driver.ProjectRecipe(BasicPitchRecipeID, nil, nil)
	if reason != success || len(reqs) != 1 || reqs[0].GetPolicy() != runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE {
		t.Fatalf("BasicPitch ProjectRecipe = %+v reason=%v", reqs, reason)
	}
	validProbe, _ := json.Marshal(onnxModel{
		IRVersion: 8,
		Inputs:    []onnxTensor{{Name: "serving_default_input_2:0", Type: 1, Shape: []int64{-1, 43844, 1}}},
		Outputs: []onnxTensor{
			{Name: "StatefulPartitionedCall:0", Type: 1, Shape: []int64{-1, 172, 264}},
			{Name: "StatefulPartitionedCall:1", Type: 1, Shape: []int64{-1, 172, 88}},
			{Name: "StatefulPartitionedCall:2", Type: 1, Shape: []int64{-1, 172, 88}},
		},
	})
	sha := strings.Repeat("d", 64)
	binding := &runtimev1.ModelAssetExactBinding{RequirementId: BasicPitchRequirementID, ModelAssetId: "bp-custom", VerifiedContentId: "sha256:" + sha, EntrySha256: sha}
	// Directory bundle containing LICENSE + custom/pitch_v2.onnx -> admitted!
	if _, reason := driver.ProjectModelAssetBinding(ModelAssetBindingInput{
		RecipeID: BasicPitchRecipeID, Requirement: reqs[0], Binding: binding,
		Entry: ModelAssetFileFact{RelativePath: "custom/pitch_v2.onnx", SizeBytes: 230000, FormatProbe: validProbe},
		Files: []ModelAssetFileFact{
			{RelativePath: "LICENSE", SizeBytes: 100},
			{RelativePath: "custom/pitch_v2.onnx", SizeBytes: 230000, FormatProbe: validProbe},
		},
	}); reason != success {
		t.Fatalf("custom Basic Pitch directory bundle rejected: %v", reason)
	}
	// Two .onnx files -> rejected!
	if _, reason := driver.ProjectModelAssetBinding(ModelAssetBindingInput{
		RecipeID: BasicPitchRecipeID, Requirement: reqs[0], Binding: binding,
		Entry: ModelAssetFileFact{RelativePath: "a.onnx", SizeBytes: 230000, FormatProbe: validProbe},
		Files: []ModelAssetFileFact{
			{RelativePath: "a.onnx", SizeBytes: 230000, FormatProbe: validProbe},
			{RelativePath: "b.onnx", SizeBytes: 230000, FormatProbe: validProbe},
		},
	}); reason == success {
		t.Fatal("ambiguous dual-ONNX Basic Pitch bundle admitted")
	}
	// Invocation resolves the unique ONNX path even when Entry was another file in bundle.
	if platform := runtime.GOOS + "/" + runtime.GOARCH; platform == "windows/amd64" || platform == "darwin/arm64" {
		root := t.TempDir()
		profileRoot := filepath.Join(root, "profile")
		plan, err := driver.PlanMusicTranscriptionInvocation(MusicTranscriptionInvocationInput{
			LoadoutID: "bp", RecipeID: BasicPitchRecipeID,
			ExactBindings: []InvocationExactBinding{{
				RequirementID: BasicPitchRequirementID, VerifiedContentID: "sha256:" + sha, EntrySHA256: sha,
				BundleDir: root, AbsolutePath: filepath.Join(root, "LICENSE"),
				DeclaredFiles: []string{"LICENSE", "custom/pitch_v2.onnx"},
			}},
			DependencySources: []InvocationExactDependencySource{{
				DependencyFamily: "python.package-set", ConsumerScope: BasicPitchConsumerID,
				CanonicalRoot: profileRoot, SelectedSourceRecordID: "src", Version: "prof",
				Hashes: map[string]string{"profile_digest": "prof", "driver_bundle_sha256": strings.Repeat("a", 64)},
			}},
			Request: &runtimev1.MusicTranscribeScenarioSpec{
				SourceAudio:      &runtimev1.MusicAudioInput{ArtifactId: "audio-1"},
				RequestedParts:   []runtimev1.MusicTranscriptionPart{runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_NOTE_EVENTS},
				RequestedFormats: []runtimev1.MusicTranscriptionFormat{runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_MIDI},
			},
			SourceInfo: &runtimev1.LocalAppAudioInfo{SampleRateHz: 22050, Channels: 1, FrameCount: 44100},
			StagingDir: root, SourcePath: filepath.Join(root, "source.wav"),
		})
		if err != nil {
			t.Fatalf("PlanMusicTranscriptionInvocation: %v", err)
		}
		wantModel := filepath.Join(root, "custom", "pitch_v2.onnx")
		if !containsAdjacent(plan.CLIArgs(), "--model", wantModel) {
			t.Fatalf("CLI args did not pass unique ONNX file %q: %v", wantModel, plan.CLIArgs())
		}
	}
}
