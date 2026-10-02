package capabilitydriver

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func geminiTTSModelAdmitted(model string) bool {
	switch model {
	case "gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts":
		return true
	default:
		return false
	}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
// The exact model admits Kore through GenerateContent and, for Flash, an
// owned stored voice through Interactions. Both return complete 24 kHz WAV.
func validateGeminiTTSRequest(request *runtimev1.SubmitScenarioJobRequest, model string, streamMode CloudMediaStreamMode) error {
	voiceSupport := "the Kore preset"
	if model == "gemini-3.8-flash-tts" {
		voiceSupport = "the Kore preset or an owned stored voice"
	}
	unsupported := func() error {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			Message:    fmt.Sprintf("This Gemini TTS composition supports English or Chinese text with %s and complete 24 kHz WAV output; reset unsupported speech controls, timing or streaming", voiceSupport),
			ActionHint: "choose_supported_gemini_voice_and_reset_speech_controls",
		})
	}
	if request == nil || request.GetSpec().GetSpeechSynthesize() == nil || !geminiTTSModelAdmitted(model) ||
		streamMode != CloudMediaStreamNone || len(request.GetExtensions()) > 0 {
		return unsupported()
	}
	spec := request.GetSpec().GetSpeechSynthesize()
	ref := spec.GetVoiceRef()
	custom := model == "gemini-3.8-flash-tts" && ref.GetKind() == runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF && strings.HasPrefix(ref.GetProviderVoiceRef(), "voice_") && !strings.ContainsAny(ref.GetProviderVoiceRef(), "/\\ \t\r\n")
	preset := ref.GetKind() == runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET && ref.GetPresetVoiceId() == "Kore"
	if (!custom && !preset) || strings.TrimSpace(spec.GetText()) == "" {
		return unsupported()
	}
	if (spec.GetLanguage() != "" && spec.GetLanguage() != "en" && spec.GetLanguage() != "zh") ||
		(spec.GetAudioFormat() != "" && !strings.EqualFold(spec.GetAudioFormat(), "wav")) ||
		(spec.SampleRateHz != nil && spec.GetSampleRateHz() != 24000) ||
		spec.Speed != nil || spec.Pitch != nil || spec.Volume != nil ||
		strings.TrimSpace(spec.GetEmotion()) != "" || spec.GetVoiceRenderHints() != nil ||
		(spec.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED &&
			spec.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE) {
		return unsupported()
	}
	return nil
}
