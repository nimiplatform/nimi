package runtimeagent

import (
	"bytes"
	"sort"
	"strings"
)

type sourceMaterializationSemanticEntryV3 struct {
	ComponentID   string
	Kind          string
	SchemaVersion string
	Revision      uint64
	ContentHash   string
	Value         any
}

func validateSourceMaterializationPacketV3(packet *sourceMaterializationPacketV3Value, expected sourceMaterializationVerificationExpectationV3) error {
	if packet == nil {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "packet is absent")
	}
	if packet.PacketSchemaVersion != sourceMaterializationPacketV3SchemaVersion || packet.Algorithm != "RS256" || packet.KeyUse != "sig" {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "packet envelope constants are invalid")
	}
	for field, value := range map[string]string{
		"packetId": packet.PacketID, "issuer": packet.Issuer, "keyId": packet.KeyID, "nonce": packet.Nonce,
		"intendedRuntimeAudience": packet.IntendedRuntimeAudience, "challengeId": packet.ChallengeID,
		"materializerAccountId": packet.MaterializerAccountID,
	} {
		if err := requireSourceMaterializationV3Text(value, "packet."+field); err != nil {
			return err
		}
	}
	for field, value := range map[string]string{
		"challengeDigest": packet.ChallengeDigest, "authorizationDecisionDigest": packet.AuthorizationDecisionDigest,
		"accessPolicyVersionDigest": packet.AccessPolicyVersionDigest, "materializationContextHash": packet.MaterializationContextHash,
		"payloadHash": packet.PayloadHash, "closureSetManifestHash": packet.ClosureSetManifestHash, "packetHash": packet.PacketHash,
	} {
		if !isLowerSHA256V3(value) {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "packet.%s is not a lowercase SHA-256 digest", field)
		}
	}
	issuedAt, err := parseSourceMaterializationInstantV3(packet.IssuedAt, "packet.issuedAt")
	if err != nil {
		return err
	}
	expiresAt, err := parseSourceMaterializationInstantV3(packet.ExpiresAt, "packet.expiresAt")
	if err != nil {
		return err
	}
	if !issuedAt.Before(expiresAt) {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "packet expiry is not after issuance")
	}
	challengeTTL := expected.Challenge.ExpiresAt.Sub(expected.Challenge.IssuedAt)
	if challengeTTL <= 0 || expiresAt.Sub(issuedAt) > challengeTTL {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketExpiredV3, "packet TTL exceeds the published Runtime challenge TTL")
	}
	if err := packet.PublishedLimits.validate(); err != nil {
		return err
	}
	if err := packet.SourceRef.validate(); err != nil {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "packet sourceRef is invalid: %v", err)
	}
	if err := validateSourceMaterializationPayloadV3(&packet.SemanticPayload, packet.SourceRef); err != nil {
		return err
	}
	if err := validateSourceMaterializationManifestsV3(*packet); err != nil {
		return err
	}
	payloadHash, err := sourceMaterializationPayloadHashV3(packet.SemanticPayload)
	if err != nil || payloadHash != packet.PayloadHash {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "packet payload hash is stale")
	}
	if packet.MaterializationContextHash != packet.SemanticPayload.MaterializationContextHash {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "packet context hash binding is stale")
	}
	packetHash, err := sourceMaterializationPacketHashV3(*packet)
	if err != nil || packetHash != packet.PacketHash {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "packet hash is stale")
	}
	if packet.PacketProof.SignedPayload != sourceMaterializationProofDomainV3+packet.PacketHash ||
		len(packet.PacketProof.SignedPayload) > sourceMaterializationMaxProofBytesV3 {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "packet proof payload is not purpose-bound")
	}

	now := expected.Now.UTC()
	if issuedAt.After(now) {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "packet is not yet valid")
	}
	if !expiresAt.After(now) {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketExpiredV3, "packet is expired")
	}
	if expiresAt.After(expected.Challenge.ExpiresAt.UTC()) {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketExpiredV3, "packet exceeds challenge expiry")
	}
	if packet.Issuer != expected.ExpectedIssuer {
		return sourceMaterializationV3Error(sourceMaterializationFailureIssuerUnavailableV3, "packet issuer does not match current Realm")
	}
	if packet.IntendedRuntimeAudience != expected.Challenge.IntendedRuntimeAudience {
		return sourceMaterializationV3Error(sourceMaterializationFailureAudienceV3, "packet audience does not match the challenge")
	}
	if packet.ChallengeID != expected.Challenge.ChallengeID {
		return sourceMaterializationV3Error(sourceMaterializationFailureChallengeDigestV3, "packet challenge id does not match")
	}
	if packet.ChallengeDigest != expected.Challenge.ChallengeDigest {
		return sourceMaterializationV3Error(sourceMaterializationFailureChallengeDigestV3, "packet challenge digest does not match")
	}
	if !sourceMaterializationV3CanonicalEqual(packet.PublishedLimits, expected.Challenge.Limits) {
		return sourceMaterializationV3Error(sourceMaterializationFailureCapacityV3, "packet published limits do not match the challenge")
	}
	if packet.MaterializerAccountID != expected.Challenge.MaterializerAccountID {
		return sourceMaterializationV3Error(sourceMaterializationFailureAccountBindingV3, "packet account does not match the authenticated account")
	}
	if packet.AccessPolicyVersionDigest != expected.ExpectedAccessPolicyDigest {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "packet access policy digest is not current")
	}
	if !sourceMaterializationV3CanonicalEqual(packet.SourceRef, expected.Challenge.SourceRef) {
		return sourceMaterializationV3Error(sourceMaterializationFailureSourceBindingV3, "packet source does not match the requested source")
	}
	return nil
}

