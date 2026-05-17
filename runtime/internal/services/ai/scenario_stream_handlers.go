package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
)

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
	if _, err := classifyScenarioExtensions(req.GetScenarioType(), req.GetExtensions()); err != nil {
		return err
	}
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
