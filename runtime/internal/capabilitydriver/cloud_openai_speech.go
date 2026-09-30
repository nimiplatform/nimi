package capabilitydriver

import (
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const CloudMediaAdapterOpenAISpeech = "openai_speech_adapter"

const maxOpenAISpeechInputRunes = 4096

// openAISpeechVoices are the built-in voices each speech model accepts; tts-1
// predates ballad, verse, marin and cedar.
var openAISpeechVoices = map[string]map[string]bool{
	"gpt-4o-mini-tts": {
		"alloy": true, "ash": true, "ballad": true, "coral": true, "echo": true, "fable": true, "nova": true,
		"onyx": true, "sage": true, "shimmer": true, "verse": true, "marin": true, "cedar": true,
	},
	"tts-1": {
		"alloy": true, "ash": true, "coral": true, "echo": true, "fable": true, "nova": true,
		"onyx": true, "sage": true, "shimmer": true,
	},
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
// validateOpenAISpeechRequest admits one built-in voice reading English or
// Chinese text of at most 4096 characters, an optional speed from 0.25 to 4,
// and a complete MP3. No other control is converted into instructions or
// silently dropped.
func validateOpenAISpeechRequest(request *runtimev1.SubmitScenarioJobRequest, model string, streamMode CloudMediaStreamMode) error {
	unsupported := func() error {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			Message:    "OpenAI speech currently supports one built-in voice reading English or Chinese text of at most 4096 characters, an optional speed from 0.25 to 4, and a complete MP3; streaming, timing, pitch, volume, emotion and other formats are unavailable",
			ActionHint: "choose_openai_builtin_voice_mp3",
		})
	}
	voices := openAISpeechVoices[model]
	if request == nil || request.GetSpec().GetSpeechSynthesize() == nil || voices == nil ||
		streamMode != CloudMediaStreamNone || len(request.GetExtensions()) > 0 {
		return unsupported()
	}
	spec := request.GetSpec().GetSpeechSynthesize()
	text := strings.TrimSpace(spec.GetText())
	ref := spec.GetVoiceRef()
	if text == "" || utf8.RuneCountInString(text) > maxOpenAISpeechInputRunes ||
		ref == nil || ref.GetKind() != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET || !voices[ref.GetPresetVoiceId()] {
		return unsupported()
	}
	if (spec.GetLanguage() != "" && spec.GetLanguage() != "en" && spec.GetLanguage() != "zh") ||
		(spec.GetAudioFormat() != "" && !strings.EqualFold(spec.GetAudioFormat(), "mp3")) ||
		(spec.SampleRateHz != nil && spec.GetSampleRateHz() != 24000) ||
		(spec.Speed != nil && (spec.GetSpeed() < 0.25 || spec.GetSpeed() > 4)) ||
		spec.Pitch != nil || spec.Volume != nil ||
		strings.TrimSpace(spec.GetEmotion()) != "" || spec.GetVoiceRenderHints() != nil ||
		(spec.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED &&
			spec.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE) {
		return unsupported()
	}
	return nil
}