func validateSourceMaterializationPayloadV3(payload *sourceMaterializationPayloadV3Value, packetRef sourceMaterializationCharacterSourceRefV3) error {
	if payload.PayloadSchemaVersion != sourceMaterializationPayloadV3SchemaVersion || payload.PayloadAssemblyVersion != sourceMaterializationAssemblyV3 {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "semantic payload schema constants are invalid")
	}
	if !sourceMaterializationV3CanonicalEqual(payload.SourceRef, packetRef) {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "packet and payload source refs differ")
	}
	canonicalSource, err := decodeSourceMaterializationCanonicalSourceV3(payload.CanonicalSourceRaw, payload.SourceRef)
	if err != nil {
		return err
	}
	payload.CanonicalSource = canonicalSource
	if err := validateSourceMaterializationProfileCoverageV3(canonicalSource.Profile); err != nil {
		return err
	}
	context := &payload.MaterializationContext
	if context.ContextSchemaVersion != sourceMaterializationContextV3 || context.ClosurePolicyVersion != sourceMaterializationClosurePolicyV3 {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "materialization context constants are invalid")
	}
	if !sourceMaterializationV3CanonicalEqual(context.SourceRef, payload.SourceRef) || context.OwningWorld.ID != payload.SourceRef.WorldID || context.DependencyClosure.Kind != payload.SourceRef.Kind {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "materialization context source bindings are invalid")
	}
	if err := validateSourceMaterializationWorldRecordV3(context.OwningWorld); err != nil {
		return err
	}
	if err := validateSourceMaterializationClosureV3(context.DependencyClosure, payload.SourceRef); err != nil {
		return err
	}
	entries, err := sourceMaterializationExpectedSemanticEntriesV3(*payload)
	if err != nil {
		return err
	}
	if err := validateSourceMaterializationDigestsV3(*context, entries); err != nil {
		return err
	}
	coverage := &payload.MaterializationCoverage
	if err := validateSourceMaterializationCoverageV3(*coverage, entries); err != nil {
		return err
	}
	if payload.MaterializationCoverageHash != coverage.MaterializationCoverageHash || payload.MaterializationCoverageHash != context.MaterializationCoverageHash {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "payload coverage hash bindings differ")
	}
	contextHash, err := sourceMaterializationContextHashV3(*context)
	if err != nil || contextHash != context.MaterializationContextHash || payload.MaterializationContextHash != context.MaterializationContextHash {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "payload materialization context hash is stale")
	}
	return nil
}

func validateSourceMaterializationProfileCoverageV3(profile sourceMaterializationJSONValue) error {
	value, ok := profile.interfaceValue().(map[string]any)
	if !ok {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "character profile is not an object")
	}
	coverage, ok := value["profileCoverage"].(map[string]any)
	if !ok {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "profile coverage is not an object")
	}
	stored, ok := coverage["profileCoverageHash"].(string)
	if !ok || !isLowerSHA256V3(stored) || coverage["manifestSchemaVersion"] != "realm.character-profile-coverage/v1" {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "profile coverage schema or hash is invalid")
	}
	withoutHash := make(map[string]any, len(coverage)-1)
	for key, child := range coverage {
		if key != "profileCoverageHash" {
			withoutHash[key] = child
		}
	}
	expected, err := hashSourceMaterializationRealmDomainV3("nimi.realm.character-profile-coverage/v1\x00", withoutHash)
	if err != nil || expected != stored {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "profile coverage hash is stale")
	}
	return nil
}

func validateSourceMaterializationWorldRecordV3(value sourceMaterializationWorldRecordV3) error {
	if value.SchemaVersion != "realm.world-core/v1" || !sourceMaterializationSafeUintV3(value.ContentRevision) || !isLowerSHA256V3(value.ContentHash) || value.Core.Kind != sourceMaterializationJSONObject {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "owning WorldCore record is invalid")
	}
	if err := validateSourceMaterializationRecordCommonV3(value.ID, value.CreatedAt, value.UpdatedAt, value.Visibility, value.Origin); err != nil {
		return err
	}
	return nil
}

