package nimillm

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
)

const adapterOpenAITranscriptions = "openai_transcriptions_adapter"
const openAIGPTTranscribeModel = "gpt-transcribe"
const openAIWhisperTranscribeModel = "whisper-1"
const maxOpenAITranscriptionUploadBytes = 25 * 1024 * 1024

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
// executeOpenAITranscriptions uploads one recording to the OpenAI
// transcriptions endpoint and returns only the transcript it reports. It
// carries no guessed language, timing or usage.
func (p *CloudProvider) executeOpenAITranscriptions(
	ctx context.Context,
	request *runtimev1.SubmitScenarioJobRequest,
	modelID string,
	target *RemoteTarget,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	if p == nil || target == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	backend, backendModelID := p.ResolveMediaBackendWithTarget(modelID, target)
	if backend == nil || strings.TrimSpace(backendModelID) == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	transcript, usage, providerSeconds, err := backend.transcribeOpenAI(ctx, backendModelID, scenarioSpeechTranscribeSpec(request))
	if err != nil {
		return nil, nil, "", err
	}
	encoded, err := protojson.Marshal(transcript)
	if err != nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	metadata := map[string]any{"adapter": adapterOpenAITranscriptions}
	if providerSeconds != nil {
		metadata["provider_usage_seconds"] = *providerSeconds
	}
	return []*runtimev1.ScenarioArtifact{BinaryArtifact(localexecution.SpeechTranscriptMIME, encoded, metadata)}, usage, "", nil
}

