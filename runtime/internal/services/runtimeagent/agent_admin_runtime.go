package runtimeagent

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

type agentAdminRuntime struct {
	svc *Service
}

func (s *Service) agentAdminRuntime() agentAdminRuntime {
	return agentAdminRuntime{svc: s}
}

func (r agentAdminRuntime) initialize(ctx context.Context, req *runtimev1.InitializeAgentRequest) (*runtimev1.InitializeAgentResponse, error) {
	agentID := strings.TrimSpace(req.GetAgentId())
	if agentID == "" {
		agentID = "agent_" + ulid.Make().String()
	}

	r.svc.mu.RLock()
	if existing := r.svc.agents[agentID]; existing != nil && existing.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_TERMINATED {
		r.svc.mu.RUnlock()
		return nil, status.Error(codes.AlreadyExists, "agent already exists")
	}
	r.svc.mu.RUnlock()

	agentBank := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: agentID},
		},
	}
	if _, err := r.svc.memorySvc.EnsureCanonicalBank(ctx, agentBank, "Agent Memory", nil); err != nil {
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
	lifecycleEvent := r.svc.newEvent(agentID, runtimev1.AgentEventType_AGENT_EVENT_TYPE_LIFECYCLE, &runtimev1.AgentEvent_Lifecycle{
		Lifecycle: &runtimev1.AgentLifecycleEventDetail{
			PreviousStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_UNSPECIFIED,
			CurrentStatus:  runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		},
	})
	events := []*runtimev1.AgentEvent{lifecycleEvent}
	if autonomy.GetEnabled() {
		events = append(events, r.svc.newEvent(agentID, runtimev1.AgentEventType_AGENT_EVENT_TYPE_BUDGET, &runtimev1.AgentEvent_Budget{
			Budget: &runtimev1.AgentBudgetEventDetail{
				BudgetExhausted: autonomy.GetBudgetExhausted(),
				RemainingTokens: remainingTokens(autonomy),
				WindowStartedAt: cloneTimestamp(autonomy.GetWindowStartedAt()),
			},
		}))
	}
	if err := r.svc.insertAgent(entry, events...); err != nil {
		return nil, err
	}
	return &runtimev1.InitializeAgentResponse{
		Agent: cloneAgentRecord(agent),
		State: cloneAgentState(state),
	}, nil
}

func (r agentAdminRuntime) terminate(req *runtimev1.TerminateAgentRequest) (*runtimev1.TerminateAgentResponse, error) {
	agentID := strings.TrimSpace(req.GetAgentId())
	entry, err := r.svc.agentByID(agentID)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	entry.Agent.LifecycleStatus = runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_TERMINATED
	entry.Agent.UpdatedAt = timestamppb.New(now)
	events := []*runtimev1.AgentEvent{
		r.svc.newEvent(agentID, runtimev1.AgentEventType_AGENT_EVENT_TYPE_LIFECYCLE, &runtimev1.AgentEvent_Lifecycle{
			Lifecycle: &runtimev1.AgentLifecycleEventDetail{
				PreviousStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
				CurrentStatus:  runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_TERMINATED,
			},
		}),
	}
	events = append(events, r.svc.cancelActiveHooks(entry, "runtime", firstNonEmpty(strings.TrimSpace(req.GetReason()), "agent terminated"), now)...)
	if err := r.svc.updateAgent(entry, events...); err != nil {
		return nil, err
	}
	return &runtimev1.TerminateAgentResponse{Ack: okAck()}, nil
}

func (r agentAdminRuntime) get(req *runtimev1.GetAgentRequest) (*runtimev1.GetAgentResponse, error) {
	entry, err := r.svc.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetAgentResponse{Agent: cloneAgentRecord(entry.Agent)}, nil
}