func validateSourceMaterializationEntityRecordV3(value sourceMaterializationEntityRecordV3) error {
	if value.SchemaVersion != "realm.world-entity-core/v1" || !sourceMaterializationSafeUintV3(value.ContentRevision) || !isLowerSHA256V3(value.ContentHash) || value.Core.Kind != sourceMaterializationJSONObject {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "WorldEntity record is invalid")
	}
	if err := validateSourceMaterializationRecordCommonV3(value.ID, value.CreatedAt, value.UpdatedAt, "public", value.Origin); err != nil {
		return err
	}
	for field, text := range map[string]string{"worldId": value.WorldID, "kind": value.Kind} {
		if err := requireSourceMaterializationV3Text(text, "worldEntity."+field); err != nil {
			return err
		}
	}
	return nil
}

func validateSourceMaterializationRelationshipRecordV3(value sourceMaterializationRelationshipRecordV3) error {
	if value.SchemaVersion != "realm.world-relationship-core/v1" || !sourceMaterializationSafeUintV3(value.ContentRevision) || !isLowerSHA256V3(value.ContentHash) || value.Core.Kind != sourceMaterializationJSONObject {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "WorldRelationship record is invalid")
	}
	if err := validateSourceMaterializationRecordCommonV3(value.ID, value.CreatedAt, value.UpdatedAt, "public", value.Origin); err != nil {
		return err
	}
	for field, text := range map[string]string{"worldId": value.WorldID, "sourceEntityId": value.SourceEntityID, "targetEntityId": value.TargetEntityID, "type": value.Type} {
		if err := requireSourceMaterializationV3Text(text, "worldRelationship."+field); err != nil {
			return err
		}
	}
	return nil
}

func validateSourceMaterializationRecordCommonV3(id, createdAt, updatedAt, visibility string, origin sourceMaterializationOriginV3) error {
	if err := requireSourceMaterializationV3Text(id, "record.id"); err != nil {
		return err
	}
	if _, err := parseSourceMaterializationInstantV3(createdAt, "record.createdAt"); err != nil {
		return err
	}
	if _, err := parseSourceMaterializationInstantV3(updatedAt, "record.updatedAt"); err != nil {
		return err
	}
	if visibility != "public" && visibility != "private" && visibility != "unlisted" && visibility != "system" {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "record visibility is invalid")
	}
	return validateSourceMaterializationOriginV3(origin)
}

func validateSourceMaterializationOriginV3(origin sourceMaterializationOriginV3) error {
	required := map[string][]*string{
		"manual": {}, "forge": {origin.SourceID, origin.SourceVersion, origin.SourceContentHash},
		"worldCharacterDerivation": {origin.ParentWorldID, origin.ParentCharacterID, origin.SourceContentHash},
		"import":                   {origin.SourceID, origin.SourceContentHash}, "system": {origin.SourceID},
	}
	fields, admitted := required[origin.Kind]
	if !admitted {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "record origin kind is invalid")
	}
	for _, value := range fields {
		if value == nil || strings.TrimSpace(*value) == "" {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "record origin is incomplete")
		}
	}
	if origin.SourceContentHash != nil && !isLowerSHA256V3(*origin.SourceContentHash) {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "record origin sourceContentHash is invalid")
	}
	return nil
}

