package runtimeagent

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	localAgentSourceSnapshotSchemaVersionV2     = "nimi.runtime.local-agent-source-snapshot/v2"
	localAgentSourceNormalizationVersionV3      = "nimi.runtime.source-materialization-normalization/v3"
	localAgentSourceCompilerCompatibilityV3     = "realm-character-v3"
	localAgentSourceSnapshotHashDomainV2        = "nimi.runtime.local-agent-source-snapshot/v2\x00"
	localAgentRealmSourceProvenanceHashDomainV3 = "nimi.runtime.realm-source-provenance/v3\x00"
	localAgentRealmRuntimeSourceRefHashDomainV3 = "nimi.runtime.realm-source-ref/v3\x00"
	localAgentRealmRuntimeSourceRefPrefixV3     = "runtime-source:realm-v3:"
)

// localAgentRealmCharacterSourceV3 is the normalized semantic Character
// wrapper persisted in SnapshotV2. It deliberately has no Raw field: packet,
// proof, challenge and transport bytes cannot cross the product boundary.
type localAgentRealmCharacterSourceV3 struct {
	Kind                     string                                 `json:"kind"`
	ID                       string                                 `json:"id"`
	SchemaVersion            string                                 `json:"schemaVersion"`
	ContentRevision          uint64                                 `json:"contentRevision"`
	ContentHash              string                                 `json:"contentHash"`
	CreatedAt                string                                 `json:"createdAt"`
	UpdatedAt                string                                 `json:"updatedAt"`
	Origin                   sourceMaterializationOriginV3          `json:"origin"`
	CreatorID                string                                 `json:"creatorId,omitempty"`
	OwnerAccountID           string                                 `json:"ownerAccountId,omitempty"`
	Visibility               string                                 `json:"visibility"`
	WorldID                  string                                 `json:"worldId"`
	WorldEntityRef           *sourceMaterializationWorldEntityRefV3 `json:"worldEntityRef,omitempty"`
	Profile                  sourceMaterializationJSONValue         `json:"profile"`
	Validity                 sourceMaterializationValidityV3        `json:"validity"`
	MaterializationReadiness sourceMaterializationReadinessV3       `json:"materializationReadiness"`
	SourceHash               string                                 `json:"sourceHash"`
}

// The Realm closure union has branch-required arrays that may be empty. Slice
// pointers preserve required-empty versus branch-absent without a free-form
// map or a raw JSON escape hatch.
type localAgentSourceDependencyClosureV3 struct {
	Kind                  string                                       `json:"kind"`
	BoundEntity           *sourceMaterializationEntityRecordV3         `json:"boundEntity,omitempty"`
	IncidentRelationships *[]sourceMaterializationRelationshipRecordV3 `json:"incidentRelationships,omitempty"`
	EndpointEntities      *[]sourceMaterializationEntityRecordV3       `json:"endpointEntities,omitempty"`
	ExplicitEntities      []sourceMaterializationEntityRecordV3        `json:"explicitEntities"`
	ExplicitRelationships *[]sourceMaterializationRelationshipRecordV3 `json:"explicitRelationships,omitempty"`
	ExplicitDependencies  []sourceMaterializationDependencyRefV3       `json:"explicitDependencies"`
}

// localAgentSourceSemanticV2 is the complete typed semantic closure admitted
// to Runtime product state. All fields are Realm-normalized before hashing or
// persistence. There is intentionally no map, RawMessage, segment, chunk or
// component transport field.
type localAgentSourceSemanticV2 struct {
	SourceRef                       sourceMaterializationCharacterSourceRefV3    `json:"sourceRef"`
	Source                          localAgentRealmCharacterSourceV3             `json:"source"`
	OwningWorld                     sourceMaterializationWorldRecordV3           `json:"owningWorld"`
	DependencyClosure               localAgentSourceDependencyClosureV3          `json:"dependencyClosure"`
	Coverage                        sourceMaterializationCoverageManifestV3Value `json:"coverage"`
	SourceComponentDigests          []sourceMaterializationComponentDigestV3     `json:"sourceComponentDigests"`
	WorldAndClosureComponentDigests []sourceMaterializationComponentDigestV3     `json:"worldAndClosureComponentDigests"`
	ClosurePolicyVersion            string                                       `json:"closurePolicyVersion"`
	SourceHash                      string                                       `json:"sourceHash"`
	WorldContentHash                string                                       `json:"worldContentHash"`
	CoverageHash                    string                                       `json:"coverageHash"`
	MaterializationContextHash      string                                       `json:"materializationContextHash"`
	PayloadHash                     string                                       `json:"payloadHash"`
	OrderedComponentSetHash         string                                       `json:"orderedComponentSetHash"`
	ClosureSetManifestHash          string                                       `json:"closureSetManifestHash"`
}

type localAgentSourceSnapshotV2 struct {
	SnapshotSchemaVersion        string                     `json:"snapshotSchemaVersion"`
	SnapshotHash                 string                     `json:"snapshotHash"`
	LocalAgentRef                string                     `json:"localAgentRef"`
	CapturedAt                   string                     `json:"capturedAt"`
	PacketID                     string                     `json:"packetId"`
	PacketHash                   string                     `json:"packetHash"`
	RealmIssuer                  string                     `json:"realmIssuer"`
	SigningKeyFingerprint        string                     `json:"signingKeyFingerprint"`
	Semantic                     localAgentSourceSemanticV2 `json:"semantic"`
	NormalizationVersion         string                     `json:"normalizationVersion"`
	CompilerCompatibilityVersion string                     `json:"compilerCompatibilityVersion"`
}

type localAgentSourceSnapshotHashInputV2 struct {
	SnapshotSchemaVersion        string                     `json:"snapshotSchemaVersion"`
	Semantic                     localAgentSourceSemanticV2 `json:"semantic"`
	NormalizationVersion         string                     `json:"normalizationVersion"`
	CompilerCompatibilityVersion string                     `json:"compilerCompatibilityVersion"`
}

