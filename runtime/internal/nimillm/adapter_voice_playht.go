package nimillm

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func executePlayHTVoiceWorkflow(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	baseURL := resolveVoiceWorkflowBaseURL("playht", cfg, req.ExtPayload)
	if baseURL == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	defaults := []string{"/api/v2/cloned-voices/instant", "/v1/voices/clone", "/v1/voice-clone"}
	paths := resolveVoiceEndpointPaths(req.WorkflowType, req.ExtPayload, defaults)
	headers := voiceWorkflowHeaders("playht", cfg.APIKey, req.ExtPayload)

	return voiceWorkflowTryEndpoints(ctx, baseURL, cfg.APIKey, paths, req.Payload, headers, "playht", req.WorkflowType, req.WorkflowModelID)
}
