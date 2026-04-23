package runtimeagent

import (
	"context"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) InitializeAgent(ctx context.Context, req *runtimev1.InitializeAgentRequest) (*runtimev1.InitializeAgentResponse, error) {
	return s.agentAdminRuntime().initialize(ctx, req)
}

func (s *Service) TerminateAgent(_ context.Context, req *runtimev1.TerminateAgentRequest) (*runtimev1.TerminateAgentResponse, error) {
	return s.agentAdminRuntime().terminate(req)
}

func (s *Service) GetAgent(_ context.Context, req *runtimev1.GetAgentRequest) (*runtimev1.GetAgentResponse, error) {
	return s.agentAdminRuntime().get(req)
}

func (s *Service) ListAgents(_ context.Context, req *runtimev1.ListAgentsRequest) (*runtimev1.ListAgentsResponse, error) {
	return s.agentAdminRuntime().list(req)
}

func (s *Service) GetAgentState(_ context.Context, req *runtimev1.GetAgentStateRequest) (*runtimev1.GetAgentStateResponse, error) {
	return s.agentAdminRuntime().getState(req)
}

func (s *Service) UpdateAgentState(_ context.Context, req *runtimev1.UpdateAgentStateRequest) (*runtimev1.UpdateAgentStateResponse, error) {
	return s.agentAdminRuntime().updateState(req)
}

func (s *Service) SetAgentPresentationProfile(_ context.Context, req *runtimev1.SetAgentPresentationProfileRequest) (*runtimev1.SetAgentPresentationProfileResponse, error) {
	return s.agentAdminRuntime().setPresentationProfile(req)
}

func (s *Service) EnableAutonomy(_ context.Context, req *runtimev1.EnableAutonomyRequest) (*runtimev1.EnableAutonomyResponse, error) {
	return s.agentAdminRuntime().enableAutonomy(req)
}

func (s *Service) DisableAutonomy(_ context.Context, req *runtimev1.DisableAutonomyRequest) (*runtimev1.DisableAutonomyResponse, error) {
	return s.agentAdminRuntime().disableAutonomy(req)
}

func (s *Service) SetAutonomyConfig(_ context.Context, req *runtimev1.SetAutonomyConfigRequest) (*runtimev1.SetAutonomyConfigResponse, error) {
	return s.agentAdminRuntime().setAutonomyConfig(req)
}

func (s *Service) ListPendingHooks(_ context.Context, req *runtimev1.ListPendingHooksRequest) (*runtimev1.ListPendingHooksResponse, error) {
	return s.agentAdminRuntime().listPendingHooks(req)
}

func (s *Service) CancelHook(_ context.Context, req *runtimev1.CancelHookRequest) (*runtimev1.CancelHookResponse, error) {
	return s.agentAdminRuntime().cancelHook(req)
}

func buildInitialAutonomyState(cfg *runtimev1.AgentAutonomyConfig, now time.Time) *runtimev1.AgentAutonomyState {
	config := normalizeAutonomyConfig(cfg)
	state := &runtimev1.AgentAutonomyState{
		Enabled:            false,
		Config:             config,
		UsedTokensInWindow: 0,
		WindowStartedAt:    timestamppb.New(now),
	}
	if config.GetSuspendUntil() != nil {
		state.SuspendedUntil = cloneTimestamp(config.GetSuspendUntil())
	}
	return state
}
