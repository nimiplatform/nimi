package capabilitydriver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"google.golang.org/protobuf/encoding/protowire"
)

type countedONNXReader struct {
	source    io.ReaderAt
	ctx       context.Context
	afterRead func()
	reads     int64
	readBytes int64
}

func (r *countedONNXReader) ContextErr() error {
	if r.ctx != nil {
		return r.ctx.Err()
	}
	return nil
}
func (r *countedONNXReader) ReadAt(p []byte, off int64) (int, error) {
	if err := r.ContextErr(); err != nil {
		return 0, err
	}
	r.reads++
	n, err := r.source.ReadAt(p, off)
	r.readBytes += int64(n)
	if r.afterRead != nil {
		r.afterRead()
	}
	return n, err
}

func appendONNXBytes(body []byte, field protowire.Number, value []byte) []byte {
	return protowire.AppendBytes(protowire.AppendTag(body, field, protowire.BytesType), value)
}

func readerONNXFixture(nodes int) []byte {
	valueInfo := func(name string) []byte {
		dimension := protowire.AppendVarint(protowire.AppendTag(nil, 1, protowire.VarintType), 1)
		shape := appendONNXBytes(nil, 1, dimension)
		tensor := protowire.AppendVarint(protowire.AppendTag(nil, 1, protowire.VarintType), 1)
		tensor = appendONNXBytes(tensor, 2, shape)
		info := appendONNXBytes(nil, 1, []byte(name))
		return appendONNXBytes(info, 2, appendONNXBytes(nil, 1, tensor))
	}
	graph := []byte{}
	node := appendONNXBytes(nil, 4, []byte("MatMul"))
	node = appendONNXBytes(node, 7, []byte("ai.onnx"))
	for i := 0; i < nodes; i++ {
		graph = appendONNXBytes(graph, 1, node)
	}
	// Tensor data must remain skipped even though later interface facts matter.
	initializer := appendONNXBytes(nil, 9, make([]byte, 8<<20))
	graph = appendONNXBytes(graph, 5, initializer)
	graph = appendONNXBytes(graph, 11, valueInfo("input"))
	graph = appendONNXBytes(graph, 12, valueInfo("output"))
	model := protowire.AppendVarint(protowire.AppendTag(nil, 1, protowire.VarintType), 8)
	return appendONNXBytes(model, 7, graph)
}

func TestONNXReaderUsesBoundedWindowAndSkipsWeights(t *testing.T) {
	data := readerONNXFixture(1024)
	r := &countedONNXReader{source: bytes.NewReader(data)}
	probe, err := probeONNXModel(r, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	var model onnxModel
	if err := json.Unmarshal(probe, &model); err != nil {
		t.Fatal(err)
	}
	if model.IRVersion != 8 || len(model.Inputs) != 1 || model.Inputs[0].Name != "input" || len(model.Outputs) != 1 || model.Outputs[0].Name != "output" || len(model.NodeOps) != 1 || model.NodeOps[0] != "MatMul" {
		t.Fatalf("lost model facts: %+v", model)
	}
	if r.reads > 32 || r.readBytes > 64<<10 {
		t.Fatalf("metadata probe reads=%d bytes=%d, model=%d", r.reads, r.readBytes, len(data))
	}
}

func TestONNXReaderPreservesCancellationAndMalformedBoundaries(t *testing.T) {
	data := readerONNXFixture(4)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := &countedONNXReader{source: bytes.NewReader(data), ctx: ctx, afterRead: cancel}
	if _, err := probeONNXModel(r, int64(len(data))); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
	for _, input := range [][]byte{
		data[:len(data)-1],
		bytes.Repeat([]byte{0x80}, 10),
		{0x3a, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f},
		append(append([]byte(nil), data...), onnxMetadataEntryForTest("a", "1")...),
	} {
		if len(input) > len(data) {
			input = append(input, onnxMetadataEntryForTest("a", "2")...)
		}
		if _, err := probeONNXModel(bytes.NewReader(input), int64(len(input))); err == nil {
			t.Fatal("malformed or duplicate model admitted")
		}
	}
}

func TestONNXReaderCrossesWindowWithoutMaskingShortSource(t *testing.T) {
	data := bytes.Repeat([]byte{0x6d}, 9000)
	r := newModelAssetProbeReaderAt(bytes.NewReader(data), int64(len(data)), 4096)
	value := make([]byte, 5000)
	if n, err := r.ReadAt(value, 4000); n != len(value) || err != nil || !bytes.Equal(value, data[4000:]) {
		t.Fatalf("cross-window read=%d err=%v", n, err)
	}
	truncated := newModelAssetProbeReaderAt(bytes.NewReader(data[:8193]), int64(len(data)), 4096)
	if n, err := truncated.ReadAt(make([]byte, 2), 8192); n != 1 || !errors.Is(err, io.EOF) {
		t.Fatalf("short source read=%d err=%v", n, err)
	}
	if _, err := r.ReadAt(make([]byte, 1), -1); err == nil {
		t.Fatal("negative offset admitted")
	}
}

func BenchmarkONNXMetadataReader(b *testing.B) {
	data := readerONNXFixture(1024)
	name := filepath.Join(b.TempDir(), "metadata.onnx")
	if err := os.WriteFile(name, data, 0600); err != nil {
		b.Fatal(err)
	}
	file, err := os.Open(name)
	if err != nil {
		b.Fatal(err)
	}
	defer func() { _ = file.Close() }()
	r := &countedONNXReader{source: file}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := probeONNXModel(r, int64(len(data))); err != nil {
			b.Fatal(err)
		}
	}
	b.ReportMetric(float64(r.reads)/float64(b.N), "read-at-ops/op")
	b.ReportMetric(float64(r.readBytes)/float64(b.N), "read-at-bytes/op")
}
