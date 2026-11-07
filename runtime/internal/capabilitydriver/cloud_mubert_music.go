package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"strings"
	"unicode/utf8"
)

const MubertTrackModel = "mubert-track-v3"

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
func validateMubertMusicRequest(request *runtimev1.SubmitScenarioJobRequest, model string) error {
	s := request.GetSpec().GetMusicGenerate()
	if model != MubertTrackModel || s == nil || len(request.GetExtensions()) > 0 || strings.TrimSpace(s.GetPrompt()) == "" || utf8.RuneCountInString(s.GetPrompt()) > 200 || s.GetLyrics() != "" || s.GetStyle() != "" || s.GetTitle() != "" || s.GetNegativePrompt() != "" || s.GetInstrumental() || s.Seed != nil || s.GetScore() != nil || s.GetScoreConditioning() != runtimev1.MusicScoreConditioning_MUSIC_SCORE_CONDITIONING_UNSPECIFIED || s.GetAudioReference() != nil || s.GetVideoReference() != nil || s.GetReturnGeneratedScore() {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{Message: "Mubert text-to-track accepts an English prompt up to 200 characters and a duration budget; other typed music controls are unsupported", ActionHint: "use_mubert_english_prompt_and_duration"})
	}
	if s.DurationSeconds == 0 {
		s.DurationSeconds = 30
	}
	if s.DurationSeconds < 1 || s.DurationSeconds > 600 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return nil
}
func mubertMusicInputCapabilities() *runtimev1.MusicInputCapabilities {
	return &runtimev1.MusicInputCapabilities{Generation: []*runtimev1.MusicGenerationInputProfile{{LyricsMode: "unsupported", ScoreMode: "unsupported", VideoReferenceMode: "unsupported", MaxDurationSeconds: 600, DefaultDurationSeconds: 30, MaxPromptBytes: 800}}}
}