func validateSourceMaterializationClosureV3(closure sourceMaterializationDependencyClosureV3Value, ref sourceMaterializationCharacterSourceRefV3) error {
	validateEntities := func(values []sourceMaterializationEntityRecordV3) error {
		for _, value := range values {
			if err := validateSourceMaterializationEntityRecordV3(value); err != nil {
				return err
			}
		}
		return nil
	}
	validateRelationships := func(values []sourceMaterializationRelationshipRecordV3) error {
		for _, value := range values {
			if err := validateSourceMaterializationRelationshipRecordV3(value); err != nil {
				return err
			}
		}
		return nil
	}
	if err := validateEntities(closure.ExplicitEntities); err != nil {
		return err
	}
	if !sourceMaterializationSortedUniqueV3(closure.ExplicitEntities, sourceMaterializationEntitySortKeyV3) ||
		!sourceMaterializationSortedUniqueV3(closure.ExplicitDependencies, sourceMaterializationDependencySortKeyV3) {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "explicit closure entries are duplicated or unsorted")
	}
	resolved := make(map[string]string)
	addEntity := func(value sourceMaterializationEntityRecordV3) error {
		key := sourceMaterializationDependencySortKeyV3(sourceMaterializationDependencyRefV3{Kind: "worldEntity", WorldID: value.WorldID, ID: value.ID})
		if prior, exists := resolved[key]; exists && prior != value.ContentHash {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "closure entity identity conflict")
		}
		resolved[key] = value.ContentHash
		return nil
	}
	addRelationship := func(value sourceMaterializationRelationshipRecordV3) error {
		key := sourceMaterializationDependencySortKeyV3(sourceMaterializationDependencyRefV3{Kind: "worldRelationship", WorldID: value.WorldID, ID: value.ID})
		if prior, exists := resolved[key]; exists && prior != value.ContentHash {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "closure relationship identity conflict")
		}
		resolved[key] = value.ContentHash
		return nil
	}
	for _, value := range closure.ExplicitEntities {
		if err := addEntity(value); err != nil {
			return err
		}
	}
	if closure.Kind == "worldCharacter" {
		if closure.IncidentRelationships == nil || closure.EndpointEntities == nil || closure.ExplicitEntities == nil || closure.ExplicitDependencies == nil ||
			closure.ExplicitRelationships != nil {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "world closure union shape is invalid")
		}
		if closure.BoundEntity == nil || ref.WorldEntityRef == nil || closure.BoundEntity.ID != ref.WorldEntityRef.EntityID || closure.BoundEntity.WorldID != ref.WorldID {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "world-character bound entity does not match source ref")
		}
		if err := validateSourceMaterializationEntityRecordV3(*closure.BoundEntity); err != nil {
			return err
		}
		if err := validateEntities(closure.EndpointEntities); err != nil {
			return err
		}
		if err := validateRelationships(closure.IncidentRelationships); err != nil {
			return err
		}
		if !sourceMaterializationSortedUniqueV3(closure.EndpointEntities, sourceMaterializationEntitySortKeyV3) ||
			!sourceMaterializationSortedUniqueV3(closure.IncidentRelationships, sourceMaterializationRelationshipSortKeyV3) {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "world closure entries are duplicated or unsorted")
		}
		allEntities := append(append([]sourceMaterializationEntityRecordV3{*closure.BoundEntity}, closure.EndpointEntities...), closure.ExplicitEntities...)
		seenEntities := make(map[string]struct{}, len(allEntities))
		for _, entity := range allEntities {
			if entity.WorldID != ref.WorldID {
				return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "world closure entity has the wrong world")
			}
			key := sourceMaterializationEntitySortKeyV3(entity)
			if _, exists := seenEntities[key]; exists {
				return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "world closure entity identities overlap")
			}
			seenEntities[key] = struct{}{}
			if err := addEntity(entity); err != nil {
				return err
			}
		}
		expectedEndpoints := make(map[string]struct{})
		for _, relationship := range closure.IncidentRelationships {
			if relationship.WorldID != ref.WorldID || (relationship.SourceEntityID != closure.BoundEntity.ID && relationship.TargetEntityID != closure.BoundEntity.ID) {
				return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "incident relationship does not touch the bound entity")
			}
			if relationship.SourceEntityID != closure.BoundEntity.ID {
				expectedEndpoints[relationship.SourceEntityID] = struct{}{}
			}
			if relationship.TargetEntityID != closure.BoundEntity.ID {
				expectedEndpoints[relationship.TargetEntityID] = struct{}{}
			}
			if err := addRelationship(relationship); err != nil {
				return err
			}
		}
		actualEndpoints := make(map[string]struct{}, len(closure.EndpointEntities))
		for _, entity := range closure.EndpointEntities {
			actualEndpoints[entity.ID] = struct{}{}
		}
		if !sourceMaterializationStringSetEqualV3(actualEndpoints, expectedEndpoints) {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "endpoint entities do not exactly close incident relationships")
		}
	} else if closure.Kind == "personaCharacter" {
		if closure.BoundEntity != nil || closure.IncidentRelationships != nil || closure.EndpointEntities != nil ||
			closure.ExplicitEntities == nil || closure.ExplicitRelationships == nil || closure.ExplicitDependencies == nil {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "persona closure union shape is invalid")
		}
		if err := validateRelationships(closure.ExplicitRelationships); err != nil {
			return err
		}
		if !sourceMaterializationSortedUniqueV3(closure.ExplicitRelationships, sourceMaterializationRelationshipSortKeyV3) {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "persona relationships are duplicated or unsorted")
		}
		entityIDs := make(map[string]struct{}, len(closure.ExplicitEntities))
		for _, entity := range closure.ExplicitEntities {
			if entity.WorldID != ref.WorldID {
				return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "persona closure entity has wrong world")
			}
			entityIDs[entity.ID] = struct{}{}
		}
		for _, relationship := range closure.ExplicitRelationships {
			if relationship.WorldID != ref.WorldID {
				return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "persona closure relationship has wrong world")
			}
			if _, exists := entityIDs[relationship.SourceEntityID]; !exists {
				return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "persona relationship source endpoint is absent")
			}
			if _, exists := entityIDs[relationship.TargetEntityID]; !exists {
				return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "persona relationship target endpoint is absent")
			}
			if err := addRelationship(relationship); err != nil {
				return err
			}
		}
		if len(closure.ExplicitDependencies) != len(resolved) {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "persona explicit dependency refs are incomplete")
		}
	} else {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "dependency closure kind is invalid")
	}
	for _, dependency := range closure.ExplicitDependencies {
		if (dependency.Kind != "worldEntity" && dependency.Kind != "worldRelationship") || dependency.WorldID != ref.WorldID || !isLowerSHA256V3(dependency.ContentHash) ||
			resolved[sourceMaterializationDependencySortKeyV3(dependency)] != dependency.ContentHash {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "explicit dependency does not resolve to one same-hash component")
		}
	}
	if closure.Kind == "worldCharacter" {
		refs := make(map[string]struct{}, len(closure.ExplicitDependencies))
		for _, dependency := range closure.ExplicitDependencies {
			refs[sourceMaterializationDependencySortKeyV3(dependency)] = struct{}{}
		}
		for _, entity := range closure.ExplicitEntities {
			key := sourceMaterializationDependencySortKeyV3(sourceMaterializationDependencyRefV3{Kind: "worldEntity", WorldID: entity.WorldID, ID: entity.ID})
			if _, exists := refs[key]; !exists {
				return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "explicit entity lacks an explicit dependency ref")
			}
		}
	}
	return nil
}

