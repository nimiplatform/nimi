package runtimeartifact

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDiskStorePersistsGeneratedVoiceArtifactsAcrossReopen(t *testing.T) {
	root := filepath.Join(t.TempDir(), "runtime-artifacts")
	store, err := NewDiskStore(root)
	if err != nil {
		t.Fatalf("NewDiskStore: %v", err)
	}
	payload := []byte("durable voice payload")
	if err := store.Put("artifact/voice:1", ArtifactRecord{
		Bytes:     payload,
		MimeType:  "Audio/Wav",
		CreatedAt: artifactTestNow,
		Audience:  artifactTestAudience(),
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
	if record.Audience == nil || record.Audience.AppID != "world.nimi.app" || record.ContentSHA256 == "" {
		t.Fatalf("artifact audience/hash was not persisted: audience=%#v hash=%q", record.Audience, record.ContentSHA256)
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

func TestDiskStoreRejectsPayloadTampering(t *testing.T) {
	root := filepath.Join(t.TempDir(), "runtime-artifacts")
	store, err := NewDiskStore(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Put("artifact-tamper", ArtifactRecord{Bytes: []byte("original"), CreatedAt: artifactTestNow, Audience: artifactTestAudience()}); err != nil {
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
	first := ArtifactRecord{Bytes: []byte("first"), CreatedAt: artifactTestNow, Audience: artifactTestAudience()}
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
	if err := store.Put("artifact-immutable", ArtifactRecord{Bytes: []byte("second"), CreatedAt: artifactTestNow, Audience: artifactTestAudience()}); err == nil {
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
