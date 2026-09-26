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

func (s *Service) commitAgentEvents(events ...*runtimev1.AgentEvent) error {
	s.mu.Lock()
	previousEvents := append([]*runtimev1.AgentEvent(nil), s.events...)
	previousSequence := s.sequence
	committedEvents := s.eventStreamRuntime().appendEventsLocked(events...)
	if err := s.stateRepo.persistAgentDelta(nil, committedEvents, s.sequence, nil); err != nil {
		s.events = previousEvents
		s.sequence = previousSequence
		s.mu.Unlock()
		return err
	}
	targetsByEvent := s.eventStreamRuntime().matchingSubscribersLocked(committedEvents)
	s.mu.Unlock()
	s.eventStreamRuntime().broadcast(committedEvents, targetsByEvent)
	return nil
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
	return r.saveStateLockedWithTxHook(s, nil)
}

func (r *runtimeAgentStateRepository) saveStateLockedWithTxHook(s *Service, txHook runtimeAgentStateTxHook) error {
	persisted, err := r.snapshotStateLocked(s)
	if err != nil {
		return err
	}
	return r.persistSnapshot(persisted, txHook)
}

// snapshotStateLocked captures the caller-locked Runtime Agent projection
// without performing I/O. Atomic cross-domain transactions can therefore
// prepare the exact row set once and persist it through persistSnapshotTx.
func (r *runtimeAgentStateRepository) snapshotStateLocked(s *Service) (persistedRuntimeAgentState, error) {
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
			return persistedRuntimeAgentState{}, fmt.Errorf("marshal agent: %w", err)
		}
		stateRaw, err := protojson.Marshal(entry.State)
		if err != nil {
			return persistedRuntimeAgentState{}, fmt.Errorf("marshal agent state: %w", err)
		}
		item := persistedAgentState{
			Agent: agentRaw,
			State: stateRaw,
			Hooks: make([]json.RawMessage, 0, len(entry.Hooks)),
		}
		for _, hook := range entry.Hooks {
			raw, err := protojson.Marshal(hook)
			if err != nil {
				return persistedRuntimeAgentState{}, fmt.Errorf("marshal hook: %w", err)
			}
			item.Hooks = append(item.Hooks, raw)
		}
		persisted.Agents = append(persisted.Agents, item)
	}
	for _, event := range s.events {
		raw, err := protojson.Marshal(event)
		if err != nil {
			return persistedRuntimeAgentState{}, fmt.Errorf("marshal event: %w", err)
		}
		persisted.Events = append(persisted.Events, raw)
	}
	return persisted, nil
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
		agent := &runtimev1.LocalAgentRecord{}
		if err := protojson.Unmarshal([]byte(agentRaw), agent); err != nil {
			return fmt.Errorf("parse persisted agent %s: %w", localAgentRef, err)
		}
		if strings.TrimSpace(agent.GetLocalAgentRef()) != localAgentRef || strings.TrimSpace(agent.GetOwnerUserId()) == "" || strings.TrimSpace(agent.GetRuntimeSourceRef()) == "" {
			return fmt.Errorf("persisted runtime agent %s local identity invalid", localAgentRef)
		}
		if err := validatePersistedAgentPresentationProfile(agent); err != nil {
			return fmt.Errorf("persisted runtime agent %s presentation profile invalid: %w", localAgentRef, err)
		}
		if agent.GetAutonomy() == nil {
			agent.Autonomy = buildInitialAutonomyState(nil, time.Now().UTC())
		} else if agent.GetAutonomy().GetRevision() == 0 {
			// Pre-r168 records have no independent autonomy revision. Revision 1
			// is the deterministic migration baseline; no configured value changes.
			agent.Autonomy.Revision = 1
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

// runtimeAgentStateTxHook runs additional row mutations inside the same
// snapshot-rewrite transaction. It is used by the K-AGCORE-141 hard delete to
// purge the agent-scoped projection tables (`runtime_local_agent_behavioral_
// posture`) that `persistSnapshot` does NOT rewrite from in-memory state, so
// row deletion and projection purge either commit together or fail closed.
type runtimeAgentStateTxHook func(*sql.Tx) error

func (r *runtimeAgentStateRepository) persistSnapshot(persisted persistedRuntimeAgentState, txHook runtimeAgentStateTxHook) error {
	return r.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		return r.persistSnapshotTx(tx, persisted, txHook)
	})
}

