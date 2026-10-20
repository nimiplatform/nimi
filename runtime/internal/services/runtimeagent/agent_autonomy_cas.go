package runtimeagent

import (
	"math"
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
	if input == nil || input.GetDailyTokenBudget() < 0 || input.GetMaxBackgroundOutputTokens() < 0 || input.GetMaxBackgroundOutputTokens() > math.MaxInt32 ||
		(input.GetMinPlanningInterval() != nil && input.GetMinPlanningInterval().CheckValid() != nil) ||
		(input.GetSuspendUntil() != nil && input.GetSuspendUntil().CheckValid() != nil) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	mode := input.GetMode()
	if input.GetMinPlanningInterval() != nil && input.GetMinPlanningInterval().AsDuration() < 0 {
		return nil, status.Error(codes.InvalidArgument, "planning interval cannot be negative")
	}
	if input.GetFreeContactEnabled() && input.GetMaxFreeContactsPerDay() == 0 {
		return nil, status.Error(codes.InvalidArgument, "free contact requires a positive frequency limit")
	}
	if input.GetMaxFreeContactsPerDay() > 24 {
		return nil, status.Error(codes.InvalidArgument, "free contact limit must be at most 24 per day")
	}
	if hours := input.GetQuietHours(); hours != nil {
		if len(hours.ProtoReflect().GetUnknown()) != 0 || hours.StartMinute >= 1440 || hours.EndMinute >= 1440 || hours.StartMinute == hours.EndMinute {
			return nil, status.Error(codes.InvalidArgument, "invalid quiet hours")
		}
		if _, err := time.LoadLocation(hours.Timezone); err != nil {
			return nil, status.Error(codes.InvalidArgument, "quiet hours require a valid timezone")
		}
	}
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

	var after []func()
	defer func() {
		for _, action := range after {
			action()
		}
	}()
	s.cognitionMemoryOwnerLifecycleMu.Lock()
	defer s.cognitionMemoryOwnerLifecycleMu.Unlock()
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
	advanceAutonomyWindow(next, time.Now().UTC())
	if autonomyMode(next.Agent.Autonomy.GetConfig()) == runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF {
		next.Agent.Autonomy.Enabled = false
	}
	budget := next.Agent.Autonomy.GetConfig().GetDailyTokenBudget()
	next.Agent.Autonomy.BudgetExhausted = budget > 0 && next.Agent.Autonomy.GetUsedTokensInWindow() >= budget
	now := time.Now().UTC()
	budgetChanged := current.Agent.Autonomy.GetConfig().GetDailyTokenBudget() != budget ||
		current.Agent.Autonomy.GetConfig().GetMaxBackgroundOutputTokens() != next.Agent.Autonomy.GetConfig().GetMaxBackgroundOutputTokens()
	if budgetChanged {
		if next.Life.LifeBudgetWaiting {
			next.Life.NextCheckAt = now
			next.Life.LifeBudgetWaiting = false
		}
		if next.Life.ContactBudgetWaiting {
			next.Life.ContactNextAt = now
			next.Life.ContactBudgetWaiting = false
		}
	}
	var completionHook runtimeAgentStateTxHook
	if lifeEnabled(current) && !lifeEnabled(next) {
		source, found := s.turnSourceViews[identity.LocalAgentRef]
		completed, err := next.Life.advance(now, !found || source.WorldTimeDecodeFailure != "" || source.LifeWorldPaused)
		if err != nil {
			return nil, err
		}

		completionHook, err = s.lifeActivityMemoryTxHook(next, completed, now)
		if err != nil {
			return nil, err
		}
		if err := next.Life.pause(now); err != nil {
			return nil, err
		}
	}
	if !lifeEnabled(current) && lifeEnabled(next) {
		next.Life.Explanation = nil
		next.Life.SettledAt = now
		next.Life.NextCheckAt = now
		next.Life.WaitReason = ""
		if next.Life.StartedAt.IsZero() {
			next.Life.StartedAt = now
		}
		if err := next.Life.changed(); err != nil {
			return nil, err
		}
	}
	if current.Agent.Autonomy.GetConfig().GetFreeContactEnabled() != next.Agent.Autonomy.GetConfig().GetFreeContactEnabled() {
		next.Life.ContactEpoch++
		next.Life.ContactConsideredAt = now
		next.Life.ContactNextAt = time.Time{}
		if next.Agent.Autonomy.GetConfig().GetFreeContactEnabled() {
			next.Life.ContactNextAt = now.Add(30 * time.Minute)
		}
	}
	if !next.Agent.Autonomy.GetConfig().GetFreeContactEnabled() {
		next.Life.cancelFreeIntents("")
		next.Life.ContactBudgetWaiting = false
	}
	if !lifeEnabled(next) {
		next.Life.LifeBudgetWaiting = false
	}
	if !next.Life.LifeBudgetWaiting && !next.Life.ContactBudgetWaiting && !next.Agent.Autonomy.GetBudgetExhausted() &&
		(next.Life.WaitReason == "budget_exhausted" || next.Life.WaitReason == "budget_insufficient") {
		next.Life.WaitReason = ""
	}
	if err := advanceAutonomyRevision(next.Agent.Autonomy); err != nil {
		return nil, err
	}
	next.Agent.UpdatedAt = timestamppb.New(time.Now().UTC())
	var err error
	after, err = s.commitAutonomyAndConversationControls(current, next, completionHook)
	if err != nil {
		return nil, err
	}
	if completionHook != nil {
		after = append(after, func() { s.triggerCognitionMemory(identity.LocalAgentRef) })
	}
	return cloneAutonomy(next.Agent.GetAutonomy()), nil
}
