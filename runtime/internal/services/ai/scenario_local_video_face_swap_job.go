package ai

import (
	"context"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

func (s *Service) submitLocalVideoFaceSwapJob(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest, mode runtimev1.ExecutionMode, ignored []*runtimev1.IgnoredScenarioExtension) (*runtimev1.SubmitScenarioJobResponse, error) {
	assembly, identity, displayName, err := s.captureLocalVideoFaceSwapInputs(ctx, req.Head, req.GetSpec().GetVideoFaceSwap())
	if err != nil {
		return nil, err
	}
	return s.submitCapturedFaceSwapJob(ctx, req, mode, ignored, assembly, identity, displayName, s.runLocalVideoFaceSwapJob)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.face-swap-video-job
func (s *Service) runLocalVideoFaceSwapJob(ctx context.Context, jobID string, ticket *localMediaSubmissionTicket) {
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
	plan, err := videoFaceSwapPlanFromResolvedAssembly(assembly)
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
	slots := []runtimeartifact.JobBodySlot{{ArtifactID: jobID + "-face-result", MaxBytes: int64(localexecution.MaxFaceSwapVideoOutputBytes)}}
	onStart := func() error {
		release, err := s.acquireAsyncScenarioJobLease(ctx, job.GetHead().GetAppId(), "scenario_job_video_face_swap")
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
		return budget.start(900 * time.Second)
	}
	result, err := s.localFaceSwapHost.ExecuteVideoFaceSwap(ctx, plan, onStart, func(done, total int32) {
		_, _ = s.updateScenarioJobProgress(jobID, done, total+1, videoJobProgressPercent(done, total+1))
	})
	budget.stop()
	if err != nil {
		fail(err)
		return
	}
	defer func() { _ = result.Body.Close() }()
	if err := ctx.Err(); err != nil {
		fail(err)
		return
	}
	artifact := &runtimev1.ScenarioArtifact{ArtifactId: ulid.Make().String(), MimeType: "video/mp4", SizeBytes: result.SizeBytes, Width: int32(result.Width), Height: int32(result.Height), Fps: int32(result.Summary.FrameRate), DurationMs: int64(result.Summary.DurationUs / 1000)}
	body, err := capabilitydriver.NewIncrementalArtifactBody(result.Body)
	if err != nil {
		fail(err)
		return
	}
	staged, err := s.stageFiniteMediaBodies(ctx, jobID, job.Head, slots, capabilitydriver.CloudMediaResult{Artifacts: []*runtimev1.ScenarioArtifact{artifact}, ArtifactBodies: map[string]*capabilitydriver.ArtifactBody{artifact.GetArtifactId(): body}})
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
		job.VideoFaceSwapSummary = proto.Clone(result.Summary).(*runtimev1.VideoFaceSwapSummary)

		job.ProgressCurrentStep, job.ProgressTotalSteps, job.ProgressPercent = int32(result.Summary.TotalFrames+1), int32(result.Summary.TotalFrames+1), 100
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
