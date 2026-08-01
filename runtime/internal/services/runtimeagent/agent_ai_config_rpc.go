package runtimeagent

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// K-AGCORE-144..150 Runtime Agent AI Config RPC surface. The config is
// Runtime Local Agent instance-scoped committed state: authz
// (runtime.agent.ai_config.read/write) is enforced by the gRPC interceptor
// scope map, and the handlers enforce payload admission fail-closed.

func (s *Service) GetRuntimeAgentAIConfig(ctx context.Context, req *runtimev1.GetRuntimeAgentAIConfigRequest) (*runtimev1.GetRuntimeAgentAIConfigResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "get runtime agent ai config request is required")
	}
	if s.isClosed() {
		return nil, status.Error(codes.Unavailable, "runtime agent service is closed")
	}
	if err := s.authorizeProtectedAIConfigIdentity(ctx, req.GetContext(), "runtime.agent.read"); err != nil {
		return nil, err
	}
	config, err := s.committedRuntimeAgentAIConfigForContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetRuntimeAgentAIConfigResponse{Config: cloneRuntimeAgentAIConfig(config)}, nil
}

func (s *Service) UpsertRuntimeAgentAIConfig(ctx context.Context, req *runtimev1.UpsertRuntimeAgentAIConfigRequest) (*runtimev1.UpsertRuntimeAgentAIConfigResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "upsert runtime agent ai config request is required")
	}
	if err := s.authorizeProtectedAIConfigIdentity(ctx, req.GetContext(), "runtime.agent.write"); err != nil {
		return nil, err
	}
	config, err := s.upsertRuntimeAgentAIConfig(
		req.GetContext(),
		req.GetExpectedRevision(),
		req.GetIntents(),
		req.GetProfileOrigin(),
	)
	if err != nil {
		return nil, err
	}
	return &runtimev1.UpsertRuntimeAgentAIConfigResponse{Config: config}, nil
}

func (s *Service) GetRuntimeAgentAIConfigReadiness(ctx context.Context, req *runtimev1.GetRuntimeAgentAIConfigReadinessRequest) (*runtimev1.GetRuntimeAgentAIConfigReadinessResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "get runtime agent ai config readiness request is required")
	}
	if s.isClosed() {
		return nil, status.Error(codes.Unavailable, "runtime agent service is closed")
	}
	if err := s.authorizeProtectedAIConfigIdentity(ctx, req.GetContext(), "runtime.agent.read"); err != nil {
		return nil, err
	}
	config, err := s.committedRuntimeAgentAIConfigForContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	snapshot, err := s.currentRuntimeAgentAIConfigReadinessSnapshot(config.GetAgentInstanceId())
	if err != nil {
		return nil, err
	}
	if snapshot == nil {
		return nil, status.Error(codes.Internal, "runtime agent ai config readiness projection unavailable")
	}
	return &runtimev1.GetRuntimeAgentAIConfigReadinessResponse{Snapshot: snapshot}, nil
}

func (s *Service) authorizeProtectedAIConfigIdentity(
	ctx context.Context,
	requestContext *runtimev1.AgentRequestContext,
	capability string,
) error {
	identity, err := localAgentIdentityFromContext(requestContext)
	if err != nil {
		return err
	}
	return s.authorizeBundledAvatarIdentity(ctx, requestContext, identity, capability)
}

// SubscribeRuntimeAgentAIConfigReadiness delivers the initial snapshot immediately,
// then a new snapshot on every config mutation and readiness recompute
// (K-AGCORE-149). The seam is domain-scoped: it never rides the agent-scoped
// AgentEvent envelope.
func (s *Service) SubscribeRuntimeAgentAIConfigReadiness(req *runtimev1.SubscribeRuntimeAgentAIConfigReadinessRequest, stream runtimev1.RuntimeAgentService_SubscribeRuntimeAgentAIConfigReadinessServer) error {
	if req == nil {
		return status.Error(codes.InvalidArgument, "subscribe runtime agent ai config readiness request is required")
	}
	if s.isClosed() {
		return status.Error(codes.Unavailable, "runtime agent service is closed")
	}
	if err := s.authorizeProtectedAIConfigIdentity(stream.Context(), req.GetContext(), "runtime.agent.read"); err != nil {
		return err
	}
	config, err := s.committedRuntimeAgentAIConfigForContext(req.GetContext())
	if err != nil {
		return err
	}
	initial, err := s.currentRuntimeAgentAIConfigReadinessSnapshot(config.GetAgentInstanceId())
	if err != nil {
		return err
	}
	if initial == nil {
		return status.Error(codes.Internal, "runtime agent ai config readiness projection unavailable")
	}
	id, ch := s.addRuntimeAgentAIConfigReadinessSubscriber(config.GetAgentInstanceId())
	defer s.removeRuntimeAgentAIConfigReadinessSubscriber(id)

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
