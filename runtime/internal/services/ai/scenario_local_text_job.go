package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) submitLocalTextScenarioJob(
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

	// This is the immutable capture point. The goroutine below never resolves
	// selection, AIConfig, portable config, or binding paths again.
	effective, err := s.captureLocalTextEffectiveInputs(ctx, req.GetHead(), req.GetSpec().GetTextGenerate(), false)
	if err != nil {
		return nil, err
	}
	captureOwned := true
	defer func() {
		if captureOwned {
			effective.release()
		}
	}()

	jobCtx := context.Background()
	timeout, err := scenarioJobTimeoutDuration(req, defaultTextGenerateJobTimeout, true)
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
		jobCtx = authn.WithIdentity(jobCtx, identity)
	}

	jobID := ulid.Make().String()
	now := timestamppb.New(time.Now().UTC())
	job := &runtimev1.ScenarioJob{
		JobId:                  jobID,
		Head:                   cloneScenarioHead(req.GetHead()),
		ScenarioType:           runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode:          mode,
		RouteDecision:          runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		ModelResolved:          effective.modelResolved(),
		Status:                 runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		ReasonCode:             runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt:              now,
		UpdatedAt:              now,
		TraceId:                ulid.Make().String(),
		IgnoredExtensions:      cloneIgnoredScenarioExtensions(ignored),
		EffectiveInputIdentity: effective.effectiveInputIdentity,
	}
	snapshot, created, persistErr := s.scenarioJobs.createOwnedAndBindAssemblyChecked(job, cancel, localAppJobOwnerFromContext(ctx), idempotencyScope, effective.resolvedAssembly)
	if persistErr != nil {
		cancel()
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, persistErr, grpcerr.ReasonOptions{
			Message: "captured ResolvedAssembly and ScenarioJob could not be committed atomically",
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
	cleanup := effective.cleanup
	effective.cleanup = nil
	captureOwned = false
	go func() {
		if cleanup != nil {
			defer cleanup()
		}
		s.executeLocalTextScenarioJob(jobCtx, jobID)
	}()
	return &runtimev1.SubmitScenarioJobResponse{Job: snapshot}, nil
}

func (s *Service) executeLocalTextScenarioJob(
	ctx context.Context,
	jobID string,
) {
	if !s.scenarioJobs.startExecution(jobID) {
		return
	}
	defer s.finishScenarioJobExecution(jobID)
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
	job, ok := s.scenarioJobs.get(jobID)
	if !ok || job.GetHead() == nil {
		return
	}
	assembly, ok := s.scenarioJobs.resolvedAssembly(jobID)
	if !ok {
		s.finishLocalTextScenarioJobFailure(ctx, jobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		return
	}
	effective, err := s.localTextEffectiveInputsFromResolvedAssembly(assembly)
	if err != nil {
		s.finishLocalTextScenarioJobFailure(ctx, jobID, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "captured local text assembly is invalid"}))
		return
	}
	release, err := s.acquireAsyncScenarioJobLease(ctx, job.GetHead().GetAppId(), "scenario_job_local_text")
	if err != nil {
		s.finishLocalTextScenarioJobFailure(ctx, jobID, err)
		return
	}
	defer release()
	if _, ok, transitionErr := s.transitionScenarioJob(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING,
		func(job *runtimev1.ScenarioJob) {
			job.ProgressCurrentStep = 0
			job.ProgressTotalSteps = 2
			job.ProgressPercent = 0
		},
	); transitionErr != nil {
		s.failScenarioJobPersistencePrecondition(jobID, scenarioJobRunningPersistenceFailedReason, transitionErr)
		return
	} else if !ok {
		return
	}
	progress := func(stage localexecution.TextExecutionProgress) {
		switch stage {
		case localexecution.TextExecutionProgressLoading:
			_, _ = s.updateScenarioJobProgress(jobID, 0, 2, 0)
		case localexecution.TextExecutionProgressReady, localexecution.TextExecutionProgressReused:
			_, _ = s.updateScenarioJobProgress(jobID, 1, 2, 50)
		}
	}
	result, err := s.executeCapturedLocalText(ctx, effective, progress)
	if err != nil {
		s.finishLocalTextScenarioJobFailure(ctx, jobID, err)
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
			job.ProgressCurrentStep = 2
			job.ProgressTotalSteps = 2
			job.ProgressPercent = 100
			job.Artifacts = cloneScenarioArtifacts(artifacts)
			job.Usage = localTextUsage(result, effective.request)
		},
	)
}

func (s *Service) finishLocalTextScenarioJobFailure(ctx context.Context, jobID string, err error) {
	if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
		return
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		reason = runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED
	}
	jobStatus := runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
	eventType := runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) || reason == runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT:
		jobStatus = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT
		eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT
		reason = runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	case errors.Is(err, context.Canceled) || status.Code(err) == codes.Canceled || reason == runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED:
		jobStatus = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
		eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED
	}
	_, _, _ = s.transitionScenarioJob(jobID, jobStatus, eventType, func(job *runtimev1.ScenarioJob) {
		job.ReasonCode = reason
		job.ReasonDetail = sanitizeScenarioJobReasonDetail(err, reason)
		job.ReasonMetadata = scenarioJobReasonMetadata(err, reason)
	})
}
