package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestUploadArtifactStoresArtifact(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	artifactStore := runtimeartifact.NewMemoryStore()
	svc.SetRuntimeArtifactStore(artifactStore)
	stream := &mockUploadArtifactStream{ctx: context.Background(), reqs: []*runtimev1.UploadArtifactRequest{
		{Payload: &runtimev1.UploadArtifactRequest_Metadata{Metadata: &runtimev1.UploadArtifactMetadata{
			AppId: "nimi.desktop", SubjectUserId: "user-001", MimeType: "audio/wav", DisplayName: "prompt.wav",
		}}},
		{Payload: &runtimev1.UploadArtifactRequest_Chunk{Chunk: &runtimev1.UploadArtifactChunk{Sequence: 0, Bytes: []byte("wave-bytes")}}},
	}}
	if err := svc.UploadArtifact(stream); err != nil {
		t.Fatalf("upload artifact: %v", err)
	}
	if stream.resp == nil || stream.resp.GetArtifact() == nil {
		t.Fatal("expected upload response artifact")
	}
	artifact := stream.resp.GetArtifact()
	if artifact.GetArtifactId() == "" || len(artifact.GetBytes()) != 0 || artifact.GetSizeBytes() != int64(len("wave-bytes")) {
		t.Fatalf("unexpected artifact projection: %+v", artifact)
	}
	stored, _, ok := svc.scenarioJobs.findArtifact("nimi.desktop", "user-001", artifact.GetArtifactId())
	if !ok || stored == nil || string(stored.GetBytes()) != "wave-bytes" {
		t.Fatalf("stored artifact = %+v found=%v", stored, ok)
	}
	record, ok := artifactStore.Get(artifact.GetArtifactId())
	if !ok || string(record.Bytes) != "wave-bytes" || record.MimeType != "audio/wav" || record.Owner == nil ||
		record.Owner.SubjectUserID != "user-001" || record.Owner.AppID != "nimi.desktop" {
		t.Fatalf("unexpected runtime artifact record: %+v found=%v", record, ok)
	}
}

func TestUploadArtifactRejectsInvalidMime(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	stream := &mockUploadArtifactStream{ctx: context.Background(), reqs: []*runtimev1.UploadArtifactRequest{
		{Payload: &runtimev1.UploadArtifactRequest_Metadata{Metadata: &runtimev1.UploadArtifactMetadata{AppId: "nimi.desktop", SubjectUserId: "user-001", MimeType: "text/plain"}}},
		{Payload: &runtimev1.UploadArtifactRequest_Chunk{Chunk: &runtimev1.UploadArtifactChunk{Sequence: 0, Bytes: []byte("bad")}}},
	}}
	if err := svc.UploadArtifact(stream); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("status code mismatch: got=%s want=%s err=%v", status.Code(err), codes.InvalidArgument, err)
	}
}

func TestUploadArtifactStoresNormalizedMimeType(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	stream := &mockUploadArtifactStream{ctx: context.Background(), reqs: []*runtimev1.UploadArtifactRequest{
		{Payload: &runtimev1.UploadArtifactRequest_Metadata{Metadata: &runtimev1.UploadArtifactMetadata{AppId: "nimi.desktop", SubjectUserId: "user-001", MimeType: "Audio/WAV"}}},
		{Payload: &runtimev1.UploadArtifactRequest_Chunk{Chunk: &runtimev1.UploadArtifactChunk{Sequence: 0, Bytes: []byte("wave-bytes")}}},
	}}
	if err := svc.UploadArtifact(stream); err != nil {
		t.Fatalf("upload artifact: %v", err)
	}
	if stream.resp == nil || stream.resp.GetArtifact() == nil || stream.resp.GetArtifact().GetMimeType() != "audio/wav" {
		t.Fatalf("unexpected normalized response: %+v", stream.resp)
	}
}

func TestUploadArtifactRejectsOversizedChunk(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	stream := &mockUploadArtifactStream{ctx: context.Background(), reqs: []*runtimev1.UploadArtifactRequest{
		{Payload: &runtimev1.UploadArtifactRequest_Metadata{Metadata: &runtimev1.UploadArtifactMetadata{AppId: "nimi.desktop", SubjectUserId: "user-001", MimeType: "audio/wav"}}},
		{Payload: &runtimev1.UploadArtifactRequest_Chunk{Chunk: &runtimev1.UploadArtifactChunk{Sequence: 0, Bytes: make([]byte, maxUploadedArtifactChunkBytes+1)}}},
	}}
	err := svc.UploadArtifact(stream)
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("status code mismatch: got=%s want=%s err=%v", status.Code(err), codes.InvalidArgument, err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_TOO_LARGE {
		t.Fatalf("unexpected reason: got=%v ok=%v", reason, ok)
	}
}

type mockUploadArtifactStream struct {
	ctx   context.Context
	reqs  []*runtimev1.UploadArtifactRequest
	resp  *runtimev1.UploadArtifactResponse
	index int
}

func (m *mockUploadArtifactStream) Recv() (*runtimev1.UploadArtifactRequest, error) {
	if m.index >= len(m.reqs) {
		return nil, io.EOF
	}
	req := m.reqs[m.index]
	m.index++
	return req, nil
}

func (m *mockUploadArtifactStream) SendAndClose(resp *runtimev1.UploadArtifactResponse) error {
	m.resp = resp
	return nil
}
func (m *mockUploadArtifactStream) Context() context.Context       { return m.ctx }
func (m *mockUploadArtifactStream) SendHeader(_ metadata.MD) error { return nil }
func (m *mockUploadArtifactStream) SetHeader(_ metadata.MD) error  { return nil }
func (m *mockUploadArtifactStream) SetTrailer(_ metadata.MD)       {}
func (m *mockUploadArtifactStream) SendMsg(any) error              { return nil }
func (m *mockUploadArtifactStream) RecvMsg(any) error              { return nil }
