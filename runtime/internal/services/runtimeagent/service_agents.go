package runtimeagent

import (
	"context"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) TerminateAgent(ctx context.Context, req *runtimev1.TerminateAgentRequest) (*runtimev1.TerminateAgentResponse, error) {
	return s.agentAdminRuntime().terminate(ctx, req)
}

func (s *Service) GetAgent(ctx context.Context, req *runtimev1.GetAgentRequest) (*runtimev1.GetAgentResponse, error) {
	if _, protected, err := protectedAccountProductPrincipal(ctx, "runtime.agent.read"); err != nil {
		return nil, err
	} else if protected {
		return s.getProtectedAccountAgent(ctx, req)
	}
	return s.agentAdminRuntime().get(req)
}

func (s *Service) ListAgents(ctx context.Context, req *runtimev1.ListAgentsRequest) (*runtimev1.ListAgentsResponse, error) {
	principal, protected, err := protectedAccountProductPrincipal(ctx, "runtime.agent.read")
	if err != nil {
		return nil, err
	}
	if protected {
		if err := validateProtectedAccountAgentSelector(req.GetContext(), principal); err != nil {
			return nil, err
		}
		return s.agentAdminRuntime().list(req, principal.AccountID)
	}
	return s.agentAdminRuntime().list(req, "")
}

func (s *Service) GetAgentState(ctx context.Context, req *runtimev1.GetAgentStateRequest) (*runtimev1.GetAgentStateResponse, error) {
	if _, err := s.authorizeProtectedAccountAgent(ctx, req.GetContext(), req.GetAgentId(), "runtime.agent.read"); err != nil {
		return nil, err
	}
	return s.agentAdminRuntime().getState(req)
}

func (s *Service) UpdateAgentState(ctx context.Context, req *runtimev1.UpdateAgentStateRequest) (*runtimev1.UpdateAgentStateResponse, error) {
	if _, err := s.authorizeProtectedAccountAgent(ctx, req.GetContext(), req.GetAgentId(), "runtime.agent.write"); err != nil {
		return nil, err
	}
	return s.agentAdminRuntime().updateState(req)
}

func (s *Service) SetAgentPresentationProfile(ctx context.Context, req *runtimev1.SetAgentPresentationProfileRequest) (*runtimev1.SetAgentPresentationProfileResponse, error) {
	if req != nil {
		identity, err := localAgentIdentityFromContext(req.GetContext())
		if err != nil {
			return nil, err
		}
		if err := s.authorizeBundledAvatarIdentity(ctx, req.GetContext(), identity, "runtime.agent.write"); err != nil {
			return nil, err
		}
	}
	return s.agentAdminRuntime().setPresentationProfile(ctx, req)
}

func (s *Service) EnableAutonomy(ctx context.Context, req *runtimev1.EnableAutonomyRequest) (*runtimev1.EnableAutonomyResponse, error) {
	if _, err := s.authorizeProtectedAccountAgent(ctx, req.GetContext(), req.GetAgentId(), "runtime.agent.write"); err != nil {
		return nil, err
	}
	return s.agentAdminRuntime().enableAutonomy(req)
}

func (s *Service) DisableAutonomy(ctx context.Context, req *runtimev1.DisableAutonomyRequest) (*runtimev1.DisableAutonomyResponse, error) {
	if _, err := s.authorizeProtectedAccountAgent(ctx, req.GetContext(), req.GetAgentId(), "runtime.agent.write"); err != nil {
		return nil, err
	}
	return s.agentAdminRuntime().disableAutonomy(req)
}

func (s *Service) SetAutonomyConfig(ctx context.Context, req *runtimev1.SetAutonomyConfigRequest) (*runtimev1.SetAutonomyConfigResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if _, err := s.authorizeProtectedAccountAgent(ctx, req.GetContext(), req.GetAgentId(), "runtime.agent.write"); err != nil {
		return nil, err
	}
	if req.ExpectedAutonomyRevision == nil || req.GetExpectedAutonomyRevision() == 0 || (req.GetConfig() == nil && req.Enabled == nil) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	identity, err := localAgentIdentityFromContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	var config *runtimev1.AgentAutonomyConfig
	if req.GetConfig() != nil {
		config, err = validateAgentAutonomyMutationConfig(req.GetConfig())
		if err != nil {
			return nil, err
		}
	}
	autonomy, err := s.updateAgentAutonomyCAS(identity, req.GetExpectedAutonomyRevision(), agentAutonomyMutationIntent{
		enabled: req.Enabled,
		config:  config,
	})
	if err != nil {
		return nil, err
	}
	return &runtimev1.SetAutonomyConfigResponse{Autonomy: autonomy}, nil
}

func (s *Service) ListPendingHooks(ctx context.Context, req *runtimev1.ListPendingHooksRequest) (*runtimev1.ListPendingHooksResponse, error) {
	if _, err := s.authorizeProtectedAccountAgent(ctx, req.GetContext(), req.GetAgentId(), "runtime.agent.read"); err != nil {
		return nil, err
	}
	return s.agentAdminRuntime().listPendingHooks(req)
}

func (s *Service) CancelHook(ctx context.Context, req *runtimev1.CancelHookRequest) (*runtimev1.CancelHookResponse, error) {
	if _, err := s.authorizeProtectedAccountAgent(ctx, req.GetContext(), req.GetAgentId(), "runtime.agent.write"); err != nil {
		return nil, err
	}
	return s.agentAdminRuntime().cancelHook(req)
}

func buildInitialAutonomyState(cfg *runtimev1.AgentAutonomyConfig, now time.Time) *runtimev1.AgentAutonomyState {
	config := normalizeAutonomyConfig(cfg)
	state := &runtimev1.AgentAutonomyState{
		Enabled:            false,
		Revision:           1,
		Config:             config,
		UsedTokensInWindow: 0,
		WindowStartedAt:    timestamppb.New(now),
	}
	if config.GetSuspendUntil() != nil {
		state.SuspendedUntil = cloneTimestamp(config.GetSuspendUntil())
	}
	return state
}
