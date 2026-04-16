package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	"github.com/nimiplatform/nimi/nimi-cognition/kernel"
	"github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	"github.com/nimiplatform/nimi/nimi-cognition/memory"
	"github.com/nimiplatform/nimi/nimi-cognition/skill"
)

// LoadKernelState returns the current aggregate kernel state for a scope/type.
func (b *SQLiteBackend) LoadKernelState(scopeID string, kt kernel.KernelType) (*kernel.Kernel, []kernel.Rule, error) {
	raw, err := b.Load(scopeID, KindKernel, string(kt))
	if err != nil || raw == nil {
		return nil, nil, err
	}
	var payload struct {
		Kernel kernel.Kernel `json:"kernel"`
		Rules  []kernel.Rule `json:"rules"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, nil, fmt.Errorf("storage load kernel state: %w", err)
	}
	return &payload.Kernel, payload.Rules, nil
}

// LoadMemoryRecords returns all memory records for a scope.
func (b *SQLiteBackend) LoadMemoryRecords(scopeID string) ([]memory.Record, error) {
	return loadJSONRows[memory.Record](b.db, `SELECT record_json FROM memory_record WHERE scope_id = ? ORDER BY updated_at DESC, record_id`, scopeID)
}

// LoadKnowledgePages returns all knowledge pages for a scope.
func (b *SQLiteBackend) LoadKnowledgePages(scopeID string) ([]knowledge.Page, error) {
	return loadJSONRows[knowledge.Page](b.db, `SELECT page_json FROM knowledge_page WHERE scope_id = ? ORDER BY updated_at DESC, page_id`, scopeID)
}

// KnowledgeCitationSource identifies one persisted knowledge page that cites a
// target through the admitted citation surface.
type KnowledgeCitationSource struct {
	PageID    knowledge.PageID
	Lifecycle knowledge.ProjectionLifecycle
}

// ListKnowledgeCitationSources returns knowledge pages in one scope that cite
// the requested target. The result includes every persisted lifecycle except
// deleted pages, so target mutation can remain fail-closed for durable pages.
func (b *SQLiteBackend) ListKnowledgeCitationSources(scopeID string, targetKind string, targetID string) ([]KnowledgeCitationSource, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if err := validateItemID(targetID); err != nil {
		return nil, err
	}
	switch targetKind {
	case knowledge.CitationTargetKindKernelRule, knowledge.CitationTargetKindMemoryRecord:
	default:
		return nil, fmt.Errorf("knowledge citation target kind %s is not admitted", targetKind)
	}
	pages, err := b.LoadKnowledgePages(scopeID)
	if err != nil {
		return nil, err
	}
	sources := make([]KnowledgeCitationSource, 0)
	for _, page := range pages {
		if err := knowledge.ValidatePage(page); err != nil {
			return nil, fmt.Errorf("storage load knowledge citation sources: %w", err)
		}
		for _, citation := range page.Citations {
			if citation.TargetKind != targetKind || citation.TargetID != targetID {
				continue
			}
			sources = append(sources, KnowledgeCitationSource{
				PageID:    page.PageID,
				Lifecycle: page.Lifecycle,
			})
			break
		}
	}
	return sources, nil
}

// LoadSkillBundles returns all skill bundles for a scope.
func (b *SQLiteBackend) LoadSkillBundles(scopeID string) ([]skill.Bundle, error) {
	return loadJSONRows[skill.Bundle](b.db, `SELECT bundle_json FROM skill_bundle WHERE scope_id = ? ORDER BY updated_at DESC, bundle_id`, scopeID)
}

// LoadMemoryHistory returns lifecycle history for one memory record.
func (b *SQLiteBackend) LoadMemoryHistory(scopeID string, recordID string) ([]memory.HistoryEntry, error) {
	rows, err := b.db.Query(`SELECT scope_id, record_id, action, lifecycle, version, at
		FROM memory_history WHERE scope_id = ? AND record_id = ?`, scopeID, recordID)
	if err != nil {
		return nil, fmt.Errorf("storage load memory history: %w", err)
	}
	defer rows.Close()
	var history []memory.HistoryEntry
	for rows.Next() {
		var entry memory.HistoryEntry
		var at string
		if err := rows.Scan(&entry.ScopeID, &entry.RecordID, &entry.Action, &entry.Lifecycle, &entry.Version, &at); err != nil {
			return nil, fmt.Errorf("storage load memory history: %w", err)
		}
		entry.At, err = decodeTime(at)
		if err != nil {
			return nil, fmt.Errorf("storage load memory history: %w", err)
		}
		history = append(history, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(history, func(i, j int) bool {
		return history[i].At.After(history[j].At)
	})
	return history, nil
}

// LoadKnowledgeHistory returns lifecycle history for one knowledge page.
func (b *SQLiteBackend) LoadKnowledgeHistory(scopeID string, pageID string) ([]knowledge.HistoryEntry, error) {
	rows, err := b.db.Query(`SELECT scope_id, page_id, action, lifecycle, version, at
		FROM knowledge_history WHERE scope_id = ? AND page_id = ?`, scopeID, pageID)
	if err != nil {
		return nil, fmt.Errorf("storage load knowledge history: %w", err)
	}
	defer rows.Close()
	var history []knowledge.HistoryEntry
	for rows.Next() {
		var entry knowledge.HistoryEntry
		var at string
		if err := rows.Scan(&entry.ScopeID, &entry.PageID, &entry.Action, &entry.Lifecycle, &entry.Version, &at); err != nil {
			return nil, fmt.Errorf("storage load knowledge history: %w", err)
		}
		entry.At, err = decodeTime(at)
		if err != nil {
			return nil, fmt.Errorf("storage load knowledge history: %w", err)
		}
		history = append(history, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(history, func(i, j int) bool {
		return history[i].At.After(history[j].At)
	})
	return history, nil
}

// LoadSkillHistory returns lifecycle history for one skill bundle.
func (b *SQLiteBackend) LoadSkillHistory(scopeID string, bundleID string) ([]skill.HistoryEntry, error) {
	rows, err := b.db.Query(`SELECT scope_id, bundle_id, action, status, version, at
		FROM skill_history WHERE scope_id = ? AND bundle_id = ?`, scopeID, bundleID)
	if err != nil {
		return nil, fmt.Errorf("storage load skill history: %w", err)
	}
	defer rows.Close()
	var history []skill.HistoryEntry
	for rows.Next() {
		var entry skill.HistoryEntry
		var at string
		if err := rows.Scan(&entry.ScopeID, &entry.BundleID, &entry.Action, &entry.Status, &entry.Version, &at); err != nil {
			return nil, fmt.Errorf("storage load skill history: %w", err)
		}
		entry.At, err = decodeTime(at)
		if err != nil {
			return nil, fmt.Errorf("storage load skill history: %w", err)
		}
		history = append(history, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(history, func(i, j int) bool {
		return history[i].At.After(history[j].At)
	})
	return history, nil
}

// SaveKnowledgeIngestTask persists one local ingest task.
func (b *SQLiteBackend) SaveKnowledgeIngestTask(task knowledge.IngestTask) error {
	if err := validateScopeID(task.ScopeID); err != nil {
		return err
	}
	if err := validateItemID(task.TaskID); err != nil {
		return err
	}
	if err := knowledge.ValidateIngestTask(task); err != nil {
		return fmt.Errorf("storage save ingest task: %w", err)
	}
	tx, err := b.db.Begin()
	if err != nil {
		return fmt.Errorf("storage save ingest task: begin tx: %w", err)
	}
	defer rollback(tx)
	if err := b.saveKnowledgeIngestTaskTx(tx, task); err != nil {
		return err
	}
	return tx.Commit()
}

// SaveKnowledgePageAndIngestTask atomically persists one knowledge page plus
// its completed ingest task state.
func (b *SQLiteBackend) SaveKnowledgePageAndIngestTask(page knowledge.Page, task knowledge.IngestTask) error {
	if err := validateScopeID(page.ScopeID); err != nil {
		return err
	}
	if err := validateItemID(string(page.PageID)); err != nil {
		return err
	}
	if err := knowledge.ValidatePage(page); err != nil {
		return fmt.Errorf("storage save knowledge+ingest: %w", err)
	}
	if err := knowledge.ValidateIngestTask(task); err != nil {
		return fmt.Errorf("storage save knowledge+ingest: %w", err)
	}
	if task.ScopeID != page.ScopeID {
		return fmt.Errorf("storage save knowledge+ingest: task scope %s does not match page scope %s", task.ScopeID, page.ScopeID)
	}
	if task.PageID != page.PageID {
		return fmt.Errorf("storage save knowledge+ingest: task page %s does not match page id %s", task.PageID, page.PageID)
	}
	tx, err := b.db.Begin()
	if err != nil {
		return fmt.Errorf("storage save knowledge+ingest: begin tx: %w", err)
	}
	defer rollback(tx)
	now := page.UpdatedAt
	if task.UpdatedAt.After(now) {
		now = task.UpdatedAt
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if err := b.ensureScopeTx(tx, page.ScopeID, now); err != nil {
		return err
	}
	pageRaw, err := json.Marshal(page)
	if err != nil {
		return fmt.Errorf("storage save knowledge+ingest: marshal page: %w", err)
	}
	if err := b.saveKnowledgeTx(tx, page.ScopeID, string(page.PageID), pageRaw); err != nil {
		return err
	}
	if err := b.saveKnowledgeIngestTaskTx(tx, task); err != nil {
		return err
	}
	return tx.Commit()
}

func (b *SQLiteBackend) saveKnowledgeIngestTaskTx(tx *sql.Tx, task knowledge.IngestTask) error {
	raw, err := json.Marshal(task)
	if err != nil {
		return fmt.Errorf("storage save ingest task: marshal: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO knowledge_ingest_task
		(scope_id, task_id, task_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(scope_id, task_id) DO UPDATE SET
			task_json = excluded.task_json,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at`,
		task.ScopeID, task.TaskID, raw, encodeTime(task.CreatedAt), encodeTime(task.UpdatedAt)); err != nil {
		return fmt.Errorf("storage save ingest task: %w", err)
	}
	return nil
}

