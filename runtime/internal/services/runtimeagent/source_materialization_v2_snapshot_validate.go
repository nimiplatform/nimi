package runtimeagent

import (
	"bytes"
	"encoding/json"
)

// validateNormalizedSourceMaterializationV2 is the DB readback/restart seam.
// It revalidates typed semantic records and every durable hash without needing
// a raw packet, proof, nonce, challenge, manifest, component, or chunk byte.
func validateNormalizedSourceMaterializationV2(value normalizedSourceMaterializationV2) error {
	if value.NormalizationVersion != sourceMaterializationNormalizationV1 || value.SnapshotHashInput.SnapshotSchemaVersion != sourceMaterializationSnapshotV1 {
		return sourceMaterializationInvalid("normalized snapshot schema/version is invalid")
	}
	if (value.Character == nil) == (value.Persona == nil) || (value.CharacterClosure == nil) == (value.PersonaClosure == nil) {
		return sourceMaterializationInvalid("normalized snapshot typed union is invalid")
	}
	worldRaw, err := json.Marshal(value.OwningWorld)
	if err != nil {
		return sourceMaterializationInvalid("normalized world encode failed")
	}
	if err := validateMaterializationWorld(value.OwningWorld, worldRaw); err != nil {
		return err
	}
	sourceUnion := sourceMaterializationSourceUnionV2{Character: value.Character, Persona: value.Persona}
	var closureUnion sourceMaterializationClosureUnionV1
	var snapshotClosureUnion sourceMaterializationSnapshotClosureUnionV1
	if value.Character != nil {
		raw, err := json.Marshal(value.Character)
		if err != nil {
			return err
		}
		if err := validateMaterializationCharacter(*value.Character, raw); err != nil {
			return err
		}
		if value.CharacterClosure == nil || value.CharacterClosure.Kind != "worldCharacter" || value.CharacterClosure.BoundEntity.ID != value.Character.EntityID {
			return sourceMaterializationInvalid("normalized Character closure binding is invalid")
		}
		closureUnion.Character = &sourceMaterializationCharacterClosureV1{Kind: value.CharacterClosure.Kind, BoundEntity: value.CharacterClosure.BoundEntity, IncidentRelationships: value.CharacterClosure.IncidentRelationships, EndpointEntities: value.CharacterClosure.EndpointEntities, ExplicitDependencies: value.CharacterClosure.ExplicitDependencies}
		snapshotClosureUnion.Character = value.CharacterClosure
		entities := append([]sourceMaterializationEntityV1{value.CharacterClosure.BoundEntity}, value.CharacterClosure.EndpointEntities...)
		entities = append(entities, value.CharacterClosure.ExplicitEntities...)
		entityHashes := make(map[string]string, len(entities))
		for _, entity := range entities {
			entityHashes[entity.ID] = entity.ContentHash
		}
		for _, dependency := range value.CharacterClosure.ExplicitDependencies {
			if dependency.Kind != "worldEntity" || dependency.WorldID != value.Character.WorldID || !isLowerSHA256(dependency.ContentHash) {
				return sourceMaterializationInvalid("normalized Character dependency is invalid")
			}
			if entityHashes[dependency.ID] != dependency.ContentHash {
				return sourceMaterializationInvalid("normalized Character dependency record is missing")
			}
		}
		for _, entity := range entities {
			raw, err := json.Marshal(entity)
			if err != nil {
				return err
			}
			if err := validateMaterializationEntity(entity, raw); err != nil {
				return err
			}
		}
		for _, relationship := range value.CharacterClosure.IncidentRelationships {
			raw, err := json.Marshal(relationship)
			if err != nil {
				return err
			}
			if err := validateMaterializationRelationship(relationship, raw); err != nil {
				return err
			}
		}
	} else {
		raw, err := json.Marshal(value.Persona)
		if err != nil {
			return err
		}
		if err := validateMaterializationPersona(*value.Persona, raw); err != nil {
			return err
		}
		if value.PersonaClosure == nil || value.PersonaClosure.Kind != "realmPersona" || len(value.PersonaClosure.ExplicitDependencies) != 0 {
			return sourceMaterializationInvalid("normalized Persona closure is invalid")
		}
		closureUnion.Persona = &sourceMaterializationPersonaClosureV1{Kind: value.PersonaClosure.Kind, ExplicitDependencies: value.PersonaClosure.ExplicitDependencies}
		snapshotClosureUnion.Persona = value.PersonaClosure
	}
	if value.SourceRef.WorldID != value.OwningWorld.ID || value.SourceRef.SourceID != sourceIDFromMaterializationUnion(sourceUnion) || value.SourceRef.SourceContentHash != sourceHashFromMaterializationUnion(sourceUnion) {
		return sourceMaterializationInvalid("normalized sourceRef binding is invalid")
	}
	if value.Coverage.ManifestSchemaVersion != sourceMaterializationCoverageV1 || value.Coverage.ClosurePolicyVersion != sourceMaterializationClosureV1 || value.Coverage.AggregateStatus != "complete" || value.Coverage.CoverageManifestHash != value.CoverageManifestHash {
		return sourceMaterializationInvalid("normalized coverage state is invalid")
	}
	for _, section := range value.Coverage.RequiredSections {
		if section.State != "present" {
			return sourceMaterializationInvalid("normalized required coverage section is not present")
		}
	}
	for _, ref := range value.Coverage.RequiredRefs {
		if ref.State != "resolved" {
			return sourceMaterializationInvalid("normalized required coverage ref is not resolved")
		}
	}
	for _, check := range value.Coverage.CrossReferenceChecks {
		if check.State != "valid" {
			return sourceMaterializationInvalid("normalized coverage cross-reference is invalid")
		}
	}
	unsignedCoverage, err := coverageWithoutHash(value.Coverage)
	if err != nil {
		return err
	}
	coverageHash, err := hashSourceMaterializationDomainJCS(sourceMaterializationCoverageHashDomain, unsignedCoverage)
	if err != nil || coverageHash != value.CoverageManifestHash {
		return sourceMaterializationDenied("normalized coverage hash mismatch")
	}
	if len(value.ComponentDigests) == 0 || len(value.Coverage.Components) != len(value.ComponentDigests) {
		return sourceMaterializationInvalid("normalized component digest coverage is invalid")
	}
	for index, digest := range value.ComponentDigests {
		component := value.Coverage.Components[index]
		if digest.ComponentID != component.ComponentID || digest.Kind != component.Kind || digest.ContentHash != component.ContentHash {
			return sourceMaterializationInvalid("normalized component digest binding is invalid")
		}
	}
	contextHashInput := struct {
		ContextSchemaVersion            string                                   `json:"contextSchemaVersion"`
		SourceComponentDigests          []sourceMaterializationComponentDigestV1 `json:"sourceComponentDigests"`
		WorldAndClosureComponentDigests []sourceMaterializationComponentDigestV1 `json:"worldAndClosureComponentDigests"`
		ClosurePolicyVersion            string                                   `json:"closurePolicyVersion"`
		CoverageManifestHash            string                                   `json:"coverageManifestHash"`
	}{sourceMaterializationContextV1, value.ComponentDigests[:1], value.ComponentDigests[1:], sourceMaterializationClosureV1, value.CoverageManifestHash}
	contextHash, err := hashSourceMaterializationDomainJCS(sourceMaterializationContextHashDomain, contextHashInput)
	if err != nil || contextHash != value.MaterializationContextHash {
		return sourceMaterializationDenied("normalized context hash mismatch")
	}
	contextValue := sourceMaterializationContextValueV1{ContextSchemaVersion: sourceMaterializationContextV1, SourceRef: value.SourceRef, OwningWorld: value.OwningWorld, DependencyClosure: closureUnion, SourceComponentDigests: value.ComponentDigests[:1], WorldAndClosureComponentDigests: value.ComponentDigests[1:], ClosurePolicyVersion: sourceMaterializationClosureV1, CoverageManifestHash: value.CoverageManifestHash, MaterializationContextHash: contextHash}
	payload := sourceMaterializationPayloadValueV2{PayloadSchemaVersion: sourceMaterializationPayloadV2SchemaVersion, PayloadAssemblyVersion: sourceMaterializationAssemblyV1, Source: sourceUnion, MaterializationContext: contextValue, CoverageManifest: value.Coverage, CoverageManifestHash: value.CoverageManifestHash, MaterializationContextHash: contextHash}
	payloadHash, err := hashSourceMaterializationDomainJCS(sourceMaterializationPayloadHashDomain, payload)
	if err != nil || payloadHash != value.PayloadHash {
		return sourceMaterializationDenied("normalized payload hash mismatch")
	}
	expectedSnapshotInput := sourceMaterializationSnapshotHashInputV1{SnapshotSchemaVersion: sourceMaterializationSnapshotV1, Source: sourceUnion, OwningWorld: value.OwningWorld, DependencyClosure: snapshotClosureUnion, CoverageManifestHash: value.CoverageManifestHash, MaterializationContextHash: contextHash, NormalizationVersion: sourceMaterializationNormalizationV1}
	expectedCanonical, err := canonicalizeSourceMaterializationJCS(expectedSnapshotInput)
	if err != nil {
		return err
	}
	storedCanonical, err := canonicalizeSourceMaterializationJCS(value.SnapshotHashInput)
	if err != nil || !bytes.Equal(expectedCanonical, storedCanonical) {
		return sourceMaterializationDenied("normalized snapshot hash input mismatch")
	}
	snapshotHash, err := hashSourceMaterializationDomainJCS(sourceMaterializationSnapshotHashDomain, expectedSnapshotInput)
	if err != nil || snapshotHash != value.SnapshotHash {
		return sourceMaterializationDenied("normalized snapshot hash mismatch")
	}
	if !isLowerSHA256(value.PacketHash) || !isLowerSHA256(value.KeyFingerprint) || value.PacketID == "" || value.Issuer == "" {
		return sourceMaterializationInvalid("normalized safe provenance is invalid")
	}
	return nil
}
