package agentcore

import (
	"context"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) InitializeAgent(ctx context.Context, req *runtimev1.InitializeAgentRequest) (*runtimev1.InitializeAgentResponse, error) {
	agentID := strings.TrimSpace(req.GetAgentId())
	if agentID == "" {
		agentID = "agent_" + ulid.Make().String()
	}

	s.mu.RLock()
	if existing := s.agents[agentID]; existing != nil && existing.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_TERMINATED {
		s.mu.RUnlock()
		return nil, status.Error(codes.AlreadyExists, "agent already exists")
	}
	s.mu.RUnlock()

	agentBank := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: agentID},
		},
	}
	if _, err := s.memorySvc.EnsureCanonicalBank(ctx, agentBank, "Agent Memory", nil); err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	autonomy := buildInitialAutonomyState(req.GetAutonomyConfig(), now)
	agent := &runtimev1.AgentRecord{
		AgentId:         agentID,
		DisplayName:     firstNonEmpty(strings.TrimSpace(req.GetDisplayName()), agentID),
		LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		Autonomy:        autonomy,
		Metadata:        cloneStruct(req.GetMetadata()),
		CreatedAt:       timestamppb.New(now),
		UpdatedAt:       timestamppb.New(now),
	}
	state := &runtimev1.AgentStateProjection{
		ExecutionState: runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE,
		StatusText:     "",
		ActiveWorldId:  strings.TrimSpace(req.GetWorldId()),
		Attributes:     map[string]string{},
		UpdatedAt:      timestamppb.New(now),
	}
	entry := &agentEntry{
		Agent: cloneAgentRecord(agent),
		State: cloneAgentState(state),
		Hooks: make(map[string]*runtimev1.PendingHook),
	}
	lifecycleEvent := s.newEvent(agentID, runtimev1.AgentEventType_AGENT_EVENT_TYPE_LIFECYCLE, &runtimev1.AgentEvent_Lifecycle{
		Lifecycle: &runtimev1.AgentLifecycleEventDetail{
			PreviousStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_UNSPECIFIED,
			CurrentStatus:  runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		},
	})
	events := []*runtimev1.AgentEvent{lifecycleEvent}
	if autonomy.GetEnabled() {
		events = append(events, s.newEvent(agentID, runtimev1.AgentEventType_AGENT_EVENT_TYPE_BUDGET, &runtimev1.AgentEvent_Budget{
			Budget: &runtimev1.AgentBudgetEventDetail{
				BudgetExhausted: autonomy.GetBudgetExhausted(),
				RemainingTokens: remainingTokens(autonomy),
				WindowStartedAt: cloneTimestamp(autonomy.GetWindowStartedAt()),
			},
		}))
	}
	if err := s.insertAgent(entry, events...); err != nil {
		return nil, err
	}
	return &runtimev1.InitializeAgentResponse{
		Agent: cloneAgentRecord(agent),
		State: cloneAgentState(state),
	}, nil
}

func (s *Service) TerminateAgent(_ context.Context, req *runtimev1.TerminateAgentRequest) (*runtimev1.TerminateAgentResponse, error) {
	agentID := strings.TrimSpace(req.GetAgentId())
	entry, err := s.agentByID(agentID)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	entry.Agent.LifecycleStatus = runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_TERMINATED
	entry.Agent.UpdatedAt = timestamppb.New(now)
	entry.State.ExecutionState = runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_SUSPENDED
	entry.State.UpdatedAt = timestamppb.New(now)
	events := []*runtimev1.AgentEvent{
		s.newEvent(agentID, runtimev1.AgentEventType_AGENT_EVENT_TYPE_LIFECYCLE, &runtimev1.AgentEvent_Lifecycle{
			Lifecycle: &runtimev1.AgentLifecycleEventDetail{
				PreviousStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
				CurrentStatus:  runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_TERMINATED,
			},
		}),
	}
	events = append(events, cancelActiveHooks(entry, "runtime", firstNonEmpty(strings.TrimSpace(req.GetReason()), "agent terminated"), now)...)
	if err := s.updateAgent(entry, events...); err != nil {
		return nil, err
	}
	return &runtimev1.TerminateAgentResponse{Ack: okAck()}, nil
}

func (s *Service) GetAgent(_ context.Context, req *runtimev1.GetAgentRequest) (*runtimev1.GetAgentResponse, error) {
	entry, err := s.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetAgentResponse{Agent: cloneAgentRecord(entry.Agent)}, nil
}

