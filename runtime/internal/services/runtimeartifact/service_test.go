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

func TestCleanupGeneratedVoiceArtifactsByAgentAndConversation(t *testing.T) {
	store := NewMemoryStore()
	if err := store.Put("voice-1", ArtifactRecord{
		Bytes:     []byte("audio-1"),
		MimeType:  "audio/wav",
		SizeBytes: 7,
		GeneratedVoice: &GeneratedVoiceArtifactMetadata{
			AgentID:              "agent-1",
			ConversationAnchorID: "anchor-1",
			TurnID:               "turn-1",
			MessageID:            "message-1",
			VoiceReference:       "preset_voice_id:voice-1",
			SpeechModelID:        "speech/model",
			RoutePolicy:          "local",
		},
	}); err != nil {
		t.Fatalf("Put voice-1: %v", err)
	}
	if err := store.Put("voice-2", ArtifactRecord{
		Bytes:     []byte("audio-2"),
		MimeType:  "audio/wav",
		SizeBytes: 7,
		GeneratedVoice: &GeneratedVoiceArtifactMetadata{
			AgentID:              "agent-1",
			ConversationAnchorID: "anchor-2",
			TurnID:               "turn-2",
			MessageID:            "message-2",
		},
	}); err != nil {
		t.Fatalf("Put voice-2: %v", err)
	}
	if err := store.Put("image-1", ArtifactRecord{
		Bytes:     []byte("image"),
		MimeType:  "image/png",
		SizeBytes: 5,
	}); err != nil {
		t.Fatalf("Put image-1: %v", err)
	}

	record, ok := store.Get("voice-1")
	if !ok || record.GeneratedVoice == nil || record.GeneratedVoice.ByteDigest == "" {
		t.Fatalf("expected generated voice metadata with byte digest, got %#v ok=%v", record.GeneratedVoice, ok)
	}
	deleted, err := store.CleanupGeneratedVoiceArtifacts(GeneratedVoiceArtifactSelector{
		AgentID:              "agent-1",
		ConversationAnchorID: "anchor-1",
	})
	if err != nil {
		t.Fatalf("CleanupGeneratedVoiceArtifacts: %v", err)
	}
	if len(deleted) != 1 || deleted[0] != "voice-1" {
		t.Fatalf("deleted mismatch: %#v", deleted)
	}
	if _, ok := store.Get("voice-1"); ok {
		t.Fatalf("voice-1 should be deleted")
	}
	if _, ok := store.Get("voice-2"); !ok {
		t.Fatalf("voice-2 should remain")
	}
	if _, ok := store.Get("image-1"); !ok {
		t.Fatalf("non-voice artifact should remain")
	}
}

func TestCleanupGeneratedVoiceArtifactsRPC(t *testing.T) {
	svc, store := newTestService(t)
	for _, artifactID := range []string{"voice-a", "voice-b"} {
		if err := store.Put(artifactID, ArtifactRecord{
			Bytes:     []byte(artifactID),
			MimeType:  "audio/wav",
			SizeBytes: int64(len(artifactID)),
			GeneratedVoice: &GeneratedVoiceArtifactMetadata{
				AgentID:              "agent-rpc",
				ConversationAnchorID: "anchor-rpc",
			},
		}); err != nil {
			t.Fatalf("Put %s: %v", artifactID, err)
		}
	}
	resp, err := svc.CleanupGeneratedVoiceArtifacts(context.Background(), &runtimev1.CleanupGeneratedVoiceArtifactsRequest{
		AgentId: "agent-rpc",
	})
	if err != nil {
		t.Fatalf("CleanupGeneratedVoiceArtifacts: %v", err)
	}
	if resp.GetDeletedCount() != 2 {
		t.Fatalf("deleted_count mismatch: got=%d", resp.GetDeletedCount())
	}
	if got := resp.GetDeletedArtifactIds(); len(got) != 2 || got[0] != "voice-a" || got[1] != "voice-b" {
		t.Fatalf("deleted ids mismatch: %#v", got)
	}
	if store.Len() != 0 {
		t.Fatalf("store should be empty after cleanup, len=%d", store.Len())
	}
}

func TestCleanupGeneratedVoiceArtifactsRejectsEmptySelector(t *testing.T) {
	svc, _ := newTestService(t)
	_, err := svc.CleanupGeneratedVoiceArtifacts(context.Background(), &runtimev1.CleanupGeneratedVoiceArtifactsRequest{})
	if err == nil {
		t.Fatalf("CleanupGeneratedVoiceArtifacts empty selector: expected error, got nil")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT {
		t.Fatalf("reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT)
	}
}
