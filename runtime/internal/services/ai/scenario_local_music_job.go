package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) submitLocalMusicScenarioJob(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest, mode runtimev1.ExecutionMode, ignored []*runtimev1.IgnoredScenarioExtension) (*runtimev1.SubmitScenarioJobResponse, error) {
	if err := validateSubmitScenarioAsyncJobRequest(req); err != nil {
		return nil, err
	}
	timeout, err := scenarioJobTimeoutDuration(req, defaultLocalMusicJobTimeout, true)
	if err != nil {
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
	deadline := time.Now().Add(timeout)
	captureCtx, cancelCapture := context.WithDeadline(ctx, deadline)
	defer cancelCapture()
	var effective *localMusicEffectiveInputs
	if req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_TRANSCRIBE {
		effective, err = s.captureLocalMusicTranscription(captureCtx, req.GetHead(), req.GetSpec().GetMusicTranscribe())
	} else {
		effective, err = s.captureLocalMusicEffectiveInputs(captureCtx, req.GetHead(), req.GetSpec().GetMusicGenerate(), req.GetExtensions())
	}
	if err != nil {
		return nil, err
	}
	jobCtx := context.Background()
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, identity)
	}
	jobCtx, cancel := context.WithDeadline(jobCtx, deadline)
	now := timestamppb.New(time.Now().UTC())
	jobID := ulid.Make().String()
	job := &runtimev1.ScenarioJob{JobId: jobID, ScenarioType: req.GetScenarioType(), Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, CreatedAt: now, UpdatedAt: now, ModelResolved: effective.modelResolved(), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, ExecutionMode: mode, Head: cloneScenarioHead(effective.head), TraceId: ulid.Make().String(), IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored), EffectiveInputIdentity: cloneLoadoutEffectiveInputIdentity(effective.effectiveInputIdentity)}
	stored, created, persistErr := s.scenarioJobs.createOwnedAndBindCapturedInputsChecked(job, cancel, localAppJobOwnerFromContext(ctx), idempotencyScope, effective.resolvedAssembly, nil, false, localAppMusicSubmissionFromContext(ctx))
	if persistErr != nil || stored == nil {
		cancel()
		cleanupLocalMusicPlan(effective.plan)
		if persistErr != nil {
			if errors.Is(persistErr, errLocalAppSubmissionConflict) || errors.Is(persistErr, errMusicRecoveryCapacity) || errors.Is(persistErr, errMusicRecoveryExpired) {
				return nil, localAppSubmissionError(persistErr)
			}
			return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, persistErr, grpcerr.ReasonOptions{})
		}
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if !created {
		cancel()
		cleanupLocalMusicPlan(effective.plan)
		return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
	}
	ticket := s.localMusicJobOrder.reserve()
	go s.runLocalMusicScenarioJob(jobCtx, jobID, ticket)
	return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
}

func (s *Service) runLocalMusicScenarioJob(ctx context.Context, jobID string, ticket *localMediaSubmissionTicket) {
	if ticket != nil {
		defer ticket.release()
	}
	if !s.scenarioJobs.startExecution(jobID) {
		return
	}
	defer s.finishScenarioJobExecution(jobID)
	if _, ok, err := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED, nil); err != nil || !ok {
		if err != nil {
			s.failScenarioJobPersistencePrecondition(jobID, scenarioJobQueuedPersistenceFailedReason, err)
		}
		return
	}
	job, ok := s.scenarioJobs.get(jobID)
	if !ok || job.GetHead() == nil {
		return
	}
	assembly, ok := s.scenarioJobs.resolvedAssembly(jobID)
	if !ok {
		s.finishLocalMusicJobFailure(ctx, jobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		return
	}
	effective, err := s.localMusicEffectiveInputsFromResolvedAssembly(assembly)
	if err != nil {
		s.finishLocalMusicJobFailure(ctx, jobID, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{}))
		return
	}
	effective.head = cloneScenarioHead(job.GetHead())
	defer cleanupLocalMusicPlan(effective.plan)
	if err := ticket.wait(ctx); err != nil {
		s.finishLocalMusicJobFailure(ctx, jobID, err)
		return
	}
	var schedulerRelease func()
	defer func() {
		if schedulerRelease != nil {
			schedulerRelease()
		}
	}()
	onStart := func() error {
		release, err := s.acquireAsyncScenarioJobLease(ctx, effective.head.GetAppId(), "scenario_job_local_music")
		if err != nil {
			return err
		}
		if _, ok, transitionErr := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); transitionErr != nil || !ok {
			release()
			if transitionErr != nil {
				s.failScenarioJobPersistencePrecondition(jobID, scenarioJobRunningPersistenceFailedReason, transitionErr)
				return transitionErr
			}
			return &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: context.Canceled}
		}
		schedulerRelease = release
		ticket.release()
		return nil
	}
	result, err := s.executeCapturedLocalMusic(ctx, effective, onStart)
	if err != nil {
		s.finishLocalMusicJobFailure(ctx, jobID, err)
		return
	}
	if effective.plan.IsTranscription() {
		if err := s.commitLocalMusicTranscription(ctx, jobID, effective, result); err != nil {
			s.finishLocalMusicJobFailure(ctx, jobID, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{}))
		}
		return
	}
	validated, err := validateLocalMusicWAV(ctx, result, effective.plan)
	if err != nil {
		s.finishLocalMusicJobFailure(ctx, jobID, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{}))
		return
	}
	if err := s.commitLocalMusicGeneration(ctx, jobID, effective, result, validated); err != nil {
		s.finishLocalMusicJobFailure(ctx, jobID, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{}))
	}

}

