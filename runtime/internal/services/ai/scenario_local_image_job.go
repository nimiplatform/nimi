package ai

import (
	"context"
	"errors"
	"fmt"
	"sync"
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

func (s *Service) submitLocalImageScenarioJob(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest, mode runtimev1.ExecutionMode, ignored []*runtimev1.IgnoredScenarioExtension) (*runtimev1.SubmitScenarioJobResponse, error) {
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

	// Capture precedes publication. The worker below never re-reads AIConfig,
	// local selection, binding, or LocalAsset state.
	effective, err := s.captureLocalImageEffectiveInputs(ctx, req.GetHead(), req.GetSpec().GetImageGenerate())
	if err != nil {
		return nil, err
	}
	release, acquireResult, err := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if err != nil {
		return nil, schedulerAcquireError(err)
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)

	jobCtx := context.Background()
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, identity)
	}
	timeout := scenarioJobTimeoutDuration(req, defaultGenerateImageTimeout, true)
	var cancel context.CancelFunc
	if timeout > 0 {
		jobCtx, cancel = context.WithTimeout(jobCtx, timeout)
	} else {
		jobCtx, cancel = context.WithCancel(jobCtx)
	}
	now := timestamppb.New(time.Now().UTC())
	jobID := ulid.Make().String()
	job := &runtimev1.ScenarioJob{
		JobId: jobID, ScenarioType: req.GetScenarioType(), Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		CreatedAt: now, UpdatedAt: now, ModelResolved: effective.modelResolved(), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, ProgressTotalSteps: int32(effective.plan.ImageCount() + 1),
		ExecutionMode: mode, Head: cloneScenarioHead(effective.head), TraceId: ulid.Make().String(),
		IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored),
	}
	stored := s.scenarioJobs.createOwned(job, cancel, localAppJobOwnerFromContext(ctx))
	if stored == nil {
		cancel()
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if idempotencyScope != "" {
		s.scenarioJobs.bindIdempotency(idempotencyScope, jobID)
	}
	go s.runLocalImageScenarioJob(jobCtx, jobID, effective)
	return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
}

func (s *Service) runLocalImageScenarioJob(ctx context.Context, jobID string, effective *localImageEffectiveInputs) {
	if effective == nil || !s.scenarioJobs.startExecution(jobID) {
		return
	}
	defer s.scenarioJobs.finishExecution(jobID)
	if _, ok := s.scenarioJobs.transition(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED,
		nil,
	); !ok {
		return
	}
	total := int32(effective.plan.ImageCount() + 1)
	var runningOnce sync.Once
	ensureRunning := func() {
		runningOnce.Do(func() {
			_, _ = s.scenarioJobs.transition(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, func(job *runtimev1.ScenarioJob) {
				job.ProgressTotalSteps = total
			})
		})
	}
	progress := func(update localexecution.ImageExecutionProgress) {
		ensureRunning()
		current := int32(0)
		switch update.Stage {
		case localexecution.ImageExecutionStageReady,
			localexecution.ImageExecutionStageReused,
			localexecution.ImageExecutionStageGenerating:
			current = 1
		case localexecution.ImageExecutionStageProduced:
			current = update.ArtifactIndex + 1
		}
		_, _ = s.scenarioJobs.updateProgress(jobID, current, total, imageJobProgressPercent(current, total))
	}
	onArtifact := func(produced localexecution.ImageArtifact) error {
		artifact := localImageArtifact(effective, produced)
		if artifact == nil {
			return fmt.Errorf("local image artifact projection failed")
		}
		ensureRunning()
		current := produced.Index + 1
		_, err := s.storeAndAttachRuntimeJobArtifact(ctx, jobID, effective.head, artifact, func(candidate *runtimev1.ScenarioArtifact) bool {
			_, ok := s.scenarioJobs.commitArtifact(jobID, candidate, current, total, imageJobProgressPercent(current, total))
			return ok
		})
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return fmt.Errorf("local image job artifact commit: %w", err)
		}
		return nil
	}

	result, err := s.executeCapturedLocalImage(ctx, effective, onArtifact, progress)
	if err != nil {
		s.finishLocalImageJobFailure(ctx, jobID, err)
		return
	}
	snapshot, ok := s.scenarioJobs.get(jobID)
	if ok && isTerminalScenarioJobStatus(snapshot.GetStatus()) {
		return
	}
	if !ok || len(snapshot.GetArtifacts()) != effective.plan.ImageCount() || len(result.Artifacts) != len(snapshot.GetArtifacts()) {
		s.finishLocalImageJobFailure(ctx, jobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		return
	}
	_, _ = s.scenarioJobs.transition(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(job *runtimev1.ScenarioJob) {
		job.ProgressCurrentStep, job.ProgressTotalSteps, job.ProgressPercent = total, total, 100
		job.Usage = localImageUsage(result)
		job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		job.ReasonDetail = ""
		job.ReasonMetadata = nil
	})
}

func (s *Service) finishLocalImageJobFailure(ctx context.Context, jobID string, err error) {
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
	} else if errors.Is(ctx.Err(), context.Canceled) || status.Code(err) == codes.Canceled {
		jobStatus, eventType = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED
		if reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
			reason = runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED
		}
	}
	_, _ = s.scenarioJobs.transition(jobID, jobStatus, eventType, func(job *runtimev1.ScenarioJob) {
		job.ReasonCode = reason
		job.ReasonDetail = sanitizeScenarioJobReasonDetail(err, reason)
		job.ReasonMetadata = scenarioJobReasonMetadata(err, reason)
		if job.ProgressPercent >= 100 {
			job.ProgressPercent = 99
		}
	})
}

func imageJobProgressPercent(current int32, total int32) int32 {
	if total <= 0 || current <= 0 {
		return 0
	}
	if current >= total {
		return 99
	}
	return current * 100 / total
}
