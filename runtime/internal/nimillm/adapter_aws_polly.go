package nimillm

import (
	"context"
	"net/http"
	"strconv"
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
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
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
	engine := resolveAWSPollyEngine(modelResolved)
	if engine == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	payload := map[string]any{
		"Text":     spec.GetText(),
		"TextType": "text",
		"Engine":   engine,
	}
	if voiceRef != "" {
		payload["VoiceId"] = voiceRef
	}
	outputFormat := "mp3"
	if af := strings.TrimSpace(spec.GetAudioFormat()); af != "" {
		outputFormat = af
	}
	if outputFormat == "ogg" {
		outputFormat = "ogg_vorbis"
	}
	payload["OutputFormat"] = outputFormat
	if sampleRate := spec.GetSampleRateHz(); sampleRate > 0 {
		payload["SampleRate"] = strconv.FormatInt(int64(sampleRate), 10)
	}
	if language := strings.TrimSpace(spec.GetLanguage()); language != "" {
		payload["LanguageCode"] = language
	}

	endpoint := firstProviderEndpointPath([]string{"/v1/speech"})
	body, err := DoJSONOrBinaryRequest(ctx, http.MethodPost, JoinURL(baseURL, endpoint), apiKey, payload, cfg.Headers)
	if err != nil {
		return nil, nil, "", err
	}
	if body == nil || len(body.Bytes) == 0 || body.Text != "" || !strings.HasPrefix(strings.ToLower(body.MIME), "audio/") && !strings.HasPrefix(strings.ToLower(body.MIME), "application/octet-stream") && !strings.HasPrefix(strings.ToLower(body.MIME), "application/ogg") {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	artifact, err := nativeSpeechArtifact(ctx, body.Bytes, outputFormat, spec.GetSampleRateHz(), map[string]any{
		"adapter":  AdapterAWSPollyNative,
		"endpoint": endpoint,
		"voice":    voiceRef,
		"engine":   engine,
	})
	if err != nil {
		return nil, nil, "", err
	}
	return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
}

func resolveAWSPollyEngine(modelResolved string) string {
	resolved := strings.ToLower(strings.TrimSpace(modelResolved))
	switch resolved {
	case "polly-standard-tts":
		return "standard"
	case "polly-neural-tts":
		return "neural"
	case "polly-long-form-tts":
		return "long-form"
	case "polly-generative-tts":
		return "generative"
	default:
		return ""
	}
}