func finalizeLocalAgentSourceSnapshotV2(
	verified verifiedSourceMaterializationV3,
	localAgentRef string,
) (localAgentSourceSnapshotV2, error) {
	if err := validateVerifiedSourceMaterializationForProductV3(verified); err != nil {
		return localAgentSourceSnapshotV2{}, err
	}
	packet := verified.Packet
	semantic := localAgentSourceSemanticV2{
		SourceRef:                       packet.SourceRef,
		Source:                          localAgentRealmCharacterSourceFromVerifiedV3(packet.SemanticPayload.CanonicalSource),
		OwningWorld:                     packet.SemanticPayload.MaterializationContext.OwningWorld,
		DependencyClosure:               localAgentSourceDependencyClosureFromVerifiedV3(packet.SemanticPayload.MaterializationContext.DependencyClosure),
		Coverage:                        packet.SemanticPayload.MaterializationCoverage,
		SourceComponentDigests:          packet.SemanticPayload.MaterializationContext.SourceComponentDigests,
		WorldAndClosureComponentDigests: packet.SemanticPayload.MaterializationContext.WorldAndClosureComponentDigests,
		ClosurePolicyVersion:            packet.SemanticPayload.MaterializationContext.ClosurePolicyVersion,
		SourceHash:                      packet.SourceRef.SourceHash,
		WorldContentHash:                packet.SemanticPayload.MaterializationContext.OwningWorld.ContentHash,
		CoverageHash:                    packet.SemanticPayload.MaterializationCoverageHash,
		MaterializationContextHash:      packet.MaterializationContextHash,
		PayloadHash:                     packet.PayloadHash,
		OrderedComponentSetHash:         packet.ClosureSetManifest.OrderedComponentSetHash,
		ClosureSetManifestHash:          packet.ClosureSetManifestHash,
	}
	normalized, err := normalizeLocalAgentSourceSemanticV2(semantic)
	if err != nil {
		return localAgentSourceSnapshotV2{}, fmt.Errorf("normalize LocalAgent source semantics: %w", err)
	}
	snapshot := localAgentSourceSnapshotV2{
		SnapshotSchemaVersion:        localAgentSourceSnapshotSchemaVersionV2,
		LocalAgentRef:                strings.TrimSpace(localAgentRef),
		CapturedAt:                   verified.VerifiedAt.UTC().Format(time.RFC3339Nano),
		PacketID:                     packet.PacketID,
		PacketHash:                   packet.PacketHash,
		RealmIssuer:                  packet.Issuer,
		SigningKeyFingerprint:        verified.SigningKeyFingerprint,
		Semantic:                     normalized,
		NormalizationVersion:         localAgentSourceNormalizationVersionV3,
		CompilerCompatibilityVersion: localAgentSourceCompilerCompatibilityV3,
	}
	if err := validateLocalAgentSnapshotPayloadParityV2(snapshot, packet.SemanticPayload); err != nil {
		return localAgentSourceSnapshotV2{}, err
	}
	snapshotHash, err := computeLocalAgentSourceSnapshotHashV2(snapshot)
	if err != nil {
		return localAgentSourceSnapshotV2{}, fmt.Errorf("compute LocalAgent source snapshot hash: %w", err)
	}
	snapshot.SnapshotHash = snapshotHash
	if err := validateLocalAgentSourceSnapshotV2(snapshot); err != nil {
		return localAgentSourceSnapshotV2{}, err
	}
	return snapshot, nil
}

func validateLocalAgentSnapshotPayloadParityV2(snapshot localAgentSourceSnapshotV2, original sourceMaterializationPayloadV3Value) error {
	payload, err := localAgentSourcePayloadFromSnapshotV2(snapshot)
	if err != nil {
		return err
	}
	originalSource, err := sourceMaterializationCanonicalSourceSemanticV3(original)
	if err != nil {
		return fmt.Errorf("project verified canonical source for SnapshotV2 parity: %w", err)
	}
	originalSourceBytes, err := canonicalizeSourceMaterializationJCS(originalSource)
	if err != nil {
		return fmt.Errorf("canonicalize verified source for SnapshotV2 parity: %w", err)
	}
	original.CanonicalSourceRaw = originalSourceBytes
	originalValue, err := sourceMaterializationV3Any(original)
	if err != nil {
		return fmt.Errorf("project verified semantic payload for SnapshotV2 parity: %w", err)
	}
	reconstructedValue, err := sourceMaterializationV3Any(payload)
	if err != nil {
		return fmt.Errorf("project SnapshotV2 semantic payload: %w", err)
	}
	if sourceMaterializationV3CanonicalEqual(originalValue, reconstructedValue) {
		return nil
	}
	return fmt.Errorf("SnapshotV2 normalized semantic payload differs at %s", localAgentSourceSemanticDifferencePathV2(originalValue, reconstructedValue, "$"))
}

func localAgentSourceSemanticDifferencePathV2(left, right any, path string) string {
	switch leftValue := left.(type) {
	case map[string]any:
		rightValue, ok := right.(map[string]any)
		if !ok {
			return path
		}
		keys := make([]string, 0, len(leftValue)+len(rightValue))
		seen := make(map[string]struct{}, len(leftValue)+len(rightValue))
		for key := range leftValue {
			seen[key] = struct{}{}
			keys = append(keys, key)
		}
		for key := range rightValue {
			if _, exists := seen[key]; !exists {
				keys = append(keys, key)
			}
		}
		sort.Strings(keys)
		for _, key := range keys {
			leftItem, leftExists := leftValue[key]
			rightItem, rightExists := rightValue[key]
			if !leftExists || !rightExists {
				return path + "." + key
			}
			if !sourceMaterializationV3CanonicalEqual(leftItem, rightItem) {
				return localAgentSourceSemanticDifferencePathV2(leftItem, rightItem, path+"."+key)
			}
		}
	case []any:
		rightValue, ok := right.([]any)
		if !ok || len(leftValue) != len(rightValue) {
			return path
		}
		for index := range leftValue {
			if !sourceMaterializationV3CanonicalEqual(leftValue[index], rightValue[index]) {
				return localAgentSourceSemanticDifferencePathV2(leftValue[index], rightValue[index], fmt.Sprintf("%s[%d]", path, index))
			}
		}
	}
	return path
}

func localAgentRealmCharacterSourceFromVerifiedV3(source sourceMaterializationCanonicalSourceV3) localAgentRealmCharacterSourceV3 {
	return localAgentRealmCharacterSourceV3{
		Kind: source.Kind, ID: source.ID, SchemaVersion: source.SchemaVersion,
		ContentRevision: source.ContentRevision, ContentHash: source.ContentHash,
		CreatedAt: source.CreatedAt, UpdatedAt: source.UpdatedAt, Origin: source.Origin,
		CreatorID: source.CreatorID, OwnerAccountID: source.OwnerAccountID,
		Visibility: source.Visibility, WorldID: source.WorldID,
		WorldEntityRef: source.WorldEntityRef, Profile: source.Profile,
		Validity: source.Validity, MaterializationReadiness: source.MaterializationReadiness,
		SourceHash: source.SourceHash,
	}
}

