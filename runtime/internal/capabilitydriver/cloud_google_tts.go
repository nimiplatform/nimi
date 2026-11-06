package capabilitydriver

import (
	"math"
	"regexp"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

var googleCloudTTSLocale = regexp.MustCompile(`^[a-z]{2,3}-[A-Z]{2}$`)
var googleCloudTTSVoices = strings.Fields("Achernar Achird Algenib Algieba Alnilam Aoede Autonoe Callirrhoe Charon Despina Enceladus Erinome Fenrir Gacrux Iapetus Kore Laomedeia Leda Orus Pulcherrima Puck Rasalgethi Sadachbia Sadaltager Schedar Sulafat Umbriel Vindemiatrix Zephyr Zubenelgenubi")

func googleCloudTTSUnsupported(message string) error {
	return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{Message: message})
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validateGoogleCloudTTSRequest(req *runtimev1.SubmitScenarioJobRequest, model string, mode CloudMediaStreamMode) error {
	chirp := model == "chirp-3-hd"
	switch model {
	case "chirp-3-hd", "gemini-2.5-flash-tts", "gemini-2.5-pro-tts", "gemini-2.5-flash-lite-preview-tts", "gemini-3.1-flash-tts-preview":
	default:
		return googleCloudTTSUnsupported("Choose a reviewed Cloud Text-to-Speech model; Gemini API models use their own connection")
	}
	s := req.GetSpec().GetSpeechSynthesize()
	if s == nil || mode != CloudMediaStreamNone || len(req.GetExtensions()) != 0 || s.GetIdentityAudio() != nil || s.GetPerformanceAudio() != nil || s.GetVoiceRenderHints() != nil || s.Pitch != nil || s.Volume != nil || s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED && s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE {
		return googleCloudTTSUnsupported("Cloud TTS accepts a single voice and complete audio output; reset unsupported speech controls, timing, streaming or native overrides")
	}
	limit := 4000
	if chirp {
		limit = 5000
	}
	if strings.TrimSpace(s.GetText()) == "" || len(s.GetText()) > limit || len(s.GetEmotion()) > 4000 || chirp && s.GetEmotion() != "" {
		return googleCloudTTSUnsupported("Cloud TTS text exceeds the model byte limit or requests unsupported delivery instructions")
	}
	if s.Speed != nil && (!chirp || math.IsNaN(float64(s.GetSpeed())) || s.GetSpeed() < .25 || s.GetSpeed() > 2) {
		return googleCloudTTSUnsupported("Only Chirp 3 admits the native pace control, from 0.25 to 2.0")
	}
	voice := ""
	switch s.GetVoiceRef().GetKind() {
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET:
		voice = s.GetVoiceRef().GetPresetVoiceId()
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF:
		voice = s.GetVoiceRef().GetProviderVoiceRef()
	default:
		return googleCloudTTSUnsupported("Choose a Cloud TTS preset voice")
	}
	if chirp {
		parts := strings.Split(voice, "-Chirp3-HD-")
		if len(parts) != 2 || !googleCloudTTSLocale.MatchString(parts[0]) {
			return googleCloudTTSUnsupported("Chirp 3 needs its locale-qualified voice name")
		}
		if s.GetLanguage() == "" {
			s.Language = parts[0]
		}
		if s.GetLanguage() != parts[0] {
			return googleCloudTTSUnsupported("Chirp 3 voice locale and requested language must match")
		}
		voice = parts[1]
	} else if s.GetLanguage() == "" {
		s.Language = "en-US"
	}
	if !googleCloudTTSLocale.MatchString(s.GetLanguage()) || !contains(googleCloudTTSVoices, voice) {
		return googleCloudTTSUnsupported("Choose a reviewed voice and a native locale such as en-US or cmn-CN")
	}
	if s.GetAudioFormat() == "" {
		s.AudioFormat = "wav"
	}
	switch s.GetAudioFormat() {
	case "wav", "mp3", "pcm", "mulaw", "alaw", "ogg":
	default:
		return googleCloudTTSUnsupported("Choose WAV, MP3, Ogg Opus, PCM, mu-law or A-law")
	}
	if s.SampleRateHz == nil {
		rate := int32(24000)
		if s.GetAudioFormat() == "ogg" {
			rate = 48000
		}
		s.SampleRateHz = proto.Int32(rate)
	}
	switch s.GetSampleRateHz() {
	case 8000, 16000, 22050, 24000, 32000, 44100, 48000:
	default:
		return googleCloudTTSUnsupported("Choose a supported audio sample rate")
	}
	if s.GetAudioFormat() == "ogg" && s.GetSampleRateHz() != 48000 {
		return googleCloudTTSUnsupported("Ogg Opus is delivered on its native 48 kHz decoding clock")
	}
	return nil
}