// LoadKnowledgeIngestTask returns one local ingest task.
func (b *SQLiteBackend) LoadKnowledgeIngestTask(scopeID string, taskID string) (*knowledge.IngestTask, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if err := validateItemID(taskID); err != nil {
		return nil, err
	}
	var raw []byte
	err := b.db.QueryRow(`SELECT task_json FROM knowledge_ingest_task WHERE scope_id = ? AND task_id = ?`, scopeID, taskID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("storage load ingest task: %w", err)
	}
	var task knowledge.IngestTask
	if err := json.Unmarshal(raw, &task); err != nil {
		return nil, fmt.Errorf("storage load ingest task: %w", err)
	}
	return &task, nil
}

// ListKnowledgeIngestTasks returns all local ingest tasks for one scope.
func (b *SQLiteBackend) ListKnowledgeIngestTasks(scopeID string) ([]knowledge.IngestTask, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	rows, err := b.db.Query(`SELECT task_json FROM knowledge_ingest_task WHERE scope_id = ? ORDER BY updated_at DESC, task_id DESC`, scopeID)
	if err != nil {
		return nil, fmt.Errorf("storage list ingest tasks: %w", err)
	}
	return scanJSONRows[knowledge.IngestTask](rows)
}

// SearchMemory performs FTS-backed lexical lookup.
func (b *SQLiteBackend) SearchMemory(scopeID string, query string, limit int) ([]memory.Record, error) {
	if limit <= 0 {
		limit = 10
	}
	if strings.TrimSpace(query) == "" {
		return loadJSONRows[memory.Record](b.db, `SELECT record_json FROM memory_record WHERE scope_id = ? AND lifecycle != ? ORDER BY updated_at DESC, record_id LIMIT ?`, scopeID, string(memory.RecordLifecycleRemoved), limit)
	}
	rows, err := b.db.Query(`
		SELECT mr.record_json
		FROM memory_record mr
		JOIN memory_record_fts fts
		  ON mr.scope_id = fts.scope_id AND mr.record_id = fts.record_id
		WHERE fts.scope_id = ? AND mr.lifecycle != ? AND fts.search_text MATCH ?
		ORDER BY bm25(memory_record_fts), mr.updated_at DESC
		LIMIT ?`, scopeID, string(memory.RecordLifecycleRemoved), query, limit)
	if err != nil {
		return nil, fmt.Errorf("storage search memory: lexical substrate unavailable: %w", err)
	}
	return scanJSONRows[memory.Record](rows)
}

