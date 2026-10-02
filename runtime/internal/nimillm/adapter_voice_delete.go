package nimillm

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// DeleteProviderVoiceAdapter dispatches one exact Driver-selected delete
// dialect. Provider is retained only as a consistency check.
func DeleteProviderVoiceAdapter(ctx context.Context, adapter string, provider string, providerVoiceRef string, cfg MediaAdapterConfig) error {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	normalizedProvider := strings.TrimSpace(strings.ToLower(provider))
	normalizedVoiceRef := strings.TrimSpace(providerVoiceRef)
	expectedProvider := voiceDeleteProviderForAdapter(adapter)
	if normalizedProvider == "" || normalizedProvider != expectedProvider || normalizedVoiceRef == "" {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	switch strings.TrimSpace(adapter) {
	case "elevenlabs_voice_delete_adapter":
		return deleteElevenLabsVoice(ctx, normalizedVoiceRef, cfg)
	case "fish_audio_voice_delete_adapter":
		return deleteFishAudioVoiceModel(ctx, normalizedVoiceRef, cfg)
	case "dashscope_voice_delete_adapter":
		return deleteDashScopeVoice(ctx, "voice-enrollment", normalizedVoiceRef, cfg)
	case "dashscope_qwen_clone_voice_delete_adapter":
		return deleteDashScopeVoice(ctx, "qwen-voice-enrollment", normalizedVoiceRef, cfg)
	case "dashscope_qwen_design_voice_delete_adapter":
		return deleteDashScopeVoice(ctx, "qwen-voice-design", normalizedVoiceRef, cfg)
	default:
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
}

func voiceDeleteProviderForAdapter(adapter string) string {
	switch strings.TrimSpace(adapter) {
	case "elevenlabs_voice_delete_adapter":
		return "elevenlabs"
	case "fish_audio_voice_delete_adapter":
		return "fish_audio"
	case "dashscope_voice_delete_adapter", "dashscope_qwen_clone_voice_delete_adapter", "dashscope_qwen_design_voice_delete_adapter":
		return "dashscope"
	default:
		return ""
	}
}

// @nimi-authority: rule.nimi.runtime.model-catalog.r029
func deleteDashScopeVoice(ctx context.Context, workflowModel string, voice string, cfg MediaAdapterConfig) error {
	baseURL := resolveVoiceWorkflowBaseURL("dashscope", cfg)
	if baseURL == "" {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	input := map[string]any{"action": "delete", "voice": voice}
	if workflowModel == "voice-enrollment" {
		input = map[string]any{"action": "delete_voice", "voice_id": voice}
	}
	payload := map[string]any{"model": workflowModel, "input": input}
	var response map[string]any
	if err := DoJSONRequestWithHeaders(ctx, http.MethodPost, JoinURL(baseURL, "/api/v1/services/audio/tts/customization"), cfg.APIKey, payload, &response, voiceWorkflowHeaders("dashscope", cfg)); err != nil {
		return err
	}
	output, ok := response["output"].(map[string]any)
	requestID, _ := response["request_id"].(string)
	if !ok || strings.TrimSpace(requestID) == "" || response["code"] != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if workflowModel != "voice-enrollment" && output["voice"] != voice {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return nil
}

func deleteElevenLabsVoice(ctx context.Context, providerVoiceRef string, cfg MediaAdapterConfig) error {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := resolveVoiceWorkflowBaseURL("elevenlabs", cfg)
	if baseURL == "" {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	headers := voiceWorkflowHeaders("elevenlabs", cfg)
	targetURL := JoinURL(baseURL, "/v1/voices/"+url.PathEscape(strings.TrimSpace(providerVoiceRef)))
	err := DoJSONRequestWithHeaders(ctx, http.MethodDelete, targetURL, "", nil, nil, headers)
	if err != nil && status.Code(err) == codes.NotFound {
		return nil
	}
	return err
}

func deleteFishAudioVoiceModel(ctx context.Context, providerVoiceRef string, cfg MediaAdapterConfig) error {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := resolveVoiceWorkflowBaseURL("fish_audio", cfg)
	if baseURL == "" {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	targetURL := JoinURL(baseURL, "/model/"+url.PathEscape(strings.TrimSpace(providerVoiceRef)))
	err := DoJSONRequest(ctx, http.MethodDelete, targetURL, cfg.APIKey, nil, nil)
	if err != nil && status.Code(err) == codes.NotFound {
		return nil
	}
	return err
}