func (s *Service) ListAgents(_ context.Context, req *runtimev1.ListAgentsRequest) (*runtimev1.ListAgentsResponse, error) {
	s.mu.RLock()
	items := make([]*runtimev1.AgentRecord, 0, len(s.agents))
	for _, entry := range s.agents {
		if req.GetLifecycleFilter() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_UNSPECIFIED &&
			entry.Agent.GetLifecycleStatus() != req.GetLifecycleFilter() {
			continue
		}
		if req.AutonomyEnabled != nil && entry.Agent.GetAutonomy().GetEnabled() != req.GetAutonomyEnabled() {
			continue
		}
		items = append(items, cloneAgentRecord(entry.Agent))
	}
	s.mu.RUnlock()
	sort.Slice(items, func(i, j int) bool {
		left := items[i].GetCreatedAt().AsTime()
		right := items[j].GetCreatedAt().AsTime()
		if left.Equal(right) {
			return items[i].GetAgentId() < items[j].GetAgentId()
		}
		return left.After(right)
	})
	start, end, next, err := pageBounds(req.GetPageToken(), req.GetPageSize(), defaultAgentPageSize, maxAgentPageSize, len(items))
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListAgentsResponse{Agents: items[start:end], NextPageToken: next}, nil
}

func (s *Service) GetAgentState(_ context.Context, req *runtimev1.GetAgentStateRequest) (*runtimev1.GetAgentStateResponse, error) {
	entry, err := s.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetAgentStateResponse{State: cloneAgentState(entry.State)}, nil
}

