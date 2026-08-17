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

	// Exact Cloud implementation, Driver target, defaults, and request
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
	snapshot, created, persistErr := s.scenarioJobs.createOwnedAndBindCloudAssemblyChecked(job, cancel, localAppJobOwnerFromContext(ctx), idempotencyScope, effective.resolvedAssembly)
	if persistErr != nil {
		cancel()
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, persistErr, grpcerr.ReasonOptions{
			Message: "ScenarioJob submission could not be persisted",
		})
	}
	if snapshot == nil {
		cancel()
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if !created {
		cancel()
		return &runtimev1.SubmitScenarioJobResponse{Job: snapshot}, nil
	}
	effective.release()
	captureOwned = false
	go s.executeCloudTextScenarioJob(jobCtx, jobID)
	return &runtimev1.SubmitScenarioJobResponse{Job: snapshot}, nil
}

func (s *Service) executeCloudTextScenarioJob(ctx context.Context, jobID string) {
	if !s.scenarioJobs.startExecution(jobID) {
		return
	}
	defer s.finishScenarioJobExecution(jobID)
	assembly, ok := s.scenarioJobs.cloudResolvedAssembly(jobID)
	if !ok {
		s.failScenarioJobPersistencePrecondition(jobID, "scenario-job-cloud-inputs-missing", nil)
		return
	}
	effective, err := s.cloudTextEffectiveInputsFromResolvedAssembly(assembly)
	if err != nil {
		s.finishCloudScenarioJobFailure(ctx, jobID, err)
		return
	}
	defer effective.release()
	if _, ok, transitionErr := s.transitionScenarioJob(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED,
		nil,
	); transitionErr != nil {
		s.failScenarioJobPersistencePrecondition(jobID, scenarioJobQueuedPersistenceFailedReason, transitionErr)
		return
	} else if !ok {
		return
	}
	release, err := s.acquireAsyncScenarioJobLease(ctx, effective.appID, "scenario_job_cloud_text")
	if err != nil {
		s.finishCloudScenarioJobFailure(ctx, jobID, err)
		return
	}
	defer release()
	if _, ok, transitionErr := s.transitionScenarioJob(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING,
		func(job *runtimev1.ScenarioJob) {
			job.ProgressCurrentStep = 0
			job.ProgressTotalSteps = 1
			job.ProgressPercent = 0
		},
	); transitionErr != nil {
		s.failScenarioJobPersistencePrecondition(jobID, scenarioJobRunningPersistenceFailedReason, transitionErr)
		return
	} else if !ok {
		return
	}

	result, err := s.executeCapturedCloudText(ctx, effective)
	if err != nil {
		s.finishCloudScenarioJobFailure(ctx, jobID, err)
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
		_, _, _ = s.transitionScenarioJob(
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
	_, _, _ = s.transitionScenarioJob(
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

func (s *Service) finishCloudScenarioJobFailure(ctx context.Context, jobID string, err error) {
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
	case errors.Is(ctx.Err(), context.Canceled) || errors.Is(err, context.Canceled) || status.Code(err) == codes.Canceled:
		jobStatus = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
		eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED
		reason = runtimev1.ReasonCode_ACTION_EXECUTED
	}
	_, _, _ = s.transitionScenarioJob(jobID, jobStatus, eventType, func(job *runtimev1.ScenarioJob) {
		job.ReasonCode = reason
		job.ReasonDetail = sanitizeScenarioJobReasonDetail(err, reason)
		if jobStatus == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
			job.ReasonMetadata = nil
		} else {
			job.ReasonMetadata = scenarioJobReasonMetadata(err, reason)
		}
	})
}
