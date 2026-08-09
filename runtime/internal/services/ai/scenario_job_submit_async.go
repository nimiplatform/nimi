package ai

import (
	"context"
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
	if err := validateSubmitScenarioAsyncJobRequest(req); err != nil {
		return nil, err
	}
	if intent.IsLocal() {
		return nil, localExactMediaUnsupportedError(req.GetScenarioType())
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

	// Exact Cloud implementation, Driver target, grant, defaults, request, and
	// stream behavior are fixed before the Runtime job becomes visible.
	effective, err := s.captureCloudMediaEffectiveInputs(ctx, req.GetHead(), req, mode)
	if err != nil {
		return nil, err
	}
	fail := func(err error) (*runtimev1.SubmitScenarioJobResponse, error) {
		effective.release()
		return nil, err
	}

	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if acquireErr != nil {
		return fail(schedulerAcquireError(acquireErr))
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("submit_scenario_job", req.GetHead().GetAppId(), acquireResult)

	jobID := ulid.Make().String()
	// The detached job starts from a sterile context: request metadata may
	// contain caller credentials and must not enter job state. Only the typed
	// authenticated identity below is retained for internal ownership checks.
	jobCtx := newDetachedAsyncJobContext(ctx)
	if s.config.providerPollWait != nil {
		jobCtx = nimillm.WithProviderPollWait(jobCtx, s.config.providerPollWait)
	}
	var cancel context.CancelFunc
	timeout := scenarioJobTimeoutDuration(effective.request, defaultScenarioJobTimeout(effective.request.GetScenarioType()), false)
	if effective.mapped.DetachedPolling() {
		// Provider polling and its terminal state machine are private to the
		// Remote Host. Runtime retains only an explicit cancel signal here.
		jobCtx, cancel = context.WithCancel(jobCtx)
	} else if timeout > 0 {
		jobCtx, cancel = context.WithTimeout(jobCtx, timeout)
	} else {
		jobCtx, cancel = context.WithCancel(jobCtx)
	}
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, &authn.Identity{SubjectUserID: identity.SubjectUserID})
	}

	now := timestamppb.New(time.Now().UTC())
	job := &runtimev1.ScenarioJob{
		JobId:             jobID,
		Head:              cloneScenarioHead(effective.request.GetHead()),
		ScenarioType:      effective.request.GetScenarioType(),
		ExecutionMode:     mode,
		RouteDecision:     runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ModelResolved:     effective.modelResolved(),
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
		TraceId:           effective.traceID,
		IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored),
	}
	snapshot := s.scenarioJobs.createOwned(job, cancel, localAppJobOwnerFromContext(ctx))
	if snapshot == nil {
		cancel()
		return fail(grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
	}
	if idempotencyScope != "" {
		s.scenarioJobs.bindIdempotency(idempotencyScope, jobID)
	}
	go func() {
		defer effective.release()
		s.executeScenarioAsyncJob(jobCtx, jobID, effective)
	}()
	return &runtimev1.SubmitScenarioJobResponse{Job: snapshot}, nil
}
