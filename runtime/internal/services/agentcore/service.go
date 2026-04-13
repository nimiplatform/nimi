package agentcore

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	agentCoreStateSchemaVersion = 1
	defaultAgentPageSize        = 50
	maxAgentPageSize            = 200
	defaultHookPageSize         = 50
	maxHookPageSize             = 200
	maxEventLogSize             = 256
	subscriberBuffer            = 32
)

type persistedAgentCoreState struct {
	SchemaVersion int                   `json:"schemaVersion"`
	SavedAt       string                `json:"savedAt"`
	Sequence      uint64                `json:"sequence"`
	Agents        []persistedAgentState `json:"agents"`
	Events        []json.RawMessage     `json:"events"`
}

type persistedAgentState struct {
	Agent json.RawMessage   `json:"agent"`
	State json.RawMessage   `json:"state"`
	Hooks []json.RawMessage `json:"hooks"`
}

type agentEntry struct {
	Agent *runtimev1.AgentRecord
	State *runtimev1.AgentStateProjection
	Hooks map[string]*runtimev1.PendingHook
}

type subscriber struct {
	id           uint64
	agentID      string
	eventFilters map[runtimev1.AgentEventType]struct{}
	ch           chan *runtimev1.AgentEvent
}

type Service struct {
	runtimev1.UnimplementedRuntimeAgentCoreServiceServer

	logger    *slog.Logger
	memorySvc *memoryservice.Service
	statePath string

	mu               sync.RWMutex
	agents           map[string]*agentEntry
	events           []*runtimev1.AgentEvent
	sequence         uint64
	nextSubscriberID uint64
	subscribers      map[uint64]*subscriber

	lifeLoopMu     sync.Mutex
	lifeExecutor   LifeTrackExecutor
	lifeLoopCancel context.CancelFunc
	lifeLoopDone   chan struct{}
}

func New(logger *slog.Logger, localStatePath string, memorySvc *memoryservice.Service) (*Service, error) {
	if logger == nil {
		logger = slog.Default()
	}
	if memorySvc == nil {
		return nil, fmt.Errorf("memory service is required")
	}
	svc := &Service{
		logger:       logger,
		memorySvc:    memorySvc,
		statePath:    agentCoreStatePath(localStatePath),
		agents:       make(map[string]*agentEntry),
		events:       make([]*runtimev1.AgentEvent, 0, maxEventLogSize),
		subscribers:  make(map[uint64]*subscriber),
		lifeExecutor: rejectingLifeTrackExecutor{},
	}
	if err := svc.loadState(); err != nil {
		return nil, err
	}
	svc.memorySvc.RegisterReplicationObserver(svc.handleCommittedMemoryReplication)
	return svc, nil
}

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

