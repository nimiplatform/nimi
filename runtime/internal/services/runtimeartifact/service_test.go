package runtimeartifact

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func newTestService(t *testing.T) (*Service, *MemoryStore) {
	t.Helper()
	store := NewMemoryStore()
	svc := New(store, slog.New(slog.NewTextHandler(io.Discard, nil)))
	return svc, store
}

// TestReadArtifactBytesExisting covers the happy path: an artifact written
// via Store.Put is returned bytes/mime/size-equal by ReadArtifactBytes.
func TestReadArtifactBytesExisting(t *testing.T) {
	svc, store := newTestService(t)
	bytes := []byte("hello-audio-bytes")
	if err := store.Put("artifact-001", ArtifactRecord{
		Bytes:        bytes,
		MimeType:     "audio/wav",
		SizeBytes:    int64(len(bytes)),
		MimeInferred: false,
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}

	resp, err := svc.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{
		ArtifactId: "artifact-001",
	})
	if err != nil {
		t.Fatalf("ReadArtifactBytes: %v", err)
	}
	if string(resp.GetBytes()) != string(bytes) {
		t.Fatalf("bytes mismatch: got=%q want=%q", resp.GetBytes(), bytes)
	}
	if resp.GetMimeType() != "audio/wav" {
		t.Fatalf("mime_type mismatch: got=%q want=audio/wav", resp.GetMimeType())
	}
	if resp.GetSizeBytes() != int64(len(bytes)) {
		t.Fatalf("size_bytes mismatch: got=%d want=%d", resp.GetSizeBytes(), len(bytes))
	}
	if resp.GetMimeInferred() {
		t.Fatalf("mime_inferred mismatch: got=true want=false")
	}
}

// TestReadArtifactBytesInvalidInput covers ARTIFACT_INVALID_INPUT path:
// empty artifact_id must produce InvalidArgument + ReasonCode_ARTIFACT_INVALID_INPUT.
func TestReadArtifactBytesInvalidInput(t *testing.T) {
	svc, _ := newTestService(t)

	_, err := svc.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{
		ArtifactId: "   ",
	})
	if err == nil {
		t.Fatalf("ReadArtifactBytes empty id: expected error, got nil")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT {
		t.Fatalf("reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT)
	}
}

// TestReadArtifactBytesNotFound covers ARTIFACT_NOT_FOUND path: missing id
// must produce NotFound + ReasonCode_ARTIFACT_NOT_FOUND.
func TestReadArtifactBytesNotFound(t *testing.T) {
	svc, _ := newTestService(t)

	_, err := svc.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{
		ArtifactId: "missing-artifact-id",
	})
	if err == nil {
		t.Fatalf("ReadArtifactBytes missing id: expected error, got nil")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_ARTIFACT_NOT_FOUND {
		t.Fatalf("reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
	}
}

// TestReadArtifactBytesTooLarge covers ARTIFACT_TOO_LARGE path: artifact
// whose SizeBytes exceeds MaxInlineBytes (32 MiB) must produce
// ResourceExhausted + ReasonCode_ARTIFACT_TOO_LARGE.
//
// We exercise the size cap without allocating actual 32 MiB by recording
// SizeBytes > MaxInlineBytes while keeping Bytes empty. The server-side
// check is on record.SizeBytes, not on len(record.Bytes); this test
// matches the contract surface where size_bytes is the authoritative
// declaration.
func TestReadArtifactBytesTooLarge(t *testing.T) {
	svc, store := newTestService(t)
	if err := store.Put("artifact-too-large", ArtifactRecord{
		Bytes:     nil,
		MimeType:  "video/mp4",
		SizeBytes: MaxInlineBytes + 1,
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}

	_, err := svc.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{
		ArtifactId: "artifact-too-large",
	})
	if err == nil {
		t.Fatalf("ReadArtifactBytes oversized: expected error, got nil")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_ARTIFACT_TOO_LARGE {
		t.Fatalf("reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
}

// TestStorePutValidates ensures Store.Put rejects empty artifact_id at
// the storage layer (defensive; gRPC handler also rejects).
func TestStorePutValidates(t *testing.T) {
	store := NewMemoryStore()
	err := store.Put(" ", ArtifactRecord{Bytes: []byte("x")})
	if err == nil {
		t.Fatalf("Put empty id: expected error, got nil")
	}
}

func TestStoreNormalizesRecord(t *testing.T) {
	store := NewMemoryStore()
	input := []byte("payload")
	if err := store.Put(" artifact-id ", ArtifactRecord{Bytes: input}); err != nil {
		t.Fatalf("Put: %v", err)
	}
	input[0] = 'x'
	record, ok := store.Get("artifact-id")
	if !ok {
		t.Fatalf("Get: missing record")
	}
	if string(record.Bytes) != "payload" {
		t.Fatalf("bytes were not isolated: got=%q", record.Bytes)
	}
	if record.SizeBytes != int64(len("payload")) {
		t.Fatalf("size_bytes mismatch: got=%d want=%d", record.SizeBytes, len("payload"))
	}
	if record.MimeType != "application/octet-stream" || !record.MimeInferred {
		t.Fatalf("mime normalization mismatch: mime=%q inferred=%v", record.MimeType, record.MimeInferred)
	}
}

// TestStoreDeleteIdempotent ensures Store.Delete is idempotent for both
// existing and missing ids (matching contract: delete missing is not an
// error).
func TestStoreDeleteIdempotent(t *testing.T) {
	store := NewMemoryStore()
	if err := store.Put("p1", ArtifactRecord{Bytes: []byte("x"), SizeBytes: 1}); err != nil {
		t.Fatalf("Put: %v", err)
	}
	if err := store.Delete("p1"); err != nil {
		t.Fatalf("Delete existing: %v", err)
	}
	if err := store.Delete("p1"); err != nil {
		t.Fatalf("Delete missing should be idempotent, got: %v", err)
	}
	if _, ok := store.Get("p1"); ok {
		t.Fatalf("Delete left record")
	}
}
