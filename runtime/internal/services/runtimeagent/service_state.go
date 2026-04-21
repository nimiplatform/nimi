package runtimeagent

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
	"google.golang.org/protobuf/encoding/protojson"
)

const (
	runtimeAgentMetaLegacyImportSourcePathKey          = "legacy_import_source_path"
	runtimeAgentMetaLegacyImportSourceSHA256Key        = "legacy_import_source_sha256"
	runtimeAgentMetaLegacyImportSourceSchemaVersionKey = "legacy_import_source_schema_version"
	runtimeAgentMetaLegacyImportedAtKey                = "legacy_imported_at"
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

func runtimeAgentStatePath(localStatePath string) string {
	trimmed := strings.TrimSpace(localStatePath)
	if trimmed == "" {
		home, err := os.UserHomeDir()
		if err != nil || strings.TrimSpace(home) == "" {
			return ""
		}
		return filepath.Join(home, ".nimi", "runtime", "runtime-agent-state.json")
	}
	return filepath.Join(filepath.Dir(trimmed), "runtime-agent-state.json")
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

func (s *Service) resetImportedState() error {
	return s.agentStateRuntime().resetImportedState()
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
		if err := r.importLegacyStateIfPresent(); err != nil {
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

func (r *runtimeAgentStateRepository) importLegacyStateIfPresent() error {
	if strings.TrimSpace(r.legacyStatePath) == "" {
		return r.markRuntimeAgentStateInitialized(0)
	}
	data, err := os.ReadFile(r.legacyStatePath)
	if err != nil {
		if os.IsNotExist(err) {
			return r.markRuntimeAgentStateInitialized(0)
		}
		return fmt.Errorf("read runtime agent state: %w", err)
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return r.markRuntimeAgentStateInitialized(0)
	}
	var persisted persistedRuntimeAgentState
	if err := json.Unmarshal(data, &persisted); err != nil {
		return fmt.Errorf("parse runtime agent state: %w", err)
	}
	if persisted.SchemaVersion != 0 && persisted.SchemaVersion != runtimeAgentStateSchemaVersion {
		return fmt.Errorf("unsupported runtime agent state schema version %d", persisted.SchemaVersion)
	}
	if err := r.persistSnapshot(persisted); err != nil {
		return err
	}
	if err := r.validateImportedSnapshot(persisted); err != nil {
		_ = r.resetImportedState()
		return err
	}
	if err := r.recordLegacyImportMetadata(r.legacyStatePath, data, persisted.SchemaVersion); err != nil {
		_ = r.resetImportedState()
		return err
	}
	return renameImportedRuntimeAgentState(r.legacyStatePath)
}

func (r *runtimeAgentStateRepository) loadStateFromDB(s *Service) error {
	for key := range s.agents {
		delete(s.agents, key)
	}
	s.events = s.events[:0]
	rows, err := r.backend.DB().Query(`SELECT agent_id, agent_json FROM runtime_agent_agent ORDER BY agent_id`)
	if err != nil {
		return fmt.Errorf("load runtime agent records: %w", err)
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
	stateRows, err := r.backend.DB().Query(`SELECT agent_id, state_json FROM runtime_agent_state_projection ORDER BY agent_id`)
	if err != nil {
		return fmt.Errorf("load runtime agent states: %w", err)
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
	hookRows, err := r.backend.DB().Query(`SELECT agent_id, hook_json FROM runtime_agent_hook ORDER BY agent_id, scheduled_for, hook_id`)
	if err != nil {
		return fmt.Errorf("load runtime agent hooks: %w", err)
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
		entry.Hooks[hookIntentID(hook)] = hook
	}
	eventRows, err := r.backend.DB().Query(`SELECT event_json FROM runtime_agent_event_log ORDER BY sequence`)
	if err != nil {
		return fmt.Errorf("load runtime agent events: %w", err)
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
		if _, err := tx.Exec(`DELETE FROM runtime_agent_agent`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM runtime_agent_state_projection`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM runtime_agent_hook`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM runtime_agent_event_log`); err != nil {
			return err
		}
		for _, item := range persisted.Agents {
			agent := &runtimev1.AgentRecord{}
			if err := protojson.Unmarshal(item.Agent, agent); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO runtime_agent_agent(agent_id, agent_json) VALUES (?, ?)`, agent.GetAgentId(), string(item.Agent)); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO runtime_agent_state_projection(agent_id, state_json) VALUES (?, ?)`, agent.GetAgentId(), string(item.State)); err != nil {
				return err
			}
			for _, hookRaw := range item.Hooks {
				hook := &runtimev1.PendingHook{}
				if err := protojson.Unmarshal(hookRaw, hook); err != nil {
					return err
				}
				if _, err := tx.Exec(`INSERT INTO runtime_agent_hook(agent_id, hook_id, status, scheduled_for, hook_json) VALUES (?, ?, ?, ?, ?)`, agent.GetAgentId(), hookIntentID(hook), int(hookAdmissionState(hook)), timestampString(hook.GetScheduledFor()), string(hookRaw)); err != nil {
					return err
				}
			}
		}
		for _, eventRaw := range persisted.Events {
			event := &runtimev1.AgentEvent{}
			if err := protojson.Unmarshal(eventRaw, event); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO runtime_agent_event_log(sequence, agent_id, event_type, timestamp, event_json) VALUES (?, ?, ?, ?, ?)`, event.GetSequence(), event.GetAgentId(), int(event.GetEventType()), timestampString(event.GetTimestamp()), string(eventRaw)); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`INSERT INTO runtime_agent_meta(key, value) VALUES ('state_initialized','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value`); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_agent_meta(key, value) VALUES ('agent_event_sequence', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, encodeSequenceValue(persisted.Sequence)); err != nil {
			return err
		}
		return nil
	})
}

func (r *runtimeAgentStateRepository) runtimeAgentMetaValue(key string) (string, error) {
	var value string
	err := r.backend.DB().QueryRow(`SELECT value FROM runtime_agent_meta WHERE key = ?`, key).Scan(&value)
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
		if _, err := tx.Exec(`INSERT INTO runtime_agent_meta(key, value) VALUES ('state_initialized','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value`); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_agent_meta(key, value) VALUES ('agent_event_sequence', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, encodeSequenceValue(sequence)); err != nil {
			return err
		}
		return nil
	})
}

func (r *runtimeAgentStateRepository) validateImportedSnapshot(persisted persistedRuntimeAgentState) error {
	if r == nil || r.backend == nil {
		return nil
	}
	expectedAgentCount := len(persisted.Agents)
	expectedHookCount := 0
	for _, item := range persisted.Agents {
		expectedHookCount += len(item.Hooks)
	}
	expectedEventCount := len(persisted.Events)
	var actualAgentCount int
	if err := r.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_agent_agent`).Scan(&actualAgentCount); err != nil {
		return fmt.Errorf("validate imported agents: %w", err)
	}
	if actualAgentCount != expectedAgentCount {
		return fmt.Errorf("validate imported agents: got %d want %d", actualAgentCount, expectedAgentCount)
	}
	var actualHookCount int
	if err := r.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_agent_hook`).Scan(&actualHookCount); err != nil {
		return fmt.Errorf("validate imported hooks: %w", err)
	}
	if actualHookCount != expectedHookCount {
		return fmt.Errorf("validate imported hooks: got %d want %d", actualHookCount, expectedHookCount)
	}
	var actualEventCount int
	if err := r.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_agent_event_log`).Scan(&actualEventCount); err != nil {
		return fmt.Errorf("validate imported events: %w", err)
	}
	if actualEventCount != expectedEventCount {
		return fmt.Errorf("validate imported events: got %d want %d", actualEventCount, expectedEventCount)
	}
	seq, err := r.runtimeAgentMetaValue("agent_event_sequence")
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

func (r *runtimeAgentStateRepository) recordLegacyImportMetadata(path string, raw []byte, schemaVersion int) error {
	importedAt := time.Now().UTC().Format(time.RFC3339Nano)
	digest := sha256.Sum256(raw)
	return r.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		values := map[string]string{
			runtimeAgentMetaLegacyImportSourcePathKey:          strings.TrimSpace(path),
			runtimeAgentMetaLegacyImportSourceSHA256Key:        fmt.Sprintf("%x", digest[:]),
			runtimeAgentMetaLegacyImportSourceSchemaVersionKey: fmt.Sprintf("%d", schemaVersion),
			runtimeAgentMetaLegacyImportedAtKey:                importedAt,
		}
		for key, value := range values {
			if _, err := tx.Exec(`INSERT INTO runtime_agent_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *runtimeAgentStateRepository) resetImportedState() error {
	if r == nil || r.backend == nil {
		return nil
	}
	return r.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		statements := []string{
			`DELETE FROM runtime_agent_hook`,
			`DELETE FROM runtime_agent_event_log`,
			`DELETE FROM runtime_agent_state_projection`,
			`DELETE FROM runtime_agent_agent`,
			`DELETE FROM runtime_agent_review_run`,
			`DELETE FROM runtime_agent_review_followup`,
			`DELETE FROM runtime_agent_behavioral_posture`,
			`DELETE FROM runtime_agent_meta WHERE key IN ('state_initialized', 'agent_event_sequence', ?, ?, ?, ?, ?, ?)`,
		}
		for idx, stmt := range statements {
			if idx == len(statements)-1 {
				if _, err := tx.Exec(stmt,
					runtimeAgentMetaLegacyImportSourcePathKey,
					runtimeAgentMetaLegacyImportSourceSHA256Key,
					runtimeAgentMetaLegacyImportSourceSchemaVersionKey,
					runtimeAgentMetaLegacyImportedAtKey,
					runtimeAgentMetaPublicChatSurfaceVersionKey,
					runtimeAgentMetaPublicChatSurfaceStateKey,
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

func renameImportedRuntimeAgentState(path string) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	backupPath := path + ".wave4-imported.json.bak"
	if err := os.Rename(path, backupPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("rename legacy runtime agent state: %w", err)
	}
	return nil
}
