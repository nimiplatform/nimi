package nimillm

import (
	"context"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterFishAudioNative = "fish_audio_native_adapter"

// ExecuteFishAudioNative executes a TTS scenario job against the Fish Audio API.
// Fish Audio uses POST /v1/tts with the base model in the `model` header and
// either `reference_id` (preset/public voice) or `model_id` (custom cloned
// voice model) in the request body.
func ExecuteFishAudioTTS(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.fish.audio"
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
	resolvedModel := StripProviderModelPrefix(modelResolved, "fish_audio", "fish-audio")
	ext := scenarioExtensionPayloadForScenario(req)

	payload := map[string]any{
		"text": strings.TrimSpace(spec.GetText()),
	}
	headers := map[string]string{}
	if resolvedModel != "" {
		headers["model"] = resolvedModel
	}
	if voiceRef != "" {
		payload["reference_id"] = voiceRef
	}
	if language := strings.TrimSpace(spec.GetLanguage()); language != "" {
		payload["language"] = language
	}
	if audioFormat := strings.TrimSpace(spec.GetAudioFormat()); audioFormat != "" {
		payload["format"] = audioFormat
	}
	if speed := spec.GetSpeed(); speed > 0 {
		payload["speed"] = speed
	}
	if sampleRate := spec.GetSampleRateHz(); sampleRate > 0 {
		payload["sample_rate"] = sampleRate
	}
	if len(ext) > 0 {
		payload["extensions"] = ext
	}

	endpoint := resolveFishAudioTTSPath(ext)
	body, err := DoJSONOrBinaryRequest(ctx, http.MethodPost, JoinURL(baseURL, endpoint), apiKey, payload, headers)
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
		"adapter":      AdapterFishAudioNative,
		"endpoint":     endpoint,
		"voice":        voiceRef,
		"language":     strings.TrimSpace(spec.GetLanguage()),
		"audio_format": strings.TrimSpace(spec.GetAudioFormat()),
		"extensions":   scenarioExtensionPayloadForScenario(req),
	})
	ApplySpeechSpecMetadata(artifact, spec)
	return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetText(), artifactBytes, 120), "", nil
}

func resolveFishAudioTTSPath(scenarioExtensions map[string]any) string {
	return FirstProviderEndpointPath(
		scenarioExtensions,
		[]string{"tts_path", "speech_path"},
		[]string{"tts_paths", "speech_paths"},
		[]string{"/v1/tts"},
	)
}
