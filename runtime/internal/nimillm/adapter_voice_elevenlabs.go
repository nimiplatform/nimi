package nimillm

import (
	"context"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func executeElevenLabsVoiceWorkflow(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	workflow := strings.ToLower(strings.TrimSpace(req.WorkflowType))

	// Voice design (tts_t2v) uses a two-phase preview→create workflow.
	if workflow == "tts_t2v" {
		result, err := executeElevenLabsTwoPhaseDesign(ctx, req, cfg)
		if err == nil {
			return result, nil
		}
		if status.Code(err) != codes.NotFound {
			return VoiceWorkflowResult{}, err
		}
		// Fall through to generic endpoint try on NotFound.
	}

	baseURL := resolveVoiceWorkflowBaseURL("elevenlabs", cfg, req.ExtPayload)
	if baseURL == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	var defaults []string
	switch workflow {
	case "tts_v2v":
		defaults = []string{"/v1/voices/add", "/v1/voices/clone"}
	case "tts_t2v":
		defaults = []string{"/v1/text-to-voice/create-voice-from-preview", "/v1/text-to-voice/create"}
	default:
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}

	paths := resolveVoiceEndpointPaths(req.WorkflowType, req.ExtPayload, defaults)
	headers := voiceWorkflowHeaders("elevenlabs", cfg.APIKey, req.ExtPayload)

	return voiceWorkflowTryEndpoints(ctx, baseURL, cfg.APIKey, paths, req.Payload, headers, "elevenlabs", req.WorkflowType, req.WorkflowModelID)
}

func executeElevenLabsTwoPhaseDesign(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	baseURL := resolveVoiceWorkflowBaseURL("elevenlabs", cfg, req.ExtPayload)
	if baseURL == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	headers := voiceWorkflowHeaders("elevenlabs", cfg.APIKey, req.ExtPayload)

	// Phase 1: Create preview.
	previewPayload := map[string]any{
		"model_id":          strings.TrimSpace(req.ModelID),
		"voice_description": strings.TrimSpace(ValueAsString(req.Payload["instruction_text"])),
		"description":       strings.TrimSpace(ValueAsString(req.Payload["instruction_text"])),
		"text": firstNonEmptyVoice(
			strings.TrimSpace(ValueAsString(req.Payload["preview_text"])),
			strings.TrimSpace(ValueAsString(req.Payload["instruction_text"])),
		),
		"language": strings.TrimSpace(ValueAsString(req.Payload["language"])),
	}
	if len(req.ExtPayload) > 0 {
		previewPayload["extensions"] = req.ExtPayload
	}

	previewPaths := resolveVoiceEndpointPaths("tts_t2v", req.ExtPayload, nil)
	if len(previewPaths) == 0 {
		previewPaths = []string{"/v1/text-to-voice/create-previews"}
	}
	// Use preview-specific extension keys if provided.
	if extPaths := valueAsTrimmedStringSliceVoice(req.ExtPayload["preview_paths"]); len(extPaths) > 0 {
		previewPaths = extPaths
	} else {
		previewPaths = []string{"/v1/text-to-voice/create-previews"}
	}

	previewResp := map[string]any{}
	var lastErr error
	for _, path := range previewPaths {
		err := DoJSONRequestWithHeaders(ctx, http.MethodPost, JoinURL(baseURL, path), cfg.APIKey, previewPayload, &previewResp, headers)
		if err != nil {
			lastErr = err
			if status.Code(err) == codes.NotFound {
				continue
			}
			return VoiceWorkflowResult{}, err
		}
		lastErr = nil
		break
	}
	if lastErr != nil {
		return VoiceWorkflowResult{}, lastErr
	}

	previewID := extractPreviewIDFromVoiceWorkflowResponse(previewResp)
	if previewID == "" {
		// If the preview response already contains a voice_ref, return it directly.
		if voiceRef := extractVoiceWorkflowVoiceRef(previewResp); voiceRef != "" {
			return VoiceWorkflowResult{
				ProviderJobID:    strings.TrimSpace(ExtractTaskIDFromPayload(previewResp)),
				ProviderVoiceRef: voiceRef,
				Metadata: map[string]any{
					"provider":          "elevenlabs",
					"workflow_type":     strings.TrimSpace(req.WorkflowType),
					"workflow_model_id": strings.TrimSpace(req.WorkflowModelID),
					"adapter":           "nimillm_voice_adapter_elevenlabs",
					"endpoint":          "/v1/text-to-voice/create-previews",
				},
			}, nil
		}
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}

	// Phase 2: Create voice from preview.
	createPayload := map[string]any{
		"model_id":   strings.TrimSpace(req.ModelID),
		"preview_id": previewID,
		"name":       strings.TrimSpace(ValueAsString(req.Payload["name"])),
	}
	if len(req.ExtPayload) > 0 {
		createPayload["extensions"] = req.ExtPayload
	}

	var createPaths []string
	if extPaths := valueAsTrimmedStringSliceVoice(req.ExtPayload["create_paths"]); len(extPaths) > 0 {
		createPaths = extPaths
	} else {
		createPaths = []string{"/v1/text-to-voice/create-voice-from-preview"}
	}

	createResp := map[string]any{}
	lastErr = nil
	for _, path := range createPaths {
		err := DoJSONRequestWithHeaders(ctx, http.MethodPost, JoinURL(baseURL, path), cfg.APIKey, createPayload, &createResp, headers)
		if err != nil {
			lastErr = err
			if status.Code(err) == codes.NotFound {
				continue
			}
			return VoiceWorkflowResult{}, err
		}
		providerVoiceRef := extractVoiceWorkflowVoiceRef(createResp)
		if providerVoiceRef == "" {
			lastErr = grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
			continue
		}
		providerJobID := strings.TrimSpace(ExtractTaskIDFromPayload(createResp))
		return VoiceWorkflowResult{
			ProviderJobID:    providerJobID,
			ProviderVoiceRef: providerVoiceRef,
			Metadata: map[string]any{
				"provider":          "elevenlabs",
				"workflow_type":     strings.TrimSpace(req.WorkflowType),
				"workflow_model_id": strings.TrimSpace(req.WorkflowModelID),
				"adapter":           "nimillm_voice_adapter_elevenlabs",
				"endpoint":          strings.TrimSpace(path),
				"preview_id":        previewID,
			},
		}, nil
	}
	if lastErr != nil {
		return VoiceWorkflowResult{}, lastErr
	}
	return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}