// SearchKnowledge performs FTS-backed lexical lookup.
func (b *SQLiteBackend) SearchKnowledge(scopeID string, query string, limit int) ([]knowledge.Page, error) {
	if limit <= 0 {
		limit = 10
	}
	if strings.TrimSpace(query) == "" {
		return loadJSONRows[knowledge.Page](b.db, `SELECT page_json FROM knowledge_page WHERE scope_id = ? AND lifecycle != ? ORDER BY updated_at DESC LIMIT ?`, scopeID, string(knowledge.ProjectionLifecycleRemoved), limit)
	}
	rows, err := b.db.Query(`
		SELECT kp.page_json
		FROM knowledge_page kp
		JOIN knowledge_page_fts fts
		  ON kp.scope_id = fts.scope_id AND kp.page_id = fts.page_id
		WHERE fts.scope_id = ? AND kp.lifecycle != ? AND fts.search_text MATCH ?
		ORDER BY bm25(knowledge_page_fts), kp.updated_at DESC
		LIMIT ?`, scopeID, string(knowledge.ProjectionLifecycleRemoved), query, limit)
	if err != nil {
		return nil, fmt.Errorf("storage search knowledge: lexical substrate unavailable: %w", err)
	}
	return scanJSONRows[knowledge.Page](rows)
}

