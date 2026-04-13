package agentcore

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
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

const (
	agentCoreMetaLegacyImportSourcePathKey          = "legacy_import_source_path"
	agentCoreMetaLegacyImportSourceSHA256Key        = "legacy_import_source_sha256"
	agentCoreMetaLegacyImportSourceSchemaVersionKey = "legacy_import_source_schema_version"
	agentCoreMetaLegacyImportedAtKey                = "legacy_imported_at"
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
	if s.backend == nil {
		return nil
	}
	initialized, err := s.agentCoreMetaValue("state_initialized")
	if err != nil {
		return err
	}
	if initialized != "1" {
		if err := s.importLegacyStateIfPresent(); err != nil {
			return err
		}
	}
	return s.loadStateFromDB()
}

func (s *Service) saveStateLocked() error {
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
	if _, err := json.MarshalIndent(persisted, "", "  "); err != nil {
		return fmt.Errorf("marshal agent core state file: %w", err)
	}
	return s.persistSnapshot(persisted)
}

func (s *Service) importLegacyStateIfPresent() error {
	if strings.TrimSpace(s.statePath) == "" {
		return s.markAgentCoreStateInitialized(0)
	}
	data, err := os.ReadFile(s.statePath)
	if err != nil {
		if os.IsNotExist(err) {
			return s.markAgentCoreStateInitialized(0)
		}
		return fmt.Errorf("read agent core state: %w", err)
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return s.markAgentCoreStateInitialized(0)
	}
	var persisted persistedAgentCoreState
	if err := json.Unmarshal(data, &persisted); err != nil {
		return fmt.Errorf("parse agent core state: %w", err)
	}
	if persisted.SchemaVersion != 0 && persisted.SchemaVersion != agentCoreStateSchemaVersion {
		return fmt.Errorf("unsupported agent core state schema version %d", persisted.SchemaVersion)
	}
	if err := s.persistSnapshot(persisted); err != nil {
		return err
	}
	if err := s.validateImportedSnapshot(persisted); err != nil {
		_ = s.resetImportedState()
		return err
	}
	if err := s.recordLegacyImportMetadata(s.statePath, data, persisted.SchemaVersion); err != nil {
		_ = s.resetImportedState()
		return err
	}
	return renameImportedAgentCoreState(s.statePath)
}

