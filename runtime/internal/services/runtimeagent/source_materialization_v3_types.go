package runtimeagent

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"time"
)

const (
	sourceMaterializationPacketV3SchemaVersion        = "realm.source-materialization-packet/v3"
	sourceMaterializationPayloadV3SchemaVersion       = "realm.source-materialization-payload/v3"
	sourceMaterializationAssemblyV3                   = "realm.materialization-assembly/v3"
	sourceMaterializationContextV3                    = "realm.materialization-context/v3"
	sourceMaterializationClosurePolicyV3              = "realm.materialization-closure/v3"
	sourceMaterializationCoverageV3                   = "realm.materialization-coverage/v3"
	sourceMaterializationSegmentManifestV3            = "realm.materialization-segment-manifest/v3"
	sourceMaterializationClosureSetManifestV3         = "realm.materialization-closure-set-manifest/v3"
	sourceMaterializationProofDomainV3                = "nimi.realm.source-materialization-proof/v3\x00"
	sourceMaterializationPacketHashDomainV3           = "nimi.realm.source-materialization-packet/v3\x00"
	sourceMaterializationPayloadHashDomainV3          = "nimi.realm.materialization-payload/v3\x00"
	sourceMaterializationCoverageHashDomainV3         = "nimi.realm.materialization-coverage/v3\x00"
	sourceMaterializationContextHashDomainV3          = "nimi.realm.materialization-context/v3\x00"
	sourceMaterializationSegmentManifestHashDomainV3  = "nimi.realm.materialization-segment-manifest/v3\x00"
	sourceMaterializationComponentSetHashDomainV3     = "nimi.realm.materialization-component-set/v3\x00"
	sourceMaterializationClosureSetHashDomainV3       = "nimi.realm.materialization-closure-set-manifest/v3\x00"
	sourceMaterializationWorldCharacterHashDomainV3   = "nimi.realm.world-character-source/v1\x00"
	sourceMaterializationPersonaCharacterHashDomainV3 = "nimi.realm.persona-character-source/v1\x00"

	sourceMaterializationPacketContentTypeV3 = "application/json"
	sourceMaterializationJWKSMaxBytesV3      = 64 * 1024
	sourceMaterializationMaxTextBytesV3      = 4096
	sourceMaterializationMaxProofBytesV3     = 16 * 1024
	maxSourceMaterializationWireBytesV3      = 512 * 1024 * 1024
)

var sourceMaterializationProducerCeilingsV3 = sourceMaterializationPublishedLimitsV3{
	MaxSegmentBytes:          8 * 1024 * 1024,
	MaxSegmentComponentCount: 256,
	MaxChunkBytes:            256 * 1024,
	MaxSegmentChunks:         4096,
	MaxSetSegments:           64,
	MaxSetBytes:              128 * 1024 * 1024,
	MaxSetComponentCount:     16384,
	MaxSetChunks:             65536,
}

type sourceMaterializationFailureCodeV3 string

