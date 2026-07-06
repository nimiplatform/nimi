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

// agentExecutionConfigRepository persists the single committed Runtime Agent
// execution config record (K-AGCORE-144/145). Exactly one row exists per
// runtime instance; every mutation is an expected-revision compare-and-swap
// committed atomically through the serialized persistence write path.
type agentExecutionConfigRepository struct {
	backend *runtimepersistence.Backend
}

var (
	errExecutionConfigRevisionConflict = errors.New("execution config expected_revision does not match committed revision")
	errExecutionConfigMissing          = errors.New("execution config row missing")
	errExecutionConfigAlreadySeeded    = errors.New("execution config already seeded")
)

func newAgentExecutionConfigRepository(backend *runtimepersistence.Backend) *agentExecutionConfigRepository {
	if backend == nil {
		return nil
	}
	return &agentExecutionConfigRepository{
		backend: backend,
	}
}

func (r *agentExecutionConfigRepository) load() (*runtimev1.RuntimeAgentExecutionConfig, bool, error) {
	if r == nil || r.backend == nil {
		return nil, false, fmt.Errorf("execution config repository unavailable")
	}
	var revision uint64
	var configRaw string
	err := r.backend.DB().QueryRow(
		`SELECT revision, config_json FROM runtime_agent_execution_config WHERE singleton = 1`,
	).Scan(&revision, &configRaw)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("load execution config: %w", err)
	}
	config := &runtimev1.RuntimeAgentExecutionConfig{}
	if err := protojson.Unmarshal([]byte(configRaw), config); err != nil {
		return nil, false, fmt.Errorf("parse persisted execution config: %w", err)
	}
	if config.GetRevision() != revision {
		return nil, false, fmt.Errorf("persisted execution config revision mismatch: row=%d payload=%d", revision, config.GetRevision())
	}
	return config, true, nil
}

// commitSeed inserts the bootstrap config only when no committed row exists
// (K-AGCORE-150). An existing row is never overwritten.
func (r *agentExecutionConfigRepository) commitSeed(config *runtimev1.RuntimeAgentExecutionConfig) error {
	if r == nil || r.backend == nil {
		return fmt.Errorf("execution config repository unavailable")
	}
	raw, updatedAt, updatedBy, err := encodeExecutionConfigRow(config)
	if err != nil {
		return err
	}
	return r.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		var existing uint64
		err := tx.QueryRow(`SELECT revision FROM runtime_agent_execution_config WHERE singleton = 1`).Scan(&existing)
		if err == nil {
			return errExecutionConfigAlreadySeeded
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("check execution config seed state: %w", err)
		}
		if _, err := tx.Exec(
			`INSERT INTO runtime_agent_execution_config(singleton, revision, config_json, updated_at, updated_by_app_id) VALUES (1, ?, ?, ?, ?)`,
			config.GetRevision(), raw, updatedAt, updatedBy,
		); err != nil {
			return fmt.Errorf("insert execution config seed: %w", err)
		}
		return nil
	})
}

// commitMutation replaces the committed config iff the committed revision
// still equals expectedRevision (K-AGCORE-145 optimistic concurrency).
func (r *agentExecutionConfigRepository) commitMutation(expectedRevision uint64, config *runtimev1.RuntimeAgentExecutionConfig) error {
	if r == nil || r.backend == nil {
		return fmt.Errorf("execution config repository unavailable")
	}
	raw, updatedAt, updatedBy, err := encodeExecutionConfigRow(config)
	if err != nil {
		return err
	}
	return r.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		var committed uint64
		err := tx.QueryRow(`SELECT revision FROM runtime_agent_execution_config WHERE singleton = 1`).Scan(&committed)
		if errors.Is(err, sql.ErrNoRows) {
			return errExecutionConfigMissing
		}
		if err != nil {
			return fmt.Errorf("read committed execution config revision: %w", err)
		}
		if committed != expectedRevision {
			return errExecutionConfigRevisionConflict
		}
		if _, err := tx.Exec(
			`UPDATE runtime_agent_execution_config SET revision = ?, config_json = ?, updated_at = ?, updated_by_app_id = ? WHERE singleton = 1`,
			config.GetRevision(), raw, updatedAt, updatedBy,
		); err != nil {
			return fmt.Errorf("update execution config: %w", err)
		}
		return nil
	})
}

func encodeExecutionConfigRow(config *runtimev1.RuntimeAgentExecutionConfig) (string, string, string, error) {
	if config == nil {
		return "", "", "", fmt.Errorf("execution config is required")
	}
	raw, err := protojson.Marshal(config)
	if err != nil {
		return "", "", "", fmt.Errorf("marshal execution config: %w", err)
	}
	updatedAt := timestampString(config.GetUpdatedAt())
	if updatedAt == "" {
		updatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	updatedBy := strings.TrimSpace(config.GetUpdatedByAppId())
	if updatedBy == "" {
		return "", "", "", fmt.Errorf("execution config updated_by_app_id is required")
	}
	return string(raw), updatedAt, updatedBy, nil
}
