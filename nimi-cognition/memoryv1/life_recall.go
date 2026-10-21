package memoryv1

import (
	"context"
	"database/sql"
	"fmt"
)

// @nimi-authority: rule.nimi.cognition.memory.simulated-life-activity
func (c *Core) includeRecentLife(ctx context.Context, request RecallRequest, result RecallResult) (RecallResult, error) {
	tx, err := c.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	if err := validateRecallSnapshotTx(ctx, tx, request); err != nil {
		return result, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT m.memory_ref,m.bank_ref,m.content,m.epistemic_status,m.lifecycle,m.occurred_at,m.updated_at,m.source_explanation,m.event_ref FROM memories m WHERE m.bank_ref=? AND m.lifecycle=? AND EXISTS (SELECT 1 FROM memory_lineage l WHERE l.memory_ref=m.memory_ref AND l.ref_type='source' AND l.ref_kind='life_change') ORDER BY m.occurred_at DESC,m.memory_ref LIMIT ?`, request.BankRef, LifecycleCurrent, min(2, max(1, request.Limit/2)))
	if err != nil {
		return result, fmt.Errorf("recall recent life: %w", err)
	}
	recent, err := scanMemories(rows)
	if err != nil {
		return result, err
	}
	if err := populateLineageTx(ctx, tx, recent); err != nil {
		return result, err
	}
	refs := make([]string, 0, len(result.Hits))
	for _, hit := range result.Hits {
		refs = append(refs, hit.MemoryRef)
	}
	qualified, err := qualifyMemoryRefsTx(ctx, tx, request.BankRef, refs)
	if err != nil {
		return result, err
	}
	current := make([]Memory, 0, len(result.Hits))
	for _, hit := range result.Hits {
		if qualified[hit.MemoryRef] {
			current = append(current, hit)
		}
	}
	if err := tx.Commit(); err != nil {
		return result, err
	}
	seen := map[string]bool{}
	hits := make([]Memory, 0, request.Limit)
	for _, m := range append(recent, current...) {
		if !seen[m.MemoryRef] && len(hits) < request.Limit {
			seen[m.MemoryRef] = true
			hits = append(hits, m)
		}
	}
	result.Hits = hits
	if len(hits) > 0 {
		result.Outcome = OutcomeReady
	} else {
		result.Outcome = OutcomeNoHits
	}
	return result, nil
}
