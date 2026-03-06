package nimillm

import (
	"context"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

// VoiceWorkflowRequest captures the unified input for a voice workflow adapter.
type VoiceWorkflowRequest struct {
	Provider        string
	WorkflowType    string // "tts_v2v" or "tts_t2v"
	WorkflowModelID string
	ModelID         string
	Payload         map[string]any
	Headers         map[string]string
	ExtPayload      map[string]any
}

// VoiceWorkflowResult captures the output from a voice workflow adapter.
type VoiceWorkflowResult struct {
	ProviderJobID    string
	ProviderVoiceRef string
	Metadata         map[string]any
}

// SupportsVoiceWorkflowProvider reports whether nimillm has a real provider-native
// voice workflow adapter for the provider.
func SupportsVoiceWorkflowProvider(provider string) bool {
	switch strings.TrimSpace(strings.ToLower(provider)) {
	case "dashscope", "elevenlabs", "fish_audio", "playht", "stepfun":
		return true
	default:
		return false
	}
}

// ExecuteVoiceWorkflow dispatches a voice workflow request to the appropriate
// provider adapter in nimillm. This is the single entry point called by the
// AI layer orchestrator.
func ExecuteVoiceWorkflow(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	provider := strings.TrimSpace(strings.ToLower(req.Provider))
	if provider == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}
	if !SupportsVoiceWorkflowProvider(provider) {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}

	switch provider {
	case "dashscope":
		return executeDashScopeVoiceWorkflow(ctx, req, cfg)
	case "elevenlabs":
		return executeElevenLabsVoiceWorkflow(ctx, req, cfg)
	case "fish_audio":
		return executeFishAudioVoiceWorkflow(ctx, req, cfg)
	case "playht":
		return executePlayHTVoiceWorkflow(ctx, req, cfg)
	case "stepfun":
		return executeStepFunVoiceWorkflow(ctx, req, cfg)
	default:
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}
}

// voiceWorkflowTryEndpoints posts the payload to each endpoint path in order,
// returning the first successful response. This is a shared helper for all
// provider voice workflow adapters.
func voiceWorkflowTryEndpoints(
	ctx context.Context,
	baseURL string,
	apiKey string,
	paths []string,
	payload map[string]any,
	headers map[string]string,
	provider string,
	workflowType string,
	workflowModelID string,
) (VoiceWorkflowResult, error) {
	if len(paths) == 0 {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}

	var lastErr error
	for _, path := range paths {
		if err := ctx.Err(); err != nil {
			return VoiceWorkflowResult{}, err
		}
		targetURL := JoinURL(baseURL, path)
		response := map[string]any{}
		err := DoJSONRequestWithHeaders(ctx, http.MethodPost, targetURL, apiKey, payload, &response, headers)
		if err != nil {
			lastErr = err
			if status.Code(err) == codes.NotFound {
				continue
			}
			return VoiceWorkflowResult{}, err
		}
		providerJobID := strings.TrimSpace(ExtractTaskIDFromPayload(response))
		providerVoiceRef := extractVoiceWorkflowVoiceRef(response)
		if providerVoiceRef == "" {
			lastErr = grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
			continue
		}

		metadata := map[string]any{
			"provider":          provider,
			"workflow_type":     strings.TrimSpace(workflowType),
			"workflow_model_id": strings.TrimSpace(workflowModelID),
			"adapter":           "nimillm_voice_adapter_" + provider,
			"endpoint":          strings.TrimSpace(path),
		}
		if statusText := strings.TrimSpace(ResolveAsyncTaskStatus(response)); statusText != "" {
			metadata["provider_status"] = statusText
		}
		return VoiceWorkflowResult{
			ProviderJobID:    providerJobID,
			ProviderVoiceRef: providerVoiceRef,
			Metadata:         metadata,
		}, nil
	}
	if lastErr != nil {
		return VoiceWorkflowResult{}, lastErr
	}
	return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}

// resolveVoiceWorkflowBaseURL resolves the base URL for voice workflow requests.
func resolveVoiceWorkflowBaseURL(provider string, cfg MediaAdapterConfig, extPayload map[string]any) string {
	if extPayload != nil {
		if value := strings.TrimSpace(ValueAsString(extPayload["base_url"])); value != "" {
			return strings.TrimSuffix(value, "/")
		}
	}
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL != "" {
		return baseURL
	}
	record, ok := providerregistry.Lookup(strings.TrimSpace(strings.ToLower(provider)))
	if ok {
		return strings.TrimSuffix(strings.TrimSpace(record.DefaultEndpoint), "/")
	}
	return ""
}

// voiceWorkflowHeaders builds the HTTP headers for a voice workflow request.
func voiceWorkflowHeaders(provider string, apiKey string, extPayload map[string]any) map[string]string {
	headers := map[string]string{}
	if rawHeaders, ok := extPayload["headers"].(map[string]any); ok {
		for key, value := range rawHeaders {
			headers[strings.TrimSpace(key)] = strings.TrimSpace(ValueAsString(value))
		}
	}
	if provider == "elevenlabs" && strings.TrimSpace(apiKey) != "" {
		headers["xi-api-key"] = strings.TrimSpace(apiKey)
	}
	if provider == "playht" {
		userID := strings.TrimSpace(ValueAsString(extPayload["user_id"]))
		if userID != "" {
			headers["X-USER-ID"] = userID
		}
	}
	if apiKeyHeader := strings.TrimSpace(ValueAsString(extPayload["api_key_header"])); apiKeyHeader != "" && strings.TrimSpace(apiKey) != "" {
		headers[apiKeyHeader] = strings.TrimSpace(apiKey)
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
	providerJobID := strings.TrimSpace(ExtractTaskIDFromPayload(payload))
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
		ValueAsString(MapField(payload["data"], "preview_id")),
		ValueAsString(MapField(payload["data"], "previewId")),
		ValueAsString(MapField(payload["result"], "preview_id")),
		ValueAsString(MapField(payload["result"], "previewId")),
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
				ValueAsString(m["id"]),
			)); value != "" {
				return value
			}
		}
	}
	return ""
}

// resolveVoiceEndpointPaths returns provider-specific or extension-provided paths.
func resolveVoiceEndpointPaths(workflowType string, extPayload map[string]any, defaults []string) []string {
	workflow := strings.ToLower(strings.TrimSpace(workflowType))
	if workflow == "" {
		return nil
	}
	keys := []string{"workflow_paths"}
	if workflow == "tts_v2v" {
		keys = append(keys, "clone_paths")
	}
	if workflow == "tts_t2v" {
		keys = append(keys, "design_paths")
	}

	candidates := make([]string, 0, 8)
	for _, key := range keys {
		candidates = append(candidates, valueAsTrimmedStringSliceVoice(extPayload[key])...)
	}
	candidates = append(candidates, defaults...)

	seen := make(map[string]struct{}, len(candidates))
	out := make([]string, 0, len(candidates))
	for _, item := range candidates {
		normalized := strings.TrimSpace(item)
		if normalized == "" {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		out = append(out, normalized)
	}
	return out
}

func valueAsTrimmedStringSliceVoice(value any) []string {
	items := make([]string, 0)
	switch typed := value.(type) {
	case []string:
		for _, item := range typed {
			if trimmed := strings.TrimSpace(item); trimmed != "" {
				items = append(items, trimmed)
			}
		}
	case []any:
		for _, item := range typed {
			if trimmed := strings.TrimSpace(ValueAsString(item)); trimmed != "" {
				items = append(items, trimmed)
			}
		}
	}
	if len(items) == 0 {
		return nil
	}
	return items
}

func firstNonEmptyVoice(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}
