package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"strings"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
// The native JSON route consumes one already resolved voice. Raw references
// need a separate MessagePack mapping and cannot be silently dropped here.
func validateFishS21Request(request *runtimev1.SubmitScenarioJobRequest, mode CloudMediaStreamMode) error {
	spec := request.GetSpec().GetSpeechSynthesize()
	unsupported := func() error {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if spec == nil || mode != CloudMediaStreamNone || len(request.GetExtensions()) > 0 || spec.GetVoiceRef() == nil ||
		spec.GetIdentityAudio() != nil || spec.GetPerformanceAudio() != nil || spec.GetLanguage() != "" || spec.Pitch != nil || spec.Volume != nil || spec.GetEmotion() != "" || spec.GetVoiceRenderHints() != nil ||
		(spec.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED && spec.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE) {
		return unsupported()
	}
	if spec.Speed != nil && (spec.GetSpeed() < 0.5 || spec.GetSpeed() > 2) {
		return unsupported()
	}
	format := strings.ToLower(spec.GetAudioFormat())
	if format == "" {
		format = "mp3"
	}
	rates := map[string][]int32{"wav": {8000, 16000, 24000, 32000, 44100}, "pcm": {8000, 16000, 24000, 32000, 44100}, "mp3": {32000, 44100}, "opus": {48000}}
	allowed, ok := rates[format]
	if !ok {
		return unsupported()
	}
	if spec.SampleRateHz != nil {
		found := false
		for _, rate := range allowed {
			found = found || spec.GetSampleRateHz() == rate
		}
		if !found {
			return unsupported()
		}
	}
	return nil
}