func (s *Service) QueryAgentMemory(ctx context.Context, req *runtimev1.QueryAgentMemoryRequest) (*runtimev1.QueryAgentMemoryResponse, error) {
	entry, err := s.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	if requiresExplicitWorldSharedAdmission(req.GetCanonicalClasses()) && validateWorldSharedAgentState(entry) != nil {
		return nil, worldSharedAdmissionError()
	}
	queries := s.queryLocatorsForAgent(entry, req.GetCanonicalClasses())
	views := make([]*runtimev1.CanonicalMemoryView, 0)
	limit := req.GetLimit()
	if limit <= 0 {
		limit = 10
	}
	queryText := strings.TrimSpace(req.GetQuery())
	for _, locator := range queries {
		if _, err := s.memorySvc.GetBank(ctx, &runtimev1.GetBankRequest{Locator: locator}); err != nil {
			if status.Code(err) == codes.NotFound {
				continue
			}
			return nil, err
		}
		if queryText == "" {
			historyResp, err := s.memorySvc.History(ctx, &runtimev1.HistoryRequest{
				Bank: locator,
				Query: &runtimev1.MemoryHistoryQuery{
					Kinds:              append([]runtimev1.MemoryRecordKind(nil), req.GetKinds()...),
					PageSize:           limit,
					IncludeInvalidated: req.GetIncludeInvalidated(),
				},
			})
			if err != nil {
				return nil, err
			}
			for _, record := range historyResp.GetRecords() {
				if record == nil {
					continue
				}
				views = append(views, &runtimev1.CanonicalMemoryView{
					CanonicalClass: record.GetCanonicalClass(),
					SourceBank:     cloneLocator(record.GetBank()),
					Record:         cloneMemoryRecord(record),
					RecallScore:    0,
					PolicyReason:   "query_agent_memory_history",
				})
			}
			continue
		}
		resp, err := s.memorySvc.Recall(ctx, &runtimev1.RecallRequest{
			Bank: locator,
			Query: &runtimev1.MemoryRecallQuery{
				Query:              queryText,
				Kinds:              append([]runtimev1.MemoryRecordKind(nil), req.GetKinds()...),
				Limit:              limit,
				CanonicalClasses:   append([]runtimev1.MemoryCanonicalClass(nil), req.GetCanonicalClasses()...),
				IncludeInvalidated: req.GetIncludeInvalidated(),
			},
		})
		if err != nil {
			return nil, err
		}
		for _, hit := range resp.GetHits() {
			if hit.GetRecord() == nil {
				continue
			}
			views = append(views, &runtimev1.CanonicalMemoryView{
				CanonicalClass: hit.GetRecord().GetCanonicalClass(),
				SourceBank:     cloneLocator(hit.GetRecord().GetBank()),
				Record:         cloneMemoryRecord(hit.GetRecord()),
				RecallScore:    hit.GetRelevanceScore(),
				PolicyReason:   "query_agent_memory",
			})
		}
	}
	sort.Slice(views, func(i, j int) bool {
		if views[i].GetRecallScore() == views[j].GetRecallScore() {
			leftUpdated := views[i].GetRecord().GetUpdatedAt().AsTime()
			rightUpdated := views[j].GetRecord().GetUpdatedAt().AsTime()
			if !leftUpdated.Equal(rightUpdated) {
				return leftUpdated.After(rightUpdated)
			}
			return views[i].GetRecord().GetMemoryId() < views[j].GetRecord().GetMemoryId()
		}
		return views[i].GetRecallScore() > views[j].GetRecallScore()
	})
	if int(limit) < len(views) {
		views = views[:limit]
	}
	return &runtimev1.QueryAgentMemoryResponse{Memories: views}, nil
}

