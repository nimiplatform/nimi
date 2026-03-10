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

// SupportsProviderVoiceDelete reports whether nimillm can delete a
// provider-persistent voice asset for the provider.
func SupportsProviderVoiceDelete(provider string) bool {
	switch strings.TrimSpace(strings.ToLower(provider)) {
	case "elevenlabs":
		return true
	case "fish_audio":
		return true
	default:
		return false
	}
}

// DeleteProviderVoice deletes a provider-persistent voice reference when the
// provider offers a native delete API.
func DeleteProviderVoice(ctx context.Context, provider string, providerVoiceRef string, cfg MediaAdapterConfig, extPayload map[string]any) error {
	normalizedProvider := strings.TrimSpace(strings.ToLower(provider))
	normalizedVoiceRef := strings.TrimSpace(providerVoiceRef)
	if normalizedProvider == "" || normalizedVoiceRef == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}

	switch normalizedProvider {
	case "elevenlabs":
		return deleteElevenLabsVoice(ctx, normalizedVoiceRef, cfg, extPayload)
	case "fish_audio":
		return deleteFishAudioVoiceModel(ctx, normalizedVoiceRef, cfg, extPayload)
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}
}

func deleteElevenLabsVoice(ctx context.Context, providerVoiceRef string, cfg MediaAdapterConfig, extPayload map[string]any) error {
	baseURL := resolveVoiceWorkflowBaseURL("elevenlabs", cfg, extPayload)
	if baseURL == "" {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	headers := voiceWorkflowHeaders("elevenlabs", cfg.APIKey, extPayload)
	targetURL := JoinURL(baseURL, "/v1/voices/"+url.PathEscape(strings.TrimSpace(providerVoiceRef)))
	err := DoJSONRequestWithHeaders(ctx, http.MethodDelete, targetURL, "", nil, nil, headers)
	if err != nil && status.Code(err) == codes.NotFound {
		return nil
	}
	return err
}

func deleteFishAudioVoiceModel(ctx context.Context, providerVoiceRef string, cfg MediaAdapterConfig, extPayload map[string]any) error {
	baseURL := resolveVoiceWorkflowBaseURL("fish_audio", cfg, extPayload)
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
