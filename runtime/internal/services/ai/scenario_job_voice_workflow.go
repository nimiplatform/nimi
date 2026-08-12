package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func (s *Service) submitVoiceWorkflowJob(
	ctx context.Context,
	req *runtimev1.SubmitScenarioJobRequest,
	ignored []*runtimev1.IgnoredScenarioExtension,
) (*runtimev1.SubmitScenarioJobResponse, error) {
	if req == nil || req.GetHead() == nil || req.GetSpec() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := validateVoiceWorkflowSpec(req.GetScenarioType(), req.GetSpec()); err != nil {
		return nil, err
	}
	intent, err := scenarioExecutionIntentFromContext(ctx, scenarioTargetCapability(req.GetScenarioType()))
	if err != nil {
		return nil, err
	}
	if intent.IsLocal() {
		return s.submitLocalVoiceWorkflowJob(ctx, req, intent, ignored)
	}
	if strings.TrimSpace(req.GetSpec().GetVoiceCreate().GetTargetModelId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH)
	}
	effective, err := s.captureCloudVoiceWorkflowEffectiveInputs(ctx, req)
	if err != nil {
		return nil, err
	}
	releaseEffective := true
	defer func() {
		if releaseEffective {
			effective.release()
		}
	}()
	req = effective.request
	resolution := effective.resolution
	timeout, err := scenarioJobTimeoutDuration(req, defaultSynthesizeTimeout, false)
	if err != nil {
		return nil, err
	}

	job, asset := s.voiceAssets.submit(&voiceWorkflowSubmitInput{
		Head:              req.GetHead(),
		LocalAppOwner:     localAppJobOwnerFromContext(ctx),
		ScenarioType:      req.GetScenarioType(),
		Spec:              req.GetSpec(),
		TraceID:           effective.traceID,
		RouteDecision:     runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ModelResolved:     effective.target.ProviderModelID(),
		Provider:          resolution.Provider,
		WorkflowModelID:   resolution.WorkflowModelID,
		WorkflowFamily:    resolution.WorkflowFamily,
		OutputPersistence: resolution.OutputPersistence,
		HandlePolicyID:    resolution.HandlePolicyID,
		HandlePersistence: resolution.HandlePolicyPersistence,
		HandleScope:       resolution.HandlePolicyScope,
		HandleDefaultTTL:  resolution.HandlePolicyDefaultTTL,
		HandleDeleteSem:   resolution.HandlePolicyDeleteSemantics,
		RuntimeReconcile:  resolution.RuntimeReconciliationRequired,
		ExecutionTarget:   effective.voiceTarget.Clone(),
		CloudBinding: &voiceAssetCloudBinding{
			CapabilityContract: effective.target.CapabilityContract(), Implementation: effective.implementation,
			ProviderModelTarget: effective.rawTarget, ConnectorID: effective.connector.ConnectorID,
		},
		IgnoredExtensions: ignored,
	})
	if job == nil || asset == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}

	// Keep caller metadata and credentials out of the detached job. The typed
	// identity below is the only request ownership value retained.
	jobCtx := newDetachedAsyncJobContext(ctx)
	var cancel context.CancelFunc
	if timeout > 0 {
		jobCtx, cancel = context.WithTimeout(jobCtx, timeout)
	} else {
		jobCtx, cancel = context.WithCancel(jobCtx)
	}
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, &authn.Identity{SubjectUserID: identity.SubjectUserID})
	}
	if !s.voiceAssets.setJobCancel(job.GetJobId(), cancel) {
		cancel()
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	releaseEffective = false
	go func() {
		defer cancel()
		defer effective.release()
		s.executeCapturedVoiceWorkflowJob(jobCtx, job.GetJobId(), asset.GetVoiceAssetId(), effective)
	}()

	return &runtimev1.SubmitScenarioJobResponse{Job: job}, nil
}

func voiceAssetReference(voiceAssetID string) *runtimev1.VoiceReference {
	return &runtimev1.VoiceReference{
		Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET,
		Reference: &runtimev1.VoiceReference_VoiceAssetId{
			VoiceAssetId: voiceAssetID,
		},
	}
}
