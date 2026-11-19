package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r014
func (b *SQLiteBackend) ReadRuntimeSourceReferences(ctx context.Context, scopeID, snapshotIdentity, partitionIdentity string, refs []RuntimeSourceRef) ([]RuntimeSourceUnit, RuntimeSourceState, error) {
	tx, err := b.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, RuntimeSourceState{}, err
	}
	defer func() { _ = tx.Rollback() }()
	state, err := readRuntimeSourceState(ctx, tx, scopeID)
	if err != nil {
		return nil, RuntimeSourceState{}, err
	}
	if state.SnapshotIdentity != snapshotIdentity || state.PartitionIdentity != partitionIdentity {
		return nil, state, ErrRuntimeSourceSnapshotMismatch
	}
	if state.Generation == 0 || !storedRuntimeSourceSHA256(state.SnapshotIdentity) || !storedRuntimeSourceSHA256(state.PartitionIdentity) {
		return nil, state, errors.New("storage: runtime source text binding is corrupt")
	}
	if err := validateStoredRuntimeSourceOmissions(ctx, tx, scopeID, state.OmissionCount); err != nil {
		return nil, state, err
	}
	if len(refs) == 0 {
		return nil, state, nil
	}
	// Explicit references are bounded by the bridge. Match the complete source
	// tuple and keep the selected bodies, coverage and generation in this tx.
	var args []any
	for _, ref := range refs {
		args = append(args, ref.Kind, ref.WorldID, ref.RefID, ref.SchemaVersion, ref.ContentHash)
	}
	args = append(args, scopeID)
	values := strings.TrimSuffix(strings.Repeat("(?,?,?,?,?),", len(refs)), ",")
	rows, err := tx.QueryContext(ctx, `WITH wanted(kind,world,id,schema_version,hash) AS (VALUES `+values+`)
		SELECT u.unit_id,u.category,u.source_path,u.source_kind,u.source_world_id,u.source_ref_id,u.source_schema_version,u.source_content_hash,u.text,u.provenance_refs_json,u.priority
		FROM wanted JOIN runtime_source_unit u ON u.scope_id=? AND u.source_ref_id=wanted.id AND u.source_kind=wanted.kind AND
		u.source_world_id=wanted.world AND u.source_schema_version=wanted.schema_version AND u.source_content_hash=wanted.hash`, args...)
	if err != nil {
		return nil, state, fmt.Errorf("storage: read runtime source references: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var units []RuntimeSourceUnit
	for rows.Next() {
		var unit RuntimeSourceUnit
		var rawProvenance []byte
		if err := rows.Scan(&unit.UnitID, &unit.Category, &unit.SourcePath, &unit.SourceRef.Kind, &unit.SourceRef.WorldID, &unit.SourceRef.RefID, &unit.SourceRef.SchemaVersion, &unit.SourceRef.ContentHash, &unit.Text, &rawProvenance, &unit.Priority); err != nil {
			return nil, state, fmt.Errorf("storage: scan runtime source text: %w", err)
		}
		if err := json.Unmarshal(rawProvenance, &unit.ProvenanceRefs); err != nil || !validStoredRuntimeSourceUnit(unit) {
			return nil, state, errors.New("storage: runtime source text is corrupt")
		}
		units = append(units, unit)
	}
	if err := rows.Err(); err != nil {
		return nil, state, fmt.Errorf("storage: read runtime source text: %w", err)
	}
	return units, state, nil
}
