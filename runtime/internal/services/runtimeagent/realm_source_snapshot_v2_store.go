package runtimeagent

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// realmSourceSnapshotV2Store is the read-only owner for committed SnapshotV2
// hydration. It never repairs, rebases, or synthesizes a missing snapshot or
// provenance membership.
type realmSourceSnapshotV2Store struct {
	db *sql.DB
}

func newRealmSourceSnapshotV2Store(db *sql.DB) (*realmSourceSnapshotV2Store, error) {
	if db == nil {
		return nil, fmt.Errorf("Realm source SnapshotV2 database is required")
	}
	return &realmSourceSnapshotV2Store{db: db}, nil
}

const realmSourceSnapshotV2SelectColumns = `
	SELECT snapshot.local_agent_ref, snapshot.snapshot_schema_version,
		snapshot.snapshot_hash, snapshot.captured_at, snapshot.packet_id,
		snapshot.packet_hash, snapshot.realm_issuer,
		snapshot.signing_key_fingerprint, snapshot.source_kind,
		snapshot.source_id, snapshot.world_id, snapshot.source_hash,
		snapshot.world_content_hash, snapshot.coverage_hash,
		snapshot.materialization_context_hash, snapshot.payload_hash,
		snapshot.ordered_component_set_hash,
		snapshot.closure_set_manifest_hash, snapshot.normalization_version,
		snapshot.compiler_compatibility_version,
		snapshot.typed_snapshot_json, provenance.provenance_key,
		provenance.local_agent_ref, provenance.snapshot_hash,
		provenance.materialization_context_hash
	FROM runtime_local_agent_source_snapshot_v2 AS snapshot
	LEFT JOIN runtime_local_agent_source_provenance_v3 AS provenance
		ON provenance.local_agent_ref = snapshot.local_agent_ref`

type realmSourceSnapshotV2RowScanner interface {
	Scan(dest ...any) error
}

func (s *realmSourceSnapshotV2Store) sourceSnapshot(
	ctx context.Context,
	localAgentRef string,
) (localAgentSourceSnapshotV2, bool, error) {
	if s == nil || s.db == nil {
		return localAgentSourceSnapshotV2{}, false, fmt.Errorf("Realm source SnapshotV2 store is unavailable")
	}
	if ctx == nil {
		return localAgentSourceSnapshotV2{}, false, fmt.Errorf("Realm source SnapshotV2 context is required")
	}
	trimmedLocalAgentRef := strings.TrimSpace(localAgentRef)
	if localAgentRef != trimmedLocalAgentRef || trimmedLocalAgentRef == "" || !strings.HasPrefix(trimmedLocalAgentRef, runtimeGeneratedLocalAgentRefPrefix) {
		return localAgentSourceSnapshotV2{}, false, fmt.Errorf("Realm source SnapshotV2 local_agent_ref is invalid")
	}
	localAgentRef = trimmedLocalAgentRef
	row := s.db.QueryRowContext(ctx, realmSourceSnapshotV2SelectColumns+`
		WHERE snapshot.local_agent_ref = ?`, localAgentRef)
	snapshot, found, err := scanRealmSourceSnapshotV2Row(row)
	if err != nil {
		return localAgentSourceSnapshotV2{}, false, fmt.Errorf("load Realm source SnapshotV2 %s: %w", localAgentRef, err)
	}
	return snapshot, found, nil
}

// validatePersistedSnapshots performs the restart hydration gate in one
// read-only transaction. A missing membership, orphan membership, corrupt
// typed payload, or hash/column drift fails the whole gate.
func (s *realmSourceSnapshotV2Store) validatePersistedSnapshots(ctx context.Context) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("Realm source SnapshotV2 store is unavailable")
	}
	if ctx == nil {
		return fmt.Errorf("Realm source SnapshotV2 context is required")
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return fmt.Errorf("begin Realm source SnapshotV2 restart validation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx, realmSourceSnapshotV2SelectColumns+`
		ORDER BY snapshot.local_agent_ref`)
	if err != nil {
		return fmt.Errorf("query Realm source SnapshotV2 restart state: %w", err)
	}
	validated := 0
	for rows.Next() {
		if _, found, scanErr := scanRealmSourceSnapshotV2Row(rows); scanErr != nil {
			_ = rows.Close()
			return fmt.Errorf("validate Realm source SnapshotV2 restart state: %w", scanErr)
		} else if !found {
			_ = rows.Close()
			return fmt.Errorf("Realm source SnapshotV2 disappeared during restart validation")
		}
		validated++
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate Realm source SnapshotV2 restart state: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close Realm source SnapshotV2 restart rows: %w", err)
	}
	var provenanceCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM runtime_local_agent_source_provenance_v3`).Scan(&provenanceCount); err != nil {
		return fmt.Errorf("count Realm source provenance v3: %w", err)
	}
	if provenanceCount != validated {
		return fmt.Errorf("Realm source SnapshotV2/provenance count mismatch: snapshots=%d provenance=%d", validated, provenanceCount)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("complete Realm source SnapshotV2 restart validation: %w", err)
	}
	return nil
}

