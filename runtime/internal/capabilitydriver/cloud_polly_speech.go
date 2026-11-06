package capabilitydriver

import (
	"regexp"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

var pollyVoiceID = regexp.MustCompile(`^[A-Za-z]{1,64}$`)
var pollyLocale = regexp.MustCompile(`^[a-z]{2,3}-[A-Z]{2}(?:-[A-Z]{3})?$`)

func nativeCloudSpeechUnsupported(message string) error {
	return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{Message: message})
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validatePollySpeechRequest(req *runtimev1.SubmitScenarioJobRequest, model string, mode CloudMediaStreamMode) error {
	switch model {
	case "polly-standard-tts", "polly-neural-tts", "polly-long-form-tts", "polly-generative-tts":
	default:
		return nativeCloudSpeechUnsupported("Choose an exact reviewed Polly engine")
	}
	s := req.GetSpec().GetSpeechSynthesize()
	if s == nil || mode != CloudMediaStreamNone || len(req.GetExtensions()) != 0 || s.Speed != nil || s.Pitch != nil || s.Volume != nil || s.GetEmotion() != "" || s.GetVoiceRenderHints() != nil || s.GetIdentityAudio() != nil || s.GetPerformanceAudio() != nil || s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED && s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE {
		return nativeCloudSpeechUnsupported("Polly accepts plain text and one voice without separate delivery, timing, native overrides or streaming")
	}
	voice := ""
	switch s.GetVoiceRef().GetKind() {
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET:
		voice = s.GetVoiceRef().GetPresetVoiceId()
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF:
		voice = s.GetVoiceRef().GetProviderVoiceRef()
	}
	if !pollyVoiceID.MatchString(voice) || strings.TrimSpace(s.GetText()) == "" || utf8.RuneCountInString(s.GetText()) > 3000 || s.GetLanguage() != "" && !pollyLocale.MatchString(s.GetLanguage()) {
		return nativeCloudSpeechUnsupported("Polly requires one voice, at most 3000 plain-text characters and an optional native locale")
	}
	if s.GetAudioFormat() == "" {
		s.AudioFormat = "mp3"
	}
	defaultRate := int32(24000)
	if model == "polly-standard-tts" {
		defaultRate = 22050
	}
	switch s.GetAudioFormat() {
	case "mp3", "ogg":
	case "ogg_opus":
		defaultRate = 48000
	case "pcm":
		defaultRate = 16000
	case "mulaw", "alaw":
		defaultRate = 8000
	default:
		return nativeCloudSpeechUnsupported("Polly supports MP3, Ogg Vorbis, Ogg Opus, PCM, mu-law or A-law")
	}
	if s.SampleRateHz == nil {
		s.SampleRateHz = proto.Int32(defaultRate)
	}
	rate := s.GetSampleRateHz()
	valid := false
	switch s.GetAudioFormat() {
	case "mp3", "ogg":
		valid = rate == 8000 || rate == 16000 || rate == 22050 || rate == 24000 || rate == 44100 || rate == 48000
	case "ogg_opus":
		valid = rate == 48000
	case "pcm":
		valid = rate == 8000 || rate == 16000
	case "mulaw", "alaw":
		valid = rate == 8000
	}
	if !valid {
		return nativeCloudSpeechUnsupported("The requested Polly format and sample rate are not a supported pair")
	}
	return nil
}
