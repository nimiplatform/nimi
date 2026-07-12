package runtimeagent

import (
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"math"
	"strings"
	"time"
)

const (
	sourceMaterializationPacketV2SchemaVersion  = "realm.source-materialization-packet/v2"
	sourceMaterializationPayloadV2SchemaVersion = "realm.source-materialization-payload/v2"
	sourceMaterializationAssemblyV1             = "realm.materialization-assembly/v1"
	sourceMaterializationContextV1              = "realm.materialization-context/v1"
	sourceMaterializationClosureV1              = "realm.materialization-closure/v1"
	sourceMaterializationCoverageV1             = "realm.materialization-coverage/v1"
	sourceMaterializationBundleManifestV1       = "realm.materialization-bundle-manifest/v1"
	sourceMaterializationNormalizationV1        = "nimi.runtime.source-materialization-normalization/v1"
	sourceMaterializationSnapshotV1             = "nimi.runtime.local-agent-source-snapshot/v1"

	sourceMaterializationCoverageHashDomain = "nimi.realm.materialization-coverage/v1\x00"
	sourceMaterializationContextHashDomain  = "nimi.realm.materialization-context/v1\x00"
	sourceMaterializationPayloadHashDomain  = "nimi.realm.materialization-payload/v2\x00"
	sourceMaterializationManifestHashDomain = "nimi.realm.materialization-bundle-manifest/v1\x00"
	sourceMaterializationPacketHashDomain   = "nimi.realm.source-materialization-packet/v2\x00"
	sourceMaterializationProofDomain        = "nimi.realm.source-materialization-proof/v2\x00"
	sourceMaterializationSnapshotHashDomain = "nimi.runtime.local-agent-source-snapshot/v1\x00"
	sourceMaterializationMaxSafeInteger     = uint64(1<<53 - 1)
)

type sourceMaterializationSourceRefV2 struct {
	Kind              string `json:"kind"`
	WorldID           string `json:"worldId"`
	SourceID          string `json:"sourceId"`
	SourceContentHash string `json:"sourceContentHash"`
}

type sourceMaterializationLimitsV2 struct {
	MaxBundleBytes    uint64 `json:"maxBundleBytes"`
	MaxComponentCount uint32 `json:"maxComponentCount"`
	MaxChunkBytes     uint64 `json:"maxChunkBytes"`
	MaxChunks         uint32 `json:"maxChunks"`
}

type sourceMaterializationPacketEnvelopeV2 struct {
	PacketSchemaVersion     string                           `json:"packetSchemaVersion"`
	PacketID                string                           `json:"packetId"`
	Issuer                  string                           `json:"issuer"`
	KeyID                   string                           `json:"keyId"`
	Algorithm               string                           `json:"algorithm"`
	KeyUse                  string                           `json:"keyUse"`
	IssuedAt                string                           `json:"issuedAt"`
	ExpiresAt               string                           `json:"expiresAt"`
	Nonce                   string                           `json:"nonce"`
	IntendedRuntimeAudience string                           `json:"intendedRuntimeAudience"`
	ChallengeID             string                           `json:"challengeId"`
	ChallengeDigest         string                           `json:"challengeDigest"`
	ChallengeLimits         sourceMaterializationLimitsV2    `json:"challengeLimits"`
	MaterializerAccountID   string                           `json:"materializerAccountId"`
	SourceRef               sourceMaterializationSourceRefV2 `json:"sourceRef"`
	PayloadHash             string                           `json:"payloadHash"`
	BundleManifestHash      string                           `json:"bundleManifestHash"`
}

type sourceMaterializationManifestComponentV1 struct {
	ComponentID         string `json:"componentId"`
	Kind                string `json:"kind"`
	SchemaVersion       string `json:"schemaVersion"`
	Revision            uint64 `json:"revision"`
	ContentHash         string `json:"contentHash"`
	CanonicalBytesHash  string `json:"canonicalBytesHash"`
	CanonicalByteLength uint64 `json:"canonicalByteLength"`
}

