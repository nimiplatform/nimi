package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) submitCloudTextScenarioJob(
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

	// Exact Cloud implementation, Driver target, grant, defaults, and request
	// are fixed before the job is visible. No credential is opened here.
	effective, err := s.captureCloudTextEffectiveInputs(ctx, req.GetHead(), req, runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB)
	if err != nil {
		return nil, err
	}
	captureOwned := true
	defer func() {
		if captureOwned {
			effective.release()
		}
	}()

	jobCtx := newDetachedAsyncJobContext(ctx)
	timeout, err := scenarioJobTimeoutDuration(req, defaultTextGenerateJobTimeout, false)
	if err != nil {
		return nil, err
	}
	var cancel context.CancelFunc
	if timeout > 0 {
		jobCtx, cancel = context.WithTimeout(jobCtx, timeout)
	} else {
		jobCtx, cancel = context.WithCancel(jobCtx)
	}
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, &authn.Identity{SubjectUserID: identity.SubjectUserID})
	}

	jobID := ulid.Make().String()
	now := timestamppb.New(time.Now().UTC())
	job := &runtimev1.ScenarioJob{
		JobId:             jobID,
		Head:              cloneScenarioHead(req.GetHead()),
		ScenarioType:      runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode:     mode,
		RouteDecision:     runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ModelResolved:     effective.modelResolved(),
		Status:            runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt:         now,
		UpdatedAt:         now,
		TraceId:           effective.traceID,
		IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored),
	}
	snapshot := s.scenarioJobs.createOwned(job, cancel, localAppJobOwnerFromContext(ctx))
	if snapshot == nil {
		cancel()
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if idempotencyScope != "" {
		s.scenarioJobs.bindIdempotency(idempotencyScope, jobID)
	}
	captureOwned = false
	go s.executeCloudTextScenarioJob(jobCtx, jobID, effective)
	return &runtimev1.SubmitScenarioJobResponse{Job: snapshot}, nil
}

func (s *Service) executeCloudTextScenarioJob(ctx context.Context, jobID string, effective *cloudTextEffectiveInputs) {
	if effective == nil || !s.scenarioJobs.startExecution(jobID) {
		return
	}
	defer s.scenarioJobs.finishExecution(jobID)
	defer effective.release()
	if _, ok := s.scenarioJobs.transition(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED,
		nil,
	); !ok {
		return
	}
	release, err := s.acquireAsyncScenarioJobLease(ctx, effective.appID, "scenario_job_cloud_text")
	if err != nil {
		s.finishCloudTextScenarioJobFailure(ctx, jobID, err)
		return
	}
	defer release()
	if _, ok := s.scenarioJobs.transition(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING,
		func(job *runtimev1.ScenarioJob) {
			job.ProgressCurrentStep = 0
			job.ProgressTotalSteps = 1
			job.ProgressPercent = 0
		},
	); !ok {
		return
	}

	result, err := s.executeCapturedCloudText(ctx, effective)
	if err != nil {
		s.finishCloudTextScenarioJobFailure(ctx, jobID, err)
		return
	}
	if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
		return
	}
	artifact := nimillm.BinaryArtifact("text/plain; charset=utf-8", []byte(result.Text), map[string]any{
		"finish_reason": result.FinishReason.String(),
	})
	artifacts := []*runtimev1.ScenarioArtifact{artifact}
	if err := s.storeRuntimeArtifacts(artifacts); err != nil {
		_, _ = s.scenarioJobs.transition(
			jobID,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
			runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED,
			func(job *runtimev1.ScenarioJob) {
				job.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
				job.ReasonDetail = strings.TrimSpace(err.Error())
				job.ReasonMetadata = nil
			},
		)
		return
	}
	_, _ = s.scenarioJobs.transition(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		func(job *runtimev1.ScenarioJob) {
			job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
			job.ReasonDetail = ""
			job.ReasonMetadata = nil
			job.ProgressCurrentStep = 1
			job.ProgressTotalSteps = 1
			job.ProgressPercent = 100
			job.Artifacts = cloneScenarioArtifacts(artifacts)
			job.Usage = result.Usage
		},
	)
}

func (s *Service) finishCloudTextScenarioJobFailure(ctx context.Context, jobID string, err error) {
	if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
		return
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		reason = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	}
	jobStatus := runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
	eventType := runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) || reason == runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT:
		jobStatus = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT
		eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT
		reason = runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	case errors.Is(err, context.Canceled) || status.Code(err) == codes.Canceled:
		jobStatus = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
		eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED
	}
	_, _ = s.scenarioJobs.transition(jobID, jobStatus, eventType, func(job *runtimev1.ScenarioJob) {
		job.ReasonCode = reason
		job.ReasonDetail = sanitizeScenarioJobReasonDetail(err, reason)
		job.ReasonMetadata = scenarioJobReasonMetadata(err, reason)
	})
}
