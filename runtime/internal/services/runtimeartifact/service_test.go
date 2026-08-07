package runtimeartifact

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

var artifactTestNow = time.Date(2026, time.July, 11, 12, 0, 0, 0, time.UTC)

func newTestService(t *testing.T) (*Service, *MemoryStore) {
	t.Helper()
	store := NewMemoryStore()
	return New(store, slog.New(slog.NewTextHandler(io.Discard, nil))), store
}

func artifactTestOwner() *ArtifactOwner {
	return &ArtifactOwner{SubjectUserID: "account-1", AppID: "nimi.desktop"}
}

func TestReadArtifactBytesExisting(t *testing.T) {
	svc, store := newTestService(t)
	bytes := []byte("hello-audio-bytes")
	if err := store.Put("artifact-001", ArtifactRecord{
		Bytes: bytes, MimeType: "audio/wav", CreatedAt: artifactTestNow, Owner: artifactTestOwner(),
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}
	resp, err := svc.ReadArtifactBytes(
		putArtifactProtectedCtx("account-1", "nimi.desktop"),
		&runtimev1.ReadArtifactBytesRequest{ArtifactId: "artifact-001"},
	)
	if err != nil {
		t.Fatalf("ReadArtifactBytes: %v", err)
	}
	if string(resp.GetBytes()) != string(bytes) || resp.GetMimeType() != "audio/wav" || resp.GetSizeBytes() != int64(len(bytes)) || resp.GetMimeInferred() {
		t.Fatalf("artifact projection mismatch: %#v", resp)
	}
}

func TestReadArtifactBytesInvalidInput(t *testing.T) {
	svc, _ := newTestService(t)
	_, err := svc.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{ArtifactId: "   "})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT {
		t.Fatalf("reason mismatch: got=%v ok=%v", reason, ok)
	}
}

func TestReadArtifactBytesNotFound(t *testing.T) {
	svc, _ := newTestService(t)
	_, err := svc.ReadArtifactBytes(
		putArtifactProtectedCtx("account-1", "nimi.desktop"),
		&runtimev1.ReadArtifactBytesRequest{ArtifactId: "missing-artifact-id"},
	)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_ARTIFACT_NOT_FOUND {
		t.Fatalf("reason mismatch: got=%v ok=%v", reason, ok)
	}
}

func TestReadArtifactBytesTooLarge(t *testing.T) {
	svc, store := newTestService(t)
	payload := make([]byte, MaxInlineBytes+1)
	if err := store.Put("artifact-too-large", ArtifactRecord{
		Bytes: payload, MimeType: "video/mp4", CreatedAt: artifactTestNow, Owner: artifactTestOwner(),
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}
	_, err := svc.ReadArtifactBytes(
		putArtifactProtectedCtx("account-1", "nimi.desktop"),
		&runtimev1.ReadArtifactBytesRequest{ArtifactId: "artifact-too-large"},
	)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_ARTIFACT_TOO_LARGE {
		t.Fatalf("reason mismatch: got=%v ok=%v", reason, ok)
	}
}

func TestReadArtifactBytesRequiresMatchingProtectedOwner(t *testing.T) {
	svc, store := newTestService(t)
	if err := store.Put("artifact-bound", ArtifactRecord{
		Bytes: []byte("bound"), CreatedAt: artifactTestNow, Owner: artifactTestOwner(),
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Put("artifact-unowned", ArtifactRecord{Bytes: []byte("unowned")}); err != nil {
		t.Fatal(err)
	}
	for name, ctx := range map[string]context.Context{
		"ordinary caller": context.Background(),
		"cross account":   putArtifactProtectedCtx("account-2", "nimi.desktop"),
		"cross app":       putArtifactProtectedCtx("account-1", "other.app"),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := svc.ReadArtifactBytes(ctx, &runtimev1.ReadArtifactBytesRequest{ArtifactId: "artifact-bound"})
			if artifactReason(err) != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
				t.Fatalf("reason = %v, err=%v", artifactReason(err), err)
			}
		})
	}
	ownerCtx := putArtifactProtectedCtx("account-1", "nimi.desktop")
	if _, err := svc.ReadArtifactBytes(ownerCtx, &runtimev1.ReadArtifactBytesRequest{ArtifactId: "artifact-bound"}); err != nil {
		t.Fatalf("protected owner read: %v", err)
	}
	if _, err := svc.ReadArtifactBytes(ownerCtx, &runtimev1.ReadArtifactBytesRequest{ArtifactId: "artifact-unowned"}); artifactReason(err) != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
		t.Fatalf("unowned reason = %v", artifactReason(err))
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
	if record.ContentSHA256 == "" {
		t.Fatal("content hash was not bound")
	}
	if err := store.Put("bad-size", ArtifactRecord{Bytes: []byte("payload"), SizeBytes: 1}); !errors.Is(err, ErrInvalidArtifactRecord) {
		t.Fatalf("mismatched observed size err = %v", err)
	}
	if err := store.Put("bad-hash", ArtifactRecord{Bytes: []byte("payload"), ContentSHA256: "sha256:deadbeef"}); !errors.Is(err, ErrInvalidArtifactRecord) {
		t.Fatalf("mismatched content hash err = %v", err)
	}
	if err := store.Put("bad-owner", ArtifactRecord{Bytes: []byte("payload"), Owner: &ArtifactOwner{SubjectUserID: "account-1"}}); !errors.Is(err, ErrInvalidArtifactRecord) {
		t.Fatalf("incomplete owner err = %v", err)
	}
}

