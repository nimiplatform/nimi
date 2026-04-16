package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/internal/embedding"
	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
)

func (b *SQLiteBackend) saveKernelTx(tx *sql.Tx, scopeID string, itemID string, data []byte) error {
	var payload struct {
		Kernel kernel.Kernel `json:"kernel"`
		Rules  []kernel.Rule `json:"rules"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return fmt.Errorf("storage save kernel: unmarshal: %w", err)
	}
	if payload.Kernel.KernelType == kernel.KernelTypeAgentModel {
		if err := kernel.ValidateAgentModelKernel(kernel.AgentModelKernel{Kernel: payload.Kernel, Rules: payload.Rules}); err != nil {
			return fmt.Errorf("storage save kernel: %w", err)
		}
	} else if payload.Kernel.KernelType == kernel.KernelTypeWorldModel {
		if err := kernel.ValidateWorldModelKernel(kernel.WorldModelKernel{Kernel: payload.Kernel, Rules: payload.Rules}); err != nil {
			return fmt.Errorf("storage save kernel: %w", err)
		}
	} else {
		return fmt.Errorf("storage save kernel: invalid kernel_type %q", payload.Kernel.KernelType)
	}
	if string(payload.Kernel.KernelType) != itemID {
		return fmt.Errorf("storage save kernel: item id %s does not match kernel type %s", itemID, payload.Kernel.KernelType)
	}

	if _, err := tx.Exec(`INSERT INTO kernel
		(scope_id, kernel_type, kernel_id, version, status, kernel_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(scope_id, kernel_type) DO UPDATE SET
			kernel_id = excluded.kernel_id,
			version = excluded.version,
			status = excluded.status,
			kernel_json = excluded.kernel_json,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at`,
		scopeID, string(payload.Kernel.KernelType), payload.Kernel.KernelID, payload.Kernel.Version, string(payload.Kernel.Status),
		data, encodeTime(payload.Kernel.CreatedAt), encodeTime(payload.Kernel.UpdatedAt)); err != nil {
		return fmt.Errorf("storage save kernel row: %w", err)
	}

	rows, err := tx.Query(`SELECT rule_id FROM kernel_rule WHERE scope_id = ? AND kernel_type = ?`, scopeID, string(payload.Kernel.KernelType))
	if err != nil {
		return fmt.Errorf("storage save kernel rules: %w", err)
	}
	var staleIDs []string
	for rows.Next() {
		var ruleID string
		if err := rows.Scan(&ruleID); err != nil {
			rows.Close()
			return fmt.Errorf("storage save kernel rules: %w", err)
		}
		staleIDs = append(staleIDs, ruleID)
	}
	rows.Close()
	for _, ruleID := range staleIDs {
		if err := b.deleteRefsForArtifactTx(tx, scopeID, string(artifactref.KindKernelRule), ruleID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM kernel_rule WHERE scope_id = ? AND kernel_type = ?`, scopeID, string(payload.Kernel.KernelType)); err != nil {
		return fmt.Errorf("storage save kernel rules: %w", err)
	}
	for _, rule := range payload.Rules {
		raw, err := json.Marshal(rule)
		if err != nil {
			return fmt.Errorf("storage save kernel rule %s: %w", rule.RuleID, err)
		}
		if _, err := tx.Exec(`INSERT INTO kernel_rule
			(scope_id, kernel_type, rule_id, lifecycle, statement, search_text, rule_json, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			scopeID, string(payload.Kernel.KernelType), string(rule.RuleID), string(rule.Lifecycle), rule.Statement,
			rule.Statement, raw, encodeTime(rule.UpdatedAt)); err != nil {
			return fmt.Errorf("storage save kernel rule %s: %w", rule.RuleID, err)
		}
		if err := b.replaceRefsForArtifactTx(tx, scopeID, string(artifactref.KindKernelRule), string(rule.RuleID), rule.ArtifactRefs); err != nil {
			return err
		}
	}
	return nil
}

func (b *SQLiteBackend) saveMemoryTx(tx *sql.Tx, scopeID string, itemID string, data []byte) error {
	var rec memory.Record
	if err := json.Unmarshal(data, &rec); err != nil {
		return fmt.Errorf("storage save memory: unmarshal: %w", err)
	}
	if err := memory.ValidateRecord(rec); err != nil {
		return fmt.Errorf("storage save memory: %w", err)
	}
	if string(rec.RecordID) != itemID {
		return fmt.Errorf("storage save memory: item id %s does not match record id %s", itemID, rec.RecordID)
	}
	action := memory.HistoryActionCreated
	if existing, err := b.loadMemoryRecordTx(tx, scopeID, itemID); err != nil {
		return err
	} else if existing != nil {
		switch rec.Lifecycle {
		case memory.RecordLifecycleArchived:
			action = memory.HistoryActionArchived
		case memory.RecordLifecycleRemoved:
			action = memory.HistoryActionRemoved
		default:
			action = memory.HistoryActionUpdated
		}
	}
	if _, err := tx.Exec(`INSERT INTO memory_record
		(scope_id, record_id, kind, lifecycle, search_text, record_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(scope_id, record_id) DO UPDATE SET
			kind = excluded.kind,
			lifecycle = excluded.lifecycle,
			search_text = excluded.search_text,
			record_json = excluded.record_json,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at`,
		scopeID, string(rec.RecordID), string(rec.Kind), string(rec.Lifecycle),
		buildMemorySearchText(rec), data, encodeTime(rec.CreatedAt), encodeTime(rec.UpdatedAt)); err != nil {
		return fmt.Errorf("storage save memory row: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM memory_record_fts WHERE scope_id = ? AND record_id = ?`, scopeID, itemID); err != nil {
		return fmt.Errorf("storage save memory fts: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO memory_record_fts (scope_id, record_id, search_text) VALUES (?, ?, ?)`, scopeID, itemID, buildMemorySearchText(rec)); err != nil {
		return fmt.Errorf("storage save memory fts: %w", err)
	}
	if err := b.replaceRefsForArtifactTx(tx, scopeID, string(artifactref.KindMemoryRecord), itemID, rec.ArtifactRefs); err != nil {
		return err
	}
	if err := b.insertMemoryHistoryTx(tx, rec, action, rec.UpdatedAt); err != nil {
		return err
	}
	return nil
}

func (b *SQLiteBackend) saveKnowledgeTx(tx *sql.Tx, scopeID string, itemID string, data []byte) error {
	var page knowledge.Page
	if err := json.Unmarshal(data, &page); err != nil {
		return fmt.Errorf("storage save knowledge: unmarshal: %w", err)
	}
	if err := knowledge.ValidatePage(page); err != nil {
		return fmt.Errorf("storage save knowledge: %w", err)
	}
	if string(page.PageID) != itemID {
		return fmt.Errorf("storage save knowledge: item id %s does not match page id %s", itemID, page.PageID)
	}
	action := knowledge.HistoryActionCreated
	if existing, err := b.loadKnowledgePageTx(tx, scopeID, itemID); err != nil {
		return err
	} else if existing != nil {
		switch page.Lifecycle {
		case knowledge.ProjectionLifecycleArchived:
			action = knowledge.HistoryActionArchived
		case knowledge.ProjectionLifecycleRemoved:
			action = knowledge.HistoryActionRemoved
		default:
			action = knowledge.HistoryActionUpdated
		}
	}
	if _, err := tx.Exec(`INSERT INTO knowledge_page
		(scope_id, page_id, kind, lifecycle, search_text, page_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(scope_id, page_id) DO UPDATE SET
			kind = excluded.kind,
			lifecycle = excluded.lifecycle,
			search_text = excluded.search_text,
			page_json = excluded.page_json,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at`,
		scopeID, string(page.PageID), string(page.Kind), string(page.Lifecycle), buildKnowledgeSearchText(page),
		data, encodeTime(page.CreatedAt), encodeTime(page.UpdatedAt)); err != nil {
		return fmt.Errorf("storage save knowledge row: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM knowledge_page_fts WHERE scope_id = ? AND page_id = ?`, scopeID, itemID); err != nil {
		return fmt.Errorf("storage save knowledge fts: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO knowledge_page_fts (scope_id, page_id, search_text) VALUES (?, ?, ?)`, scopeID, itemID, buildKnowledgeSearchText(page)); err != nil {
		return fmt.Errorf("storage save knowledge fts: %w", err)
	}
	if err := b.replaceRefsForArtifactTx(tx, scopeID, string(artifactref.KindKnowledgePage), itemID, page.ArtifactRefs); err != nil {
		return err
	}
	if err := b.saveKnowledgeEmbeddingTx(tx, scopeID, itemID, page); err != nil {
		return err
	}
	return b.insertKnowledgeHistoryTx(tx, page, action, page.UpdatedAt)
}

func (b *SQLiteBackend) saveSkillTx(tx *sql.Tx, scopeID string, itemID string, data []byte) error {
	var bundle skill.Bundle
	if err := json.Unmarshal(data, &bundle); err != nil {
		return fmt.Errorf("storage save skill: unmarshal: %w", err)
	}
	if err := skill.ValidateBundle(bundle); err != nil {
		return fmt.Errorf("storage save skill: %w", err)
	}
	if string(bundle.BundleID) != itemID {
		return fmt.Errorf("storage save skill: item id %s does not match bundle id %s", itemID, bundle.BundleID)
	}
	action := skill.HistoryActionCreated
	if existing, err := b.loadSkillBundleTx(tx, scopeID, itemID); err != nil {
		return err
	} else if existing != nil {
		switch bundle.Status {
		case skill.BundleStatusArchived:
			action = skill.HistoryActionArchived
		case skill.BundleStatusRemoved:
			action = skill.HistoryActionRemoved
		default:
			action = skill.HistoryActionUpdated
		}
	}
	if _, err := tx.Exec(`INSERT INTO skill_bundle
		(scope_id, bundle_id, status, search_text, bundle_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(scope_id, bundle_id) DO UPDATE SET
			status = excluded.status,
			search_text = excluded.search_text,
			bundle_json = excluded.bundle_json,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at`,
		scopeID, string(bundle.BundleID), string(bundle.Status), buildSkillSearchText(bundle),
		data, encodeTime(bundle.CreatedAt), encodeTime(bundle.UpdatedAt)); err != nil {
		return fmt.Errorf("storage save skill row: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM skill_bundle_fts WHERE scope_id = ? AND bundle_id = ?`, scopeID, itemID); err != nil {
		return fmt.Errorf("storage save skill fts: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO skill_bundle_fts (scope_id, bundle_id, search_text) VALUES (?, ?, ?)`, scopeID, itemID, buildSkillSearchText(bundle)); err != nil {
		return fmt.Errorf("storage save skill fts: %w", err)
	}
	if err := b.replaceRefsForArtifactTx(tx, scopeID, string(artifactref.KindSkillBundle), itemID, bundle.ArtifactRefs); err != nil {
		return err
	}
	return b.insertSkillHistoryTx(tx, bundle, action, bundle.UpdatedAt)
}

func (b *SQLiteBackend) saveCommitTx(tx *sql.Tx, scopeID string, itemID string, data []byte) error {
	var payload struct {
		CommitID   string    `json:"commit_id"`
		KernelType string    `json:"kernel_type"`
		CreatedAt  time.Time `json:"created_at"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return fmt.Errorf("storage save commit: unmarshal: %w", err)
	}
	createdAt := payload.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	if payload.CommitID != "" && payload.CommitID != itemID {
		return fmt.Errorf("storage save commit: item id %s does not match commit id %s", itemID, payload.CommitID)
	}
	if _, err := tx.Exec(`INSERT INTO kernel_commit (scope_id, commit_id, kernel_type, created_at, commit_json)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(commit_id) DO UPDATE SET
			kernel_type = excluded.kernel_type,
			created_at = excluded.created_at,
			commit_json = excluded.commit_json`,
		scopeID, itemID, payload.KernelType, encodeTime(createdAt), data); err != nil {
		return fmt.Errorf("storage save commit row: %w", err)
	}
	return nil
}

func (b *SQLiteBackend) ensureScopeTx(tx *sql.Tx, scopeID string, now time.Time) error {
	if _, err := tx.Exec(`INSERT INTO scope (scope_id, created_at, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(scope_id) DO UPDATE SET updated_at = excluded.updated_at`,
		scopeID, encodeTime(now), encodeTime(now)); err != nil {
		return fmt.Errorf("storage ensure scope: %w", err)
	}
	return nil
}

func (b *SQLiteBackend) replaceRefsForArtifactTx(tx *sql.Tx, scopeID string, fromKind string, fromID string, refs []artifactref.Ref) error {
	if err := b.deleteRefsForArtifactTx(tx, scopeID, fromKind, fromID); err != nil {
		return err
	}
	for _, ref := range refs {
		if err := artifactref.Validate(ref); err != nil {
			return fmt.Errorf("storage save refs for %s/%s: %w", fromKind, fromID, err)
		}
		if ref.FromKind != artifactref.Kind(fromKind) || ref.FromID != fromID {
			return fmt.Errorf("storage save refs for %s/%s: ref ownership mismatch", fromKind, fromID)
		}
		if _, err := tx.Exec(`INSERT INTO artifact_ref
			(scope_id, from_kind, from_id, to_kind, to_id, strength, role, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			scopeID, string(ref.FromKind), ref.FromID, string(ref.ToKind), ref.ToID, string(ref.Strength), ref.Role,
			encodeTime(ref.CreatedAt), encodeTime(ref.UpdatedAt)); err != nil {
			return fmt.Errorf("storage save refs for %s/%s: %w", fromKind, fromID, err)
		}
	}
	return nil
}

func (b *SQLiteBackend) deleteRefsForArtifactTx(tx *sql.Tx, scopeID string, fromKind string, fromID string) error {
	if _, err := tx.Exec(`DELETE FROM artifact_ref WHERE scope_id = ? AND from_kind = ? AND from_id = ?`, scopeID, fromKind, fromID); err != nil {
		return fmt.Errorf("storage delete refs for %s/%s: %w", fromKind, fromID, err)
	}
	return nil
}

func (b *SQLiteBackend) deleteRefsTargetingTx(tx *sql.Tx, scopeID string, toKind string, toID string) error {
	if _, err := tx.Exec(`DELETE FROM artifact_ref WHERE scope_id = ? AND to_kind = ? AND to_id = ?`, scopeID, toKind, toID); err != nil {
		return fmt.Errorf("storage delete refs targeting %s/%s: %w", toKind, toID, err)
	}
	return nil
}

func (b *SQLiteBackend) loadRefs(query string, args ...any) ([]artifactref.Ref, error) {
	rows, err := b.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("storage load refs: %w", err)
	}
	defer rows.Close()
	var refs []artifactref.Ref
	for rows.Next() {
		var ref artifactref.Ref
		var createdAt string
		var updatedAt string
		if err := rows.Scan(&ref.FromKind, &ref.FromID, &ref.ToKind, &ref.ToID, &ref.Strength, &ref.Role, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("storage load refs: %w", err)
		}
		ref.CreatedAt, err = decodeTime(createdAt)
		if err != nil {
			return nil, fmt.Errorf("storage load refs: %w", err)
		}
		ref.UpdatedAt, err = decodeTime(updatedAt)
		if err != nil {
			return nil, fmt.Errorf("storage load refs: %w", err)
		}
		refs = append(refs, ref)
	}
	return refs, rows.Err()
}

func (b *SQLiteBackend) loadMemoryRecordTx(tx *sql.Tx, scopeID string, recordID string) (*memory.Record, error) {
	var raw []byte
	err := tx.QueryRow(`SELECT record_json FROM memory_record WHERE scope_id = ? AND record_id = ?`, scopeID, recordID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("storage load memory in tx: %w", err)
	}
	var rec memory.Record
	if err := json.Unmarshal(raw, &rec); err != nil {
		return nil, fmt.Errorf("storage load memory in tx: %w", err)
	}
	return &rec, nil
}

func (b *SQLiteBackend) loadKnowledgePageTx(tx *sql.Tx, scopeID string, pageID string) (*knowledge.Page, error) {
	var raw []byte
	err := tx.QueryRow(`SELECT page_json FROM knowledge_page WHERE scope_id = ? AND page_id = ?`, scopeID, pageID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("storage load knowledge in tx: %w", err)
	}
	var page knowledge.Page
	if err := json.Unmarshal(raw, &page); err != nil {
		return nil, fmt.Errorf("storage load knowledge in tx: %w", err)
	}
	return &page, nil
}

func (b *SQLiteBackend) loadSkillBundleTx(tx *sql.Tx, scopeID string, bundleID string) (*skill.Bundle, error) {
	var raw []byte
	err := tx.QueryRow(`SELECT bundle_json FROM skill_bundle WHERE scope_id = ? AND bundle_id = ?`, scopeID, bundleID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("storage load skill in tx: %w", err)
	}
	var bundle skill.Bundle
	if err := json.Unmarshal(raw, &bundle); err != nil {
		return nil, fmt.Errorf("storage load skill in tx: %w", err)
	}
	return &bundle, nil
}

func (b *SQLiteBackend) saveKnowledgeEmbeddingTx(tx *sql.Tx, scopeID string, pageID string, page knowledge.Page) error {
	raw, err := json.Marshal(embedding.Vectorize(knowledgePageEmbeddingText(page)))
	if err != nil {
		return fmt.Errorf("storage save knowledge embedding: marshal: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO knowledge_page_embedding
		(scope_id, page_id, embedding_json, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(scope_id, page_id) DO UPDATE SET
			embedding_json = excluded.embedding_json,
			updated_at = excluded.updated_at`,
		scopeID, pageID, raw, encodeTime(page.UpdatedAt)); err != nil {
		return fmt.Errorf("storage save knowledge embedding: %w", err)
	}
	return nil
}

func (b *SQLiteBackend) upsertKnowledgeRelationTx(tx *sql.Tx, rel knowledge.Relation) error {
	raw, err := json.Marshal(rel)
	if err != nil {
		return fmt.Errorf("storage save knowledge relation: marshal: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO knowledge_relation
		(scope_id, from_page_id, to_page_id, relation_type, strength, relation_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(scope_id, from_page_id, to_page_id, relation_type) DO UPDATE SET
			strength = excluded.strength,
			relation_json = excluded.relation_json,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at`,
		rel.ScopeID, string(rel.FromPageID), string(rel.ToPageID), rel.RelationType, string(rel.Strength), raw, encodeTime(rel.CreatedAt), encodeTime(rel.UpdatedAt)); err != nil {
		return fmt.Errorf("storage save knowledge relation: %w", err)
	}
	ref := artifactref.Ref{
		FromKind:  artifactref.KindKnowledgePage,
		FromID:    string(rel.FromPageID),
		ToKind:    artifactref.KindKnowledgePage,
		ToID:      string(rel.ToPageID),
		Strength:  rel.Strength,
		Role:      relationRole(rel.RelationType),
		CreatedAt: rel.CreatedAt,
		UpdatedAt: rel.UpdatedAt,
	}
	if err := b.deleteKnowledgeRelationRefTx(tx, rel.ScopeID, string(rel.FromPageID), string(rel.ToPageID), rel.RelationType); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO artifact_ref
		(scope_id, from_kind, from_id, to_kind, to_id, strength, role, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		rel.ScopeID, string(ref.FromKind), ref.FromID, string(ref.ToKind), ref.ToID, string(ref.Strength), ref.Role, encodeTime(ref.CreatedAt), encodeTime(ref.UpdatedAt)); err != nil {
		return fmt.Errorf("storage save knowledge relation ref: %w", err)
	}
	return nil
}

func (b *SQLiteBackend) deleteKnowledgeRelationTx(tx *sql.Tx, scopeID string, fromPageID string, toPageID string, relationType string) error {
	if _, err := tx.Exec(`DELETE FROM knowledge_relation WHERE scope_id = ? AND from_page_id = ? AND to_page_id = ? AND relation_type = ?`, scopeID, fromPageID, toPageID, relationType); err != nil {
		return fmt.Errorf("storage delete knowledge relation: %w", err)
	}
	return b.deleteKnowledgeRelationRefTx(tx, scopeID, fromPageID, toPageID, relationType)
}

func (b *SQLiteBackend) deleteKnowledgeRelationRefTx(tx *sql.Tx, scopeID string, fromPageID string, toPageID string, relationType string) error {
	if _, err := tx.Exec(`DELETE FROM artifact_ref
		WHERE scope_id = ? AND from_kind = ? AND from_id = ? AND to_kind = ? AND to_id = ? AND role = ?`,
		scopeID, string(artifactref.KindKnowledgePage), fromPageID, string(artifactref.KindKnowledgePage), toPageID, relationRole(relationType)); err != nil {
		return fmt.Errorf("storage delete knowledge relation ref: %w", err)
	}
	return nil
}

func (b *SQLiteBackend) deleteKnowledgeRelationsForPageTx(tx *sql.Tx, scopeID string, pageID string) error {
	rows, err := tx.Query(`SELECT from_page_id, to_page_id, relation_type FROM knowledge_relation WHERE scope_id = ? AND (from_page_id = ? OR to_page_id = ?)`, scopeID, pageID, pageID)
	if err != nil {
		return fmt.Errorf("storage delete knowledge relations for page: %w", err)
	}
	defer rows.Close()
	type relKey struct {
		from string
		to   string
		typ  string
	}
	var relations []relKey
	for rows.Next() {
		var item relKey
		if err := rows.Scan(&item.from, &item.to, &item.typ); err != nil {
			return fmt.Errorf("storage delete knowledge relations for page: %w", err)
		}
		relations = append(relations, item)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("storage delete knowledge relations for page: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM knowledge_relation WHERE scope_id = ? AND (from_page_id = ? OR to_page_id = ?)`, scopeID, pageID, pageID); err != nil {
		return fmt.Errorf("storage delete knowledge relations for page: %w", err)
	}
	for _, rel := range relations {
		if err := b.deleteKnowledgeRelationRefTx(tx, scopeID, rel.from, rel.to, rel.typ); err != nil {
			return err
		}
	}
	return nil
}

func (b *SQLiteBackend) loadKnowledgeRelations(query string, args ...any) ([]knowledge.Relation, error) {
	rows, err := b.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("storage load knowledge relations: %w", err)
	}
	defer rows.Close()
	var relations []knowledge.Relation
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, fmt.Errorf("storage load knowledge relations: %w", err)
		}
		var rel knowledge.Relation
		if err := json.Unmarshal(raw, &rel); err != nil {
			return nil, fmt.Errorf("storage load knowledge relations: %w", err)
		}
		relations = append(relations, rel)
	}
	return relations, rows.Err()
}

func (b *SQLiteBackend) insertMemoryHistoryTx(tx *sql.Tx, rec memory.Record, action memory.HistoryAction, at time.Time) error {
	if _, err := tx.Exec(`INSERT INTO memory_history
		(scope_id, record_id, action, lifecycle, version, at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		rec.ScopeID, string(rec.RecordID), string(action), string(rec.Lifecycle), rec.Version, encodeTime(at)); err != nil {
		return fmt.Errorf("storage save memory history: %w", err)
	}
	return nil
}

func (b *SQLiteBackend) insertKnowledgeHistoryTx(tx *sql.Tx, page knowledge.Page, action knowledge.HistoryAction, at time.Time) error {
	if _, err := tx.Exec(`INSERT INTO knowledge_history
		(scope_id, page_id, action, lifecycle, version, at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		page.ScopeID, string(page.PageID), string(action), string(page.Lifecycle), page.Version, encodeTime(at)); err != nil {
		return fmt.Errorf("storage save knowledge history: %w", err)
	}
	return nil
}

func (b *SQLiteBackend) insertSkillHistoryTx(tx *sql.Tx, bundle skill.Bundle, action skill.HistoryAction, at time.Time) error {
	if _, err := tx.Exec(`INSERT INTO skill_history
		(scope_id, bundle_id, action, status, version, at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		bundle.ScopeID, string(bundle.BundleID), string(action), string(bundle.Status), bundle.Version, encodeTime(at)); err != nil {
		return fmt.Errorf("storage save skill history: %w", err)
	}
	return nil
}
