package capabilitydriver

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestGeminiLyria35CapturesOutputBudgetWithoutInventingDurationControl(t *testing.T) {
	driver, target := cloudMediaDriverTarget(t, "gemini", geminiLyria35Model, "music.generate")
	request := geminiLyriaClipRequest(&runtimev1.MusicGenerateScenarioSpec{Prompt: "A two-minute instrumental folk song."})
	mapped, err := driver.MapRequest(target, request, nil, CloudMediaStreamNone)
	if err != nil || mapped.Adapter() != CloudMediaAdapterGeminiLyria35GenerateContent ||
		mapped.Request().GetSpec().GetMusicGenerate().GetDurationSeconds() != geminiLyria35MaxBudgetSeconds || request.GetSpec().GetMusicGenerate().GetDurationSeconds() != 0 {
		t.Fatalf("Lyria 3.5 default output budget capture: %+v %v", mapped, err)
	}
	explicit := geminiLyriaClipRequest(&runtimev1.MusicGenerateScenarioSpec{Prompt: "A short piano song.", DurationSeconds: 300})
	mapped, err = driver.MapRequest(target, explicit, nil, CloudMediaStreamNone)
	if err != nil || mapped.Request().GetSpec().GetMusicGenerate().GetDurationSeconds() != 300 {
		t.Fatalf("Lyria 3.5 exact explicit output ceiling was lost: %+v %v", mapped, err)
	}
	profile := CloudMusicInputCapabilities("gemini", geminiLyria35Model, "music.generate")
	if len(profile.GetGeneration()) != 1 || profile.GetGeneration()[0].GetMaxDurationSeconds() != 300 || profile.GetGeneration()[0].GetDefaultDurationSeconds() != 300 ||
		profile.GetGeneration()[0].GetLyricsMode() != "unsupported" {
		t.Fatalf("Lyria 3.5 input projection is incomplete: %+v", profile)
	}
	seed := uint32(4)
	for name, spec := range map[string]*runtimev1.MusicGenerateScenarioSpec{
		"separate lyrics":   {Prompt: "song", Lyrics: "hello"},
		"instrumental flag": {Prompt: "song", Instrumental: true},
		"prior audio":       {Prompt: "song", AudioReference: &runtimev1.MusicAudioInput{ArtifactId: "source"}},
		"score request":     {Prompt: "song", ReturnGeneratedScore: true},
		"seed":              {Prompt: "song", Seed: &seed},
		"oversized budget":  {Prompt: "song", DurationSeconds: 301},
		"shorter budget":    {Prompt: "song", DurationSeconds: 120},
		"oversized prompt":  {Prompt: strings.Repeat("é", geminiLyria35MaxPromptBytes/2+1)},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := driver.MapRequest(target, geminiLyriaClipRequest(spec), nil, CloudMediaStreamNone)
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
				t.Fatalf("unsupported Lyria 3.5 option reason=%v present=%v err=%v", reason, ok, err)
			}
		})
	}
}
