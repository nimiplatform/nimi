package nimillm

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
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
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}

	if scenarioModal(req) != runtimev1.Modal_MODAL_TTS {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioSpeechSynthesizeSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	voiceRef := strings.TrimSpace(scenarioVoiceRef(spec))
	language := strings.TrimSpace(spec.GetLanguage())
	text := spec.GetText()

	ssml := buildAzureSSML(language, voiceRef, text, spec.GetEmotion())
	outputFormat := resolveAzureOutputFormat(spec)

	endpoint := firstProviderEndpointPath([]string{"/cognitiveservices/v1"})
	targetURL := JoinURL(baseURL, endpoint)

	bodyBytes, mimeType, err := doAzureSpeechRequest(ctx, targetURL, apiKey, ssml, outputFormat)
	if err != nil {
		return nil, nil, "", err
	}
	if len(bodyBytes) == 0 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if !strings.HasPrefix(strings.ToLower(mimeType), "audio/") && !strings.HasPrefix(strings.ToLower(mimeType), "application/octet-stream") && !strings.HasPrefix(strings.ToLower(mimeType), "application/ogg") {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	encoding := spec.GetAudioFormat()
	if encoding == "ogg" {
		encoding = "ogg_opus"
	}
	artifact, err := nativeSpeechArtifact(ctx, bodyBytes, encoding, spec.GetSampleRateHz(), map[string]any{
		"adapter":        AdapterAzureSpeechNative,
		"endpoint":       endpoint,
		"voice":          voiceRef,
		"language":       language,
		"resolved_model": modelResolved,
	})
	if err != nil {
		return nil, nil, "", err
	}
	return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
}

func buildAzureSSML(language, voiceName, text, emotion string) string {
	body := xmlEscapeString(text)
	if emotion != "" {
		body = "<mstts:express-as style='" + xmlEscapeString(emotion) + "'>" + body + "</mstts:express-as>"
	}
	return "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='" + xmlEscapeString(language) + "'>" +
		"<voice name='" + xmlEscapeString(voiceName) + "'>" + body + "</voice></speak>"
}

func xmlEscapeString(value string) string {
	var builder strings.Builder
	_ = xml.EscapeText(&builder, []byte(value))
	return builder.String()
}

func resolveAzureOutputFormat(spec *runtimev1.SpeechSynthesizeScenarioSpec) string {
	rate := spec.GetSampleRateHz()
	ratePart := fmt.Sprintf("%dkhz", rate/1000)
	if rate == 22050 || rate == 44100 {
		ratePart = fmt.Sprintf("%dhz", rate)
	}
	switch spec.GetAudioFormat() {
	case "ogg":
		return "ogg-48khz-16bit-mono-opus"
	case "wav":
		return "riff-" + ratePart + "-16bit-mono-pcm"
	case "pcm":
		return "raw-" + ratePart + "-16bit-mono-pcm"
	case "mp3":
		bitrate := map[int32]int{16000: 128, 24000: 160, 48000: 192}[rate]
		return fmt.Sprintf("audio-%s-%dkbitrate-mono-mp3", ratePart, bitrate)
	default:
		return ""
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
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return nil, "", MapProviderHTTPError(response.StatusCode, payload)
	}
	raw, err := readLimitedResponseBody(response.Body, maxDecodedMediaURLBytes)
	if err != nil {
		return nil, "", providerResponseReadError(err)
	}
	contentType := strings.TrimSpace(response.Header.Get("Content-Type"))
	return raw, contentType, nil
}
