package capabilitydriver

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const geminiLyriaClipModel = "lyria-3-clip-preview"
const geminiLyriaClipMaxPromptBytes = 32768

// The provider calls this a 30-second clip, but one real decoded output was
// 30.772 seconds of non-silent audio. Capture a whole-second upper budget and
// check the measured result before publication.
const geminiLyriaClipDurationSeconds = 35

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
// The selected preview model has one fixed clip length and no native score,
// seed, reference-audio or independent lyric control in this dialect.
func validateGeminiLyriaClipRequest(request *runtimev1.SubmitScenarioJobRequest, model string) error {
	unsupported := func() error {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			Message:    "Lyria 3 Clip accepts one text prompt for a nominal 30-second clip with a 35-second upper budget; lyrics, reference audio, score, seed, instrumental mode and other duration budgets are unavailable",
			ActionHint: "use_lyria_clip_text_and_fixed_duration",
		})
	}
	if request == nil || request.GetSpec().GetMusicGenerate() == nil || model != geminiLyriaClipModel || len(request.GetExtensions()) > 0 {
		return unsupported()
	}
	spec := request.GetSpec().GetMusicGenerate()
	if strings.TrimSpace(spec.GetPrompt()) == "" || len(spec.GetPrompt()) > geminiLyriaClipMaxPromptBytes || strings.TrimSpace(spec.GetLyrics()) != "" ||
		strings.TrimSpace(spec.GetNegativePrompt()) != "" || strings.TrimSpace(spec.GetStyle()) != "" || strings.TrimSpace(spec.GetTitle()) != "" ||
		spec.GetInstrumental() || spec.GetScore() != nil || spec.GetScoreConditioning() != runtimev1.MusicScoreConditioning_MUSIC_SCORE_CONDITIONING_UNSPECIFIED ||
		spec.Seed != nil || spec.GetReturnGeneratedScore() || spec.GetAudioReference() != nil ||
		(spec.GetDurationSeconds() != 0 && spec.GetDurationSeconds() != geminiLyriaClipDurationSeconds) {
		return unsupported()
	}
	// A missing duration is resolved once in the immutable mapped request.
	spec.DurationSeconds = geminiLyriaClipDurationSeconds
	return nil
}

func CloudMusicInputCapabilities(provider, model, capability string) *runtimev1.MusicInputCapabilities {
	if provider != "gemini" || model != geminiLyriaClipModel || capability != "music.generate" {
		return nil
	}
	return &runtimev1.MusicInputCapabilities{Generation: []*runtimev1.MusicGenerationInputProfile{{
		LyricsMode: "unsupported", ScoreMode: "unsupported", MaxDurationSeconds: geminiLyriaClipDurationSeconds,
		DefaultDurationSeconds: geminiLyriaClipDurationSeconds, MaxPromptBytes: geminiLyriaClipMaxPromptBytes,
	}}}
}
