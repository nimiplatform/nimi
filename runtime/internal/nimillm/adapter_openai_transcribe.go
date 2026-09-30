package nimillm

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const adapterOpenAITranscriptions = "openai_transcriptions_adapter"
const openAIGPTTranscribeModel = "gpt-transcribe"
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
	text, usage, providerSeconds, err := backend.transcribeOpenAI(ctx, backendModelID, scenarioSpeechTranscribeSpec(request))
	if err != nil {
		return nil, nil, "", err
	}
	metadata := map[string]any{"text": text, "adapter": adapterOpenAITranscriptions}
	if providerSeconds != nil {
		metadata["provider_usage_seconds"] = *providerSeconds
	}
	return []*runtimev1.ScenarioArtifact{BinaryArtifact("text/plain", []byte(text), metadata)}, usage, "", nil
}

func (b *Backend) transcribeOpenAI(ctx context.Context, modelID string, spec *runtimev1.SpeechTranscribeScenarioSpec) (string, *runtimev1.UsageStats, *float64, error) {
	unsupported := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	if b == nil || spec == nil {
		return "", nil, nil, unsupported
	}
	source, ok := spec.GetAudioSource().GetSource().(*runtimev1.SpeechTranscriptionAudioSource_AudioBytes)
	filename := openAITranscriptionUploadFilename(spec.GetMimeType())
	format := strings.ToLower(strings.TrimSpace(spec.GetResponseFormat()))
	language := strings.TrimSpace(spec.GetLanguage())
	prompt := strings.TrimSpace(spec.GetPrompt())
	if !ok || len(source.AudioBytes) == 0 || len(source.AudioBytes) > maxOpenAITranscriptionUploadBytes || filename == "" ||
		(format != "" && format != "text") || spec.GetTimestamps() || spec.GetDiarization() || spec.GetSpeakerCount() != 0 ||
		(prompt != "" && modelID == openAIGPTTranscribeModel) {
		return "", nil, nil, unsupported
	}

	// The endpoint's JSON result is the only one that also reports usage.
	fields := [][2]string{{"model", modelID}, {"response_format", "json"}}
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
			return "", nil, nil, MapProviderRequestError(err)
		}
	}
	fileWriter, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return "", nil, nil, MapProviderRequestError(err)
	}
	if _, err := fileWriter.Write(source.AudioBytes); err != nil {
		return "", nil, nil, MapProviderRequestError(err)
	}
	if err := writer.Close(); err != nil {
		return "", nil, nil, MapProviderRequestError(err)
	}
	request, err := b.newRequest(ctx, http.MethodPost, b.baseURL+"/v1/audio/transcriptions", body)
	if err != nil {
		return "", nil, nil, err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := b.do(request)
	if err != nil {
		return "", nil, nil, MapProviderRequestError(err)
	}
	defer func() { _ = response.Body.Close() }()

	var out struct {
		Text  *string `json:"text"`
		Usage *struct {
			Type         string   `json:"type"`
			InputTokens  *int64   `json:"input_tokens"`
			OutputTokens *int64   `json:"output_tokens"`
			Seconds      *float64 `json:"seconds"`
		} `json:"usage"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return "", nil, nil, err
	}
	// The endpoint does not report silence explicitly, so an empty transcript
	// is not a no_speech result.
	if out.Text == nil || strings.TrimSpace(*out.Text) == "" {
		return "", nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
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
	return strings.TrimSpace(*out.Text), usage, providerSeconds, nil
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
