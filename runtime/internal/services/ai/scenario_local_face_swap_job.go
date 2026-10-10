package ai

import (
	"context"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) submitLocalFaceSwapJob(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest, mode runtimev1.ExecutionMode, ignored []*runtimev1.IgnoredScenarioExtension) (*runtimev1.SubmitScenarioJobResponse, error) {
	assembly, identity, displayName, err := s.captureLocalFaceSwapInputs(ctx, req.Head, req.GetSpec().GetImageFaceSwap())
	if err != nil {
		return nil, err
	}
	return s.submitCapturedFaceSwapJob(ctx, req, mode, ignored, assembly, identity, displayName, s.runLocalFaceSwapJob)
}

func (s *Service) submitCapturedFaceSwapJob(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest, mode runtimev1.ExecutionMode, ignored []*runtimev1.IgnoredScenarioExtension, assembly *localResolvedAssembly, identity *runtimev1.LoadoutEffectiveInputIdentity, displayName string, run func(context.Context, string, *localMediaSubmissionTicket)) (*runtimev1.SubmitScenarioJobResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	scope, err := buildScenarioJobIdempotencyScope(ctx, req)
	if err != nil {
		return nil, err
	}
	jobCtx, cancel := context.WithCancel(newDetachedAsyncJobContext(ctx))
	now := timestamppb.Now()
	job := &runtimev1.ScenarioJob{JobId: ulid.Make().String(), Head: cloneScenarioHead(req.Head), ScenarioType: req.ScenarioType,
		ExecutionMode: mode, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, CreatedAt: now, UpdatedAt: now,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, ModelResolved: displayName, TraceId: ulid.Make().String(),
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, EffectiveInputIdentity: identity, IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored)}
	stored, created, err := s.scenarioJobs.createOwnedAndBindCapturedInputsChecked(job, cancel, localAppJobOwnerFromContext(ctx), scope, assembly, nil, false, localAppMusicSubmissionFromContext(ctx))
	if err != nil {
		cancel()
		return nil, scenarioJobSubmissionError(err, "Face replacement Job could not be persisted")
	}
	if !created {
		cancel()
		return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
	}
	ticket := s.localFaceSwapJobOrder.reserve()
	go run(jobCtx, job.JobId, ticket)
	return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.face-swap-output
func (s *Service) runLocalFaceSwapJob(ctx context.Context, jobID string, ticket *localMediaSubmissionTicket) {
	defer ticket.release()
	if !s.scenarioJobs.startExecution(jobID) {
		return
	}
	defer s.finishScenarioJobExecution(jobID)
	budget := newScenarioJobExecutionBudget(ctx)
	ctx = budget
	defer budget.close()
	fail := func(err error) {
		if _, typed := grpcerr.ExtractReasonCode(err); !typed {
			err = localImageExecutionError(err)
		}
		s.finishLocalImageJobFailure(ctx, jobID, err)
	}
	if _, ok, err := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED, nil); err != nil {
		s.failScenarioJobPersistencePrecondition(jobID, scenarioJobQueuedPersistenceFailedReason, err)
		return
	} else if !ok {
		return
	}
	assembly, ok := s.scenarioJobs.resolvedAssembly(jobID)
	if !ok {
		fail(grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		return
	}
	plan, err := faceSwapPlanFromResolvedAssembly(assembly)
	if err != nil {
		fail(err)
		return
	}
	if err := ticket.wait(ctx); err != nil {
		fail(err)
		return
	}
	job, ok := s.scenarioJobs.get(jobID)
	if !ok {
		return
	}
	var releaseScheduler func()
	var started time.Time
	defer func() {
		if releaseScheduler != nil {
			releaseScheduler()
		}
	}()
	slots := []runtimeartifact.JobBodySlot{{ArtifactID: jobID + "-face-result", MaxBytes: runtimeartifact.MaxCustodyBytes}}
	onStart := func() error {
		release, err := s.acquireAsyncScenarioJobLease(ctx, job.GetHead().GetAppId(), "scenario_job_image_face_swap")
		if err != nil {
			return err
		}
		if err := s.prepareScenarioBodySlots(ctx, jobID, slots); err != nil {
			release()
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
		releaseScheduler = release
		started = time.Now()
		ticket.release()
		return budget.start(120 * time.Second)
	}
	result, err := s.localFaceSwapHost.ExecuteImageFaceSwap(ctx, plan, onStart)
	budget.stop()
	if err != nil {
		fail(err)
		return
	}
	if err := ctx.Err(); err != nil {
		fail(err)
		return
	}
	if result.Index != 1 || result.MediaType != "image/png" || len(result.Bytes) == 0 {
		fail(grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		return
	}
	width, height, err := localexecution.FaceSwapImageSize(plan.TargetImage)
	if err != nil {
		fail(err)
		return
	}
	artifact := nimillm.BinaryArtifact("image/png", result.Bytes, nil)
	artifact.Width, artifact.Height = int32(width), int32(height)
	staged, err := s.stageFiniteMediaBodies(ctx, jobID, job.Head, slots, capabilitydriver.CloudMediaResult{Artifacts: []*runtimev1.ScenarioArtifact{artifact}, ArtifactBodies: nil})
	if err != nil {
		fail(err)
		return
	}
	capabilitydriver.CloseArtifactBodies(staged.ArtifactBodies)
	artifacts, err := bindRuntimeJobArtifacts(jobID, job.Head, staged.Artifacts)
	if err != nil {
		fail(err)
		return
	}
	_, _, err = s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(job *runtimev1.ScenarioJob) {
		job.Artifacts = artifacts

		job.ProgressCurrentStep, job.ProgressTotalSteps, job.ProgressPercent = 1, 1, 100
		job.ReasonCode, job.ReasonDetail = runtimev1.ReasonCode_ACTION_EXECUTED, ""
		job.ReasonMetadata = nil
		job.Usage = &runtimev1.UsageStats{ComputeMs: time.Since(started).Milliseconds()}
	})
	if err != nil {
		if s.scenarioJobs.hasResultCandidate(jobID) {
			s.setNativeObservationIssue(jobID, 0, err)
		} else {
			fail(err)
		}
	}

}
