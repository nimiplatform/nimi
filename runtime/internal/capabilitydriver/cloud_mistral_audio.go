package capabilitydriver

import (
	"regexp"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const CloudMediaAdapterMistralTranscribe = "mistral_transcriptions_adapter"
const CloudMediaAdapterMistralSpeech = "mistral_speech_adapter"
const MistralVoxtralTTS3 = "voxtral-mini-tts-3-0"
const MistralVoiceWorkflow = "mistral-audio-voices"
const CloudMediaAdapterMistralVoiceWorkflow = "mistral_voice_workflow_adapter"
const CloudMediaAdapterMistralVoiceDelete = "mistral_voice_delete_adapter"
const CloudMediaAdapterMistralVoiceInspect = "mistral_voice_inspect_adapter"

func ValidMistralVoiceID(id string) bool { return mistralVoiceUUID.MatchString(id) }

func validateMistralVoiceCreate(target CloudMediaTarget, request *runtimev1.SubmitScenarioJobRequest, config CloudVoiceWorkflowConfig) error {
	if model := request.GetSpec().GetVoiceCreate().GetTargetModelId(); model != "" && model != target.providerModelID {
		return mistralAudioUnsupported("Mistral voice creation cannot change the captured synthesis target")
	}
	input := request.GetSpec().GetVoiceCreate().GetReferenceAudio()
	if target.providerModelID != MistralVoxtralTTS3 || config.CatalogModelID != MistralVoxtralTTS3 || config.WorkflowModelID != MistralVoiceWorkflow || config.WorkflowType != "reference_audio" || input == nil || len(request.GetExtensions()) != 0 || len(config.Extensions.GetFields()) != 0 || input.GetReferenceAudioUri() != "" || input.GetText() != "" || len(input.GetReferenceAudioBytes()) == 0 || len(input.GetReferenceAudioBytes()) > 32<<20 || len([]rune(input.GetPreferredName())) > 128 || len(input.GetLanguageHints()) > 16 {
		return mistralAudioUnsupported("Mistral saved voice creation requires one uploaded WAV or MP3, an optional name and language hints, without a transcript, URL or extensions")
	}
	if input.GetReferenceAudioMime() != "audio/wav" && input.GetReferenceAudioMime() != "audio/mpeg" {
		return mistralAudioUnsupported("Mistral voice cloning requires WAV or MP3")
	}
	for _, language := range input.GetLanguageHints() {
		if !mistralAudioLanguage.MatchString(language) {
			return mistralAudioUnsupported("Mistral voice language hints must use two-letter codes")
		}
	}
	return nil
}

func IsMistralVoxtral3Transcribe(model string) bool {
	return model == "voxtral-mini-transcribe-3-0" || model == "voxtral-small-transcribe-3-0"
}

var mistralAudioLanguage = regexp.MustCompile(`^[a-z]{2}$`)
var mistralVoiceUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var mistralVoxtral3Presets = map[string]bool{
	"voice_478": true, "voice_447": true, "voice_485": true, "voice_3150": true,
	"voice_1787": true, "voice_1786": true, "voice_1788": true, "voice_590": true,
	"voice_591": true, "voice_3149": true, "voice_3147": true, "voice_592": true,
	"voice_3137": true, "voice_589": true, "voice_3141": true, "voice_483": true,
	"voice_481": true, "voice_482": true, "voice_480": true, "voice_479": true,
	"voice_3143": true, "voice_3139": true, "voice_3153": true, "voice_3146": true,
	"voice_3133": true, "voice_3136": true, "voice_3135": true, "voice_3145": true,
	"voice_3134": true, "voice_3154": true, "voice_3155": true, "voice_3132": true,
	"voice_3138": true, "voice_3140": true, "voice_3144": true, "voice_3142": true,
}

func mistralAudioUnsupported(message string) error {
	return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{Message: message})
}

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
func validateMistralTranscribeRequest(req *runtimev1.SubmitScenarioJobRequest, model string) error {
	s := req.GetSpec().GetSpeechTranscribe()
	if s == nil || !IsMistralVoxtral3Transcribe(model) || len(req.GetExtensions()) != 0 || s.GetTimestamps() || s.GetSpeakerCount() != 0 || s.GetResponseFormat() != "" && s.GetResponseFormat() != "text" || s.GetLanguage() != "" && !mistralAudioLanguage.MatchString(s.GetLanguage()) {
		return mistralAudioUnsupported("Voxtral 3 accepts a recording, a two-letter language hint, context and optional speaker labels; native segment times cannot satisfy word alignment or a requested speaker count")
	}
	switch s.GetMimeType() {
	case "audio/wav", "audio/mpeg":
	default:
		return mistralAudioUnsupported("Voxtral 3 transcription requires one uploaded WAV or MP3 recording within 32 MiB")
	}
	audio, ok := s.GetAudioSource().GetSource().(*runtimev1.SpeechTranscriptionAudioSource_AudioBytes)
	if !ok || len(audio.AudioBytes) == 0 || len(audio.AudioBytes) > 32<<20 || len(s.GetPrompt()) > 32768 {
		return mistralAudioUnsupported("Voxtral 3 transcription requires one uploaded WAV or MP3 recording within 32 MiB and a bounded context hint")
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validateMistralSpeechRequest(req *runtimev1.SubmitScenarioJobRequest, model string, stream CloudMediaStreamMode) error {
	s := req.GetSpec().GetSpeechSynthesize()
	if s == nil || model != MistralVoxtralTTS3 || len(req.GetExtensions()) != 0 || stream == CloudMediaStreamSimulated || strings.TrimSpace(s.GetText()) == "" || len(s.GetText()) > 32768 || s.GetLanguage() != "" || s.Speed != nil || s.Pitch != nil || s.Volume != nil || s.GetEmotion() != "" || s.GetVoiceRenderHints() != nil || s.GetIdentityAudio() != nil || s.GetPerformanceAudio() != nil || s.GetSampleRateHz() != 0 && s.GetSampleRateHz() != 24000 || s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED && s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE {
		return mistralAudioUnsupported("Voxtral 3 speech accepts complete text and a voice, without separate language, delivery, timing or performance controls; native inline tags remain part of the text")
	}
	switch s.GetAudioFormat() {
	case "":
		s.AudioFormat = "wav"
	case "wav", "mp3":
	default:
		return mistralAudioUnsupported("This Voxtral 3 Driver returns a complete WAV or MP3, or its ordered native stream, at 24 kHz mono")
	}
	voice := s.GetVoiceRef()
	switch voice.GetKind() {
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET:
		if mistralVoxtral3Presets[voice.GetPresetVoiceId()] {
			return nil
		}
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF:
		if mistralVoiceUUID.MatchString(voice.GetProviderVoiceRef()) {
			return nil
		}
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET:
		if voice.GetVoiceAssetId() != "" {
			return nil
		}
	}
	return mistralAudioUnsupported("Select a reviewed Voxtral 3 preset or a model-bound owned VoiceAsset")
}
