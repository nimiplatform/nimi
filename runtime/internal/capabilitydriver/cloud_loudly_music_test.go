package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestLoudlyExactNativeInputBounds(t *testing.T) {
	base := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: &runtimev1.MusicGenerateScenarioSpec{Prompt: "instrumental cue", Instrumental: true}}}}
	if err := validateLoudlyMusicRequest(base, "VEGA_2"); err != nil || base.Spec.GetMusicGenerate().DurationSeconds != 30 {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*runtimev1.MusicGenerateScenarioSpec){"duration below": func(s *runtimev1.MusicGenerateScenarioSpec) { s.DurationSeconds = 29 }, "duration above": func(s *runtimev1.MusicGenerateScenarioSpec) { s.DurationSeconds = 421 }, "lyrics": func(s *runtimev1.MusicGenerateScenarioSpec) { s.Lyrics = "words" }, "style": func(s *runtimev1.MusicGenerateScenarioSpec) { s.Style = "loop" }, "title": func(s *runtimev1.MusicGenerateScenarioSpec) { s.Title = "name" }, "negative": func(s *runtimev1.MusicGenerateScenarioSpec) { s.NegativePrompt = "noise" }, "seed": func(s *runtimev1.MusicGenerateScenarioSpec) { s.Seed = proto.Uint32(0) }, "reference": func(s *runtimev1.MusicGenerateScenarioSpec) {
		s.AudioReference = &runtimev1.MusicAudioInput{ArtifactId: "input"}
	}} {
		t.Run(name, func(t *testing.T) {
			req := proto.Clone(base).(*runtimev1.SubmitScenarioJobRequest)
			change(req.Spec.GetMusicGenerate())
			if err := validateLoudlyMusicRequest(req, "VEGA_2"); err == nil {
				t.Fatal("unsupported input dropped")
			}
		})
	}
	if err := validateLoudlyMusicRequest(base, "loudly-vega-2"); err == nil {
		t.Fatal("retired synthetic target admitted")
	}
}
