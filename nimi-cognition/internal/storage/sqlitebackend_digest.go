package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// SaveDigestRun persists a digest report and candidate log.
func (b *SQLiteBackend) SaveDigestRun(scopeID string, runID string, report any, candidates []DigestCandidate, createdAt time.Time) error {
	if err := validateScopeID(scopeID); err != nil {
		return err
	}
	if err := validateItemID(runID); err != nil {
		return err
	}
	payload, err := json.Marshal(report)
	if err != nil {
		return fmt.Errorf("storage save digest run: marshal report: %w", err)
	}
	tx, err := b.db.Begin()
	if err != nil {
		return fmt.Errorf("storage save digest run: begin tx: %w", err)
	}
	defer rollback(tx)
	if err := b.ensureScopeTx(tx, scopeID, createdAt); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO digest_run (scope_id, run_id, report_json, created_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(run_id) DO UPDATE SET report_json = excluded.report_json, created_at = excluded.created_at`,
		scopeID, runID, payload, encodeTime(createdAt)); err != nil {
		return fmt.Errorf("storage save digest run: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM digest_candidate WHERE run_id = ?`, runID); err != nil {
		return fmt.Errorf("storage save digest candidates: %w", err)
	}
	for _, candidate := range candidates {
		if _, err := tx.Exec(`INSERT INTO digest_candidate
			(scope_id, run_id, family, artifact_kind, artifact_id, action, status, reason, detail_json, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			scopeID, runID, candidate.Family, candidate.ArtifactKind, candidate.ArtifactID, candidate.Action,
			candidate.Status, candidate.Reason, candidate.Detail, encodeTime(candidate.CreatedAt), encodeTime(candidate.UpdatedAt)); err != nil {
			return fmt.Errorf("storage save digest candidates: %w", err)
		}
	}
	return tx.Commit()
}

// LoadDigestRun returns one persisted digest report payload by run id.
func (b *SQLiteBackend) LoadDigestRun(scopeID string, runID string) ([]byte, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if err := validateItemID(runID); err != nil {
		return nil, err
	}

	row := b.db.QueryRow(`SELECT report_json FROM digest_run WHERE scope_id = ? AND run_id = ?`, scopeID, runID)
	var report []byte
	if err := row.Scan(&report); errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, fmt.Errorf("storage load digest run: %w", err)
	}
	return report, nil
}

// ListDigestRunIDs returns persisted digest run ids for one scope in reverse chronological order.
func (b *SQLiteBackend) ListDigestRunIDs(scopeID string) ([]string, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}

	rows, err := b.db.Query(`SELECT run_id FROM digest_run WHERE scope_id = ? ORDER BY created_at DESC, rowid DESC`, scopeID)
	if err != nil {
		return nil, fmt.Errorf("storage list digest runs: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var runID string
		if err := rows.Scan(&runID); err != nil {
			return nil, fmt.Errorf("storage list digest runs: %w", err)
		}
		ids = append(ids, runID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("storage list digest runs: %w", err)
	}
	return ids, nil
}

// LoadDigestCandidates returns persisted digest candidates for one run id.
func (b *SQLiteBackend) LoadDigestCandidates(scopeID string, runID string) ([]DigestCandidate, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if err := validateItemID(runID); err != nil {
		return nil, err
	}

	rows, err := b.db.Query(`SELECT run_id, family, artifact_kind, artifact_id, action, status, reason, detail_json, created_at, updated_at
		FROM digest_candidate WHERE scope_id = ? AND run_id = ? ORDER BY updated_at DESC, artifact_id ASC`, scopeID, runID)
	if err != nil {
		return nil, fmt.Errorf("storage load digest candidates: %w", err)
	}
	defer rows.Close()

	var candidates []DigestCandidate
	for rows.Next() {
		var candidate DigestCandidate
		var createdAt string
		var updatedAt string
		if err := rows.Scan(
			&candidate.RunID,
			&candidate.Family,
			&candidate.ArtifactKind,
			&candidate.ArtifactID,
			&candidate.Action,
			&candidate.Status,
			&candidate.Reason,
			&candidate.Detail,
			&createdAt,
			&updatedAt,
		); err != nil {
			return nil, fmt.Errorf("storage load digest candidates: %w", err)
		}
		candidate.CreatedAt, err = decodeTime(createdAt)
		if err != nil {
			return nil, fmt.Errorf("storage load digest candidates: decode created_at: %w", err)
		}
		candidate.UpdatedAt, err = decodeTime(updatedAt)
		if err != nil {
			return nil, fmt.Errorf("storage load digest candidates: decode updated_at: %w", err)
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("storage load digest candidates: %w", err)
	}
	return candidates, nil
}
