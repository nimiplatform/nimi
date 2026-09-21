package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
	"testing"
)

func TestMusicGenerationRejectsRetiredExtensionAndPreservesTypedFields(t *testing.T) {
	spec := &runtimev1.MusicGenerateScenarioSpec{Prompt: "a song", Lyrics: "\nWords\n"}
	err := validateMusicGenerationRequest(spec, []*runtimev1.ScenarioExtension{{Namespace: "nimi.scenario.music_generate.request"}})
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("retired extension=%v", err)
	}
	request := &runtimev1.LocalAppMusicGenerateJobSpec{Prompt: spec.Prompt, Lyrics: spec.Lyrics, DurationSeconds: 240, Seed: proto.Uint32(0), Score: &runtimev1.MusicScoreReference{ArtifactId: "score", Format: runtimev1.MusicScoreFormat_MUSIC_SCORE_FORMAT_ABC}, ScoreConditioning: runtimev1.MusicScoreConditioning_MUSIC_SCORE_CONDITIONING_MELODY_AND_HARMONY}
	result, err := validateLocalAppMusicGenerateJobSpec(request)
	if err != nil || result.GetDurationSeconds() != 240 || result.Seed == nil || result.GetSeed() != 0 || result.GetLyrics() != spec.Lyrics || result.GetScore().GetArtifactId() != "score" {
		t.Fatalf("typed mapping=%v err=%v", result, err)
	}
	request.Score.ArtifactId = "mutated"
	if result.Score.ArtifactId != "score" {
		t.Fatal("mutable caller score retained")
	}
}
