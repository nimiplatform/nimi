package runtimeagent

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"google.golang.org/protobuf/encoding/protojson"
)

type runtimeAgentStateRepository struct {
	backend *runtimepersistence.Backend
}

func newRuntimeAgentStateRepository(backend *runtimepersistence.Backend) *runtimeAgentStateRepository {
	if backend == nil {
		return nil
	}
	return &runtimeAgentStateRepository{
		backend: backend,
	}
}

type publicChatSurfaceStateRepository struct {
	backend   *runtimepersistence.Backend
	stateRepo *runtimeAgentStateRepository
}

func newPublicChatSurfaceStateRepository(backend *runtimepersistence.Backend, stateRepo *runtimeAgentStateRepository) *publicChatSurfaceStateRepository {
	if backend == nil {
		return nil
	}
	return &publicChatSurfaceStateRepository{
		backend:   backend,
		stateRepo: stateRepo,
	}
}

// agentAgentAIConfigRepository persists committed Runtime Agent AI Config
// records (K-AGCORE-144/145). Exactly one row exists per Runtime Local Agent
// instance; every mutation is an expected-revision compare-and-swap committed
// atomically through the serialized persistence write path.
type agentAgentAIConfigRepository struct {
	backend *runtimepersistence.Backend
}

var (
	errAgentAIConfigRevisionConflict = errors.New("runtime agent ai config expected_revision does not match committed revision")
	errAgentAIConfigMissing          = errors.New("runtime agent ai config row missing")
	errAgentAIConfigAlreadySeeded    = errors.New("runtime agent ai config already seeded")
)

func newAgentAgentAIConfigRepository(backend *runtimepersistence.Backend) *agentAgentAIConfigRepository {
	if backend == nil {
		return nil
	}
	return &agentAgentAIConfigRepository{
		backend: backend,
	}
}

func (r *agentAgentAIConfigRepository) load(agentInstanceID string) (*runtimev1.RuntimeAgentAIConfig, bool, error) {
	if r == nil || r.backend == nil {
		return nil, false, fmt.Errorf("runtime agent ai config repository unavailable")
	}
	trimmedAgentInstanceID := strings.TrimSpace(agentInstanceID)
	if trimmedAgentInstanceID == "" {
		return nil, false, fmt.Errorf("agent_instance_id is required")
	}
	var revision uint64
	var configRaw string
	err := r.backend.DB().QueryRow(
		`SELECT revision, config_json FROM runtime_agent_ai_config WHERE agent_instance_id = ?`,
		trimmedAgentInstanceID,
	).Scan(&revision, &configRaw)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("load runtime agent ai config: %w", err)
	}
	config := &runtimev1.RuntimeAgentAIConfig{}
	if err := protojson.Unmarshal([]byte(configRaw), config); err != nil {
		return nil, false, fmt.Errorf("parse persisted runtime agent ai config: %w", err)
	}
	if config.GetAgentInstanceId() != trimmedAgentInstanceID {
		return nil, false, fmt.Errorf("persisted runtime agent ai config agent_instance_id mismatch: row=%s payload=%s", trimmedAgentInstanceID, config.GetAgentInstanceId())
	}
	if config.GetRevision() != revision {
		return nil, false, fmt.Errorf("persisted runtime agent ai config revision mismatch: row=%d payload=%d", revision, config.GetRevision())
	}
	return config, true, nil
}

func (r *agentAgentAIConfigRepository) loadAll() ([]*runtimev1.RuntimeAgentAIConfig, error) {
	if r == nil || r.backend == nil {
		return nil, fmt.Errorf("runtime agent ai config repository unavailable")
	}
	rows, err := r.backend.DB().Query(`SELECT agent_instance_id, revision, config_json FROM runtime_agent_ai_config ORDER BY agent_instance_id`)
	if err != nil {
		return nil, fmt.Errorf("load runtime agent ai config rows: %w", err)
	}
	defer rows.Close()
	var out []*runtimev1.RuntimeAgentAIConfig
	for rows.Next() {
		var agentInstanceID string
		var revision uint64
		var configRaw string
		if err := rows.Scan(&agentInstanceID, &revision, &configRaw); err != nil {
			return nil, fmt.Errorf("scan runtime agent ai config row: %w", err)
		}
		config := &runtimev1.RuntimeAgentAIConfig{}
		if err := protojson.Unmarshal([]byte(configRaw), config); err != nil {
			return nil, fmt.Errorf("parse persisted runtime agent ai config %s: %w", agentInstanceID, err)
		}
		if config.GetAgentInstanceId() != strings.TrimSpace(agentInstanceID) {
			return nil, fmt.Errorf("persisted runtime agent ai config agent_instance_id mismatch: row=%s payload=%s", agentInstanceID, config.GetAgentInstanceId())
		}
		if config.GetRevision() != revision {
			return nil, fmt.Errorf("persisted runtime agent ai config revision mismatch: row=%d payload=%d", revision, config.GetRevision())
		}
		out = append(out, config)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate runtime agent ai config rows: %w", err)
	}
	return out, nil
}