func (r agentAdminRuntime) list(req *runtimev1.ListAgentsRequest) (*runtimev1.ListAgentsResponse, error) {
	r.svc.mu.RLock()
	items := make([]*runtimev1.AgentRecord, 0, len(r.svc.agents))
	for _, entry := range r.svc.agents {
		if req.GetLifecycleFilter() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_UNSPECIFIED &&
			entry.Agent.GetLifecycleStatus() != req.GetLifecycleFilter() {
			continue
		}
		if req.AutonomyEnabled != nil && entry.Agent.GetAutonomy().GetEnabled() != req.GetAutonomyEnabled() {
			continue
		}
		items = append(items, cloneAgentRecord(entry.Agent))
	}
	r.svc.mu.RUnlock()
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

func (r agentAdminRuntime) getState(req *runtimev1.GetAgentStateRequest) (*runtimev1.GetAgentStateResponse, error) {
	entry, err := r.svc.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetAgentStateResponse{State: cloneAgentState(entry.State)}, nil
}

func (r agentAdminRuntime) updateState(req *runtimev1.UpdateAgentStateRequest) (*runtimev1.UpdateAgentStateResponse, error) {
	if len(req.GetMutations()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	entry, err := r.svc.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	nextState := cloneAgentState(entry.State)
	if nextState.Attributes == nil {
		nextState.Attributes = map[string]string{}
	}
	// K-AGCORE-037 state_envelope: admin mutations have no continuity origin.
	// Runtime MUST NOT fabricate anchor/turn/stream linkage.
	adminOrigin := stateEventOrigin{}
	previousStatusText := strings.TrimSpace(entry.State.GetStatusText())
	hadPreviousStatusText := previousStatusText != ""
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
	now := time.Now().UTC()
	nextState.UpdatedAt = timestamppb.New(now)
	entry.State = nextState
	events := make([]*runtimev1.AgentEvent, 0, 1)
	newStatusText := strings.TrimSpace(nextState.GetStatusText())
	if newStatusText != previousStatusText {
		events = append(events, r.svc.stateStatusTextChangedEvent(
			entry.Agent.GetAgentId(),
			newStatusText,
			previousStatusText,
			hadPreviousStatusText,
			adminOrigin,
			now,
		))
	}
	if err := r.svc.updateAgent(entry, events...); err != nil {
		return nil, err
	}
	return &runtimev1.UpdateAgentStateResponse{State: cloneAgentState(nextState)}, nil
}

func (r agentAdminRuntime) enableAutonomy(req *runtimev1.EnableAutonomyRequest) (*runtimev1.EnableAutonomyResponse, error) {
	entry, err := r.svc.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	if entry.Agent.Autonomy == nil {
		entry.Agent.Autonomy = buildInitialAutonomyState(nil, now)
	}
	if autonomyMode(entry.Agent.Autonomy.GetConfig()) == runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF {
		return &runtimev1.EnableAutonomyResponse{Autonomy: cloneAutonomy(entry.Agent.GetAutonomy())}, nil
	}
	entry.Agent.Autonomy.Enabled = true
	if entry.Agent.Autonomy.WindowStartedAt == nil {
		entry.Agent.Autonomy.WindowStartedAt = timestamppb.New(now)
	}
	entry.Agent.UpdatedAt = timestamppb.New(now)
	event := r.svc.newEvent(entry.Agent.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_BUDGET, &runtimev1.AgentEvent_Budget{
		Budget: &runtimev1.AgentBudgetEventDetail{
			BudgetExhausted: entry.Agent.GetAutonomy().GetBudgetExhausted(),
			RemainingTokens: remainingTokens(entry.Agent.GetAutonomy()),
			WindowStartedAt: cloneTimestamp(entry.Agent.GetAutonomy().GetWindowStartedAt()),
		},
	})
	if err := r.svc.updateAgent(entry, event); err != nil {
		return nil, err
	}
	return &runtimev1.EnableAutonomyResponse{Autonomy: cloneAutonomy(entry.Agent.GetAutonomy())}, nil
}

func (r agentAdminRuntime) disableAutonomy(req *runtimev1.DisableAutonomyRequest) (*runtimev1.DisableAutonomyResponse, error) {
	entry, err := r.svc.agentByID(strings.TrimSpace(req.GetAgentId()))
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
	event := r.svc.newEvent(entry.Agent.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_BUDGET, &runtimev1.AgentEvent_Budget{
		Budget: &runtimev1.AgentBudgetEventDetail{
			BudgetExhausted: false,
			RemainingTokens: remainingTokens(entry.Agent.GetAutonomy()),
			WindowStartedAt: cloneTimestamp(entry.Agent.GetAutonomy().GetWindowStartedAt()),
		},
	})
	if err := r.svc.updateAgent(entry, event); err != nil {
		return nil, err
	}
	return &runtimev1.DisableAutonomyResponse{Autonomy: cloneAutonomy(entry.Agent.GetAutonomy())}, nil
}

func (r agentAdminRuntime) setAutonomyConfig(req *runtimev1.SetAutonomyConfigRequest) (*runtimev1.SetAutonomyConfigResponse, error) {
	if req.GetConfig() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	entry, err := r.svc.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	config := normalizeAutonomyConfig(req.GetConfig())
	if entry.Agent.Autonomy == nil {
		entry.Agent.Autonomy = buildInitialAutonomyState(config, now)
	} else {
		entry.Agent.Autonomy.Config = config
	}
	entry.Agent.Autonomy.SuspendedUntil = cloneTimestamp(config.GetSuspendUntil())
	if autonomyMode(config) == runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF {
		entry.Agent.Autonomy.Enabled = false
		entry.Agent.Autonomy.BudgetExhausted = false
	} else {
		entry.Agent.Autonomy.BudgetExhausted = entry.Agent.Autonomy.GetConfig().GetDailyTokenBudget() > 0 &&
			entry.Agent.Autonomy.GetUsedTokensInWindow() >= entry.Agent.Autonomy.GetConfig().GetDailyTokenBudget()
	}
	entry.Agent.UpdatedAt = timestamppb.New(now)
	event := r.svc.newEvent(entry.Agent.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_BUDGET, &runtimev1.AgentEvent_Budget{
		Budget: &runtimev1.AgentBudgetEventDetail{
			BudgetExhausted: entry.Agent.GetAutonomy().GetBudgetExhausted(),
			RemainingTokens: remainingTokens(entry.Agent.GetAutonomy()),
			WindowStartedAt: cloneTimestamp(entry.Agent.GetAutonomy().GetWindowStartedAt()),
		},
	})
	if err := r.svc.updateAgent(entry, event); err != nil {
		return nil, err
	}
	return &runtimev1.SetAutonomyConfigResponse{Autonomy: cloneAutonomy(entry.Agent.GetAutonomy())}, nil
}

func (r agentAdminRuntime) listPendingHooks(req *runtimev1.ListPendingHooksRequest) (*runtimev1.ListPendingHooksResponse, error) {
	entry, err := r.svc.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	items := make([]*runtimev1.PendingHook, 0, len(entry.Hooks))
	for _, hook := range entry.Hooks {
		state := hookAdmissionState(hook)
		if req.GetAdmissionStateFilter() == runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_UNSPECIFIED && !isCancelableAdmissionState(state) {
			continue
		}
		if req.GetTriggerFamilyFilter() != runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_UNSPECIFIED &&
			hook.GetIntent().GetTriggerFamily() != req.GetTriggerFamilyFilter() {
			continue
		}
		if req.GetAdmissionStateFilter() != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_UNSPECIFIED &&
			state != req.GetAdmissionStateFilter() {
			continue
		}
		items = append(items, clonePendingHook(hook))
	}
	sort.Slice(items, func(i, j int) bool {
		left := items[i].GetScheduledFor().AsTime()
		right := items[j].GetScheduledFor().AsTime()
		if left.Equal(right) {
			return hookIntentID(items[i]) < hookIntentID(items[j])
		}
		return left.Before(right)
	})
	start, end, next, err := pageBounds(req.GetPageToken(), req.GetPageSize(), defaultHookPageSize, maxHookPageSize, len(items))
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListPendingHooksResponse{Hooks: items[start:end], NextPageToken: next}, nil
}

func (r agentAdminRuntime) cancelHook(req *runtimev1.CancelHookRequest) (*runtimev1.CancelHookResponse, error) {
	outcome, err := r.svc.cancelHook(strings.TrimSpace(req.GetAgentId()), strings.TrimSpace(req.GetIntentId()), "app", req.GetReason())
	if err != nil {
		return nil, err
	}
	return &runtimev1.CancelHookResponse{Outcome: outcome}, nil
}
