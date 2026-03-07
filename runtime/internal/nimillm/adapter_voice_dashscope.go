package nimillm

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func executeDashScopeVoiceWorkflow(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	baseURL := resolveVoiceWorkflowBaseURL("dashscope", cfg, req.ExtPayload)
	if baseURL == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	workflow := strings.ToLower(strings.TrimSpace(req.WorkflowType))
	var defaults []string
	switch workflow {
	case "tts_v2v":
		defaults = []string{"/api/v1/services/audio/tts/customization"}
	case "tts_t2v":
		defaults = []string{"/api/v1/services/audio/tts/customization"}
	default:
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}

	paths := resolveVoiceEndpointPaths(req.WorkflowType, req.ExtPayload, defaults)
	headers := voiceWorkflowHeaders("dashscope", cfg.APIKey, req.ExtPayload)
	payload := buildDashScopeVoiceWorkflowPayload(req)

	return voiceWorkflowTryEndpoints(ctx, baseURL, cfg.APIKey, paths, payload, headers, "dashscope", req.WorkflowType, req.WorkflowModelID)
}

func buildDashScopeVoiceWorkflowPayload(req VoiceWorkflowRequest) map[string]any {
	workflow := strings.ToLower(strings.TrimSpace(req.WorkflowType))
	workflowModelID := strings.TrimSpace(req.WorkflowModelID)
	targetModelID := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(req.Payload["target_model"]),
		ValueAsString(req.Payload["target_model_id"]),
		ValueAsString(req.Payload["model"]),
		ValueAsString(req.Payload["model_id"]),
		req.ModelID,
	))
	name := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(req.Payload["preferred_name"]),
	))
	safeName := normalizeDashScopePreferredName(name)
	switch workflow {
	case "tts_v2v":
		audioData := strings.TrimSpace(FirstNonEmpty(
			ValueAsString(req.Payload["audio_url"]),
			ValueAsString(req.Payload["reference_audio_uri"]),
			buildDashScopeVoiceReferenceAudioData(
				ValueAsString(req.Payload["reference_audio_mime"]),
				ValueAsString(req.Payload["reference_audio_base64"]),
			),
		))
		input := map[string]any{
			"action":       "create",
			"target_model": targetModelID,
			"audio": map[string]any{
				"data": audioData,
			},
		}
		if safeName != "" {
			input["preferred_name"] = safeName
			input["prefix"] = safeName
		}
		return map[string]any{
			"model": workflowModelID,
			"input": input,
		}
	case "tts_t2v":
		voicePrompt := strings.TrimSpace(FirstNonEmpty(
			ValueAsString(req.Payload["instruction_text"]),
			ValueAsString(req.Payload["description"]),
		))
		previewText := strings.TrimSpace(FirstNonEmpty(
			ValueAsString(req.Payload["preview_text"]),
			ValueAsString(req.Payload["text"]),
			voicePrompt,
		))
		language := strings.TrimSpace(ValueAsString(req.Payload["language"]))
		input := map[string]any{
			"action":       "create",
			"target_model": targetModelID,
			"voice_prompt": voicePrompt,
		}
		if previewText != "" {
			input["preview_text"] = previewText
		}
		if language != "" {
			input["language"] = language
		}
		if safeName != "" {
			input["preferred_name"] = safeName
		}
		return map[string]any{
			"model": workflowModelID,
			"input": input,
		}
	default:
		return req.Payload
	}
}

func buildDashScopeVoiceReferenceAudioData(mimeType string, base64Data string) string {
	encoded := strings.TrimSpace(base64Data)
	if encoded == "" {
		return ""
	}
	mime := strings.TrimSpace(mimeType)
	if mime == "" {
		mime = "audio/wav"
	}
	return "data:" + mime + ";base64," + encoded
}

func normalizeDashScopePreferredName(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "nimi_voice"
	}
	var builder strings.Builder
	lastUnderscore := false
	for _, r := range trimmed {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
			lastUnderscore = false
		case r >= 'A' && r <= 'Z':
			builder.WriteRune(r + ('a' - 'A'))
			lastUnderscore = false
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
			lastUnderscore = false
		default:
			if lastUnderscore {
				continue
			}
			builder.WriteByte('_')
			lastUnderscore = true
		}
	}
	normalized := strings.Trim(builder.String(), "_")
	if normalized == "" {
		return "nimi_voice"
	}
	first := normalized[0]
	if first >= '0' && first <= '9' {
		normalized = "voice_" + normalized
	}
	if len(normalized) > 32 {
		normalized = strings.Trim(normalized[:32], "_")
	}
	if normalized == "" {
		return "nimi_voice"
	}
	return normalized
}