const (
	sourceMaterializationFailureInvalidRequestV3    sourceMaterializationFailureCodeV3 = "invalid_request"
	sourceMaterializationFailureRequestConflictV3   sourceMaterializationFailureCodeV3 = "request_conflict"
	sourceMaterializationFailureAccountBindingV3    sourceMaterializationFailureCodeV3 = "account_binding_mismatch"
	sourceMaterializationFailureSourceBindingV3     sourceMaterializationFailureCodeV3 = "source_binding_mismatch"
	sourceMaterializationFailureAudienceV3          sourceMaterializationFailureCodeV3 = "audience_mismatch"
	sourceMaterializationFailureChallengeDigestV3   sourceMaterializationFailureCodeV3 = "challenge_digest_mismatch"
	sourceMaterializationFailurePacketExpiredV3     sourceMaterializationFailureCodeV3 = "packet_expired"
	sourceMaterializationFailureCapacityV3          sourceMaterializationFailureCodeV3 = "capacity_exceeded"
	sourceMaterializationFailurePacketContractV3    sourceMaterializationFailureCodeV3 = "invalid_packet_contract"
	sourceMaterializationFailureCurrentKeyV3        sourceMaterializationFailureCodeV3 = "current_key_not_found"
	sourceMaterializationFailureProofV3             sourceMaterializationFailureCodeV3 = "detached_jws_signature_invalid"
	sourceMaterializationFailureReplayV3            sourceMaterializationFailureCodeV3 = "replay_binding_rejected"
	sourceMaterializationFailureAcquisitionDeniedV3 sourceMaterializationFailureCodeV3 = "acquisition_denied"
	sourceMaterializationFailureIssuerUnavailableV3 sourceMaterializationFailureCodeV3 = "issuer_unavailable"
	sourceMaterializationFailureCommitInProgressV3  sourceMaterializationFailureCodeV3 = "commit_in_progress"
	sourceMaterializationFailurePersistenceV3       sourceMaterializationFailureCodeV3 = "persistence_failed"
	sourceMaterializationFailureCleanupV3           sourceMaterializationFailureCodeV3 = "cleanup_failed"
	sourceMaterializationFailureAbortedV3           sourceMaterializationFailureCodeV3 = "aborted"
	sourceMaterializationFailureExpiredV3           sourceMaterializationFailureCodeV3 = "expired"
)

type sourceMaterializationErrorV3 struct {
	code sourceMaterializationFailureCodeV3
	err  error
}

func (e *sourceMaterializationErrorV3) Error() string {
	if e == nil || e.err == nil {
		return "source materialization v3 failed"
	}
	return "source materialization v3: " + e.err.Error()
}

func (e *sourceMaterializationErrorV3) Unwrap() error { return e.err }

func sourceMaterializationV3Error(code sourceMaterializationFailureCodeV3, format string, args ...any) error {
	return &sourceMaterializationErrorV3{code: code, err: fmt.Errorf(format, args...)}
}

func sourceMaterializationV3FailureCode(err error) sourceMaterializationFailureCodeV3 {
	var typed *sourceMaterializationErrorV3
	if errors.As(err, &typed) {
		return typed.code
	}
	return sourceMaterializationFailurePacketContractV3
}

type sourceMaterializationPublishedLimitsV3 struct {
	MaxSegmentBytes          uint64 `json:"maxSegmentBytes"`
	MaxSegmentComponentCount uint64 `json:"maxSegmentComponentCount"`
	MaxChunkBytes            uint64 `json:"maxChunkBytes"`
	MaxSegmentChunks         uint64 `json:"maxSegmentChunks"`
	MaxSetSegments           uint64 `json:"maxSetSegments"`
	MaxSetBytes              uint64 `json:"maxSetBytes"`
	MaxSetComponentCount     uint64 `json:"maxSetComponentCount"`
	MaxSetChunks             uint64 `json:"maxSetChunks"`
}

func (l sourceMaterializationPublishedLimitsV3) validate() error {
	values := []struct {
		name    string
		value   uint64
		ceiling uint64
	}{
		{"maxSegmentBytes", l.MaxSegmentBytes, sourceMaterializationProducerCeilingsV3.MaxSegmentBytes},
		{"maxSegmentComponentCount", l.MaxSegmentComponentCount, sourceMaterializationProducerCeilingsV3.MaxSegmentComponentCount},
		{"maxChunkBytes", l.MaxChunkBytes, sourceMaterializationProducerCeilingsV3.MaxChunkBytes},
		{"maxSegmentChunks", l.MaxSegmentChunks, sourceMaterializationProducerCeilingsV3.MaxSegmentChunks},
		{"maxSetSegments", l.MaxSetSegments, sourceMaterializationProducerCeilingsV3.MaxSetSegments},
		{"maxSetBytes", l.MaxSetBytes, sourceMaterializationProducerCeilingsV3.MaxSetBytes},
		{"maxSetComponentCount", l.MaxSetComponentCount, sourceMaterializationProducerCeilingsV3.MaxSetComponentCount},
		{"maxSetChunks", l.MaxSetChunks, sourceMaterializationProducerCeilingsV3.MaxSetChunks},
	}
	for _, item := range values {
		if item.value == 0 || item.value > item.ceiling || item.value > uint64(1<<53-1) {
			return sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "%s is outside the admitted range", item.name)
		}
	}
	if l.MaxChunkBytes > l.MaxSegmentBytes || l.MaxSegmentBytes > l.MaxSetBytes ||
		l.MaxSegmentComponentCount > l.MaxSetComponentCount || l.MaxSegmentChunks > l.MaxSetChunks {
		return sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "published limits are internally inconsistent")
	}
	return nil
}

