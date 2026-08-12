package nimillm

import (
	"context"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// VoiceWorkflowRequest captures the unified input for a voice workflow adapter.
type VoiceWorkflowRequest struct {
	Provider        string
	WorkflowType    string // "reference_audio" or "text_description"
	WorkflowModelID string
	ModelID         string
	Payload         map[string]any
	ExtPayload      map[string]any
}

// VoiceWorkflowResult captures the output from a voice workflow adapter.
type VoiceWorkflowResult struct {
	ProviderJobID    string
	ProviderVoiceRef string
	Metadata         map[string]any
}

// ExecuteVoiceWorkflowAdapter dispatches one exact Driver-selected voice
// dialect. The provider in the mapped request is only a consistency check.
func ExecuteVoiceWorkflowAdapter(ctx context.Context, adapter string, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	provider := strings.TrimSpace(strings.ToLower(req.Provider))
	expectedProvider := voiceWorkflowProviderForAdapter(adapter)
	if provider == "" || expectedProvider == "" || provider != expectedProvider {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	switch strings.TrimSpace(adapter) {
	case "dashscope_voice_workflow_adapter":
		return executeDashScopeVoiceWorkflow(ctx, req, cfg)
	case "elevenlabs_voice_workflow_adapter":
		return executeElevenLabsVoiceWorkflow(ctx, req, cfg)
	case "fish_audio_voice_workflow_adapter":
		return executeFishAudioVoiceWorkflow(ctx, req, cfg)
	case "mimo_voice_workflow_adapter":
		return executeMimoVoiceWorkflow(ctx, req, cfg)
	case "stepfun_voice_workflow_adapter":
		return executeStepFunVoiceWorkflow(ctx, req, cfg)
	default:
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
}

func voiceWorkflowProviderForAdapter(adapter string) string {
	switch strings.TrimSpace(adapter) {
	case "dashscope_voice_workflow_adapter":
		return "dashscope"
	case "elevenlabs_voice_workflow_adapter":
		return "elevenlabs"
	case "fish_audio_voice_workflow_adapter":
		return "fish_audio"
	case "mimo_voice_workflow_adapter":
		return "mimo"
	case "stepfun_voice_workflow_adapter":
		return "stepfun"
	default:
		return ""
	}
}

// voiceWorkflowPost posts to one adapter-owned endpoint.
func voiceWorkflowPost(
	ctx context.Context,
	baseURL string,
	apiKey string,
	path string,
	payload map[string]any,
	headers map[string]string,
	provider string,
	workflowType string,
	workflowModelID string,
) (VoiceWorkflowResult, error) {
	if strings.TrimSpace(path) == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}
	if err := ctx.Err(); err != nil {
		return VoiceWorkflowResult{}, err
	}
	response := map[string]any{}
	if err := DoJSONRequestWithHeaders(ctx, http.MethodPost, JoinURL(baseURL, path), apiKey, payload, &response, headers); err != nil {
		return VoiceWorkflowResult{}, err
	}
	providerVoiceRef := extractVoiceWorkflowVoiceRef(response)
	if providerVoiceRef == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	metadata := map[string]any{
		"provider":          provider,
		"creation_source":   strings.TrimSpace(workflowType),
		"workflow_model_id": strings.TrimSpace(workflowModelID),
		"adapter":           "nimillm_voice_adapter_" + provider,
		"endpoint":          strings.TrimSpace(path),
	}
	if statusText := strings.TrimSpace(ResolveAsyncTaskStatus(response)); statusText != "" {
		metadata["provider_status"] = statusText
	}
	return VoiceWorkflowResult{
		ProviderJobID:    ExtractTaskIDFromAdapterPayload("voice:"+provider, response),
		ProviderVoiceRef: providerVoiceRef,
		Metadata:         metadata,
	}, nil
}

func executeSimpleVoiceWorkflow(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig, provider string, defaults []string) (VoiceWorkflowResult, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := resolveVoiceWorkflowBaseURL(provider, cfg)
	if baseURL == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	path := resolveVoiceEndpointPath(req.WorkflowType, defaults)
	headers := voiceWorkflowHeaders(provider, cfg)
	return voiceWorkflowPost(ctx, baseURL, cfg.APIKey, path, req.Payload, headers, provider, req.WorkflowType, req.WorkflowModelID)
}

// resolveVoiceWorkflowBaseURL derives execution only from the exact target.
func resolveVoiceWorkflowBaseURL(provider string, cfg MediaAdapterConfig) string {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return ""
	}
	if strings.EqualFold(strings.TrimSpace(provider), "dashscope") {
		return strings.TrimSuffix(nativeOriginURL(baseURL), "/")
	}
	return baseURL
}

func voiceWorkflowHeaders(provider string, cfg MediaAdapterConfig) map[string]string {
	headers := make(map[string]string, len(cfg.Headers)+1)
	for key, value := range cfg.Headers {
		headers[key] = value
	}
	if provider == "elevenlabs" && strings.TrimSpace(cfg.APIKey) != "" {
		headers["xi-api-key"] = strings.TrimSpace(cfg.APIKey)
	}
	return headers
}

// extractVoiceWorkflowVoiceRef extracts a voice reference from the provider response.
func extractVoiceWorkflowVoiceRef(payload map[string]any) string {
	voiceRef := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(payload["voice_ref"]),
		ValueAsString(payload["voice_id"]),
		ValueAsString(payload["voiceId"]),
		ValueAsString(payload["voice"]),
		ValueAsString(MapField(payload["result"], "voice")),
		ValueAsString(MapField(payload["data"], "voice")),
		ValueAsString(MapField(payload["output"], "voice")),
		ValueAsString(MapField(payload["voice"], "id")),
		ValueAsString(MapField(payload["voice"], "voice_id")),
		ValueAsString(MapField(payload["voice"], "voice_ref")),
		ValueAsString(MapField(payload["result"], "voice_id")),
		ValueAsString(MapField(payload["result"], "voiceId")),
		ValueAsString(MapField(payload["result"], "voice_ref")),
		ValueAsString(MapField(payload["data"], "voice_id")),
		ValueAsString(MapField(payload["data"], "voiceId")),
		ValueAsString(MapField(payload["data"], "voice_ref")),
		ValueAsString(MapField(payload["output"], "voice_id")),
		ValueAsString(MapField(payload["output"], "voiceId")),
		ValueAsString(MapField(payload["output"], "voice_ref")),
	))
	if voiceRef != "" {
		return voiceRef
	}
	providerJobID := anyAsyncTaskID(payload)
	if providerJobID != "" {
		return ""
	}
	return strings.TrimSpace(FirstNonEmpty(
		ValueAsString(payload["id"]),
		ValueAsString(MapField(payload["result"], "id")),
		ValueAsString(MapField(payload["data"], "id")),
		ValueAsString(MapField(payload["output"], "id")),
	))
}

