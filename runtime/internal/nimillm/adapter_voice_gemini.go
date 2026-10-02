package nimillm

import (
	"context"
	"encoding/base64"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const geminiVoiceDesignModel = "gemini-3.8-flash-tts"

func InspectProviderVoiceAdapter(ctx context.Context, adapter, provider, id string, cfg MediaAdapterConfig) (VoiceWorkflowResult, bool, error) {
	if adapter != "gemini_voice_inspect_adapter" || provider != "gemini" {
		return VoiceWorkflowResult{}, false, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	return inspectGeminiStoredVoice(ctx, id, cfg)
}

// @nimi-authority: rule.nimi.runtime.model-catalog.r029
// @nimi-authority: rule.nimi.runtime.ai-provider.gemini-stored-voice
func executeGeminiVoiceWorkflow(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	input, _ := req.Payload["input"].(map[string]any)
	if req.WorkflowType != "text_description" || req.WorkflowModelID != geminiVoiceDesignModel || req.ModelID != geminiVoiceDesignModel ||
		strings.TrimSpace(ValueAsString(input["instruction_text"])) == "" || strings.TrimSpace(ValueAsString(input["preview_text"])) != "" || len(req.ExtPayload) != 0 {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	voice := map[string]any{
		"model": geminiVoiceDesignModel, "type": "prompted",
		"prompted": map[string]any{"input": ValueAsString(input["instruction_text"])},
	}
	if name := strings.TrimSpace(ValueAsString(input["preferred_name"])); name != "" {
		voice["display_name"] = name
	}
	if language := strings.TrimSpace(ValueAsString(input["language"])); language != "" {
		voice["language_code"] = language
	}
	response := map[string]any{}
	if err := geminiVoiceRequest(ctx, cfg, http.MethodPost, "/voices", map[string]any{"store": true, "voice": voice}, &response); err != nil {
		return VoiceWorkflowResult{}, err
	}
	return parseGeminiStoredVoice(response, "", true)
}

func geminiStoredVoiceIDValid(id string) bool {
	if !strings.HasPrefix(id, "voice_") || len(id) <= len("voice_") || len(id) > 256 {
		return false
	}
	for _, c := range id {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-') {
			return false
		}
	}
	return true
}

func geminiVoiceRequest(ctx context.Context, cfg MediaAdapterConfig, method, path string, payload any, response *map[string]any) error {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := resolveGeminiNativeBaseURL(cfg.BaseURL)
	if baseURL == "" {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	key, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return err
	}
	return DoJSONRequestWithHeaders(ctx, method, JoinURL(baseURL, path), "", payload, response, map[string]string{"x-goog-api-key": key})
}

func inspectGeminiStoredVoice(ctx context.Context, id string, cfg MediaAdapterConfig) (VoiceWorkflowResult, bool, error) {
	if !geminiStoredVoiceIDValid(id) {
		return VoiceWorkflowResult{}, false, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	response := map[string]any{}
	if err := geminiVoiceRequest(ctx, cfg, http.MethodGet, "/voices/"+url.PathEscape(id), nil, &response); err != nil {
		if status.Code(err) == codes.NotFound {
			return VoiceWorkflowResult{}, false, nil
		}
		return VoiceWorkflowResult{}, false, err
	}
	result, err := parseGeminiStoredVoice(response, id, false)
	return result, err == nil, err
}

func deleteGeminiStoredVoice(ctx context.Context, id string, cfg MediaAdapterConfig) error {
	if !geminiStoredVoiceIDValid(id) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	err := geminiVoiceRequest(ctx, cfg, http.MethodDelete, "/voices/"+url.PathEscape(id), nil, nil)
	if status.Code(err) == codes.NotFound {
		return nil
	}
	return err
}

func parseGeminiStoredVoice(response map[string]any, expectedID string, preview bool) (VoiceWorkflowResult, error) {
	id := ValueAsString(response["id"])
	// Keep a known resource identity even when subsequent facts are invalid;
	// Runtime owns cleanup of a created handle that cannot be published.
	result := VoiceWorkflowResult{ProviderVoiceRef: id}
	invalid := func(field string) (VoiceWorkflowResult, error) {
		modelFact := "unreported"
		if value, ok := response["model"].(string); ok {
			// Model-family identifiers are public protocol facts. Never log an
			// arbitrary provider value, voice handle, text or audio payload.
			if len(value) <= 128 && (strings.HasPrefix(value, "gemini-") || strings.HasPrefix(value, "models/gemini-")) && !strings.ContainsFunc(value, func(r rune) bool {
				return !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' || r == '/')
			}) {
				modelFact = value
			} else {
				modelFact = "unexpected"
			}
		}
		slog.Warn("Gemini stored voice output rejected", "field", field, "known_handle", geminiStoredVoiceIDValid(id), "reported_model", modelFact)
		return result, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, grpcerr.ReasonOptions{ActionHint: "inspect_gemini_voice_" + field})
	}
	if !geminiStoredVoiceIDValid(id) || (expectedID != "" && expectedID != id) {
		return invalid("id")
	}
	if response["type"] != "prompted" {
		return invalid("type")
	}
	if model := response["model"]; model != nil && model != "" && model != "models/"+geminiVoiceDesignModel {
		return invalid("model")
	}
	if key := response["key"]; key != nil && key != "" {
		return invalid("key")
	}
	expires, err := time.Parse(time.RFC3339Nano, ValueAsString(response["expire_time"]))
	if err != nil || expires.IsZero() {
		return invalid("expire_time")
	}
	result.ExpiresAt = expires.UTC()
	result.Metadata = map[string]any{"provider": "gemini", "creation_source": "text_description", "workflow_model_id": geminiVoiceDesignModel}
	result.Usage, err = geminiInteractionUsage(response["usage"])
	if err != nil {
		return invalid("usage")
	}
	if preview {
		sample := response["sample_audio"]
		encoded := ValueAsString(MapField(sample, "data"))
		if ValueAsString(MapField(sample, "mime_type")) != "audio/wav" || encoded == "" || len(encoded) > maxGeminiTTSAudioBase64Bytes {
			return invalid("sample_audio")
		}
		audio, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return invalid("sample_base64")
		}
		_, duration, err := finiteASRWAVInfo(audio)
		if err != nil || duration <= 0 || !geminiWAVPCM16(audio) {
			return invalid("sample_wav")
		}
		result.PreviewAudio, result.PreviewMime = audio, "audio/wav"
	}
	return result, nil
}

func geminiInteractionUsage(raw any) (*runtimev1.UsageStats, error) {
	if raw == nil {
		return nil, nil
	}
	usage, ok := raw.(map[string]any)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	counts := []int64{0, 0}
	present := 0
	for i, key := range []string{"total_input_tokens", "total_output_tokens"} {
		value, exists := usage[key]
		if !exists {
			continue
		}
		count, valid := value.(float64)
		if !valid || math.IsNaN(count) || math.IsInf(count, 0) || count < 0 || count >= float64(math.MaxInt64) || math.Trunc(count) != count {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		counts[i] = int64(count)
		present++
	}
	if present == len(counts) {
		return &runtimev1.UsageStats{InputTokens: counts[0], OutputTokens: counts[1]}, nil
	}
	return nil, nil
}