func localAgentSourceDependencyClosureFromVerifiedV3(value sourceMaterializationDependencyClosureV3Value) localAgentSourceDependencyClosureV3 {
	result := localAgentSourceDependencyClosureV3{
		Kind: value.Kind, BoundEntity: value.BoundEntity,
		ExplicitEntities:     append([]sourceMaterializationEntityRecordV3(nil), value.ExplicitEntities...),
		ExplicitDependencies: append([]sourceMaterializationDependencyRefV3(nil), value.ExplicitDependencies...),
	}
	if result.ExplicitEntities == nil {
		result.ExplicitEntities = []sourceMaterializationEntityRecordV3{}
	}
	if result.ExplicitDependencies == nil {
		result.ExplicitDependencies = []sourceMaterializationDependencyRefV3{}
	}
	if value.Kind == "worldCharacter" {
		incident := append([]sourceMaterializationRelationshipRecordV3(nil), value.IncidentRelationships...)
		endpoints := append([]sourceMaterializationEntityRecordV3(nil), value.EndpointEntities...)
		if incident == nil {
			incident = []sourceMaterializationRelationshipRecordV3{}
		}
		if endpoints == nil {
			endpoints = []sourceMaterializationEntityRecordV3{}
		}
		result.IncidentRelationships = &incident
		result.EndpointEntities = &endpoints
	} else if value.Kind == "personaCharacter" {
		relationships := append([]sourceMaterializationRelationshipRecordV3(nil), value.ExplicitRelationships...)
		if relationships == nil {
			relationships = []sourceMaterializationRelationshipRecordV3{}
		}
		result.ExplicitRelationships = &relationships
	}
	return result
}

func (value localAgentSourceDependencyClosureV3) verifiedType() sourceMaterializationDependencyClosureV3Value {
	result := sourceMaterializationDependencyClosureV3Value{
		Kind: value.Kind, BoundEntity: value.BoundEntity,
		ExplicitEntities:     append([]sourceMaterializationEntityRecordV3(nil), value.ExplicitEntities...),
		ExplicitDependencies: append([]sourceMaterializationDependencyRefV3(nil), value.ExplicitDependencies...),
	}
	if value.IncidentRelationships != nil {
		result.IncidentRelationships = append([]sourceMaterializationRelationshipRecordV3(nil), (*value.IncidentRelationships)...)
	}
	if value.EndpointEntities != nil {
		result.EndpointEntities = append([]sourceMaterializationEntityRecordV3(nil), (*value.EndpointEntities)...)
	}
	if value.ExplicitRelationships != nil {
		result.ExplicitRelationships = append([]sourceMaterializationRelationshipRecordV3(nil), (*value.ExplicitRelationships)...)
	}
	return result
}

func normalizeLocalAgentSourceSemanticV2(value localAgentSourceSemanticV2) (localAgentSourceSemanticV2, error) {
	raw, err := canonicalizeSourceMaterializationRealmV3(value)
	if err != nil {
		return localAgentSourceSemanticV2{}, err
	}
	var normalized localAgentSourceSemanticV2
	if err := strictDecodeSourceMaterializationV3(raw, &normalized); err != nil {
		return localAgentSourceSemanticV2{}, err
	}
	return normalized, nil
}

func validateVerifiedSourceMaterializationForProductV3(verified verifiedSourceMaterializationV3) error {
	packet := verified.Packet
	if verified.VerifiedAt.IsZero() || verified.VerifiedAt.Location() != time.UTC {
		return sourceMaterializationV3Error(sourceMaterializationFailurePersistenceV3, "verified_at must be a UTC instant")
	}
	if err := packet.SourceRef.validate(); err != nil {
		return err
	}
	if packet.SemanticPayload.CanonicalSource.ID == "" || packet.SemanticPayload.CanonicalSource.ID != packet.SourceRef.ID {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "verified canonical source is unavailable or misbound")
	}
	packetHash, err := sourceMaterializationPacketHashV3(packet)
	if err != nil || packetHash != packet.PacketHash {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "verified packet hash is stale")
	}
	payloadHash, err := sourceMaterializationPayloadHashV3(packet.SemanticPayload)
	if err != nil || payloadHash != packet.PayloadHash {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "verified payload hash is stale")
	}
	closureHash, err := sourceMaterializationClosureSetManifestHashV3(packet.ClosureSetManifest)
	if err != nil || closureHash != packet.ClosureSetManifestHash {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "verified closure-set hash is stale")
	}
	components := make([]sourceMaterializationManifestComponentV3, 0, packet.ClosureSetManifest.ComponentCount)
	for _, segment := range packet.OrderedSegments {
		components = append(components, segment.SegmentManifest.Components...)
	}
	orderedHash, err := sourceMaterializationOrderedComponentSetHashV3(components)
	if err != nil || orderedHash != packet.ClosureSetManifest.OrderedComponentSetHash {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "verified ordered component-set hash is stale")
	}
	expectedComponents, expectedIDs, err := sourceMaterializationSemanticComponentMapV3(packet)
	if err != nil {
		return err
	}
	if len(verified.OrderedComponentIDs) != len(components) || len(verified.CanonicalComponentBytes) != len(components) ||
		len(expectedIDs) != len(components) || len(expectedComponents) != len(components) {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "verified component closure is incomplete")
	}
	for index, component := range components {
		if verified.OrderedComponentIDs[index] != component.ComponentID || expectedIDs[index] != component.ComponentID {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "verified component order is stale")
		}
		verifiedBytes, ok := verified.CanonicalComponentBytes[component.ComponentID]
		if !ok || len(verifiedBytes) == 0 || uint64(len(verifiedBytes)) != component.CanonicalByteLength ||
			sha256HexBytes(verifiedBytes) != component.CanonicalBytesHash {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "verified component bytes are incomplete")
		}
		decoded, err := decodeSourceMaterializationJSON(verifiedBytes)
		if err != nil {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "verified component bytes are not closed JSON")
		}
		reencoded, err := canonicalizeSourceMaterializationJCS(decoded)
		if err != nil || !bytes.Equal(reencoded, verifiedBytes) {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "verified component bytes are not canonical JSON")
		}
		expectedBytes, err := canonicalizeSourceMaterializationJCS(expectedComponents[component.ComponentID])
		if err != nil || !bytes.Equal(expectedBytes, verifiedBytes) {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "verified component bytes do not match packet semantics")
		}
		contentHash, err := sourceMaterializationComponentContentHashV3(component.Kind, decoded)
		if err != nil || contentHash != component.ContentHash {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "verified component content hash is stale")
		}
	}
	if !isLowerSHA256V3(verified.SigningKeyFingerprint) {
		return sourceMaterializationV3Error(sourceMaterializationFailureCurrentKeyV3, "verified signing-key fingerprint is invalid")
	}
	return nil
}