func sourceMaterializationExpectedSemanticEntriesV3(payload sourceMaterializationPayloadV3Value) ([]sourceMaterializationSemanticEntryV3, error) {
	sourceValue, err := decodeSourceMaterializationJSON(payload.CanonicalSourceRaw)
	if err != nil {
		return nil, err
	}
	entries := []sourceMaterializationSemanticEntryV3{{
		ComponentID: payload.SourceRef.Kind + ":" + payload.SourceRef.ID, Kind: payload.SourceRef.Kind,
		SchemaVersion: payload.CanonicalSource.SchemaVersion, Revision: payload.CanonicalSource.ContentRevision,
		ContentHash: payload.CanonicalSource.ContentHash, Value: sourceValue,
	}}
	worldValue, err := sourceMaterializationV3Any(payload.MaterializationContext.OwningWorld)
	if err != nil {
		return nil, err
	}
	world := payload.MaterializationContext.OwningWorld
	entries = append(entries, sourceMaterializationSemanticEntryV3{ComponentID: "worldCore:" + world.ID, Kind: "worldCore", SchemaVersion: world.SchemaVersion, Revision: world.ContentRevision, ContentHash: world.ContentHash, Value: worldValue})
	addEntity := func(value sourceMaterializationEntityRecordV3) error {
		generic, convertErr := sourceMaterializationV3Any(value)
		if convertErr != nil {
			return convertErr
		}
		entries = append(entries, sourceMaterializationSemanticEntryV3{ComponentID: "worldEntity:" + value.WorldID + ":" + value.ID, Kind: "worldEntity", SchemaVersion: value.SchemaVersion, Revision: value.ContentRevision, ContentHash: value.ContentHash, Value: generic})
		return nil
	}
	addRelationship := func(value sourceMaterializationRelationshipRecordV3) error {
		generic, convertErr := sourceMaterializationV3Any(value)
		if convertErr != nil {
			return convertErr
		}
		entries = append(entries, sourceMaterializationSemanticEntryV3{ComponentID: "worldRelationship:" + value.WorldID + ":" + value.ID, Kind: "worldRelationship", SchemaVersion: value.SchemaVersion, Revision: value.ContentRevision, ContentHash: value.ContentHash, Value: generic})
		return nil
	}
	closure := payload.MaterializationContext.DependencyClosure
	if closure.Kind == "worldCharacter" {
		if err := addEntity(*closure.BoundEntity); err != nil {
			return nil, err
		}
		for _, value := range closure.IncidentRelationships {
			if err := addRelationship(value); err != nil {
				return nil, err
			}
		}
		entities := append(append([]sourceMaterializationEntityRecordV3(nil), closure.EndpointEntities...), closure.ExplicitEntities...)
		sortSourceMaterializationEntitiesV3(entities)
		for _, value := range entities {
			if err := addEntity(value); err != nil {
				return nil, err
			}
		}
	} else {
		for _, value := range closure.ExplicitEntities {
			if err := addEntity(value); err != nil {
				return nil, err
			}
		}
		for _, value := range closure.ExplicitRelationships {
			if err := addRelationship(value); err != nil {
				return nil, err
			}
		}
	}
	return entries, nil
}

