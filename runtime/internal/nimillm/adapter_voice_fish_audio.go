package nimillm

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func executeFishAudioVoiceWorkflow(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	baseURL := resolveVoiceWorkflowBaseURL("fish_audio", cfg, req.ExtPayload)
	if baseURL == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	defaults := []string{"/v1/voices/clone", "/v1/voice-clone", "/v1/audio/voices/clone"}
	paths := resolveVoiceEndpointPaths(req.WorkflowType, req.ExtPayload, defaults)
	headers := voiceWorkflowHeaders("fish_audio", cfg.APIKey, req.ExtPayload)

	return voiceWorkflowTryEndpoints(ctx, baseURL, cfg.APIKey, paths, req.Payload, headers, "fish_audio", req.WorkflowType, req.WorkflowModelID)
}
