package ai

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
)

func (s *Service) SubmitScenarioJob(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error) {
	ctx, releaseModelAssets := localexecution.WithModelAssetUseScope(ctx)
	defer releaseModelAssets()

	if req == nil || req.GetHead() == nil || req.GetSpec() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	// @nimi-authority: rule.nimi.runtime.service-operations.r066
	if req.GetHead().GetTimeoutMs() != 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	var ownerErr error
	req, ownerErr = s.normalizeSubmitScenarioJobOwner(ctx, req)
	if ownerErr != nil {
		return nil, ownerErr
	}
	mode := req.GetExecutionMode()
	if mode == runtimev1.ExecutionMode_EXECUTION_MODE_UNSPECIFIED {
		mode = runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB
	}
	if err := validateScenarioExecutionMode(req.GetScenarioType(), mode); err != nil {
		return nil, err
	}
	if mode != runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	ctx, releaseUnadoptedWork, workErr := s.admitJobSubmissionWork(ctx)
	if workErr != nil {
		return nil, workErr
	}
	defer releaseUnadoptedWork()
	s.reconcileExpiredScenarioResources()
	// Owner normalization cloned the request. Both Local and Cloud consume this
	// canonical content before mode validation, idempotency and resource selection.
	if video := req.GetSpec().GetVideoGenerate(); video != nil {
		video.Content = nimillm.VideoContentWithPrompt(video)
	}
	// Validate the route-neutral request before resolving any configured
	// resource. An invalid request must not touch a Local Loadout or Cloud
	// Connector merely to discover the error it already carries.
	if err := validateSubmitScenarioAsyncJobRequest(req); err != nil {
		return nil, err
	}
	ignored, err := classifyScenarioExtensions(req.GetScenarioType(), req.GetExtensions())
	if err != nil {
		return nil, err
	}
	var intentErr error
	ctx, intent, intentErr := s.resolveScenarioExecutionIntent(ctx, req.GetHead(), scenarioTargetCapability(req.GetScenarioType()))
	if intentErr != nil {
		return nil, intentErr
	}
	idempotencyScope, err := buildScenarioJobIdempotencyScope(ctx, req)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{
			Message: "scenario job idempotency scope is invalid",
		})
	}
	releaseIdentity, err := s.scenarioJobs.claimScenarioIdempotency(ctx, idempotencyScope)
	if err != nil {
		return nil, err
	}
	defer releaseIdentity()
	if idempotencyScope != "" {
		if existing, ok := s.scenarioJobs.getByIdempotency(idempotencyScope); ok {
			return &runtimev1.SubmitScenarioJobResponse{Job: existing}, nil
		}
	}
	if err := s.scenarioJobs.admitNewScenarioAction(); err != nil {
		return nil, err
	}
	ctx, releaseCapture, err := s.scenarioJobs.admitScenarioCapture(ctx)
	if err != nil {
		return nil, err
	}
	defer releaseCapture()
	ctx, intent, intentErr = s.captureScenarioExecutionIntent(ctx, req.GetHead(), scenarioTargetCapability(req.GetScenarioType()))
	if intentErr != nil {
		return nil, intentErr
	}
	localImage := req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE && intent.IsLocal()
	localVideo := req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE && intent.IsLocal()
	localMusic := (req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE || req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_TRANSCRIBE || req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_VOICE_CONVERT) && intent.IsLocal()
	localSpeech := (req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE ||
		req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE) && intent.IsLocal()
	if err := s.reportScenarioSpendDisclosure(ctx, req.GetHead(), req.GetScenarioType()); err != nil {
		return nil, err
	}

	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_SPEAKER_EMBED:
		if !intent.IsLocal() {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
		return s.submitLocalSpeakerEmbeddingScenarioJob(ctx, req, mode, ignored)
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_ANNOTATE:
		if !intent.IsLocal() {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
		return s.submitLocalAnnotationScenarioJob(ctx, req, mode, ignored)
	case runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_SEPARATE:
		if !intent.IsLocal() {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
		return s.submitLocalSpeechScenarioJob(ctx, req, mode, ignored)
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_FACE_SWAP:
		if !intent.IsLocal() {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
		return s.submitLocalVideoFaceSwapJob(ctx, req, mode, ignored)
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_FACE_SWAP:
		if !intent.IsLocal() {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
		return s.submitLocalFaceSwapJob(ctx, req, mode, ignored)
	case runtimev1.ScenarioType_SCENARIO_TYPE_VISION_LOCATE:
		if !intent.IsLocal() {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
		return s.submitLocalVisionScenarioJob(ctx, req, mode, ignored)
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE:
		return s.submitVoiceWorkflowJob(ctx, req, ignored)

	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		if localImage {
			return s.submitLocalImageScenarioJob(ctx, req, mode, ignored)
		}
		return s.submitScenarioAsyncJob(ctx, req, mode, ignored)

	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		if localVideo {
			return s.submitLocalVideoScenarioJob(ctx, req, mode, ignored)
		}
		return s.submitScenarioAsyncJob(ctx, req, mode, ignored)

	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		if localSpeech {
			return s.submitLocalSpeechScenarioJob(ctx, req, mode, ignored)
		}
		return s.submitScenarioAsyncJob(ctx, req, mode, ignored)

	case runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE, runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_TRANSCRIBE, runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_VOICE_CONVERT:
		if localMusic {
			return s.submitLocalMusicScenarioJob(ctx, req, mode, ignored)
		}
		if req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_TRANSCRIBE || req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_VOICE_CONVERT {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
		return s.submitScenarioAsyncJob(ctx, req, mode, ignored)

	case
		runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE:
		return s.submitScenarioAsyncJob(ctx, req, mode, ignored)
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}
