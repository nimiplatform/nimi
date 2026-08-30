package ai

import (
	"context"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r122
func runtimeRestartExecutionError() error {
	base := grpcerr.WithReasonCodeOptions(
		codes.Unavailable,
		runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED,
		grpcerr.ReasonOptions{Message: "Runtime restarted before execution completed"},
	)
	st, ok := status.FromError(base)
	if !ok {
		return base
	}
	detailed, err := st.WithDetails(runtimeRestartExecutionInterruption())
	if err != nil {
		return base
	}
	return detailed.Err()
}

func (s *Service) BeginRuntimeRestart() {
	if s != nil {
		s.runtimeRestarting.Store(true)
	}
}

func (s *Service) isRuntimeRestartShutdown(ctx context.Context) bool {
	return s != nil && s.runtimeRestarting.Load() && rpcctx.WasServerShutdown(ctx)
}

func (s *Service) projectRuntimeRestartExecutionError(ctx context.Context, err error) error {
	if err == nil || !s.isRuntimeRestartShutdown(ctx) {
		return err
	}
	if executionInterruptionFromError(err) != nil {
		return err
	}
	return runtimeRestartExecutionError()
}

func executionInterruptionFromError(err error) *runtimev1.ExecutionInterruption {
	st, ok := status.FromError(err)
	if !ok {
		return nil
	}
	for _, detail := range st.Details() {
		interruption, ok := detail.(*runtimev1.ExecutionInterruption)
		if !ok || interruption.GetCause() != runtimev1.ExecutionInterruptionCause_EXECUTION_INTERRUPTION_CAUSE_RUNTIME_RESTART ||
			interruption.GetResubmitDisposition() != runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_CALLER_MAY_RESUBMIT {
			continue
		}
		cloned, _ := proto.Clone(interruption).(*runtimev1.ExecutionInterruption)
		return cloned
	}
	return nil
}

type runtimeRestartScenarioStream struct {
	grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]
	service      *Service
	mu           sync.Mutex
	lastSequence uint64
	traceID      string
	terminal     bool
}

func newRuntimeRestartScenarioStream(service *Service, stream grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]) *runtimeRestartScenarioStream {
	return &runtimeRestartScenarioStream{ServerStreamingServer: stream, service: service}
}

func (stream *runtimeRestartScenarioStream) Send(event *runtimev1.StreamScenarioEvent) error {
	if stream == nil || stream.ServerStreamingServer == nil || event == nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	stream.mu.Lock()
	defer stream.mu.Unlock()
	if stream.terminal {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if err := stream.ServerStreamingServer.Send(event); err != nil {
		return err
	}
	if event.GetSequence() > stream.lastSequence {
		stream.lastSequence = event.GetSequence()
	}
	if event.GetTraceId() != "" {
		stream.traceID = event.GetTraceId()
	}
	if event.GetEventType() == runtimev1.StreamEventType_STREAM_EVENT_COMPLETED ||
		event.GetEventType() == runtimev1.StreamEventType_STREAM_EVENT_FAILED {
		stream.terminal = true
	}
	return nil
}

func (stream *runtimeRestartScenarioStream) finish(err error) error {
	if err == nil || stream == nil || !stream.service.isRuntimeRestartShutdown(stream.Context()) {
		return err
	}
	stream.mu.Lock()
	terminal := stream.terminal
	sequence := stream.lastSequence + 1
	traceID := stream.traceID
	stream.mu.Unlock()
	if terminal {
		return err
	}
	interruptionErr := runtimeRestartExecutionError()
	failure := &runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_FAILED,
		Sequence:  sequence,
		TraceId:   traceID,
		Timestamp: timestamppb.New(time.Now().UTC()),
		Payload: &runtimev1.StreamScenarioEvent_Failed{Failed: &runtimev1.ScenarioStreamFailed{
			ReasonCode:   runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED,
			ActionHint:   actionHintFromStreamError(interruptionErr),
			Interruption: executionInterruptionFromError(interruptionErr),
		}},
	}
	if sendErr := stream.Send(failure); sendErr != nil {
		return interruptionErr
	}
	return nil
}
