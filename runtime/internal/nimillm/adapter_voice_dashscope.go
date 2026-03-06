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
		defaults = []string{
			"/api/v1/services/aigc/audio/voice-enrollment",
			"/api/v1/services/aigc/audio/voice-clone",
			"/v1/audio/voices/clone",
			"/v1/voices/clone",
		}
	case "tts_t2v":
		defaults = []string{
			"/api/v1/services/aigc/audio/voice-design",
			"/v1/audio/voices/design",
			"/v1/voices/design",
		}
	default:
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}

	paths := resolveVoiceEndpointPaths(req.WorkflowType, req.ExtPayload, defaults)
	headers := voiceWorkflowHeaders("dashscope", cfg.APIKey, req.ExtPayload)

	return voiceWorkflowTryEndpoints(ctx, baseURL, cfg.APIKey, paths, req.Payload, headers, "dashscope", req.WorkflowType, req.WorkflowModelID)
}
