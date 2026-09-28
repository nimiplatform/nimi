package capabilitydriver

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const dashscopeQwenAudio31ASRModel = "qwen-audio-3.1-asr-flash"
const maxDashscopeQwenAudio31InlineWAVBytes = 2 * 1024 * 1024

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func validateDashscopeQwenAudio31InlineTranscribeRequest(request *runtimev1.SubmitScenarioJobRequest, streamMode CloudMediaStreamMode) error {
	unsupported := func() error {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			Message:    "Qwen-Audio 3.1 short transcription requires an inline mono 24 kHz PCM WAV of at most 30 seconds and a plain transcript; file URLs, hints, timing and diarization are separate modes",
			ActionHint: "provide_short_inline_wav_without_transcription_options",
		})
	}
	if request == nil || request.GetSpec().GetSpeechTranscribe() == nil || len(request.GetExtensions()) > 0 || streamMode != CloudMediaStreamNone {
		return unsupported()
	}
	spec := request.GetSpec().GetSpeechTranscribe()
	if strings.TrimSpace(spec.GetMimeType()) != "audio/wav" || strings.TrimSpace(spec.GetLanguage()) != "" ||
		spec.GetTimestamps() || spec.GetDiarization() || spec.GetSpeakerCount() != 0 ||
		strings.TrimSpace(spec.GetPrompt()) != "" || strings.TrimSpace(spec.GetResponseFormat()) != "" {
		return unsupported()
	}
	source, ok := spec.GetAudioSource().GetSource().(*runtimev1.SpeechTranscriptionAudioSource_AudioBytes)
	if !ok || len(source.AudioBytes) == 0 || len(source.AudioBytes) > maxDashscopeQwenAudio31InlineWAVBytes ||
		!geminiInlineTranscribeWAVValid(source.AudioBytes) {
		return unsupported()
	}
	return nil
}
