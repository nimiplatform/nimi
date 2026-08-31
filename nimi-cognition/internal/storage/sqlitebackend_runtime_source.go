package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/nimiplatform/nimi/nimi-cognition/internal/embedding"
)

var ErrRuntimeSourceScopeNotFound = errors.New("runtime source scope not found")
var ErrRuntimeSourceSnapshotMismatch = errors.New("runtime source snapshot mismatch")
var ErrRuntimeSourceEmbeddingMismatch = errors.New("runtime source embedding mismatch")

const runtimeSourceStoredSemanticTextMaxBytes = 8 * 1024

type RuntimeSourceRef struct {
	Kind          string
	WorldID       string
	RefID         string
	SchemaVersion string
	ContentHash   string
}

type RuntimeSourceUnit struct {
	UnitID         string
	Category       string
	SourcePath     string
	SourceRef      RuntimeSourceRef
	Text           string
	ProvenanceRefs []string
	Priority       int64
	Embedding      []float64
	Score          float64
}

type RuntimeSourceOmission struct {
	UnitID         string
	Category       string
	SourcePath     string
	SourceRef      RuntimeSourceRef
	OmissionReason string
	ProvenanceRefs []string
}

type RuntimeSourceState struct {
	ScopeID            string
	SnapshotIdentity   string
	PartitionIdentity  string
	Status             string
	Generation         uint64
	EmbeddingIdentity  string
	EmbeddingDimension int
	UnitCount          int
	OmissionCount      int
}