func (s *Service) loadStateFromDB() error {
	for key := range s.agents {
		delete(s.agents, key)
	}
	s.events = s.events[:0]
	rows, err := s.backend.DB().Query(`SELECT agent_id, agent_json FROM agentcore_agent ORDER BY agent_id`)
	if err != nil {
		return fmt.Errorf("load agentcore agents: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var agentID string
		var agentRaw string
		if err := rows.Scan(&agentID, &agentRaw); err != nil {
			return err
		}
		agent := &runtimev1.AgentRecord{}
		if err := protojson.Unmarshal([]byte(agentRaw), agent); err != nil {
			return fmt.Errorf("parse persisted agent %s: %w", agentID, err)
		}
		s.agents[agentID] = &agentEntry{
			Agent: agent,
			State: &runtimev1.AgentStateProjection{},
			Hooks: map[string]*runtimev1.PendingHook{},
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	stateRows, err := s.backend.DB().Query(`SELECT agent_id, state_json FROM agentcore_state_projection ORDER BY agent_id`)
	if err != nil {
		return fmt.Errorf("load agentcore states: %w", err)
	}
	defer stateRows.Close()
	for stateRows.Next() {
		var agentID string
		var stateRaw string
		if err := stateRows.Scan(&agentID, &stateRaw); err != nil {
			return err
		}
		entry := s.agents[agentID]
		if entry == nil {
			continue
		}
		state := &runtimev1.AgentStateProjection{}
		if err := protojson.Unmarshal([]byte(stateRaw), state); err != nil {
			return fmt.Errorf("parse persisted agent state %s: %w", agentID, err)
		}
		entry.State = state
	}
	hookRows, err := s.backend.DB().Query(`SELECT agent_id, hook_json FROM agentcore_hook ORDER BY agent_id, scheduled_for, hook_id`)
	if err != nil {
		return fmt.Errorf("load agentcore hooks: %w", err)
	}
	defer hookRows.Close()
	for hookRows.Next() {
		var agentID string
		var hookRaw string
		if err := hookRows.Scan(&agentID, &hookRaw); err != nil {
			return err
		}
		entry := s.agents[agentID]
		if entry == nil {
			continue
		}
		hook := &runtimev1.PendingHook{}
		if err := protojson.Unmarshal([]byte(hookRaw), hook); err != nil {
			return fmt.Errorf("parse persisted hook %s: %w", agentID, err)
		}
		entry.Hooks[hook.GetHookId()] = hook
	}
	eventRows, err := s.backend.DB().Query(`SELECT event_json FROM agentcore_event_log ORDER BY sequence`)
	if err != nil {
		return fmt.Errorf("load agentcore events: %w", err)
	}
	defer eventRows.Close()
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
	seq, err := s.agentCoreMetaValue("agent_event_sequence")
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

func (s *Service) persistSnapshot(persisted persistedAgentCoreState) error {
	return s.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM agentcore_agent`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM agentcore_state_projection`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM agentcore_hook`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM agentcore_event_log`); err != nil {
			return err
		}
		for _, item := range persisted.Agents {
			agent := &runtimev1.AgentRecord{}
			if err := protojson.Unmarshal(item.Agent, agent); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO agentcore_agent(agent_id, agent_json) VALUES (?, ?)`, agent.GetAgentId(), string(item.Agent)); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO agentcore_state_projection(agent_id, state_json) VALUES (?, ?)`, agent.GetAgentId(), string(item.State)); err != nil {
				return err
			}
			for _, hookRaw := range item.Hooks {
				hook := &runtimev1.PendingHook{}
				if err := protojson.Unmarshal(hookRaw, hook); err != nil {
					return err
				}
				if _, err := tx.Exec(`INSERT INTO agentcore_hook(agent_id, hook_id, status, scheduled_for, hook_json) VALUES (?, ?, ?, ?, ?)`, agent.GetAgentId(), hook.GetHookId(), int(hook.GetStatus()), timestampString(hook.GetScheduledFor()), string(hookRaw)); err != nil {
					return err
				}
			}
		}
		for _, eventRaw := range persisted.Events {
			event := &runtimev1.AgentEvent{}
			if err := protojson.Unmarshal(eventRaw, event); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO agentcore_event_log(sequence, agent_id, event_type, timestamp, event_json) VALUES (?, ?, ?, ?, ?)`, event.GetSequence(), event.GetAgentId(), int(event.GetEventType()), timestampString(event.GetTimestamp()), string(eventRaw)); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`INSERT INTO agentcore_meta(key, value) VALUES ('state_initialized','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value`); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO agentcore_meta(key, value) VALUES ('agent_event_sequence', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, encodeSequenceValue(persisted.Sequence)); err != nil {
			return err
		}
		return nil
	})
}

func (s *Service) agentCoreMetaValue(key string) (string, error) {
	var value string
	err := s.backend.DB().QueryRow(`SELECT value FROM agentcore_meta WHERE key = ?`, key).Scan(&value)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return value, nil
}

func (s *Service) markAgentCoreStateInitialized(sequence uint64) error {
	return s.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO agentcore_meta(key, value) VALUES ('state_initialized','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value`); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO agentcore_meta(key, value) VALUES ('agent_event_sequence', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, encodeSequenceValue(sequence)); err != nil {
			return err
		}
		return nil
	})
}

