package capabilitydriver

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
func validateLoudlyMusicRequest(request *runtimev1.SubmitScenarioJobRequest, model string) error {
	s := request.GetSpec().GetMusicGenerate()
	if model != "VEGA_2" || s == nil || len(request.GetExtensions()) > 0 || strings.TrimSpace(s.GetPrompt()) == "" || len(s.GetPrompt()) > 32768 || s.GetLyrics() != "" || s.GetStyle() != "" || s.GetTitle() != "" || s.GetNegativePrompt() != "" || s.Seed != nil || s.GetScore() != nil || s.GetScoreConditioning() != runtimev1.MusicScoreConditioning_MUSIC_SCORE_CONDITIONING_UNSPECIFIED || s.GetAudioReference() != nil || s.GetVideoReference() != nil || s.GetReturnGeneratedScore() {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{Message: "Loudly VEGA-2 accepts an instrumental text prompt up to 32 KiB and a duration budget; separate lyrics, style, title, negative prompt, seed, references and score are unsupported", ActionHint: "use_loudly_prompt_and_duration"})
	}
	if s.GetDurationSeconds() == 0 {
		s.DurationSeconds = 30
	}
	if s.GetDurationSeconds() < 30 || s.GetDurationSeconds() > 420 {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{Message: "Loudly VEGA-2 requires a duration budget from 30 through 420 seconds", ActionHint: "use_loudly_duration_30_to_420_seconds"})
	}
	return nil
}
func loudlyMusicInputCapabilities() *runtimev1.MusicInputCapabilities {
	return &runtimev1.MusicInputCapabilities{Generation: []*runtimev1.MusicGenerationInputProfile{{LyricsMode: "unsupported", ScoreMode: "unsupported", VideoReferenceMode: "unsupported", SupportsInstrumental: true, MaxDurationSeconds: 420, DefaultDurationSeconds: 30, MaxPromptBytes: 32768}}}
}