func (s *Service) UpdateAgentState(_ context.Context, req *runtimev1.UpdateAgentStateRequest) (*runtimev1.UpdateAgentStateResponse, error) {
	if len(req.GetMutations()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	entry, err := s.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	nextState := cloneAgentState(entry.State)
	if nextState.Attributes == nil {
		nextState.Attributes = map[string]string{}
	}
	for _, mutation := range req.GetMutations() {
		switch item := mutation.GetMutation().(type) {
		case *runtimev1.AgentStateMutation_SetStatusText:
			nextState.StatusText = strings.TrimSpace(item.SetStatusText.GetStatusText())
		case *runtimev1.AgentStateMutation_SetWorldContext:
			nextState.ActiveWorldId = strings.TrimSpace(item.SetWorldContext.GetWorldId())
		case *runtimev1.AgentStateMutation_ClearWorldContext:
			nextState.ActiveWorldId = ""
		case *runtimev1.AgentStateMutation_SetDyadicContext:
			nextState.ActiveUserId = strings.TrimSpace(item.SetDyadicContext.GetUserId())
		case *runtimev1.AgentStateMutation_ClearDyadicContext:
			nextState.ActiveUserId = ""
		case *runtimev1.AgentStateMutation_PutAttribute:
			key := strings.TrimSpace(item.PutAttribute.GetKey())
			if key == "" {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
			}
			nextState.Attributes[key] = item.PutAttribute.GetValue()
		case *runtimev1.AgentStateMutation_RemoveAttribute:
			delete(nextState.Attributes, strings.TrimSpace(item.RemoveAttribute.GetKey()))
		default:
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	}
	nextState.UpdatedAt = timestamppb.New(time.Now().UTC())
	entry.State = nextState
	if err := s.updateAgent(entry); err != nil {
		return nil, err
	}
	return &runtimev1.UpdateAgentStateResponse{State: cloneAgentState(nextState)}, nil
}

func (s *Service) EnableAutonomy(_ context.Context, req *runtimev1.EnableAutonomyRequest) (*runtimev1.EnableAutonomyResponse, error) {
	entry, err := s.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	if entry.Agent.Autonomy == nil {
		entry.Agent.Autonomy = buildInitialAutonomyState(nil, now)
	}
	entry.Agent.Autonomy.Enabled = true
	if entry.Agent.Autonomy.WindowStartedAt == nil {
		entry.Agent.Autonomy.WindowStartedAt = timestamppb.New(now)
	}
	entry.Agent.UpdatedAt = timestamppb.New(now)
	event := s.newEvent(entry.Agent.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_BUDGET, &runtimev1.AgentEvent_Budget{
		Budget: &runtimev1.AgentBudgetEventDetail{
			BudgetExhausted: entry.Agent.GetAutonomy().GetBudgetExhausted(),
			RemainingTokens: remainingTokens(entry.Agent.GetAutonomy()),
			WindowStartedAt: cloneTimestamp(entry.Agent.GetAutonomy().GetWindowStartedAt()),
		},
	})
	if err := s.updateAgent(entry, event); err != nil {
		return nil, err
	}
	return &runtimev1.EnableAutonomyResponse{Autonomy: cloneAutonomy(entry.Agent.GetAutonomy())}, nil
}

func (s *Service) DisableAutonomy(_ context.Context, req *runtimev1.DisableAutonomyRequest) (*runtimev1.DisableAutonomyResponse, error) {
	entry, err := s.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	if entry.Agent.Autonomy == nil {
		entry.Agent.Autonomy = buildInitialAutonomyState(nil, now)
	}
	entry.Agent.Autonomy.Enabled = false
	entry.Agent.Autonomy.BudgetExhausted = false
	entry.Agent.UpdatedAt = timestamppb.New(now)
	event := s.newEvent(entry.Agent.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_BUDGET, &runtimev1.AgentEvent_Budget{
		Budget: &runtimev1.AgentBudgetEventDetail{
			BudgetExhausted: false,
			RemainingTokens: remainingTokens(entry.Agent.GetAutonomy()),
			WindowStartedAt: cloneTimestamp(entry.Agent.GetAutonomy().GetWindowStartedAt()),
		},
	})
	if err := s.updateAgent(entry, event); err != nil {
		return nil, err
	}
	return &runtimev1.DisableAutonomyResponse{Autonomy: cloneAutonomy(entry.Agent.GetAutonomy())}, nil
}

func (s *Service) SetAutonomyConfig(_ context.Context, req *runtimev1.SetAutonomyConfigRequest) (*runtimev1.SetAutonomyConfigResponse, error) {
	if req.GetConfig() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	entry, err := s.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	if entry.Agent.Autonomy == nil {
		entry.Agent.Autonomy = buildInitialAutonomyState(req.GetConfig(), now)
	} else {
		entry.Agent.Autonomy.Config = cloneAutonomyConfig(req.GetConfig())
	}
	entry.Agent.Autonomy.BudgetExhausted = entry.Agent.Autonomy.GetConfig().GetDailyTokenBudget() > 0 &&
		entry.Agent.Autonomy.GetUsedTokensInWindow() >= entry.Agent.Autonomy.GetConfig().GetDailyTokenBudget()
	entry.Agent.UpdatedAt = timestamppb.New(now)
	event := s.newEvent(entry.Agent.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_BUDGET, &runtimev1.AgentEvent_Budget{
		Budget: &runtimev1.AgentBudgetEventDetail{
			BudgetExhausted: entry.Agent.GetAutonomy().GetBudgetExhausted(),
			RemainingTokens: remainingTokens(entry.Agent.GetAutonomy()),
			WindowStartedAt: cloneTimestamp(entry.Agent.GetAutonomy().GetWindowStartedAt()),
		},
	})
	if err := s.updateAgent(entry, event); err != nil {
		return nil, err
	}
	return &runtimev1.SetAutonomyConfigResponse{Autonomy: cloneAutonomy(entry.Agent.GetAutonomy())}, nil
}

func (s *Service) ListPendingHooks(_ context.Context, req *runtimev1.ListPendingHooksRequest) (*runtimev1.ListPendingHooksResponse, error) {
	entry, err := s.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	items := make([]*runtimev1.PendingHook, 0, len(entry.Hooks))
	for _, hook := range entry.Hooks {
		if req.GetStatusFilter() == runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_UNSPECIFIED && !isCancelableHookStatus(hook.GetStatus()) {
			continue
		}
		if req.GetTriggerFilter() != runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_UNSPECIFIED &&
			hook.GetTrigger().GetTriggerKind() != req.GetTriggerFilter() {
			continue
		}
		if req.GetStatusFilter() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_UNSPECIFIED &&
			hook.GetStatus() != req.GetStatusFilter() {
			continue
		}
		items = append(items, clonePendingHook(hook))
	}
	sort.Slice(items, func(i, j int) bool {
		left := items[i].GetScheduledFor().AsTime()
		right := items[j].GetScheduledFor().AsTime()
		if left.Equal(right) {
			return items[i].GetHookId() < items[j].GetHookId()
		}
		return left.Before(right)
	})
	start, end, next, err := pageBounds(req.GetPageToken(), req.GetPageSize(), defaultHookPageSize, maxHookPageSize, len(items))
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListPendingHooksResponse{Hooks: items[start:end], NextPageToken: next}, nil
}

func (s *Service) CancelHook(_ context.Context, req *runtimev1.CancelHookRequest) (*runtimev1.CancelHookResponse, error) {
	outcome, err := s.cancelHook(strings.TrimSpace(req.GetAgentId()), strings.TrimSpace(req.GetHookId()), "app", req.GetReason())
	if err != nil {
		return nil, err
	}
	return &runtimev1.CancelHookResponse{Outcome: outcome}, nil
}

func buildInitialAutonomyState(cfg *runtimev1.AgentAutonomyConfig, now time.Time) *runtimev1.AgentAutonomyState {
	state := &runtimev1.AgentAutonomyState{
		Enabled:            cfg != nil,
		Config:             cloneAutonomyConfig(cfg),
		UsedTokensInWindow: 0,
		WindowStartedAt:    timestamppb.New(now),
	}
	if cfg != nil && cfg.GetSuspendUntil() != nil {
		state.SuspendedUntil = cloneTimestamp(cfg.GetSuspendUntil())
	}
	return state
}
