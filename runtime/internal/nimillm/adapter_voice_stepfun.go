package nimillm

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func executeStepFunVoiceWorkflow(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	baseURL := resolveVoiceWorkflowBaseURL("stepfun", cfg, req.ExtPayload)
	if baseURL == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	defaults := []string{"/v1/audio/voice-clone", "/v1/audio/voices/clone", "/v1/voices/clone"}
	paths := resolveVoiceEndpointPaths(req.WorkflowType, req.ExtPayload, defaults)
	headers := voiceWorkflowHeaders("stepfun", cfg.APIKey, req.ExtPayload)

	return voiceWorkflowTryEndpoints(ctx, baseURL, cfg.APIKey, paths, req.Payload, headers, "stepfun", req.WorkflowType, req.WorkflowModelID)
}