func scanRealmSourceSnapshotV2Row(
	row realmSourceSnapshotV2RowScanner,
) (localAgentSourceSnapshotV2, bool, error) {
	var (
		rowLocalAgentRef, snapshotHash, capturedAt, packetID, packetHash string
		realmIssuer, signingKeyFingerprint                               string
		sourceKind, sourceID, worldID, sourceHash                        string
		worldContentHash, coverageHash, materializationContextHash       string
		payloadHash, orderedComponentSetHash, closureSetManifestHash     string
		normalizationVersion, compilerCompatibilityVersion               string
		typed                                                            []byte
		schemaVersion                                                    int
		provenanceKey, provenanceLocalAgentRef                           sql.NullString
		provenanceSnapshotHash, provenanceContextHash                    sql.NullString
	)
	err := row.Scan(
		&rowLocalAgentRef, &schemaVersion, &snapshotHash, &capturedAt,
		&packetID, &packetHash, &realmIssuer, &signingKeyFingerprint,
		&sourceKind, &sourceID, &worldID, &sourceHash, &worldContentHash,
		&coverageHash, &materializationContextHash, &payloadHash,
		&orderedComponentSetHash, &closureSetManifestHash,
		&normalizationVersion, &compilerCompatibilityVersion, &typed,
		&provenanceKey, &provenanceLocalAgentRef, &provenanceSnapshotHash,
		&provenanceContextHash,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return localAgentSourceSnapshotV2{}, false, nil
	}
	if err != nil {
		return localAgentSourceSnapshotV2{}, false, fmt.Errorf("scan Realm source SnapshotV2: %w", err)
	}
	snapshot, err := decodeLocalAgentSourceSnapshotV2(typed)
	if err != nil {
		return localAgentSourceSnapshotV2{}, false, fmt.Errorf("decode persisted Realm source SnapshotV2: %w", err)
	}
	if schemaVersion != 2 || rowLocalAgentRef != snapshot.LocalAgentRef ||
		snapshotHash != snapshot.SnapshotHash || capturedAt != snapshot.CapturedAt ||
		packetID != snapshot.PacketID || packetHash != snapshot.PacketHash ||
		realmIssuer != snapshot.RealmIssuer || signingKeyFingerprint != snapshot.SigningKeyFingerprint ||
		sourceKind != snapshot.Semantic.SourceRef.Kind || sourceID != snapshot.Semantic.SourceRef.ID ||
		worldID != snapshot.Semantic.SourceRef.WorldID || sourceHash != snapshot.Semantic.SourceHash ||
		worldContentHash != snapshot.Semantic.WorldContentHash || coverageHash != snapshot.Semantic.CoverageHash ||
		materializationContextHash != snapshot.Semantic.MaterializationContextHash ||
		payloadHash != snapshot.Semantic.PayloadHash ||
		orderedComponentSetHash != snapshot.Semantic.OrderedComponentSetHash ||
		closureSetManifestHash != snapshot.Semantic.ClosureSetManifestHash ||
		normalizationVersion != snapshot.NormalizationVersion ||
		compilerCompatibilityVersion != snapshot.CompilerCompatibilityVersion {
		return localAgentSourceSnapshotV2{}, false, fmt.Errorf("Realm source SnapshotV2 column binding mismatch")
	}
	if !provenanceKey.Valid || !provenanceLocalAgentRef.Valid ||
		!provenanceSnapshotHash.Valid || !provenanceContextHash.Valid {
		return localAgentSourceSnapshotV2{}, false, fmt.Errorf("Realm source SnapshotV2 has no provenance v3 membership")
	}
	expectedProvenanceKey, err := localAgentRealmSourceProvenanceKeyV3(snapshot)
	if err != nil {
		return localAgentSourceSnapshotV2{}, false, fmt.Errorf("derive Realm source provenance v3 key: %w", err)
	}
	if provenanceKey.String != expectedProvenanceKey ||
		provenanceLocalAgentRef.String != snapshot.LocalAgentRef ||
		provenanceSnapshotHash.String != snapshot.SnapshotHash ||
		provenanceContextHash.String != snapshot.Semantic.MaterializationContextHash {
		return localAgentSourceSnapshotV2{}, false, fmt.Errorf("Realm source provenance v3 binding mismatch")
	}
	return snapshot, true, nil
}