type sourceMaterializationManifestChunkV1 struct {
	GlobalOrdinal   uint32 `json:"globalOrdinal"`
	ComponentOffset uint64 `json:"componentOffset"`
	Length          uint64 `json:"length"`
	ChunkSHA256     string `json:"chunkSha256"`
}

type sourceMaterializationBundleManifestValueV1 struct {
	ManifestSchemaVersion  string                                     `json:"manifestSchemaVersion"`
	PayloadAssemblyVersion string                                     `json:"payloadAssemblyVersion"`
	PacketID               string                                     `json:"packetId"`
	ChallengeDigest        string                                     `json:"challengeDigest"`
	TotalCanonicalBytes    uint64                                     `json:"totalCanonicalBytes"`
	ComponentCount         uint32                                     `json:"componentCount"`
	ChunkCount             uint32                                     `json:"chunkCount"`
	Components             []sourceMaterializationManifestComponentV1 `json:"components"`
	Chunks                 []sourceMaterializationManifestChunkV1     `json:"chunks"`
}

// sourceMaterializationBeginExpectationsV2 is a value-only validation input.
// Durable challenge ownership and transitions remain in the transport layer.
type sourceMaterializationBeginExpectationsV2 struct {
	MaterializerAccountID   string
	ChallengeID             string
	IntendedRuntimeAudience string
	ChallengeDigest         string
	SourceRef               *runtimev1.SourceMaterializationSourceRef
	Limits                  *runtimev1.SourceMaterializationChallengeLimits
	ExpiresAt               time.Time
}

type verifiedSourceMaterializationBeginV2 struct {
	Envelope           sourceMaterializationPacketEnvelopeV2
	Manifest           sourceMaterializationBundleManifestValueV1
	PacketHash         string
	BundleManifestHash string
	PacketProof        string
	KeyFingerprint     string
}

func sourceMaterializationInvalid(format string, args ...any) error {
	return status.Errorf(codes.InvalidArgument, "source materialization v2: "+format, args...)
}

func sourceMaterializationDenied(format string, args ...any) error {
	return status.Errorf(codes.PermissionDenied, "source materialization v2: "+format, args...)
}

func isLowerSHA256(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	for _, r := range value {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			return false
		}
	}
	return true
}

func requireMaterializationText(value string, field string) error {
	if strings.TrimSpace(value) == "" || value != strings.TrimSpace(value) {
		return sourceMaterializationInvalid("%s must be a non-empty trimmed string", field)
	}
	return nil
}

func requireMaterializationDigest(value string, field string) error {
	if !isLowerSHA256(value) {
		return sourceMaterializationInvalid("%s must be a lowercase SHA-256 digest", field)
	}
	return nil
}

func canonicalRealmInstant(value time.Time, field string) (string, error) {
	value = value.UTC()
	if value.IsZero() || value.Nanosecond()%int(time.Millisecond) != 0 {
		return "", sourceMaterializationInvalid("%s must be a millisecond UTC instant", field)
	}
	return value.Format("2006-01-02T15:04:05.000Z"), nil
}

func sourceKindFromProto(value runtimev1.AgentSourceMaterializationSourceKind) (string, error) {
	switch value {
	case runtimev1.AgentSourceMaterializationSourceKind_AGENT_SOURCE_MATERIALIZATION_SOURCE_KIND_WORLD_CHARACTER:
		return "worldCharacter", nil
	case runtimev1.AgentSourceMaterializationSourceKind_AGENT_SOURCE_MATERIALIZATION_SOURCE_KIND_REALM_PERSONA:
		return "realmPersona", nil
	default:
		return "", sourceMaterializationInvalid("sourceRef.kind is not admitted")
	}
}

func componentKindFromProto(value runtimev1.AgentSourceMaterializationComponentKind) (string, error) {
	switch value {
	case runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_WORLD_CHARACTER:
		return "worldCharacter", nil
	case runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_REALM_PERSONA:
		return "realmPersona", nil
	case runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_WORLD_CORE:
		return "worldCore", nil
	case runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_WORLD_ENTITY:
		return "worldEntity", nil
	case runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_WORLD_RELATIONSHIP:
		return "worldRelationship", nil
	case runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_COVERAGE_MANIFEST:
		return "coverageManifest", nil
	default:
		return "", sourceMaterializationInvalid("manifest component kind is not admitted")
	}
}