// SearchSkill performs FTS-backed lexical lookup over visible skill bundles.
func (b *SQLiteBackend) SearchSkill(scopeID string, query string, limit int) ([]skill.Bundle, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := b.db.Query(`
		SELECT sb.bundle_json
		FROM skill_bundle sb
		JOIN skill_bundle_fts fts
		  ON sb.scope_id = fts.scope_id AND sb.bundle_id = fts.bundle_id
		WHERE fts.scope_id = ? AND sb.status != ? AND fts.search_text MATCH ?
		ORDER BY bm25(skill_bundle_fts), sb.updated_at DESC, sb.bundle_id ASC
		LIMIT ?`, scopeID, string(skill.BundleStatusRemoved), query, limit)
	if err != nil {
		return nil, fmt.Errorf("storage search skill: lexical substrate unavailable: %w", err)
	}
	return scanJSONRows[skill.Bundle](rows)
}

// IncomingRefs returns all refs pointing to the target artifact.
func (b *SQLiteBackend) IncomingRefs(scopeID string, toKind artifactref.Kind, toID string) ([]artifactref.Ref, error) {
	return b.loadRefs(`SELECT from_kind, from_id, to_kind, to_id, strength, role, created_at, updated_at
		FROM artifact_ref WHERE scope_id = ? AND to_kind = ? AND to_id = ? ORDER BY updated_at DESC`, scopeID, string(toKind), toID)
}

// OutgoingRefs returns all refs owned by the source artifact.
func (b *SQLiteBackend) OutgoingRefs(scopeID string, fromKind artifactref.Kind, fromID string) ([]artifactref.Ref, error) {
	return b.loadRefs(`SELECT from_kind, from_id, to_kind, to_id, strength, role, created_at, updated_at
		FROM artifact_ref WHERE scope_id = ? AND from_kind = ? AND from_id = ? ORDER BY updated_at DESC`, scopeID, string(fromKind), fromID)
}

// SupportSummary returns incoming support counts and weighted score.
func (b *SQLiteBackend) SupportSummary(scopeID string, toKind artifactref.Kind, toID string) (SupportSummary, error) {
	refs, err := b.IncomingRefs(scopeID, toKind, toID)
	if err != nil {
		return SupportSummary{}, err
	}
	var summary SupportSummary
	for _, ref := range refs {
		switch ref.Strength {
		case artifactref.StrengthStrong:
			summary.Strong++
			summary.Score += 1.0
		case artifactref.StrengthWeak:
			summary.Weak++
			summary.Score += 0.35
		}
	}
	return summary, nil
}

