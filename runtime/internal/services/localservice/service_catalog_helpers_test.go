package localservice

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestBuildNodeProviderHintsNimiMediaDoesNotSynthesizeCatalogMetadata(t *testing.T) {
	hints := buildNodeProviderHints(
		&runtimev1.LocalServiceDescriptor{
			ServiceId: "svc-nimi-media",
			Engine:    "nimi_media",
			Endpoint:  "http://127.0.0.1:8321/v1",
		},
		"nimi_media",
		"image",
		"nimi_media_native_adapter",
		"",
		true,
		&runtimev1.LocalDeviceProfile{Os: "windows"},
	)
	if hints == nil || hints.GetNimiMedia() == nil {
		t.Fatal("expected nimi_media provider hints")
	}
	if hints.GetNimiMedia().GetFamily() != "" {
		t.Fatalf("expected empty family without real catalog metadata, got %q", hints.GetNimiMedia().GetFamily())
	}
	if hints.GetNimiMedia().GetImageDriver() != "" {
		t.Fatalf("expected empty image driver without real catalog metadata, got %q", hints.GetNimiMedia().GetImageDriver())
	}
	if hints.GetNimiMedia().GetVideoDriver() != "" {
		t.Fatalf("expected empty video driver without real catalog metadata, got %q", hints.GetNimiMedia().GetVideoDriver())
	}
	if hints.GetNimiMedia().GetDevice() != "" {
		t.Fatalf("expected empty device without real catalog metadata, got %q", hints.GetNimiMedia().GetDevice())
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

func TestAdapterForProviderCapabilityHardCutsUnsupportedNexaMedia(t *testing.T) {
	if got := adapterForProviderCapability("nexa", "image"); got != "openai_compat_adapter" {
		t.Fatalf("nexa image adapter mismatch: %s", got)
	}
	if got := adapterForProviderCapability("nexa", "video"); got != "openai_compat_adapter" {
		t.Fatalf("nexa video adapter mismatch: %s", got)
	}
	if got := adapterForProviderCapability("nexa", "tts"); got != "nexa_native_adapter" {
		t.Fatalf("nexa tts adapter mismatch: %s", got)
	}
	if got := adapterForProviderCapability("nexa", "chat"); got != "nexa_native_adapter" {
		t.Fatalf("nexa chat adapter mismatch: %s", got)
	}
}
