package capabilitydriver

import (
	"bytes"
	"testing"

	"google.golang.org/protobuf/encoding/protowire"
)

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
