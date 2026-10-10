package ai

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
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
	jobCtx := newDetachedAsyncJobContext(ctx)
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, &authn.Identity{SubjectUserID: identity.SubjectUserID})
	}
	jobCtx, cancel := context.WithCancel(jobCtx)
	now := timestamppb.New(time.Now().UTC())
	jobID := ulid.Make().String()
	job := &runtimev1.ScenarioJob{
		JobId: jobID, ScenarioType: req.GetScenarioType(), Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		CreatedAt: now, UpdatedAt: now, ModelResolved: effective.modelResolved(), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, ProgressTotalSteps: int32(effective.plan.ImageCount() + 1),
		ExecutionMode: mode, Head: cloneScenarioHead(effective.head), TraceId: ulid.Make().String(),
		IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored), EffectiveInputIdentity: cloneLoadoutEffectiveInputIdentity(effective.effectiveInputIdentity),
	}
	stored, created, persistErr := s.scenarioJobs.createOwnedAndBindCapturedInputsChecked(job, cancel, localAppJobOwnerFromContext(ctx), idempotencyScope, effective.resolvedAssembly, nil, false, localAppMusicSubmissionFromContext(ctx))
	if persistErr != nil {
		cancel()
		return nil, scenarioJobSubmissionError(persistErr, "ScenarioJob submission could not be persisted")
	}
	if stored == nil {
		cancel()
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if !created {
		cancel()
		return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
	}
	ticket := s.localImageJobOrder.reserve()
	go s.runLocalImageScenarioJob(jobCtx, jobID, ticket)
	return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
}

func (s *Service) runLocalImageScenarioJob(ctx context.Context, jobID string, ticket *localMediaSubmissionTicket) {
	if ticket != nil {
		defer ticket.release()
	}
	if !s.scenarioJobs.startExecution(jobID) {
		return
	}
	defer s.finishScenarioJobExecution(jobID)
	budget := newScenarioJobExecutionBudget(ctx)
	ctx = budget
	defer budget.close()
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
		s.finishLocalImageJobFailure(ctx, jobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		return
	}
	effective, err := s.localImageEffectiveInputsFromResolvedAssembly(assembly)
	if err != nil {
		s.finishLocalImageJobFailure(ctx, jobID, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "captured local image assembly is invalid"}))
		return
	}
	effective.head = cloneScenarioHead(job.GetHead())
	if err := ticket.wait(ctx); err != nil {
		s.finishLocalImageJobFailure(ctx, jobID, err)
		return
	}
	slots := make([]runtimeartifact.JobBodySlot, effective.plan.ImageCount())
	artifacts := make([]*runtimev1.ScenarioArtifact, len(slots))
	for index := range slots {
		slots[index] = runtimeartifact.JobBodySlot{ArtifactID: fmt.Sprintf("%s-image-%d", jobID, index+1), MaxBytes: localexecution.MaxImageArtifactBytes}
	}
	total := int32(effective.plan.ImageCount() + 1)
	var schedulerRelease func()
	defer func() {
		if schedulerRelease != nil {
			schedulerRelease()
		}
	}()
	onStart := func() error {
		release, err := s.acquireAsyncScenarioJobLease(ctx, effective.head.GetAppId(), "scenario_job_local_image")
		if err != nil {
			return err
		}
		if err := s.prepareScenarioBodySlots(ctx, jobID, slots); err != nil {
			release()
			if errors.Is(err, runtimeartifact.ErrJobBodyCapacity) {
				return jobCapacityError(err)
			}
			return err
		}
		if _, ok, transitionErr := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, func(job *runtimev1.ScenarioJob) {
			job.ProgressTotalSteps = total
		}); transitionErr != nil {
			release()
			s.failScenarioJobPersistencePrecondition(jobID, scenarioJobRunningPersistenceFailedReason, transitionErr)
			return transitionErr
		} else if !ok {
			release()
			if err := ctx.Err(); err != nil {
				return &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: err}
			}
			return &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: context.Canceled}
		}
		schedulerRelease = release
		ticket.release()
		return budget.start(localImageExecutionResourceBudget)
	}
	progress := func(update localexecution.ImageExecutionProgress) {
		current := int32(0)
		switch update.Stage {
		case localexecution.ImageExecutionStageReady,
			localexecution.ImageExecutionStageReused,
			localexecution.ImageExecutionStageGenerating:
			current = 1
		case localexecution.ImageExecutionStageProduced:
			current = update.ArtifactIndex + 1
		}
		_, _ = s.updateScenarioJobProgress(jobID, current, total, imageJobProgressPercent(current, total))
	}
	onArtifact := func(produced localexecution.ImageArtifact) error {
		index := int(produced.Index) - 1
		if index < 0 || index >= len(artifacts) || artifacts[index] != nil || int64(len(produced.Bytes)) > localexecution.MaxImageArtifactBytes {
			return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		artifact := localImageArtifact(effective, produced)
		if artifact == nil {
			return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		artifact.ArtifactId = slots[index].ArtifactID
		store, ok := s.runtimeArtifacts.(runtimeartifact.JobBodyStore)
		if !ok {
			return fmt.Errorf("Job body custody owner unavailable")
		}
		owner := s.runtimeArtifactOwnerForJob(jobID, effective.head)
		if err := store.StageJobBody(ctx, artifact.GetArtifactId(), runtimeartifact.ArtifactRecord{ProducerJobID: jobID, Owner: owner, MimeType: artifact.GetMimeType(), SizeBytes: artifact.GetSizeBytes(), ContentSHA256: scenarioArtifactDigest(artifact)}, io.NopCloser(bytes.NewReader(produced.Bytes))); err != nil {
			return err
		}
		record, ok := store.JobBodyStat(jobID, artifact.GetArtifactId())
		if !ok {
			return fmt.Errorf("complete Local image candidate was not retained")
		}
		projectCommittedArtifactMetadata(artifact, record)
		artifacts[index] = artifact
		return nil
	}

	result, err := s.executeCapturedLocalImage(ctx, effective, onStart, onArtifact, progress)
	budget.stop()
	if err != nil {
		s.finishLocalImageJobFailure(ctx, jobID, err)
		return
	}
	snapshot, ok := s.scenarioJobs.get(jobID)
	if ok && isTerminalScenarioJobStatus(snapshot.GetStatus()) {
		return
	}
	if !ok || len(result.Artifacts) != len(artifacts) {
		s.finishLocalImageJobFailure(ctx, jobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		return
	}
	for _, artifact := range artifacts {
		if artifact == nil {
			s.finishLocalImageJobFailure(ctx, jobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
			return
		}
	}
	bound, err := bindRuntimeJobArtifacts(jobID, effective.head, artifacts)
	if err != nil {
		s.finishLocalImageJobFailure(ctx, jobID, err)
		return
	}
	_, _, _ = s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(job *runtimev1.ScenarioJob) {
		job.Artifacts = bound
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
		jobStatus, eventType, reason = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT, runtimev1.ReasonCode_AI_EXECUTION_RESOURCE_LIMIT_EXCEEDED
	} else if (errors.Is(ctx.Err(), context.Canceled) || status.Code(err) == codes.Canceled) && s.scenarioJobs.cancellationRequested(jobID) {
		jobStatus, eventType = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED
		if reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
			reason = runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED
		}
	}
	_, _, _ = s.transitionScenarioJob(jobID, jobStatus, eventType, func(job *runtimev1.ScenarioJob) {
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
