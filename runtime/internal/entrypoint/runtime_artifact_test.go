package entrypoint

import (
	"errors"
	"io"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestCollectArtifactStreamSuccess(t *testing.T) {
	stream := &artifactChunkReceiverStub{
		chunks: []*runtimev1.ArtifactChunk{
			{
				ArtifactId:    "artifact-1",
				MimeType:      "image/png",
				Chunk:         []byte("hel"),
				RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				ModelResolved: "sd3",
				TraceId:       "trace-1",
			},
			{
				ArtifactId:    "artifact-1",
				MimeType:      "image/png",
				Chunk:         []byte("lo"),
				RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				ModelResolved: "sd3",
				TraceId:       "trace-1",
				Usage: &runtimev1.UsageStats{
					InputTokens:  7,
					OutputTokens: 3,
					ComputeMs:    12,
				},
			},
		},
	}

	got, err := collectArtifactStream(stream)
	if err != nil {
		t.Fatalf("collectArtifactStream: %v", err)
	}
	if got.ArtifactID != "artifact-1" {
		t.Fatalf("artifact id mismatch: %s", got.ArtifactID)
	}
	if got.MimeType != "image/png" {
		t.Fatalf("mime mismatch: %s", got.MimeType)
	}
	if string(got.Payload) != "hello" {
		t.Fatalf("payload mismatch: %q", string(got.Payload))
	}
	if got.RouteDecision != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		t.Fatalf("route decision mismatch: %v", got.RouteDecision)
	}
	if got.ModelResolved != "sd3" {
		t.Fatalf("model resolved mismatch: %s", got.ModelResolved)
	}
	if got.TraceID != "trace-1" {
		t.Fatalf("trace mismatch: %s", got.TraceID)
	}
	if got.Usage.GetInputTokens() != 7 || got.Usage.GetOutputTokens() != 3 || got.Usage.GetComputeMs() != 12 {
		t.Fatalf("usage mismatch: in=%d out=%d ms=%d", got.Usage.GetInputTokens(), got.Usage.GetOutputTokens(), got.Usage.GetComputeMs())
	}
}

func TestCollectArtifactStreamNoChunks(t *testing.T) {
	stream := &artifactChunkReceiverStub{
		chunks: []*runtimev1.ArtifactChunk{},
	}

	_, err := collectArtifactStream(stream)
	if err == nil {
		t.Fatalf("expected no-chunks error")
	}
	if err.Error() != "artifact stream returned no chunks" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCollectArtifactStreamRecvError(t *testing.T) {
	stream := &artifactChunkReceiverStub{
		chunks: []*runtimev1.ArtifactChunk{
			{
				ArtifactId: "artifact-1",
				MimeType:   "image/png",
				Chunk:      []byte("hello"),
			},
		},
		errAfterChunks: errors.New("network broken"),
	}

	_, err := collectArtifactStream(stream)
	if err == nil {
		t.Fatalf("expected recv error")
	}
	if err.Error() != "recv artifact chunk: network broken" {
		t.Fatalf("unexpected error: %v", err)
	}
}

type artifactChunkReceiverStub struct {
	chunks         []*runtimev1.ArtifactChunk
	index          int
	errAfterChunks error
}

func (s *artifactChunkReceiverStub) Recv() (*runtimev1.ArtifactChunk, error) {
	if s.index < len(s.chunks) {
		item := s.chunks[s.index]
		s.index++
		return item, nil
	}
	if s.errAfterChunks != nil {
		return nil, s.errAfterChunks
	}
	return nil, io.EOF
}
