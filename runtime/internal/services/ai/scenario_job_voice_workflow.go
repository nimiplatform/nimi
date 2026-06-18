package ai

import (
	"context"
	"errors"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
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

	remoteTarget, err := s.prepareScenarioRequestWithExtensions(ctx, req.GetHead(), req.GetScenarioType(), req.GetExtensions())
	if err != nil {
		return nil, err
	}

	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if acquireErr != nil {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("submit_voice_workflow_job", req.GetHead().GetAppId(), acquireResult)

	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProviderWithTargetAndModal(
		ctx,
		req.GetHead().GetRoutePolicy(),
		req.GetHead().GetFallback(),
		req.GetHead().GetModelId(),
		remoteTarget,
		scenarioModalFromType(req.GetScenarioType()),
	)
	if err != nil {
		return nil, err
	}
	if err := s.validateScenarioCapability(ctx, req, modelResolved, remoteTarget, selectedProvider); err != nil {
		return nil, err
	}
	providerType := voiceWorkflowCatalogProviderType(modelResolved, remoteTarget, selectedProvider)
	if err := s.validateCatalogAwareScenarioSupport(ctx, req.GetScenarioType(), providerType, modelResolved, req.GetSpec()); err != nil {
		return nil, err
	}
	s.recordRouteAutoSwitch(
		req.GetHead().GetAppId(),
		req.GetHead().GetSubjectUserId(),
		req.GetHead().GetModelId(),
		modelResolved,
		routeInfo,
	)

	workflowType := workflowTypeFromScenarioType(req.GetScenarioType())
	workflowResolution, err := s.resolveVoiceWorkflow(ctx, providerType, modelResolved, workflowType)
	if err != nil {
		if errors.Is(err, catalog.ErrModelNotFound) {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
		}
		if errors.Is(err, catalog.ErrVoiceWorkflowUnsupported) {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
		}
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	if _, err := resolveVoiceWorkflowExtensionPayload(req, workflowResolution.Provider); err != nil {
		return nil, err
	}

	traceID := ulid.Make().String()
	job, asset := s.voiceAssets.submit(&voiceWorkflowSubmitInput{
		Head:              req.GetHead(),
		ScenarioType:      req.GetScenarioType(),
		Spec:              req.GetSpec(),
		TraceID:           traceID,
		RouteDecision:     routeDecision,
		ModelResolved:     modelResolved,
		Provider:          workflowResolution.Provider,
		WorkflowModelID:   workflowResolution.WorkflowModelID,
		WorkflowFamily:    workflowResolution.WorkflowFamily,
		OutputPersistence: workflowResolution.OutputPersistence,
		HandlePolicyID:    workflowResolution.HandlePolicyID,
		HandlePersistence: workflowResolution.HandlePolicyPersistence,
		HandleScope:       workflowResolution.HandlePolicyScope,
		HandleDefaultTTL:  workflowResolution.HandlePolicyDefaultTTL,
		HandleDeleteSem:   workflowResolution.HandlePolicyDeleteSemantics,
		RuntimeReconcile:  workflowResolution.RuntimeReconciliationRequired,
		IgnoredExtensions: ignored,
	})
	if job == nil || asset == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	adapterCfg := s.resolveNativeAdapterConfig(workflowResolution.Provider, remoteTarget)

	timeout := timeoutDuration(req.GetHead().GetTimeoutMs(), defaultSynthesizeTimeout)
	jobCtx := inheritAsyncJobContext(ctx)
	var cancel context.CancelFunc
	if timeout > 0 {
		jobCtx, cancel = context.WithTimeout(jobCtx, timeout)
	} else {
		jobCtx, cancel = context.WithCancel(jobCtx)
	}
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, identity)
	}
	go func() {
		defer cancel()
		s.executeVoiceWorkflowJob(jobCtx, job.GetJobId(), asset.GetVoiceAssetId(), workflowResolution, cloneSubmitScenarioJobRequest(req), adapterCfg)
	}()

	return &runtimev1.SubmitScenarioJobResponse{
		Job:   job,
		Asset: asset,
	}, nil
}