// persistSnapshotTx rewrites the Runtime Agent projection through a caller-
// owned transaction. Source materialization creation and K-AGCORE-141 hard
// deletion use this seam to commit Agent rows together with their immutable
// source snapshot/provenance and agent-scoped memory projections. It must
// never open a nested Backend transaction.
func (r *runtimeAgentStateRepository) persistSnapshotTx(tx *sql.Tx, persisted persistedRuntimeAgentState, txHook runtimeAgentStateTxHook) error {
	if tx == nil {
		return fmt.Errorf("persist runtime agent snapshot transaction is required")
	}
	refs := make([]string, 0, len(persisted.Agents))
	hooks := []string{}
	sequences := make([]uint64, 0, len(persisted.Events))
	for _, item := range persisted.Agents {
		agent := &runtimev1.LocalAgentRecord{}
		if err := protojson.Unmarshal(item.Agent, agent); err != nil {
			return err
		}
		ref := strings.TrimSpace(agent.GetLocalAgentRef())
		refs = append(refs, ref)
		for _, raw := range item.Hooks {
			hook := &runtimev1.PendingHook{}
			if err := protojson.Unmarshal(raw, hook); err != nil {
				return err
			}
			hooks = append(hooks, ref+"\x00"+hookIntentID(hook))
		}
	}
	for _, raw := range persisted.Events {
		event := &runtimev1.AgentEvent{}
		if err := protojson.Unmarshal(raw, event); err != nil {
			return err
		}
		sequences = append(sequences, event.GetSequence())
	}
	refsJSON, err := json.Marshal(refs)
	if err != nil {
		return err
	}
	hooksJSON, err := json.Marshal(hooks)
	if err != nil {
		return err
	}
	sequencesJSON, err := json.Marshal(sequences)
	if err != nil {
		return err
	}
	for _, table := range []string{"runtime_local_agent", "runtime_local_agent_state_projection"} {
		if _, err := tx.Exec("DELETE FROM "+table+" WHERE local_agent_ref NOT IN (SELECT value FROM json_each(?))", string(refsJSON)); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM runtime_local_agent_hook WHERE local_agent_ref||char(0)||hook_id NOT IN (SELECT value FROM json_each(?))`, string(hooksJSON)); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM runtime_local_agent_event_log WHERE sequence NOT IN (SELECT value FROM json_each(?))`, string(sequencesJSON)); err != nil {
		return err
	}
	for _, item := range persisted.Agents {
		agent := &runtimev1.LocalAgentRecord{}
		if err := protojson.Unmarshal(item.Agent, agent); err != nil {
			return err
		}
		localAgentRef := strings.TrimSpace(agent.GetLocalAgentRef())
		if localAgentRef == "" {
			return fmt.Errorf("persist runtime agent missing local_agent_ref")
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent(local_agent_ref, agent_json) VALUES (?, ?) ON CONFLICT(local_agent_ref) DO UPDATE SET agent_json=excluded.agent_json WHERE agent_json<>excluded.agent_json`, localAgentRef, string(item.Agent)); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_state_projection(local_agent_ref, state_json) VALUES (?, ?) ON CONFLICT(local_agent_ref) DO UPDATE SET state_json=excluded.state_json WHERE state_json<>excluded.state_json`, localAgentRef, string(item.State)); err != nil {
			return err
		}
		for _, hookRaw := range item.Hooks {
			hook := &runtimev1.PendingHook{}
			if err := protojson.Unmarshal(hookRaw, hook); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO runtime_local_agent_hook(local_agent_ref, hook_id, status, scheduled_for, hook_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(local_agent_ref,hook_id) DO UPDATE SET status=excluded.status,scheduled_for=excluded.scheduled_for,hook_json=excluded.hook_json WHERE hook_json<>excluded.hook_json`, localAgentRef, hookIntentID(hook), int(hookAdmissionState(hook)), timestampString(hook.GetScheduledFor()), string(hookRaw)); err != nil {
				return err
			}
		}
	}
	for _, eventRaw := range persisted.Events {
		event := &runtimev1.AgentEvent{}
		if err := protojson.Unmarshal(eventRaw, event); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_event_log(sequence, local_agent_ref, event_type, timestamp, event_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sequence) DO UPDATE SET local_agent_ref=excluded.local_agent_ref,event_type=excluded.event_type,timestamp=excluded.timestamp,event_json=excluded.event_json WHERE event_json<>excluded.event_json`, event.GetSequence(), event.GetLocalAgentRef(), int(event.GetEventType()), timestampString(event.GetTimestamp()), string(eventRaw)); err != nil {
			return err
		}
	}
	if txHook != nil {
		if err := txHook(tx); err != nil {
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