func (l sourceMaterializationPublishedLimitsV3) segmentLimits() sourceMaterializationSegmentLimitsV3 {
	return sourceMaterializationSegmentLimitsV3{
		MaxSegmentBytes: l.MaxSegmentBytes, MaxSegmentComponentCount: l.MaxSegmentComponentCount,
		MaxChunkBytes: l.MaxChunkBytes, MaxSegmentChunks: l.MaxSegmentChunks,
	}
}

type sourceMaterializationSegmentLimitsV3 struct {
	MaxSegmentBytes          uint64 `json:"maxSegmentBytes"`
	MaxSegmentComponentCount uint64 `json:"maxSegmentComponentCount"`
	MaxChunkBytes            uint64 `json:"maxChunkBytes"`
	MaxSegmentChunks         uint64 `json:"maxSegmentChunks"`
}

type sourceMaterializationWorldEntityRefV3 struct {
	Kind     string `json:"kind"`
	WorldID  string `json:"worldId"`
	EntityID string `json:"entityId"`
}

type sourceMaterializationCharacterSourceRefV3 struct {
	Kind           string                                 `json:"kind"`
	ID             string                                 `json:"id"`
	WorldID        string                                 `json:"worldId"`
	WorldEntityRef *sourceMaterializationWorldEntityRefV3 `json:"worldEntityRef,omitempty"`
	OwnerAccountID string                                 `json:"ownerAccountId,omitempty"`
	SourceHash     string                                 `json:"sourceHash"`
}

func (r sourceMaterializationCharacterSourceRefV3) validate() error {
	for field, value := range map[string]string{"kind": r.Kind, "id": r.ID, "worldId": r.WorldID} {
		if err := requireSourceMaterializationV3Text(value, "sourceRef."+field); err != nil {
			return err
		}
	}
	if !isLowerSHA256V3(r.SourceHash) {
		return sourceMaterializationV3Error(sourceMaterializationFailureInvalidRequestV3, "sourceRef.sourceHash is invalid")
	}
	switch r.Kind {
	case "worldCharacter":
		if r.WorldEntityRef == nil || r.OwnerAccountID != "" || r.WorldEntityRef.Kind != "worldEntity" ||
			r.WorldEntityRef.WorldID != r.WorldID {
			return sourceMaterializationV3Error(sourceMaterializationFailureInvalidRequestV3, "worldCharacter sourceRef is invalid")
		}
		if err := requireSourceMaterializationV3Text(r.WorldEntityRef.EntityID, "sourceRef.worldEntityRef.entityId"); err != nil {
			return err
		}
	case "personaCharacter":
		if r.WorldEntityRef != nil {
			return sourceMaterializationV3Error(sourceMaterializationFailureInvalidRequestV3, "personaCharacter sourceRef is invalid")
		}
		if err := requireSourceMaterializationV3Text(r.OwnerAccountID, "sourceRef.ownerAccountId"); err != nil {
			return err
		}
	default:
		return sourceMaterializationV3Error(sourceMaterializationFailureInvalidRequestV3, "sourceRef.kind is not admitted")
	}
	return nil
}

type sourceMaterializationChallengeV3 struct {
	ChallengeID             string
	ChallengeDigest         string
	IntendedRuntimeAudience string
	RuntimeInstanceID       string
	MaterializerAccountID   string
	RequestID               string
	IntentDigest            string
	SourceRef               sourceMaterializationCharacterSourceRefV3
	Limits                  sourceMaterializationPublishedLimitsV3
	IssuedAt                time.Time
	ExpiresAt               time.Time
}

