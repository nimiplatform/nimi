package runtimeagent

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	localAgentSourceSnapshotSchemaVersionV1 = "nimi.runtime.local-agent-source-snapshot/v1"
	localAgentSourceCompilerCompatibilityV1 = "nimi.runtime.local-agent-source-compiler/v1"
)

// localAgentSourceSnapshotCandidateV1 can only be produced by the strict
// packet-v2 admission boundary. normalizedSourceMaterializationV2 is a closed,
// typed Character|Persona union; it contains no wrapper, nonce, audience,
// detached proof, challenge, TTL, upload, or chunk material.
type localAgentSourceSnapshotCandidateV1 struct {
	Normalized                   normalizedSourceMaterializationV2
	CompilerCompatibilityVersion string
}

type localAgentSourceSnapshotV1 struct {
	SnapshotSchemaVersion        string                                           `json:"snapshotSchemaVersion"`
	SnapshotHash                 string                                           `json:"snapshotHash"`
	LocalAgentRef                string                                           `json:"localAgentRef"`
	CapturedAt                   string                                           `json:"capturedAt"`
	PacketID                     string                                           `json:"packetId"`
	PacketHash                   string                                           `json:"packetHash"`
	Issuer                       string                                           `json:"issuer"`
	KeyFingerprint               string                                           `json:"keyFingerprint"`
	SourceRef                    sourceMaterializationSourceRefV2                 `json:"sourceRef"`
	Character                    *sourceMaterializationWorldCharacterV2           `json:"character,omitempty"`
	Persona                      *sourceMaterializationRealmPersonaV2             `json:"persona,omitempty"`
	OwningWorld                  sourceMaterializationWorldV1                     `json:"owningWorld"`
	CharacterClosure             *sourceMaterializationSnapshotCharacterClosureV1 `json:"characterClosure,omitempty"`
	PersonaClosure               *sourceMaterializationSnapshotPersonaClosureV1   `json:"personaClosure,omitempty"`
	Coverage                     sourceMaterializationCoverageManifestV1          `json:"coverage"`
	ComponentDigests             []sourceMaterializationComponentDigestV1         `json:"componentDigests"`
	CoverageManifestHash         string                                           `json:"coverageManifestHash"`
	MaterializationContextHash   string                                           `json:"materializationContextHash"`
	PayloadHash                  string                                           `json:"payloadHash"`
	NormalizationVersion         string                                           `json:"normalizationVersion"`
	CompilerCompatibilityVersion string                                           `json:"compilerCompatibilityVersion"`
}

func sourceMaterializationCandidateMatchesControl(candidate localAgentSourceSnapshotCandidateV1, control *runtimev1.SourceMaterializationBeginControl, sourceRef *runtimev1.SourceMaterializationSourceRef) bool {
	if control == nil || control.GetPacketEnvelope() == nil || sourceRef == nil {
		return false
	}
	normalized := candidate.Normalized
	kind, err := sourceMaterializationProtoKind(normalized.SourceRef.Kind)
	if err != nil || kind != sourceRef.GetKind() || normalized.SourceRef.WorldID != sourceRef.GetWorldId() || normalized.SourceRef.SourceID != sourceRef.GetSourceId() || normalized.SourceRef.SourceContentHash != sourceRef.GetSourceContentHash() {
		return false
	}
	envelope := control.GetPacketEnvelope()
	return normalized.PacketID == envelope.GetPacketId() && normalized.PacketHash == envelope.GetPacketHash() && normalized.PayloadHash == envelope.GetPayloadHash() && normalized.Issuer == envelope.GetIssuer()
}

