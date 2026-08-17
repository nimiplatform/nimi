package ai

import (
	"context"
	"errors"
	"fmt"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) submitLocalVideoScenarioJob(
	ctx context.Context,
	req *runtimev1.SubmitScenarioJobRequest,
	mode runtimev1.ExecutionMode,
	ignored []*runtimev1.IgnoredScenarioExtension,
) (*runtimev1.SubmitScenarioJobResponse, error) {
	if err := validateSubmitScenarioAsyncJobRequest(req); err != nil {
		return nil, err
	}
	idempotencyScope, err := buildScenarioJobIdempotencyScope(ctx, req)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	if idempotencyScope != "" {
		if existing, ok := s.scenarioJobs.getByIdempotency(idempotencyScope); ok {
			return &runtimev1.SubmitScenarioJobResponse{Job: existing}, nil
		}
	}

	// Driver admission and immutable capture happen before a Job is visible.
	effective, err := s.captureLocalVideoEffectiveInputs(ctx, req.GetHead(), req.GetSpec().GetVideoGenerate())
	if err != nil {
		return nil, err
	}
	if s.localVideoHost == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED, grpcerr.ReasonOptions{
			Message: "local video execution host is unavailable",
		})
	}
	if s.localVideoMedia == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED, grpcerr.ReasonOptions{
			Message: "local video media pipeline is unavailable",
		})
	}

	jobCtx := newDetachedAsyncJobContext(ctx)
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, &authn.Identity{SubjectUserID: identity.SubjectUserID})
	}
	timeout, err := scenarioJobTimeoutDuration(req, defaultGenerateVideoTimeout, true)
	if err != nil {
		return nil, err
	}
	var cancel context.CancelFunc
	if timeout > 0 {
		jobCtx, cancel = context.WithTimeout(jobCtx, timeout)
	} else {
		jobCtx, cancel = context.WithCancel(jobCtx)
	}
	now := timestamppb.New(time.Now().UTC())
	jobID := ulid.Make().String()
	job := &runtimev1.ScenarioJob{
		JobId: jobID, Head: cloneScenarioHead(effective.head), ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		ExecutionMode: mode, RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, ModelResolved: effective.modelResolved(),
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt: now, UpdatedAt: now, TraceId: ulid.Make().String(),
		ProgressTotalSteps: int32(effective.plan.FrameCount() + 1), IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored),
		EffectiveInputIdentity: cloneLoadoutEffectiveInputIdentity(effective.effectiveInputIdentity),
	}
	stored, created, persistErr := s.scenarioJobs.createOwnedAndBindAssemblyChecked(job, cancel, localAppJobOwnerFromContext(ctx), idempotencyScope, effective.resolvedAssembly)
	if persistErr != nil {
		cancel()
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, persistErr, grpcerr.ReasonOptions{
			Message: "ScenarioJob submission could not be persisted",
		})
	}
	if stored == nil {
		cancel()
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if !created {
		cancel()
		return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
	}
	ticket := s.localVideoJobOrder.reserve()
	go s.runLocalVideoScenarioJob(jobCtx, jobID, ticket)
	return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
}