type sourceMaterializationPacketProofV3 struct {
	CompactJWS    string `json:"compactJws"`
	SignedPayload string `json:"signedPayload"`
}

type sourceMaterializationManifestComponentV3 struct {
	GlobalComponentOrdinal uint64 `json:"globalComponentOrdinal"`
	ComponentID            string `json:"componentId"`
	Kind                   string `json:"kind"`
	SchemaVersion          string `json:"schemaVersion"`
	Revision               uint64 `json:"revision"`
	ContentHash            string `json:"contentHash"`
	CanonicalBytesHash     string `json:"canonicalBytesHash"`
	CanonicalByteLength    uint64 `json:"canonicalByteLength"`
}

type sourceMaterializationChunkDescriptorV3 struct {
	GlobalChunkOrdinal     uint64 `json:"globalChunkOrdinal"`
	GlobalComponentOrdinal uint64 `json:"globalComponentOrdinal"`
	ComponentOffset        uint64 `json:"componentOffset"`
	Length                 uint64 `json:"length"`
	ChunkSHA256            string `json:"chunkSha256"`
}

type sourceMaterializationSegmentManifestV3Value struct {
	ManifestSchemaVersion  string                                     `json:"manifestSchemaVersion"`
	PayloadAssemblyVersion string                                     `json:"payloadAssemblyVersion"`
	PacketID               string                                     `json:"packetId"`
	ChallengeDigest        string                                     `json:"challengeDigest"`
	SegmentOrdinal         uint64                                     `json:"segmentOrdinal"`
	FirstComponentOrdinal  uint64                                     `json:"firstComponentOrdinal"`
	LastComponentOrdinal   uint64                                     `json:"lastComponentOrdinal"`
	PublishedSegmentLimits sourceMaterializationSegmentLimitsV3       `json:"publishedSegmentLimits"`
	TotalCanonicalBytes    uint64                                     `json:"totalCanonicalBytes"`
	ComponentCount         uint64                                     `json:"componentCount"`
	ChunkCount             uint64                                     `json:"chunkCount"`
	Components             []sourceMaterializationManifestComponentV3 `json:"components"`
	Chunks                 []sourceMaterializationChunkDescriptorV3   `json:"chunks"`
}

type sourceMaterializationComponentV3 struct {
	ComponentID         string   `json:"componentId"`
	Kind                string   `json:"kind"`
	SchemaVersion       string   `json:"schemaVersion"`
	Revision            uint64   `json:"revision"`
	ContentHash         string   `json:"contentHash"`
	CanonicalBytesHash  string   `json:"canonicalBytesHash"`
	CanonicalByteLength uint64   `json:"canonicalByteLength"`
	CanonicalBytes      []string `json:"canonicalBytes"`
}

type sourceMaterializationSegmentV3Value struct {
	SegmentManifest     sourceMaterializationSegmentManifestV3Value `json:"segmentManifest"`
	SegmentManifestHash string                                      `json:"segmentManifestHash"`
	OrderedComponents   []sourceMaterializationComponentV3          `json:"orderedComponents"`
}

type sourceMaterializationClosureSetSegmentRefV3 struct {
	SegmentOrdinal        uint64 `json:"segmentOrdinal"`
	FirstComponentOrdinal uint64 `json:"firstComponentOrdinal"`
	LastComponentOrdinal  uint64 `json:"lastComponentOrdinal"`
	ComponentCount        uint64 `json:"componentCount"`
	TotalCanonicalBytes   uint64 `json:"totalCanonicalBytes"`
	ChunkCount            uint64 `json:"chunkCount"`
	SegmentManifestHash   string `json:"segmentManifestHash"`
}