func finalizeLocalAgentSourceSnapshotV1(candidate localAgentSourceSnapshotCandidateV1, localAgentRef string, capturedAt time.Time) (localAgentSourceSnapshotV1, error) {
	normalized := candidate.Normalized
	compilerVersion := strings.TrimSpace(candidate.CompilerCompatibilityVersion)
	if compilerVersion == "" {
		compilerVersion = localAgentSourceCompilerCompatibilityV1
	}
	snapshot := localAgentSourceSnapshotV1{
		SnapshotSchemaVersion:        localAgentSourceSnapshotSchemaVersionV1,
		SnapshotHash:                 normalized.SnapshotHash,
		LocalAgentRef:                strings.TrimSpace(localAgentRef),
		CapturedAt:                   formatSourceMaterializationTime(capturedAt),
		PacketID:                     normalized.PacketID,
		PacketHash:                   normalized.PacketHash,
		Issuer:                       normalized.Issuer,
		KeyFingerprint:               normalized.KeyFingerprint,
		SourceRef:                    normalized.SourceRef,
		Character:                    normalized.Character,
		Persona:                      normalized.Persona,
		OwningWorld:                  normalized.OwningWorld,
		CharacterClosure:             normalized.CharacterClosure,
		PersonaClosure:               normalized.PersonaClosure,
		Coverage:                     normalized.Coverage,
		ComponentDigests:             append([]sourceMaterializationComponentDigestV1(nil), normalized.ComponentDigests...),
		CoverageManifestHash:         normalized.CoverageManifestHash,
		MaterializationContextHash:   normalized.MaterializationContextHash,
		PayloadHash:                  normalized.PayloadHash,
		NormalizationVersion:         normalized.NormalizationVersion,
		CompilerCompatibilityVersion: compilerVersion,
	}
	if err := validateLocalAgentSourceSnapshotV1(snapshot); err != nil {
		return localAgentSourceSnapshotV1{}, err
	}
	return snapshot, nil
}

func validateLocalAgentSourceSnapshotV1(snapshot localAgentSourceSnapshotV1) error {
	if snapshot.SnapshotSchemaVersion != localAgentSourceSnapshotSchemaVersionV1 {
		return fmt.Errorf("source snapshot schema version is not admitted")
	}
	if !validSHA256Hex(snapshot.SnapshotHash) || !validSHA256Hex(snapshot.PacketHash) || !validSHA256Hex(snapshot.KeyFingerprint) || !validSHA256Hex(snapshot.CoverageManifestHash) || !validSHA256Hex(snapshot.MaterializationContextHash) || !validSHA256Hex(snapshot.PayloadHash) {
		return fmt.Errorf("source snapshot contains an invalid digest")
	}
	if strings.TrimSpace(snapshot.LocalAgentRef) == "" || !strings.HasPrefix(snapshot.LocalAgentRef, runtimeGeneratedLocalAgentRefPrefix) || strings.TrimSpace(snapshot.PacketID) == "" || strings.TrimSpace(snapshot.Issuer) == "" || strings.TrimSpace(snapshot.NormalizationVersion) == "" || strings.TrimSpace(snapshot.CompilerCompatibilityVersion) == "" {
		return fmt.Errorf("source snapshot identity or compatibility fields are invalid")
	}
	capturedAt, err := time.Parse(time.RFC3339Nano, snapshot.CapturedAt)
	if err != nil || capturedAt.Location() != time.UTC {
		return fmt.Errorf("source snapshot captured_at is invalid")
	}
	if (snapshot.Character == nil) == (snapshot.Persona == nil) || (snapshot.CharacterClosure == nil) == (snapshot.PersonaClosure == nil) {
		return fmt.Errorf("source snapshot requires exactly one source and closure variant")
	}
	if snapshot.SourceRef.WorldID == "" || snapshot.SourceRef.SourceID == "" || !validSHA256Hex(snapshot.SourceRef.SourceContentHash) || snapshot.OwningWorld.ID != snapshot.SourceRef.WorldID || !validSHA256Hex(snapshot.OwningWorld.ContentHash) {
		return fmt.Errorf("source snapshot source/world binding is invalid")
	}
	if snapshot.Character != nil {
		if snapshot.SourceRef.Kind != "worldCharacter" || snapshot.CharacterClosure == nil || snapshot.PersonaClosure != nil || snapshot.Character.ID != snapshot.SourceRef.SourceID || snapshot.Character.WorldID != snapshot.SourceRef.WorldID || snapshot.Character.ContentHash != snapshot.SourceRef.SourceContentHash {
			return fmt.Errorf("source snapshot Character binding is invalid")
		}
	} else if snapshot.SourceRef.Kind != "realmPersona" || snapshot.PersonaClosure == nil || snapshot.CharacterClosure != nil || snapshot.Persona.ID != snapshot.SourceRef.SourceID || snapshot.Persona.HomeWorldID != snapshot.SourceRef.WorldID || snapshot.Persona.ContentHash != snapshot.SourceRef.SourceContentHash {
		return fmt.Errorf("source snapshot Persona binding is invalid")
	}
	if snapshot.Coverage.CoverageManifestHash != snapshot.CoverageManifestHash || snapshot.Coverage.AggregateStatus != "complete" || len(snapshot.ComponentDigests) == 0 {
		return fmt.Errorf("source snapshot coverage is incomplete")
	}
	seenComponents := make(map[string]struct{}, len(snapshot.ComponentDigests))
	for _, component := range snapshot.ComponentDigests {
		if strings.TrimSpace(component.ComponentID) == "" || strings.TrimSpace(component.Kind) == "" || !validSHA256Hex(component.ContentHash) {
			return fmt.Errorf("source snapshot component digest is invalid")
		}
		if _, duplicate := seenComponents[component.ComponentID]; duplicate {
			return fmt.Errorf("source snapshot contains duplicate component digest")
		}
		seenComponents[component.ComponentID] = struct{}{}
	}
	hashInput := localAgentSourceSnapshotHashInput(snapshot)
	computed, err := hashSourceMaterializationDomainJCS(sourceMaterializationSnapshotHashDomain, hashInput)
	if err != nil {
		return fmt.Errorf("compute source snapshot hash: %w", err)
	}
	if computed != snapshot.SnapshotHash {
		return fmt.Errorf("source snapshot hash mismatch")
	}
	if err := validateNormalizedSourceMaterializationV2(normalizedSourceMaterializationFromSnapshot(snapshot)); err != nil {
		return fmt.Errorf("validate typed source snapshot: %w", err)
	}
	return nil
}

