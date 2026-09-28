package capabilitydriver

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func geminiLyriaClipRequest(spec *runtimev1.MusicGenerateScenarioSpec) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: spec}}}
}

func TestGeminiLyriaClipDriverCapturesFixedDurationAndRejectsOtherModes(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "gemini", geminiLyriaClipModel, "music.generate")
	request := geminiLyriaClipRequest(&runtimev1.MusicGenerateScenarioSpec{Prompt: "A warm instrumental loop"})
	mapped, err := driver.MapRequest(target, request, nil, CloudMediaStreamNone)
	if err != nil || mapped.Adapter() != CloudMediaAdapterGeminiLyriaClipGenerateContent || mapped.Request().GetSpec().GetMusicGenerate().GetDurationSeconds() != 35 {
		t.Fatalf("Lyria fixed clip mapped=%+v err=%v", mapped, err)
	}
	if request.GetSpec().GetMusicGenerate().GetDurationSeconds() != 0 {
		t.Fatal("mapping mutated the caller request")
	}
	if _, err := driver.MapRequest(target, geminiLyriaClipRequest(&runtimev1.MusicGenerateScenarioSpec{Prompt: strings.Repeat("é", geminiLyriaClipMaxPromptBytes/2)}), nil, CloudMediaStreamNone); err != nil {
		t.Fatalf("exact UTF-8 byte-bound prompt rejected: %v", err)
	}
	profile := CloudMusicInputCapabilities("gemini", geminiLyriaClipModel, "music.generate")
	if len(profile.GetGeneration()) != 1 || profile.GetGeneration()[0].GetLyricsMode() != "unsupported" ||
		profile.GetGeneration()[0].GetMaxDurationSeconds() != 35 || profile.GetGeneration()[0].GetDefaultDurationSeconds() != 35 {
		t.Fatalf("Lyria projected input profile=%+v", profile)
	}
	if CloudMusicInputCapabilities("gemini", "gemini-3.1-flash-image", "music.generate") != nil {
		t.Fatal("non-music target acquired Lyria input profile")
	}
	seed := uint32(4)
	for name, spec := range map[string]*runtimev1.MusicGenerateScenarioSpec{
		"custom lyrics":     {Prompt: "warm loop", Lyrics: "hello"},
		"duration":          {Prompt: "warm loop", DurationSeconds: 20},
		"strict 30 budget":  {Prompt: "warm loop", DurationSeconds: 30},
		"instrumental mode": {Prompt: "warm loop", Instrumental: true},
		"seed":              {Prompt: "warm loop", Seed: &seed},
		"reference audio":   {Prompt: "warm loop", AudioReference: &runtimev1.MusicAudioInput{ArtifactId: "source"}},
		"score request":     {Prompt: "warm loop", ReturnGeneratedScore: true},
		"prompt byte limit": {Prompt: strings.Repeat("é", geminiLyriaClipMaxPromptBytes/2+1)},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := driver.MapRequest(target, geminiLyriaClipRequest(spec), nil, CloudMediaStreamNone)
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
				t.Fatalf("unsupported %s reason=%v present=%v err=%v", name, reason, ok, err)
			}
		})
	}
}