func validateSourceMaterializationDigestsV3(context sourceMaterializationContextV3Value, entries []sourceMaterializationSemanticEntryV3) error {
	toDigest := func(entry sourceMaterializationSemanticEntryV3) sourceMaterializationComponentDigestV3 {
		return sourceMaterializationComponentDigestV3{ComponentID: entry.ComponentID, Kind: entry.Kind, ContentHash: entry.ContentHash}
	}
	source := []sourceMaterializationComponentDigestV3{toDigest(entries[0])}
	closure := make([]sourceMaterializationComponentDigestV3, 0, len(entries)-1)
	for _, entry := range entries[1:] {
		closure = append(closure, toDigest(entry))
	}
	if !sourceMaterializationV3CanonicalEqual(source, context.SourceComponentDigests) || !sourceMaterializationV3CanonicalEqual(closure, context.WorldAndClosureComponentDigests) {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "context component digests do not match the semantic closure")
	}
	return nil
}

func validateSourceMaterializationCoverageV3(coverage sourceMaterializationCoverageManifestV3Value, entries []sourceMaterializationSemanticEntryV3) error {
	if coverage.ManifestSchemaVersion != sourceMaterializationCoverageV3 || coverage.ClosurePolicyVersion != sourceMaterializationClosurePolicyV3 {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "coverage schema constants are invalid")
	}
	if !sourceMaterializationSortedUniqueV3(coverage.RequiredSections, func(value sourceMaterializationCoverageRequiredSectionV3) string { return value.Path }) ||
		!sourceMaterializationSortedUniqueV3(coverage.RequiredRefs, func(value sourceMaterializationCoverageRequiredRefV3) string {
			return value.Path + "\x00" + value.RefKind + "\x00" + value.RefID
		}) ||
		!sourceMaterializationSortedUniqueV3(coverage.OptionalRefs, func(value sourceMaterializationCoverageOptionalRefV3) string {
			return value.Path + "\x00" + value.RefKind + "\x00" + value.RefID
		}) ||
		!sourceMaterializationSortedUniqueV3(coverage.Components, func(value sourceMaterializationCoverageComponentV3) string { return value.ComponentID }) ||
		!sourceMaterializationSortedUniqueV3(coverage.CrossReferenceChecks, func(value sourceMaterializationCoverageCrossReferenceV3) string { return value.CheckID }) {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "coverage entries are duplicated or unsorted")
	}
	invalid := false
	incomplete := false
	for _, value := range coverage.RequiredSections {
		if value.State == "invalid" {
			invalid = true
		} else if value.State == "missing" {
			incomplete = true
		} else if value.State != "present" {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "required section state is invalid")
		}
	}
	for _, value := range coverage.RequiredRefs {
		if value.State == "invalid" {
			invalid = true
		} else if value.State == "missing" {
			incomplete = true
		} else if value.State != "resolved" {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "required ref state is invalid")
		}
	}
	for _, value := range coverage.OptionalRefs {
		switch value.State {
		case "invalid":
			invalid = true
		case "omitted":
			if value.OmissionReason == nil || (*value.OmissionReason != "not-declared" && *value.OmissionReason != "intentionally-absent" && *value.OmissionReason != "inaccessible-optional-resource") {
				return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "omitted optional ref lacks an admitted reason")
			}
		case "resolved":
			if value.OmissionReason != nil {
				return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "resolved optional ref has an omission reason")
			}
		default:
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "optional ref state is invalid")
		}
	}
	for _, value := range coverage.CrossReferenceChecks {
		if value.State == "invalid" {
			invalid = true
		} else if value.State != "valid" {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "cross-reference state is invalid")
		}
	}
	expectedStatus := "complete"
	if invalid {
		expectedStatus = "invalid"
	} else if incomplete {
		expectedStatus = "incomplete"
	}
	if coverage.AggregateStatus != expectedStatus || expectedStatus != "complete" {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "coverage is not complete")
	}
	expectedComponents := make([]sourceMaterializationCoverageComponentV3, 0, len(entries))
	for _, entry := range entries {
		expectedComponents = append(expectedComponents, sourceMaterializationCoverageComponentV3{ComponentID: entry.ComponentID, Kind: entry.Kind, SchemaVersion: entry.SchemaVersion, Revision: entry.Revision, ContentHash: entry.ContentHash})
	}
	sort.Slice(expectedComponents, func(i, j int) bool {
		return bytes.Compare([]byte(expectedComponents[i].ComponentID), []byte(expectedComponents[j].ComponentID)) < 0
	})
	if !sourceMaterializationV3CanonicalEqual(expectedComponents, coverage.Components) {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "coverage components do not match semantic closure")
	}
	hash, err := sourceMaterializationCoverageHashV3(coverage)
	if err != nil || hash != coverage.MaterializationCoverageHash {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "coverage hash is stale")
	}
	return nil
}

