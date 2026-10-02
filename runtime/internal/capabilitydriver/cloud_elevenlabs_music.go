package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"strings"
	"unicode/utf8"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
func validateElevenLabsMusicRequest(request *runtimev1.SubmitScenarioJobRequest, model string) error {
	spec := request.GetSpec().GetMusicGenerate()
	unsupported := func() error {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if model != "music_v2" || spec == nil || len(request.GetExtensions()) != 0 || spec.GetLyrics() != "" || spec.GetScore() != nil || spec.GetAudioReference() != nil || spec.Seed != nil || spec.GetReturnGeneratedScore() || spec.GetNegativePrompt() != "" || spec.GetStyle() != "" || spec.GetTitle() != "" {
		return unsupported()
	}
	if spec.GetVideoReference() != nil {
		if spec.GetDurationSeconds() < 0 || spec.GetDurationSeconds() > 600 || spec.GetInstrumental() || utf8.RuneCountInString(spec.GetPrompt()) > 1000 {
			return unsupported()
		}
		if spec.GetDurationSeconds() == 0 {
			spec.DurationSeconds = 600
		}
	} else {
		if spec.GetDurationSeconds() == 0 {
			spec.DurationSeconds = 30
		}
		if utf8.RuneCountInString(spec.GetPrompt()) > 4100 || spec.GetDurationSeconds() < 3 || spec.GetDurationSeconds() > 600 || strings.TrimSpace(spec.GetPrompt()) == "" {
			return unsupported()
		}
	}
	return nil
}

func elevenLabsMusicInputCapabilities() *runtimev1.MusicInputCapabilities {
	return &runtimev1.MusicInputCapabilities{Generation: []*runtimev1.MusicGenerationInputProfile{
		{LyricsMode: "unsupported", ScoreMode: "unsupported", SupportsInstrumental: true, MaxDurationSeconds: 600, DefaultDurationSeconds: 30, MaxPromptBytes: 16400, VideoReferenceMode: "unsupported"},
		{LyricsMode: "unsupported", ScoreMode: "unsupported", MaxDurationSeconds: 600, DefaultDurationSeconds: 600, MaxPromptBytes: 4000, VideoReferenceMode: "required", MaxVideoReferenceBytes: 32 << 20},
	}}
}
