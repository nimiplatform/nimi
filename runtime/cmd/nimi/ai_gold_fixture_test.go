package main

import (
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestAIGoldFixtureVoiceReferenceProtoPreservesKind(t *testing.T) {
	t.Run("preset", func(t *testing.T) {
		fixture := &aiGoldFixture{
			VoiceRef: &aiGoldVoiceReference{
				Kind: "preset_voice_id",
				ID:   "Cherry",
			},
		}
		ref := fixture.voiceReferenceProto()
		if ref == nil {
			t.Fatal("voiceReferenceProto returned nil")
		}
		if got := ref.GetKind(); got != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET {
			t.Fatalf("kind mismatch: %v", got)
		}
		if got := ref.GetPresetVoiceId(); got != "Cherry" {
			t.Fatalf("preset voice mismatch: %q", got)
		}
	})

	t.Run("provider", func(t *testing.T) {
		fixture := &aiGoldFixture{
			VoiceRef: &aiGoldVoiceReference{
				Kind: "provider_voice_ref",
				ID:   "cherry-provider-ref",
			},
		}
		ref := fixture.voiceReferenceProto()
		if ref == nil {
			t.Fatal("voiceReferenceProto returned nil")
		}
		if got := ref.GetKind(); got != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF {
			t.Fatalf("kind mismatch: %v", got)
		}
		if got := ref.GetProviderVoiceRef(); got != "cherry-provider-ref" {
			t.Fatalf("provider voice ref mismatch: %q", got)
		}
	})

	t.Run("voice_asset", func(t *testing.T) {
		fixture := &aiGoldFixture{
			VoiceRef: &aiGoldVoiceReference{
				Kind: "voice_asset_id",
				ID:   "voice-asset-123",
			},
		}
		ref := fixture.voiceReferenceProto()
		if ref == nil {
			t.Fatal("voiceReferenceProto returned nil")
		}
		if got := ref.GetKind(); got != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET {
			t.Fatalf("kind mismatch: %v", got)
		}
		if got := ref.GetVoiceAssetId(); got != "voice-asset-123" {
			t.Fatalf("voice asset mismatch: %q", got)
		}
	})
}

func TestAIGoldFixtureBuildSubmitScenarioJobRequestUsesAudioPathBytes(t *testing.T) {
	audioPath := filepath.Join(t.TempDir(), "sample.wav")
	if err := os.WriteFile(audioPath, []byte("wav-bytes"), 0o644); err != nil {
		t.Fatalf("write audio fixture: %v", err)
	}

	t.Run("audio transcribe", func(t *testing.T) {
		fixture := &aiGoldFixture{
			Path:          filepath.Join(t.TempDir(), "fixture.yaml"),
			Capability:    "audio.transcribe",
			Provider:      "dashscope",
			ModelID:       "qwen3-asr-flash-2026-02-10",
			Request:       aiGoldFixtureRequest{AudioPath: audioPath},
			VoiceRef:      nil,
			TargetModelID: "",
		}
		req, err := fixture.buildSubmitScenarioJobRequest("app.test", "user.test")
		if err != nil {
			t.Fatalf("buildSubmitScenarioJobRequest: %v", err)
		}
		source := req.GetSpec().GetSpeechTranscribe().GetAudioSource()
		if got := string(source.GetAudioBytes()); got != "wav-bytes" {
			t.Fatalf("audio bytes mismatch: %q", got)
		}
		if got := req.GetSpec().GetSpeechTranscribe().GetMimeType(); got != "audio/wav" {
			t.Fatalf("mime type mismatch: %q", got)
		}
	})

	t.Run("voice clone", func(t *testing.T) {
		fixture := &aiGoldFixture{
			Path:          filepath.Join(t.TempDir(), "fixture.yaml"),
			Capability:    "voice.clone",
			Provider:      "dashscope",
			ModelID:       "qwen3-tts-vc",
			TargetModelID: "qwen3-tts-vc-2026-01-22",
			Request:       aiGoldFixtureRequest{AudioPath: audioPath, Text: "Hello from the source clip."},
		}
		req, err := fixture.buildSubmitScenarioJobRequest("app.test", "user.test")
		if err != nil {
			t.Fatalf("buildSubmitScenarioJobRequest: %v", err)
		}
		input := req.GetSpec().GetVoiceClone().GetInput()
		if got := string(input.GetReferenceAudioBytes()); got != "wav-bytes" {
			t.Fatalf("reference audio bytes mismatch: %q", got)
		}
		if got := input.GetReferenceAudioMime(); got != "audio/wav" {
			t.Fatalf("reference audio mime mismatch: %q", got)
		}
		if got := input.GetReferenceAudioUri(); got != "" {
			t.Fatalf("expected empty reference audio uri, got=%q", got)
		}
		if got := input.GetText(); got != "Hello from the source clip." {
			t.Fatalf("reference audio transcript mismatch: %q", got)
		}
	})
}
