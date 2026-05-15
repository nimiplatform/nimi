package runtimeagent

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

type persistedRuntimeAgentState struct {
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
	return s.agentStateRuntime().agentByID(agentID)
}

func (s *Service) insertAgent(entry *agentEntry, events ...*runtimev1.AgentEvent) error {
	return s.agentStateRuntime().insertAgent(entry, events...)
}

func (s *Service) updateAgent(entry *agentEntry, events ...*runtimev1.AgentEvent) error {
	return s.agentStateRuntime().updateAgent(entry, events...)
}

func (s *Service) appendEventsLocked(events ...*runtimev1.AgentEvent) []*runtimev1.AgentEvent {
	return s.eventStreamRuntime().appendEventsLocked(events...)
}

func (s *Service) matchingSubscribersLocked(events []*runtimev1.AgentEvent) [][]*subscriber {
	return s.eventStreamRuntime().matchingSubscribersLocked(events)
}

func (s *Service) broadcast(events []*runtimev1.AgentEvent, targetsByEvent [][]*subscriber) {
	s.eventStreamRuntime().broadcast(events, targetsByEvent)
}

func (s *Service) removeSubscriber(id uint64) {
	s.eventStreamRuntime().removeSubscriber(id)
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

func (s *Service) loadState() error {
	return s.agentStateRuntime().loadState()
}

func (s *Service) saveStateLocked() error {
	return s.agentStateRuntime().saveStateLocked()
}

func (s *Service) runtimeAgentMetaValue(key string) (string, error) {
	return s.agentStateRuntime().metaValue(key)
}

func (s *Service) markRuntimeAgentStateInitialized(sequence uint64) error {
	return s.agentStateRuntime().markInitialized(sequence)
}

func (r *runtimeAgentStateRepository) loadState(s *Service) error {
	if r == nil || r.backend == nil {
		return nil
	}
	initialized, err := r.runtimeAgentMetaValue("state_initialized")
	if err != nil {
		return err
	}
	if initialized != "1" {
		if err := r.markRuntimeAgentStateInitialized(0); err != nil {
			return err
		}
	}
	return r.loadStateFromDB(s)
}

func (r *runtimeAgentStateRepository) saveStateLocked(s *Service) error {
	persisted := persistedRuntimeAgentState{
		SchemaVersion: runtimeAgentStateSchemaVersion,
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
	if _, err := json.MarshalIndent(persisted, "", "  "); err != nil {
		return fmt.Errorf("marshal runtime agent state file: %w", err)
	}
	return r.persistSnapshot(persisted)
}

func (r *runtimeAgentStateRepository) loadStateFromDB(s *Service) error {
	for key := range s.agents {
		delete(s.agents, key)
	}
	s.events = s.events[:0]
	rows, err := r.backend.DB().Query(`SELECT local_agent_ref, agent_json FROM runtime_local_agent ORDER BY local_agent_ref`)
	if err != nil {
		return fmt.Errorf("load runtime agent records: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var localAgentRef string
		var agentRaw string
		if err := rows.Scan(&localAgentRef, &agentRaw); err != nil {
			return err
		}
		agent := &runtimev1.AgentRecord{}
		if err := protojson.Unmarshal([]byte(agentRaw), agent); err != nil {
			return fmt.Errorf("parse persisted agent %s: %w", localAgentRef, err)
		}
		if strings.TrimSpace(agent.GetLocalAgentRef()) != localAgentRef || strings.TrimSpace(agent.GetOwnerUserId()) == "" || strings.TrimSpace(agent.GetRealmAgentId()) == "" {
			return fmt.Errorf("persisted runtime agent %s local identity invalid", localAgentRef)
		}
		s.agents[localAgentRef] = &agentEntry{
			Agent: agent,
			State: &runtimev1.AgentStateProjection{},
			Hooks: map[string]*runtimev1.PendingHook{},
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	stateRows, err := r.backend.DB().Query(`SELECT local_agent_ref, state_json FROM runtime_local_agent_state_projection ORDER BY local_agent_ref`)
	if err != nil {
		return fmt.Errorf("load runtime agent states: %w", err)
	}
	defer func() { _ = stateRows.Close() }()
	for stateRows.Next() {
		var localAgentRef string
		var stateRaw string
		if err := stateRows.Scan(&localAgentRef, &stateRaw); err != nil {
			return err
		}
		entry := s.agents[localAgentRef]
		if entry == nil {
			continue
		}
		state := &runtimev1.AgentStateProjection{}
		if err := protojson.Unmarshal([]byte(stateRaw), state); err != nil {
			return fmt.Errorf("parse persisted agent state %s: %w", localAgentRef, err)
		}
		entry.State = state
	}
	hookRows, err := r.backend.DB().Query(`SELECT local_agent_ref, hook_json FROM runtime_local_agent_hook ORDER BY local_agent_ref, scheduled_for, hook_id`)
	if err != nil {
		return fmt.Errorf("load runtime agent hooks: %w", err)
	}
	defer func() { _ = hookRows.Close() }()
	for hookRows.Next() {
		var localAgentRef string
		var hookRaw string
		if err := hookRows.Scan(&localAgentRef, &hookRaw); err != nil {
			return err
		}
		entry := s.agents[localAgentRef]
		if entry == nil {
			continue
		}
		hook := &runtimev1.PendingHook{}
		if err := protojson.Unmarshal([]byte(hookRaw), hook); err != nil {
			return fmt.Errorf("parse persisted hook %s: %w", localAgentRef, err)
		}
		entry.Hooks[hookIntentID(hook)] = hook
	}
	eventRows, err := r.backend.DB().Query(`SELECT event_json FROM runtime_local_agent_event_log ORDER BY sequence`)
	if err != nil {
		return fmt.Errorf("load runtime agent events: %w", err)
	}
	defer func() { _ = eventRows.Close() }()
	for eventRows.Next() {
		var eventRaw string
		if err := eventRows.Scan(&eventRaw); err != nil {
			return err
		}
		event := &runtimev1.AgentEvent{}
		if err := protojson.Unmarshal([]byte(eventRaw), event); err != nil {
			return fmt.Errorf("parse persisted agent event: %w", err)
		}
		s.events = append(s.events, event)
	}
	seq, err := r.runtimeAgentMetaValue("agent_event_sequence")
	if err != nil {
		return err
	}
	if strings.TrimSpace(seq) != "" {
		value, err := decodeSequenceValue(seq)
		if err != nil {
			return err
		}
		s.sequence = value
	}
	return nil
}

func (r *runtimeAgentStateRepository) persistSnapshot(persisted persistedRuntimeAgentState) error {
	return r.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM runtime_local_agent`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM runtime_local_agent_state_projection`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM runtime_local_agent_hook`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM runtime_local_agent_event_log`); err != nil {
			return err
		}
		for _, item := range persisted.Agents {
			agent := &runtimev1.AgentRecord{}
			if err := protojson.Unmarshal(item.Agent, agent); err != nil {
				return err
			}
			localAgentRef := strings.TrimSpace(agent.GetLocalAgentRef())
			if localAgentRef == "" {
				return fmt.Errorf("persist runtime agent missing local_agent_ref")
			}
			if _, err := tx.Exec(`INSERT INTO runtime_local_agent(local_agent_ref, agent_json) VALUES (?, ?)`, localAgentRef, string(item.Agent)); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO runtime_local_agent_state_projection(local_agent_ref, state_json) VALUES (?, ?)`, localAgentRef, string(item.State)); err != nil {
				return err
			}
			for _, hookRaw := range item.Hooks {
				hook := &runtimev1.PendingHook{}
				if err := protojson.Unmarshal(hookRaw, hook); err != nil {
					return err
				}
				if _, err := tx.Exec(`INSERT INTO runtime_local_agent_hook(local_agent_ref, hook_id, status, scheduled_for, hook_json) VALUES (?, ?, ?, ?, ?)`, localAgentRef, hookIntentID(hook), int(hookAdmissionState(hook)), timestampString(hook.GetScheduledFor()), string(hookRaw)); err != nil {
					return err
				}
			}
		}
		for _, eventRaw := range persisted.Events {
			event := &runtimev1.AgentEvent{}
			if err := protojson.Unmarshal(eventRaw, event); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO runtime_local_agent_event_log(sequence, local_agent_ref, event_type, timestamp, event_json) VALUES (?, ?, ?, ?, ?)`, event.GetSequence(), event.GetLocalAgentRef(), int(event.GetEventType()), timestampString(event.GetTimestamp()), string(eventRaw)); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES ('state_initialized','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value`); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES ('agent_event_sequence', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, encodeSequenceValue(persisted.Sequence)); err != nil {
			return err
		}
		return nil
	})
}

func (r *runtimeAgentStateRepository) runtimeAgentMetaValue(key string) (string, error) {
	var value string
	err := r.backend.DB().QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, key).Scan(&value)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return value, nil
}

func (r *runtimeAgentStateRepository) markRuntimeAgentStateInitialized(sequence uint64) error {
	return r.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES ('state_initialized','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value`); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES ('agent_event_sequence', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, encodeSequenceValue(sequence)); err != nil {
			return err
		}
		return nil
	})
}