func validateLocalAgentSourceSnapshotV2(snapshot localAgentSourceSnapshotV2) error {
	if snapshot.SnapshotSchemaVersion != localAgentSourceSnapshotSchemaVersionV2 ||
		snapshot.NormalizationVersion != localAgentSourceNormalizationVersionV3 ||
		snapshot.CompilerCompatibilityVersion != localAgentSourceCompilerCompatibilityV3 {
		return fmt.Errorf("LocalAgent source snapshot compatibility is invalid")
	}
	if !strings.HasPrefix(snapshot.LocalAgentRef, runtimeGeneratedLocalAgentRefPrefix) || snapshot.LocalAgentRef != strings.TrimSpace(snapshot.LocalAgentRef) {
		return fmt.Errorf("LocalAgent source snapshot identity is invalid")
	}
	capturedAt, err := time.Parse(time.RFC3339Nano, snapshot.CapturedAt)
	if err != nil || capturedAt.Location() != time.UTC || capturedAt.Format(time.RFC3339Nano) != snapshot.CapturedAt {
		return fmt.Errorf("LocalAgent source snapshot captured_at is invalid")
	}
	if err := requireSourceMaterializationV3Text(snapshot.PacketID, "snapshot.packetId"); err != nil {
		return err
	}
	if err := requireSourceMaterializationV3Text(snapshot.RealmIssuer, "snapshot.realmIssuer"); err != nil {
		return err
	}
	for field, digest := range map[string]string{
		"snapshotHash": snapshot.SnapshotHash, "packetHash": snapshot.PacketHash,
		"signingKeyFingerprint": snapshot.SigningKeyFingerprint,
		"sourceHash":            snapshot.Semantic.SourceHash, "worldContentHash": snapshot.Semantic.WorldContentHash,
		"coverageHash": snapshot.Semantic.CoverageHash, "materializationContextHash": snapshot.Semantic.MaterializationContextHash,
		"payloadHash": snapshot.Semantic.PayloadHash, "orderedComponentSetHash": snapshot.Semantic.OrderedComponentSetHash,
		"closureSetManifestHash": snapshot.Semantic.ClosureSetManifestHash,
	} {
		if !isLowerSHA256V3(digest) {
			return fmt.Errorf("LocalAgent source snapshot %s is invalid", field)
		}
	}
	if err := snapshot.Semantic.SourceRef.validate(); err != nil {
		return fmt.Errorf("LocalAgent source snapshot ref is invalid: %w", err)
	}
	if snapshot.Semantic.SourceHash != snapshot.Semantic.SourceRef.SourceHash ||
		snapshot.Semantic.Source.SourceHash != snapshot.Semantic.SourceRef.SourceHash ||
		snapshot.Semantic.Source.ID != snapshot.Semantic.SourceRef.ID ||
		snapshot.Semantic.Source.WorldID != snapshot.Semantic.SourceRef.WorldID ||
		snapshot.Semantic.Source.Kind != snapshot.Semantic.SourceRef.Kind ||
		snapshot.Semantic.WorldContentHash != snapshot.Semantic.OwningWorld.ContentHash ||
		snapshot.Semantic.CoverageHash != snapshot.Semantic.Coverage.MaterializationCoverageHash ||
		snapshot.Semantic.ClosurePolicyVersion != sourceMaterializationClosurePolicyV3 {
		return fmt.Errorf("LocalAgent source snapshot semantic bindings are invalid")
	}
	payload, err := localAgentSourcePayloadFromSnapshotV2(snapshot)
	if err != nil {
		return err
	}
	if err := validateSourceMaterializationPayloadV3(&payload, snapshot.Semantic.SourceRef); err != nil {
		return fmt.Errorf("validate LocalAgent source snapshot semantics: %w", err)
	}
	payloadHash, err := sourceMaterializationPayloadHashV3(payload)
	if err != nil || payloadHash != snapshot.Semantic.PayloadHash {
		return fmt.Errorf("LocalAgent source snapshot payload hash mismatch")
	}
	computed, err := computeLocalAgentSourceSnapshotHashV2(snapshot)
	if err != nil {
		return err
	}
	if computed != snapshot.SnapshotHash {
		return fmt.Errorf("LocalAgent source snapshot hash mismatch")
	}
	return nil
}

func localAgentSourcePayloadFromSnapshotV2(snapshot localAgentSourceSnapshotV2) (sourceMaterializationPayloadV3Value, error) {
	sourceRaw, err := localAgentRealmCanonicalSourceBytesV3(snapshot.Semantic.Source)
	if err != nil {
		return sourceMaterializationPayloadV3Value{}, fmt.Errorf("encode LocalAgent snapshot source: %w", err)
	}
	contextValue := localAgentSourceMaterializationContextWireV3{
		ContextSchemaVersion:            sourceMaterializationContextV3,
		SourceRef:                       snapshot.Semantic.SourceRef,
		OwningWorld:                     snapshot.Semantic.OwningWorld,
		DependencyClosure:               snapshot.Semantic.DependencyClosure,
		SourceComponentDigests:          snapshot.Semantic.SourceComponentDigests,
		WorldAndClosureComponentDigests: snapshot.Semantic.WorldAndClosureComponentDigests,
		ClosurePolicyVersion:            snapshot.Semantic.ClosurePolicyVersion,
		MaterializationCoverageHash:     snapshot.Semantic.CoverageHash,
		MaterializationContextHash:      snapshot.Semantic.MaterializationContextHash,
	}
	wire := localAgentSourcePayloadWireV3{
		PayloadSchemaVersion:   sourceMaterializationPayloadV3SchemaVersion,
		PayloadAssemblyVersion: sourceMaterializationAssemblyV3,
		SourceRef:              snapshot.Semantic.SourceRef,
		CanonicalSourceRaw:     sourceRaw,
		MaterializationContext: contextValue, MaterializationCoverage: snapshot.Semantic.Coverage,
		MaterializationCoverageHash: snapshot.Semantic.CoverageHash,
		MaterializationContextHash:  snapshot.Semantic.MaterializationContextHash,
	}
	raw, err := canonicalizeSourceMaterializationRealmV3(wire)
	if err != nil {
		return sourceMaterializationPayloadV3Value{}, fmt.Errorf("encode LocalAgent snapshot semantic payload: %w", err)
	}
	var payload sourceMaterializationPayloadV3Value
	if err := strictDecodeSourceMaterializationV3(raw, &payload); err != nil {
		return sourceMaterializationPayloadV3Value{}, fmt.Errorf("decode LocalAgent snapshot semantic payload: %w", err)
	}
	return payload, nil
}

type localAgentSourceMaterializationContextWireV3 struct {
	ContextSchemaVersion            string                                    `json:"contextSchemaVersion"`
	SourceRef                       sourceMaterializationCharacterSourceRefV3 `json:"sourceRef"`
	OwningWorld                     sourceMaterializationWorldRecordV3        `json:"owningWorld"`
	DependencyClosure               localAgentSourceDependencyClosureV3       `json:"dependencyClosure"`
	SourceComponentDigests          []sourceMaterializationComponentDigestV3  `json:"sourceComponentDigests"`
	WorldAndClosureComponentDigests []sourceMaterializationComponentDigestV3  `json:"worldAndClosureComponentDigests"`
	ClosurePolicyVersion            string                                    `json:"closurePolicyVersion"`
	MaterializationCoverageHash     string                                    `json:"materializationCoverageHash"`
	MaterializationContextHash      string                                    `json:"materializationContextHash"`
}