func (s *Service) WriteAgentMemory(ctx context.Context, req *runtimev1.WriteAgentMemoryRequest) (*runtimev1.WriteAgentMemoryResponse, error) {
	if len(req.GetCandidates()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	entry, err := s.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	accepted := make([]*runtimev1.CanonicalMemoryView, 0, len(req.GetCandidates()))
	rejected := make([]*runtimev1.CanonicalMemoryRejection, 0)
	for _, candidate := range req.GetCandidates() {
		if rejection := validateWorldSharedCandidateAdmission(entry, candidate); rejection != nil {
			rejected = append(rejected, rejection)
			continue
		}
		view, rejection := s.writeCandidate(ctx, entry, candidate)
		if rejection != nil {
			rejected = append(rejected, rejection)
			continue
		}
		if view != nil {
			accepted = append(accepted, view)
		}
	}
	if len(accepted) > 0 || len(rejected) > 0 {
		events := []*runtimev1.AgentEvent{s.newEvent(entry.Agent.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_MEMORY, &runtimev1.AgentEvent_Memory{
			Memory: &runtimev1.AgentMemoryEventDetail{
				Accepted: cloneCanonicalMemoryViews(accepted),
				Rejected: cloneCanonicalMemoryRejections(rejected),
			},
		})}
		if err := s.updateAgent(entry, events...); err != nil {
			return nil, err
		}
	}
	return &runtimev1.WriteAgentMemoryResponse{Accepted: accepted, Rejected: rejected}, nil
}

func (s *Service) SubscribeAgentEvents(req *runtimev1.SubscribeAgentEventsRequest, stream runtimev1.RuntimeAgentCoreService_SubscribeAgentEventsServer) error {
	filterMap := make(map[runtimev1.AgentEventType]struct{}, len(req.GetEventFilters()))
	for _, filter := range req.GetEventFilters() {
		if filter != runtimev1.AgentEventType_AGENT_EVENT_TYPE_UNSPECIFIED {
			filterMap[filter] = struct{}{}
		}
	}
	cursor, err := decodeCursor(req.GetCursor())
	if err != nil {
		return err
	}
	sub := &subscriber{
		agentID:      strings.TrimSpace(req.GetAgentId()),
		eventFilters: filterMap,
		ch:           make(chan *runtimev1.AgentEvent, subscriberBuffer),
	}
	s.mu.Lock()
	s.nextSubscriberID++
	sub.id = s.nextSubscriberID
	s.subscribers[sub.id] = sub
	backlog := make([]*runtimev1.AgentEvent, 0, len(s.events))
	for _, event := range s.events {
		if event.GetSequence() <= cursor {
			continue
		}
		if subscriberMatchesEvent(sub, event) {
			backlog = append(backlog, cloneAgentEvent(event))
		}
	}
	s.mu.Unlock()
	defer s.removeSubscriber(sub.id)

	for _, event := range backlog {
		if err := stream.Send(event); err != nil {
			return err
		}
	}
	for {
		select {
		case <-stream.Context().Done():
			return stream.Context().Err()
		case event, ok := <-sub.ch:
			if !ok {
				return nil
			}
			if err := stream.Send(cloneAgentEvent(event)); err != nil {
				return err
			}
		}
	}
}

func (s *Service) writeCandidate(ctx context.Context, entry *agentEntry, candidate *runtimev1.CanonicalMemoryCandidate) (*runtimev1.CanonicalMemoryView, *runtimev1.CanonicalMemoryRejection) {
	if candidate == nil || candidate.GetRecord() == nil || candidate.GetTargetBank() == nil {
		return nil, rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "candidate target_bank and record are required")
	}
	if err := validateCandidateLocator(entry.Agent.GetAgentId(), candidate); err != nil {
		return nil, rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, err.Error())
	}
	if _, err := s.memorySvc.EnsureCanonicalBank(ctx, cloneLocator(candidate.GetTargetBank()), canonicalBankDisplayName(candidate.GetTargetBank()), nil); err != nil {
		return nil, rejection(candidate, reasonCodeFromError(err), err.Error())
	}
	input := cloneMemoryRecordInput(candidate.GetRecord())
	input.CanonicalClass = candidate.GetCanonicalClass()
	resp, err := s.memorySvc.Retain(ctx, &runtimev1.RetainRequest{
		Bank:    cloneLocator(candidate.GetTargetBank()),
		Records: []*runtimev1.MemoryRecordInput{input},
	})
	if err != nil {
		return nil, rejection(candidate, reasonCodeFromError(err), err.Error())
	}
	if len(resp.GetRecords()) == 0 {
		return nil, rejection(candidate, runtimev1.ReasonCode_AI_OUTPUT_INVALID, "memory retain returned no records")
	}
	record := resp.GetRecords()[0]
	return &runtimev1.CanonicalMemoryView{
		CanonicalClass: candidate.GetCanonicalClass(),
		SourceBank:     cloneLocator(record.GetBank()),
		Record:         cloneMemoryRecord(record),
		RecallScore:    1,
		PolicyReason:   firstNonEmpty(strings.TrimSpace(candidate.GetPolicyReason()), "write_agent_memory"),
	}, nil
}

