package nimillm

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestNormalizeMusicIterationExtension(t *testing.T) {
	t.Run("empty payload returns nil", func(t *testing.T) {
		payload, iteration, err := NormalizeMusicIterationExtension(nil)
		if err != nil {
			t.Fatalf("NormalizeMusicIterationExtension returned error: %v", err)
		}
		if payload != nil || iteration != nil {
			t.Fatalf("expected nil payload and iteration, got payload=%v iteration=%v", payload, iteration)
		}
	})

	t.Run("valid payload normalizes", func(t *testing.T) {
		payload, iteration, err := NormalizeMusicIterationExtension(map[string]any{
			"mode":                "reference",
			"source_audio_base64": "aGVsbG8=",
			"source_mime_type":    "audio/wav",
			"trim_start_sec":      "1.25",
			"trim_end_sec":        5.5,
		})
		if err != nil {
			t.Fatalf("NormalizeMusicIterationExtension returned error: %v", err)
		}
		if iteration == nil {
			t.Fatal("expected parsed iteration payload")
		}
		if payload["mode"] != "reference" {
			t.Fatalf("unexpected normalized mode: %#v", payload["mode"])
		}
		if payload["trim_start_sec"] != 1.25 {
			t.Fatalf("unexpected trim_start_sec: %#v", payload["trim_start_sec"])
		}
		if payload["trim_end_sec"] != 5.5 {
			t.Fatalf("unexpected trim_end_sec: %#v", payload["trim_end_sec"])
		}
	})

	t.Run("unknown keys fail closed", func(t *testing.T) {
		_, _, err := NormalizeMusicIterationExtension(map[string]any{
			"mode":                "extend",
			"source_audio_base64": "aGVsbG8=",
			"provider_json":       map[string]any{"foo": "bar"},
		})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID {
			t.Fatalf("expected AI_MEDIA_SPEC_INVALID, got reason=%v ok=%v err=%v", reason, ok, err)
		}
	})
}

func TestMusicIterationSupportHelpers(t *testing.T) {
	if !SupportsMusicGenerationIterationStrategy("stability") {
		t.Fatal("expected stability strategy iteration support")
	}
	if SupportsMusicGenerationIterationStrategy("openai") {
		t.Fatal("did not expect openai strategy iteration support")
	}
	if !SupportsMusicGenerationIterationStrategy("cloud-stability") {
		t.Fatal("expected cloud-stability backend iteration support")
	}
	if SupportsMusicGenerationIterationStrategy("cloud-soundverse") {
		t.Fatal("did not expect cloud-soundverse backend iteration support")
	}
	if SupportsMusicGenerationIterationStrategy("cloud-openai") {
		t.Fatal("did not expect cloud-openai backend iteration support")
	}
}