type localAgentSourcePayloadWireV3 struct {
	PayloadSchemaVersion        string                                       `json:"payloadSchemaVersion"`
	PayloadAssemblyVersion      string                                       `json:"payloadAssemblyVersion"`
	SourceRef                   sourceMaterializationCharacterSourceRefV3    `json:"sourceRef"`
	CanonicalSourceRaw          json.RawMessage                              `json:"canonicalSource"`
	MaterializationContext      localAgentSourceMaterializationContextWireV3 `json:"materializationContext"`
	MaterializationCoverage     sourceMaterializationCoverageManifestV3Value `json:"materializationCoverage"`
	MaterializationCoverageHash string                                       `json:"materializationCoverageHash"`
	MaterializationContextHash  string                                       `json:"materializationContextHash"`
}

func localAgentRealmCanonicalSourceBytesV3(source localAgentRealmCharacterSourceV3) ([]byte, error) {
	profileRaw, err := canonicalizeSourceMaterializationRealmV3(source.Profile)
	if err != nil {
		return nil, err
	}
	return canonicalizeSourceMaterializationRealmV3(sourceMaterializationCanonicalSourceWireV3{
		ID: source.ID, SchemaVersion: source.SchemaVersion, ContentRevision: source.ContentRevision,
		ContentHash: source.ContentHash, CreatedAt: source.CreatedAt, UpdatedAt: source.UpdatedAt,
		Origin: source.Origin, CreatorID: source.CreatorID, OwnerAccountID: source.OwnerAccountID,
		Visibility: source.Visibility, WorldID: source.WorldID, WorldEntityRef: source.WorldEntityRef,
		Profile: profileRaw, Validity: source.Validity,
		MaterializationReadiness: source.MaterializationReadiness, SourceHash: source.SourceHash,
	})
}

func computeLocalAgentSourceSnapshotHashV2(snapshot localAgentSourceSnapshotV2) (string, error) {
	return hashSourceMaterializationRealmDomainV3(localAgentSourceSnapshotHashDomainV2, localAgentSourceSnapshotHashInputV2{
		SnapshotSchemaVersion:        snapshot.SnapshotSchemaVersion,
		Semantic:                     snapshot.Semantic,
		NormalizationVersion:         snapshot.NormalizationVersion,
		CompilerCompatibilityVersion: snapshot.CompilerCompatibilityVersion,
	})
}

func localAgentRealmSourceProvenanceKeyV3(snapshot localAgentSourceSnapshotV2) (string, error) {
	if err := validateLocalAgentSourceSnapshotV2(snapshot); err != nil {
		return "", err
	}
	canonicalRef, err := canonicalizeSourceMaterializationRealmV3(snapshot.Semantic.SourceRef)
	if err != nil {
		return "", err
	}
	input := make([]byte, 0, len(localAgentRealmSourceProvenanceHashDomainV3)+len(canonicalRef)+len(snapshot.Semantic.MaterializationContextHash))
	input = append(input, localAgentRealmSourceProvenanceHashDomainV3...)
	input = append(input, canonicalRef...)
	input = append(input, snapshot.Semantic.MaterializationContextHash...)
	return sha256HexBytes(input), nil
}

func encodeLocalAgentSourceSnapshotV2(snapshot localAgentSourceSnapshotV2) ([]byte, error) {
	if err := validateLocalAgentSourceSnapshotV2(snapshot); err != nil {
		return nil, err
	}
	return canonicalizeSourceMaterializationRealmV3(snapshot)
}

func decodeLocalAgentSourceSnapshotV2(raw []byte) (localAgentSourceSnapshotV2, error) {
	if len(raw) == 0 {
		return localAgentSourceSnapshotV2{}, fmt.Errorf("LocalAgent source snapshot payload is empty")
	}
	var snapshot localAgentSourceSnapshotV2
	if err := strictDecodeSourceMaterializationV3(raw, &snapshot); err != nil {
		return localAgentSourceSnapshotV2{}, fmt.Errorf("decode LocalAgent source snapshot: %w", err)
	}
	if err := validateLocalAgentSourceSnapshotV2(snapshot); err != nil {
		return localAgentSourceSnapshotV2{}, err
	}
	canonical, err := canonicalizeSourceMaterializationRealmV3(snapshot)
	if err != nil {
		return localAgentSourceSnapshotV2{}, err
	}
	if !bytes.Equal(raw, canonical) {
		return localAgentSourceSnapshotV2{}, fmt.Errorf("persisted LocalAgent source snapshot is not canonical")
	}
	return snapshot, nil
}

func runtimeSourceRefForRealmSourceV3(ref sourceMaterializationCharacterSourceRefV3) (string, error) {
	if err := ref.validate(); err != nil {
		return "", err
	}
	digest, err := hashSourceMaterializationRealmDomainV3(localAgentRealmRuntimeSourceRefHashDomainV3, ref)
	if err != nil {
		return "", err
	}
	return localAgentRealmRuntimeSourceRefPrefixV3 + digest, nil
}