func validateCandidateLocator(agentID string, candidate *runtimev1.CanonicalMemoryCandidate) error {
	locator := candidate.GetTargetBank()
	switch candidate.GetCanonicalClass() {
	case runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED:
		if locator.GetScope() != runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE || locator.GetAgentCore() == nil {
			return fmt.Errorf("public_shared candidate must target agent_core bank")
		}
		if strings.TrimSpace(locator.GetAgentCore().GetAgentId()) != strings.TrimSpace(agentID) {
			return fmt.Errorf("agent_core bank must match agent_id")
		}
	case runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC:
		if locator.GetScope() != runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC || locator.GetAgentDyadic() == nil {
			return fmt.Errorf("dyadic candidate must target agent_dyadic bank")
		}
		if strings.TrimSpace(locator.GetAgentDyadic().GetAgentId()) != strings.TrimSpace(agentID) || strings.TrimSpace(locator.GetAgentDyadic().GetUserId()) == "" {
			return fmt.Errorf("agent_dyadic bank must match agent_id and user_id")
		}
	case runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED:
		if locator.GetScope() != runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED || locator.GetWorldShared() == nil {
			return fmt.Errorf("world_shared candidate must target world_shared bank")
		}
		if strings.TrimSpace(locator.GetWorldShared().GetWorldId()) == "" {
			return fmt.Errorf("world_shared bank requires world_id")
		}
	default:
		return fmt.Errorf("canonical memory candidate requires admitted canonical class")
	}
	return nil
}

func (s *Service) queryLocatorsForAgent(entry *agentEntry, classes []runtimev1.MemoryCanonicalClass) []*runtimev1.MemoryBankLocator {
	includeAll := len(classes) == 0
	include := func(class runtimev1.MemoryCanonicalClass) bool {
		if includeAll {
			return true
		}
		for _, item := range classes {
			if item == class {
				return true
			}
		}
		return false
	}
	locators := []*runtimev1.MemoryBankLocator{}
	if include(runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED) {
		locators = append(locators, &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: entry.Agent.GetAgentId()},
			},
		})
	}
	if include(runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC) && strings.TrimSpace(entry.State.GetActiveUserId()) != "" {
		locators = append(locators, &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
			Owner: &runtimev1.MemoryBankLocator_AgentDyadic{
				AgentDyadic: &runtimev1.AgentDyadicBankOwner{
					AgentId: entry.Agent.GetAgentId(),
					UserId:  entry.State.GetActiveUserId(),
				},
			},
		})
	}
	if include(runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED) && strings.TrimSpace(entry.State.GetActiveWorldId()) != "" {
		locators = append(locators, &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED,
			Owner: &runtimev1.MemoryBankLocator_WorldShared{
				WorldShared: &runtimev1.WorldSharedBankOwner{
					WorldId: entry.State.GetActiveWorldId(),
				},
			},
		})
	}
	return locators
}

func (s *Service) agentByID(agentID string) (*agentEntry, error) {
	if agentID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	s.mu.RLock()
	entry := cloneAgentEntry(s.agents[agentID])
	s.mu.RUnlock()
	if entry == nil {
		return nil, status.Error(codes.NotFound, "agent not found")
	}
	return entry, nil
}

func (s *Service) insertAgent(entry *agentEntry, events ...*runtimev1.AgentEvent) error {
	s.mu.Lock()
	previousEntry, hadEntry := s.agents[entry.Agent.GetAgentId()]
	previousEvents := append([]*runtimev1.AgentEvent(nil), s.events...)
	previousSequence := s.sequence
	s.agents[entry.Agent.GetAgentId()] = cloneAgentEntry(entry)
	committedEvents := s.appendEventsLocked(events...)
	if err := s.saveStateLocked(); err != nil {
		if hadEntry {
			s.agents[entry.Agent.GetAgentId()] = previousEntry
		} else {
			delete(s.agents, entry.Agent.GetAgentId())
		}
		s.events = previousEvents
		s.sequence = previousSequence
		s.mu.Unlock()
		return err
	}
	targetsByEvent := s.matchingSubscribersLocked(committedEvents)
	s.mu.Unlock()
	s.broadcast(committedEvents, targetsByEvent)
	return nil
}

