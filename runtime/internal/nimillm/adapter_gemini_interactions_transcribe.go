package nimillm

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const geminiInlineTranscribeModel = "gemini-3.5-transcribe"
const maxGeminiInlineTranscribeAudioBytes = 2 * 1024 * 1024

// @nimi-authority: rule.nimi.runtime.ai-provider.r050
// ExecuteGeminiInteractionsTranscribe uses a synchronous, stateless native
// Interaction with inline audio. It creates no Files resource or stored turn.
func ExecuteGeminiInteractionsTranscribe(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	model string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := resolveGeminiNativeBaseURL(cfg.BaseURL)
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}
	spec := scenarioSpeechTranscribeSpec(req)
	if model != geminiInlineTranscribeModel || spec == nil || spec.GetAudioSource() == nil ||
		strings.TrimSpace(spec.GetMimeType()) != "audio/wav" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	source, ok := spec.GetAudioSource().GetSource().(*runtimev1.SpeechTranscriptionAudioSource_AudioBytes)
	if !ok || len(source.AudioBytes) == 0 || len(source.AudioBytes) > maxGeminiInlineTranscribeAudioBytes {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	rate, duration, err := finiteASRWAVInfo(source.AudioBytes)
	if err != nil || rate != 24000 || duration > 30 || !geminiWAVPCM16(source.AudioBytes) {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	payload := map[string]any{
		"model": model,
		"input": []map[string]any{{
			"type": "audio", "data": base64.StdEncoding.EncodeToString(source.AudioBytes), "mime_type": "audio/wav",
		}},
		"store": false,
	}
	response := map[string]any{}
	if err := DoJSONRequestWithHeadersAndTimeout(
		ctx, http.MethodPost, JoinURL(baseURL, "/interactions"), "", payload, &response,
		map[string]string{"x-goog-api-key": apiKey}, resolveGeminiGenerateContentHTTPTimeout(req),
	); err != nil {
		if ctx.Err() != nil {
			return nil, nil, "", providerPollContextError(ctx.Err())
		}
		return nil, nil, "", err
	}
	text, err := geminiInteractionsTranscript(response)
	if err != nil {
		return nil, nil, "", err
	}
	artifact := BinaryArtifact(ResolveTranscriptionArtifactMIME(spec), []byte(text), map[string]any{
		"text": text, "adapter": "gemini_interactions_transcribe_adapter",
	})
	ApplyTranscriptionSpecMetadata(artifact, spec)
	return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
}

func geminiInteractionsTranscript(payload map[string]any) (string, error) {
	invalid := func() error {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if strings.TrimSpace(ValueAsString(payload["status"])) != "completed" {
		return "", invalid()
	}
	steps, ok := payload["steps"].([]any)
	if !ok || len(steps) != 1 || ValueAsString(MapField(steps[0], "type")) != "model_output" {
		return "", invalid()
	}
	content, ok := MapField(steps[0], "content").([]any)
	if !ok || len(content) != 1 || ValueAsString(MapField(content[0], "type")) != "text" {
		return "", invalid()
	}
	text := ValueAsString(MapField(content[0], "text"))
	if strings.TrimSpace(text) == "" {
		return "", invalid()
	}
	return text, nil
}
