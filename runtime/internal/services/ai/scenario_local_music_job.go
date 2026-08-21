package ai

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
	timeout, err := scenarioJobTimeoutDuration(req, defaultGenerateMusicTimeout, true)
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
	effective, err := s.captureLocalMusicEffectiveInputs(ctx, req.GetHead(), req.GetSpec().GetMusicGenerate(), req.GetExtensions())
	if err != nil {
		return nil, err
	}
	jobCtx := context.Background()
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, identity)
	}
	jobCtx, cancel := context.WithTimeout(jobCtx, timeout)
	now := timestamppb.New(time.Now().UTC())
	jobID := ulid.Make().String()
	job := &runtimev1.ScenarioJob{JobId: jobID, ScenarioType: req.GetScenarioType(), Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, CreatedAt: now, UpdatedAt: now, ModelResolved: effective.modelResolved(), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, ExecutionMode: mode, Head: cloneScenarioHead(effective.head), TraceId: ulid.Make().String(), IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored), EffectiveInputIdentity: cloneLoadoutEffectiveInputIdentity(effective.effectiveInputIdentity)}
	stored, created, persistErr := s.scenarioJobs.createOwnedAndBindAssemblyChecked(job, cancel, localAppJobOwnerFromContext(ctx), idempotencyScope, effective.resolvedAssembly)
	if persistErr != nil || stored == nil {
		cancel()
		cleanupAudioMusicStaging(effective.plan.StagingWAVPath())
		if persistErr != nil {
			return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, persistErr, grpcerr.ReasonOptions{})
		}
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if !created {
		cancel()
		cleanupAudioMusicStaging(effective.plan.StagingWAVPath())
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
	defer cleanupAudioMusicStaging(effective.plan.StagingWAVPath())
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
	validated, err := validateLocalMusicWAV(result, effective.plan)
	if err != nil {
		s.finishLocalMusicJobFailure(ctx, jobID, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{}))
		return
	}
	artifact, body, err := localMusicArtifactBody(validated)
	if err != nil {
		s.finishLocalMusicJobFailure(ctx, jobID, err)
		return
	}
	_, err = s.storeAndAttachRuntimeJobArtifactBody(ctx, jobID, effective.head, artifact, body, func(candidate *runtimev1.ScenarioArtifact) bool {
		_, committed := s.commitScenarioJobArtifact(jobID, candidate, 0, 0, 0)
		return committed
	})
	if err != nil {
		s.finishLocalMusicJobFailure(ctx, jobID, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{}))
		return
	}
	_, _, _ = s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, func(job *runtimev1.ScenarioJob) {
		job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		job.Usage = &runtimev1.UsageStats{ComputeMs: result.ComputeMS}
		job.ProgressPercent = 0
		job.ProgressCurrentStep = 0
		job.ProgressTotalSteps = 0
	})
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
}

func validateLocalMusicWAV(result localexecution.MusicResult, plan *capabilitydriver.MusicInvocationPlan) (validatedLocalMusicWAV, error) {
	if plan == nil || result.StagingWAVPath != plan.StagingWAVPath() {
		return validatedLocalMusicWAV{}, fmt.Errorf("music staging identity mismatch")
	}
	file, err := os.Open(result.StagingWAVPath)
	if err != nil {
		return validatedLocalMusicWAV{}, err
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil || info.Size() < 44 {
		return validatedLocalMusicWAV{}, fmt.Errorf("music WAV is incomplete")
	}
	header := make([]byte, 12)
	if _, err := io.ReadFull(file, header); err != nil || string(header[:4]) != "RIFF" || string(header[8:12]) != "WAVE" || int64(binary.LittleEndian.Uint32(header[4:8]))+8 != info.Size() {
		return validatedLocalMusicWAV{}, fmt.Errorf("music WAV RIFF bounds are invalid")
	}
	var format, channels, bits uint16
	var sampleRate, byteRate, dataBytes uint32
	for filePosition := int64(12); filePosition+8 <= info.Size(); {
		chunk := make([]byte, 8)
		if _, err := io.ReadFull(file, chunk); err != nil {
			return validatedLocalMusicWAV{}, err
		}
		filePosition += 8
		size := binary.LittleEndian.Uint32(chunk[4:])
		if filePosition+int64(size) > info.Size() {
			return validatedLocalMusicWAV{}, fmt.Errorf("music WAV chunk exceeds file bounds")
		}
		if string(chunk[:4]) == "fmt " {
			payload := make([]byte, size)
			if _, err := io.ReadFull(file, payload); err != nil || len(payload) < 16 {
				return validatedLocalMusicWAV{}, fmt.Errorf("music WAV fmt is invalid")
			}
			format = binary.LittleEndian.Uint16(payload[:2])
			channels = binary.LittleEndian.Uint16(payload[2:4])
			sampleRate = binary.LittleEndian.Uint32(payload[4:8])
			byteRate = binary.LittleEndian.Uint32(payload[8:12])
			bits = binary.LittleEndian.Uint16(payload[14:16])
		} else {
			if string(chunk[:4]) == "data" {
				dataBytes = size
			}
			if _, err := file.Seek(int64(size), io.SeekCurrent); err != nil {
				return validatedLocalMusicWAV{}, err
			}
		}
		filePosition += int64(size)
		if size%2 == 1 {
			if _, err := file.Seek(1, io.SeekCurrent); err != nil {
				return validatedLocalMusicWAV{}, err
			}
			filePosition++
		}
	}
	expectedRate, expectedChannels, expectedBits := plan.ExpectedWAVFormat()
	if format != 1 || int(sampleRate) != expectedRate || int(channels) != expectedChannels || int(bits) != expectedBits || byteRate == 0 || dataBytes == 0 {
		return validatedLocalMusicWAV{}, fmt.Errorf("music WAV format does not match Driver contract")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return validatedLocalMusicWAV{}, err
	}
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return validatedLocalMusicWAV{}, err
	}
	return validatedLocalMusicWAV{Path: result.StagingWAVPath, SizeBytes: info.Size(), SHA256: hex.EncodeToString(hasher.Sum(nil)), SampleRate: int(sampleRate), Channels: int(channels), Bits: int(bits), DurationMS: int64(dataBytes) * 1000 / int64(byteRate)}, nil
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
	metadata, _ := structpb.NewStruct(map[string]any{"format": "pcm_s16le", "bits_per_sample": wav.Bits})
	return &runtimev1.ScenarioArtifact{ArtifactId: ulid.Make().String(), MimeType: "audio/wav", Sha256: wav.SHA256, SizeBytes: wav.SizeBytes, DurationMs: wav.DurationMS, SampleRateHz: int32(wav.SampleRate), Channels: int32(wav.Channels), Metadata: metadata}, body, nil
}