func (s *Service) updateAgent(entry *agentEntry, events ...*runtimev1.AgentEvent) error {
	s.mu.Lock()
	previousEntry, hadEntry := s.agents[entry.Agent.GetAgentId()]
	previousEvents := append([]*runtimev1.AgentEvent(nil), s.events...)
	previousSequence := s.sequence
	s.agents[entry.Agent.GetAgentId()] = cloneAgentEntry(entry)
	committedEvents := s.appendEventsLocked(events...)
	if err := s.saveStateLocked(); err != nil {
		if hadEntry {
			s.agents[entry.Agent.GetAgentId()] = previousEntry
		} else {
			delete(s.agents, entry.Agent.GetAgentId())
		}
		s.events = previousEvents
		s.sequence = previousSequence
		s.mu.Unlock()
		return err
	}
	targetsByEvent := s.matchingSubscribersLocked(committedEvents)
	s.mu.Unlock()
	s.broadcast(committedEvents, targetsByEvent)
	return nil
}

func (s *Service) appendEventsLocked(events ...*runtimev1.AgentEvent) []*runtimev1.AgentEvent {
	committed := make([]*runtimev1.AgentEvent, 0, len(events))
	for _, event := range events {
		if event == nil {
			continue
		}
		cloned := cloneAgentEvent(event)
		s.sequence++
		cloned.Sequence = s.sequence
		s.events = append(s.events, cloned)
		if len(s.events) > maxEventLogSize {
			s.events = append([]*runtimev1.AgentEvent(nil), s.events[len(s.events)-maxEventLogSize:]...)
		}
		committed = append(committed, cloned)
	}
	return committed
}

func (s *Service) matchingSubscribersLocked(events []*runtimev1.AgentEvent) [][]*subscriber {
	targetsByEvent := make([][]*subscriber, 0, len(events))
	for _, event := range events {
		targets := make([]*subscriber, 0, len(s.subscribers))
		for _, sub := range s.subscribers {
			if subscriberMatchesEvent(sub, event) {
				targets = append(targets, sub)
			}
		}
		targetsByEvent = append(targetsByEvent, targets)
	}
	return targetsByEvent
}

func (s *Service) broadcast(events []*runtimev1.AgentEvent, targetsByEvent [][]*subscriber) {
	for i, event := range events {
		if i >= len(targetsByEvent) {
			return
		}
		for _, sub := range targetsByEvent[i] {
			cloned := cloneAgentEvent(event)
			select {
			case sub.ch <- cloned:
				continue
			default:
			}
			select {
			case <-sub.ch:
			default:
			}
			select {
			case sub.ch <- cloned:
			default:
			}
		}
	}
}

func (s *Service) newEvent(agentID string, eventType runtimev1.AgentEventType, detail any) *runtimev1.AgentEvent {
	return s.newEventAt(agentID, eventType, detail, time.Now().UTC())
}

func (s *Service) newEventAt(agentID string, eventType runtimev1.AgentEventType, detail any, observedAt time.Time) *runtimev1.AgentEvent {
	event := &runtimev1.AgentEvent{
		EventType: eventType,
		AgentId:   agentID,
		Timestamp: timestamppb.New(observedAt.UTC()),
	}
	switch typed := detail.(type) {
	case *runtimev1.AgentEvent_Lifecycle:
		event.Detail = typed
	case *runtimev1.AgentEvent_Hook:
		event.Detail = typed
	case *runtimev1.AgentEvent_Memory:
		event.Detail = typed
	case *runtimev1.AgentEvent_Budget:
		event.Detail = typed
	case *runtimev1.AgentEvent_Replication:
		event.Detail = typed
	}
	return event
}

