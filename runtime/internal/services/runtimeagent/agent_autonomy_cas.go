package runtimeagent

import (
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type agentAutonomyMutationIntent struct {
	enabled *bool
	config  *runtimev1.AgentAutonomyConfig
}

func validateAgentAutonomyMutationConfig(input *runtimev1.AgentAutonomyConfig) (*runtimev1.AgentAutonomyConfig, error) {
	if input == nil || input.GetDailyTokenBudget() < 0 || input.GetMaxTokensPerHook() < 0 ||
		(input.GetMinHookInterval() != nil && input.GetMinHookInterval().CheckValid() != nil) ||
		(input.GetSuspendUntil() != nil && input.GetSuspendUntil().CheckValid() != nil) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	mode := input.GetMode()
	if mode < runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF || mode > runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_HIGH {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return normalizeAutonomyConfig(input), nil
}

// @nimi-authority: definition.nimi.runtime.agent-participation.autonomy-configuration-plane
// updateAgentAutonomyCAS is the single atomic autonomy mutation implementation
// shared by the first-party owner surface and the local-app update-autonomy
// carrier. Authorization and identity resolution remain carrier-specific.
func (s *Service) updateAgentAutonomyCAS(
	identity localAgentIdentity,
	expectedRevision uint64,
	intent agentAutonomyMutationIntent,
) (*runtimev1.AgentAutonomyState, error) {
	if expectedRevision == 0 || (intent.enabled == nil && intent.config == nil) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	current := s.agents[identity.LocalAgentRef]
	if current == nil || current.Agent == nil {
		return nil, status.Error(codes.NotFound, "agent not found")
	}
	if err := validateLocalAgentRecordIdentity(current.Agent, identity); err != nil {
		return nil, err
	}
	next := cloneAgentEntry(current)
	if next.Agent.Autonomy == nil {
		next.Agent.Autonomy = buildInitialAutonomyState(nil, time.Now().UTC())
	}
	if next.Agent.Autonomy.GetRevision() != expectedRevision {
		return nil, grpcerr.WithReasonCode(codes.Aborted, runtimev1.ReasonCode_AGENT_AUTONOMY_REVISION_CONFLICT)
	}
	if intent.config != nil {
		config, err := validateAgentAutonomyMutationConfig(intent.config)
		if err != nil {
			return nil, err
		}
		next.Agent.Autonomy.Config = config
		next.Agent.Autonomy.SuspendedUntil = cloneTimestamp(config.GetSuspendUntil())
	}
	if intent.enabled != nil {
		next.Agent.Autonomy.Enabled = *intent.enabled
	}
	if autonomyMode(next.Agent.Autonomy.GetConfig()) == runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF {
		next.Agent.Autonomy.Enabled = false
		next.Agent.Autonomy.BudgetExhausted = false
	} else {
		budget := next.Agent.Autonomy.GetConfig().GetDailyTokenBudget()
		next.Agent.Autonomy.BudgetExhausted = budget > 0 && next.Agent.Autonomy.GetUsedTokensInWindow() >= budget
	}
	if err := advanceAutonomyRevision(next.Agent.Autonomy); err != nil {
		return nil, err
	}
	next.Agent.UpdatedAt = timestamppb.New(time.Now().UTC())
	s.agents[identity.LocalAgentRef] = next
	if err := s.saveStateLocked(); err != nil {
		s.agents[identity.LocalAgentRef] = current
		return nil, err
	}
	return cloneAutonomy(next.Agent.GetAutonomy()), nil
}
