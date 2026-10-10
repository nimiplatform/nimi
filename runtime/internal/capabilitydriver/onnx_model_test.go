package capabilitydriver

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"google.golang.org/protobuf/encoding/protowire"
)

func onnxMetadataEntryForTest(key, value string) []byte {
	body := protowire.AppendTag(nil, 1, protowire.BytesType)
	body = protowire.AppendString(body, key)
	body = protowire.AppendTag(body, 2, protowire.BytesType)
	body = protowire.AppendString(body, value)
	return protowire.AppendBytes(protowire.AppendTag(nil, 14, protowire.BytesType), body)
}

func TestONNXMetadataRejectsAmbiguousAndUnboundedModelFacts(t *testing.T) {
	for _, input := range []struct {
		body   []byte
		reason string
	}{
		{append(onnxMetadataEntryForTest("sample_rate", "16000"), onnxMetadataEntryForTest("sample_rate", "24000")...), "repeated"},
		{onnxMetadataEntryForTest("", "16000"), "key"},
		{onnxMetadataEntryForTest("sample_rate", strings.Repeat("1", 4097)), "value"},
	} {
		if _, err := probeONNXModel(bytes.NewReader(input.body), int64(len(input.body))); err == nil || !strings.Contains(err.Error(), input.reason) {
			t.Fatalf("model metadata error = %v, want %s", err, input.reason)
		}
	}
}

func TestONNXActualSpeakerModelMetadata(t *testing.T) {
	filename := os.Getenv("NIMI_TEST_SPEAKER_ONNX_PATH")
	if filename == "" {
		t.Skip("actual speaker ONNX input not supplied")
	}
	file, err := os.Open(filename)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	data, err := probeONNXModel(file, info.Size())
	if err != nil {
		t.Fatal(err)
	}
	var model onnxModel
	if err := json.Unmarshal(data, &model); err != nil {
		t.Fatal(err)
	}
	if model.Metadata["framework"] != "3d-speaker" || model.Metadata["sample_rate"] != "16000" || model.Metadata["output_dim"] != "512" || model.Metadata["feature_normalize_type"] != "global-mean" {
		t.Fatalf("actual model facts lost: %+v", model.Metadata)
	}
	if len(model.Inputs) != 1 || len(model.Outputs) != 1 || model.Inputs[0].Shape[2] != 80 || model.Outputs[0].Shape[1] != 512 {
		t.Fatalf("actual model interface lost: %+v / %+v", model.Inputs, model.Outputs)
	}
}

func TestONNXProbeRejectsExternalTensorsAndTruncatedLengths(t *testing.T) {
	initializer := protowire.AppendTag(nil, 14, protowire.VarintType)
	initializer = protowire.AppendVarint(initializer, 1)
	graph := protowire.AppendTag(nil, 5, protowire.BytesType)
	graph = protowire.AppendBytes(graph, initializer)
	model := protowire.AppendTag(nil, 7, protowire.BytesType)
	model = protowire.AppendBytes(model, graph)
	if _, err := probeONNXModel(bytes.NewReader(model), int64(len(model))); err == nil {
		t.Fatal("external tensor file admitted")
	}
	truncated := protowire.AppendTag(nil, 7, protowire.BytesType)
	truncated = protowire.AppendVarint(truncated, 1000)
	if _, err := probeONNXModel(bytes.NewReader(truncated), int64(len(truncated))); err == nil {
		t.Fatal("truncated graph admitted")
	}
}

func TestFaceEncoderBatchMustMatchTheSingleReference(t *testing.T) {
	model := onnxModel{IRVersion: 6, Inputs: []onnxTensor{{Type: 1, Shape: []int64{4, 3, 112, 112}}}, Outputs: []onnxTensor{{Type: 1, Shape: []int64{1, 512}}}}
	if faceModelInterface(FaceRecognizerSlot, model) {
		t.Fatal("fixed four-image encoder admitted for one reference")
	}
	model.Inputs[0].Shape[0] = -1
	if !faceModelInterface(FaceRecognizerSlot, model) {
		t.Fatal("dynamic single-image encoder rejected")
	}
	if faceModelInterface(FaceSwapperSlot, model) {
		t.Fatal("encoder admitted in replacement slot")
	}
}