func normalizedSourceMaterializationFromSnapshot(snapshot localAgentSourceSnapshotV1) normalizedSourceMaterializationV2 {
	return normalizedSourceMaterializationV2{
		SourceRef:                  snapshot.SourceRef,
		Character:                  snapshot.Character,
		Persona:                    snapshot.Persona,
		OwningWorld:                snapshot.OwningWorld,
		CharacterClosure:           snapshot.CharacterClosure,
		PersonaClosure:             snapshot.PersonaClosure,
		Coverage:                   snapshot.Coverage,
		ComponentDigests:           append([]sourceMaterializationComponentDigestV1(nil), snapshot.ComponentDigests...),
		CoverageManifestHash:       snapshot.CoverageManifestHash,
		MaterializationContextHash: snapshot.MaterializationContextHash,
		PayloadHash:                snapshot.PayloadHash,
		PacketID:                   snapshot.PacketID,
		PacketHash:                 snapshot.PacketHash,
		Issuer:                     snapshot.Issuer,
		KeyFingerprint:             snapshot.KeyFingerprint,
		NormalizationVersion:       snapshot.NormalizationVersion,
		SnapshotHashInput:          localAgentSourceSnapshotHashInput(snapshot),
		SnapshotHash:               snapshot.SnapshotHash,
	}
}

func localAgentSourceSnapshotHashInput(snapshot localAgentSourceSnapshotV1) sourceMaterializationSnapshotHashInputV1 {
	return sourceMaterializationSnapshotHashInputV1{
		SnapshotSchemaVersion: snapshot.SnapshotSchemaVersion,
		Source: sourceMaterializationSourceUnionV2{
			Character: snapshot.Character,
			Persona:   snapshot.Persona,
		},
		OwningWorld: snapshot.OwningWorld,
		DependencyClosure: sourceMaterializationSnapshotClosureUnionV1{
			Character: snapshot.CharacterClosure,
			Persona:   snapshot.PersonaClosure,
		},
		CoverageManifestHash:       snapshot.CoverageManifestHash,
		MaterializationContextHash: snapshot.MaterializationContextHash,
		NormalizationVersion:       snapshot.NormalizationVersion,
	}
}

func encodeLocalAgentSourceSnapshotV1(snapshot localAgentSourceSnapshotV1) ([]byte, error) {
	if err := validateLocalAgentSourceSnapshotV1(snapshot); err != nil {
		return nil, err
	}
	return canonicalizeSourceMaterializationJCS(snapshot)
}

