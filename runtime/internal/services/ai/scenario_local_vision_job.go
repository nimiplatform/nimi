package ai

import (
	"context"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// @nimi-authority: rule.nimi.runtime.service-operations.r036
func (s *Service) submitLocalVisionScenarioJob(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest, mode runtimev1.ExecutionMode, ignored []*runtimev1.IgnoredScenarioExtension) (*runtimev1.SubmitScenarioJobResponse, error) {
	scope, err := buildScenarioJobIdempotencyScope(ctx, req)
	if err != nil {
		return nil, err
	}
	if scope != "" {
		if job, ok := s.scenarioJobs.getByIdempotency(scope); ok {
			return &runtimev1.SubmitScenarioJobResponse{Job: job}, nil
		}
	}
	effective, err := s.captureLocalVisionEffectiveInputs(ctx, req.GetHead(), req.GetSpec().GetVisionLocate())
	if err != nil {
		return nil, err
	}
	jobCtx, cancel := context.WithCancel(newDetachedAsyncJobContext(ctx))
	now := timestamppb.Now()
	jobID := ulid.Make().String()
	job := &runtimev1.ScenarioJob{
		JobId: jobID, ScenarioType: req.ScenarioType, ExecutionMode: mode, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		Head: cloneScenarioHead(req.Head), CreatedAt: now, UpdatedAt: now, TraceId: ulid.Make().String(),
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, ModelResolved: effective.displayName, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		EffectiveInputIdentity: effective.identity, IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored),
	}
	stored, created, err := s.scenarioJobs.createOwnedAndBindCapturedInputsChecked(job, cancel, localAppJobOwnerFromContext(ctx), scope, effective.assembly, nil, false, localAppMusicSubmissionFromContext(ctx))
	if err != nil {
		cancel()
		return nil, scenarioJobSubmissionError(err, "Locate submission could not be persisted")
	}
	if !created {
		cancel()
		return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
	}
	ticket := s.localVisionJobOrder.reserve()
	go s.runLocalVisionScenarioJob(jobCtx, jobID, ticket)
	return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
}

func (s *Service) runLocalVisionScenarioJob(ctx context.Context, jobID string, ticket *localMediaSubmissionTicket) {
	defer ticket.release()
	if !s.scenarioJobs.startExecution(jobID) {
		return
	}
	defer s.finishScenarioJobExecution(jobID)
	budget := newScenarioJobExecutionBudget(ctx)
	ctx = budget
	defer budget.close()
	if _, ok, err := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED, nil); err != nil {
		s.failScenarioJobPersistencePrecondition(jobID, scenarioJobQueuedPersistenceFailedReason, err)
		return
	} else if !ok {
		return
	}
	assembly, ok := s.scenarioJobs.resolvedAssembly(jobID)
	if !ok {
		s.finishLocalSpeechJobFailure(ctx, jobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		return
	}
	plan, err := visionPlanFromResolvedAssembly(assembly)
	if err != nil {
		s.finishLocalSpeechJobFailure(ctx, jobID, err)
		return
	}
	if err := ticket.wait(ctx); err != nil {
		s.finishLocalSpeechJobFailure(ctx, jobID, err)
		return
	}
	job, ok := s.scenarioJobs.get(jobID)
	if !ok {
		return
	}
	var schedulerRelease func()
	defer func() {
		if schedulerRelease != nil {
			schedulerRelease()
		}
	}()
	onStart := func() error {
		release, err := s.acquireAsyncScenarioJobLease(ctx, job.GetHead().GetAppId(), "scenario_job_local_vision")
		if err != nil {
			return err
		}
		if _, ok, err := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); err != nil {
			release()
			s.failScenarioJobPersistencePrecondition(jobID, scenarioJobRunningPersistenceFailedReason, err)
			return err
		} else if !ok {
			release()
			return context.Canceled
		}
		schedulerRelease = release
		ticket.release()
		return budget.start(120 * time.Second)
	}
	result, err := s.localVisionHost.ExecuteVisionLocate(ctx, plan, onStart)
	budget.stop()
	if err == nil {
		err = ctx.Err()
	}
	if err == nil {
		err = localexecution.ValidateVisionLocateResult(result, plan.Request, plan.Width, plan.Height)
	}
	if err != nil {
		s.finishLocalSpeechJobFailure(ctx, jobID, err)
		return
	}
	_ = s.completeVisionScenarioJob(jobID, result)
}
