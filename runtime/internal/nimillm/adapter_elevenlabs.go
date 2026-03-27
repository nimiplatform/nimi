package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterElevenLabsNative = "elevenlabs_native_adapter"

// ExecuteElevenLabsNative executes a TTS scenario job against the ElevenLabs API.
// ElevenLabs uses POST /v1/text-to-speech/{voice_id} with body {model_id, text, voice_settings}.
// Authentication is via xi-api-key header. Returns audio binary directly.
func ExecuteElevenLabsTTS(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.elevenlabs.io"
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
	voiceID := strings.TrimSpace(scenarioVoiceRef(spec))
	if voiceID == "" {
		voiceID = "21m00Tcm4TlvDq8ikWAM" // ElevenLabs default "Rachel" voice
	}

	// Build voice_settings from spec parameters.
	voiceSettings := map[string]any{
		"stability":        0.5,
		"similarity_boost": 0.75,
	}
	if spec.GetSpeed() > 0 {
		voiceSettings["speed"] = spec.GetSpeed()
	}
	if spec.GetVolume() > 0 {
		voiceSettings["speaking_rate"] = spec.GetVolume()
	}

	payload := map[string]any{
		"model_id":       StripProviderModelPrefix(modelResolved, "elevenlabs"),
		"text":           strings.TrimSpace(spec.GetText()),
		"voice_settings": voiceSettings,
	}
	if language := strings.TrimSpace(spec.GetLanguage()); language != "" {
		payload["language_code"] = language
	}

	// Resolve the output format query parameter from audio_format spec.
	outputFormat := resolveElevenLabsOutputFormat(spec)

	// Build request URL: POST /v1/text-to-speech/{voice_id}
	endpoint := "/v1/text-to-speech/" + url.PathEscape(voiceID)
	requestURL := JoinURL(baseURL, endpoint)
	if outputFormat != "" {
		requestURL += "?output_format=" + outputFormat
	}

	bodyBytes, mimeType, err := doElevenLabsBinaryRequest(ctx, requestURL, apiKey, payload)
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
		"adapter":      AdapterElevenLabsNative,
		"endpoint":     endpoint,
		"voice":        voiceID,
		"language":     strings.TrimSpace(spec.GetLanguage()),
		"audio_format": strings.TrimSpace(spec.GetAudioFormat()),
		"emotion":      strings.TrimSpace(spec.GetEmotion()),
		"extensions":   scenarioExtensionPayloadForScenario(req),
	})
	ApplySpeechSpecMetadata(artifact, spec)
	return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetText(), bodyBytes, 120), "", nil
}

// doElevenLabsBinaryRequest performs a POST with JSON body and xi-api-key auth,
// returning raw audio bytes and Content-Type.
func doElevenLabsBinaryRequest(ctx context.Context, targetURL, apiKey string, body any) ([]byte, string, error) {
	requestBody, err := json.Marshal(body)
	if err != nil {
		return nil, "", MapProviderRequestError(err)
	}
	client, request, err := newSecuredHTTPRequest(ctx, http.MethodPost, targetURL, strings.NewReader(string(requestBody)))
	if err != nil {
		return nil, "", err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "audio/mpeg")
	if strings.TrimSpace(apiKey) != "" {
		request.Header.Set("xi-api-key", strings.TrimSpace(apiKey))
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
	raw, err := readLimitedResponseBody(response.Body, maxDecodedMediaURLBytes)
	if err != nil {
		return nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	contentType := strings.TrimSpace(response.Header.Get("Content-Type"))
	return raw, contentType, nil
}

// resolveElevenLabsOutputFormat maps the spec audio_format to ElevenLabs
// output_format query parameter values.
func resolveElevenLabsOutputFormat(spec *runtimev1.SpeechSynthesizeScenarioSpec) string {
	if spec == nil {
		return ""
	}
	format := strings.ToLower(strings.TrimSpace(spec.GetAudioFormat()))
	switch format {
	case "mp3", "mpeg", "audio/mpeg":
		return "mp3_44100_128"
	case "pcm", "audio/pcm":
		return "pcm_44100"
	case "ogg", "audio/ogg":
		return "ogg_opus"
	case "wav", "audio/wav":
		return "pcm_44100"
	default:
		return ""
	}
}
