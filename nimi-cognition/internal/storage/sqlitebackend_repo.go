package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
)

// Close releases the underlying database connection.
func (b *SQLiteBackend) Close() error {
	if b == nil || b.db == nil {
		return nil
	}
	return b.db.Close()
}

func (b *SQLiteBackend) Save(scopeID string, kind ArtifactKind, itemID string, data []byte) error {
	if err := validateScopeID(scopeID); err != nil {
		return err
	}
	if err := validateArtifactKind(kind); err != nil {
		return err
	}
	if err := validateItemID(itemID); err != nil {
		return err
	}

	tx, err := b.db.Begin()
	if err != nil {
		return fmt.Errorf("storage save: begin tx: %w", err)
	}
	defer rollback(tx)

	now := time.Now().UTC()
	if err := b.ensureScopeTx(tx, scopeID, now); err != nil {
		return err
	}

	switch kind {
	case KindKernel:
		if err := b.saveKernelTx(tx, scopeID, itemID, data); err != nil {
			return err
		}
	case KindMemory:
		if err := b.saveMemoryTx(tx, scopeID, itemID, data); err != nil {
			return err
		}
	case KindKnowledge:
		if err := b.saveKnowledgeTx(tx, scopeID, itemID, data); err != nil {
			return err
		}
	case KindSkill:
		if err := b.saveSkillTx(tx, scopeID, itemID, data); err != nil {
			return err
		}
	case KindCommit:
		if err := b.saveCommitTx(tx, scopeID, itemID, data); err != nil {
			return err
		}
	default:
		return fmt.Errorf("storage save: unsupported kind %s", kind)
	}
	return tx.Commit()
}

func (b *SQLiteBackend) Load(scopeID string, kind ArtifactKind, itemID string) ([]byte, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if err := validateArtifactKind(kind); err != nil {
		return nil, err
	}
	if err := validateItemID(itemID); err != nil {
		return nil, err
	}

	var query string
	switch kind {
	case KindKernel:
		query = `SELECT kernel_json FROM kernel WHERE scope_id = ? AND kernel_type = ?`
	case KindMemory:
		query = `SELECT record_json FROM memory_record WHERE scope_id = ? AND record_id = ?`
	case KindKnowledge:
		query = `SELECT page_json FROM knowledge_page WHERE scope_id = ? AND page_id = ?`
	case KindSkill:
		query = `SELECT bundle_json FROM skill_bundle WHERE scope_id = ? AND bundle_id = ?`
	case KindCommit:
		query = `SELECT commit_json FROM kernel_commit WHERE scope_id = ? AND commit_id = ?`
	default:
		return nil, fmt.Errorf("storage load: unsupported kind %s", kind)
	}

	var raw []byte
	err := b.db.QueryRow(query, scopeID, itemID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("storage load: %w", err)
	}
	return raw, nil
}

