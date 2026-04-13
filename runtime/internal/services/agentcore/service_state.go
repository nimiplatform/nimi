package agentcore

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
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
