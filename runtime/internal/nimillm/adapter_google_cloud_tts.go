package nimillm

import (
	"context"
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
	voice := map[string]any{
		"languageCode": language,
	}
	if voiceRef != "" {
		voice["name"] = voiceRef
	}

	audioEncoding := resolveGoogleCloudAudioEncoding(spec)
	audioConfig := map[string]any{
		"audioEncoding": audioEncoding,
	}
	if sampleRate := spec.GetSampleRateHz(); sampleRate > 0 {
		audioConfig["sampleRateHertz"] = sampleRate
	}
	if speed := spec.GetSpeed(); speed > 0 {
		audioConfig["speakingRate"] = speed
	}

	payload := map[string]any{
		"input":       map[string]any{"text": strings.TrimSpace(spec.GetText())},
		"voice":       voice,
		"audioConfig": audioConfig,
	}
	if len(ext) > 0 {
		payload["extensions"] = ext
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
		"adapter":    AdapterGoogleCloudTTS,
		"endpoint":   endpoint,
		"voice":      voiceRef,
		"language":   language,
		"extensions": ext,
	})
	ApplySpeechSpecMetadata(artifact, spec)
	return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetText(), artifactBytes, 100), "", nil
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
