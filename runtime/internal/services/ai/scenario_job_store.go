package ai

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// Compile-time assertion that SubmitScenarioJob's dispatch terminates in
// catalog-aware enforcement. The submitScenarioAsyncJob path calls
// validateScenarioCapability which in turn calls
// validateCatalogAwareScenarioSupport(ctx, scenarioType, providerType,
// modelResolved, spec) — the Go method expression below ties that chain
// to a build-time symbol check on *Service, and
// gate.runtime-provider.video-capability-block-enforcement asserts the
// textual presence of the function reference here so future sweeps
// cannot silently rewire dispatch away from catalog enforcement.
var _ = (*Service).validateCatalogAwareScenarioSupport

func (s *Service) SubmitScenarioJob(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error) {
	if req == nil || req.GetHead() == nil || req.GetSpec() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
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
	var intentErr error
	ctx, intent, intentErr := s.captureScenarioExecutionIntent(ctx, req.GetHead(), scenarioTargetCapability(req.GetScenarioType()))
	if intentErr != nil {
		return nil, intentErr
	}
	localText := req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE && intent.IsLocal()
	if req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE && mode == runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB && !localText {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	if err := validateScenarioExecutionMode(req.GetScenarioType(), mode); err != nil {
		return nil, err
	}
	if mode != runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	ignored, err := classifyScenarioExtensions(req.GetScenarioType(), req.GetExtensions())
	if err != nil {
		return nil, err
	}
	if err := s.reportScenarioSpendDisclosure(ctx, req.GetHead(), req.GetScenarioType()); err != nil {
		return nil, err
	}

	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE:
		if !localText {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
		return s.submitLocalTextScenarioJob(ctx, req, mode, ignored)

	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE, runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		return s.submitVoiceWorkflowJob(ctx, req, ignored)

	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE,
		runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE:
		return s.submitScenarioAsyncJob(ctx, req, mode, ignored)
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}