func sourceRefFromProto(value *runtimev1.SourceMaterializationSourceRef) (sourceMaterializationSourceRefV2, error) {
	if value == nil {
		return sourceMaterializationSourceRefV2{}, sourceMaterializationInvalid("sourceRef is required")
	}
	kind, err := sourceKindFromProto(value.GetKind())
	if err != nil {
		return sourceMaterializationSourceRefV2{}, err
	}
	result := sourceMaterializationSourceRefV2{
		Kind: kind, WorldID: value.GetWorldId(), SourceID: value.GetSourceId(), SourceContentHash: value.GetSourceContentHash(),
	}
	if err := requireMaterializationText(result.WorldID, "sourceRef.worldId"); err != nil {
		return sourceMaterializationSourceRefV2{}, err
	}
	if err := requireMaterializationText(result.SourceID, "sourceRef.sourceId"); err != nil {
		return sourceMaterializationSourceRefV2{}, err
	}
	if err := requireMaterializationDigest(result.SourceContentHash, "sourceRef.sourceContentHash"); err != nil {
		return sourceMaterializationSourceRefV2{}, err
	}
	return result, nil
}

func limitsFromProto(value *runtimev1.SourceMaterializationChallengeLimits) (sourceMaterializationLimitsV2, error) {
	if value == nil {
		return sourceMaterializationLimitsV2{}, sourceMaterializationInvalid("challengeLimits are required")
	}
	result := sourceMaterializationLimitsV2{
		MaxBundleBytes: value.GetMaxBundleBytes(), MaxComponentCount: value.GetMaxComponentCount(), MaxChunkBytes: value.GetMaxChunkBytes(), MaxChunks: value.GetMaxChunks(),
	}
	if result.MaxBundleBytes == 0 || result.MaxComponentCount == 0 || result.MaxChunkBytes == 0 || result.MaxChunks == 0 {
		return sourceMaterializationLimitsV2{}, sourceMaterializationInvalid("challengeLimits must be positive")
	}
	if result.MaxBundleBytes > sourceMaterializationMaxSafeInteger || result.MaxChunkBytes > sourceMaterializationMaxSafeInteger {
		return sourceMaterializationLimitsV2{}, sourceMaterializationInvalid("challengeLimits exceed the committed JSON safe-integer range")
	}
	return result, nil
}

