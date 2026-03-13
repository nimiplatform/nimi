package ai

import (
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestResolveMusicGenerateExtensionPayload(t *testing.T) {
	t.Run("valid iteration payload normalizes", func(t *testing.T) {
		req := baseScenarioJobRequest()
		req.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE
		req.Spec = &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_MusicGenerate{
				MusicGenerate: &runtimev1.MusicGenerateScenarioSpec{Prompt: "continue this track"},
			},
		}
		req.Extensions = []*runtimev1.ScenarioExtension{{
			Namespace: "nimi.scenario.music_generate.request",
			Payload: mustStructPayloadForMusicExtensionTest(t, map[string]any{
				"mode":                "extend",
				"source_audio_base64": "aGVsbG8=",
				"source_mime_type":    "audio/mpeg",
				"trim_start_sec":      2.5,
				"trim_end_sec":        9.75,
			}),
		}}

		payload, iteration, err := resolveMusicGenerateExtensionPayload(req)
		if err != nil {
			t.Fatalf("resolveMusicGenerateExtensionPayload returned error: %v", err)
		}
		if iteration == nil {
			t.Fatal("expected parsed iteration payload")
		}
		if payload["mode"] != "extend" {
			t.Fatalf("unexpected mode payload: %#v", payload["mode"])
		}
		if payload["trim_start_sec"] != 2.5 {
			t.Fatalf("unexpected trim_start_sec payload: %#v", payload["trim_start_sec"])
		}
		if payload["trim_end_sec"] != 9.75 {
			t.Fatalf("unexpected trim_end_sec payload: %#v", payload["trim_end_sec"])
		}
	})

	t.Run("invalid payload returns spec invalid", func(t *testing.T) {
		req := baseScenarioJobRequest()
		req.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE
		req.Spec = &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_MusicGenerate{
				MusicGenerate: &runtimev1.MusicGenerateScenarioSpec{Prompt: "broken"},
			},
		}
		req.Extensions = []*runtimev1.ScenarioExtension{{
			Namespace: "nimi.scenario.music_generate.request",
			Payload: mustStructPayloadForMusicExtensionTest(t, map[string]any{
				"mode":           "extend",
				"trim_start_sec": -1,
			}),
		}}

		_, _, err := resolveMusicGenerateExtensionPayload(req)
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID {
			t.Fatalf("expected AI_MEDIA_SPEC_INVALID, got reason=%v ok=%v err=%v", reason, ok, err)
		}
	})
}

func TestValidateMusicGenerateIterationSupport(t *testing.T) {
	iteration := &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: "nimi.scenario.music_generate.request",
			Payload: mustStructPayloadForMusicExtensionTest(t, map[string]any{
				"mode":                "remix",
				"source_audio_base64": "aGVsbG8=",
			}),
		}},
	}
	_, parsed, err := resolveMusicGenerateExtensionPayload(iteration)
	if err != nil {
		t.Fatalf("resolveMusicGenerateExtensionPayload returned error: %v", err)
	}

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	if err := validateMusicGenerateIterationSupport(svc, "suno/suno-v4", nil, nil, parsed); err != nil {
		t.Fatalf("expected suno iteration support, got err=%v", err)
	}
	if err := validateMusicGenerateIterationSupport(svc, "stability/stable-audio-2", nil, nil, parsed); err != nil {
		t.Fatalf("expected stability iteration support, got err=%v", err)
	}
	err = validateMusicGenerateIterationSupport(svc, "openai/gpt-5.2", nil, nil, parsed)
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func mustStructPayloadForMusicExtensionTest(t *testing.T, input map[string]any) *structpb.Struct {
	t.Helper()
	value, err := structpb.NewStruct(input)
	if err != nil {
		t.Fatalf("NewStruct failed: %v", err)
	}
	return value
}
