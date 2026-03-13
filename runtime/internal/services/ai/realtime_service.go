package ai

import (
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const realtimeServiceNotImplemented = "RuntimeAiRealtimeService is reserved for a future realtime session adapter"

func (s *Service) OpenRealtimeSession(context.Context, *runtimev1.OpenRealtimeSessionRequest) (*runtimev1.OpenRealtimeSessionResponse, error) {
	return nil, status.Error(codes.Unimplemented, realtimeServiceNotImplemented)
}

func (s *Service) AppendRealtimeInput(context.Context, *runtimev1.AppendRealtimeInputRequest) (*runtimev1.AppendRealtimeInputResponse, error) {
	return nil, status.Error(codes.Unimplemented, realtimeServiceNotImplemented)
}

func (s *Service) ReadRealtimeEvents(*runtimev1.ReadRealtimeEventsRequest, runtimev1.RuntimeAiRealtimeService_ReadRealtimeEventsServer) error {
	return status.Error(codes.Unimplemented, realtimeServiceNotImplemented)
}

func (s *Service) CloseRealtimeSession(context.Context, *runtimev1.CloseRealtimeSessionRequest) (*runtimev1.CloseRealtimeSessionResponse, error) {
	return nil, status.Error(codes.Unimplemented, realtimeServiceNotImplemented)
}
