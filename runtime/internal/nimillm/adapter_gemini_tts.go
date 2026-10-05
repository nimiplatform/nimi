package nimillm

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const maxGeminiTTSAudioBase64Bytes = 44 * 1024 * 1024

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
// ExecuteGeminiTTSGenerateContent uses Google's unary native TTS call. It
// returns the WAV bytes as one body for Runtime custody, without creating a
// provider-side Interaction or a synthetic completion event.
func ExecuteGeminiTTSGenerateContent(
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
	if err := capabilitydriver.ValidateGeminiTTSGenerateContentRequest(req, model); err != nil {
		return nil, nil, "", err
	}
	spec := scenarioSpeechSynthesizeSpec(req)
	part := map[string]any{"text": spec.GetText()}
	if strings.TrimSpace(spec.GetEmotion()) != "" {
		part["speech_metadata"] = map[string]any{"style": spec.GetEmotion()}
	}
	payload := map[string]any{
		"contents": []map[string]any{{"role": "user", "parts": []map[string]any{part}}},
		"generationConfig": map[string]any{
			"responseModalities": []string{"AUDIO"},
			"speechConfig": map[string]any{
				"voiceConfig": map[string]any{"voice": spec.GetVoiceRef().GetPresetVoiceId()},
			},
		},
	}
	response := map[string]any{}
	if err := DoJSONRequestWithHeadersAndTimeout(
		ctx, http.MethodPost, JoinURL(baseURL, "/models/"+model+":generateContent"),
		"", payload, &response, map[string]string{"x-goog-api-key": apiKey}, resolveGeminiGenerateContentHTTPTimeout(req),
	); err != nil {
		return nil, nil, "", err
	}
	audio, durationMS, err := geminiTTSAudioResult(response)
	if err != nil {
		return nil, nil, "", err
	}
	artifact := BinaryArtifact("audio/wav", audio, nil)
	artifact.SampleRateHz = 24000
	artifact.DurationMs = durationMS
	return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
}

func geminiTTSAudioResult(payload map[string]any) ([]byte, int64, error) {
	invalid := func() error {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	parts, ok := geminiCompletedCandidateParts(payload["candidates"])
	if !ok || len(parts) != 1 {
		return nil, 0, invalid()
	}
	inline := MapField(parts[0], "inlineData")
	if ValueAsString(MapField(inline, "mimeType")) != "audio/wav" {
		return nil, 0, invalid()
	}
	encoded := ValueAsString(MapField(inline, "data"))
	if encoded == "" || len(encoded) > maxGeminiTTSAudioBase64Bytes {
		return nil, 0, invalid()
	}
	audio, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, 0, invalid()
	}
	rate, duration, err := finiteASRWAVInfo(audio)
	if err != nil || rate != 24000 || duration <= 0 || !geminiWAVPCM16(audio) {
		return nil, 0, invalid()
	}
	return audio, int64(duration * 1000), nil
}
