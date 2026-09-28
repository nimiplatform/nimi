package nimillm

import (
	"context"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const dashscopeQwenAudio31ASRModel = "qwen-audio-3.1-asr-flash"
const dashscopeQwenAudio31ASRPath = "/api/v1/services/aigc/multimodal-generation/generation"
const adapterDashscopeQwenAudio31Inline = "dashscope_qwen_audio31_inline_adapter"

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
func ExecuteDashscopeQwenAudio31InlineTranscribe(ctx context.Context, cfg MediaAdapterConfig, spec *runtimev1.SpeechTranscribeScenarioSpec) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := nativeOriginURL(cfg.BaseURL)
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}
	if spec == nil || strings.TrimSpace(spec.GetMimeType()) != "audio/wav" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	source, ok := spec.GetAudioSource().GetSource().(*runtimev1.SpeechTranscriptionAudioSource_AudioBytes)
	if !ok || len(source.AudioBytes) == 0 || len(source.AudioBytes) > 2*1024*1024 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	rate, duration, err := finiteASRWAVInfo(source.AudioBytes)
	if err != nil || rate != 24000 || duration > 30 || !geminiWAVPCM16(source.AudioBytes) {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	payload := map[string]any{
		"model": dashscopeQwenAudio31ASRModel,
		"input": map[string]any{"messages": []any{map[string]any{
			"role": "user", "content": []any{map[string]any{
				"type": "input_audio", "input_audio": map[string]any{
					"data": encodeInlineAudioDataURI(source.AudioBytes, "audio/wav"),
				},
			}},
		}}},
		"parameters": map[string]any{"format": "wav", "sample_rate": "24000"},
	}
	response := map[string]any{}
	if err := DoJSONRequestWithHeaders(ctx, http.MethodPost, JoinURL(baseURL, dashscopeQwenAudio31ASRPath), apiKey,
		payload, &response, map[string]string{"X-DashScope-SSE": "disable"}); err != nil {
		if ctx.Err() != nil {
			return nil, nil, "", providerPollContextError(ctx.Err())
		}
		return nil, nil, "", err
	}
	text, err := dashscopeQwenAudio31Transcript(response)
	if err != nil {
		return nil, nil, "", err
	}
	artifact := BinaryArtifact(ResolveTranscriptionArtifactMIME(spec), []byte(text), map[string]any{
		"text": text, "adapter": adapterDashscopeQwenAudio31Inline,
	})
	ApplyTranscriptionSpecMetadata(artifact, spec)
	return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
}

func dashscopeQwenAudio31Transcript(response map[string]any) (string, error) {
	text := ValueAsString(MapField(response["output"], "text"))
	if strings.TrimSpace(text) == "" {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return text, nil
}