// SaveKnowledgeRelation persists one canonical page relation and mirrors it into refgraph rows.
func (b *SQLiteBackend) SaveKnowledgeRelation(rel knowledge.Relation) error {
	if err := validateScopeID(rel.ScopeID); err != nil {
		return err
	}
	if err := knowledge.ValidateRelation(rel); err != nil {
		return err
	}
	tx, err := b.db.Begin()
	if err != nil {
		return fmt.Errorf("storage save knowledge relation: begin tx: %w", err)
	}
	defer rollback(tx)
	if err := b.upsertKnowledgeRelationTx(tx, rel); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteKnowledgeRelation deletes one canonical page relation.
func (b *SQLiteBackend) DeleteKnowledgeRelation(scopeID string, fromPageID string, toPageID string, relationType string) error {
	if err := validateScopeID(scopeID); err != nil {
		return err
	}
	tx, err := b.db.Begin()
	if err != nil {
		return fmt.Errorf("storage delete knowledge relation: begin tx: %w", err)
	}
	defer rollback(tx)
	if err := b.deleteKnowledgeRelationTx(tx, scopeID, fromPageID, toPageID, relationType); err != nil {
		return err
	}
	return tx.Commit()
}

// ListKnowledgeRelations returns canonical outgoing relations for one page.
func (b *SQLiteBackend) ListKnowledgeRelations(scopeID string, fromPageID string) ([]knowledge.Relation, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	return b.loadKnowledgeRelations(`SELECT relation_json FROM knowledge_relation WHERE scope_id = ? AND from_page_id = ? ORDER BY updated_at DESC, to_page_id ASC, relation_type ASC`, scopeID, fromPageID)
}

// ListKnowledgeBacklinks returns canonical incoming relations for one page.
func (b *SQLiteBackend) ListKnowledgeBacklinks(scopeID string, toPageID string) ([]knowledge.Relation, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	return b.loadKnowledgeRelations(`SELECT relation_json FROM knowledge_relation WHERE scope_id = ? AND to_page_id = ? ORDER BY updated_at DESC, from_page_id ASC, relation_type ASC`, scopeID, toPageID)
}

// CountKnowledgeRelations returns the number of canonical relation rows in one scope.
func (b *SQLiteBackend) CountKnowledgeRelations(scopeID string) (int, error) {
	if err := validateScopeID(scopeID); err != nil {
		return 0, err
	}
	var count int
	if err := b.db.QueryRow(`SELECT COUNT(*) FROM knowledge_relation WHERE scope_id = ?`, scopeID).Scan(&count); err != nil {
		return 0, fmt.Errorf("storage count knowledge relations: %w", err)
	}
	return count, nil
}

// LoadKnowledgeEmbeddings returns page embeddings for one scope keyed by page id.
func (b *SQLiteBackend) LoadKnowledgeEmbeddings(scopeID string) (map[string][]float64, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	rows, err := b.db.Query(`SELECT page_id, embedding_json FROM knowledge_page_embedding WHERE scope_id = ?`, scopeID)
	if err != nil {
		return nil, fmt.Errorf("storage load knowledge embeddings: %w", err)
	}
	defer rows.Close()
	result := make(map[string][]float64)
	for rows.Next() {
		var pageID string
		var raw []byte
		if err := rows.Scan(&pageID, &raw); err != nil {
			return nil, fmt.Errorf("storage load knowledge embeddings: %w", err)
		}
		var vec []float64
		if err := json.Unmarshal(raw, &vec); err != nil {
			return nil, fmt.Errorf("storage load knowledge embeddings: %w", err)
		}
		result[pageID] = vec
	}
	return result, rows.Err()
}

// LoadKernelRuleByID loads one kernel rule by scope-local rule id.
func (b *SQLiteBackend) LoadKernelRuleByID(scopeID string, ruleID string) (*kernel.Rule, error) {
	if err := validateScopeID(scopeID); err != nil {
		return nil, err
	}
	if err := validateItemID(ruleID); err != nil {
		return nil, err
	}
	var raw []byte
	err := b.db.QueryRow(`SELECT rule_json FROM kernel_rule WHERE scope_id = ? AND rule_id = ? ORDER BY updated_at DESC LIMIT 1`, scopeID, ruleID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("storage load kernel rule: %w", err)
	}
	var rule kernel.Rule
	if err := json.Unmarshal(raw, &rule); err != nil {
		return nil, fmt.Errorf("storage load kernel rule: %w", err)
	}
	return &rule, nil
}

// IsArtifactRefTargetLive reports whether one admitted artifact-ref target
// exists in scope and remains non-removed.
func (b *SQLiteBackend) IsArtifactRefTargetLive(scopeID string, kind artifactref.Kind, itemID string) (bool, error) {
	if err := validateScopeID(scopeID); err != nil {
		return false, err
	}
	if err := validateItemID(itemID); err != nil {
		return false, err
	}
	var storageKind ArtifactKind
	switch kind {
	case artifactref.KindMemoryRecord:
		storageKind = KindMemory
	case artifactref.KindKnowledgePage:
		storageKind = KindKnowledge
	case artifactref.KindSkillBundle:
		storageKind = KindSkill
	default:
		return false, fmt.Errorf("referenced artifact kind %s is not admitted", kind)
	}
	raw, err := b.Load(scopeID, storageKind, itemID)
	if err != nil {
		return false, err
	}
	if raw == nil {
		return false, nil
	}
	switch kind {
	case artifactref.KindMemoryRecord:
		var rec memory.Record
		if err := json.Unmarshal(raw, &rec); err != nil {
			return false, fmt.Errorf("referenced artifact %s/%s is malformed: %w", kind, itemID, err)
		}
		return rec.Lifecycle != memory.RecordLifecycleRemoved, nil
	case artifactref.KindKnowledgePage:
		var page knowledge.Page
		if err := json.Unmarshal(raw, &page); err != nil {
			return false, fmt.Errorf("referenced artifact %s/%s is malformed: %w", kind, itemID, err)
		}
		return page.Lifecycle != knowledge.ProjectionLifecycleRemoved, nil
	case artifactref.KindSkillBundle:
		var bundle skill.Bundle
		if err := json.Unmarshal(raw, &bundle); err != nil {
			return false, fmt.Errorf("referenced artifact %s/%s is malformed: %w", kind, itemID, err)
		}
		return bundle.Status != skill.BundleStatusRemoved, nil
	default:
		return false, nil
	}
}