func (b *SQLiteBackend) Delete(scopeID string, kind ArtifactKind, itemID string) error {
	if err := validateScopeID(scopeID); err != nil {
		return err
	}
	if err := validateArtifactKind(kind); err != nil {
		return err
	}
	if err := validateItemID(itemID); err != nil {
		return err
	}

	tx, err := b.db.Begin()
	if err != nil {
		return fmt.Errorf("storage delete: begin tx: %w", err)
	}
	defer rollback(tx)

	switch kind {
	case KindKernel:
		rows, err := tx.Query(`SELECT rule_id FROM kernel_rule WHERE scope_id = ? AND kernel_type = ?`, scopeID, itemID)
		if err != nil {
			return fmt.Errorf("storage delete kernel rules: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var ruleID string
			if err := rows.Scan(&ruleID); err != nil {
				return fmt.Errorf("storage delete kernel rules: %w", err)
			}
			if err := b.deleteRefsForArtifactTx(tx, scopeID, string(artifactref.KindKernelRule), ruleID); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`DELETE FROM kernel_rule WHERE scope_id = ? AND kernel_type = ?`, scopeID, itemID); err != nil {
			return fmt.Errorf("storage delete kernel rules: %w", err)
		}
		if _, err := tx.Exec(`DELETE FROM kernel WHERE scope_id = ? AND kernel_type = ?`, scopeID, itemID); err != nil {
			return fmt.Errorf("storage delete kernel: %w", err)
		}
	case KindMemory:
		existing, err := b.loadMemoryRecordTx(tx, scopeID, itemID)
		if err != nil {
			return err
		}
		if existing != nil {
			at := time.Now().UTC()
			if !at.After(existing.UpdatedAt) {
				at = existing.UpdatedAt.Add(time.Nanosecond)
			}
			if err := b.insertMemoryHistoryTx(tx, *existing, memory.HistoryActionDeleted, at); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`DELETE FROM memory_record WHERE scope_id = ? AND record_id = ?`, scopeID, itemID); err != nil {
			return fmt.Errorf("storage delete memory: %w", err)
		}
		if _, err := tx.Exec(`DELETE FROM memory_record_fts WHERE scope_id = ? AND record_id = ?`, scopeID, itemID); err != nil {
			return fmt.Errorf("storage delete memory fts: %w", err)
		}
		if err := b.deleteRefsForArtifactTx(tx, scopeID, string(artifactref.KindMemoryRecord), itemID); err != nil {
			return err
		}
		if err := b.deleteRefsTargetingTx(tx, scopeID, string(artifactref.KindMemoryRecord), itemID); err != nil {
			return err
		}
	case KindKnowledge:
		existing, err := b.loadKnowledgePageTx(tx, scopeID, itemID)
		if err != nil {
			return err
		}
		if existing != nil {
			at := time.Now().UTC()
			if !at.After(existing.UpdatedAt) {
				at = existing.UpdatedAt.Add(time.Nanosecond)
			}
			if err := b.insertKnowledgeHistoryTx(tx, *existing, knowledge.HistoryActionDeleted, at); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`DELETE FROM knowledge_page WHERE scope_id = ? AND page_id = ?`, scopeID, itemID); err != nil {
			return fmt.Errorf("storage delete knowledge: %w", err)
		}
		if _, err := tx.Exec(`DELETE FROM knowledge_page_fts WHERE scope_id = ? AND page_id = ?`, scopeID, itemID); err != nil {
			return fmt.Errorf("storage delete knowledge fts: %w", err)
		}
		if _, err := tx.Exec(`DELETE FROM knowledge_page_embedding WHERE scope_id = ? AND page_id = ?`, scopeID, itemID); err != nil {
			return fmt.Errorf("storage delete knowledge embedding: %w", err)
		}
		if err := b.deleteKnowledgeRelationsForPageTx(tx, scopeID, itemID); err != nil {
			return err
		}
		if err := b.deleteRefsForArtifactTx(tx, scopeID, string(artifactref.KindKnowledgePage), itemID); err != nil {
			return err
		}
		if err := b.deleteRefsTargetingTx(tx, scopeID, string(artifactref.KindKnowledgePage), itemID); err != nil {
			return err
		}
	case KindSkill:
		existing, err := b.loadSkillBundleTx(tx, scopeID, itemID)
		if err != nil {
			return err
		}
		if existing != nil {
			at := time.Now().UTC()
			if !at.After(existing.UpdatedAt) {
				at = existing.UpdatedAt.Add(time.Nanosecond)
			}
			if err := b.insertSkillHistoryTx(tx, *existing, skill.HistoryActionDeleted, at); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`DELETE FROM skill_bundle WHERE scope_id = ? AND bundle_id = ?`, scopeID, itemID); err != nil {
			return fmt.Errorf("storage delete skill: %w", err)
		}
		if err := b.deleteRefsForArtifactTx(tx, scopeID, string(artifactref.KindSkillBundle), itemID); err != nil {
			return err
		}
		if err := b.deleteRefsTargetingTx(tx, scopeID, string(artifactref.KindSkillBundle), itemID); err != nil {
			return err
		}
	case KindCommit:
		if _, err := tx.Exec(`DELETE FROM kernel_commit WHERE scope_id = ? AND commit_id = ?`, scopeID, itemID); err != nil {
			return fmt.Errorf("storage delete commit: %w", err)
		}
	default:
		return fmt.Errorf("storage delete: unsupported kind %s", kind)
	}

	return tx.Commit()
}

func (b *SQLiteBackend) List(scopeID string, kind ArtifactKind) ([]string, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if err := validateArtifactKind(kind); err != nil {
		return nil, err
	}

	var query string
	switch kind {
	case KindKernel:
		query = `SELECT kernel_type FROM kernel WHERE scope_id = ? ORDER BY kernel_type`
	case KindMemory:
		query = `SELECT record_id FROM memory_record WHERE scope_id = ? ORDER BY updated_at DESC, record_id`
	case KindKnowledge:
		query = `SELECT page_id FROM knowledge_page WHERE scope_id = ? ORDER BY updated_at DESC, page_id`
	case KindSkill:
		query = `SELECT bundle_id FROM skill_bundle WHERE scope_id = ? ORDER BY updated_at DESC, bundle_id`
	case KindCommit:
		query = `SELECT commit_id FROM kernel_commit WHERE scope_id = ? ORDER BY created_at DESC, commit_id`
	default:
		return nil, fmt.Errorf("storage list: unsupported kind %s", kind)
	}

	rows, err := b.db.Query(query, scopeID)
	if err != nil {
		return nil, fmt.Errorf("storage list: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("storage list: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (b *SQLiteBackend) DeleteScope(scopeID string) error {
	if err := validateScopeID(scopeID); err != nil {
		return err
	}
	tx, err := b.db.Begin()
	if err != nil {
		return fmt.Errorf("storage delete scope: begin tx: %w", err)
	}
	defer rollback(tx)

	stmts := []string{
		`DELETE FROM digest_candidate WHERE scope_id = ?`,
		`DELETE FROM digest_run WHERE scope_id = ?`,
		`DELETE FROM artifact_ref WHERE scope_id = ?`,
		`DELETE FROM kernel_commit WHERE scope_id = ?`,
		`DELETE FROM kernel_rule WHERE scope_id = ?`,
		`DELETE FROM kernel WHERE scope_id = ?`,
		`DELETE FROM memory_record_fts WHERE scope_id = ?`,
		`DELETE FROM knowledge_page_fts WHERE scope_id = ?`,
		`DELETE FROM skill_bundle_fts WHERE scope_id = ?`,
		`DELETE FROM memory_record WHERE scope_id = ?`,
		`DELETE FROM memory_history WHERE scope_id = ?`,
		`DELETE FROM knowledge_page WHERE scope_id = ?`,
		`DELETE FROM knowledge_relation WHERE scope_id = ?`,
		`DELETE FROM knowledge_page_embedding WHERE scope_id = ?`,
		`DELETE FROM knowledge_history WHERE scope_id = ?`,
		`DELETE FROM knowledge_ingest_task WHERE scope_id = ?`,
		`DELETE FROM skill_bundle WHERE scope_id = ?`,
		`DELETE FROM skill_history WHERE scope_id = ?`,
		`DELETE FROM scope WHERE scope_id = ?`,
	}
	for _, stmt := range stmts {
		if _, err := tx.Exec(stmt, scopeID); err != nil {
			return fmt.Errorf("storage delete scope: %w", err)
		}
	}
	return tx.Commit()
}

func (b *SQLiteBackend) ListScopes() ([]string, error) {
	rows, err := b.db.Query(`SELECT scope_id FROM scope ORDER BY scope_id`)
	if err != nil {
		return nil, fmt.Errorf("storage list scopes: %w", err)
	}
	defer rows.Close()
	var scopes []string
	for rows.Next() {
		var scopeID string
		if err := rows.Scan(&scopeID); err != nil {
			return nil, fmt.Errorf("storage list scopes: %w", err)
		}
		scopes = append(scopes, scopeID)
	}
	return scopes, rows.Err()
}

func loadJSONRows[T any](db *sql.DB, query string, args ...any) ([]T, error) {
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	return scanJSONRows[T](rows)
}

func scanJSONRows[T any](rows *sql.Rows) ([]T, error) {
	defer rows.Close()
	var result []T
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var value T
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, rows.Err()
}
