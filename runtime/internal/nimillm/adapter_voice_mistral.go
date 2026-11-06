package nimillm

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func mistralVoiceRequest(ctx context.Context, cfg MediaAdapterConfig, method, path string, payload any, response *map[string]any) error {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	key, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return err
	}
	base := strings.TrimSuffix(strings.TrimRight(cfg.BaseURL, "/"), "/v1")
	if base == "" {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	return DoJSONRequestWithHeaders(originalControlRequest(ctx), method, JoinURL(base, "/v1/audio/voices"+path), key, payload, response, cfg.Headers)
}

// @nimi-authority: rule.nimi.runtime.model-catalog.r029
func executeMistralVoiceWorkflow(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	input, _ := req.Payload["input"].(map[string]any)
	encoded := ValueAsString(input["reference_audio_base64"])
	audio, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	mimeType := ValueAsString(input["reference_audio_mime"])
	if _, err := mistralRecordingDuration(ctx, audio, mimeType); err != nil {
		return VoiceWorkflowResult{}, err
	}
	filename := "voice.wav"
	if mimeType == "audio/mpeg" {
		filename = "voice.mp3"
	}
	payload := map[string]any{"name": ValueAsString(input["preferred_name"]), "sample_audio": encoded, "sample_filename": filename}
	if languages, ok := input["language_hints"].([]any); ok && len(languages) > 0 {
		payload["languages"] = languages
	}
	var response map[string]any
	if err := mistralVoiceRequest(ctx, cfg, http.MethodPost, "", payload, &response); err != nil {
		return VoiceWorkflowResult{}, err
	}
	return parseMistralStoredVoice(response, "")
}
func parseMistralStoredVoice(response map[string]any, expected string) (VoiceWorkflowResult, error) {
	id := ValueAsString(response["id"])
	result := VoiceWorkflowResult{ProviderVoiceRef: id}
	if !capabilitydriver.ValidMistralVoiceID(id) || expected != "" && id != expected || response["type"] != "custom" {
		return result, mistralAudioInvalidOutput()
	}
	if _, err := time.Parse(time.RFC3339Nano, ValueAsString(response["created_at"])); err != nil {
		return result, mistralAudioInvalidOutput()
	}
	// Saved voices remain usable until deleted. retention_notice is not an
	// expiry timestamp; never invent an ExpiresAt from created_at plus 30 days.
	result.Metadata = map[string]any{"provider": "mistral", "creation_source": "reference_audio", "workflow_model_id": capabilitydriver.MistralVoiceWorkflow}
	return result, nil
}
func inspectMistralStoredVoice(ctx context.Context, id string, cfg MediaAdapterConfig) (VoiceWorkflowResult, bool, error) {
	if !capabilitydriver.ValidMistralVoiceID(id) {
		return VoiceWorkflowResult{}, false, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	var response map[string]any
	if err := mistralVoiceRequest(ctx, cfg, http.MethodGet, "/"+id, nil, &response); err != nil {
		if status.Code(err) == codes.NotFound {
			return VoiceWorkflowResult{}, false, nil
		}
		return VoiceWorkflowResult{}, false, err
	}
	result, err := parseMistralStoredVoice(response, id)
	return result, err == nil, err
}
func deleteMistralStoredVoice(ctx context.Context, id string, cfg MediaAdapterConfig) error {
	if !capabilitydriver.ValidMistralVoiceID(id) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	var response map[string]any
	if err := mistralVoiceRequest(ctx, cfg, http.MethodDelete, "/"+id, nil, &response); err != nil {
		if status.Code(err) == codes.NotFound {
			return nil
		}
		return err
	}
	// DELETE's documented success body is the deleted VoiceResponse, not a
	// generic deleted:true flag and not an empty transport acknowledgement.
	_, err := parseMistralStoredVoice(response, id)
	return err
}