// extractPreviewIDFromVoiceWorkflowResponse extracts a preview ID for two-phase voice design.
func extractPreviewIDFromVoiceWorkflowResponse(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	if value := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(payload["preview_id"]),
		ValueAsString(payload["previewId"]),
		ValueAsString(payload["generated_voice_id"]),
		ValueAsString(payload["generatedVoiceId"]),
		ValueAsString(MapField(payload["data"], "preview_id")),
		ValueAsString(MapField(payload["data"], "previewId")),
		ValueAsString(MapField(payload["data"], "generated_voice_id")),
		ValueAsString(MapField(payload["data"], "generatedVoiceId")),
		ValueAsString(MapField(payload["result"], "preview_id")),
		ValueAsString(MapField(payload["result"], "previewId")),
		ValueAsString(MapField(payload["result"], "generated_voice_id")),
		ValueAsString(MapField(payload["result"], "generatedVoiceId")),
	)); value != "" {
		return value
	}
	for _, container := range []any{payload["previews"], MapField(payload["data"], "previews"), MapField(payload["result"], "previews")} {
		items, ok := container.([]any)
		if !ok {
			continue
		}
		for _, item := range items {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if value := strings.TrimSpace(FirstNonEmpty(
				ValueAsString(m["preview_id"]),
				ValueAsString(m["previewId"]),
				ValueAsString(m["generated_voice_id"]),
				ValueAsString(m["generatedVoiceId"]),
				ValueAsString(m["id"]),
			)); value != "" {
				return value
			}
		}
	}
	return ""
}

func resolveVoiceEndpointPath(workflowType string, defaults []string) string {
	workflow := strings.ToLower(strings.TrimSpace(workflowType))
	if workflow != "reference_audio" && workflow != "text_description" {
		return ""
	}
	for _, candidate := range defaults {
		if path := strings.TrimSpace(candidate); path != "" {
			return path
		}
	}
	return ""
}
