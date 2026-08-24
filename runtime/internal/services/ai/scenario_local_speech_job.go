package ai

import (
	"context"
	"errors"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type localSpeechSubmissionOrder struct {
	mu     sync.Mutex
	active bool
	queue  []*localSpeechSubmissionTicket
}

type localSpeechSubmissionTicket struct {
	owner   *localSpeechSubmissionOrder
	ready   chan struct{}
	granted bool
	done    bool
}

func (s *Service) submitLocalSpeechScenarioJob(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest, mode runtimev1.ExecutionMode, ignored []*runtimev1.IgnoredScenarioExtension) (*runtimev1.SubmitScenarioJobResponse, error) {
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

	// Selection, exact bindings, request defaults, and transcription bytes are
	// fixed before the asynchronous Job becomes visible.
	effective, err := s.captureLocalSpeechEffectiveInputs(ctx, req.GetHead(), req)
	if err != nil {
		return nil, err
	}
	jobCtx := newDetachedAsyncJobContext(ctx)
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, &authn.Identity{SubjectUserID: identity.SubjectUserID})
	}
	timeout, err := scenarioJobTimeoutDuration(req, defaultLocalSpeechJobTimeout, true)
	if err != nil {
		cleanupLocalSpeechStagingPaths(effective.stagingPaths)
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
		JobId:                  jobID,
		Head:                   cloneScenarioHead(effective.head),
		ScenarioType:           req.GetScenarioType(),
		ExecutionMode:          mode,
		RouteDecision:          runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		ModelResolved:          effective.modelResolved(),
		Status:                 runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		ReasonCode:             runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt:              now,
		UpdatedAt:              now,
		TraceId:                ulid.Make().String(),
		ProgressTotalSteps:     1,
		IgnoredExtensions:      cloneIgnoredScenarioExtensions(ignored),
		EffectiveInputIdentity: cloneLoadoutEffectiveInputIdentity(effective.effectiveInputIdentity),
	}
	stored, created, persistErr := s.scenarioJobs.createOwnedAndBindAssemblyChecked(job, cancel, localAppJobOwnerFromContext(ctx), idempotencyScope, effective.resolvedAssembly)
	if persistErr != nil {
		cancel()
		cleanupLocalSpeechStagingPaths(effective.stagingPaths)
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, persistErr, grpcerr.ReasonOptions{
			Message: "ScenarioJob submission could not be persisted",
		})
	}
	if stored == nil {
		cancel()
		cleanupLocalSpeechStagingPaths(effective.stagingPaths)
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if !created {
		cancel()
		cleanupLocalSpeechStagingPaths(effective.stagingPaths)
		return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
	}
	ticket := s.localSpeechJobOrder.reserve()
	go s.runLocalSpeechScenarioJob(jobCtx, jobID, ticket)
	return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
}