func (s *Service) SetLifeTrackExecutor(executor LifeTrackExecutor) {
	s.lifeLoopMu.Lock()
	defer s.lifeLoopMu.Unlock()
	if executor == nil {
		s.lifeExecutor = rejectingLifeTrackExecutor{}
		return
	}
	s.lifeExecutor = executor
}

func (s *Service) StartLifeTrackLoop(parent context.Context) error {
	if parent == nil {
		parent = context.Background()
	}
	s.lifeLoopMu.Lock()
	defer s.lifeLoopMu.Unlock()
	if s.lifeLoopDone != nil {
		return nil
	}
	ctx, cancel := context.WithCancel(parent)
	done := make(chan struct{})
	s.lifeLoopCancel = cancel
	s.lifeLoopDone = done
	go s.runLifeTrackLoop(ctx, done)
	return nil
}

func (s *Service) StopLifeTrackLoop() {
	s.lifeLoopMu.Lock()
	cancel := s.lifeLoopCancel
	done := s.lifeLoopDone
	s.lifeLoopCancel = nil
	s.lifeLoopDone = nil
	s.lifeLoopMu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
}

func (s *Service) removeSubscriber(id uint64) {
	s.mu.Lock()
	sub := s.subscribers[id]
	delete(s.subscribers, id)
	s.mu.Unlock()
	if sub != nil {
		close(sub.ch)
	}
}

func subscriberMatchesEvent(sub *subscriber, event *runtimev1.AgentEvent) bool {
	if sub == nil || event == nil {
		return false
	}
	if sub.agentID != "" && sub.agentID != event.GetAgentId() {
		return false
	}
	if len(sub.eventFilters) == 0 {
		return true
	}
	_, ok := sub.eventFilters[event.GetEventType()]
	return ok
}

func agentCoreStatePath(localStatePath string) string {
	trimmed := strings.TrimSpace(localStatePath)
	if trimmed == "" {
		home, err := os.UserHomeDir()
		if err != nil || strings.TrimSpace(home) == "" {
			return ""
		}
		return filepath.Join(home, ".nimi", "runtime", "agent-core-state.json")
	}
	return filepath.Join(filepath.Dir(trimmed), "agent-core-state.json")
}

func (s *Service) loadState() error {
	if strings.TrimSpace(s.statePath) == "" {
		return nil
	}
	data, err := os.ReadFile(s.statePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read agent core state: %w", err)
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return nil
	}
	var persisted persistedAgentCoreState
	if err := json.Unmarshal(data, &persisted); err != nil {
		return fmt.Errorf("parse agent core state: %w", err)
	}
	if persisted.SchemaVersion != 0 && persisted.SchemaVersion != agentCoreStateSchemaVersion {
		return fmt.Errorf("unsupported agent core state schema version %d", persisted.SchemaVersion)
	}
	s.sequence = persisted.Sequence
	for _, item := range persisted.Agents {
		agent := &runtimev1.AgentRecord{}
		state := &runtimev1.AgentStateProjection{}
		if err := protojson.Unmarshal(item.Agent, agent); err != nil {
			return fmt.Errorf("parse persisted agent: %w", err)
		}
		if err := protojson.Unmarshal(item.State, state); err != nil {
			return fmt.Errorf("parse persisted agent state: %w", err)
		}
		entry := &agentEntry{Agent: agent, State: state, Hooks: map[string]*runtimev1.PendingHook{}}
		for _, raw := range item.Hooks {
			hook := &runtimev1.PendingHook{}
			if err := protojson.Unmarshal(raw, hook); err != nil {
				return fmt.Errorf("parse persisted hook: %w", err)
			}
			entry.Hooks[hook.GetHookId()] = hook
		}
		s.agents[agent.GetAgentId()] = entry
	}
	for _, raw := range persisted.Events {
		event := &runtimev1.AgentEvent{}
		if err := protojson.Unmarshal(raw, event); err != nil {
			return fmt.Errorf("parse persisted agent event: %w", err)
		}
		s.events = append(s.events, event)
	}
	return nil
}

