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

	release, acquireResult, err := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if err != nil {
		return nil, schedulerAcquireError(err)
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)

	jobCtx := newDetachedAsyncJobContext(ctx)
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, &authn.Identity{SubjectUserID: identity.SubjectUserID})
	}
	timeout := scenarioJobTimeoutDuration(req, defaultGenerateVideoTimeout, true)
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
	}
	stored := s.scenarioJobs.create(job, cancel)
	if stored == nil {
		cancel()
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if idempotencyScope != "" {
		s.scenarioJobs.bindIdempotency(idempotencyScope, jobID)
	}
	go s.runLocalVideoScenarioJob(jobCtx, jobID, effective)
	return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
}

func (s *Service) runLocalVideoScenarioJob(ctx context.Context, jobID string, effective *localVideoEffectiveInputs) {
	if effective == nil || !s.scenarioJobs.startExecution(jobID) {
		return
	}
	defer s.scenarioJobs.finishExecution(jobID)
	if _, ok := s.scenarioJobs.transition(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED, nil); !ok {
		return
	}
	if _, ok := s.scenarioJobs.transition(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); !ok {
		return
	}

	progress := func(update localexecution.VideoExecutionProgress) {
		current, total := update.CurrentStep, update.TotalSteps
		if total <= 0 && update.FrameCount > 0 {
			current, total = update.FrameIndex, update.FrameCount
		}
		if total <= 0 {
			total = int32(effective.plan.FrameCount() + 1)
		}
		_, _ = s.scenarioJobs.updateProgress(jobID, current, total, videoJobProgressPercent(current, total))
	}
	rawCandidate, err := s.executeCapturedLocalVideo(ctx, effective, progress)
	if err != nil {
		s.finishLocalVideoJobFailure(ctx, jobID, err)
		return
	}
	if err := ctx.Err(); err != nil {
		s.finishLocalVideoJobFailure(ctx, jobID, err)
		return
	}
	encodeCurrent, encodeTotal := int32(effective.plan.FrameCount()), int32(effective.plan.FrameCount()+1)
	_, _ = s.scenarioJobs.updateProgress(jobID, encodeCurrent, encodeTotal, videoJobProgressPercent(encodeCurrent, encodeTotal))
	encoded, err := s.localVideoMedia.EncodeAndInspect(ctx, effective.plan, rawCandidate)
	if err != nil {
		s.finishLocalVideoJobFailure(ctx, jobID, localVideoMediaError(err))
		return
	}
	if err := ctx.Err(); err != nil {
		s.finishLocalVideoJobFailure(ctx, jobID, err)
		return
	}
	artifact, err := localVideoArtifact(effective, encoded)
	if err != nil {
		s.finishLocalVideoJobFailure(ctx, jobID, localVideoMediaError(err))
		return
	}
	_, err = s.storeAndAttachRuntimeJobArtifact(jobID, effective.head, artifact, func(candidate *runtimev1.ScenarioArtifact) bool {
		_, ok := s.scenarioJobs.transition(
			jobID,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
			runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
			func(job *runtimev1.ScenarioJob) {
				job.Artifacts = []*runtimev1.ScenarioArtifact{cloneScenarioArtifact(candidate)}
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
	_, _ = s.scenarioJobs.transition(jobID, jobStatus, eventType, func(job *runtimev1.ScenarioJob) {
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
