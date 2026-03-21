package nimillm

import (
	"context"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterAWSPollyNative = "aws_polly_native_adapter"

// ExecuteAWSPollyTTS executes a TTS scenario job against an AWS Polly compatible API gateway.
func ExecuteAWSPollyTTS(
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
	if apiKey == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED)
	}

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
		"Text":   strings.TrimSpace(spec.GetText()),
		"Engine": StripProviderModelPrefix(modelResolved, "aws_polly", "aws-polly"),
	}
	if voiceRef != "" {
		payload["VoiceId"] = voiceRef
	}
	outputFormat := "mp3"
	if af := strings.TrimSpace(spec.GetAudioFormat()); af != "" {
		outputFormat = af
	}
	payload["OutputFormat"] = outputFormat
	if sampleRate := spec.GetSampleRateHz(); sampleRate > 0 {
		payload["SampleRate"] = sampleRate
	}
	if language := strings.TrimSpace(spec.GetLanguage()); language != "" {
		payload["LanguageCode"] = language
	}
	if len(ext) > 0 {
		payload["extensions"] = ext
	}

	endpoint := FirstProviderEndpointPath(
		ext,
		[]string{"tts_path", "speech_path"},
		[]string{"tts_paths", "speech_paths"},
		[]string{"/v1/speech"},
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
		"adapter":    AdapterAWSPollyNative,
		"endpoint":   endpoint,
		"voice":      voiceRef,
		"extensions": ext,
	})
	ApplySpeechSpecMetadata(artifact, spec)
	return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetText(), artifactBytes, 80), "", nil
}
