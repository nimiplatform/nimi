package nimillm

import (
	"context"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterPlayHTNative = "playht_native_adapter"

// ExecutePlayHTTTS executes a TTS scenario job against the PlayHT API.
// PlayHT uses POST /api/v2/tts with body {text, voice, output_format, speed, ...}.
// Authentication is via Authorization Bearer + X-USER-ID header.
func ExecutePlayHTTTS(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.play.ht"
	}
	apiKey := strings.TrimSpace(cfg.APIKey)

	if scenarioModal(req) != runtimev1.Modal_MODAL_TTS {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioSpeechSynthesizeSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	voiceRef := strings.TrimSpace(scenarioVoiceRef(spec))
	ext := scenarioExtensionPayloadForScenario(req)
	payload := map[string]any{
		"text":  strings.TrimSpace(spec.GetText()),
		"voice": voiceRef,
	}
	if resolvedModel := StripProviderModelPrefix(modelResolved, "playht", "play-ht"); resolvedModel != "" {
		payload["voice_engine"] = resolvedModel
	}
	if audioFormat := strings.TrimSpace(spec.GetAudioFormat()); audioFormat != "" {
		payload["output_format"] = audioFormat
	}
	if speed := spec.GetSpeed(); speed > 0 {
		payload["speed"] = speed
	}
	if sampleRate := spec.GetSampleRateHz(); sampleRate > 0 {
		payload["sample_rate"] = sampleRate
	}
	if language := strings.TrimSpace(spec.GetLanguage()); language != "" {
		payload["language"] = language
	}
	if len(ext) > 0 {
		payload["extensions"] = ext
	}

	endpoint := FirstProviderEndpointPath(
		ext,
		[]string{"tts_path", "speech_path"},
		[]string{"tts_paths", "speech_paths"},
		[]string{"/api/v2/tts"},
	)
	headers := map[string]string{}
	if userID := strings.TrimSpace(ValueAsString(ext["user_id"])); userID != "" {
		headers["X-USER-ID"] = userID
	}

	body, err := doCustomHeaderJSONOrBinaryRequest(ctx, http.MethodPost, JoinURL(baseURL, endpoint), apiKey, payload, headers)
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
		"adapter":    AdapterPlayHTNative,
		"endpoint":   endpoint,
		"voice":      voiceRef,
		"extensions": ext,
	})
	ApplySpeechSpecMetadata(artifact, spec)
	return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetText(), artifactBytes, 120), "", nil
}
