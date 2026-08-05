package ai

import (
	"context"
	"errors"
	"strings"

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
	if requestExplicitlyDeclaresLocalExecution(req.GetHead()) {
		return nil, localExactMediaUnsupportedError(req.GetScenarioType())
	}

	remoteTarget, err := s.prepareScenarioRequestWithExtensions(ctx, req.GetHead(), req.GetScenarioType(), req.GetExtensions())
	if err != nil {
		return nil, err
	}

	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if acquireErr != nil {
		return nil, schedulerAcquireError(acquireErr)
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
	if routeDecision == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		return nil, localExactMediaUnsupportedError(req.GetScenarioType())
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
			return nil, grpcerr.WrapWithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, err, grpcerr.ReasonOptions{
				Message: "voice workflow catalog model could not be resolved",
			})
		}
		if errors.Is(err, catalog.ErrVoiceWorkflowUnsupported) {
			return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED, err, grpcerr.ReasonOptions{
				Message: "voice workflow is not supported",
			})
		}
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
			Message: "voice workflow catalog metadata could not be read",
		})
	}
	if _, err := resolveVoiceWorkflowExtensionPayload(req, workflowResolution.Provider); err != nil {
		return nil, err
	}
	req = s.normalizeVoiceWorkflowRequestTargetModelID(ctx, req, workflowResolution)

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

func (s *Service) normalizeVoiceWorkflowRequestTargetModelID(
	ctx context.Context,
	req *runtimev1.SubmitScenarioJobRequest,
	resolution catalog.ResolveVoiceWorkflowResult,
) *runtimev1.SubmitScenarioJobRequest {
	if s == nil || s.speechCatalog == nil || req == nil || req.GetSpec() == nil {
		return req
	}
	provider := strings.TrimSpace(resolution.Provider)
	if provider == "" {
		return req
	}
	subjectUserID := scenarioTargetSubjectUserID(ctx, req.GetHead())
	normalize := func(value string) string {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return ""
		}
		resolved := strings.TrimSpace(s.speechCatalog.ResolveAPIModelIDForSubject(subjectUserID, provider, trimmed))
		if resolved == "" {
			return trimmed
		}
		return resolved
	}

	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:
		current := strings.TrimSpace(req.GetSpec().GetVoiceClone().GetTargetModelId())
		normalized := normalize(current)
		if normalized == "" || normalized == current {
			return req
		}
		cloned := cloneSubmitScenarioJobRequest(req)
		if cloned == nil || cloned.GetSpec() == nil || cloned.GetSpec().GetVoiceClone() == nil {
			return req
		}
		cloned.GetSpec().GetVoiceClone().TargetModelId = normalized
		return cloned
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		current := strings.TrimSpace(req.GetSpec().GetVoiceDesign().GetTargetModelId())
		normalized := normalize(current)
		if normalized == "" || normalized == current {
			return req
		}
		cloned := cloneSubmitScenarioJobRequest(req)
		if cloned == nil || cloned.GetSpec() == nil || cloned.GetSpec().GetVoiceDesign() == nil {
			return req
		}
		cloned.GetSpec().GetVoiceDesign().TargetModelId = normalized
		return cloned
	default:
		return req
	}
}
