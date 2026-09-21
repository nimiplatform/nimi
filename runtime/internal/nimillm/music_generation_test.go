package nimillm

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestMusicCloudMappingPreservesLyricsAndRejectsUnsupportedInputs(t *testing.T) {
	spec := &runtimev1.MusicGenerateScenarioSpec{Prompt: " warm folk ", Lyrics: "\n[Verse]\nKeep these words\n"}
	body, err := buildMusicGenerationRequest("music", spec, nil)
	if err != nil || body["lyrics"] != spec.Lyrics || body["prompt"] != spec.Prompt {
		t.Fatalf("mapping=%v err=%v", body, err)
	}
	if _, err := buildMusicGenerationRequest("music", spec, map[string]any{"mode": "reference", "source_audio_base64": "AAAA"}); err == nil {
		t.Fatal("retired extension reached transport")
	}
	for _, change := range []func(*runtimev1.MusicGenerateScenarioSpec){func(v *runtimev1.MusicGenerateScenarioSpec) { v.Seed = proto.Uint32(0) }, func(v *runtimev1.MusicGenerateScenarioSpec) {
		v.Score = &runtimev1.MusicScoreReference{ArtifactId: "score"}
	}, func(v *runtimev1.MusicGenerateScenarioSpec) {
		v.AudioReference = &runtimev1.MusicAudioInput{ArtifactId: "audio"}
	}, func(v *runtimev1.MusicGenerateScenarioSpec) { v.ReturnGeneratedScore = true }} {
		value := proto.Clone(spec).(*runtimev1.MusicGenerateScenarioSpec)
		change(value)
		if _, err := buildMusicGenerationRequest("music", value, nil); err == nil {
			t.Fatal("unsupported cloud input was ignored")
		}
	}
}
