package runtimeartifact

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

type artifactTestZeroReader struct{}

func (artifactTestZeroReader) Read(payload []byte) (int, error) {
	for index := range payload {
		payload[index] = byte(index % 251)
	}
	return len(payload), nil
}

type artifactTestCountingCloser struct {
	io.Reader
	closes atomic.Int32
}

func (source *artifactTestCountingCloser) Close() error {
	source.closes.Add(1)
	return nil
}

func TestDiskStorePersistsGeneratedVoiceArtifactsAcrossReopen(t *testing.T) {
	root := filepath.Join(t.TempDir(), "runtime-artifacts")
	store, err := NewDiskStore(root)
	if err != nil {
		t.Fatalf("NewDiskStore: %v", err)
	}
	payload := []byte("durable voice payload")
	if err := store.Put("artifact/voice:1", ArtifactRecord{
		Bytes:         payload,
		MimeType:      "Audio/Wav",
		ProducerJobID: "runtime-job-durable",
		CreatedAt:     artifactTestNow,
		Owner:         artifactTestOwner(),
		GeneratedVoice: &GeneratedVoiceArtifactMetadata{
			AgentID:              "agent-durable",
			ConversationAnchorID: "anchor-durable",
			TurnID:               "turn-durable",
			MessageID:            "message-durable",
			VoiceReference:       "preset_voice_id:voice-durable",
			SpeechModelID:        "speech/model-durable",
			RoutePolicy:          "local",
		},
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}
	payload[0] = 'X'

	reopened, err := NewDiskStore(root)
	if err != nil {
		t.Fatalf("reopen NewDiskStore: %v", err)
	}
	record, ok := reopened.Get("artifact/voice:1")
	if !ok {
		t.Fatalf("reopened store missing generated voice artifact")
	}
	if string(record.Bytes) != "durable voice payload" {
		t.Fatalf("payload mismatch after reopen: %q", record.Bytes)
	}
	if record.MimeType != "audio/wav" {
		t.Fatalf("mime was not normalized: %q", record.MimeType)
	}
	if record.GeneratedVoice == nil || record.GeneratedVoice.ByteDigest == "" {
		t.Fatalf("generated voice metadata was not persisted: %#v", record.GeneratedVoice)
	}
	if record.Owner == nil || record.Owner.AppID != "nimi.desktop" || record.ContentSHA256 == "" || record.ProducerJobID != "runtime-job-durable" {
		t.Fatalf("artifact custody/hash was not persisted: producer_job_id=%q owner=%#v hash=%q", record.ProducerJobID, record.Owner, record.ContentSHA256)
	}

	deleted, err := reopened.CleanupGeneratedVoiceArtifacts(GeneratedVoiceArtifactSelector{
		ConversationAnchorID: "anchor-durable",
	})
	if err != nil {
		t.Fatalf("CleanupGeneratedVoiceArtifacts: %v", err)
	}
	if len(deleted) != 1 || deleted[0] != "artifact/voice:1" {
		t.Fatalf("deleted ids mismatch: %#v", deleted)
	}
	if _, ok := reopened.Get("artifact/voice:1"); ok {
		t.Fatalf("artifact should be deleted")
	}

	afterCleanup, err := NewDiskStore(root)
	if err != nil {
		t.Fatalf("reopen after cleanup: %v", err)
	}
	if afterCleanup.Len() != 0 {
		t.Fatalf("deleted artifact reappeared after reopen, len=%d", afterCleanup.Len())
	}
}

func TestDiskStorePersistsConversationAttachmentCandidateExpiryAcrossReopen(t *testing.T) {
	root := filepath.Join(t.TempDir(), "runtime-artifacts")
	store, err := NewDiskStore(root)
	if err != nil {
		t.Fatalf("NewDiskStore: %v", err)
	}
	expiresAt := artifactTestNow.Add(time.Hour)
	if err := store.Put("artifact-attachment-1", ArtifactRecord{
		Bytes:     []byte("attachment bytes"),
		MimeType:  "image/png",
		CreatedAt: artifactTestNow,
		Owner:     artifactTestOwner(),
		ConversationAttachment: &ConversationAttachmentArtifactMetadata{
			AgentID: "agent-1", ConversationAnchorID: "anchor-1",
			DisplayName: "photo.png", ExpiresAt: expiresAt,
		},
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}
	reopened, err := NewDiskStore(root)
	if err != nil {
		t.Fatalf("reopen NewDiskStore: %v", err)
	}
	record, ok := reopened.Get("artifact-attachment-1")
	if !ok || record.ConversationAttachment == nil ||
		record.ConversationAttachment.AgentID != "agent-1" ||
		record.ConversationAttachment.ConversationAnchorID != "anchor-1" ||
		record.ConversationAttachment.DisplayName != "photo.png" ||
		!record.ConversationAttachment.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("candidate metadata after reopen = %#v", record.ConversationAttachment)
	}
}

func TestDiskStoreRejectsPayloadTampering(t *testing.T) {
	root := filepath.Join(t.TempDir(), "runtime-artifacts")
	store, err := NewDiskStore(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Put("artifact-tamper", ArtifactRecord{Bytes: []byte("original"), CreatedAt: artifactTestNow, Owner: artifactTestOwner()}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, diskStorePayloadsDir, diskArtifactKey("artifact-tamper")+".bin"), []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, ok := store.Get("artifact-tamper"); ok {
		t.Fatal("tampered payload passed content hash/size validation")
	}
}

func TestDiskStoreKeepsArtifactIdentityImmutable(t *testing.T) {
	root := filepath.Join(t.TempDir(), "runtime-artifacts")
	store, err := NewDiskStore(root)
	if err != nil {
		t.Fatal(err)
	}
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
	if err := store.Put("artifact-immutable", ArtifactRecord{Bytes: []byte("second"), CreatedAt: artifactTestNow, Owner: artifactTestOwner()}); err == nil {
		t.Fatal("disk artifact content replacement succeeded")
	}
	record, ok := store.Get("artifact-immutable")
	if !ok || string(record.Bytes) != "first" || record.GeneratedVoice == nil || record.GeneratedVoice.AgentID != "agent-1" {
		t.Fatalf("immutable disk record changed: %#v ok=%v", record, ok)
	}
}

func TestDiskStoreForLocalStatePathUsesRuntimeArtifactsSiblingDirectory(t *testing.T) {
	dir := t.TempDir()
	store, err := NewDiskStoreForLocalStatePath(filepath.Join(dir, "local-state.json"))
	if err != nil {
		t.Fatalf("NewDiskStoreForLocalStatePath: %v", err)
	}
	if err := store.Put("artifact-1", ArtifactRecord{Bytes: []byte("payload")}); err != nil {
		t.Fatalf("Put: %v", err)
	}
	reopened, err := NewDiskStore(filepath.Join(dir, "runtime-artifacts"))
	if err != nil {
		t.Fatalf("NewDiskStore sibling: %v", err)
	}
	if _, ok := reopened.Get("artifact-1"); !ok {
		t.Fatalf("expected artifact under sibling runtime-artifacts directory")
	}
}

func TestDiskStoreStreamsLargeArtifactAndSeparatesStatFromOpen(t *testing.T) {
	store, err := NewDiskStore(filepath.Join(t.TempDir(), "runtime-artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	sizeBytes := int64(MaxInlineBytes + 1024*1024)
	source := &artifactTestCountingCloser{Reader: io.LimitReader(artifactTestZeroReader{}, sizeBytes)}
	if err := store.PutStream(context.Background(), "artifact-large", ArtifactRecord{
		MimeType: "video/mp4",
		Owner:    &ArtifactOwner{SubjectUserID: "account-1", RegisteredAppSubject: "subject-1", AppID: "producer-app"},
	}, source); err != nil {
		t.Fatalf("PutStream: %v", err)
	}
	if source.closes.Load() != 1 {
		t.Fatalf("source closes=%d, want exactly one", source.closes.Load())
	}
	metadata, ok := store.Stat("artifact-large")
	if !ok || metadata.SizeBytes != sizeBytes || len(metadata.Bytes) != 0 || metadata.ContentSHA256 == "" {
		t.Fatalf("Stat metadata=%+v present=%v", metadata, ok)
	}
	opened, ok := store.Open(context.Background(), "artifact-large")
	if !ok {
		t.Fatal("Open large committed artifact")
	}
	readBytes, err := io.Copy(io.Discard, opened.Body)
	if closeErr := opened.Body.Close(); err != nil || closeErr != nil || readBytes != sizeBytes {
		t.Fatalf("streamed read bytes=%d err=%v close=%v", readBytes, err, closeErr)
	}
}

func TestDiskStoreOpenPinsSourceAgainstCleanup(t *testing.T) {
	store, err := NewDiskStore(filepath.Join(t.TempDir(), "runtime-artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Put("artifact-pinned", ArtifactRecord{Bytes: []byte("immutable-source")}); err != nil {
		t.Fatal(err)
	}
	opened, ok := store.Open(context.Background(), "artifact-pinned")
	if !ok {
		t.Fatal("Open pinned source")
	}
	deleted := make(chan error, 1)
	go func() { deleted <- store.Delete("artifact-pinned") }()
	select {
	case err := <-deleted:
		t.Fatalf("cleanup completed while source open: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	payload, readErr := io.ReadAll(opened.Body)
	closeErr := opened.Body.Close()
	if readErr != nil || closeErr != nil || string(payload) != "immutable-source" {
		t.Fatalf("pinned read=%q readErr=%v closeErr=%v", payload, readErr, closeErr)
	}
	if err := <-deleted; err != nil {
		t.Fatalf("cleanup after close: %v", err)
	}
	if _, ok := store.Stat("artifact-pinned"); ok {
		t.Fatal("artifact remained after cleanup")
	}
}

func TestDiskStoreStreamCancellationCleansCandidateAndClosesOnce(t *testing.T) {
	store, err := NewDiskStore(filepath.Join(t.TempDir(), "runtime-artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	source := &artifactTestCountingCloser{Reader: io.LimitReader(artifactTestZeroReader{}, 4*1024*1024)}
	err = store.PutStream(ctx, "artifact-canceled", ArtifactRecord{MimeType: "video/mp4"}, source)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("PutStream error=%v, want context.Canceled", err)
	}
	if source.closes.Load() != 1 || store.Len() != 0 {
		t.Fatalf("canceled source closes=%d store len=%d", source.closes.Load(), store.Len())
	}
}
