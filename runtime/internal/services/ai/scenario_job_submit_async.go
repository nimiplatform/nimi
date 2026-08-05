package ai

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) submitScenarioAsyncJob(
	ctx context.Context,
	req *runtimev1.SubmitScenarioJobRequest,
	mode runtimev1.ExecutionMode,
	ignored []*runtimev1.IgnoredScenarioExtension,
) (*runtimev1.SubmitScenarioJobResponse, error) {
	intent, err := scenarioExecutionIntentFromContext(ctx, scenarioTargetCapability(req.GetScenarioType()))
	if err != nil {
		return nil, err
	}
	requestedModelID := intent.ModelID()
	logLocalImageSubmit := false
	if logLocalImageSubmit {
		s.logger.Info("submit local image scenario job: start", "requested_model_id", requestedModelID)
	}
	if err := validateSubmitScenarioAsyncJobRequest(req); err != nil {
		return nil, err
	}
	if intent.IsLocal() {
		return nil, localExactMediaUnsupportedError(req.GetScenarioType())
	}

	prepareStartedAt := time.Now()
	remoteTarget, err := s.prepareScenarioRequestWithExtensions(ctx, req.GetHead(), req.GetScenarioType(), req.GetExtensions())
	if err != nil {
		return nil, err
	}
	if logLocalImageSubmit {
		s.logger.Info(
			"submit local image scenario job: request prepared",
			"requested_model_id", requestedModelID,
			"prepare_ms", time.Since(prepareStartedAt).Milliseconds(),
			"remote_target", remoteTarget != nil,
		)
	}

	idempotencyScope, err := buildScenarioJobIdempotencyScope(ctx, req)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{
			Message: "scenario job idempotency scope is invalid",
		})
	}
	if idempotencyScope != "" {
		if existing, ok := s.scenarioJobs.getByIdempotency(idempotencyScope); ok {
			return &runtimev1.SubmitScenarioJobResponse{Job: existing}, nil
		}
	}

	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if acquireErr != nil {
		return nil, schedulerAcquireError(acquireErr)
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("submit_scenario_job", req.GetHead().GetAppId(), acquireResult)

	resolveStartedAt := time.Now()
	selectedProvider, routeDecision, modelResolved, _, err := s.selector.resolveProviderWithTargetAndModal(
		ctx,
		intent.Route,
		requestedModelID,
		remoteTarget,
		scenarioModalFromType(req.GetScenarioType()),
	)
	if err != nil {
		return nil, err
	}
	if routeDecision == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		return nil, localExactMediaUnsupportedError(req.GetScenarioType())
	}
	if logLocalImageSubmit {
		s.logger.Info(
			"submit local image scenario job: provider resolved",
			"requested_model_id", requestedModelID,
			"model_resolved", strings.TrimSpace(modelResolved),
			"route_decision", routeDecision.String(),
			"resolve_ms", time.Since(resolveStartedAt).Milliseconds(),
		)
	}
	capabilityStartedAt := time.Now()
	if err := s.validateScenarioCapability(ctx, req, modelResolved, remoteTarget, selectedProvider); err != nil {
		return nil, err
	}
	if logLocalImageSubmit {
		s.logger.Info(
			"submit local image scenario job: capability validated",
			"model_resolved", strings.TrimSpace(modelResolved),
			"validate_ms", time.Since(capabilityStartedAt).Milliseconds(),
		)
	}
	if _, iteration, resolveErr := resolveMusicGenerateExtensionPayload(req); resolveErr != nil {
		return nil, resolveErr
	} else if supportErr := validateMusicGenerateIterationSupport(ctx, s, modelResolved, remoteTarget, selectedProvider, iteration); supportErr != nil {
		return nil, supportErr
	}
	providerType := ""
	if remoteTarget != nil {
		providerType = remoteTarget.ProviderType
	}
	adapterName := resolveMediaAdapterName(requestedModelID, modelResolved, scenarioModalFromType(req.GetScenarioType()), providerType)

	jobID := ulid.Make().String()
	traceID := ulid.Make().String()
	jobCtx := context.Background()
	if s.config.providerPollWait != nil {
		jobCtx = nimillm.WithProviderPollWait(jobCtx, s.config.providerPollWait)
	}
	var cancel context.CancelFunc
	timeout := scenarioJobTimeoutDuration(req, defaultScenarioJobTimeout(req.GetScenarioType()), remoteTarget == nil)
	if scenarioJobUsesDetachedPolling(req.GetScenarioType(), adapterName) {
		// Detached polling jobs (cloud async video, etc.) derive their terminal
		// state from the provider, not from a runtime execution deadline.
		// Cancel-only context: the poll loop runs until a provider terminal
		// state (succeeded/failed/expired/canceled) or an explicit user cancel.
		// Individual poll HTTP requests are bounded by the HTTP client's own
		// Timeout (defaultHTTPTimeout), not by this context.
		jobCtx, cancel = context.WithCancel(jobCtx)
	} else if timeout > 0 {
		jobCtx, cancel = context.WithTimeout(jobCtx, timeout)
	} else {
		jobCtx, cancel = context.WithCancel(jobCtx)
	}
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, identity)
	}

	now := timestamppb.New(time.Now().UTC())
	job := &runtimev1.ScenarioJob{
		JobId:             jobID,
		Head:              cloneScenarioHead(req.GetHead()),
		ScenarioType:      req.GetScenarioType(),
		ExecutionMode:     mode,
		RouteDecision:     routeDecision,
		ModelResolved:     modelResolved,
		Status:            runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		ProviderJobId:     "",
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		ReasonDetail:      "",
		ReasonMetadata:    nil,
		RetryCount:        0,
		CreatedAt:         now,
		UpdatedAt:         now,
		NextPollAt:        nil,
		Artifacts:         nil,
		Usage:             nil,
		TraceId:           traceID,
		IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored),
	}
	snapshot := s.scenarioJobs.create(job, cancel)
	if snapshot == nil {
		cancel()
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if idempotencyScope != "" {
		s.scenarioJobs.bindIdempotency(idempotencyScope, jobID)
	}
	go s.executeScenarioAsyncJob(jobCtx, jobID, cloneSubmitScenarioJobRequest(req), selectedProvider, modelResolved, remoteTarget)
	if logLocalImageSubmit {
		s.logger.Info(
			"submit local image scenario job: submitted",
			"job_id", jobID,
			"trace_id", traceID,
			"model_resolved", strings.TrimSpace(modelResolved),
		)
	}
	return &runtimev1.SubmitScenarioJobResponse{
		Job: snapshot,
	}, nil
}