type sourceMaterializationClosureSetManifestV3Value struct {
	ManifestSchemaVersion   string                                        `json:"manifestSchemaVersion"`
	PayloadAssemblyVersion  string                                        `json:"payloadAssemblyVersion"`
	PacketID                string                                        `json:"packetId"`
	ChallengeDigest         string                                        `json:"challengeDigest"`
	PublishedLimits         sourceMaterializationPublishedLimitsV3        `json:"publishedLimits"`
	OrderedComponentSetHash string                                        `json:"orderedComponentSetHash"`
	TotalCanonicalBytes     uint64                                        `json:"totalCanonicalBytes"`
	ComponentCount          uint64                                        `json:"componentCount"`
	ChunkCount              uint64                                        `json:"chunkCount"`
	SegmentCount            uint64                                        `json:"segmentCount"`
	Segments                []sourceMaterializationClosureSetSegmentRefV3 `json:"segments"`
}

type sourceMaterializationComponentDigestV3 struct {
	ComponentID string `json:"componentId"`
	Kind        string `json:"kind"`
	ContentHash string `json:"contentHash"`
}

type sourceMaterializationDependencyRefV3 struct {
	Kind        string `json:"kind"`
	WorldID     string `json:"worldId"`
	ID          string `json:"id"`
	ContentHash string `json:"contentHash"`
}

type sourceMaterializationOriginV3 struct {
	Kind              string  `json:"kind"`
	SourceID          *string `json:"sourceId,omitempty"`
	SourceVersion     *string `json:"sourceVersion,omitempty"`
	SourceContentHash *string `json:"sourceContentHash,omitempty"`
	ParentWorldID     *string `json:"parentWorldId,omitempty"`
	ParentCharacterID *string `json:"parentCharacterId,omitempty"`
}

type sourceMaterializationWorldRecordV3 struct {
	ID              string                         `json:"id"`
	SchemaVersion   string                         `json:"schemaVersion"`
	ContentRevision uint64                         `json:"contentRevision"`
	ContentHash     string                         `json:"contentHash"`
	Origin          sourceMaterializationOriginV3  `json:"origin"`
	CreatorID       *string                        `json:"creatorId"`
	Visibility      string                         `json:"visibility"`
	Core            sourceMaterializationJSONValue `json:"core"`
	CreatedAt       string                         `json:"createdAt"`
	UpdatedAt       string                         `json:"updatedAt"`
}

type sourceMaterializationEntityRecordV3 struct {
	ID              string                         `json:"id"`
	SchemaVersion   string                         `json:"schemaVersion"`
	ContentRevision uint64                         `json:"contentRevision"`
	ContentHash     string                         `json:"contentHash"`
	Origin          sourceMaterializationOriginV3  `json:"origin"`
	WorldID         string                         `json:"worldId"`
	Kind            string                         `json:"kind"`
	Core            sourceMaterializationJSONValue `json:"core"`
	CreatedAt       string                         `json:"createdAt"`
	UpdatedAt       string                         `json:"updatedAt"`
}

type sourceMaterializationRelationshipRecordV3 struct {
	ID              string                         `json:"id"`
	SchemaVersion   string                         `json:"schemaVersion"`
	ContentRevision uint64                         `json:"contentRevision"`
	ContentHash     string                         `json:"contentHash"`
	Origin          sourceMaterializationOriginV3  `json:"origin"`
	WorldID         string                         `json:"worldId"`
	SourceEntityID  string                         `json:"sourceEntityId"`
	TargetEntityID  string                         `json:"targetEntityId"`
	Type            string                         `json:"type"`
	Core            sourceMaterializationJSONValue `json:"core"`
	CreatedAt       string                         `json:"createdAt"`
	UpdatedAt       string                         `json:"updatedAt"`
}

type sourceMaterializationDependencyClosureV3Value struct {
	Kind                  string                                      `json:"kind"`
	BoundEntity           *sourceMaterializationEntityRecordV3        `json:"boundEntity,omitempty"`
	IncidentRelationships []sourceMaterializationRelationshipRecordV3 `json:"incidentRelationships,omitempty"`
	EndpointEntities      []sourceMaterializationEntityRecordV3       `json:"endpointEntities,omitempty"`
	ExplicitEntities      []sourceMaterializationEntityRecordV3       `json:"explicitEntities"`
	ExplicitRelationships []sourceMaterializationRelationshipRecordV3 `json:"explicitRelationships,omitempty"`
	ExplicitDependencies  []sourceMaterializationDependencyRefV3      `json:"explicitDependencies"`
}

