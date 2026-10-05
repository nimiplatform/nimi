package capabilitydriver

import (
	"encoding/binary"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const geminiInlineTranscribeModel = "gemini-3.5-transcribe"
const maxGeminiInlineTranscribeWAVBytes = 2 * 1024 * 1024
const maxGeminiInlineTranscribeDurationMS = 30_000

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
// ValidateGeminiInlineTranscribeRequest admits a small stateless unary cell.
// Files upload, remote URLs, diarization and provider-side storage are
// not silently selected from an App's broader transcription request.
func ValidateGeminiInlineTranscribeRequest(request *runtimev1.SubmitScenarioJobRequest, model string) error {
	unsupported := func() error {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			Message:    "Gemini 3.5 Transcribe supports an inline mono 24 kHz PCM WAV of at most 30 seconds, with optional real word timestamps; URLs, diarization, language hints and vocabulary prompts are unavailable",
			ActionHint: "provide_short_inline_wav_and_reset_unsupported_transcription_options",
		})
	}
	if request == nil || request.GetSpec().GetSpeechTranscribe() == nil || model != geminiInlineTranscribeModel || len(request.GetExtensions()) > 0 {
		return unsupported()
	}
	spec := request.GetSpec().GetSpeechTranscribe()
	if strings.TrimSpace(spec.GetMimeType()) != "audio/wav" || strings.TrimSpace(spec.GetLanguage()) != "" ||
		spec.GetDiarization() || spec.GetSpeakerCount() != 0 ||
		strings.TrimSpace(spec.GetPrompt()) != "" || (spec.GetResponseFormat() != "" && spec.GetResponseFormat() != "text") {
		return unsupported()
	}
	source, ok := spec.GetAudioSource().GetSource().(*runtimev1.SpeechTranscriptionAudioSource_AudioBytes)
	if !ok || len(source.AudioBytes) == 0 || len(source.AudioBytes) > maxGeminiInlineTranscribeWAVBytes ||
		!geminiInlineTranscribeWAVValid(source.AudioBytes) {
		return unsupported()
	}
	return nil
}

func geminiInlineTranscribeWAVValid(audio []byte) bool {
	if len(audio) < 44 || string(audio[:4]) != "RIFF" || string(audio[8:12]) != "WAVE" ||
		uint64(binary.LittleEndian.Uint32(audio[4:8]))+8 != uint64(len(audio)) {
		return false
	}
	formatFound := false
	dataBytes := 0
	for offset := 12; offset < len(audio); {
		if offset+8 > len(audio) {
			return false
		}
		size := int(binary.LittleEndian.Uint32(audio[offset+4 : offset+8]))
		start := offset + 8
		if size < 0 || size > len(audio)-start {
			return false
		}
		switch string(audio[offset : offset+4]) {
		case "fmt ":
			if formatFound || size < 16 || binary.LittleEndian.Uint16(audio[start:start+2]) != 1 ||
				binary.LittleEndian.Uint16(audio[start+2:start+4]) != 1 ||
				binary.LittleEndian.Uint32(audio[start+4:start+8]) != 24000 ||
				binary.LittleEndian.Uint32(audio[start+8:start+12]) != 48000 ||
				binary.LittleEndian.Uint16(audio[start+12:start+14]) != 2 ||
				binary.LittleEndian.Uint16(audio[start+14:start+16]) != 16 {
				return false
			}
			formatFound = true
		case "data":
			if dataBytes != 0 || size == 0 || size%2 != 0 {
				return false
			}
			dataBytes = size
		}
		offset = start + size + size%2
		if offset > len(audio) {
			return false
		}
	}
	return formatFound && dataBytes > 0 &&
		int64(dataBytes)*1000 <= int64(maxGeminiInlineTranscribeDurationMS)*48000
}
