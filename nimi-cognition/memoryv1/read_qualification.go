package memoryv1

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

// QualifyMemoryRefs rechecks bounded consumed references without returning
// content, creating Recall work or inspecting derived indexes.
func (c *Core) QualifyMemoryRefs(ctx context.Context, bindingRef, bankRef, lifecycleRef string, refs []string) (map[string]bool, error) {
	if !validOpaqueRef(bindingRef) || !validOpaqueRef(bankRef) || !validOpaqueRef(lifecycleRef) || len(refs) > 8192 {
		return nil, contractError(OutcomeInvalid, "memory_read_set")
	}
	for _, ref := range refs {
		if !validOpaqueRef(ref) {
			return nil, contractError(OutcomeInvalid, "memory_read_ref")
		}
	}
	tx, err := c.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := validateRecallSnapshotTx(ctx, tx, RecallRequest{BindingRef: bindingRef, BankRef: bankRef, LifecycleRef: lifecycleRef}); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(refs)
	if err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT memory_ref FROM memories WHERE bank_ref=? AND lifecycle=? AND memory_ref IN (SELECT value FROM json_each(?))`, bankRef, LifecycleCurrent, string(raw))
	if err != nil {
		return nil, fmt.Errorf("qualify memory reads: %w", err)
	}
	result := map[string]bool{}
	for rows.Next() {
		var ref string
		if err := rows.Scan(&ref); err != nil {
			_ = rows.Close()
			return nil, err
		}
		result[ref] = true
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}
