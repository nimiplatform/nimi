package capabilitydriver

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func dashScopeFiniteASRTarget(model string) bool {
	switch model {
	case "qwen-audio-3.0-asr-flash-streaming", "fun-asr-realtime", "fun-asr-realtime-2026-02-28", "fun-asr-realtime-2025-09-15":
		return true
	default:
		return false
	}
}

func validateDashScopeFiniteASRRequest(spec *runtimev1.SpeechTranscribeScenarioSpec, model string) error {
	unsupported := spec.GetDiarization() || spec.GetSpeakerCount() != 0 || spec.GetPrompt() != "" || spec.GetResponseFormat() != ""
	mime := strings.ToLower(strings.TrimSpace(spec.GetMimeType()))
	unsupported = unsupported || (mime != "" && mime != "audio/wav" && mime != "audio/x-wav")
	language := strings.TrimSpace(spec.GetLanguage())
	if language != "" {
		allowed := " zh en ja ko vi th id ms tl hi ar fr de es pt ru it nl sv da fi no el pl cs hu ro bg hr sk "
		if model == "fun-asr-realtime-2026-02-28" {
			allowed = " zh en ja "
		} else if model == "fun-asr-realtime-2025-09-15" {
			allowed = " zh en "
		}
		unsupported = unsupported || strings.ContainsAny(language, " \t\r\n") || !strings.Contains(allowed, " "+language+" ")
	}
	if unsupported {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			Message:    "DashScope finite transcription supports mono PCM WAV, optional supported language, and real timestamps; prompt, response format and diarization are unsupported",
			ActionHint: "use_supported_finite_transcription_options",
		})
	}
	return nil
}
