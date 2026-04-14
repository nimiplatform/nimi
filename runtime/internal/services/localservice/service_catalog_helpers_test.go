package localservice

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestBuildNodeProviderHintsMediaDoesNotSynthesizeCatalogMetadata(t *testing.T) {
	hints := buildNodeProviderHints(
		&runtimev1.LocalServiceDescriptor{
			ServiceId: "svc-media",
			Engine:    "media",
			Endpoint:  "http://127.0.0.1:8321/v1",
		},
		"media",
		"image",
		"media_native_adapter",
		"",
		true,
		&runtimev1.LocalDeviceProfile{Os: "windows"},
	)
	if hints == nil || hints.GetMedia() == nil {
		t.Fatal("expected media provider hints")
	}
	if hints.GetMedia().GetFamily() != "" {
		t.Fatalf("expected empty family without real catalog metadata, got %q", hints.GetMedia().GetFamily())
	}
	if hints.GetMedia().GetImageDriver() != "" {
		t.Fatalf("expected empty image driver without real catalog metadata, got %q", hints.GetMedia().GetImageDriver())
	}
	if hints.GetMedia().GetVideoDriver() != "" {
		t.Fatalf("expected empty video driver without real catalog metadata, got %q", hints.GetMedia().GetVideoDriver())
	}
	if hints.GetMedia().GetDevice() != "" {
		t.Fatalf("expected empty device without real catalog metadata, got %q", hints.GetMedia().GetDevice())
	}
	if _, ok := hints.GetExtra()["image_driver"]; ok {
		t.Fatalf("extra image_driver should not be synthesized")
	}
	if _, ok := hints.GetExtra()["video_driver"]; ok {
		t.Fatalf("extra video_driver should not be synthesized")
	}
	if _, ok := hints.GetExtra()["device"]; ok {
		t.Fatalf("extra device should not be synthesized")
	}
}

func TestAdapterForProviderCapabilityUsesHardCutAdapters(t *testing.T) {
	if got := adapterForProviderCapability("llama", "chat"); got != "llama_native_adapter" {
		t.Fatalf("llama chat adapter mismatch: %s", got)
	}
	if got := adapterForProviderCapability("llama", "image.understand"); got != "llama_native_adapter" {
		t.Fatalf("llama image-understand adapter mismatch: %s", got)
	}
	if got := adapterForProviderCapability("media", "image"); got != "media_native_adapter" {
		t.Fatalf("media image adapter mismatch: %s", got)
	}
	if got := adapterForProviderCapability("speech", "audio.synthesize"); got != "speech_native_adapter" {
		t.Fatalf("speech synth adapter mismatch: %s", got)
	}
	if got := adapterForProviderCapability("speech", "voice_workflow.tts_t2v"); got != "openai_compat_adapter" {
		t.Fatalf("speech workflow adapter should fail closed to non-native adapter, got: %s", got)
	}
	if got := adapterForProviderCapability("sidecar", "music"); got != "sidecar_music_adapter" {
		t.Fatalf("sidecar music adapter mismatch: %s", got)
	}
}