func TestStoreKeepsArtifactIdentityImmutable(t *testing.T) {
	store := NewMemoryStore()
	first := ArtifactRecord{Bytes: []byte("first"), CreatedAt: artifactTestNow, Owner: artifactTestOwner()}
	if err := store.Put("artifact-immutable", first); err != nil {
		t.Fatal(err)
	}
	if err := store.Put("artifact-immutable", first); err != nil {
		t.Fatalf("idempotent Put: %v", err)
	}
	enriched := first
	enriched.GeneratedVoice = &GeneratedVoiceArtifactMetadata{AgentID: "agent-1", ConversationAnchorID: "anchor-1"}
	if err := store.Put("artifact-immutable", enriched); err != nil {
		t.Fatalf("generated voice metadata enrichment: %v", err)
	}
	if err := store.Put("artifact-immutable", ArtifactRecord{Bytes: []byte("second"), CreatedAt: artifactTestNow, Owner: artifactTestOwner()}); !errors.Is(err, ErrInvalidArtifactRecord) {
		t.Fatalf("content replacement err = %v", err)
	}
	changedOwner := *artifactTestOwner()
	changedOwner.SubjectUserID = "account-2"
	if err := store.Put("artifact-immutable", ArtifactRecord{Bytes: []byte("first"), CreatedAt: artifactTestNow, Owner: &changedOwner}); !errors.Is(err, ErrInvalidArtifactRecord) {
		t.Fatalf("owner replacement err = %v", err)
	}
	record, ok := store.Get("artifact-immutable")
	if !ok || string(record.Bytes) != "first" || record.Owner == nil || record.Owner.SubjectUserID != "account-1" || record.GeneratedVoice == nil || record.GeneratedVoice.AgentID != "agent-1" {
		t.Fatalf("immutable record changed: %#v ok=%v", record, ok)
	}
}

func artifactTestIdentifier(value byte) protectedlocal.Identifier {
	var identifier protectedlocal.Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}

func artifactReason(err error) runtimev1.ReasonCode {
	reason, _ := grpcerr.ExtractReasonCode(err)
	return reason
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

type failingGeneratedVoiceCleanupStore struct {
	Store
	err error
}

func (s failingGeneratedVoiceCleanupStore) CleanupGeneratedVoiceArtifacts(GeneratedVoiceArtifactSelector) ([]string, error) {
	return nil, s.err
}

func TestCleanupGeneratedVoiceArtifactsPreservesStoreCause(t *testing.T) {
	cause := errors.New("private artifact store detail")
	svc := New(failingGeneratedVoiceCleanupStore{
		Store: NewMemoryStore(),
		err:   cause,
	}, slog.Default())

	_, err := svc.CleanupGeneratedVoiceArtifacts(context.Background(), &runtimev1.CleanupGeneratedVoiceArtifactsRequest{
		AgentId: "agent-cause",
	})
	if !errors.Is(err, cause) {
		t.Fatalf("cleanup error does not retain store cause: %v", err)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT {
		t.Fatalf("reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT)
	}
}
