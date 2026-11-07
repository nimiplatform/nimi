package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"strings"
	"testing"
)

func TestMubertPreservesDurationAndRejectsUnmappedMusicControls(t *testing.T) {
	req := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: &runtimev1.MusicGenerateScenarioSpec{Prompt: "A calm cue.", DurationSeconds: 8}}}}
	if err := validateMubertMusicRequest(req, MubertTrackModel); err != nil || req.Spec.GetMusicGenerate().DurationSeconds != 8 {
		t.Fatal("duration clamped", err)
	}
	for name, change := range map[string]func(*runtimev1.MusicGenerateScenarioSpec){"style keyword": func(s *runtimev1.MusicGenerateScenarioSpec) { s.Style = "low loop" }, "instrumental": func(s *runtimev1.MusicGenerateScenarioSpec) { s.Instrumental = true }, "lyrics": func(s *runtimev1.MusicGenerateScenarioSpec) { s.Lyrics = "words" }, "seed zero": func(s *runtimev1.MusicGenerateScenarioSpec) { s.Seed = proto.Uint32(0) }, "long prompt": func(s *runtimev1.MusicGenerateScenarioSpec) { s.Prompt = strings.Repeat("a", 201) }, "zero or excessive": func(s *runtimev1.MusicGenerateScenarioSpec) { s.DurationSeconds = 601 }} {
		t.Run(name, func(t *testing.T) {
			copy := proto.Clone(req).(*runtimev1.SubmitScenarioJobRequest)
			change(copy.Spec.GetMusicGenerate())
			if err := validateMubertMusicRequest(copy, MubertTrackModel); err == nil {
				t.Fatal("condition dropped")
			}
		})
	}
	req.Spec.GetMusicGenerate().DurationSeconds = 0
	if err := validateMubertMusicRequest(req, MubertTrackModel); err != nil || req.Spec.GetMusicGenerate().DurationSeconds != 30 {
		t.Fatal("missing duration capture", err)
	}
}
