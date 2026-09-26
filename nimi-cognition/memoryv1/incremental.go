package memoryv1

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// @nimi-authority: rule.nimi.cognition.memory.r004
// A ready generation may remain as a reuse source after a canonical change;
// Recall still requires exact canonical_version and lifecycle compatibility.
func (c *Core) prepareEmbeddingDelta(ctx context.Context, operationID, bankRef string, snapshot CapabilitySnapshot) (version uint64, lifecycle, state string, refs, texts []string, err error) {
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return
	}
	defer func() { _ = tx.Rollback() }()
	if err = tx.QueryRowContext(ctx, `SELECT canonical_version,lifecycle_ref FROM memory_banks WHERE bank_ref=? AND state='active'`, bankRef).Scan(&version, &lifecycle); err != nil {
		return
	}
	var storedVersion, revision uint64
	var storedLifecycle, space string
	err = tx.QueryRowContext(ctx, `SELECT canonical_version,lifecycle_ref,config_revision,embedding_space_ref,status FROM memory_derived_generations WHERE bank_ref=? AND kind='embedding' AND generation_ref=?`, bankRef, operationID).Scan(&storedVersion, &storedLifecycle, &revision, &space, &state)
	if errors.Is(err, sql.ErrNoRows) {
		state = "building"
		_, err = tx.ExecContext(ctx, `INSERT INTO memory_derived_generations(bank_ref,kind,generation_ref,canonical_version,lifecycle_ref,config_revision,embedding_space_ref,status,updated_at) VALUES(?,'embedding',?,?,?,?,?,'building',?)`, bankRef, operationID, version, lifecycle, snapshot.ConfigRevision, snapshot.EmbeddingSpaceRef, formatTime(c.now()))
		if err != nil {
			return
		}
		// Materialize the reusable subset once. Retry reads this same subset even
		// if a competing build subsequently retires the source generation.
		_, err = tx.ExecContext(ctx, `INSERT INTO memory_vector_items(generation_ref,memory_ref,dimension,vector_json)
			SELECT ?,v.memory_ref,v.dimension,v.vector_json FROM memory_vector_items v JOIN memories m ON m.memory_ref=v.memory_ref
			WHERE m.bank_ref=? AND m.lifecycle=? AND v.generation_ref=(SELECT generation_ref FROM memory_derived_generations WHERE bank_ref=? AND kind='embedding' AND lifecycle_ref=? AND embedding_space_ref=? AND status='ready' AND canonical_version<=? ORDER BY canonical_version DESC,updated_at DESC,generation_ref LIMIT 1)`, operationID, bankRef, LifecycleCurrent, bankRef, lifecycle, snapshot.EmbeddingSpaceRef, version)
		if err != nil {
			return
		}
	} else if err != nil {
		return
	} else if storedVersion != version || storedLifecycle != lifecycle || revision != snapshot.ConfigRevision || space != snapshot.EmbeddingSpaceRef {
		err = contractError(OutcomeConflict, "embedding_generation_stale")
		return
	}
	if state == "building" {
		var rows *sql.Rows
		rows, err = tx.QueryContext(ctx, `SELECT m.memory_ref,m.content FROM memories m LEFT JOIN memory_vector_items v ON v.memory_ref=m.memory_ref AND v.generation_ref=? WHERE m.bank_ref=? AND m.lifecycle=? AND v.memory_ref IS NULL ORDER BY m.memory_ref`, operationID, bankRef, LifecycleCurrent)
		if err != nil {
			return
		}
		for rows.Next() {
			var ref, content string
			if err = rows.Scan(&ref, &content); err != nil {
				_ = rows.Close()
				return
			}
			refs, texts = append(refs, ref), append(texts, content)
		}
		err = errors.Join(rows.Err(), rows.Close())
		if err != nil {
			return
		}
	}
	err = tx.Commit()
	return
}

// @nimi-authority: rule.nimi.cognition.memory.r003
// Derived failure must not roll back an otherwise valid canonical decision.
// The caller invalidates FTS first; an unsuccessful delta leaves it unavailable
// for the existing post-commit rebuild/recovery path.
func (c *Core) advanceFTSDelta(ctx context.Context, tx *sql.Tx, bankRef string, plan MutationPlan, added []string) error {
	var generation string
	err := tx.QueryRowContext(ctx, `SELECT g.generation_ref FROM memory_derived_generations g JOIN memory_banks b ON b.bank_ref=g.bank_ref WHERE g.bank_ref=? AND g.kind='fts' AND g.status='ready' AND g.canonical_version=b.canonical_version-1 AND g.lifecycle_ref=b.lifecycle_ref LIMIT 1`, bankRef).Scan(&generation)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE memory_derived_generations SET status='building' WHERE bank_ref=? AND kind='fts'`, bankRef); err != nil {
		return err
	}
	if generation == "" {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `SAVEPOINT fts_delta`); err != nil {
		return err
	}
	apply := func() error {
		for _, mutation := range plan.Mutations {
			if mutation.TargetMemoryRef != "" {
				if _, err := tx.ExecContext(ctx, `DELETE FROM memory_fts WHERE bank_ref=? AND memory_ref=?`, bankRef, mutation.TargetMemoryRef); err != nil {
					return err
				}
			}
		}
		for _, ref := range added {
			var content string
			err := tx.QueryRowContext(ctx, `SELECT content FROM memories WHERE bank_ref=? AND memory_ref=? AND lifecycle=?`, bankRef, ref, LifecycleCurrent).Scan(&content)
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO memory_fts(memory_ref,bank_ref,content) VALUES(?,?,?)`, ref, bankRef, ftsIndexedContent(content)); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(ctx, `UPDATE memory_derived_generations SET status='ready',canonical_version=(SELECT canonical_version FROM memory_banks WHERE bank_ref=?),updated_at=? WHERE bank_ref=? AND kind='fts' AND generation_ref=?`, bankRef, formatTime(c.now()), bankRef, generation)
		return err
	}
	if err := apply(); err != nil {
		if _, rollbackErr := tx.ExecContext(ctx, `ROLLBACK TO fts_delta`); rollbackErr != nil {
			return fmt.Errorf("rollback derived delta: %w", errors.Join(err, rollbackErr))
		}
	}
	_, err = tx.ExecContext(ctx, `RELEASE fts_delta`)
	return err
}

func (c *Core) ensureFTSCurrent(ctx context.Context, bankRef string) error {
	var ready int
	if err := c.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM memory_derived_generations g JOIN memory_banks b ON b.bank_ref=g.bank_ref WHERE g.bank_ref=? AND g.kind='fts' AND g.status='ready' AND g.canonical_version=b.canonical_version AND g.lifecycle_ref=b.lifecycle_ref`, bankRef).Scan(&ready); err != nil {
		return err
	}
	if ready > 0 {
		return nil
	}
	return c.RebuildFTS(ctx, bankRef)
}

// The V1 Remember plan uses only identity, lifecycle and text. Provenance is
// validated by Core at commit; it is not loaded per row for this lexical plan.
func (c *Core) rememberInputs(ctx context.Context, bankRef string) ([]Memory, error) {
	rows, err := c.db.QueryContext(ctx, `SELECT memory_ref,content,lifecycle FROM memories WHERE bank_ref=? AND lifecycle=? ORDER BY updated_at DESC,memory_ref`, bankRef, LifecycleCurrent)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var items []Memory
	for rows.Next() {
		var item Memory
		if err := rows.Scan(&item.MemoryRef, &item.Content, &item.Lifecycle); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