func envelopeFromProto(value *runtimev1.SourceMaterializationPacketEnvelopeV2) (sourceMaterializationPacketEnvelopeV2, string, error) {
	if value == nil {
		return sourceMaterializationPacketEnvelopeV2{}, "", sourceMaterializationInvalid("packetEnvelope is required")
	}
	if value.GetPacketSchemaVersion() != runtimev1.AgentSourceMaterializationPacketSchemaVersion_AGENT_SOURCE_MATERIALIZATION_PACKET_SCHEMA_VERSION_V2 {
		return sourceMaterializationPacketEnvelopeV2{}, "", sourceMaterializationInvalid("packetEnvelope.packetSchemaVersion is not v2")
	}
	if value.GetAlgorithm() != runtimev1.AgentSourceMaterializationProofAlgorithm_AGENT_SOURCE_MATERIALIZATION_PROOF_ALGORITHM_RS256 {
		return sourceMaterializationPacketEnvelopeV2{}, "", sourceMaterializationInvalid("packetEnvelope.algorithm is not RS256")
	}
	if value.GetKeyUse() != runtimev1.AgentSourceMaterializationKeyUse_AGENT_SOURCE_MATERIALIZATION_KEY_USE_SIG {
		return sourceMaterializationPacketEnvelopeV2{}, "", sourceMaterializationInvalid("packetEnvelope.keyUse is not sig")
	}
	if value.GetIssuedAt() == nil || value.GetExpiresAt() == nil {
		return sourceMaterializationPacketEnvelopeV2{}, "", sourceMaterializationInvalid("packetEnvelope issuedAt/expiresAt are required")
	}
	if err := value.GetIssuedAt().CheckValid(); err != nil {
		return sourceMaterializationPacketEnvelopeV2{}, "", sourceMaterializationInvalid("packetEnvelope.issuedAt is invalid")
	}
	if err := value.GetExpiresAt().CheckValid(); err != nil {
		return sourceMaterializationPacketEnvelopeV2{}, "", sourceMaterializationInvalid("packetEnvelope.expiresAt is invalid")
	}
	issuedAt, err := canonicalRealmInstant(value.GetIssuedAt().AsTime(), "packetEnvelope.issuedAt")
	if err != nil {
		return sourceMaterializationPacketEnvelopeV2{}, "", err
	}
	expiresAt, err := canonicalRealmInstant(value.GetExpiresAt().AsTime(), "packetEnvelope.expiresAt")
	if err != nil {
		return sourceMaterializationPacketEnvelopeV2{}, "", err
	}
	ref, err := sourceRefFromProto(value.GetSourceRef())
	if err != nil {
		return sourceMaterializationPacketEnvelopeV2{}, "", err
	}
	limits, err := limitsFromProto(value.GetChallengeLimits())
	if err != nil {
		return sourceMaterializationPacketEnvelopeV2{}, "", err
	}
	result := sourceMaterializationPacketEnvelopeV2{
		PacketSchemaVersion: sourceMaterializationPacketV2SchemaVersion,
		PacketID:            value.GetPacketId(), Issuer: value.GetIssuer(), KeyID: value.GetKeyId(), Algorithm: "RS256", KeyUse: "sig",
		IssuedAt: issuedAt, ExpiresAt: expiresAt, Nonce: value.GetNonce(), IntendedRuntimeAudience: value.GetIntendedRuntimeAudience(),
		ChallengeID: value.GetChallengeId(), ChallengeDigest: value.GetChallengeDigest(), ChallengeLimits: limits,
		MaterializerAccountID: value.GetMaterializerAccountId(), SourceRef: ref, PayloadHash: value.GetPayloadHash(), BundleManifestHash: value.GetBundleManifestHash(),
	}
	for field, text := range map[string]string{
		"packetEnvelope.packetId": result.PacketID, "packetEnvelope.issuer": result.Issuer, "packetEnvelope.keyId": result.KeyID,
		"packetEnvelope.nonce": result.Nonce, "packetEnvelope.intendedRuntimeAudience": result.IntendedRuntimeAudience,
		"packetEnvelope.challengeId": result.ChallengeID, "packetEnvelope.materializerAccountId": result.MaterializerAccountID,
	} {
		if err := requireMaterializationText(text, field); err != nil {
			return sourceMaterializationPacketEnvelopeV2{}, "", err
		}
	}
	for field, digest := range map[string]string{
		"packetEnvelope.challengeDigest": result.ChallengeDigest, "packetEnvelope.payloadHash": result.PayloadHash,
		"packetEnvelope.bundleManifestHash": result.BundleManifestHash, "packetEnvelope.packetHash": value.GetPacketHash(),
	} {
		if err := requireMaterializationDigest(digest, field); err != nil {
			return sourceMaterializationPacketEnvelopeV2{}, "", err
		}
	}
	return result, value.GetPacketHash(), nil
}

