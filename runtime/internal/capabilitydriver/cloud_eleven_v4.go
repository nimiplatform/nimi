package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"strings"
	"unicode/utf8"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validateElevenV4Request(request *runtimev1.SubmitScenarioJobRequest, model string, mode CloudMediaStreamMode) error {
	s := request.GetSpec().GetSpeechSynthesize()
	unsupported := func() error {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if s == nil || mode != CloudMediaStreamNone || len(request.GetExtensions()) > 0 || s.GetVoiceRef() == nil || s.GetIdentityAudio() != nil || s.GetPerformanceAudio() != nil || s.Pitch != nil || s.Volume != nil || s.GetEmotion() != "" || s.GetVoiceRenderHints() != nil || (s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED && s.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE) {
		return unsupported()
	}
	if model == "eleven_v4" && utf8.RuneCountInString(s.GetText()) > 10000 {
		return unsupported()
	}
	format := strings.ToLower(s.GetAudioFormat())
	if format == "" {
		format = "mp3"
	}
	rates := map[string][]int32{"mp3": {22050, 24000, 44100}, "pcm": {8000, 16000, 22050, 24000, 32000, 44100, 48000}, "wav": {8000, 16000, 22050, 24000, 32000, 44100, 48000}, "ogg": {48000}}
	allowed, ok := rates[format]
	if !ok {
		return unsupported()
	}
	if s.SampleRateHz != nil {
		found := false
		for _, rate := range allowed {
			found = found || s.GetSampleRateHz() == rate
		}
		if !found {
			return unsupported()
		}
	}
	return nil
}
