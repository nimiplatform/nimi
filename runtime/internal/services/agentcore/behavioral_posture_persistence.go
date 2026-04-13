package agentcore

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

type behavioralPosturePersistence interface {
	PutBehavioralPosture(ctx context.Context, posture BehavioralPosture) error
	GetBehavioralPosture(ctx context.Context, agentID string) (*BehavioralPosture, error)
}

type sqliteBehavioralPosturePersistence struct {
	backend *runtimepersistence.Backend
}

func newBehavioralPosturePersistence(backend *runtimepersistence.Backend) behavioralPosturePersistence {
	if backend == nil {
		return nil
	}
	return sqliteBehavioralPosturePersistence{backend: backend}
}

func (s sqliteBehavioralPosturePersistence) PutBehavioralPosture(ctx context.Context, posture BehavioralPosture) error {
	if strings.TrimSpace(posture.AgentID) == "" {
		return fmt.Errorf("agent_id is required")
	}
	if strings.TrimSpace(posture.UpdatedAt) == "" {
		posture.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	raw, err := json.Marshal(posture)
	if err != nil {
		return err
	}
	basisRaw, err := json.Marshal(posture.TruthBasisIDs)
	if err != nil {
		return err
	}
	return s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `
			INSERT OR REPLACE INTO agentcore_behavioral_posture(agent_id, status_text, truth_basis_json, posture_json, updated_at)
			VALUES (?, ?, ?, ?, ?)
		`, posture.AgentID, posture.StatusText, string(basisRaw), string(raw), posture.UpdatedAt)
		return err
	})
}

func (s sqliteBehavioralPosturePersistence) GetBehavioralPosture(ctx context.Context, agentID string) (*BehavioralPosture, error) {
	var raw string
	err := s.backend.DB().QueryRowContext(ctx, `
		SELECT posture_json
		FROM agentcore_behavioral_posture
		WHERE agent_id = ?
	`, strings.TrimSpace(agentID)).Scan(&raw)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	var posture BehavioralPosture
	if err := json.Unmarshal([]byte(raw), &posture); err != nil {
		return nil, err
	}
	return &posture, nil
}