func manifestFromProto(value *runtimev1.BundleTransportManifestV1) (sourceMaterializationBundleManifestValueV1, error) {
	if value == nil {
		return sourceMaterializationBundleManifestValueV1{}, sourceMaterializationInvalid("bundleTransportManifest is required")
	}
	if value.GetManifestSchemaVersion() != runtimev1.AgentSourceMaterializationBundleManifestSchemaVersion_AGENT_SOURCE_MATERIALIZATION_BUNDLE_MANIFEST_SCHEMA_VERSION_V1 {
		return sourceMaterializationBundleManifestValueV1{}, sourceMaterializationInvalid("manifest schema version is not v1")
	}
	if value.GetPayloadAssemblyVersion() != runtimev1.AgentSourceMaterializationPayloadAssemblyVersion_AGENT_SOURCE_MATERIALIZATION_PAYLOAD_ASSEMBLY_VERSION_V1 {
		return sourceMaterializationBundleManifestValueV1{}, sourceMaterializationInvalid("payload assembly version is not v1")
	}
	result := sourceMaterializationBundleManifestValueV1{
		ManifestSchemaVersion:  sourceMaterializationBundleManifestV1,
		PayloadAssemblyVersion: sourceMaterializationAssemblyV1,
		PacketID:               value.GetPacketId(), ChallengeDigest: value.GetChallengeDigest(), TotalCanonicalBytes: value.GetTotalCanonicalBytes(),
		ComponentCount: value.GetComponentCount(), ChunkCount: value.GetChunkCount(),
		Components: make([]sourceMaterializationManifestComponentV1, 0, len(value.GetComponents())),
		Chunks:     make([]sourceMaterializationManifestChunkV1, 0, len(value.GetChunks())),
	}
	for index, component := range value.GetComponents() {
		if component == nil {
			return sourceMaterializationBundleManifestValueV1{}, sourceMaterializationInvalid("manifest.components[%d] is required", index)
		}
		kind, err := componentKindFromProto(component.GetKind())
		if err != nil {
			return sourceMaterializationBundleManifestValueV1{}, err
		}
		result.Components = append(result.Components, sourceMaterializationManifestComponentV1{
			ComponentID: component.GetComponentId(), Kind: kind, SchemaVersion: component.GetSchemaVersion(), Revision: component.GetRevision(),
			ContentHash: component.GetContentHash(), CanonicalBytesHash: component.GetCanonicalBytesHash(), CanonicalByteLength: component.GetCanonicalByteLength(),
		})
	}
	for index, chunk := range value.GetChunks() {
		if chunk == nil {
			return sourceMaterializationBundleManifestValueV1{}, sourceMaterializationInvalid("manifest.chunks[%d] is required", index)
		}
		result.Chunks = append(result.Chunks, sourceMaterializationManifestChunkV1{
			GlobalOrdinal: chunk.GetGlobalOrdinal(), ComponentOffset: chunk.GetComponentOffset(), Length: chunk.GetLength(), ChunkSHA256: chunk.GetChunkSha256(),
		})
	}
	return result, nil
}