func (s *Service) runLocalVideoScenarioJob(ctx context.Context, jobID string, ticket *localMediaSubmissionTicket) {
	if ticket != nil {
		defer ticket.release()
	}
	if !s.scenarioJobs.startExecution(jobID) {
		return
	}
	defer s.finishScenarioJobExecution(jobID)
	if _, ok, transitionErr := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED, nil); transitionErr != nil {
		s.failScenarioJobPersistencePrecondition(jobID, scenarioJobQueuedPersistenceFailedReason, transitionErr)
		return
	} else if !ok {
		return
	}
	job, ok := s.scenarioJobs.get(jobID)
	if !ok || job.GetHead() == nil {
		return
	}
	assembly, ok := s.scenarioJobs.resolvedAssembly(jobID)
	if !ok {
		s.finishLocalVideoJobFailure(ctx, jobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		return
	}
	effective, err := s.localVideoEffectiveInputsFromResolvedAssembly(assembly)
	if err != nil {
		s.finishLocalVideoJobFailure(ctx, jobID, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "captured local video assembly is invalid"}))
		return
	}
	effective.head = cloneScenarioHead(job.GetHead())
	if err := ticket.wait(ctx); err != nil {
		s.finishLocalVideoJobFailure(ctx, jobID, err)
		return
	}
	var schedulerRelease func()
	defer func() {
		if schedulerRelease != nil {
			schedulerRelease()
		}
	}()
	onStart := func() error {
		release, err := s.acquireAsyncScenarioJobLease(ctx, effective.head.GetAppId(), "scenario_job_local_video")
		if err != nil {
			return err
		}
		if _, ok, transitionErr := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); transitionErr != nil {
			release()
			s.failScenarioJobPersistencePrecondition(jobID, scenarioJobRunningPersistenceFailedReason, transitionErr)
			return transitionErr
		} else if ok {
			schedulerRelease = release
			return nil
		}
		release()
		if err := ctx.Err(); err != nil {
			return &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: err}
		}
		return &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: context.Canceled}
	}

	progress := func(update localexecution.VideoExecutionProgress) {
		current, total := update.CurrentStep, update.TotalSteps
		if total <= 0 && update.FrameCount > 0 {
			current, total = update.FrameIndex, update.FrameCount
		}
		if total <= 0 {
			total = int32(effective.plan.FrameCount() + 1)
		}
		_, _ = s.updateScenarioJobProgress(jobID, current, total, videoJobProgressPercent(current, total))
	}
	rawCandidate, err := s.executeCapturedLocalVideo(ctx, effective, onStart, progress)
	if err != nil {
		s.finishLocalVideoJobFailure(ctx, jobID, err)
		return
	}
	if err := ctx.Err(); err != nil {
		s.finishLocalVideoJobFailure(ctx, jobID, err)
		return
	}
	encodeCurrent, encodeTotal := int32(effective.plan.FrameCount()), int32(effective.plan.FrameCount()+1)
	_, _ = s.updateScenarioJobProgress(jobID, encodeCurrent, encodeTotal, videoJobProgressPercent(encodeCurrent, encodeTotal))
	encoded, err := s.localVideoMedia.EncodeAndInspect(ctx, effective.plan, rawCandidate)
	if err != nil {
		s.finishLocalVideoJobFailure(ctx, jobID, localVideoMediaError(err))
		return
	}
	if err := ctx.Err(); err != nil {
		s.finishLocalVideoJobFailure(ctx, jobID, err)
		return
	}
	artifacts, err := localVideoArtifacts(effective, encoded)
	if err != nil {
		s.finishLocalVideoJobFailure(ctx, jobID, localVideoMediaError(err))
		return
	}
	_, err = s.storeAndAttachRuntimeJobArtifacts(ctx, jobID, effective.head, artifacts, func(candidates []*runtimev1.ScenarioArtifact) bool {
		_, ok, _ := s.transitionScenarioJob(
			jobID,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
			runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
			func(job *runtimev1.ScenarioJob) {
				job.Artifacts = cloneScenarioArtifacts(candidates)
				job.ProgressCurrentStep, job.ProgressTotalSteps, job.ProgressPercent = encodeTotal, encodeTotal, 100
				if rawCandidate.ComputeMS > 0 {
					job.Usage = &runtimev1.UsageStats{ComputeMs: rawCandidate.ComputeMS}
				}
				job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
				job.ReasonDetail = ""
				job.ReasonMetadata = nil
			},
		)
		return ok
	})
	if err != nil {
		if ctx.Err() != nil {
			s.finishLocalVideoJobFailure(ctx, jobID, ctx.Err())
			return
		}
		s.finishLocalVideoJobFailure(ctx, jobID, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, fmt.Errorf("local video artifact custody: %w", err), grpcerr.ReasonOptions{}))
	}
}

func (s *Service) finishLocalVideoJobFailure(ctx context.Context, jobID string, err error) {
	if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
		return
	}
	jobStatus := runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
	eventType := runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		reason = runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		jobStatus, eventType, reason = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	} else if errors.Is(ctx.Err(), context.Canceled) || errors.Is(err, context.Canceled) || status.Code(err) == codes.Canceled {
		jobStatus, eventType, reason = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED
	}
	_, _, _ = s.transitionScenarioJob(jobID, jobStatus, eventType, func(job *runtimev1.ScenarioJob) {
		job.Artifacts = nil
		job.ReasonCode = reason
		job.ReasonDetail = sanitizeScenarioJobReasonDetail(err, reason)
		job.ReasonMetadata = scenarioJobReasonMetadata(err, reason)
		if job.ProgressPercent >= 100 {
			job.ProgressPercent = 99
		}
	})
}

func videoJobProgressPercent(current int32, total int32) int32 {
	if total <= 0 || current <= 0 {
		return 0
	}
	if current >= total {
		return 99
	}
	return current * 100 / total
}