func (s *Service) runLocalSpeechScenarioJob(ctx context.Context, jobID string, ticket *localSpeechSubmissionTicket) {
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
		s.finishLocalSpeechJobFailure(ctx, jobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		return
	}
	effective, err := s.localSpeechEffectiveInputsFromResolvedAssembly(assembly)
	if err != nil {
		s.finishLocalSpeechJobFailure(ctx, jobID, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "captured local speech assembly is invalid"}))
		return
	}
	effective.head = cloneScenarioHead(job.GetHead())
	defer cleanupLocalSpeechStagingPaths(effective.stagingPaths)
	_, err = ticket.wait(ctx)
	if err != nil {
		s.finishLocalSpeechJobFailure(ctx, jobID, err)
		return
	}
	release, acquireResult, err := s.scheduler.Acquire(ctx, effective.head.GetAppId())
	if err != nil {
		s.finishLocalSpeechJobFailure(ctx, jobID, schedulerAcquireError(err))
		return
	}
	defer release()
	s.attachQueueWait(ctx, acquireResult)
	s.logQueueWait("scenario_job_local_speech", effective.head.GetAppId(), acquireResult)
	onStart := func() error {
		if _, ok, transitionErr := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); transitionErr != nil {
			s.failScenarioJobPersistencePrecondition(jobID, scenarioJobRunningPersistenceFailedReason, transitionErr)
			return transitionErr
		} else if ok {
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		return context.Canceled
	}
	artifacts, bodies, usage, err := s.executeCapturedLocalSpeech(ctx, effective, onStart)
	if err != nil {
		s.finishLocalSpeechJobFailure(ctx, jobID, err)
		return
	}
	if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
		capabilitydriver.CloseArtifactBodies(bodies)
		return
	}
	bound, err := bindRuntimeJobArtifacts(jobID, effective.head, artifacts)
	var newCustodyIDs []string
	if err == nil {
		newCustodyIDs, err = s.storeRuntimeJobArtifacts(ctx, jobID, effective.head, bound, bodies)
	} else {
		capabilitydriver.CloseArtifactBodies(bodies)
	}
	transcriptionText := ""
	if err == nil {
		transcriptionText, err = s.captureScenarioTranscriptionText(ctx, effective.scenarioType, bound)
	}
	if err != nil {
		for _, artifactID := range newCustodyIDs {
			s.deleteRuntimeArtifactCandidate(artifactID, "local speech result capture failed")
		}
		s.finishLocalSpeechJobFailure(ctx, jobID, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED, err, grpcerr.ReasonOptions{}))
		return
	}
	if _, ok, _ := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(job *runtimev1.ScenarioJob) {
		job.Artifacts = cloneScenarioArtifacts(bound)
		job.TranscriptionText = transcriptionText
		job.Usage = usage
		job.ProgressCurrentStep = 1
		job.ProgressTotalSteps = 1
		job.ProgressPercent = 100
		job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		job.ReasonDetail = ""
		job.ReasonMetadata = nil
	}); !ok {
		for _, artifactID := range newCustodyIDs {
			s.deleteRuntimeArtifactCandidate(artifactID, "local speech job metadata attachment failed")
		}
	}
}

func (order *localSpeechSubmissionOrder) reserve() *localSpeechSubmissionTicket {
	ticket := &localSpeechSubmissionTicket{owner: order, ready: make(chan struct{})}
	order.mu.Lock()
	if !order.active && len(order.queue) == 0 {
		order.active = true
		ticket.granted = true
		close(ticket.ready)
	} else {
		order.queue = append(order.queue, ticket)
	}
	order.mu.Unlock()
	return ticket
}

func (ticket *localSpeechSubmissionTicket) wait(ctx context.Context) (func(), error) {
	if ticket == nil || ticket.owner == nil {
		return nil, context.Canceled
	}
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-ticket.ready:
		if err := ctx.Err(); err != nil {
			ticket.release()
			return nil, err
		}
	case <-ctx.Done():
		ticket.release()
		return nil, ctx.Err()
	}
	return ticket.release, nil
}

func (ticket *localSpeechSubmissionTicket) release() {
	if ticket == nil || ticket.owner == nil {
		return
	}
	order := ticket.owner
	order.mu.Lock()
	defer order.mu.Unlock()
	if ticket.done {
		return
	}
	ticket.done = true
	if !ticket.granted {
		for index, queued := range order.queue {
			if queued != ticket {
				continue
			}
			copy(order.queue[index:], order.queue[index+1:])
			order.queue[len(order.queue)-1] = nil
			order.queue = order.queue[:len(order.queue)-1]
			return
		}
		return
	}
	order.active = false
	if len(order.queue) == 0 {
		return
	}
	next := order.queue[0]
	copy(order.queue, order.queue[1:])
	order.queue[len(order.queue)-1] = nil
	order.queue = order.queue[:len(order.queue)-1]
	order.active = true
	next.granted = true
	close(next.ready)
}

func (s *Service) finishLocalSpeechJobFailure(ctx context.Context, jobID string, err error) {
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
		jobStatus = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT
		eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT
		reason = runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	} else if errors.Is(ctx.Err(), context.Canceled) || errors.Is(err, context.Canceled) || status.Code(err) == codes.Canceled {
		jobStatus = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
		eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED
		reason = runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED
	}
	_, _, _ = s.transitionScenarioJob(jobID, jobStatus, eventType, func(job *runtimev1.ScenarioJob) {
		job.ReasonCode = reason
		job.ReasonDetail = sanitizeScenarioJobReasonDetail(err, reason)
		if jobStatus == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
			job.ReasonMetadata = nil
		} else {
			job.ReasonMetadata = scenarioJobReasonMetadata(err, reason)
		}
		if job.ProgressPercent >= 100 {
			job.ProgressPercent = 99
		}
	})
}