// commitSeed inserts the bootstrap config only when no committed row exists
// (K-AGCORE-150). An existing row is never overwritten.
func (r *agentAgentAIConfigRepository) commitSeed(config *runtimev1.RuntimeAgentAIConfig) error {
	if r == nil || r.backend == nil {
		return fmt.Errorf("runtime agent ai config repository unavailable")
	}
	raw, updatedAt, updatedBy, err := encodeAgentAIConfigRow(config)
	if err != nil {
		return err
	}
	agentInstanceID := strings.TrimSpace(config.GetAgentInstanceId())
	return r.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		var existing uint64
		err := tx.QueryRow(`SELECT revision FROM runtime_agent_ai_config WHERE agent_instance_id = ?`, agentInstanceID).Scan(&existing)
		if err == nil {
			return errAgentAIConfigAlreadySeeded
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("check runtime agent ai config seed state: %w", err)
		}
		if _, err := tx.Exec(
			`INSERT INTO runtime_agent_ai_config(agent_instance_id, revision, config_json, updated_at, updated_by_app_id) VALUES (?, ?, ?, ?, ?)`,
			agentInstanceID, config.GetRevision(), raw, updatedAt, updatedBy,
		); err != nil {
			return fmt.Errorf("insert runtime agent ai config seed: %w", err)
		}
		return nil
	})
}

// commitMutation replaces the committed config iff the committed revision
// still equals expectedRevision (K-AGCORE-145 optimistic concurrency).
func (r *agentAgentAIConfigRepository) commitMutation(agentInstanceID string, expectedRevision uint64, config *runtimev1.RuntimeAgentAIConfig) error {
	if r == nil || r.backend == nil {
		return fmt.Errorf("runtime agent ai config repository unavailable")
	}
	trimmedAgentInstanceID := strings.TrimSpace(agentInstanceID)
	if trimmedAgentInstanceID == "" {
		return fmt.Errorf("agent_instance_id is required")
	}
	if strings.TrimSpace(config.GetAgentInstanceId()) != trimmedAgentInstanceID {
		return fmt.Errorf("runtime agent ai config agent_instance_id mismatch")
	}
	raw, updatedAt, updatedBy, err := encodeAgentAIConfigRow(config)
	if err != nil {
		return err
	}
	return r.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		var committed uint64
		err := tx.QueryRow(`SELECT revision FROM runtime_agent_ai_config WHERE agent_instance_id = ?`, trimmedAgentInstanceID).Scan(&committed)
		if errors.Is(err, sql.ErrNoRows) {
			return errAgentAIConfigMissing
		}
		if err != nil {
			return fmt.Errorf("read committed runtime agent ai config revision: %w", err)
		}
		if committed != expectedRevision {
			return errAgentAIConfigRevisionConflict
		}
		if _, err := tx.Exec(
			`UPDATE runtime_agent_ai_config SET revision = ?, config_json = ?, updated_at = ?, updated_by_app_id = ? WHERE agent_instance_id = ?`,
			config.GetRevision(), raw, updatedAt, updatedBy, trimmedAgentInstanceID,
		); err != nil {
			return fmt.Errorf("update runtime agent ai config: %w", err)
		}
		return nil
	})
}

func encodeAgentAIConfigRow(config *runtimev1.RuntimeAgentAIConfig) (string, string, string, error) {
	if config == nil {
		return "", "", "", fmt.Errorf("runtime agent ai config is required")
	}
	if strings.TrimSpace(config.GetAgentInstanceId()) == "" {
		return "", "", "", fmt.Errorf("runtime agent ai config agent_instance_id is required")
	}
	raw, err := protojson.Marshal(config)
	if err != nil {
		return "", "", "", fmt.Errorf("marshal runtime agent ai config: %w", err)
	}
	updatedAt := timestampString(config.GetUpdatedAt())
	if updatedAt == "" {
		updatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	updatedBy := strings.TrimSpace(config.GetUpdatedByAppId())
	if updatedBy == "" {
		return "", "", "", fmt.Errorf("runtime agent ai config updated_by_app_id is required")
	}
	return string(raw), updatedAt, updatedBy, nil
}
