package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
)

func buildMemorySearchText(rec memory.Record) string {
	return compactSearch(string(rec.Content), string(rec.Kind))
}

func buildKnowledgeSearchText(page knowledge.Page) string {
	return compactSearch(page.Title, string(page.Body), string(page.Kind))
}

func buildSkillSearchText(bundle skill.Bundle) string {
	var steps []string
	for _, step := range bundle.Steps {
		steps = append(steps, step.Instruction)
	}
	return compactSearch(bundle.Name, bundle.Description, strings.Join(steps, " "), string(bundle.Metadata))
}

func knowledgePageEmbeddingText(page knowledge.Page) string {
	return compactSearch(page.Title, string(page.Body), string(page.Kind))
}

func (b *SQLiteBackend) migrateMemoryRecordSchema() error {
	rows, err := b.db.Query(`PRAGMA table_info(memory_record)`)
	if err != nil {
		return fmt.Errorf("storage: inspect memory_record schema: %w", err)
	}
	defer rows.Close()

	columns := map[string]struct{}{}
	for rows.Next() {
		var cid int
		var name string
		var ctype string
		var notNull int
		var dflt sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dflt, &pk); err != nil {
			return fmt.Errorf("storage: inspect memory_record schema: %w", err)
		}
		columns[name] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("storage: inspect memory_record schema: %w", err)
	}
	if _, hasSupport := columns["support_score"]; !hasSupport {
		if _, hasDrift := columns["drift_status"]; !hasDrift {
			return nil
		}
	}

	tx, err := b.db.Begin()
	if err != nil {
		return fmt.Errorf("storage: migrate memory_record schema: begin tx: %w", err)
	}
	defer rollback(tx)

	if _, err := tx.Exec(`ALTER TABLE memory_record RENAME TO memory_record_legacy`); err != nil {
		return fmt.Errorf("storage: migrate memory_record schema: rename table: %w", err)
	}
	if _, err := tx.Exec(`CREATE TABLE memory_record (
		scope_id TEXT NOT NULL,
		record_id TEXT NOT NULL,
		kind TEXT NOT NULL,
		lifecycle TEXT NOT NULL,
		search_text TEXT NOT NULL,
		record_json BLOB NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		PRIMARY KEY (scope_id, record_id)
	)`); err != nil {
		return fmt.Errorf("storage: migrate memory_record schema: create table: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO memory_record
		(scope_id, record_id, kind, lifecycle, search_text, record_json, created_at, updated_at)
		SELECT scope_id, record_id, kind, lifecycle, search_text, record_json, created_at, updated_at
		FROM memory_record_legacy`); err != nil {
		return fmt.Errorf("storage: migrate memory_record schema: copy rows: %w", err)
	}
	if _, err := tx.Exec(`DROP TABLE memory_record_legacy`); err != nil {
		return fmt.Errorf("storage: migrate memory_record schema: drop legacy table: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM memory_record_fts`); err != nil {
		return fmt.Errorf("storage: migrate memory_record schema: reset fts: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO memory_record_fts (scope_id, record_id, search_text)
		SELECT scope_id, record_id, search_text FROM memory_record`); err != nil {
		return fmt.Errorf("storage: migrate memory_record schema: repopulate fts: %w", err)
	}
	return tx.Commit()
}

func (b *SQLiteBackend) migrateKnowledgeAuxState() error {
	rows, err := b.db.Query(`SELECT scope_id, page_id, page_json FROM knowledge_page`)
	if err != nil {
		return fmt.Errorf("storage: inspect knowledge aux state: %w", err)
	}
	defer rows.Close()

	type pageRow struct {
		scopeID string
		pageID  string
		raw     []byte
	}
	var pages []pageRow
	for rows.Next() {
		var row pageRow
		if err := rows.Scan(&row.scopeID, &row.pageID, &row.raw); err != nil {
			return fmt.Errorf("storage: inspect knowledge aux state: %w", err)
		}
		pages = append(pages, row)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("storage: inspect knowledge aux state: %w", err)
	}

	tx, err := b.db.Begin()
	if err != nil {
		return fmt.Errorf("storage: migrate knowledge aux state: begin tx: %w", err)
	}
	defer rollback(tx)

	if _, err := tx.Exec(`DELETE FROM knowledge_page_embedding`); err != nil {
		return fmt.Errorf("storage: migrate knowledge aux state: reset embeddings: %w", err)
	}

	for _, row := range pages {
		var page knowledge.Page
		if err := json.Unmarshal(row.raw, &page); err != nil {
			return fmt.Errorf("storage: migrate knowledge aux state: %w", err)
		}
		filtered := make([]artifactref.Ref, 0, len(page.ArtifactRefs))
		for _, ref := range page.ArtifactRefs {
			if ref.ToKind == artifactref.KindKnowledgePage {
				relType := relationTypeFromRole(ref.Role)
				if relType != "" {
					if err := b.upsertKnowledgeRelationTx(tx, knowledge.Relation{
						ScopeID:      row.scopeID,
						FromPageID:   knowledge.PageID(ref.FromID),
						ToPageID:     knowledge.PageID(ref.ToID),
						RelationType: relType,
						Strength:     ref.Strength,
						CreatedAt:    ref.CreatedAt,
						UpdatedAt:    ref.UpdatedAt,
					}); err != nil {
						return err
					}
				}
				continue
			}
			filtered = append(filtered, ref)
		}
		page.ArtifactRefs = filtered
		raw, err := json.Marshal(page)
		if err != nil {
			return fmt.Errorf("storage: migrate knowledge aux state: marshal page: %w", err)
		}
		if _, err := tx.Exec(`UPDATE knowledge_page SET page_json = ?, search_text = ? WHERE scope_id = ? AND page_id = ?`, raw, buildKnowledgeSearchText(page), row.scopeID, row.pageID); err != nil {
			return fmt.Errorf("storage: migrate knowledge aux state: update page: %w", err)
		}
		if _, err := tx.Exec(`DELETE FROM knowledge_page_fts WHERE scope_id = ? AND page_id = ?`, row.scopeID, row.pageID); err != nil {
			return fmt.Errorf("storage: migrate knowledge aux state: reset fts: %w", err)
		}
		if _, err := tx.Exec(`INSERT INTO knowledge_page_fts (scope_id, page_id, search_text) VALUES (?, ?, ?)`, row.scopeID, row.pageID, buildKnowledgeSearchText(page)); err != nil {
			return fmt.Errorf("storage: migrate knowledge aux state: repopulate fts: %w", err)
		}
		if err := b.replaceRefsForArtifactTx(tx, row.scopeID, string(artifactref.KindKnowledgePage), row.pageID, page.ArtifactRefs); err != nil {
			return err
		}
		if err := b.saveKnowledgeEmbeddingTx(tx, row.scopeID, row.pageID, page); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (b *SQLiteBackend) migrateDigestCandidateSchema() error {
	rows, err := b.db.Query(`PRAGMA table_info(digest_candidate)`)
	if err != nil {
		return fmt.Errorf("storage: inspect digest_candidate schema: %w", err)
	}
	defer rows.Close()
	var hasStatusPK bool
	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			return fmt.Errorf("storage: inspect digest_candidate schema: %w", err)
		}
		if name == "status" && pk > 0 {
			hasStatusPK = true
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("storage: inspect digest_candidate schema: %w", err)
	}
	if hasStatusPK {
		return nil
	}

	tx, err := b.db.Begin()
	if err != nil {
		return fmt.Errorf("storage: migrate digest_candidate schema: begin tx: %w", err)
	}
	defer rollback(tx)
	if _, err := tx.Exec(`ALTER TABLE digest_candidate RENAME TO digest_candidate_old`); err != nil {
		return fmt.Errorf("storage: migrate digest_candidate schema: rename: %w", err)
	}
	if _, err := tx.Exec(`CREATE TABLE digest_candidate (
		scope_id TEXT NOT NULL,
		run_id TEXT NOT NULL,
		family TEXT NOT NULL,
		artifact_kind TEXT NOT NULL,
		artifact_id TEXT NOT NULL,
		action TEXT NOT NULL,
		status TEXT NOT NULL,
		reason TEXT NOT NULL,
		detail_json BLOB,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		PRIMARY KEY (run_id, family, artifact_kind, artifact_id, action, status)
	)`); err != nil {
		return fmt.Errorf("storage: migrate digest_candidate schema: create: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO digest_candidate
		(scope_id, run_id, family, artifact_kind, artifact_id, action, status, reason, detail_json, created_at, updated_at)
		SELECT scope_id, run_id, family, artifact_kind, artifact_id, action, status, reason, detail_json, created_at, updated_at
		FROM digest_candidate_old`); err != nil {
		return fmt.Errorf("storage: migrate digest_candidate schema: copy: %w", err)
	}
	if _, err := tx.Exec(`DROP TABLE digest_candidate_old`); err != nil {
		return fmt.Errorf("storage: migrate digest_candidate schema: drop old: %w", err)
	}
	return tx.Commit()
}

func (b *SQLiteBackend) rebuildSkillBundleFTS() error {
	if _, err := b.db.Exec(`DELETE FROM skill_bundle_fts`); err != nil {
		return fmt.Errorf("storage: rebuild skill fts: reset: %w", err)
	}
	if _, err := b.db.Exec(`INSERT INTO skill_bundle_fts (scope_id, bundle_id, search_text)
		SELECT scope_id, bundle_id, search_text FROM skill_bundle`); err != nil {
		return fmt.Errorf("storage: rebuild skill fts: populate: %w", err)
	}
	return nil
}

func compactSearch(parts ...string) string {
	var cleaned []string
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		cleaned = append(cleaned, part)
	}
	sort.Strings(cleaned)
	return strings.Join(cleaned, " ")
}

func encodeTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339Nano)
}

func decodeTime(raw string) (time.Time, error) {
	return time.Parse(time.RFC3339Nano, raw)
}

func rollback(tx *sql.Tx) {
	_ = tx.Rollback()
}

func relationRole(relationType string) string {
	relationType = strings.TrimSpace(relationType)
	if relationType == "" {
		return ""
	}
	return "relation:" + relationType
}

func relationTypeFromRole(role string) string {
	role = strings.TrimSpace(role)
	if strings.HasPrefix(role, "relation:") {
		return strings.TrimPrefix(role, "relation:")
	}
	return ""
}
