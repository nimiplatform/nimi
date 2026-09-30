package capabilitydriver

import (
	"regexp"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const CloudMediaAdapterOpenAITranscriptions = "openai_transcriptions_adapter"

const openAITranscribeModel = "gpt-transcribe"
const maxOpenAITranscribeUploadBytes = 25 * 1024 * 1024

// openAITranscribeModels are the file transcription models whose request and
// JSON result mapping is owned by the exact OpenAI transcriptions adapter.
var openAITranscribeModels = map[string]bool{
	openAITranscribeModel:    true,
	"gpt-4o-transcribe":      true,
	"gpt-4o-mini-transcribe": true,
}

var openAITranscribeLanguagePattern = regexp.MustCompile(`^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$`)

// openAITranscribeUploadMIMEs are the audio MIME types the transcriptions
// endpoint accepts as an uploaded file.
var openAITranscribeUploadMIMEs = map[string]bool{
	"audio/wav": true, "audio/x-wav": true, "audio/wave": true,
	"audio/mpeg": true, "audio/mp3": true,
	"audio/mp4": true, "audio/m4a": true, "audio/x-m4a": true,
	"audio/webm": true,
}

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
// validateOpenAITranscribeRequest admits one uploaded recording and a plain
// transcript. gpt-transcribe takes an expected language but no free-text hint;
// the GPT-4o pair also takes a hint. Timing, speakers, URLs, alternate result
// formats and extensions are never silently dropped or substituted.
func validateOpenAITranscribeRequest(request *runtimev1.SubmitScenarioJobRequest, model string) error {
	unsupported := func() error {
		message := "OpenAI GPT-4o transcription supports one uploaded WAV, MP3, M4A or WebM recording of at most 25 MB, an optional language code and hint, and a plain transcript; URLs, timestamps, speakers and other result formats are unavailable"
		if model == openAITranscribeModel {
			message = "OpenAI GPT Transcribe supports one uploaded WAV, MP3, M4A or WebM recording of at most 25 MB, an optional expected language code, and a plain transcript; hints, URLs, timestamps, speakers and other result formats are unavailable"
		}
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			Message:    message,
			ActionHint: "provide_uploaded_audio_without_unsupported_transcription_options",
		})
	}
	if request == nil || request.GetSpec().GetSpeechTranscribe() == nil || !openAITranscribeModels[model] || len(request.GetExtensions()) > 0 {
		return unsupported()
	}
	spec := request.GetSpec().GetSpeechTranscribe()
	if !openAITranscribeUploadMIMEs[strings.ToLower(strings.TrimSpace(spec.GetMimeType()))] ||
		spec.GetTimestamps() || spec.GetDiarization() || spec.GetSpeakerCount() != 0 {
		return unsupported()
	}
	switch strings.ToLower(strings.TrimSpace(spec.GetResponseFormat())) {
	case "", "text":
	default:
		return unsupported()
	}
	if language := strings.TrimSpace(spec.GetLanguage()); language != "" && !openAITranscribeLanguagePattern.MatchString(language) {
		return unsupported()
	}
	if strings.TrimSpace(spec.GetPrompt()) != "" && model == openAITranscribeModel {
		return unsupported()
	}
	source, ok := spec.GetAudioSource().GetSource().(*runtimev1.SpeechTranscriptionAudioSource_AudioBytes)
	if !ok || len(source.AudioBytes) == 0 || len(source.AudioBytes) > maxOpenAITranscribeUploadBytes {
		return unsupported()
	}
	return nil
}
