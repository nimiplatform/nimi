package storage

import (
	"encoding/json"
	"errors"
	"fmt"
)

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r014
func (b *SQLiteBackend) ReadRuntimeSourceReferences(scopeID, snapshotIdentity, partitionIdentity string, refs []RuntimeSourceRef) ([]RuntimeSourceUnit, RuntimeSourceState, error) {
	state, err := b.GetRuntimeSourceState(scopeID)
	if err != nil {
		return nil, RuntimeSourceState{}, err
	}
	if state.SnapshotIdentity != snapshotIdentity || state.PartitionIdentity != partitionIdentity {
		return nil, state, ErrRuntimeSourceSnapshotMismatch
	}
	if state.Generation == 0 || !storedRuntimeSourceSHA256(state.SnapshotIdentity) || !storedRuntimeSourceSHA256(state.PartitionIdentity) {
		return nil, state, errors.New("storage: runtime source text binding is corrupt")
	}
	if err := b.validateStoredRuntimeSourceUnits(scopeID, state, false); err != nil {
		return nil, state, err
	}
	if err := b.validateStoredRuntimeSourceOmissions(scopeID, state.OmissionCount); err != nil {
		return nil, state, err
	}
	selectedRefs := make(map[RuntimeSourceRef]struct{}, len(refs))
	for _, ref := range refs {
		selectedRefs[ref] = struct{}{}
	}
	rows, err := b.db.Query(`SELECT unit_id,category,source_path,source_kind,source_world_id,source_ref_id,source_schema_version,source_content_hash,text,provenance_refs_json,priority FROM runtime_source_unit WHERE scope_id=?`, scopeID)
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
		if _, selected := selectedRefs[unit.SourceRef]; selected {
			units = append(units, unit)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, state, fmt.Errorf("storage: read runtime source text: %w", err)
	}
	return units, state, nil
}
