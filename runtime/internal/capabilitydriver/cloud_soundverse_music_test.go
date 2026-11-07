package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"strings"
	"testing"
)

func TestSoundverseCurrentMusicCapturesOnlySupportedConditions(t *testing.T) {
	for _, model := range []string{"v6", "v7"} {
		t.Run(model, func(t *testing.T) {
			req := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: &runtimev1.MusicGenerateScenarioSpec{Prompt: strings.Repeat("中", 1024), Lyrics: strings.Repeat("字", 3000)}}}}
			if err := validateSoundverseMusicRequest(req, model); err != nil || req.Spec.GetMusicGenerate().DurationSeconds != 600 {
				t.Fatal("output budget capture", err)
			}
			for name, change := range map[string]func(*runtimev1.MusicGenerateScenarioSpec){"prompt": func(s *runtimev1.MusicGenerateScenarioSpec) { s.Prompt += "x" }, "lyrics": func(s *runtimev1.MusicGenerateScenarioSpec) { s.Lyrics += "x" }, "duration": func(s *runtimev1.MusicGenerateScenarioSpec) { s.DurationSeconds = 30 }, "style": func(s *runtimev1.MusicGenerateScenarioSpec) { s.Style = "rock" }, "instrumental lyrics": func(s *runtimev1.MusicGenerateScenarioSpec) { s.Instrumental = true }, "seed zero": func(s *runtimev1.MusicGenerateScenarioSpec) { s.Seed = proto.Uint32(0) }} {
				t.Run(name, func(t *testing.T) {
					copy := proto.Clone(req).(*runtimev1.SubmitScenarioJobRequest)
					change(copy.Spec.GetMusicGenerate())
					if err := validateSoundverseMusicRequest(copy, model); err == nil {
						t.Fatal("unsupported condition ignored")
					}
				})
			}
			req.Spec.GetMusicGenerate().Lyrics = ""
			req.Spec.GetMusicGenerate().Instrumental = true
			if err := validateSoundverseMusicRequest(req, model); err != nil {
				t.Fatal(err)
			}
			if err := validateSoundverseMusicRequest(req, "soundverse-song-v5"); err == nil {
				t.Fatal("old sync target admitted")
			}
		})
	}
}
