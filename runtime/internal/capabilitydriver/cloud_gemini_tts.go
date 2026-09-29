package capabilitydriver

import (
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
// validateGeminiTTSRequest limits the native GenerateContent dialect to one
// explicit prebuilt voice, English or Chinese text, and complete WAV output. No requested control is
// silently converted into transcript text or ignored by the Host.
func validateGeminiTTSRequest(request *runtimev1.SubmitScenarioJobRequest, model string, streamMode CloudMediaStreamMode) error {
	unsupported := func() error {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			Message:    "Gemini 3.8 Flash TTS currently supports English or Chinese single-speaker Kore as a complete 24 kHz WAV; other voices, speech controls, timing and streaming are unavailable",
			ActionHint: "choose_gemini_kore_wav_single_speaker",
		})
	}
	if request == nil || request.GetSpec().GetSpeechSynthesize() == nil || !geminiTTSModelAdmitted(model) ||
		streamMode != CloudMediaStreamNone || len(request.GetExtensions()) > 0 {
		return unsupported()
	}
	spec := request.GetSpec().GetSpeechSynthesize()
	ref := spec.GetVoiceRef()
	if ref == nil || ref.GetKind() != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET ||
		ref.GetPresetVoiceId() != "Kore" || strings.TrimSpace(spec.GetText()) == "" {
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
