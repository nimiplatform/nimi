package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterGoogleCloudTTS = "google_cloud_tts_adapter"

// ExecuteGoogleCloudTTS executes a TTS scenario job against the Google Cloud Text-to-Speech API.
// Uses POST /v1/text:synthesize with JSON body. Auth via Bearer token.
func ExecuteGoogleCloudTTS(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://texttospeech.googleapis.com"
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

	ext := scenarioExtensionPayloadForScenario(req)
	voiceRef := strings.TrimSpace(scenarioVoiceRef(spec))
	language := strings.TrimSpace(spec.GetLanguage())
	if language == "" {
		language = "en-US"
	}
	input := resolveGoogleCloudTTSInput(spec, ext)
	voice := resolveGoogleCloudTTSVoice(spec, ext, modelResolved)
	audioConfig := resolveGoogleCloudTTSAudioConfig(spec, ext)

	payload := map[string]any{
		"input":       input,
		"voice":       voice,
		"audioConfig": audioConfig,
	}
	if parent := strings.TrimSpace(ValueAsString(ext["parent"])); parent != "" {
		payload["parent"] = parent
	}

	endpoint := FirstProviderEndpointPath(
		ext,
		[]string{"tts_path", "speech_path"},
		[]string{"tts_paths", "speech_paths"},
		[]string{"/v1/text:synthesize"},
	)
	body, err := DoJSONOrBinaryRequest(ctx, http.MethodPost, JoinURL(baseURL, endpoint), apiKey, payload, nil)
	if err != nil {
		return nil, nil, "", err
	}
	artifactBytes, mimeType := ExtractSpeechArtifactFromResponseBody(body)
	if len(artifactBytes) == 0 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "audio/") {
		mimeType = ResolveSpeechArtifactMIME(spec, artifactBytes)
	}
	artifact := BinaryArtifact(mimeType, artifactBytes, map[string]any{
		"adapter":        AdapterGoogleCloudTTS,
		"endpoint":       endpoint,
		"voice":          voiceRef,
		"language":       language,
		"resolved_model": strings.TrimSpace(StripProviderModelPrefix(modelResolved, "google_cloud_tts", "google-cloud-tts")),
		"extensions":     ext,
	})
	ApplySpeechSpecMetadata(artifact, spec)
	return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetText(), artifactBytes, 100), "", nil
}

func resolveGoogleCloudTTSInput(spec *runtimev1.SpeechSynthesizeScenarioSpec, scenarioExtensions map[string]any) map[string]any {
	input := map[string]any{}
	mergeGoogleCloudTTSMap(input, MapField(scenarioExtensions, "input"))
	text := strings.TrimSpace(spec.GetText())
	if text != "" {
		input["text"] = text
	}
	if prompt := strings.TrimSpace(ValueAsString(scenarioExtensions["prompt"])); prompt != "" {
		input["prompt"] = prompt
	}
	return input
}

func resolveGoogleCloudTTSVoice(
	spec *runtimev1.SpeechSynthesizeScenarioSpec,
	scenarioExtensions map[string]any,
	modelResolved string,
) map[string]any {
	language := strings.TrimSpace(spec.GetLanguage())
	if language == "" {
		language = "en-US"
	}
	voice := map[string]any{
		"languageCode": language,
	}
	if voiceRef := strings.TrimSpace(scenarioVoiceRef(spec)); voiceRef != "" {
		voice["name"] = voiceRef
	}
	mergeGoogleCloudTTSMap(voice, MapField(scenarioExtensions, "voice"))
	resolvedModel := strings.TrimSpace(StripProviderModelPrefix(modelResolved, "google_cloud_tts", "google-cloud-tts"))
	if strings.HasPrefix(strings.ToLower(resolvedModel), "gemini-") {
		if strings.TrimSpace(ValueAsString(voice["modelName"])) == "" {
			voice["modelName"] = resolvedModel
		}
	}
	if strings.TrimSpace(ValueAsString(voice["languageCode"])) == "" {
		voice["languageCode"] = language
	}
	return voice
}

func resolveGoogleCloudTTSAudioConfig(spec *runtimev1.SpeechSynthesizeScenarioSpec, scenarioExtensions map[string]any) map[string]any {
	audioConfig := map[string]any{
		"audioEncoding": resolveGoogleCloudAudioEncoding(spec),
	}
	if sampleRate := spec.GetSampleRateHz(); sampleRate > 0 {
		audioConfig["sampleRateHertz"] = sampleRate
	}
	if speed := spec.GetSpeed(); speed > 0 {
		audioConfig["speakingRate"] = speed
	}
	mergeGoogleCloudTTSMap(audioConfig, MapField(scenarioExtensions, "audio_config"))
	return audioConfig
}

func mergeGoogleCloudTTSMap(dst map[string]any, value any) {
	src, ok := normalizeGoogleCloudTTSValue(value).(map[string]any)
	if !ok {
		return
	}
	for key, item := range src {
		dst[key] = item
	}
}

func normalizeGoogleCloudTTSValue(value any) any {
	switch item := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(item))
		for key, nested := range item {
			out[normalizeGoogleCloudTTSFieldName(key)] = normalizeGoogleCloudTTSValue(nested)
		}
		return out
	case []any:
		out := make([]any, 0, len(item))
		for _, nested := range item {
			out = append(out, normalizeGoogleCloudTTSValue(nested))
		}
		return out
	case []map[string]any:
		out := make([]any, 0, len(item))
		for _, nested := range item {
			out = append(out, normalizeGoogleCloudTTSValue(nested))
		}
		return out
	default:
		return item
	}
}

func normalizeGoogleCloudTTSFieldName(key string) string {
	switch strings.TrimSpace(key) {
	case "audio_encoding":
		return "audioEncoding"
	case "language_code":
		return "languageCode"
	case "model_name":
		return "modelName"
	case "multi_speaker_voice_config":
		return "multiSpeakerVoiceConfig"
	case "sample_rate_hz":
		return "sampleRateHertz"
	case "speaker_alias":
		return "speakerAlias"
	case "speaker_id":
		return "speakerId"
	case "speaker_voice_configs":
		return "speakerVoiceConfigs"
	case "speaking_rate":
		return "speakingRate"
	default:
		return key
	}
}

func debugGoogleCloudTTSPayload(payload map[string]any) string {
	raw, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	return string(raw)
}

func resolveGoogleCloudAudioEncoding(spec *runtimev1.SpeechSynthesizeScenarioSpec) string {
	if spec == nil {
		return "MP3"
	}
	format := strings.ToLower(strings.TrimSpace(spec.GetAudioFormat()))
	switch format {
	case "ogg", "audio/ogg", "opus":
		return "OGG_OPUS"
	case "wav", "audio/wav", "linear16":
		return "LINEAR16"
	case "mulaw", "audio/mulaw":
		return "MULAW"
	case "alaw", "audio/alaw":
		return "ALAW"
	default:
		return "MP3"
	}
}