func (value sourceMaterializationDependencyClosureV3Value) MarshalJSON() ([]byte, error) {
	switch value.Kind {
	case "worldCharacter":
		return json.Marshal(struct {
			Kind                  string                                      `json:"kind"`
			BoundEntity           *sourceMaterializationEntityRecordV3        `json:"boundEntity"`
			IncidentRelationships []sourceMaterializationRelationshipRecordV3 `json:"incidentRelationships"`
			EndpointEntities      []sourceMaterializationEntityRecordV3       `json:"endpointEntities"`
			ExplicitEntities      []sourceMaterializationEntityRecordV3       `json:"explicitEntities"`
			ExplicitDependencies  []sourceMaterializationDependencyRefV3      `json:"explicitDependencies"`
		}{
			Kind: value.Kind, BoundEntity: value.BoundEntity,
			IncidentRelationships: value.IncidentRelationships, EndpointEntities: value.EndpointEntities,
			ExplicitEntities: value.ExplicitEntities, ExplicitDependencies: value.ExplicitDependencies,
		})
	case "personaCharacter":
		return json.Marshal(struct {
			Kind                  string                                      `json:"kind"`
			ExplicitEntities      []sourceMaterializationEntityRecordV3       `json:"explicitEntities"`
			ExplicitRelationships []sourceMaterializationRelationshipRecordV3 `json:"explicitRelationships"`
			ExplicitDependencies  []sourceMaterializationDependencyRefV3      `json:"explicitDependencies"`
		}{
			Kind: value.Kind, ExplicitEntities: value.ExplicitEntities,
			ExplicitRelationships: value.ExplicitRelationships, ExplicitDependencies: value.ExplicitDependencies,
		})
	default:
		return nil, fmt.Errorf("dependency closure kind %q is not admitted", value.Kind)
	}
}

type sourceMaterializationCoverageRequiredSectionV3 struct {
	Path  string `json:"path"`
	State string `json:"state"`
}

type sourceMaterializationCoverageRequiredRefV3 struct {
	Path    string `json:"path"`
	RefKind string `json:"refKind"`
	RefID   string `json:"refId"`
	State   string `json:"state"`
}

type sourceMaterializationCoverageOptionalRefV3 struct {
	Path           string  `json:"path"`
	RefKind        string  `json:"refKind"`
	RefID          string  `json:"refId"`
	State          string  `json:"state"`
	OmissionReason *string `json:"omissionReason,omitempty"`
}

type sourceMaterializationCoverageComponentV3 struct {
	ComponentID   string `json:"componentId"`
	Kind          string `json:"kind"`
	SchemaVersion string `json:"schemaVersion"`
	Revision      uint64 `json:"revision"`
	ContentHash   string `json:"contentHash"`
}

type sourceMaterializationCoverageCrossReferenceV3 struct {
	CheckID   string `json:"checkId"`
	State     string `json:"state"`
	SourceRef string `json:"sourceRef"`
	TargetRef string `json:"targetRef"`
}

type sourceMaterializationCoverageManifestV3Value struct {
	ManifestSchemaVersion       string                                           `json:"manifestSchemaVersion"`
	ClosurePolicyVersion        string                                           `json:"closurePolicyVersion"`
	RequiredSections            []sourceMaterializationCoverageRequiredSectionV3 `json:"requiredSections"`
	RequiredRefs                []sourceMaterializationCoverageRequiredRefV3     `json:"requiredRefs"`
	OptionalRefs                []sourceMaterializationCoverageOptionalRefV3     `json:"optionalRefs"`
	Components                  []sourceMaterializationCoverageComponentV3       `json:"components"`
	CrossReferenceChecks        []sourceMaterializationCoverageCrossReferenceV3  `json:"crossReferenceChecks"`
	AggregateStatus             string                                           `json:"aggregateStatus"`
	MaterializationCoverageHash string                                           `json:"materializationCoverageHash"`
}