func decodeLocalAgentSourceSnapshotV1(raw []byte) (localAgentSourceSnapshotV1, error) {
	if len(raw) == 0 {
		return localAgentSourceSnapshotV1{}, fmt.Errorf("source snapshot payload is empty")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var snapshot localAgentSourceSnapshotV1
	if err := decoder.Decode(&snapshot); err != nil {
		return localAgentSourceSnapshotV1{}, fmt.Errorf("decode source snapshot: %w", err)
	}
	if err := ensureSourceSnapshotJSONEOF(decoder); err != nil {
		return localAgentSourceSnapshotV1{}, err
	}
	if err := validateLocalAgentSourceSnapshotV1(snapshot); err != nil {
		return localAgentSourceSnapshotV1{}, err
	}
	canonical, err := canonicalizeSourceMaterializationJCS(snapshot)
	if err != nil {
		return localAgentSourceSnapshotV1{}, err
	}
	if !bytes.Equal(raw, canonical) {
		return localAgentSourceSnapshotV1{}, fmt.Errorf("persisted source snapshot is not canonical")
	}
	return snapshot, nil
}

func ensureSourceSnapshotJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); errors.Is(err, io.EOF) {
		return nil
	} else if err != nil {
		return fmt.Errorf("decode source snapshot trailing data: %w", err)
	}
	return fmt.Errorf("source snapshot contains trailing JSON values")
}

