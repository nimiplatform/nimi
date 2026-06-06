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
	switch payload.Kernel.KernelType {
	case kernel.KernelTypeAgentModel:
		if err := kernel.ValidateAgentModelKernel(kernel.AgentModelKernel{Kernel: payload.Kernel, Rules: payload.Rules}); err != nil {
			return fmt.Errorf("storage save kernel: %w", err)
		}
	case kernel.KernelTypeWorldModel:
		if err := kernel.ValidateWorldModelKernel(kernel.WorldModelKernel{Kernel: payload.Kernel, Rules: payload.Rules}); err != nil {
			return fmt.Errorf("storage save kernel: %w", err)
		}
	default:
		return fmt.Errorf("storage save kernel: invalid kernel_type %q", payload.Kernel.KernelType)
	}
	if string(payload.Kernel.KernelType) != itemID {
		return fmt.Errorf("storage save kernel: item id %s does not match kernel type %s", itemID, payload.Kernel.KernelType)
	}
	if payload.Kernel.ScopeID != scopeID {
		return fmt.Errorf("storage save kernel: payload scope %s does not match save scope %s", payload.Kernel.ScopeID, scopeID)
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
			if closeErr := rows.Close(); closeErr != nil {
				return fmt.Errorf("storage save kernel rules: %w", errors.Join(err, closeErr))
			}
			return fmt.Errorf("storage save kernel rules: %w", err)
		}
		staleIDs = append(staleIDs, ruleID)
	}
	if err := rows.Err(); err != nil {
		if closeErr := rows.Close(); closeErr != nil {
			return fmt.Errorf("storage save kernel rules: %w", errors.Join(err, closeErr))
		}
		return fmt.Errorf("storage save kernel rules: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("storage save kernel rules: close rows: %w", err)
	}
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
	if rec.ScopeID != scopeID {
		return fmt.Errorf("storage save memory: payload scope %s does not match save scope %s", rec.ScopeID, scopeID)
	}
	if rec.Lifecycle == memory.RecordLifecycleRemoved {
		if err := b.ensureNoIncomingRefsTx(tx, scopeID, string(artifactref.KindMemoryRecord), itemID); err != nil {
			return err
		}
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
	if page.ScopeID != scopeID {
		return fmt.Errorf("storage save knowledge: payload scope %s does not match save scope %s", page.ScopeID, scopeID)
	}
	if page.Lifecycle == knowledge.ProjectionLifecycleRemoved {
		if err := b.ensureNoIncomingRefsTx(tx, scopeID, string(artifactref.KindKnowledgePage), itemID); err != nil {
			return err
		}
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
	if bundle.ScopeID != scopeID {
		return fmt.Errorf("storage save skill: payload scope %s does not match save scope %s", bundle.ScopeID, scopeID)
	}
	if bundle.Status == skill.BundleStatusRemoved {
		if err := b.ensureNoIncomingRefsTx(tx, scopeID, string(artifactref.KindSkillBundle), itemID); err != nil {
			return err
		}
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
		if err := b.validateArtifactRefTargetTx(tx, scopeID, fromKind, fromID, ref); err != nil {
			return err
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

func (b *SQLiteBackend) validateArtifactRefTargetTx(tx *sql.Tx, scopeID string, fromKind string, fromID string, ref artifactref.Ref) error {
	if !isAdmittedArtifactRefTarget(ref.FromKind, ref.ToKind) {
		return fmt.Errorf("storage save refs for %s/%s: target family %s is not admitted", fromKind, fromID, ref.ToKind)
	}
	live, err := b.isArtifactRefTargetLiveTx(tx, scopeID, ref.ToKind, ref.ToID)
	if err != nil {
		return fmt.Errorf("storage save refs for %s/%s: %w", fromKind, fromID, err)
	}
	if !live {
		return fmt.Errorf("storage save refs for %s/%s: target %s/%s does not exist or is removed", fromKind, fromID, ref.ToKind, ref.ToID)
	}
	return nil
}

func isAdmittedArtifactRefTarget(fromKind artifactref.Kind, toKind artifactref.Kind) bool {
	switch fromKind {
	case artifactref.KindKernelRule, artifactref.KindMemoryRecord, artifactref.KindKnowledgePage, artifactref.KindSkillBundle:
	default:
		return false
	}
	switch toKind {
	case artifactref.KindMemoryRecord, artifactref.KindKnowledgePage, artifactref.KindSkillBundle:
		return true
	default:
		return false
	}
}

func (b *SQLiteBackend) isArtifactRefTargetLiveTx(tx *sql.Tx, scopeID string, kind artifactref.Kind, itemID string) (bool, error) {
	switch kind {
	case artifactref.KindMemoryRecord:
		var lifecycle string
		err := tx.QueryRow(`SELECT lifecycle FROM memory_record WHERE scope_id = ? AND record_id = ?`, scopeID, itemID).Scan(&lifecycle)
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, fmt.Errorf("load referenced memory %s: %w", itemID, err)
		}
		return lifecycle != string(memory.RecordLifecycleRemoved), nil
	case artifactref.KindKnowledgePage:
		var lifecycle string
		err := tx.QueryRow(`SELECT lifecycle FROM knowledge_page WHERE scope_id = ? AND page_id = ?`, scopeID, itemID).Scan(&lifecycle)
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, fmt.Errorf("load referenced knowledge %s: %w", itemID, err)
		}
		return lifecycle != string(knowledge.ProjectionLifecycleRemoved), nil
	case artifactref.KindSkillBundle:
		var status string
		err := tx.QueryRow(`SELECT status FROM skill_bundle WHERE scope_id = ? AND bundle_id = ?`, scopeID, itemID).Scan(&status)
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, fmt.Errorf("load referenced skill %s: %w", itemID, err)
		}
		return status != string(skill.BundleStatusRemoved), nil
	default:
		return false, fmt.Errorf("referenced artifact kind %s is not admitted", kind)
	}
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

func (b *SQLiteBackend) ensureNoIncomingRefsTx(tx *sql.Tx, scopeID string, toKind string, toID string) (err error) {
	rows, err := tx.Query(`SELECT from_kind, from_id, strength FROM artifact_ref WHERE scope_id = ? AND to_kind = ? AND to_id = ?`, scopeID, toKind, toID)
	if err != nil {
		return fmt.Errorf("storage incoming refs for %s/%s: %w", toKind, toID, err)
	}
	defer closeRows(rows, &err, fmt.Sprintf("storage incoming refs for %s/%s", toKind, toID))
	blocking := 0
	for rows.Next() {
		var fromKind artifactref.Kind
		var fromID string
		var strength artifactref.Strength
		if err := rows.Scan(&fromKind, &fromID, &strength); err != nil {
			return fmt.Errorf("storage incoming refs for %s/%s: %w", toKind, toID, err)
		}
		live, active, err := b.artifactRefSourceStateTx(tx, scopeID, fromKind, fromID)
		if err != nil {
			return err
		}
		if strength == artifactref.StrengthStrong && live {
			blocking++
			continue
		}
		if strength == artifactref.StrengthWeak && active {
			blocking++
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("storage incoming refs for %s/%s: %w", toKind, toID, err)
	}
	if blocking > 0 {
		return fmt.Errorf("storage remove %s/%s: blocked by %d incoming refs", toKind, toID, blocking)
	}
	return nil
}

func (b *SQLiteBackend) artifactRefSourceStateTx(tx *sql.Tx, scopeID string, kind artifactref.Kind, itemID string) (bool, bool, error) {
	switch kind {
	case artifactref.KindKernelRule:
		var lifecycle string
		err := tx.QueryRow(`SELECT lifecycle FROM kernel_rule WHERE scope_id = ? AND rule_id = ? ORDER BY updated_at DESC LIMIT 1`, scopeID, itemID).Scan(&lifecycle)
		if errors.Is(err, sql.ErrNoRows) {
			return false, false, nil
		}
		if err != nil {
			return false, false, fmt.Errorf("storage incoming ref source kernel_rule/%s: %w", itemID, err)
		}
		active := lifecycle == string(kernel.RuleLifecycleActive)
		return active, active, nil
	case artifactref.KindMemoryRecord:
		var lifecycle string
		err := tx.QueryRow(`SELECT lifecycle FROM memory_record WHERE scope_id = ? AND record_id = ?`, scopeID, itemID).Scan(&lifecycle)
		if errors.Is(err, sql.ErrNoRows) {
			return false, false, nil
		}
		if err != nil {
			return false, false, fmt.Errorf("storage incoming ref source memory_record/%s: %w", itemID, err)
		}
		return lifecycle != string(memory.RecordLifecycleRemoved), lifecycle == string(memory.RecordLifecycleActive), nil
	case artifactref.KindKnowledgePage:
		var lifecycle string
		err := tx.QueryRow(`SELECT lifecycle FROM knowledge_page WHERE scope_id = ? AND page_id = ?`, scopeID, itemID).Scan(&lifecycle)
		if errors.Is(err, sql.ErrNoRows) {
			return false, false, nil
		}
		if err != nil {
			return false, false, fmt.Errorf("storage incoming ref source knowledge_page/%s: %w", itemID, err)
		}
		active := lifecycle == string(knowledge.ProjectionLifecycleActive) || lifecycle == string(knowledge.ProjectionLifecycleStale)
		return lifecycle != string(knowledge.ProjectionLifecycleRemoved), active, nil
	case artifactref.KindSkillBundle:
		var status string
		err := tx.QueryRow(`SELECT status FROM skill_bundle WHERE scope_id = ? AND bundle_id = ?`, scopeID, itemID).Scan(&status)
		if errors.Is(err, sql.ErrNoRows) {
			return false, false, nil
		}
		if err != nil {
			return false, false, fmt.Errorf("storage incoming ref source skill_bundle/%s: %w", itemID, err)
		}
		active := status == string(skill.BundleStatusActive) || status == string(skill.BundleStatusDraft)
		return status != string(skill.BundleStatusRemoved), active, nil
	default:
		return false, false, fmt.Errorf("storage incoming ref source kind %s is not admitted", kind)
	}
}

func (b *SQLiteBackend) loadRefs(query string, args ...any) (refs []artifactref.Ref, err error) {
	rows, err := b.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("storage load refs: %w", err)
	}
	defer closeRows(rows, &err, "storage load refs")
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

func (b *SQLiteBackend) insertKnowledgeRelationTx(tx *sql.Tx, rel knowledge.Relation) error {
	fromLive, err := b.isArtifactRefTargetLiveTx(tx, rel.ScopeID, artifactref.KindKnowledgePage, string(rel.FromPageID))
	if err != nil {
		return err
	}
	if !fromLive {
		return fmt.Errorf("storage save knowledge relation: source page %s does not exist or is removed", rel.FromPageID)
	}
	toLive, err := b.isArtifactRefTargetLiveTx(tx, rel.ScopeID, artifactref.KindKnowledgePage, string(rel.ToPageID))
	if err != nil {
		return err
	}
	if !toLive {
		return fmt.Errorf("storage save knowledge relation: target page %s does not exist or is removed", rel.ToPageID)
	}
	raw, err := json.Marshal(rel)
	if err != nil {
		return fmt.Errorf("storage save knowledge relation: marshal: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO knowledge_relation
		(scope_id, from_page_id, to_page_id, relation_type, strength, relation_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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

func (b *SQLiteBackend) deleteKnowledgeRelationsForPageTx(tx *sql.Tx, scopeID string, pageID string) (err error) {
	rows, err := tx.Query(`SELECT from_page_id, to_page_id, relation_type FROM knowledge_relation WHERE scope_id = ? AND (from_page_id = ? OR to_page_id = ?)`, scopeID, pageID, pageID)
	if err != nil {
		return fmt.Errorf("storage delete knowledge relations for page: %w", err)
	}
	defer closeRows(rows, &err, "storage delete knowledge relations for page")
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

func (b *SQLiteBackend) loadKnowledgeRelations(query string, args ...any) (relations []knowledge.Relation, err error) {
	rows, err := b.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("storage load knowledge relations: %w", err)
	}
	defer closeRows(rows, &err, "storage load knowledge relations")
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