func (s *Service) prepareRealmSourceMaterializationProductV3(
	ctx context.Context,
	accountID string,
	localAgentRef string,
	verified verifiedSourceMaterializationV3,
) (*preparedRealmSourceMaterializationProductV3, *runtimev1.LocalAgentSourceContextStatus, error) {
	if s == nil || s.stateRepo == nil || s.agentAIConfigRepo == nil {
		return nil, nil, fmt.Errorf("Realm source materialization product store is unavailable")
	}
	if s.isClosed() {
		return nil, nil, fmt.Errorf("Realm source materialization product store is closed")
	}
	if ctx == nil {
		return nil, nil, fmt.Errorf("Realm source materialization product context is required")
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, fmt.Errorf("prepare Realm source materialization product: %w", err)
	}
	accountID = strings.TrimSpace(accountID)
	localAgentRef = strings.TrimSpace(localAgentRef)
	if accountID == "" || localAgentRef == "" || verified.Packet.MaterializerAccountID != accountID {
		return nil, nil, fmt.Errorf("Realm source materialization product identity is invalid")
	}
	snapshot, err := finalizeLocalAgentSourceSnapshotV2(verified, localAgentRef)
	if err != nil {
		return nil, nil, err
	}
	runtimeSourceRef, err := runtimeSourceRefForRealmSourceV3(snapshot.Semantic.SourceRef)
	if err != nil {
		return nil, nil, fmt.Errorf("derive Runtime source ref: %w", err)
	}
	capturedAt, _ := time.Parse(time.RFC3339Nano, snapshot.CapturedAt)
	status := localAgentSourceContextStatusV2(snapshot)
	identity := localAgentIdentity{OwnerUserID: accountID, RuntimeSourceRef: runtimeSourceRef, LocalAgentRef: localAgentRef}
	agent := &runtimev1.AgentRecord{
		AgentId: localAgentRef, LocalAgentRef: localAgentRef, OwnerUserId: accountID,
		RuntimeSourceRef: runtimeSourceRef, DisplayName: localAgentRealmSourceDisplayNameV3(snapshot),
		LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		Autonomy:        buildInitialAutonomyState(nil, capturedAt), SourceContextStatus: proto.Clone(status).(*runtimev1.LocalAgentSourceContextStatus),
		CreatedAt: timestamppb.New(capturedAt), UpdatedAt: timestamppb.New(capturedAt),
	}
	state := &runtimev1.AgentStateProjection{
		ExecutionState: runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE,
		ActiveWorldId:  snapshot.Semantic.SourceRef.WorldID, Attributes: map[string]string{},
		UpdatedAt: timestamppb.New(capturedAt),
	}
	entry := &agentEntry{Agent: agent, State: state, Hooks: make(map[string]*runtimev1.PendingHook)}
	lifecycleEvent := s.newEventForIdentityAt(identity, runtimev1.AgentEventType_AGENT_EVENT_TYPE_LIFECYCLE, &runtimev1.AgentEvent_Lifecycle{
		Lifecycle: &runtimev1.AgentLifecycleEventDetail{
			PreviousStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_UNSPECIFIED,
			CurrentStatus:  runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		},
	}, capturedAt)

	s.mu.Lock()
	previousEntry, hadEntry := s.agents[localAgentRef]
	if hadEntry {
		s.mu.Unlock()
		return nil, nil, fmt.Errorf("Realm source materialization local_agent_ref already exists")
	}
	previousEvents := append([]*runtimev1.AgentEvent(nil), s.events...)
	previousSequence := s.sequence
	s.agents[localAgentRef] = cloneAgentEntry(entry)
	committedEvents := s.eventStreamRuntime().appendEventsLocked(lifecycleEvent)
	persisted, err := s.stateRepo.snapshotStateLocked(s)
	if err != nil {
		delete(s.agents, localAgentRef)
		s.events = previousEvents
		s.sequence = previousSequence
		s.mu.Unlock()
		return nil, nil, err
	}
	seed := seedRuntimeAgentAIConfig(localAgentRef)
	seed.UpdatedAt = timestamppb.New(capturedAt)
	prepared := &preparedRealmSourceMaterializationProductV3{
		svc: s, localAgentRef: localAgentRef, previousEntry: previousEntry, hadEntry: hadEntry,
		previousEvents: previousEvents, previousSequence: previousSequence,
		persisted: persisted, committedEvents: committedEvents, seedAIConfig: seed,
		snapshot: snapshot,
	}
	return prepared, proto.Clone(status).(*runtimev1.LocalAgentSourceContextStatus), nil
}

type preparedRealmSourceMaterializationProductV3 struct {
	svc              *Service
	localAgentRef    string
	previousEntry    *agentEntry
	hadEntry         bool
	previousEvents   []*runtimev1.AgentEvent
	previousSequence uint64
	persisted        persistedRuntimeAgentState
	committedEvents  []*runtimev1.AgentEvent
	seedAIConfig     *runtimev1.RuntimeAgentAIConfig
	snapshot         localAgentSourceSnapshotV2
	commitMu         sync.Mutex
	commitAttempted  bool
	finalizeOnce     sync.Once
}

func (p *preparedRealmSourceMaterializationProductV3) commitTx(tx *sql.Tx) error {
	if p == nil || p.svc == nil || p.svc.stateRepo == nil || p.svc.agentAIConfigRepo == nil || tx == nil {
		return fmt.Errorf("prepared Realm source materialization product is unavailable")
	}
	p.commitMu.Lock()
	if p.commitAttempted {
		p.commitMu.Unlock()
		return fmt.Errorf("prepared Realm source materialization product transaction was already attempted")
	}
	p.commitAttempted = true
	p.commitMu.Unlock()
	if err := p.svc.stateRepo.persistSnapshotTx(tx, p.persisted, nil); err != nil {
		return err
	}
	if err := p.svc.agentAIConfigRepo.commitSeedTx(tx, p.seedAIConfig); err != nil {
		return err
	}
	if err := persistLocalAgentSourceSnapshotV2Tx(tx, p.snapshot); err != nil {
		return err
	}
	return nil
}

func (p *preparedRealmSourceMaterializationProductV3) committed() {
	if p == nil || p.svc == nil {
		return
	}
	p.finalizeOnce.Do(func() {
		targets := p.svc.eventStreamRuntime().matchingSubscribersLocked(p.committedEvents)
		p.svc.mu.Unlock()
		p.svc.eventStreamRuntime().broadcast(p.committedEvents, targets)
		p.svc.recordRuntimeAgentAIConfigAudit(p.seedAIConfig, runtimeAgentAIConfigSeededEventType)
		if err := p.svc.refreshRuntimeAgentAIConfigReadiness(p.localAgentRef); err != nil && p.svc.logger != nil {
			p.svc.logger.Warn("recompute runtime agent ai config readiness after Realm source materialization failed", "local_agent_ref", p.localAgentRef, "error", err)
		}
	})
}

func (p *preparedRealmSourceMaterializationProductV3) rolledBack() {
	if p == nil || p.svc == nil {
		return
	}
	p.finalizeOnce.Do(func() {
		if p.hadEntry {
			p.svc.agents[p.localAgentRef] = p.previousEntry
		} else {
			delete(p.svc.agents, p.localAgentRef)
		}
		p.svc.events = p.previousEvents
		p.svc.sequence = p.previousSequence
		p.svc.mu.Unlock()
	})
}

