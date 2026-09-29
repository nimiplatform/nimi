package capabilitydriver

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const geminiLyria35Model = "lyria-3.5"
const geminiLyria35MaxPromptBytes = 32768
const geminiLyria35MaxBudgetSeconds = 300

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
// The full-song provider has prompt-based length steering, not a numeric
// duration control. DurationSeconds is a captured upper output budget that
// Runtime enforces against measured audio before publication.
func validateGeminiLyria35Request(request *runtimev1.SubmitScenarioJobRequest, model string) error {
	unsupported := func() error {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			Message:    "Lyria 3.5 accepts one text prompt with an omitted or 300-second output ceiling; shorter duration budgets, separate lyrics, instrumental control, prior audio, score and seed are unavailable",
			ActionHint: "use_lyria35_text_and_output_budget",
		})
	}
	if request == nil || request.GetSpec().GetMusicGenerate() == nil || model != geminiLyria35Model || len(request.GetExtensions()) > 0 {
		return unsupported()
	}
	spec := request.GetSpec().GetMusicGenerate()
	if strings.TrimSpace(spec.GetPrompt()) == "" || len(spec.GetPrompt()) > geminiLyria35MaxPromptBytes || strings.TrimSpace(spec.GetLyrics()) != "" ||
		strings.TrimSpace(spec.GetNegativePrompt()) != "" || strings.TrimSpace(spec.GetStyle()) != "" || strings.TrimSpace(spec.GetTitle()) != "" ||
		spec.GetInstrumental() || spec.GetScore() != nil || spec.GetScoreConditioning() != runtimev1.MusicScoreConditioning_MUSIC_SCORE_CONDITIONING_UNSPECIFIED ||
		spec.Seed != nil || spec.GetReturnGeneratedScore() || spec.GetAudioReference() != nil ||
		(spec.GetDurationSeconds() != 0 && spec.GetDurationSeconds() != geminiLyria35MaxBudgetSeconds) {
		return unsupported()
	}
	if spec.GetDurationSeconds() == 0 {
		spec.DurationSeconds = geminiLyria35MaxBudgetSeconds
	}
	return nil
}