func validateSourceMaterializationManifestV1(manifest sourceMaterializationBundleManifestValueV1, envelope sourceMaterializationPacketEnvelopeV2) error {
	if err := requireMaterializationText(manifest.PacketID, "manifest.packetId"); err != nil {
		return err
	}
	if err := requireMaterializationDigest(manifest.ChallengeDigest, "manifest.challengeDigest"); err != nil {
		return err
	}
	if manifest.PacketID != envelope.PacketID || manifest.ChallengeDigest != envelope.ChallengeDigest {
		return sourceMaterializationInvalid("manifest packet/challenge binding mismatch")
	}
	if manifest.ComponentCount == 0 || int(manifest.ComponentCount) != len(manifest.Components) {
		return sourceMaterializationInvalid("manifest componentCount does not match components")
	}
	if manifest.ChunkCount == 0 || int(manifest.ChunkCount) != len(manifest.Chunks) {
		return sourceMaterializationInvalid("manifest chunkCount does not match chunks")
	}
	limits := envelope.ChallengeLimits
	if manifest.TotalCanonicalBytes == 0 || manifest.TotalCanonicalBytes > limits.MaxBundleBytes {
		return sourceMaterializationInvalid("manifest exceeds maxBundleBytes")
	}
	if manifest.ComponentCount > limits.MaxComponentCount {
		return sourceMaterializationInvalid("manifest exceeds maxComponentCount")
	}
	if manifest.ChunkCount > limits.MaxChunks {
		return sourceMaterializationInvalid("manifest exceeds maxChunks")
	}
	seenIDs := make(map[string]struct{}, len(manifest.Components))
	var total uint64
	var sourceCount, worldCount, coverageCount int
	for index, component := range manifest.Components {
		if err := requireMaterializationText(component.ComponentID, fmt.Sprintf("manifest.components[%d].componentId", index)); err != nil {
			return err
		}
		if _, exists := seenIDs[component.ComponentID]; exists {
			return sourceMaterializationInvalid("manifest componentId %q is duplicated", component.ComponentID)
		}
		seenIDs[component.ComponentID] = struct{}{}
		if err := requireMaterializationText(component.SchemaVersion, fmt.Sprintf("manifest.components[%d].schemaVersion", index)); err != nil {
			return err
		}
		if component.Revision == 0 || component.CanonicalByteLength == 0 || component.Revision > sourceMaterializationMaxSafeInteger || component.CanonicalByteLength > sourceMaterializationMaxSafeInteger {
			return sourceMaterializationInvalid("manifest.components[%d] revision and length must be positive", index)
		}
		if err := requireMaterializationDigest(component.ContentHash, fmt.Sprintf("manifest.components[%d].contentHash", index)); err != nil {
			return err
		}
		if err := requireMaterializationDigest(component.CanonicalBytesHash, fmt.Sprintf("manifest.components[%d].canonicalBytesHash", index)); err != nil {
			return err
		}
		expectedSchema := map[string]string{
			"worldCharacter": "realm.world-character-core/v1", "realmPersona": "realm.persona/v1", "worldCore": "realm.world-core/v1",
			"worldEntity": "realm.world-entity-core/v1", "worldRelationship": "realm.world-relationship-core/v1", "coverageManifest": sourceMaterializationCoverageV1,
		}[component.Kind]
		if expectedSchema == "" || component.SchemaVersion != expectedSchema {
			return sourceMaterializationInvalid("manifest.components[%d] kind/schema mismatch", index)
		}
		switch component.Kind {
		case envelope.SourceRef.Kind:
			sourceCount++
		case "worldCharacter", "realmPersona":
			return sourceMaterializationInvalid("manifest contains source kind different from sourceRef")
		case "worldCore":
			worldCount++
		case "coverageManifest":
			coverageCount++
		}
		if math.MaxUint64-total < component.CanonicalByteLength {
			return sourceMaterializationInvalid("manifest total canonical bytes overflows")
		}
		total += component.CanonicalByteLength
	}
	if sourceCount != 1 || worldCount != 1 || coverageCount != 1 {
		return sourceMaterializationInvalid("manifest requires exactly one source, world, and coverage component")
	}
	if manifest.Components[0].Kind != envelope.SourceRef.Kind || manifest.Components[len(manifest.Components)-1].Kind != "coverageManifest" {
		return sourceMaterializationInvalid("manifest component order is not canonical")
	}
	if total != manifest.TotalCanonicalBytes {
		return sourceMaterializationInvalid("manifest totalCanonicalBytes mismatch")
	}
	chunkIndex := 0
	for componentIndex, component := range manifest.Components {
		var expectedOffset uint64
		for expectedOffset < component.CanonicalByteLength {
			if chunkIndex >= len(manifest.Chunks) {
				return sourceMaterializationInvalid("manifest component %q has missing chunks", component.ComponentID)
			}
			chunk := manifest.Chunks[chunkIndex]
			if chunk.GlobalOrdinal != uint32(chunkIndex) || chunk.ComponentOffset != expectedOffset {
				return sourceMaterializationInvalid("manifest chunk %d ordinal/offset mismatch for component %d", chunkIndex, componentIndex)
			}
			if chunk.Length == 0 || chunk.Length > sourceMaterializationMaxSafeInteger || chunk.ComponentOffset > sourceMaterializationMaxSafeInteger || chunk.Length > limits.MaxChunkBytes || chunk.Length > component.CanonicalByteLength-expectedOffset {
				return sourceMaterializationInvalid("manifest chunk %d length is invalid", chunkIndex)
			}
			if err := requireMaterializationDigest(chunk.ChunkSHA256, fmt.Sprintf("manifest.chunks[%d].chunkSha256", chunkIndex)); err != nil {
				return err
			}
			expectedOffset += chunk.Length
			chunkIndex++
		}
	}
	if chunkIndex != len(manifest.Chunks) {
		return sourceMaterializationInvalid("manifest has unbound trailing chunks")
	}
	return nil
}

