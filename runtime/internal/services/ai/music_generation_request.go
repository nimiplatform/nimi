package ai

import (
	"strings"
	"unicode"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
func validateMusicGenerationRequest(spec *runtimev1.MusicGenerateScenarioSpec, extensions []*runtimev1.ScenarioExtension) error {
	invalid := func() error {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	if spec == nil || strings.TrimSpace(spec.GetPrompt()) == "" || !validMusicText(spec.GetPrompt()) || !validMusicText(spec.GetLyrics()) {
		return invalid()
	}
	if spec.GetDurationSeconds() < 0 || spec.GetDurationSeconds() > 600 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if spec.GetInstrumental() && strings.TrimSpace(spec.GetLyrics()) != "" {
		return invalid()
	}
	if score := spec.GetScore(); score != nil {
		if !localAppBoundedIdentifier(score.GetArtifactId()) || (score.GetFormat() != runtimev1.MusicScoreFormat_MUSIC_SCORE_FORMAT_ABC && score.GetFormat() != runtimev1.MusicScoreFormat_MUSIC_SCORE_FORMAT_MIDI) {
			return invalid()
		}
		if spec.GetScoreConditioning() != runtimev1.MusicScoreConditioning_MUSIC_SCORE_CONDITIONING_MELODY_ONLY && spec.GetScoreConditioning() != runtimev1.MusicScoreConditioning_MUSIC_SCORE_CONDITIONING_MELODY_AND_HARMONY {
			return invalid()
		}
	} else if spec.GetScoreConditioning() != runtimev1.MusicScoreConditioning_MUSIC_SCORE_CONDITIONING_UNSPECIFIED {
		return invalid()
	}
	if audio := spec.GetAudioReference(); audio != nil {
		if !localAppBoundedIdentifier(audio.GetArtifactId()) {
			return invalid()
		}
		if region := audio.GetRange(); region != nil && (region.GetEndFrame() <= region.GetStartFrame() || region.GetEndFrame() > 96000*600) {
			return invalid()
		}
	}
	for _, extension := range extensions {
		if extension.GetNamespace() == "nimi.scenario.music_generate.request" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	}
	return nil
}

func validMusicText(value string) bool {
	if len(value) > 32*1024 || !utf8.ValidString(value) {
		return false
	}
	for _, ch := range value {
		if unicode.IsControl(ch) && ch != '\n' && ch != '\r' && ch != '\t' {
			return false
		}
	}
	return true
}

func validateCloudMusicGenerationFields(spec *runtimev1.MusicGenerateScenarioSpec, allowReference bool) error {
	if spec != nil && (spec.GetScore() != nil || (!allowReference && spec.GetAudioReference() != nil) || spec.GetReturnGeneratedScore() || spec.Seed != nil) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return nil
}
