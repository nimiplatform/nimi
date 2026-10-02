package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"testing"
)

func TestElevenLabsVideoRetainsOutputBudgetAndMapsCapturedInputsAgain(t *testing.T) {
	spec := &runtimev1.MusicGenerateScenarioSpec{Prompt: "quiet", VideoReference: &runtimev1.MusicVideoReference{ArtifactId: "owned-clip"}, DurationSeconds: 10}
	request := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: spec}}}
	if err := validateElevenLabsMusicRequest(request, "music_v2"); err != nil || spec.DurationSeconds != 10 {
		t.Fatal("output budget lost")
	}
	spec.DurationSeconds = 0
	if err := validateElevenLabsMusicRequest(request, "music_v2"); err != nil || spec.DurationSeconds != 600 {
		t.Fatalf("captured ceiling %d: %v", spec.DurationSeconds, err)
	}
	if err := validateElevenLabsMusicRequest(request, "music_v2"); err != nil || spec.DurationSeconds != 600 {
		t.Fatal("captured effective budget did not survive rebuild")
	}
	profiles := elevenLabsMusicInputCapabilities().GetGeneration()
	if len(profiles) != 2 || profiles[0].GetVideoReferenceMode() != "unsupported" || profiles[1].GetVideoReferenceMode() != "required" {
		t.Fatal("resource facts not declared")
	}
}