func (b *SQLiteBackend) ReplaceRuntimeSourceCorpus(
	scopeID string,
	snapshotIdentity string,
	partitionIdentity string,
	units []RuntimeSourceUnit,
	omissions []RuntimeSourceOmission,
	status string,
	embeddingIdentity string,
	embeddingDimension int,
	expectedGeneration uint64,
	now time.Time,
) (RuntimeSourceState, error) {
	if b == nil || b.db == nil {
		return RuntimeSourceState{}, errors.New("storage: backend unavailable")
	}
	tx, err := b.db.Begin()
	if err != nil {
		return RuntimeSourceState{}, fmt.Errorf("storage: begin runtime source replace: %w", err)
	}
	defer rollback(tx)
	var existingSnapshot, existingPartition, existingStatus string
	var generation uint64
	err = tx.QueryRow(`SELECT snapshot_identity, partition_identity, status, generation FROM runtime_source_scope WHERE scope_id = ?`, scopeID).Scan(&existingSnapshot, &existingPartition, &existingStatus, &generation)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return RuntimeSourceState{}, fmt.Errorf("storage: inspect runtime source scope: %w", err)
	}
	if err == nil && existingSnapshot != snapshotIdentity {
		return RuntimeSourceState{}, ErrRuntimeSourceSnapshotMismatch
	}
	if status == "building" {
		if expectedGeneration != 0 {
			return RuntimeSourceState{}, errors.New("storage: building source generation cannot carry an expected generation")
		}
		generation++
	} else {
		if err != nil || existingPartition != partitionIdentity || existingStatus != "building" || expectedGeneration == 0 || generation != expectedGeneration {
			return RuntimeSourceState{}, errors.New("storage: terminal source generation does not match building generation")
		}
	}
	if _, err := tx.Exec(`INSERT INTO runtime_source_scope(scope_id,snapshot_identity,partition_identity,status,generation,embedding_identity,embedding_dimension,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(scope_id) DO UPDATE SET partition_identity=excluded.partition_identity,status=excluded.status,generation=excluded.generation,embedding_identity=excluded.embedding_identity,embedding_dimension=excluded.embedding_dimension,updated_at=excluded.updated_at`, scopeID, snapshotIdentity, partitionIdentity, status, generation, embeddingIdentity, embeddingDimension, now.UTC().Format(time.RFC3339Nano)); err != nil {
		return RuntimeSourceState{}, fmt.Errorf("storage: upsert runtime source scope: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM runtime_source_unit WHERE scope_id = ?`, scopeID); err != nil {
		return RuntimeSourceState{}, fmt.Errorf("storage: clear runtime source units: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM runtime_source_omission WHERE scope_id = ?`, scopeID); err != nil {
		return RuntimeSourceState{}, fmt.Errorf("storage: clear runtime source omissions: %w", err)
	}
	for _, unit := range units {
		rawProvenanceRefs, err := json.Marshal(unit.ProvenanceRefs)
		if err != nil {
			return RuntimeSourceState{}, fmt.Errorf("storage: marshal runtime source provenance refs: %w", err)
		}
		var rawEmbedding []byte
		if unit.Embedding != nil {
			rawEmbedding, err = json.Marshal(unit.Embedding)
			if err != nil {
				return RuntimeSourceState{}, fmt.Errorf("storage: marshal runtime source embedding: %w", err)
			}
		}
		if _, err := tx.Exec(`INSERT INTO runtime_source_unit(scope_id,unit_id,category,source_path,source_kind,source_world_id,source_ref_id,source_schema_version,source_content_hash,text,provenance_refs_json,priority,embedding_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, scopeID, unit.UnitID, unit.Category, unit.SourcePath, unit.SourceRef.Kind, unit.SourceRef.WorldID, unit.SourceRef.RefID, unit.SourceRef.SchemaVersion, unit.SourceRef.ContentHash, unit.Text, rawProvenanceRefs, unit.Priority, rawEmbedding); err != nil {
			return RuntimeSourceState{}, fmt.Errorf("storage: insert runtime source unit: %w", err)
		}
	}
	for _, omission := range omissions {
		rawProvenanceRefs, err := json.Marshal(omission.ProvenanceRefs)
		if err != nil {
			return RuntimeSourceState{}, fmt.Errorf("storage: marshal runtime source omission provenance refs: %w", err)
		}
		if _, err := tx.Exec(`INSERT INTO runtime_source_omission(scope_id,unit_id,category,source_path,source_kind,source_world_id,source_ref_id,source_schema_version,source_content_hash,omission_reason,provenance_refs_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, scopeID, omission.UnitID, omission.Category, omission.SourcePath, omission.SourceRef.Kind, omission.SourceRef.WorldID, omission.SourceRef.RefID, omission.SourceRef.SchemaVersion, omission.SourceRef.ContentHash, omission.OmissionReason, rawProvenanceRefs); err != nil {
			return RuntimeSourceState{}, fmt.Errorf("storage: insert runtime source omission: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return RuntimeSourceState{}, fmt.Errorf("storage: commit runtime source replace: %w", err)
	}
	return RuntimeSourceState{ScopeID: scopeID, SnapshotIdentity: snapshotIdentity, PartitionIdentity: partitionIdentity, Status: status, Generation: generation, EmbeddingIdentity: embeddingIdentity, EmbeddingDimension: embeddingDimension, UnitCount: len(units), OmissionCount: len(omissions)}, nil
}

func (b *SQLiteBackend) GetRuntimeSourceState(scopeID string) (RuntimeSourceState, error) {
	var state RuntimeSourceState
	err := b.db.QueryRow(`SELECT scope_id,snapshot_identity,partition_identity,status,generation,embedding_identity,embedding_dimension,(SELECT COUNT(*) FROM runtime_source_unit u WHERE u.scope_id=s.scope_id),(SELECT COUNT(*) FROM runtime_source_omission o WHERE o.scope_id=s.scope_id) FROM runtime_source_scope s WHERE scope_id=?`, scopeID).Scan(&state.ScopeID, &state.SnapshotIdentity, &state.PartitionIdentity, &state.Status, &state.Generation, &state.EmbeddingIdentity, &state.EmbeddingDimension, &state.UnitCount, &state.OmissionCount)
	if errors.Is(err, sql.ErrNoRows) {
		return RuntimeSourceState{}, ErrRuntimeSourceScopeNotFound
	}
	if err != nil {
		return RuntimeSourceState{}, fmt.Errorf("storage: get runtime source state: %w", err)
	}
	return state, nil
}

func (b *SQLiteBackend) InspectRuntimeSourceState(scopeID string) (RuntimeSourceState, error) {
	state, err := b.GetRuntimeSourceState(scopeID)
	if err != nil {
		return RuntimeSourceState{}, err
	}
	if state.Generation == 0 {
		return RuntimeSourceState{}, errors.New("storage: runtime source generation is corrupt")
	}
	if err := b.validateStoredRuntimeSourceUnits(scopeID, state); err != nil {
		return RuntimeSourceState{}, err
	}
	if err := b.validateStoredRuntimeSourceOmissions(scopeID, state.OmissionCount); err != nil {
		return RuntimeSourceState{}, err
	}
	return state, nil
}

func (b *SQLiteBackend) validateStoredRuntimeSourceUnits(scopeID string, state RuntimeSourceState) error {
	rows, err := b.db.Query(`SELECT unit_id,category,source_path,source_kind,source_world_id,source_ref_id,source_schema_version,source_content_hash,text,provenance_refs_json,priority,embedding_json FROM runtime_source_unit WHERE scope_id=?`, scopeID)
	if err != nil {
		return fmt.Errorf("storage: inspect runtime source units: %w", err)
	}
	defer func() { _ = rows.Close() }()
	count := 0
	for rows.Next() {
		var unit RuntimeSourceUnit
		var rawProvenanceRefs, rawEmbedding []byte
		if err := rows.Scan(&unit.UnitID, &unit.Category, &unit.SourcePath, &unit.SourceRef.Kind, &unit.SourceRef.WorldID, &unit.SourceRef.RefID, &unit.SourceRef.SchemaVersion, &unit.SourceRef.ContentHash, &unit.Text, &rawProvenanceRefs, &unit.Priority, &rawEmbedding); err != nil {
			return fmt.Errorf("storage: scan runtime source unit: %w", err)
		}
		if err := json.Unmarshal(rawProvenanceRefs, &unit.ProvenanceRefs); err != nil || unit.ProvenanceRefs == nil || !validStoredRuntimeSourceUnit(unit) {
			return errors.New("storage: runtime source unit is corrupt")
		}
		if state.Status == "ready" {
			if err := json.Unmarshal(rawEmbedding, &unit.Embedding); err != nil || len(unit.Embedding) != state.EmbeddingDimension || !finiteRuntimeSourceVector(unit.Embedding) {
				return errors.New("storage: runtime source embedding is missing or corrupt")
			}
		} else if len(rawEmbedding) != 0 {
			return errors.New("storage: non-ready runtime source unit carries an embedding")
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("storage: inspect runtime source units: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("storage: close runtime source units: %w", err)
	}
	if count != state.UnitCount {
		return errors.New("storage: runtime source unit count changed during inspection")
	}
	return nil
}

func (b *SQLiteBackend) SearchRuntimeSource(scopeID, snapshotIdentity, embeddingIdentity, query string, queryEmbedding []float64, limit int) ([]RuntimeSourceUnit, RuntimeSourceState, error) {
	state, err := b.InspectRuntimeSourceState(scopeID)
	if err != nil {
		return nil, RuntimeSourceState{}, err
	}
	if state.SnapshotIdentity != snapshotIdentity {
		return nil, state, ErrRuntimeSourceSnapshotMismatch
	}
	if state.Status != "ready" {
		return nil, state, nil
	}
	if state.EmbeddingIdentity == "" || state.EmbeddingIdentity != embeddingIdentity || state.EmbeddingDimension <= 0 || len(queryEmbedding) != state.EmbeddingDimension || !finiteRuntimeSourceVector(queryEmbedding) {
		return nil, state, ErrRuntimeSourceEmbeddingMismatch
	}
	if limit <= 0 {
		limit = 8
	}
	rows, err := b.db.Query(`SELECT unit_id,category,source_path,source_kind,source_world_id,source_ref_id,source_schema_version,source_content_hash,text,provenance_refs_json,priority,embedding_json FROM runtime_source_unit WHERE scope_id=?`, scopeID)
	if err != nil {
		return nil, state, fmt.Errorf("storage: search runtime source: %w", err)
	}
	defer func() { _ = rows.Close() }()
	units := make([]RuntimeSourceUnit, 0, state.UnitCount)
	for rows.Next() {
		var unit RuntimeSourceUnit
		var rawProvenanceRefs, rawEmbedding []byte
		if err := rows.Scan(&unit.UnitID, &unit.Category, &unit.SourcePath, &unit.SourceRef.Kind, &unit.SourceRef.WorldID, &unit.SourceRef.RefID, &unit.SourceRef.SchemaVersion, &unit.SourceRef.ContentHash, &unit.Text, &rawProvenanceRefs, &unit.Priority, &rawEmbedding); err != nil {
			return nil, state, err
		}
		if err := json.Unmarshal(rawProvenanceRefs, &unit.ProvenanceRefs); err != nil || unit.ProvenanceRefs == nil {
			return nil, state, errors.New("storage: runtime source provenance refs are missing or corrupt")
		}
		if !validStoredRuntimeSourceUnit(unit) {
			return nil, state, errors.New("storage: runtime source unit is corrupt")
		}
		if err := json.Unmarshal(rawEmbedding, &unit.Embedding); err != nil || len(unit.Embedding) != state.EmbeddingDimension || !finiteRuntimeSourceVector(unit.Embedding) {
			return nil, state, errors.New("storage: runtime source embedding is missing or corrupt")
		}
		unit.Score = embedding.CosineSimilarity(queryEmbedding, unit.Embedding)
		if math.IsNaN(unit.Score) || math.IsInf(unit.Score, 0) {
			return nil, state, errors.New("storage: runtime source score is corrupt")
		}
		// Embedding relevance is the product-hit floor. Lexical and source
		// priority may only boost or reorder a semantically positive candidate;
		// they can never manufacture a hit from an orthogonal/negative vector.
		if unit.Score <= 0 {
			continue
		}
		lexicalMatch := strings.Contains(strings.ToLower(unit.Text), strings.ToLower(strings.TrimSpace(query)))
		if lexicalMatch {
			unit.Score += 0.15
		}
		if unit.Priority > 0 {
			unit.Score += math.Min(float64(unit.Priority)/20000.0, 0.05)
		}
		units = append(units, unit)
	}
	if err := rows.Err(); err != nil {
		return nil, state, err
	}
	if err := rows.Close(); err != nil {
		return nil, state, fmt.Errorf("storage: close runtime source search: %w", err)
	}
	sort.SliceStable(units, func(i, j int) bool {
		if units[i].Score != units[j].Score {
			return units[i].Score > units[j].Score
		}
		if units[i].Priority != units[j].Priority {
			return units[i].Priority > units[j].Priority
		}
		return units[i].UnitID < units[j].UnitID
	})
	if len(units) > limit {
		units = units[:limit]
	}
	return units, state, nil
}

func validStoredRuntimeSourceUnit(unit RuntimeSourceUnit) bool {
	if strings.TrimSpace(unit.UnitID) == "" || strings.TrimSpace(unit.UnitID) != unit.UnitID ||
		!storedRuntimeSourceCategory(unit.Category) || strings.TrimSpace(unit.SourcePath) == "" || strings.TrimSpace(unit.SourcePath) != unit.SourcePath ||
		strings.TrimSpace(unit.SourceRef.Kind) == "" || strings.TrimSpace(unit.SourceRef.Kind) != unit.SourceRef.Kind ||
		strings.TrimSpace(unit.SourceRef.WorldID) == "" || strings.TrimSpace(unit.SourceRef.WorldID) != unit.SourceRef.WorldID ||
		strings.TrimSpace(unit.SourceRef.RefID) == "" || strings.TrimSpace(unit.SourceRef.RefID) != unit.SourceRef.RefID ||
		strings.TrimSpace(unit.SourceRef.SchemaVersion) == "" || strings.TrimSpace(unit.SourceRef.SchemaVersion) != unit.SourceRef.SchemaVersion ||
		!storedRuntimeSourceSHA256(unit.SourceRef.ContentHash) || !storedRuntimeSourceCategoryMatchesRefKind(unit.Category, unit.SourceRef.Kind) ||
		strings.TrimSpace(unit.Text) == "" || strings.TrimSpace(unit.Text) != unit.Text || !utf8.ValidString(unit.Text) || len([]byte(unit.Text)) > runtimeSourceStoredSemanticTextMaxBytes ||
		unit.Priority < 0 || !validStoredRuntimeSourceProvenanceRefs(unit.ProvenanceRefs) {
		return false
	}
	return true
}

func (b *SQLiteBackend) validateStoredRuntimeSourceOmissions(scopeID string, expectedCount int) error {
	rows, err := b.db.Query(`SELECT unit_id,category,source_path,source_kind,source_world_id,source_ref_id,source_schema_version,source_content_hash,omission_reason,provenance_refs_json FROM runtime_source_omission WHERE scope_id=?`, scopeID)
	if err != nil {
		return fmt.Errorf("storage: inspect runtime source omissions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	count := 0
	for rows.Next() {
		var omission RuntimeSourceOmission
		var rawProvenanceRefs []byte
		if err := rows.Scan(&omission.UnitID, &omission.Category, &omission.SourcePath, &omission.SourceRef.Kind, &omission.SourceRef.WorldID, &omission.SourceRef.RefID, &omission.SourceRef.SchemaVersion, &omission.SourceRef.ContentHash, &omission.OmissionReason, &rawProvenanceRefs); err != nil {
			return fmt.Errorf("storage: scan runtime source omission: %w", err)
		}
		if err := json.Unmarshal(rawProvenanceRefs, &omission.ProvenanceRefs); err != nil || omission.ProvenanceRefs == nil {
			return errors.New("storage: runtime source omission provenance refs are missing or corrupt")
		}
		if !validStoredRuntimeSourceOmission(omission) {
			return errors.New("storage: runtime source omission is corrupt")
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("storage: inspect runtime source omissions: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("storage: close runtime source omissions: %w", err)
	}
	if count != expectedCount {
		return errors.New("storage: runtime source omission count changed during inspection")
	}
	return nil
}

func validStoredRuntimeSourceOmission(omission RuntimeSourceOmission) bool {
	return strings.TrimSpace(omission.UnitID) != "" && strings.TrimSpace(omission.UnitID) == omission.UnitID &&
		storedRuntimeSourceCategory(omission.Category) && strings.TrimSpace(omission.SourcePath) != "" && strings.TrimSpace(omission.SourcePath) == omission.SourcePath &&
		strings.TrimSpace(omission.SourceRef.Kind) != "" && strings.TrimSpace(omission.SourceRef.Kind) == omission.SourceRef.Kind &&
		strings.TrimSpace(omission.SourceRef.WorldID) != "" && strings.TrimSpace(omission.SourceRef.WorldID) == omission.SourceRef.WorldID &&
		strings.TrimSpace(omission.SourceRef.RefID) != "" && strings.TrimSpace(omission.SourceRef.RefID) == omission.SourceRef.RefID &&
		strings.TrimSpace(omission.SourceRef.SchemaVersion) != "" && strings.TrimSpace(omission.SourceRef.SchemaVersion) == omission.SourceRef.SchemaVersion &&
		storedRuntimeSourceSHA256(omission.SourceRef.ContentHash) && storedRuntimeSourceCategoryMatchesRefKind(omission.Category, omission.SourceRef.Kind) &&
		strings.TrimSpace(omission.OmissionReason) != "" && strings.TrimSpace(omission.OmissionReason) == omission.OmissionReason && utf8.ValidString(omission.OmissionReason) &&
		validStoredRuntimeSourceProvenanceRefs(omission.ProvenanceRefs)
}

func validStoredRuntimeSourceProvenanceRefs(refs []string) bool {
	if refs == nil {
		return false
	}
	seen := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		if strings.TrimSpace(ref) == "" || strings.TrimSpace(ref) != ref || !utf8.ValidString(ref) {
			return false
		}
		if _, duplicate := seen[ref]; duplicate {
			return false
		}
		seen[ref] = struct{}{}
	}
	return true
}

func storedRuntimeSourceSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

func storedRuntimeSourceCategory(category string) bool {
	switch category {
	case "character_identity_detail", "behavior_detail", "speaking_interaction_detail",
		"biography_event", "relationship_detail", "work", "preference",
		"source_knowledge_detail", "source_constraint_detail", "source_asset_detail",
		"dialogue_exemplar", "world_setting_detail", "world_fact", "world_entity",
		"world_system", "world_scene", "source_evidence":
		return true
	default:
		return false
	}
}

func storedRuntimeSourceCategoryMatchesRefKind(category, refKind string) bool {
	switch refKind {
	case "worldCharacter", "personaCharacter":
		switch category {
		case "character_identity_detail", "behavior_detail", "speaking_interaction_detail", "biography_event",
			"relationship_detail", "source_knowledge_detail", "source_constraint_detail", "source_asset_detail", "dialogue_exemplar":
			return true
		}
	case "worldCore":
		switch category {
		case "world_setting_detail", "world_fact", "world_entity", "world_system", "world_scene", "relationship_detail", "source_asset_detail":
			return true
		}
	case "worldEntity":
		switch category {
		case "world_entity", "world_fact", "work", "preference", "source_asset_detail", "source_evidence":
			return true
		}
	case "worldRelationship":
		return category == "relationship_detail" || category == "source_evidence"
	}
	return false
}

func (b *SQLiteBackend) DeleteRuntimeSourceScope(scopeID, snapshotIdentity string) (bool, error) {
	state, err := b.GetRuntimeSourceState(scopeID)
	if errors.Is(err, ErrRuntimeSourceScopeNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if state.SnapshotIdentity != snapshotIdentity {
		return false, ErrRuntimeSourceSnapshotMismatch
	}
	result, err := b.db.Exec(`DELETE FROM runtime_source_scope WHERE scope_id=?`, scopeID)
	if err != nil {
		return false, fmt.Errorf("storage: delete runtime source scope: %w", err)
	}
	count, _ := result.RowsAffected()
	return count > 0, nil
}

func finiteRuntimeSourceVector(vector []float64) bool {
	for _, value := range vector {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return true
}

func (b *SQLiteBackend) validateRuntimeSourceSchema() error {
	checks := []string{
		`SELECT scope_id,snapshot_identity,partition_identity,status,generation,embedding_identity,embedding_dimension,updated_at FROM runtime_source_scope LIMIT 0`,
		`SELECT scope_id,unit_id,category,source_path,source_kind,source_world_id,source_ref_id,source_schema_version,source_content_hash,text,provenance_refs_json,priority,embedding_json FROM runtime_source_unit LIMIT 0`,
		`SELECT scope_id,unit_id,category,source_path,source_kind,source_world_id,source_ref_id,source_schema_version,source_content_hash,omission_reason,provenance_refs_json FROM runtime_source_omission LIMIT 0`,
	}
	for _, query := range checks {
		rows, err := b.db.Query(query)
		if err != nil {
			return fmt.Errorf("storage: unsupported runtime source schema: %w", err)
		}
		_ = rows.Close()
	}
	var scopeDDL string
	if err := b.db.QueryRow(`SELECT sql FROM sqlite_master WHERE type='table' AND name='runtime_source_scope'`).Scan(&scopeDDL); err != nil {
		return fmt.Errorf("storage: inspect runtime source scope schema: %w", err)
	}
	for _, status := range []string{"'unconfigured'", "'building'", "'ready'", "'unavailable'", "'failure'"} {
		if !strings.Contains(scopeDDL, status) {
			return errors.New("storage: unsupported runtime source status schema")
		}
	}
	return nil
}
