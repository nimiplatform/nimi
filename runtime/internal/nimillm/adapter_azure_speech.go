package nimillm

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"io"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterAzureSpeechNative = "azure_speech_native_adapter"

// ExecuteAzureSpeechTTS executes a TTS scenario job against the Azure Cognitive Services Speech API.
// Uses POST /cognitiveservices/v1 with SSML body. Auth via Ocp-Apim-Subscription-Key.
func ExecuteAzureSpeechTTS(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey := strings.TrimSpace(cfg.APIKey)

	if scenarioModal(req) != runtimev1.Modal_MODAL_TTS {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioSpeechSynthesizeSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	ext := scenarioExtensionPayloadForScenario(req)
	voiceRef := strings.TrimSpace(scenarioVoiceRef(spec))
	if voiceRef == "" {
		voiceRef = "en-US-JennyNeural"
	}
	language := strings.TrimSpace(spec.GetLanguage())
	if language == "" {
		language = "en-US"
	}
	text := strings.TrimSpace(spec.GetText())

	ssml := buildAzureSSML(language, voiceRef, text)
	outputFormat := resolveAzureOutputFormat(spec)

	endpoint := FirstProviderEndpointPath(
		ext,
		[]string{"tts_path", "speech_path"},
		[]string{"tts_paths", "speech_paths"},
		[]string{"/cognitiveservices/v1"},
	)
	targetURL := JoinURL(baseURL, endpoint)

	bodyBytes, mimeType, err := doAzureSpeechRequest(ctx, targetURL, apiKey, ssml, outputFormat)
	if err != nil {
		return nil, nil, "", err
	}
	if len(bodyBytes) == 0 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "audio/") {
		mimeType = ResolveSpeechArtifactMIME(spec, bodyBytes)
	}
	artifact := BinaryArtifact(mimeType, bodyBytes, map[string]any{
		"adapter":    AdapterAzureSpeechNative,
		"endpoint":   endpoint,
		"voice":      voiceRef,
		"language":   language,
		"extensions": ext,
	})
	ApplySpeechSpecMetadata(artifact, spec)
	return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(text, bodyBytes, 100), "", nil
}

func buildAzureSSML(language, voiceName, text string) string {
	return "<speak version='1.0' xml:lang='" + xmlEscapeString(language) + "'>" +
		"<voice name='" + xmlEscapeString(voiceName) + "'>" + xmlEscapeString(text) + "</voice></speak>"
}

func xmlEscapeString(value string) string {
	var builder strings.Builder
	_ = xml.EscapeText(&builder, []byte(value))
	return builder.String()
}

func resolveAzureOutputFormat(spec *runtimev1.SpeechSynthesizeScenarioSpec) string {
	if spec == nil {
		return "audio-16khz-128kbitrate-mono-mp3"
	}
	format := strings.ToLower(strings.TrimSpace(spec.GetAudioFormat()))
	switch format {
	case "ogg", "audio/ogg":
		return "ogg-48khz-16bit-mono-opus"
	case "wav", "audio/wav":
		return "riff-24khz-16bit-mono-pcm"
	case "pcm", "audio/pcm":
		return "raw-24khz-16bit-mono-pcm"
	default:
		return "audio-16khz-128kbitrate-mono-mp3"
	}
}

func doAzureSpeechRequest(ctx context.Context, targetURL, apiKey, ssmlBody, outputFormat string) ([]byte, string, error) {
	client, request, err := newSecuredHTTPRequest(ctx, http.MethodPost, targetURL, strings.NewReader(ssmlBody))
	if err != nil {
		return nil, "", err
	}
	request.Header.Set("Content-Type", "application/ssml+xml")
	request.Header.Set("X-Microsoft-OutputFormat", outputFormat)
	if strings.TrimSpace(apiKey) != "" {
		request.Header.Set("Ocp-Apim-Subscription-Key", strings.TrimSpace(apiKey))
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, "", MapProviderRequestError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return nil, "", MapProviderHTTPError(response.StatusCode, payload)
	}
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	contentType := strings.TrimSpace(response.Header.Get("Content-Type"))
	return raw, contentType, nil
}