func insertLocalAgentSourceSnapshotTx(tx *sql.Tx, snapshot localAgentSourceSnapshotV1) error {
	typedSnapshot, err := encodeLocalAgentSourceSnapshotV1(snapshot)
	if err != nil {
		return err
	}
	sourceKind, err := sourceMaterializationProtoKind(snapshot.SourceRef.Kind)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`
		INSERT INTO runtime_local_agent_source_snapshot(
			local_agent_ref, snapshot_schema_version, snapshot_hash, captured_at,
			packet_id, packet_hash, issuer, key_fingerprint,
			source_kind, world_id, source_id, source_content_hash, world_content_hash,
			coverage_manifest_hash, materialization_context_hash,
			normalization_version, compiler_compatibility_version, typed_snapshot_json
		) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, snapshot.LocalAgentRef, snapshot.SnapshotHash, snapshot.CapturedAt,
		snapshot.PacketID, snapshot.PacketHash, snapshot.Issuer, snapshot.KeyFingerprint,
		int(sourceKind), snapshot.SourceRef.WorldID, snapshot.SourceRef.SourceID, snapshot.SourceRef.SourceContentHash, snapshot.OwningWorld.ContentHash,
		snapshot.CoverageManifestHash, snapshot.MaterializationContextHash,
		snapshot.NormalizationVersion, snapshot.CompilerCompatibilityVersion, typedSnapshot); err != nil {
		return fmt.Errorf("insert local agent source snapshot: %w", err)
	}
	if _, err := tx.Exec(`
		INSERT INTO runtime_local_agent_source_provenance(
			source_kind, world_id, source_id, source_content_hash,
			materialization_context_hash, local_agent_ref, snapshot_hash
		) VALUES (?, ?, ?, ?, ?, ?, ?)
	`, int(sourceKind), snapshot.SourceRef.WorldID, snapshot.SourceRef.SourceID, snapshot.SourceRef.SourceContentHash,
		snapshot.MaterializationContextHash, snapshot.LocalAgentRef, snapshot.SnapshotHash); err != nil {
		return fmt.Errorf("insert local agent source provenance: %w", err)
	}
	return nil
}

func deleteLocalAgentSourceSnapshotTx(tx *sql.Tx, localAgentRef string) error {
	result, err := tx.Exec(`DELETE FROM runtime_local_agent_source_snapshot WHERE local_agent_ref = ?`, strings.TrimSpace(localAgentRef))
	if err != nil {
		return fmt.Errorf("delete local agent source snapshot: %w", err)
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected > 1 {
		return fmt.Errorf("local agent source snapshot 1:1 constraint violated")
	}
	return nil
}

func (r *sourceMaterializationRepository) sourceSnapshot(ctx context.Context, localAgentRef string) (localAgentSourceSnapshotV1, bool, error) {
	row := r.backend.DB().QueryRowContext(ctx, `
		SELECT local_agent_ref, snapshot_schema_version, snapshot_hash, captured_at,
			packet_id, packet_hash, issuer, key_fingerprint,
			source_kind, world_id, source_id, source_content_hash, world_content_hash,
			coverage_manifest_hash, materialization_context_hash,
			normalization_version, compiler_compatibility_version, typed_snapshot_json
		FROM runtime_local_agent_source_snapshot WHERE local_agent_ref = ?
	`, strings.TrimSpace(localAgentRef))
	return scanLocalAgentSourceSnapshotRow(row)
}

func (r *sourceMaterializationRepository) validatePersistedSnapshots(ctx context.Context) error {
	rows, err := r.backend.DB().QueryContext(ctx, `
		SELECT local_agent_ref, snapshot_schema_version, snapshot_hash, captured_at,
			packet_id, packet_hash, issuer, key_fingerprint,
			source_kind, world_id, source_id, source_content_hash, world_content_hash,
			coverage_manifest_hash, materialization_context_hash,
			normalization_version, compiler_compatibility_version, typed_snapshot_json
		FROM runtime_local_agent_source_snapshot ORDER BY local_agent_ref
	`)
	if err != nil {
		return fmt.Errorf("query persisted source snapshots: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var snapshots []localAgentSourceSnapshotV1
	for rows.Next() {
		snapshot, found, err := scanLocalAgentSourceSnapshotRow(rows)
		if err != nil {
			return err
		}
		if !found {
			return fmt.Errorf("persisted source snapshot row disappeared during validation")
		}
		snapshots = append(snapshots, snapshot)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate persisted source snapshots: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close persisted source snapshot rows: %w", err)
	}
	for _, snapshot := range snapshots {
		if err := r.validateSourceSnapshotProvenance(ctx, snapshot); err != nil {
			return err
		}
	}
	var provenanceCount int
	if err := r.backend.DB().QueryRowContext(ctx, `SELECT COUNT(*) FROM runtime_local_agent_source_provenance`).Scan(&provenanceCount); err != nil {
		return fmt.Errorf("count persisted source provenance: %w", err)
	}
	if provenanceCount != len(snapshots) {
		return fmt.Errorf("source snapshot/provenance count mismatch: snapshots=%d provenance=%d", len(snapshots), provenanceCount)
	}
	return nil
}

func (r *sourceMaterializationRepository) validateSourceSnapshotProvenance(ctx context.Context, snapshot localAgentSourceSnapshotV1) error {
	kind, err := sourceMaterializationProtoKind(snapshot.SourceRef.Kind)
	if err != nil {
		return err
	}
	var sourceKind int
	var worldID, sourceID, sourceHash, contextHash, localAgentRef, snapshotHash string
	err = r.backend.DB().QueryRowContext(ctx, `
		SELECT source_kind, world_id, source_id, source_content_hash,
			materialization_context_hash, local_agent_ref, snapshot_hash
		FROM runtime_local_agent_source_provenance WHERE local_agent_ref = ?
	`, snapshot.LocalAgentRef).Scan(&sourceKind, &worldID, &sourceID, &sourceHash, &contextHash, &localAgentRef, &snapshotHash)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("source snapshot %s has no provenance membership", snapshot.LocalAgentRef)
	}
	if err != nil {
		return fmt.Errorf("read source snapshot provenance: %w", err)
	}
	if sourceKind != int(kind) || worldID != snapshot.SourceRef.WorldID ||
		sourceID != snapshot.SourceRef.SourceID || sourceHash != snapshot.SourceRef.SourceContentHash ||
		contextHash != snapshot.MaterializationContextHash || localAgentRef != snapshot.LocalAgentRef ||
		snapshotHash != snapshot.SnapshotHash {
		return fmt.Errorf("source snapshot %s provenance binding mismatch", snapshot.LocalAgentRef)
	}
	return nil
}

// validateLoadedSourceSnapshotBindings enforces the durable 1:1 boundary
// between every Realm-derived AgentRecord and its immutable typed snapshot.
// Startup fails closed if either side is missing or if the bounded public
// status drifts from the hash-verified snapshot readback.
func (s *Service) validateLoadedSourceSnapshotBindings(ctx context.Context) error {
	if s == nil || s.sourceMaterializationRepo == nil {
		return fmt.Errorf("source materialization repository is unavailable")
	}
	s.mu.RLock()
	agents := make([]*runtimev1.AgentRecord, 0, len(s.agents))
	for _, entry := range s.agents {
		if entry != nil && entry.Agent != nil {
			agents = append(agents, cloneAgentRecord(entry.Agent))
		}
	}
	s.mu.RUnlock()
	materializedCount := 0
	for _, agent := range agents {
		if !realmSourceRefRequiresCommittedMaterialization(agent.GetRuntimeSourceRef()) {
			if agent.GetSourceContextStatus() != nil {
				return fmt.Errorf("ordinary LocalAgent %s carries Realm source context status", agent.GetLocalAgentRef())
			}
			continue
		}
		materializedCount++
		snapshot, found, err := s.sourceMaterializationRepo.sourceSnapshot(ctx, agent.GetLocalAgentRef())
		if err != nil {
			return err
		}
		if !found {
			return fmt.Errorf("Realm-derived LocalAgent %s has no immutable source snapshot", agent.GetLocalAgentRef())
		}
		if agent.GetRuntimeSourceRef() != runtimeSourceRefForMaterialization(sourceMaterializationProtoRefFromSnapshot(snapshot.SourceRef)) {
			return fmt.Errorf("Realm-derived LocalAgent %s source ref does not match snapshot", agent.GetLocalAgentRef())
		}
		expectedStatus := localAgentSourceContextStatus(snapshot)
		if !proto.Equal(agent.GetSourceContextStatus(), expectedStatus) {
			return fmt.Errorf("Realm-derived LocalAgent %s bounded source status does not match snapshot", agent.GetLocalAgentRef())
		}
	}
	var snapshotCount int
	if err := s.backend.DB().QueryRowContext(ctx, `SELECT COUNT(*) FROM runtime_local_agent_source_snapshot`).Scan(&snapshotCount); err != nil {
		return fmt.Errorf("count persisted source snapshots: %w", err)
	}
	if snapshotCount != materializedCount {
		return fmt.Errorf("source snapshot 1:1 count mismatch: agents=%d snapshots=%d", materializedCount, snapshotCount)
	}
	return nil
}

func (r *sourceMaterializationRepository) sourceSnapshotsByProvenance(ctx context.Context, sourceRef *runtimev1.SourceMaterializationSourceRef, materializationContextHash string) ([]localAgentSourceSnapshotV1, error) {
	validated, err := validateSourceMaterializationSourceRef(sourceRef)
	if err != nil || !validSHA256Hex(materializationContextHash) {
		return nil, fmt.Errorf("source provenance key is invalid")
	}
	rows, err := r.backend.DB().QueryContext(ctx, `
		SELECT s.local_agent_ref, s.snapshot_schema_version, s.snapshot_hash, s.captured_at,
			s.packet_id, s.packet_hash, s.issuer, s.key_fingerprint,
			s.source_kind, s.world_id, s.source_id, s.source_content_hash, s.world_content_hash,
			s.coverage_manifest_hash, s.materialization_context_hash,
			s.normalization_version, s.compiler_compatibility_version, s.typed_snapshot_json
		FROM runtime_local_agent_source_provenance p
		JOIN runtime_local_agent_source_snapshot s ON s.local_agent_ref = p.local_agent_ref
		WHERE p.source_kind = ? AND p.world_id = ? AND p.source_id = ?
			AND p.source_content_hash = ? AND p.materialization_context_hash = ?
		ORDER BY p.local_agent_ref
	`, int(validated.GetKind()), validated.GetWorldId(), validated.GetSourceId(), validated.GetSourceContentHash(), materializationContextHash)
	if err != nil {
		return nil, fmt.Errorf("query local agent source provenance: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var snapshots []localAgentSourceSnapshotV1
	for rows.Next() {
		snapshot, found, err := scanLocalAgentSourceSnapshotRow(rows)
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, fmt.Errorf("source provenance references a missing snapshot")
		}
		snapshots = append(snapshots, snapshot)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return snapshots, nil
}

func scanLocalAgentSourceSnapshotRow(row sourceMaterializationRowScanner) (localAgentSourceSnapshotV1, bool, error) {
	var localAgentRef, snapshotHash, capturedAt, packetID, packetHash, issuer, keyFingerprint string
	var worldID, sourceID, sourceHash, worldHash, coverageHash, contextHash, normalizationVersion, compilerVersion string
	var schemaVersion, sourceKind int
	var typedSnapshot []byte
	err := row.Scan(&localAgentRef, &schemaVersion, &snapshotHash, &capturedAt,
		&packetID, &packetHash, &issuer, &keyFingerprint,
		&sourceKind, &worldID, &sourceID, &sourceHash, &worldHash,
		&coverageHash, &contextHash, &normalizationVersion, &compilerVersion, &typedSnapshot)
	if errors.Is(err, sql.ErrNoRows) {
		return localAgentSourceSnapshotV1{}, false, nil
	}
	if err != nil {
		return localAgentSourceSnapshotV1{}, false, fmt.Errorf("scan local agent source snapshot: %w", err)
	}
	if schemaVersion != 1 {
		return localAgentSourceSnapshotV1{}, false, fmt.Errorf("persisted source snapshot schema version is invalid")
	}
	snapshot, err := decodeLocalAgentSourceSnapshotV1(typedSnapshot)
	if err != nil {
		return localAgentSourceSnapshotV1{}, false, err
	}
	kind, err := sourceMaterializationProtoKind(snapshot.SourceRef.Kind)
	if err != nil {
		return localAgentSourceSnapshotV1{}, false, err
	}
	if snapshot.LocalAgentRef != localAgentRef || snapshot.SnapshotHash != snapshotHash || snapshot.CapturedAt != capturedAt || snapshot.PacketID != packetID || snapshot.PacketHash != packetHash || snapshot.Issuer != issuer || snapshot.KeyFingerprint != keyFingerprint || int(kind) != sourceKind || snapshot.SourceRef.WorldID != worldID || snapshot.SourceRef.SourceID != sourceID || snapshot.SourceRef.SourceContentHash != sourceHash || snapshot.OwningWorld.ContentHash != worldHash || snapshot.CoverageManifestHash != coverageHash || snapshot.MaterializationContextHash != contextHash || snapshot.NormalizationVersion != normalizationVersion || snapshot.CompilerCompatibilityVersion != compilerVersion {
		return localAgentSourceSnapshotV1{}, false, fmt.Errorf("persisted source snapshot column binding mismatch")
	}
	return snapshot, true, nil
}

func sourceMaterializationProtoKind(kind string) (runtimev1.AgentSourceMaterializationSourceKind, error) {
	switch kind {
	case "worldCharacter":
		return runtimev1.AgentSourceMaterializationSourceKind_AGENT_SOURCE_MATERIALIZATION_SOURCE_KIND_WORLD_CHARACTER, nil
	case "realmPersona":
		return runtimev1.AgentSourceMaterializationSourceKind_AGENT_SOURCE_MATERIALIZATION_SOURCE_KIND_REALM_PERSONA, nil
	default:
		return runtimev1.AgentSourceMaterializationSourceKind_AGENT_SOURCE_MATERIALIZATION_SOURCE_KIND_UNSPECIFIED, fmt.Errorf("source snapshot kind is invalid")
	}
}

func localAgentSourceContextStatus(snapshot localAgentSourceSnapshotV1) *runtimev1.LocalAgentSourceContextStatus {
	sourceKind, _ := sourceMaterializationProtoKind(snapshot.SourceRef.Kind)
	sourceSchemaVersion := ""
	if snapshot.Character != nil {
		sourceSchemaVersion = snapshot.Character.SchemaVersion
	} else if snapshot.Persona != nil {
		sourceSchemaVersion = snapshot.Persona.SchemaVersion
	}
	capturedAt, _ := time.Parse(time.RFC3339Nano, snapshot.CapturedAt)
	return &runtimev1.LocalAgentSourceContextStatus{
		SchemaVersion:              runtimev1.AgentLocalSourceContextSchemaVersion_AGENT_LOCAL_SOURCE_CONTEXT_SCHEMA_VERSION_V1,
		Ready:                      true,
		State:                      runtimev1.AgentLocalSourceContextState_AGENT_LOCAL_SOURCE_CONTEXT_STATE_READY,
		ReasonCode:                 runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_NONE,
		LocalAgentRef:              snapshot.LocalAgentRef,
		SourceRef:                  &runtimev1.SourceMaterializationSourceRef{Kind: sourceKind, WorldId: snapshot.SourceRef.WorldID, SourceId: snapshot.SourceRef.SourceID, SourceContentHash: snapshot.SourceRef.SourceContentHash},
		SourceSchemaVersion:        sourceSchemaVersion,
		SnapshotSchemaVersion:      runtimev1.AgentLocalSourceSnapshotSchemaVersion_AGENT_LOCAL_SOURCE_SNAPSHOT_SCHEMA_VERSION_V1,
		SnapshotHash:               snapshot.SnapshotHash,
		CapturedAt:                 timestamppb.New(capturedAt),
		WorldContentHash:           snapshot.OwningWorld.ContentHash,
		MaterializationContextHash: snapshot.MaterializationContextHash,
		CoverageSections:           localAgentSourceCoverageProjection(snapshot),
	}
}

func localAgentSourceCoverageProjection(snapshot localAgentSourceSnapshotV1) []*runtimev1.LocalAgentSourceCoverageSectionStatus {
	type counts struct{ required, resolved, omitted uint32 }
	bySection := make(map[runtimev1.AgentLocalSourceCoverageSection]counts)
	for _, required := range snapshot.Coverage.RequiredSections {
		section := localAgentSourceCoverageSection(required.Path)
		if section == runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_UNSPECIFIED {
			continue
		}
		value := bySection[section]
		value.required++
		if required.State == "present" || required.State == "complete" {
			value.resolved++
		}
		bySection[section] = value
	}
	closure := bySection[runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_DEPENDENCY_CLOSURE]
	for _, required := range snapshot.Coverage.RequiredRefs {
		closure.required++
		if required.State == "resolved" {
			closure.resolved++
		}
	}
	for _, optional := range snapshot.Coverage.OptionalRefs {
		if optional.State == "omitted" {
			closure.omitted++
		}
	}
	bySection[runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_DEPENDENCY_CLOSURE] = closure
	bySection[runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_WORLD_CORE] = counts{required: 1, resolved: 1}
	if snapshot.Character != nil {
		bySection[runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_BOUND_ENTITY] = counts{required: 1, resolved: 1}
	}
	keys := make([]int, 0, len(bySection))
	for section := range bySection {
		keys = append(keys, int(section))
	}
	sort.Ints(keys)
	projection := make([]*runtimev1.LocalAgentSourceCoverageSectionStatus, 0, len(keys))
	for _, rawSection := range keys {
		section := runtimev1.AgentLocalSourceCoverageSection(rawSection)
		value := bySection[section]
		state := runtimev1.AgentLocalSourceCoverageState_AGENT_LOCAL_SOURCE_COVERAGE_STATE_COMPLETE
		if value.resolved < value.required {
			state = runtimev1.AgentLocalSourceCoverageState_AGENT_LOCAL_SOURCE_COVERAGE_STATE_INVALID
		} else if value.required == 0 && value.omitted > 0 {
			state = runtimev1.AgentLocalSourceCoverageState_AGENT_LOCAL_SOURCE_COVERAGE_STATE_OPTIONAL_OMITTED
		}
		projection = append(projection, &runtimev1.LocalAgentSourceCoverageSectionStatus{Section: section, State: state, RequiredCount: value.required, ResolvedCount: value.resolved, OmittedCount: value.omitted})
	}
	return projection
}

func localAgentSourceCoverageSection(path string) runtimev1.AgentLocalSourceCoverageSection {
	suffix := strings.TrimPrefix(strings.TrimSpace(path), "source.core.")
	sections := map[string]runtimev1.AgentLocalSourceCoverageSection{
		"identity":           runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_IDENTITY,
		"presentation":       runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_PRESENTATION,
		"placement":          runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_PLACEMENT,
		"biography":          runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_BIOGRAPHY,
		"psychology":         runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_PSYCHOLOGY,
		"knowledge":          runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_KNOWLEDGE,
		"relationships":      runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_RELATIONSHIPS,
		"capabilities":       runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_CAPABILITIES,
		"interactionProfile": runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_INTERACTION_PROFILE,
		"assets":             runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_ASSETS,
		"authoring":          runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_AUTHORING,
		"personaStyle":       runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_PERSONA_STYLE,
		"contentProfile":     runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_CONTENT_PROFILE,
	}
	return sections[suffix]
}