func (s *Service) validateImportedSnapshot(persisted persistedAgentCoreState) error {
	if s.backend == nil {
		return nil
	}
	expectedAgentCount := len(persisted.Agents)
	expectedHookCount := 0
	for _, item := range persisted.Agents {
		expectedHookCount += len(item.Hooks)
	}
	expectedEventCount := len(persisted.Events)
	var actualAgentCount int
	if err := s.backend.DB().QueryRow(`SELECT COUNT(*) FROM agentcore_agent`).Scan(&actualAgentCount); err != nil {
		return fmt.Errorf("validate imported agents: %w", err)
	}
	if actualAgentCount != expectedAgentCount {
		return fmt.Errorf("validate imported agents: got %d want %d", actualAgentCount, expectedAgentCount)
	}
	var actualHookCount int
	if err := s.backend.DB().QueryRow(`SELECT COUNT(*) FROM agentcore_hook`).Scan(&actualHookCount); err != nil {
		return fmt.Errorf("validate imported hooks: %w", err)
	}
	if actualHookCount != expectedHookCount {
		return fmt.Errorf("validate imported hooks: got %d want %d", actualHookCount, expectedHookCount)
	}
	var actualEventCount int
	if err := s.backend.DB().QueryRow(`SELECT COUNT(*) FROM agentcore_event_log`).Scan(&actualEventCount); err != nil {
		return fmt.Errorf("validate imported events: %w", err)
	}
	if actualEventCount != expectedEventCount {
		return fmt.Errorf("validate imported events: got %d want %d", actualEventCount, expectedEventCount)
	}
	seq, err := s.agentCoreMetaValue("agent_event_sequence")
	if err != nil {
		return err
	}
	value, err := decodeSequenceValue(seq)
	if err != nil {
		return err
	}
	if value != persisted.Sequence {
		return fmt.Errorf("validate imported agent sequence: got %d want %d", value, persisted.Sequence)
	}
	return nil
}

func (s *Service) recordLegacyImportMetadata(path string, raw []byte, schemaVersion int) error {
	importedAt := time.Now().UTC().Format(time.RFC3339Nano)
	digest := sha256.Sum256(raw)
	return s.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		values := map[string]string{
			agentCoreMetaLegacyImportSourcePathKey:          strings.TrimSpace(path),
			agentCoreMetaLegacyImportSourceSHA256Key:        fmt.Sprintf("%x", digest[:]),
			agentCoreMetaLegacyImportSourceSchemaVersionKey: fmt.Sprintf("%d", schemaVersion),
			agentCoreMetaLegacyImportedAtKey:                importedAt,
		}
		for key, value := range values {
			if _, err := tx.Exec(`INSERT INTO agentcore_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Service) resetImportedState() error {
	if s.backend == nil {
		return nil
	}
	return s.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		statements := []string{
			`DELETE FROM agentcore_hook`,
			`DELETE FROM agentcore_event_log`,
			`DELETE FROM agentcore_state_projection`,
			`DELETE FROM agentcore_agent`,
			`DELETE FROM agentcore_review_run`,
			`DELETE FROM agentcore_review_followup`,
			`DELETE FROM agentcore_behavioral_posture`,
			`DELETE FROM agentcore_meta WHERE key IN ('state_initialized', 'agent_event_sequence', ?, ?, ?, ?)`,
		}
		for idx, stmt := range statements {
			if idx == len(statements)-1 {
				if _, err := tx.Exec(stmt,
					agentCoreMetaLegacyImportSourcePathKey,
					agentCoreMetaLegacyImportSourceSHA256Key,
					agentCoreMetaLegacyImportSourceSchemaVersionKey,
					agentCoreMetaLegacyImportedAtKey,
				); err != nil {
					return err
				}
				continue
			}
			if _, err := tx.Exec(stmt); err != nil {
				return err
			}
		}
		return nil
	})
}

func renameImportedAgentCoreState(path string) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	backupPath := path + ".wave3-imported.json.bak"
	if err := os.Rename(path, backupPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("rename legacy agentcore state: %w", err)
	}
	return nil
}