func validateSourceMaterializationManifestsV3(packet sourceMaterializationPacketV3Value) error {
	set := packet.ClosureSetManifest
	if set.ManifestSchemaVersion != sourceMaterializationClosureSetManifestV3 || set.PayloadAssemblyVersion != sourceMaterializationAssemblyV3 || set.PacketID != packet.PacketID || set.ChallengeDigest != packet.ChallengeDigest || !sourceMaterializationV3CanonicalEqual(set.PublishedLimits, packet.PublishedLimits) {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "closure-set issuance binding is invalid")
	}
	if len(packet.OrderedSegments) == 0 || uint64(len(packet.OrderedSegments)) != set.SegmentCount || uint64(len(set.Segments)) != set.SegmentCount {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "closure-set segment count is inconsistent")
	}
	var totalBytes, totalComponents, totalChunks uint64
	var nextComponent uint64
	var nextGlobalChunk uint64
	var previousManifest sourceMaterializationSegmentManifestV3Value
	hasPreviousManifest := false
	orderedManifestComponents := make([]sourceMaterializationManifestComponentV3, 0, set.ComponentCount)
	for segmentIndex, segment := range packet.OrderedSegments {
		manifest := segment.SegmentManifest
		if manifest.ManifestSchemaVersion != sourceMaterializationSegmentManifestV3 || manifest.PayloadAssemblyVersion != sourceMaterializationAssemblyV3 || manifest.PacketID != packet.PacketID || manifest.ChallengeDigest != packet.ChallengeDigest || manifest.SegmentOrdinal != uint64(segmentIndex) || !sourceMaterializationV3CanonicalEqual(manifest.PublishedSegmentLimits, packet.PublishedLimits.segmentLimits()) {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "segment manifest issuance binding is invalid")
		}
		if len(segment.OrderedComponents) == 0 || uint64(len(segment.OrderedComponents)) != manifest.ComponentCount || uint64(len(manifest.Components)) != manifest.ComponentCount || uint64(len(manifest.Chunks)) != manifest.ChunkCount || manifest.FirstComponentOrdinal != nextComponent || manifest.LastComponentOrdinal < manifest.FirstComponentOrdinal || manifest.LastComponentOrdinal-manifest.FirstComponentOrdinal+1 != manifest.ComponentCount {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "segment ranges or counts are inconsistent")
		}
		var segmentBytes uint64
		for componentIndex, component := range segment.OrderedComponents {
			manifestComponent := manifest.Components[componentIndex]
			if manifestComponent.GlobalComponentOrdinal != nextComponent || manifestComponent.ComponentID != component.ComponentID || manifestComponent.Kind != component.Kind || manifestComponent.SchemaVersion != component.SchemaVersion || manifestComponent.Revision != component.Revision || manifestComponent.ContentHash != component.ContentHash || manifestComponent.CanonicalBytesHash != component.CanonicalBytesHash || manifestComponent.CanonicalByteLength != component.CanonicalByteLength || component.CanonicalByteLength == 0 || !sourceMaterializationSafeUintV3(component.Revision) {
				return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "segment component metadata is stale")
			}
			if err := validateSourceMaterializationComponentMetadataV3(component.ComponentID, component.Kind, component.SchemaVersion, component.ContentHash, component.CanonicalBytesHash); err != nil {
				return err
			}
			componentChunks := 0
			var expectedOffset uint64
			for _, chunk := range manifest.Chunks {
				if chunk.GlobalComponentOrdinal != nextComponent {
					continue
				}
				if chunk.GlobalChunkOrdinal != nextGlobalChunk || chunk.ComponentOffset != expectedOffset || chunk.Length == 0 || chunk.Length > packet.PublishedLimits.MaxChunkBytes || !isLowerSHA256V3(chunk.ChunkSHA256) {
					return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "segment chunk descriptors are not contiguous")
				}
				expectedOffset += chunk.Length
				nextGlobalChunk++
				componentChunks++
			}
			if componentChunks == 0 || componentChunks != len(component.CanonicalBytes) || expectedOffset != component.CanonicalByteLength {
				return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "segment chunks do not exactly cover the component")
			}
			segmentBytes += component.CanonicalByteLength
			orderedManifestComponents = append(orderedManifestComponents, manifestComponent)
			nextComponent++
		}
		if segmentBytes != manifest.TotalCanonicalBytes || manifest.TotalCanonicalBytes > packet.PublishedLimits.MaxSegmentBytes || manifest.ComponentCount > packet.PublishedLimits.MaxSegmentComponentCount || manifest.ChunkCount > packet.PublishedLimits.MaxSegmentChunks {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "segment totals exceed or differ from published limits")
		}
		manifestHash, err := sourceMaterializationSegmentManifestHashV3(manifest)
		if err != nil || manifestHash != segment.SegmentManifestHash {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "segment manifest hash is stale")
		}
		setRef := set.Segments[segmentIndex]
		if setRef.SegmentOrdinal != manifest.SegmentOrdinal || setRef.FirstComponentOrdinal != manifest.FirstComponentOrdinal || setRef.LastComponentOrdinal != manifest.LastComponentOrdinal || setRef.ComponentCount != manifest.ComponentCount || setRef.TotalCanonicalBytes != manifest.TotalCanonicalBytes || setRef.ChunkCount != manifest.ChunkCount || setRef.SegmentManifestHash != segment.SegmentManifestHash {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "closure-set segment reference is stale")
		}
		if hasPreviousManifest {
			firstComponent := manifest.Components[0]
			var firstComponentChunks uint64
			for _, chunk := range manifest.Chunks {
				if chunk.GlobalComponentOrdinal == firstComponent.GlobalComponentOrdinal {
					firstComponentChunks++
				}
			}
			limits := packet.PublishedLimits
			fitsPreviousBytes := previousManifest.TotalCanonicalBytes <= limits.MaxSegmentBytes &&
				firstComponent.CanonicalByteLength <= limits.MaxSegmentBytes-previousManifest.TotalCanonicalBytes
			fitsPreviousComponentCount := previousManifest.ComponentCount < limits.MaxSegmentComponentCount
			fitsPreviousChunks := previousManifest.ChunkCount <= limits.MaxSegmentChunks &&
				firstComponentChunks <= limits.MaxSegmentChunks-previousManifest.ChunkCount
			if fitsPreviousBytes && fitsPreviousComponentCount && fitsPreviousChunks {
				return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "segment boundary violates deterministic greedy first-fit partitioning")
			}
		}
		previousManifest = manifest
		hasPreviousManifest = true
		totalBytes += manifest.TotalCanonicalBytes
		totalComponents += manifest.ComponentCount
		totalChunks += manifest.ChunkCount
	}
	if nextComponent != set.ComponentCount || nextGlobalChunk != set.ChunkCount || totalBytes != set.TotalCanonicalBytes || totalComponents != set.ComponentCount || totalChunks != set.ChunkCount || set.SegmentCount > packet.PublishedLimits.MaxSetSegments || set.TotalCanonicalBytes > packet.PublishedLimits.MaxSetBytes || set.ComponentCount > packet.PublishedLimits.MaxSetComponentCount || set.ChunkCount > packet.PublishedLimits.MaxSetChunks {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "closure-set totals or limits are invalid")
	}
	orderedHash, err := sourceMaterializationOrderedComponentSetHashV3(orderedManifestComponents)
	if err != nil || orderedHash != set.OrderedComponentSetHash {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "ordered component set hash is stale")
	}
	closureHash, err := sourceMaterializationClosureSetManifestHashV3(set)
	if err != nil || closureHash != packet.ClosureSetManifestHash {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "closure-set manifest hash is stale")
	}
	return nil
}