func persistLocalAgentSourceSnapshotV2Tx(tx *sql.Tx, snapshot localAgentSourceSnapshotV2) error {
	if tx == nil {
		return fmt.Errorf("LocalAgent source snapshot transaction is required")
	}
	typed, err := encodeLocalAgentSourceSnapshotV2(snapshot)
	if err != nil {
		return err
	}
	provenanceKey, err := localAgentRealmSourceProvenanceKeyV3(snapshot)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`
		INSERT INTO runtime_local_agent_source_snapshot_v2(
			local_agent_ref, snapshot_schema_version, snapshot_hash, captured_at,
			packet_id, packet_hash, realm_issuer, signing_key_fingerprint,
			source_kind, source_id, world_id, source_hash, world_content_hash,
			coverage_hash, materialization_context_hash, payload_hash,
			ordered_component_set_hash, closure_set_manifest_hash,
			normalization_version, compiler_compatibility_version, typed_snapshot_json
		) VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, snapshot.LocalAgentRef, snapshot.SnapshotHash, snapshot.CapturedAt,
		snapshot.PacketID, snapshot.PacketHash, snapshot.RealmIssuer, snapshot.SigningKeyFingerprint,
		snapshot.Semantic.SourceRef.Kind, snapshot.Semantic.SourceRef.ID, snapshot.Semantic.SourceRef.WorldID,
		snapshot.Semantic.SourceHash, snapshot.Semantic.WorldContentHash, snapshot.Semantic.CoverageHash,
		snapshot.Semantic.MaterializationContextHash, snapshot.Semantic.PayloadHash,
		snapshot.Semantic.OrderedComponentSetHash, snapshot.Semantic.ClosureSetManifestHash,
		snapshot.NormalizationVersion, snapshot.CompilerCompatibilityVersion, typed); err != nil {
		return fmt.Errorf("insert LocalAgent source snapshot v2: %w", err)
	}
	if _, err := tx.Exec(`
		INSERT INTO runtime_local_agent_source_provenance_v3(
			provenance_key, local_agent_ref, snapshot_hash, materialization_context_hash
		) VALUES (?, ?, ?, ?)
	`, provenanceKey, snapshot.LocalAgentRef, snapshot.SnapshotHash, snapshot.Semantic.MaterializationContextHash); err != nil {
		return fmt.Errorf("insert Realm source provenance v3: %w", err)
	}
	readback, readbackKey, err := readLocalAgentSourceSnapshotV2Tx(tx, snapshot.LocalAgentRef)
	if err != nil {
		return err
	}
	readbackBytes, err := encodeLocalAgentSourceSnapshotV2(readback)
	if err != nil {
		return err
	}
	if readbackKey != provenanceKey || !bytes.Equal(readbackBytes, typed) {
		return fmt.Errorf("LocalAgent source snapshot v2 strict readback mismatch")
	}
	return nil
}

func readLocalAgentSourceSnapshotV2Tx(tx *sql.Tx, localAgentRef string) (localAgentSourceSnapshotV2, string, error) {
	var (
		rowLocalAgentRef, snapshotHash, capturedAt, packetID, packetHash string
		realmIssuer, signingKeyFingerprint                               string
		sourceKind, sourceID, worldID, sourceHash                        string
		worldContentHash, coverageHash, materializationContextHash       string
		payloadHash, orderedComponentSetHash, closureSetManifestHash     string
		normalizationVersion, compilerCompatibilityVersion               string
		typed                                                            []byte
		schemaVersion                                                    int
	)
	err := tx.QueryRow(`
		SELECT local_agent_ref, snapshot_schema_version, snapshot_hash, captured_at,
			packet_id, packet_hash, realm_issuer, signing_key_fingerprint,
			source_kind, source_id, world_id, source_hash, world_content_hash,
			coverage_hash, materialization_context_hash, payload_hash,
			ordered_component_set_hash, closure_set_manifest_hash,
			normalization_version, compiler_compatibility_version, typed_snapshot_json
		FROM runtime_local_agent_source_snapshot_v2 WHERE local_agent_ref = ?
	`, strings.TrimSpace(localAgentRef)).Scan(
		&rowLocalAgentRef, &schemaVersion, &snapshotHash, &capturedAt,
		&packetID, &packetHash, &realmIssuer, &signingKeyFingerprint,
		&sourceKind, &sourceID, &worldID, &sourceHash, &worldContentHash,
		&coverageHash, &materializationContextHash, &payloadHash,
		&orderedComponentSetHash, &closureSetManifestHash,
		&normalizationVersion, &compilerCompatibilityVersion, &typed,
	)
	if err != nil {
		return localAgentSourceSnapshotV2{}, "", fmt.Errorf("read LocalAgent source snapshot v2: %w", err)
	}
	snapshot, err := decodeLocalAgentSourceSnapshotV2(typed)
	if err != nil {
		return localAgentSourceSnapshotV2{}, "", err
	}
	if schemaVersion != 2 || rowLocalAgentRef != snapshot.LocalAgentRef || snapshotHash != snapshot.SnapshotHash ||
		capturedAt != snapshot.CapturedAt || packetID != snapshot.PacketID || packetHash != snapshot.PacketHash ||
		realmIssuer != snapshot.RealmIssuer || signingKeyFingerprint != snapshot.SigningKeyFingerprint ||
		sourceKind != snapshot.Semantic.SourceRef.Kind || sourceID != snapshot.Semantic.SourceRef.ID ||
		worldID != snapshot.Semantic.SourceRef.WorldID || sourceHash != snapshot.Semantic.SourceHash ||
		worldContentHash != snapshot.Semantic.WorldContentHash || coverageHash != snapshot.Semantic.CoverageHash ||
		materializationContextHash != snapshot.Semantic.MaterializationContextHash || payloadHash != snapshot.Semantic.PayloadHash ||
		orderedComponentSetHash != snapshot.Semantic.OrderedComponentSetHash || closureSetManifestHash != snapshot.Semantic.ClosureSetManifestHash ||
		normalizationVersion != snapshot.NormalizationVersion || compilerCompatibilityVersion != snapshot.CompilerCompatibilityVersion {
		return localAgentSourceSnapshotV2{}, "", fmt.Errorf("LocalAgent source snapshot v2 column binding mismatch")
	}
	var provenanceKey, provenanceSnapshotHash, provenanceContextHash string
	if err := tx.QueryRow(`
		SELECT provenance_key, snapshot_hash, materialization_context_hash
		FROM runtime_local_agent_source_provenance_v3 WHERE local_agent_ref = ?
	`, rowLocalAgentRef).Scan(&provenanceKey, &provenanceSnapshotHash, &provenanceContextHash); err != nil {
		return localAgentSourceSnapshotV2{}, "", fmt.Errorf("read Realm source provenance v3: %w", err)
	}
	expectedProvenanceKey, err := localAgentRealmSourceProvenanceKeyV3(snapshot)
	if err != nil {
		return localAgentSourceSnapshotV2{}, "", fmt.Errorf("derive Realm source provenance v3 key: %w", err)
	}
	if provenanceKey != expectedProvenanceKey || provenanceSnapshotHash != snapshot.SnapshotHash ||
		provenanceContextHash != snapshot.Semantic.MaterializationContextHash {
		return localAgentSourceSnapshotV2{}, "", fmt.Errorf("Realm source provenance v3 binding mismatch")
	}
	return snapshot, provenanceKey, nil
}

func localAgentSourceContextStatusV2(snapshot localAgentSourceSnapshotV2) *runtimev1.LocalAgentSourceContextStatus {
	capturedAt, _ := time.Parse(time.RFC3339Nano, snapshot.CapturedAt)
	return &runtimev1.LocalAgentSourceContextStatus{
		SchemaVersion: runtimev1.AgentLocalSourceContextSchemaVersion_AGENT_LOCAL_SOURCE_CONTEXT_SCHEMA_VERSION_V2,
		Ready:         true, State: runtimev1.AgentLocalSourceContextState_AGENT_LOCAL_SOURCE_CONTEXT_STATE_READY,
		ReasonCode:    runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_NONE,
		LocalAgentRef: snapshot.LocalAgentRef, SourceRef: sourceMaterializationProtoRefV3(snapshot.Semantic.SourceRef),
		SourceSchemaVersion:   snapshot.Semantic.Source.SchemaVersion,
		SnapshotSchemaVersion: runtimev1.AgentLocalSourceSnapshotSchemaVersion_AGENT_LOCAL_SOURCE_SNAPSHOT_SCHEMA_VERSION_V2,
		SnapshotHash:          snapshot.SnapshotHash, CapturedAt: timestamppb.New(capturedAt),
		WorldContentHash:           snapshot.Semantic.WorldContentHash,
		MaterializationContextHash: snapshot.Semantic.MaterializationContextHash,
		CoverageSections:           localAgentSourceCoverageProjectionV2(snapshot),
	}
}

func localAgentSourceCoverageProjectionV2(snapshot localAgentSourceSnapshotV2) []*runtimev1.LocalAgentSourceCoverageSectionStatus {
	type counts struct{ required, resolved, omitted uint32 }
	bySection := make(map[runtimev1.AgentLocalSourceCoverageSection]counts)
	profile, _ := snapshot.Semantic.Source.Profile.interfaceValue().(map[string]any)
	profileCoverage, _ := profile["profileCoverage"].(map[string]any)
	applyProfileSections := func(raw any, required bool) {
		sections, _ := raw.([]any)
		for _, item := range sections {
			record, _ := item.(map[string]any)
			path, _ := record["path"].(string)
			state, _ := record["state"].(string)
			section := localAgentSourceProfileCoverageSectionV2(path)
			if section == runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_UNSPECIFIED {
				continue
			}
			value := bySection[section]
			if required {
				value.required++
			}
			if state == "present" {
				value.resolved++
			} else if state == "missing" {
				value.omitted++
			}
			bySection[section] = value
		}
	}
	applyProfileSections(profileCoverage["requiredSections"], true)
	applyProfileSections(profileCoverage["optionalSections"], false)
	applyProfileRefs := func(raw any, required bool) {
		refs, _ := raw.([]any)
		for _, item := range refs {
			record, _ := item.(map[string]any)
			path, _ := record["path"].(string)
			state, _ := record["state"].(string)
			section := localAgentSourceProfileCoverageSectionV2(path)
			if section == runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_UNSPECIFIED {
				continue
			}
			value := bySection[section]
			if required {
				value.required++
			}
			if state == "resolved" {
				value.resolved++
			} else if state == "missing" {
				value.omitted++
			}
			bySection[section] = value
		}
	}
	applyProfileRefs(profileCoverage["requiredRefs"], true)
	applyProfileRefs(profileCoverage["optionalRefs"], false)
	for _, required := range snapshot.Semantic.Coverage.RequiredSections {
		section := localAgentSourceCoverageSection(required.Path)
		if section == runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_UNSPECIFIED {
			continue
		}
		value := bySection[section]
		value.required++
		if required.State == "present" {
			value.resolved++
		}
		bySection[section] = value
	}
	closure := bySection[runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_DEPENDENCY_CLOSURE]
	for _, required := range snapshot.Semantic.Coverage.RequiredRefs {
		closure.required++
		if required.State == "resolved" {
			closure.resolved++
		}
	}
	for _, optional := range snapshot.Semantic.Coverage.OptionalRefs {
		if optional.State == "omitted" {
			closure.omitted++
		}
	}
	bySection[runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_DEPENDENCY_CLOSURE] = closure
	bySection[runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_WORLD_CORE] = counts{required: 1, resolved: 1}
	if snapshot.Semantic.SourceRef.Kind == "worldCharacter" {
		bySection[runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_BOUND_ENTITY] = counts{required: 1, resolved: 1}
	}
	keys := make([]int, 0, len(bySection))
	for section := range bySection {
		keys = append(keys, int(section))
	}
	sort.Ints(keys)
	projection := make([]*runtimev1.LocalAgentSourceCoverageSectionStatus, 0, len(keys))
	for _, key := range keys {
		section := runtimev1.AgentLocalSourceCoverageSection(key)
		value := bySection[section]
		state := runtimev1.AgentLocalSourceCoverageState_AGENT_LOCAL_SOURCE_COVERAGE_STATE_COMPLETE
		if value.resolved < value.required {
			state = runtimev1.AgentLocalSourceCoverageState_AGENT_LOCAL_SOURCE_COVERAGE_STATE_INVALID
		} else if value.required == 0 && value.omitted > 0 {
			state = runtimev1.AgentLocalSourceCoverageState_AGENT_LOCAL_SOURCE_COVERAGE_STATE_OPTIONAL_OMITTED
		}
		projection = append(projection, &runtimev1.LocalAgentSourceCoverageSectionStatus{
			Section: section, State: state, RequiredCount: value.required,
			ResolvedCount: value.resolved, OmittedCount: value.omitted,
		})
	}
	return projection
}

func localAgentSourceProfileCoverageSectionV2(path string) runtimev1.AgentLocalSourceCoverageSection {
	root := strings.TrimSpace(path)
	if index := strings.IndexByte(root, '.'); index >= 0 {
		root = root[:index]
	}
	if root == "narrative" {
		return runtimev1.AgentLocalSourceCoverageSection_AGENT_LOCAL_SOURCE_COVERAGE_SECTION_BIOGRAPHY
	}
	return localAgentSourceCoverageSection("source.core." + root)
}

func localAgentRealmSourceDisplayNameV3(snapshot localAgentSourceSnapshotV2) string {
	profile, _ := snapshot.Semantic.Source.Profile.interfaceValue().(map[string]any)
	presentation, _ := profile["presentation"].(map[string]any)
	identity, _ := profile["identity"].(map[string]any)
	displayName, _ := presentation["displayName"].(string)
	name, _ := identity["name"].(string)
	return firstNonEmpty(strings.TrimSpace(displayName), strings.TrimSpace(name), snapshot.Semantic.SourceRef.ID, snapshot.LocalAgentRef)
}