func verifySourceMaterializationBeginControlV2(
	ctx context.Context,
	control *runtimev1.SourceMaterializationBeginControl,
	expected sourceMaterializationBeginExpectationsV2,
	now time.Time,
	jwks sourceMaterializationJWKSProvider,
) (*verifiedSourceMaterializationBeginV2, error) {
	if control == nil {
		return nil, sourceMaterializationInvalid("begin control is required")
	}
	envelope, packetHash, err := envelopeFromProto(control.GetPacketEnvelope())
	if err != nil {
		return nil, err
	}
	manifest, err := manifestFromProto(control.GetBundleTransportManifest())
	if err != nil {
		return nil, err
	}
	if err := validateSourceMaterializationManifestV1(manifest, envelope); err != nil {
		return nil, err
	}
	expectedRef, err := sourceRefFromProto(expected.SourceRef)
	if err != nil {
		return nil, err
	}
	expectedLimits, err := limitsFromProto(expected.Limits)
	if err != nil {
		return nil, err
	}
	if envelope.MaterializerAccountID != expected.MaterializerAccountID {
		return nil, sourceMaterializationDenied("materializer account binding mismatch")
	}
	if envelope.ChallengeID != expected.ChallengeID || envelope.ChallengeDigest != expected.ChallengeDigest {
		return nil, sourceMaterializationDenied("challenge binding mismatch")
	}
	if envelope.IntendedRuntimeAudience != expected.IntendedRuntimeAudience {
		return nil, sourceMaterializationDenied("runtime audience binding mismatch")
	}
	if envelope.SourceRef != expectedRef {
		return nil, sourceMaterializationDenied("source binding mismatch")
	}
	if envelope.ChallengeLimits != expectedLimits {
		return nil, sourceMaterializationDenied("challenge limits binding mismatch")
	}
	envelopeExpiry, _ := time.Parse(time.RFC3339Nano, envelope.ExpiresAt)
	if expected.ExpiresAt.IsZero() || envelopeExpiry.After(expected.ExpiresAt.UTC()) {
		return nil, sourceMaterializationDenied("packet expiry exceeds challenge expiry")
	}
	issuedAt, _ := time.Parse(time.RFC3339Nano, envelope.IssuedAt)
	if !issuedAt.Before(envelopeExpiry) || now.UTC().Before(issuedAt) || !now.UTC().Before(envelopeExpiry) {
		return nil, sourceMaterializationDenied("packet issuance window is invalid or expired")
	}
	computedManifestHash, err := hashSourceMaterializationDomainJCS(sourceMaterializationManifestHashDomain, manifest)
	if err != nil {
		return nil, sourceMaterializationInvalid("manifest hash failed: %v", err)
	}
	if computedManifestHash != envelope.BundleManifestHash {
		return nil, sourceMaterializationDenied("bundle manifest hash mismatch")
	}
	computedPacketHash, err := hashSourceMaterializationDomainJCS(sourceMaterializationPacketHashDomain, envelope)
	if err != nil {
		return nil, sourceMaterializationInvalid("packet hash failed: %v", err)
	}
	if computedPacketHash != packetHash {
		return nil, sourceMaterializationDenied("packet hash mismatch")
	}
	keyFingerprint, err := verifySourceMaterializationDetachedProof(ctx, jwks, envelope, packetHash, control.GetPacketProof(), now.UTC())
	if err != nil {
		return nil, err
	}
	return &verifiedSourceMaterializationBeginV2{
		Envelope: envelope, Manifest: manifest, PacketHash: packetHash, BundleManifestHash: computedManifestHash,
		PacketProof: control.GetPacketProof(), KeyFingerprint: keyFingerprint,
	}, nil
}
