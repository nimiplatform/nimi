package runtimeartifact

import (
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
		Bytes:    payload,
		MimeType: "Audio/Wav",
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
