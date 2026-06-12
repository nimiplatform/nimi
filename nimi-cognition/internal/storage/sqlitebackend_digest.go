package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
)

// SaveDigestRun persists a digest report and candidate log.
func (b *SQLiteBackend) SaveDigestRun(scopeID string, runID string, report any, candidates []DigestCandidate, createdAt time.Time) error {
	if err := validateScopeID(scopeID); err != nil {
		return err
	}
	if err := validateItemID(runID); err != nil {
		return err
	}
	if createdAt.IsZero() {
		return errors.New("storage save digest run: created_at is required")
	}
	payload, err := json.Marshal(report)
	if err != nil {
		return fmt.Errorf("storage save digest run: marshal report: %w", err)
	}
	for _, candidate := range candidates {
		if err := validateDigestCandidate(runID, candidate); err != nil {
			return err
		}
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
		ON CONFLICT(scope_id, run_id) DO UPDATE SET report_json = excluded.report_json, created_at = excluded.created_at`,
		scopeID, runID, payload, encodeTime(createdAt)); err != nil {
		return fmt.Errorf("storage save digest run: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM digest_candidate WHERE scope_id = ? AND run_id = ?`, scopeID, runID); err != nil {
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

func validateDigestCandidate(runID string, candidate DigestCandidate) error {
	if candidate.RunID != runID {
		return fmt.Errorf("storage save digest candidates: candidate run_id %q does not match digest run_id %q", candidate.RunID, runID)
	}
	if err := validateDigestCandidateFamily(candidate.Family); err != nil {
		return err
	}
	if err := validateDigestCandidateArtifactKind(candidate.Family, candidate.ArtifactKind); err != nil {
		return err
	}
	if err := validateItemID(candidate.ArtifactID); err != nil {
		return fmt.Errorf("storage save digest candidates: artifact_id: %w", err)
	}
	if err := validateDigestCandidateStatusAction(candidate.Status, candidate.Action); err != nil {
		return err
	}
	if strings.TrimSpace(candidate.Reason) == "" {
		return errors.New("storage save digest candidates: reason is required")
	}
	if err := validateDigestCandidateDetail(candidate.Detail); err != nil {
		return err
	}
	if candidate.CreatedAt.IsZero() {
		return errors.New("storage save digest candidates: created_at is required")
	}
	if candidate.UpdatedAt.IsZero() {
		return errors.New("storage save digest candidates: updated_at is required")
	}
	if candidate.UpdatedAt.Before(candidate.CreatedAt) {
		return errors.New("storage save digest candidates: updated_at must not be before created_at")
	}
	return nil
}

func validateDigestCandidateFamily(family string) error {
	switch family {
	case "memory_substrate", "knowledge_projections", "skill_artifacts":
		return nil
	default:
		return fmt.Errorf("storage save digest candidates: unsupported canonical family_id %q", family)
	}
}

func validateDigestCandidateArtifactKind(family string, kind string) error {
	expected := map[string]artifactref.Kind{
		"memory_substrate":      artifactref.KindMemoryRecord,
		"knowledge_projections": artifactref.KindKnowledgePage,
		"skill_artifacts":       artifactref.KindSkillBundle,
	}[family]
	if kind == "" {
		return errors.New("storage save digest candidates: artifact_kind is required")
	}
	if artifactref.Kind(kind) != expected {
		return fmt.Errorf("storage save digest candidates: family %q requires artifact_kind %q, got %q", family, expected, kind)
	}
	return nil
}

func validateDigestCandidateStatusAction(status string, action string) error {
	switch status {
	case "candidate", "blocked":
		switch action {
		case "archive", "remove":
			return nil
		default:
			return fmt.Errorf("storage save digest candidates: status %q does not admit action %q", status, action)
		}
	case "applied":
		switch action {
		case "archived", "removed":
			return nil
		default:
			return fmt.Errorf("storage save digest candidates: status %q does not admit action %q", status, action)
		}
	case "":
		return errors.New("storage save digest candidates: status is required")
	default:
		return fmt.Errorf("storage save digest candidates: unsupported status %q", status)
	}
}

func validateDigestCandidateDetail(detail json.RawMessage) error {
	if len(detail) == 0 {
		return errors.New("storage save digest candidates: detail_json is required")
	}
	if !json.Valid(detail) {
		return errors.New("storage save digest candidates: detail_json must be valid JSON")
	}
	var object map[string]any
	if err := json.Unmarshal(detail, &object); err != nil || object == nil {
		return errors.New("storage save digest candidates: detail_json must be a JSON object")
	}
	return nil
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
func (b *SQLiteBackend) ListDigestRunIDs(scopeID string) (ids []string, err error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}

	rows, err := b.db.Query(`SELECT run_id FROM digest_run WHERE scope_id = ? ORDER BY created_at DESC, rowid DESC`, scopeID)
	if err != nil {
		return nil, fmt.Errorf("storage list digest runs: %w", err)
	}
	defer closeRows(rows, &err, "storage list digest runs")

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
func (b *SQLiteBackend) LoadDigestCandidates(scopeID string, runID string) (candidates []DigestCandidate, err error) {
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
	defer closeRows(rows, &err, "storage load digest candidates")

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
