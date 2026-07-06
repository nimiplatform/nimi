package runtimeagent

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// K-AGCORE-144..150 Runtime Agent execution config RPC surface. The config is
// runtime-instance-scoped committed state: authz (runtime.agent.
// execution_config.read/write) is enforced by the gRPC interceptor scope map,
// and the handlers enforce payload admission fail-closed.

func (s *Service) GetAgentExecutionConfig(_ context.Context, req *runtimev1.GetAgentExecutionConfigRequest) (*runtimev1.GetAgentExecutionConfigResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "get agent execution config request is required")
	}
	if s.isClosed() {
		return nil, status.Error(codes.Unavailable, "runtime agent service is closed")
	}
	config, err := s.committedExecutionConfig()
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetAgentExecutionConfigResponse{Config: cloneExecutionConfig(config)}, nil
}

func (s *Service) UpsertAgentExecutionConfig(_ context.Context, req *runtimev1.UpsertAgentExecutionConfigRequest) (*runtimev1.UpsertAgentExecutionConfigResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "upsert agent execution config request is required")
	}
	config, err := s.upsertExecutionConfig(req.GetContext().GetAppId(), req.GetExpectedRevision(), req.GetBindings())
	if err != nil {
		return nil, err
	}
	return &runtimev1.UpsertAgentExecutionConfigResponse{Config: config}, nil
}

func (s *Service) GetAgentExecutionReadiness(_ context.Context, req *runtimev1.GetAgentExecutionReadinessRequest) (*runtimev1.GetAgentExecutionReadinessResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "get agent execution readiness request is required")
	}
	if s.isClosed() {
		return nil, status.Error(codes.Unavailable, "runtime agent service is closed")
	}
	snapshot, err := s.currentExecutionReadinessSnapshot()
	if err != nil {
		return nil, err
	}
	if snapshot == nil {
		return nil, status.Error(codes.Internal, "runtime agent execution readiness projection unavailable")
	}
	return &runtimev1.GetAgentExecutionReadinessResponse{Snapshot: snapshot}, nil
}

// SubscribeAgentExecutionReadiness delivers the initial snapshot immediately,
// then a new snapshot on every config mutation and readiness recompute
// (K-AGCORE-149). The seam is domain-scoped: it never rides the agent-scoped
// AgentEvent envelope.
func (s *Service) SubscribeAgentExecutionReadiness(req *runtimev1.SubscribeAgentExecutionReadinessRequest, stream runtimev1.RuntimeAgentService_SubscribeAgentExecutionReadinessServer) error {
	if req == nil {
		return status.Error(codes.InvalidArgument, "subscribe agent execution readiness request is required")
	}
	if s.isClosed() {
		return status.Error(codes.Unavailable, "runtime agent service is closed")
	}
	initial, err := s.currentExecutionReadinessSnapshot()
	if err != nil {
		return err
	}
	if initial == nil {
		return status.Error(codes.Internal, "runtime agent execution readiness projection unavailable")
	}
	id, ch := s.addExecutionReadinessSubscriber()
	defer s.removeExecutionReadinessSubscriber(id)

	if err := stream.SendHeader(metadata.MD{}); err != nil {
		return err
	}
	if err := stream.Send(initial); err != nil {
		return err
	}
	for {
		select {
		case <-stream.Context().Done():
			return stream.Context().Err()
		case snapshot, ok := <-ch:
			if !ok {
				return nil
			}
			if err := stream.Send(snapshot); err != nil {
				return err
			}
		}
	}
}