func (s *Service) saveStateLocked() error {
	if strings.TrimSpace(s.statePath) == "" {
		return nil
	}
	dir := filepath.Dir(s.statePath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create agent core state dir: %w", err)
	}
	persisted := persistedAgentCoreState{
		SchemaVersion: agentCoreStateSchemaVersion,
		SavedAt:       time.Now().UTC().Format(time.RFC3339),
		Sequence:      s.sequence,
		Agents:        make([]persistedAgentState, 0, len(s.agents)),
		Events:        make([]json.RawMessage, 0, len(s.events)),
	}
	for _, entry := range s.agents {
		agentRaw, err := protojson.Marshal(entry.Agent)
		if err != nil {
			return fmt.Errorf("marshal agent: %w", err)
		}
		stateRaw, err := protojson.Marshal(entry.State)
		if err != nil {
			return fmt.Errorf("marshal agent state: %w", err)
		}
		item := persistedAgentState{
			Agent: agentRaw,
			State: stateRaw,
			Hooks: make([]json.RawMessage, 0, len(entry.Hooks)),
		}
		for _, hook := range entry.Hooks {
			raw, err := protojson.Marshal(hook)
			if err != nil {
				return fmt.Errorf("marshal hook: %w", err)
			}
			item.Hooks = append(item.Hooks, raw)
		}
		persisted.Agents = append(persisted.Agents, item)
	}
	for _, event := range s.events {
		raw, err := protojson.Marshal(event)
		if err != nil {
			return fmt.Errorf("marshal event: %w", err)
		}
		persisted.Events = append(persisted.Events, raw)
	}
	content, err := json.MarshalIndent(persisted, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal agent core state file: %w", err)
	}
	tmp := s.statePath + ".tmp"
	if err := os.WriteFile(tmp, append(content, '\n'), 0o600); err != nil {
		return fmt.Errorf("write temp agent core state: %w", err)
	}
	if err := os.Rename(tmp, s.statePath); err != nil {
		return fmt.Errorf("rename agent core state: %w", err)
	}
	return nil
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

func remainingTokens(state *runtimev1.AgentAutonomyState) int64 {
	if state == nil || state.GetConfig() == nil || state.GetConfig().GetDailyTokenBudget() <= 0 {
		return 0
	}
	remaining := state.GetConfig().GetDailyTokenBudget() - state.GetUsedTokensInWindow()
	if remaining < 0 {
		return 0
	}
	return remaining
}

func pageBounds(pageToken string, pageSize int32, defaultSize int, maxSize int, total int) (int, int, string, error) {
	offset, err := decodeCursor(pageToken)
	if err != nil {
		return 0, 0, "", err
	}
	size := int(pageSize)
	if size <= 0 {
		size = defaultSize
	}
	if size > maxSize {
		size = maxSize
	}
	start := int(offset)
	if start > total {
		start = total
	}
	end := start + size
	if end > total {
		end = total
	}
	next := ""
	if end < total {
		next = encodeCursor(uint64(end))
	}
	return start, end, next, nil
}

func encodeCursor(offset uint64) string {
	if offset == 0 {
		return ""
	}
	return strconv.FormatUint(offset, 10)
}

func decodeCursor(token string) (uint64, error) {
	trimmed := strings.TrimSpace(token)
	if trimmed == "" {
		return 0, nil
	}
	value, err := strconv.ParseUint(trimmed, 10, 64)
	if err != nil {
		return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return value, nil
}

func rejection(candidate *runtimev1.CanonicalMemoryCandidate, code runtimev1.ReasonCode, message string) *runtimev1.CanonicalMemoryRejection {
	return &runtimev1.CanonicalMemoryRejection{
		SourceEventId: strings.TrimSpace(candidate.GetSourceEventId()),
		ReasonCode:    code,
		Message:       strings.TrimSpace(message),
	}
}

func reasonCodeFromError(err error) runtimev1.ReasonCode {
	if status.Code(err) == codes.Unavailable {
		return runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE
	}
	if status.Code(err) == codes.InvalidArgument {
		return runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID
	}
	return runtimev1.ReasonCode_AI_OUTPUT_INVALID
}

func okAck() *runtimev1.Ack {
	return &runtimev1.Ack{Ok: true}
}

func canonicalBankDisplayName(locator *runtimev1.MemoryBankLocator) string {
	if locator == nil {
		return "Agent Memory"
	}
	switch locator.GetScope() {
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE:
		return "Agent Memory"
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC:
		return "Agent Dyadic Memory"
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED:
		return "World Shared Memory"
	default:
		return "Memory Bank"
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func cloneStruct(input *structpb.Struct) *structpb.Struct {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*structpb.Struct)
}

func cloneTimestamp(input *timestamppb.Timestamp) *timestamppb.Timestamp {
	if input == nil {
		return nil
	}
	return timestamppb.New(input.AsTime())
}

func cloneAutonomyConfig(input *runtimev1.AgentAutonomyConfig) *runtimev1.AgentAutonomyConfig {
	if input == nil {
		return &runtimev1.AgentAutonomyConfig{}
	}
	return proto.Clone(input).(*runtimev1.AgentAutonomyConfig)
}

func cloneAutonomy(input *runtimev1.AgentAutonomyState) *runtimev1.AgentAutonomyState {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.AgentAutonomyState)
}

func cloneAgentRecord(input *runtimev1.AgentRecord) *runtimev1.AgentRecord {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.AgentRecord)
}

func cloneAgentState(input *runtimev1.AgentStateProjection) *runtimev1.AgentStateProjection {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.AgentStateProjection)
}