func validateSourceMaterializationComponentMetadataV3(id, kind, schemaVersion, contentHash, canonicalBytesHash string) error {
	if err := requireSourceMaterializationV3Text(id, "component.componentId"); err != nil {
		return err
	}
	if err := requireSourceMaterializationV3Text(schemaVersion, "component.schemaVersion"); err != nil {
		return err
	}
	switch kind {
	case "worldCharacter", "personaCharacter", "worldCore", "worldEntity", "worldRelationship", "materializationCoverage":
	default:
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "component kind is invalid")
	}
	if !isLowerSHA256V3(contentHash) || !isLowerSHA256V3(canonicalBytesHash) {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "component hash is invalid")
	}
	return nil
}

func sourceMaterializationEntitySortKeyV3(value sourceMaterializationEntityRecordV3) string {
	return value.WorldID + "\x00" + value.ID
}
func sourceMaterializationRelationshipSortKeyV3(value sourceMaterializationRelationshipRecordV3) string {
	return value.WorldID + "\x00" + value.SourceEntityID + "\x00" + value.TargetEntityID + "\x00" + value.Type + "\x00" + value.ID
}
func sourceMaterializationDependencySortKeyV3(value sourceMaterializationDependencyRefV3) string {
	return value.Kind + "\x00" + value.WorldID + "\x00" + value.ID
}

func sortSourceMaterializationEntitiesV3(values []sourceMaterializationEntityRecordV3) {
	sort.Slice(values, func(i, j int) bool {
		return bytes.Compare([]byte(sourceMaterializationEntitySortKeyV3(values[i])), []byte(sourceMaterializationEntitySortKeyV3(values[j]))) < 0
	})
}

func sourceMaterializationStringSetEqualV3(left, right map[string]struct{}) bool {
	if len(left) != len(right) {
		return false
	}
	for key := range left {
		if _, exists := right[key]; !exists {
			return false
		}
	}
	return true
}

func sourceMaterializationSafeUintV3(value uint64) bool { return value <= 1<<53-1 }
