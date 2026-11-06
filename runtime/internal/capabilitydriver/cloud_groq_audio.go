package capabilitydriver

import (
	"regexp"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const CloudMediaAdapterGroqSpeech = "groq_speech_adapter"
const CloudMediaAdapterGroqTranscribe = "groq_transcriptions_adapter"

var groqASRLanguage = regexp.MustCompile(`^[a-z]{2,3}$`)

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validateGroqSpeechRequest(req *runtimev1.SubmitScenarioJobRequest, model string, mode CloudMediaStreamMode) error {
	language, voices := "", ""
	switch model {
	case "canopylabs/orpheus-v1-english":
		language, voices = "en", "autumn diana hannah austin daniel troy"
	case "canopylabs/orpheus-arabic-saudi":
		language, voices = "ar", "abdullah fahad sultan lulwa noura aisha"
	default:
		return nativeCloudSpeechUnsupported("Choose a reviewed Groq Orpheus model")
	}
	s := req.GetSpec().GetSpeechSynthesize()
	if s == nil || mode != CloudMediaStreamNone || len(req.GetExtensions()) != 0 || s.SampleRateHz != nil || s.Speed != nil || s.Pitch != nil || s.Volume != nil || s.GetEmotion() != "" || s.GetVoiceRenderHints() != nil || s.GetIdentityAudio() != nil || s.GetPerformanceAudio() != nil || s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED && s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE {
		return nativeCloudSpeechUnsupported("Orpheus supports a complete native WAV without separate delivery, sampling, timing or streaming controls")
	}
	voice := ""
	switch s.GetVoiceRef().GetKind() {
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET:
		voice = s.GetVoiceRef().GetPresetVoiceId()
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF:
		voice = s.GetVoiceRef().GetProviderVoiceRef()
	}
	if !contains(strings.Fields(voices), voice) || strings.TrimSpace(s.GetText()) == "" || utf8.RuneCountInString(s.GetText()) > 200 || s.GetLanguage() != "" && s.GetLanguage() != language {
		return nativeCloudSpeechUnsupported("Orpheus requires its model-specific preset voice, matching language and at most 200 characters")
	}
	if s.GetAudioFormat() != "" && s.GetAudioFormat() != "wav" {
		return nativeCloudSpeechUnsupported("These Orpheus models return WAV audio")
	}
	s.AudioFormat = "wav"
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
func validateGroqTranscribeRequest(req *runtimev1.SubmitScenarioJobRequest, model string) error {
	s := req.GetSpec().GetSpeechTranscribe()
	if s == nil || (model != "whisper-large-v3" && model != "whisper-large-v3-turbo") || len(req.GetExtensions()) != 0 || s.GetDiarization() || s.GetSpeakerCount() != 0 || s.GetResponseFormat() != "" && s.GetResponseFormat() != "text" || s.GetLanguage() != "" && !groqASRLanguage.MatchString(s.GetLanguage()) || len(s.GetPrompt()) > 224 {
		return nativeCloudSpeechUnsupported("Groq Whisper accepts a native language code, optional word timing and a concise context hint (Runtime limit: 224 UTF-8 bytes); diarization is unavailable")
	}
	source, ok := s.GetAudioSource().GetSource().(*runtimev1.SpeechTranscriptionAudioSource_AudioBytes)
	if !ok || len(source.AudioBytes) == 0 || len(source.AudioBytes) > 25_000_000 {
		return nativeCloudSpeechUnsupported("Upload one audio file within the reviewed 25 MB direct-upload boundary")
	}
	switch s.GetMimeType() {
	case "audio/wav", "audio/mpeg", "audio/mp4", "audio/webm", "audio/flac", "audio/ogg":
	default:
		return nativeCloudSpeechUnsupported("Choose WAV, MP3, M4A, WebM, FLAC or Ogg audio")
	}
	return nil
}