type sourceMaterializationContextV3Value struct {
	ContextSchemaVersion            string                                        `json:"contextSchemaVersion"`
	SourceRef                       sourceMaterializationCharacterSourceRefV3     `json:"sourceRef"`
	OwningWorld                     sourceMaterializationWorldRecordV3            `json:"owningWorld"`
	DependencyClosure               sourceMaterializationDependencyClosureV3Value `json:"dependencyClosure"`
	SourceComponentDigests          []sourceMaterializationComponentDigestV3      `json:"sourceComponentDigests"`
	WorldAndClosureComponentDigests []sourceMaterializationComponentDigestV3      `json:"worldAndClosureComponentDigests"`
	ClosurePolicyVersion            string                                        `json:"closurePolicyVersion"`
	MaterializationCoverageHash     string                                        `json:"materializationCoverageHash"`
	MaterializationContextHash      string                                        `json:"materializationContextHash"`
}

type sourceMaterializationValidityV3 struct {
	Status string                         `json:"status"`
	Issues []sourceMaterializationIssueV3 `json:"issues"`
}

type sourceMaterializationReadinessV3 struct {
	Status   string                         `json:"status"`
	Blockers []sourceMaterializationIssueV3 `json:"blockers"`
}

type sourceMaterializationIssueV3 struct {
	Path    string `json:"path"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type sourceMaterializationCanonicalSourceV3 struct {
	Kind                     string
	ID                       string
	SchemaVersion            string
	ContentRevision          uint64
	ContentHash              string
	CreatedAt                string
	UpdatedAt                string
	Origin                   sourceMaterializationOriginV3
	CreatorID                string
	OwnerAccountID           string
	Visibility               string
	WorldID                  string
	WorldEntityRef           *sourceMaterializationWorldEntityRefV3
	Profile                  sourceMaterializationJSONValue
	ProfileHash              string
	Validity                 sourceMaterializationValidityV3
	MaterializationReadiness sourceMaterializationReadinessV3
	SourceHash               string
}

type sourceMaterializationPayloadV3Value struct {
	PayloadSchemaVersion        string                                       `json:"payloadSchemaVersion"`
	PayloadAssemblyVersion      string                                       `json:"payloadAssemblyVersion"`
	SourceRef                   sourceMaterializationCharacterSourceRefV3    `json:"sourceRef"`
	CanonicalSourceRaw          json.RawMessage                              `json:"canonicalSource"`
	MaterializationContext      sourceMaterializationContextV3Value          `json:"materializationContext"`
	MaterializationCoverage     sourceMaterializationCoverageManifestV3Value `json:"materializationCoverage"`
	MaterializationCoverageHash string                                       `json:"materializationCoverageHash"`
	MaterializationContextHash  string                                       `json:"materializationContextHash"`
	CanonicalSource             sourceMaterializationCanonicalSourceV3       `json:"-"`
}

type sourceMaterializationPacketV3Value struct {
	PacketSchemaVersion         string                                         `json:"packetSchemaVersion"`
	PacketID                    string                                         `json:"packetId"`
	Issuer                      string                                         `json:"issuer"`
	KeyID                       string                                         `json:"keyId"`
	Algorithm                   string                                         `json:"algorithm"`
	KeyUse                      string                                         `json:"keyUse"`
	IssuedAt                    string                                         `json:"issuedAt"`
	ExpiresAt                   string                                         `json:"expiresAt"`
	Nonce                       string                                         `json:"nonce"`
	IntendedRuntimeAudience     string                                         `json:"intendedRuntimeAudience"`
	ChallengeID                 string                                         `json:"challengeId"`
	ChallengeDigest             string                                         `json:"challengeDigest"`
	PublishedLimits             sourceMaterializationPublishedLimitsV3         `json:"publishedLimits"`
	MaterializerAccountID       string                                         `json:"materializerAccountId"`
	SourceRef                   sourceMaterializationCharacterSourceRefV3      `json:"sourceRef"`
	AuthorizationDecisionDigest string                                         `json:"authorizationDecisionDigest"`
	AccessPolicyVersionDigest   string                                         `json:"accessPolicyVersionDigest"`
	MaterializationContextHash  string                                         `json:"materializationContextHash"`
	PayloadHash                 string                                         `json:"payloadHash"`
	ClosureSetManifestHash      string                                         `json:"closureSetManifestHash"`
	PacketHash                  string                                         `json:"packetHash"`
	PacketProof                 sourceMaterializationPacketProofV3             `json:"packetProof"`
	SemanticPayload             sourceMaterializationPayloadV3Value            `json:"semanticPayload"`
	ClosureSetManifest          sourceMaterializationClosureSetManifestV3Value `json:"closureSetManifest"`
	OrderedSegments             []sourceMaterializationSegmentV3Value          `json:"orderedSegments"`
}

type verifiedSourceMaterializationV3 struct {
	Packet                  sourceMaterializationPacketV3Value
	CanonicalComponentBytes map[string][]byte
	OrderedComponentIDs     []string
	SigningKeyFingerprint   string
	ReplayBindingHash       string
	NonceReplayDigest       string
	VerifiedAt              time.Time
}

func requireSourceMaterializationV3Text(value, field string) error {
	if value == "" || value != strings.TrimSpace(value) || len(value) > sourceMaterializationMaxTextBytesV3 {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "%s must be bounded non-empty trimmed text", field)
	}
	return nil
}

func isLowerSHA256V3(value string) bool {
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

func parseSourceMaterializationInstantV3(value, field string) (time.Time, error) {
	if len(value) != len("2006-01-02T15:04:05.000Z") {
		return time.Time{}, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "%s is not an exact millisecond UTC instant", field)
	}
	parsed, err := time.Parse("2006-01-02T15:04:05.000Z", value)
	if err != nil || parsed.Format("2006-01-02T15:04:05.000Z") != value {
		return time.Time{}, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "%s is not an exact millisecond UTC instant", field)
	}
	return parsed.UTC(), nil
}

func strictDecodeSourceMaterializationV3(raw []byte, target any) error {
	if len(raw) == 0 {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "empty JSON document")
	}
	if _, err := decodeSourceMaterializationJSON(raw); err != nil {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "invalid closed JSON: %v", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "decode closed JSON: %v", err)
	}
	if err := ensureSourceMaterializationV3EOF(decoder); err != nil {
		return err
	}
	return nil
}

func ensureSourceMaterializationV3EOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "trailing JSON value")
		}
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "trailing JSON: %v", err)
	}
	return nil
}

func checkedSourceMaterializationAddV3(values ...uint64) (uint64, error) {
	var total uint64
	for _, value := range values {
		if math.MaxUint64-total < value {
			return 0, sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "capacity arithmetic overflow")
		}
		total += value
	}
	return total, nil
}

func checkedSourceMaterializationMulV3(left, right uint64) (uint64, error) {
	if left != 0 && right > math.MaxUint64/left {
		return 0, sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "capacity arithmetic overflow")
	}
	return left * right, nil
}

func sourceMaterializationWireBudgetV3(limits sourceMaterializationPublishedLimitsV3) (int64, error) {
	if err := limits.validate(); err != nil {
		return 0, err
	}
	base64Bytes, err := checkedSourceMaterializationMulV3((limits.MaxSetBytes+2)/3, 4)
	if err != nil {
		return 0, err
	}
	componentDescriptors, err := checkedSourceMaterializationMulV3(limits.MaxSetComponentCount, 2048)
	if err != nil {
		return 0, err
	}
	chunkDescriptors, err := checkedSourceMaterializationMulV3(limits.MaxSetChunks, 384)
	if err != nil {
		return 0, err
	}
	segmentDescriptors, err := checkedSourceMaterializationMulV3(limits.MaxSetSegments, 4096)
	if err != nil {
		return 0, err
	}
	total, err := checkedSourceMaterializationAddV3(512*1024, limits.MaxSetBytes, base64Bytes, componentDescriptors, chunkDescriptors, segmentDescriptors)
	if err != nil {
		return 0, err
	}
	if total > maxSourceMaterializationWireBytesV3 || total > uint64(math.MaxInt64) {
		return 0, sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "derived wire budget exceeds Runtime ceiling")
	}
	return int64(total), nil
}
