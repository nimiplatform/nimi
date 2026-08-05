package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
)

// executeVoiceWorkflowViaNimillm is retained only as a dialect unit-test
// helper. Production voice workflows dispatch through Remote ExecutionHost.
func executeVoiceWorkflowViaNimillm(
	ctx context.Context,
	provider string,
	req *runtimev1.SubmitScenarioJobRequest,
	resolution catalog.ResolveVoiceWorkflowResult,
	cfg nimillm.MediaAdapterConfig,
) (voiceWorkflowExecutionResult, error) {
	if req == nil || req.GetSpec() == nil {
		return voiceWorkflowExecutionResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	if err := validateVoiceWorkflowSpec(req.GetScenarioType(), req.GetSpec()); err != nil {
		return voiceWorkflowExecutionResult{}, err
	}
	if err := validateVoiceWorkflowRequestAgainstMetadata(req, resolution); err != nil {
		return voiceWorkflowExecutionResult{}, err
	}
	if err := ctx.Err(); err != nil {
		return voiceWorkflowExecutionResult{}, err
	}
	extPayload, err := resolveVoiceWorkflowExtensionPayload(req, provider)
	if err != nil {
		return voiceWorkflowExecutionResult{}, err
	}
	adapter := capabilitydriver.ResolveCloudMediaAdapter(provider, scenarioTargetCapability(req.GetScenarioType()))
	if adapter == "" {
		return voiceWorkflowExecutionResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}
	result, err := nimillm.ExecuteVoiceWorkflowAdapter(ctx, adapter, nimillm.VoiceWorkflowRequest{
		Provider:        provider,
		WorkflowType:    strings.TrimSpace(resolution.WorkflowType),
		WorkflowModelID: strings.TrimSpace(resolution.WorkflowModelID),
		ModelID:         strings.TrimSpace(resolution.ModelID),
		Payload:         buildVoiceWorkflowPayload(req, resolution, extPayload),
		ExtPayload:      extPayload,
	}, cfg)
	if err != nil {
		return voiceWorkflowExecutionResult{}, err
	}
	return voiceWorkflowExecutionResult{
		ProviderJobID: result.ProviderJobID, ProviderVoiceRef: result.ProviderVoiceRef,
		Metadata: result.Metadata, Usage: estimateVoiceWorkflowUsage(req),
	}, nil
}
