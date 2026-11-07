package capabilitydriver

import (
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

// XAITTSOperation names the fixed /v1/tts operation, not an upstream model.
const XAITTSOperation = "tts"
const XAITranscribeModel = "grok-voice-transcribe-2.0"
const CloudMediaAdapterXAISpeech = "xai_tts_adapter"
const CloudMediaAdapterXAITranscribe = "xai_stt_adapter"

func XAISpeechVoices() []string {
	return []string{"carina", "zagan", "helix", "orion", "luna", "iris", "altair", "zenith", "perseus", "helios", "lux", "kepler", "rigel", "cosmo", "celeste", "ursa", "sirius", "lumen", "castor", "naksh", "atlas", "ara", "eve", "leo", "rex", "sal"}
}

func xaiAudioUnsupported() error {
	return nativeCloudSpeechUnsupported("This xAI speech operation does not support the selected controls. Synthesis requires a reviewed preset voice; transcription requires an uploaded WAV or MP3 within 32 MiB")
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validateXAISpeechRequest(req *runtimev1.SubmitScenarioJobRequest, model string, mode CloudMediaStreamMode) error {
	s := req.GetSpec().GetSpeechSynthesize()
	if model != XAITTSOperation || s == nil || mode != CloudMediaStreamNone || len(req.GetExtensions()) != 0 || strings.TrimSpace(s.GetText()) == "" || utf8.RuneCountInString(s.GetText()) > 60000 || s.GetVoiceRef().GetKind() != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET || !contains(XAISpeechVoices(), s.GetVoiceRef().GetPresetVoiceId()) || s.Pitch != nil || s.Volume != nil || s.GetEmotion() != "" || s.GetVoiceRenderHints() != nil || s.GetIdentityAudio() != nil || s.GetPerformanceAudio() != nil || s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED && s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE {
		return xaiAudioUnsupported()
	}
	if s.Speed != nil && !(s.GetSpeed() >= .7 && s.GetSpeed() <= 1.5) {
		return xaiAudioUnsupported()
	}
	if s.Language == "" {
		s.Language = "auto"
	}
	if !contains([]string{"auto", "en", "ar-EG", "ar-SA", "ar-AE", "bn", "zh", "fr", "de", "hi", "id", "it", "ja", "ko", "pt-BR", "pt-PT", "ru", "es-MX", "es-ES", "tr", "vi"}, s.GetLanguage()) {
		return xaiAudioUnsupported()
	}
	if s.AudioFormat == "" {
		s.AudioFormat = "mp3"
	}
	if !contains([]string{"mp3", "wav", "pcm", "mulaw", "alaw"}, s.GetAudioFormat()) {
		return xaiAudioUnsupported()
	}
	if s.SampleRateHz == nil {
		s.SampleRateHz = proto.Int32(24000)
	}
	switch s.GetSampleRateHz() {
	case 8000, 16000, 22050, 24000, 44100, 48000:
	default:
		return xaiAudioUnsupported()
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
func validateXAITranscribeRequest(req *runtimev1.SubmitScenarioJobRequest, model string) error {
	s := req.GetSpec().GetSpeechTranscribe()
	if model != XAITranscribeModel || s == nil || len(req.GetExtensions()) != 0 || s.GetPrompt() != "" || s.GetSpeakerCount() != 0 || s.GetResponseFormat() != "" && s.GetResponseFormat() != "text" || s.GetMimeType() != "audio/wav" && s.GetMimeType() != "audio/mpeg" || len(s.GetAudioSource().GetAudioBytes()) == 0 || len(s.GetAudioSource().GetAudioBytes()) > 32<<20 {
		return xaiAudioUnsupported()
	}
	if s.GetLanguage() != "" && !contains([]string{"ar", "bs", "bg", "yue", "ca", "zh", "hr", "cs", "da", "nl", "en", "fil", "fi", "fr", "de", "el", "hi", "hu", "id", "it", "ja", "ko", "mk", "ms", "nb", "fa", "pl", "pt", "ro", "ru", "sk", "es", "sv", "th", "tr", "uk", "ur", "vi", "es-ES", "pt-PT", "ar-AE", "ar-SA"}, s.GetLanguage()) {
		return xaiAudioUnsupported()
	}
	return nil
}