func (b *Backend) transcribeOpenAI(ctx context.Context, modelID string, spec *runtimev1.SpeechTranscribeScenarioSpec) (*runtimev1.SpeechTranscript, *runtimev1.UsageStats, *float64, error) {
	unsupported := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	if b == nil || spec == nil {
		return nil, nil, nil, unsupported
	}
	source, ok := spec.GetAudioSource().GetSource().(*runtimev1.SpeechTranscriptionAudioSource_AudioBytes)
	filename := openAITranscriptionUploadFilename(spec.GetMimeType())
	format := strings.ToLower(strings.TrimSpace(spec.GetResponseFormat()))
	language := strings.TrimSpace(spec.GetLanguage())
	prompt := strings.TrimSpace(spec.GetPrompt())
	if !ok || len(source.AudioBytes) == 0 || len(source.AudioBytes) > maxOpenAITranscriptionUploadBytes || filename == "" ||
		(format != "" && format != "text") || (spec.GetTimestamps() && modelID != openAIWhisperTranscribeModel) || spec.GetDiarization() || spec.GetSpeakerCount() != 0 ||
		(prompt != "" && modelID == openAIGPTTranscribeModel) {
		return nil, nil, nil, unsupported
	}

	// Select a native structured result rather than requesting plain text.
	fields := [][2]string{{"model", modelID}, {"response_format", "json"}}
	if modelID == openAIWhisperTranscribeModel {
		// Verbose JSON reports detected language; the public result remains the
		// existing typed transcript rather than an upstream response format.
		fields[1][1] = "verbose_json"
		if spec.GetTimestamps() {
			fields = append(fields, [2]string{"timestamp_granularities[]", "word"})
		}
	}
	if language != "" {
		// gpt-transcribe replaces the single language with a list of
		// expected languages.
		name := "language"
		if modelID == openAIGPTTranscribeModel {
			name = "languages[]"
		}
		fields = append(fields, [2]string{name, language})
	}
	if prompt != "" {
		fields = append(fields, [2]string{"prompt", prompt})
	}
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for _, field := range fields {
		if err := writer.WriteField(field[0], field[1]); err != nil {
			return nil, nil, nil, MapProviderRequestError(err)
		}
	}
	fileWriter, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return nil, nil, nil, MapProviderRequestError(err)
	}
	if _, err := fileWriter.Write(source.AudioBytes); err != nil {
		return nil, nil, nil, MapProviderRequestError(err)
	}
	if err := writer.Close(); err != nil {
		return nil, nil, nil, MapProviderRequestError(err)
	}
	request, err := b.newRequest(ctx, http.MethodPost, b.baseURL+"/v1/audio/transcriptions", body)
	if err != nil {
		return nil, nil, nil, err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := b.do(request)
	if err != nil {
		return nil, nil, nil, MapProviderRequestError(err)
	}
	defer func() { _ = response.Body.Close() }()

	var out struct {
		Text     *string `json:"text"`
		Language *string `json:"language"`
		Words    []struct {
			Word  *string  `json:"word"`
			Start *float64 `json:"start"`
			End   *float64 `json:"end"`
		} `json:"words"`
		Languages []struct {
			Code string `json:"code"`
		} `json:"languages"`
		Usage *struct {
			Type         string   `json:"type"`
			InputTokens  *int64   `json:"input_tokens"`
			OutputTokens *int64   `json:"output_tokens"`
			Seconds      *float64 `json:"seconds"`
		} `json:"usage"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return nil, nil, nil, err
	}
	// The endpoint does not report silence explicitly, so an empty transcript
	// is not a no_speech result.
	if out.Text == nil || strings.TrimSpace(*out.Text) == "" {
		return nil, nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	transcript := &runtimev1.SpeechTranscript{
		Status: runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_TRANSCRIBED,
		Text:   strings.TrimSpace(*out.Text),
	}
	// The current public result has one model-reported language. Reject an
	// unrepresentable multilingual result rather than dropping languages or
	// selecting the first. An absent report stays empty, regardless of hints.
	if len(out.Languages) > 1 {
		return nil, nil, nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, grpcerr.ReasonOptions{
			Message: "OpenAI reported multiple transcription languages; the current speech transcript supports one detected language",
		})
	}
	if len(out.Languages) == 1 {
		transcript.Language = out.Languages[0].Code
		if strings.TrimSpace(transcript.Language) == "" {
			return nil, nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
	}
	if modelID == openAIWhisperTranscribeModel {
		if out.Language != nil {
			code, ok := openAIWhisperReportedLanguageCode(*out.Language)
			if !ok {
				return nil, nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
			}
			transcript.Language = code
		}
		if len(out.Words) > localexecution.MaxSpeechTranscriptWords {
			return nil, nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		for _, word := range out.Words {
			if word.Word == nil || word.Start == nil || word.End == nil {
				return nil, nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
			}
			transcript.Words = append(transcript.Words, &runtimev1.SpeechTranscriptWord{
				Text: *word.Word, StartSeconds: *word.Start, EndSeconds: *word.End,
			})
		}
	}
	if err := localexecution.ValidateSpeechTranscript(transcript, spec.GetTimestamps()); err != nil {
		return nil, nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	var usage *runtimev1.UsageStats
	var providerSeconds *float64
	if reported := out.Usage; reported != nil {
		switch reported.Type {
		case "tokens":
			if reported.InputTokens != nil && reported.OutputTokens != nil && *reported.InputTokens >= 0 && *reported.OutputTokens >= 0 {
				usage = &runtimev1.UsageStats{InputTokens: *reported.InputTokens, OutputTokens: *reported.OutputTokens}
			}
		case "duration":
			if reported.Seconds != nil && *reported.Seconds >= 0 {
				seconds := *reported.Seconds
				providerSeconds = &seconds
			}
		}
	}
	return transcript, usage, providerSeconds, nil
}

// Whisper reports its own language names in verbose_json, not CLDR display
// names. Source: OpenAI whisper/tokenizer.py LANGUAGES and TO_LANGUAGE_CODE:
// https://github.com/openai/whisper/blob/main/whisper/tokenizer.py
// Convert only the actual report; never use hints or transcript text.
func openAIWhisperReportedLanguageCode(name string) (string, bool) {
	if name == "" || strings.TrimSpace(name) != name {
		return "", false
	}
	code, ok := map[string]string{
		"english": "en", "chinese": "zh", "german": "de", "spanish": "es",
		"russian": "ru", "korean": "ko", "french": "fr", "japanese": "ja",
		"portuguese": "pt", "turkish": "tr", "polish": "pl", "catalan": "ca",
		"dutch": "nl", "arabic": "ar", "swedish": "sv", "italian": "it",
		"indonesian": "id", "hindi": "hi", "finnish": "fi", "vietnamese": "vi",
		"hebrew": "he", "ukrainian": "uk", "greek": "el", "malay": "ms",
		"czech": "cs", "romanian": "ro", "danish": "da", "hungarian": "hu",
		"tamil": "ta", "norwegian": "no", "thai": "th", "urdu": "ur",
		"croatian": "hr", "bulgarian": "bg", "lithuanian": "lt", "latin": "la",
		"maori": "mi", "malayalam": "ml", "welsh": "cy", "slovak": "sk",
		"telugu": "te", "persian": "fa", "latvian": "lv", "bengali": "bn",
		"serbian": "sr", "azerbaijani": "az", "slovenian": "sl", "kannada": "kn",
		"estonian": "et", "macedonian": "mk", "breton": "br", "basque": "eu",
		"icelandic": "is", "armenian": "hy", "nepali": "ne", "mongolian": "mn",
		"bosnian": "bs", "kazakh": "kk", "albanian": "sq", "swahili": "sw",
		"galician": "gl", "marathi": "mr", "punjabi": "pa", "sinhala": "si",
		"khmer": "km", "shona": "sn", "yoruba": "yo", "somali": "so",
		"afrikaans": "af", "occitan": "oc", "georgian": "ka", "belarusian": "be",
		"tajik": "tg", "sindhi": "sd", "gujarati": "gu", "amharic": "am",
		"yiddish": "yi", "lao": "lo", "uzbek": "uz", "faroese": "fo",
		"haitian creole": "ht", "pashto": "ps", "turkmen": "tk", "nynorsk": "nn",
		"maltese": "mt", "sanskrit": "sa", "luxembourgish": "lb", "myanmar": "my",
		"tibetan": "bo", "tagalog": "tl", "malagasy": "mg", "assamese": "as",
		"tatar": "tt", "hawaiian": "haw", "lingala": "ln", "hausa": "ha",
		"bashkir": "ba", "javanese": "jw", "sundanese": "su", "cantonese": "yue",
		"burmese": "my", "valencian": "ca", "flemish": "nl", "haitian": "ht",
		"letzeburgesch": "lb", "pushto": "ps", "panjabi": "pa", "moldavian": "ro",
		"moldovan": "ro", "sinhalese": "si", "castilian": "es", "mandarin": "zh",
	}[strings.ToLower(name)]
	return code, ok
}

func openAITranscriptionUploadFilename(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "audio/wav", "audio/x-wav", "audio/wave":
		return "audio.wav"
	case "audio/mpeg", "audio/mp3":
		return "audio.mp3"
	case "audio/mp4", "audio/m4a", "audio/x-m4a":
		return "audio.m4a"
	case "audio/webm":
		return "audio.webm"
	default:
		return ""
	}
}