func clonePendingHook(input *runtimev1.PendingHook) *runtimev1.PendingHook {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.PendingHook)
}

func cloneTriggerDetail(input *runtimev1.HookTriggerDetail) *runtimev1.HookTriggerDetail {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.HookTriggerDetail)
}

func cloneHookOutcome(input *runtimev1.HookExecutionOutcome) *runtimev1.HookExecutionOutcome {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.HookExecutionOutcome)
}

func cloneMemoryRecord(input *runtimev1.MemoryRecord) *runtimev1.MemoryRecord {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryRecord)
}

func cloneMemoryRecordInput(input *runtimev1.MemoryRecordInput) *runtimev1.MemoryRecordInput {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryRecordInput)
}

func cloneLocator(input *runtimev1.MemoryBankLocator) *runtimev1.MemoryBankLocator {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryBankLocator)
}

func cloneCanonicalMemoryViews(input []*runtimev1.CanonicalMemoryView) []*runtimev1.CanonicalMemoryView {
	out := make([]*runtimev1.CanonicalMemoryView, 0, len(input))
	for _, item := range input {
		if item != nil {
			out = append(out, proto.Clone(item).(*runtimev1.CanonicalMemoryView))
		}
	}
	return out
}

func cloneCanonicalMemoryRejections(input []*runtimev1.CanonicalMemoryRejection) []*runtimev1.CanonicalMemoryRejection {
	out := make([]*runtimev1.CanonicalMemoryRejection, 0, len(input))
	for _, item := range input {
		if item != nil {
			out = append(out, proto.Clone(item).(*runtimev1.CanonicalMemoryRejection))
		}
	}
	return out
}

func cloneAgentEvent(input *runtimev1.AgentEvent) *runtimev1.AgentEvent {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.AgentEvent)
}

func cloneAgentEntry(input *agentEntry) *agentEntry {
	if input == nil {
		return nil
	}
	cloned := &agentEntry{
		Agent: cloneAgentRecord(input.Agent),
		State: cloneAgentState(input.State),
		Hooks: make(map[string]*runtimev1.PendingHook, len(input.Hooks)),
	}
	for hookID, hook := range input.Hooks {
		cloned.Hooks[hookID] = clonePendingHook(hook)
	}
	return cloned
}
