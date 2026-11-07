package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"strings"
	"unicode/utf8"
)

func IsSoundverseMusicModel(model string) bool { return model == "v6" || model == "v7" }

// @nimi-authority: rule.nimi.runtime.ai-provider.soundverse-current-music
func validateSoundverseMusicRequest(request *runtimev1.SubmitScenarioJobRequest, model string) error {
	s := request.GetSpec().GetMusicGenerate()
	if !IsSoundverseMusicModel(model) || s == nil || len(request.GetExtensions()) > 0 || strings.TrimSpace(s.GetPrompt()) == "" || utf8.RuneCountInString(s.GetPrompt()) > 1024 || utf8.RuneCountInString(s.GetLyrics()) > 3000 || s.GetInstrumental() && s.GetLyrics() != "" || s.GetStyle() != "" || s.GetTitle() != "" || s.GetNegativePrompt() != "" || s.Seed != nil || s.GetScore() != nil || s.GetScoreConditioning() != runtimev1.MusicScoreConditioning_MUSIC_SCORE_CONDITIONING_UNSPECIFIED || s.GetAudioReference() != nil || s.GetVideoReference() != nil || s.GetReturnGeneratedScore() || s.GetDurationSeconds() != 0 && s.GetDurationSeconds() != 600 {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{Message: "Soundverse accepts a prompt up to 1024 characters and optional song lyrics up to 3000 characters. The provider chooses length; omit duration or use the fixed 600-second output ceiling. Other music controls are unsupported", ActionHint: "use_soundverse_prompt_lyrics_and_fixed_output_ceiling"})
	}
	s.DurationSeconds = 600
	return nil
}
func soundverseMusicInputCapabilities() *runtimev1.MusicInputCapabilities {
	return &runtimev1.MusicInputCapabilities{Generation: []*runtimev1.MusicGenerationInputProfile{{LyricsMode: "optional", ScoreMode: "unsupported", VideoReferenceMode: "unsupported", SupportsInstrumental: true, MaxDurationSeconds: 600, DefaultDurationSeconds: 600, MaxPromptBytes: 4096, MaxLyricsBytes: 12000}}}
}