func (s *Service) finishLocalMusicJobFailure(ctx context.Context, jobID string, err error) {
	if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
		return
	}
	jobStatus := runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
	eventType := runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		reason = runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || status.Code(err) == codes.DeadlineExceeded {
		jobStatus, eventType, reason = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	} else if errors.Is(ctx.Err(), context.Canceled) || status.Code(err) == codes.Canceled {
		jobStatus, eventType, reason = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED
	}
	_, _, _ = s.transitionScenarioJob(jobID, jobStatus, eventType, func(job *runtimev1.ScenarioJob) {
		job.ReasonCode = reason
		job.ReasonDetail = sanitizeScenarioJobReasonDetail(err, reason)
		job.ReasonMetadata = scenarioJobReasonMetadata(err, reason)
		job.ProgressPercent = 0
		job.ProgressCurrentStep = 0
		job.ProgressTotalSteps = 0
	})
}

type validatedLocalMusicWAV struct {
	Path       string
	SizeBytes  int64
	SHA256     string
	SampleRate int
	Channels   int
	Bits       int
	DurationMS int64
	FrameCount uint64
	DataOffset int64
}

func validateLocalMusicWAV(ctx context.Context, result localexecution.MusicResult, plan *capabilitydriver.MusicInvocationPlan) (validatedLocalMusicWAV, error) {
	if plan == nil || result.StagingWAVPath != plan.StagingWAVPath() {
		return validatedLocalMusicWAV{}, fmt.Errorf("music staging identity mismatch")
	}
	wav, err := inspectMusicWAV(ctx, result.StagingWAVPath)
	if err != nil {
		return validatedLocalMusicWAV{}, err
	}
	rate, channels, bits := plan.ExpectedWAVFormat()
	if wav.SampleRate != rate || wav.Channels != channels || bits != 32 {
		return validatedLocalMusicWAV{}, fmt.Errorf("music WAV differs from Driver output contract")
	}
	return wav, nil
}

func inspectMusicWAV(ctx context.Context, path string) (validatedLocalMusicWAV, error) {
	facts, err := audiomedia.InspectCanonical(ctx, path)
	if err != nil {
		return validatedLocalMusicWAV{}, err
	}
	file, err := os.Open(path)
	if err != nil {
		return validatedLocalMusicWAV{}, err
	}
	defer file.Close()
	hasher := sha256.New()
	buffer := make([]byte, 64<<10)
	for {
		if err := ctx.Err(); err != nil {
			return validatedLocalMusicWAV{}, err
		}
		n, err := file.Read(buffer)
		if n > 0 {
			_, _ = hasher.Write(buffer[:n])
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return validatedLocalMusicWAV{}, err
		}
	}
	return validatedLocalMusicWAV{Path: path, SizeBytes: facts.SizeBytes, SHA256: hex.EncodeToString(hasher.Sum(nil)), SampleRate: int(facts.SampleRateHz), Channels: int(facts.Channels), Bits: 32, DurationMS: int64(facts.DurationMilliseconds()), FrameCount: facts.FrameCount, DataOffset: facts.DataOffset}, nil
}

func localMusicArtifactBody(wav validatedLocalMusicWAV) (*runtimev1.ScenarioArtifact, *capabilitydriver.ArtifactBody, error) {
	file, err := os.Open(wav.Path)
	if err != nil {
		return nil, nil, err
	}
	body, err := capabilitydriver.NewIncrementalArtifactBody(file)
	if err != nil {
		_ = file.Close()
		return nil, nil, err
	}
	metadata, _ := structpb.NewStruct(map[string]any{"format": "pcm_f32le", "bits_per_sample": wav.Bits})
	return &runtimev1.ScenarioArtifact{ArtifactId: ulid.Make().String(), MimeType: "audio/wav", Sha256: wav.SHA256, SizeBytes: wav.SizeBytes, DurationMs: wav.DurationMS, SampleRateHz: int32(wav.SampleRate), Channels: int32(wav.Channels), FrameCount: wav.FrameCount, Metadata: metadata}, body, nil
}
