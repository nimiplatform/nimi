package ai

import (
	"context"

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
		return nil, localExactMediaUnsupportedError(req.GetScenarioType())
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

	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if acquireErr != nil {
		return nil, schedulerAcquireError(acquireErr)
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("submit_voice_workflow_job", req.GetHead().GetAppId(), acquireResult)

	job, asset := s.voiceAssets.submit(&voiceWorkflowSubmitInput{
		Head:              req.GetHead(),
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
			ProviderModelTarget: effective.rawTarget, ConnectorGrantID: effective.grant.Grant.GrantID,
		},
		IgnoredExtensions: ignored,
	})
	if job == nil || asset == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}

	timeout := timeoutDuration(req.GetHead().GetTimeoutMs(), defaultSynthesizeTimeout)
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

	return &runtimev1.SubmitScenarioJobResponse{Job: job, Asset: asset}, nil
}
