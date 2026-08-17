package ai

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
)

type executionIntentScenarioStream struct {
	grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]
	ctx context.Context
}

func (s *executionIntentScenarioStream) Context() context.Context {
	if s == nil || s.ctx == nil {
		return context.Background()
	}
	return s.ctx
}

func (s *Service) StreamScenario(req *runtimev1.StreamScenarioRequest, stream grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]) error {
	if req == nil || req.GetHead() == nil || req.GetSpec() == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	mode := req.GetExecutionMode()
	if mode == runtimev1.ExecutionMode_EXECUTION_MODE_UNSPECIFIED {
		mode = runtimev1.ExecutionMode_EXECUTION_MODE_STREAM
	}
	if err := validateScenarioExecutionMode(req.GetScenarioType(), mode); err != nil {
		return err
	}
	if mode != runtimev1.ExecutionMode_EXECUTION_MODE_STREAM {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	defaultTimeout := defaultStreamTotalTimeout
	if req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
		defaultTimeout = defaultSynthesizeTimeout
	}
	if _, err := timeoutDuration(req.GetHead().GetTimeoutMs(), defaultTimeout); err != nil {
		return err
	}
	if _, err := classifyScenarioExtensions(req.GetScenarioType(), req.GetExtensions()); err != nil {
		return err
	}
	capturedCtx, _, err := s.captureScenarioExecutionIntent(stream.Context(), req.GetHead(), scenarioTargetCapability(req.GetScenarioType()))
	if err != nil {
		return err
	}
	stream = &executionIntentScenarioStream{ServerStreamingServer: stream, ctx: capturedCtx}
	if err := s.reportScenarioSpendDisclosure(stream.Context(), req.GetHead(), req.GetScenarioType()); err != nil {
		return err
	}

	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE:
		return streamTextGenerateScenario(s, req, stream)

	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return streamSpeechSynthesizeScenario(s, req, stream)
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}
