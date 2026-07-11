package runtimeagent

import (
	"bytes"
	"sort"
)

func verifyCanonicalSourceMaterializationComponent(descriptor sourceMaterializationManifestComponentV1, raw []byte) error {
	if uint64(len(raw)) != descriptor.CanonicalByteLength {
		return sourceMaterializationDenied("component %q canonical byte length mismatch", descriptor.ComponentID)
	}
	if sha256HexBytes(raw) != descriptor.CanonicalBytesHash {
		return sourceMaterializationDenied("component %q canonical byte hash mismatch", descriptor.ComponentID)
	}
	canonical, err := canonicalizeSourceMaterializationJCS(raw)
	if err != nil {
		return sourceMaterializationInvalid("component %q is not valid canonical JSON: %v", descriptor.ComponentID, err)
	}
	if !bytes.Equal(raw, canonical) {
		return sourceMaterializationDenied("component %q bytes are not RFC8785/JCS canonical", descriptor.ComponentID)
	}
	return nil
}

func verifySourceMaterializationDescriptor(descriptor sourceMaterializationManifestComponentV1, id string, schema string, revision uint64, contentHash string) error {
	if descriptor.SchemaVersion != schema || descriptor.Revision != revision || descriptor.ContentHash != contentHash {
		return sourceMaterializationDenied("component %q descriptor metadata mismatch", descriptor.ComponentID)
	}
	if descriptor.Kind != "coverageManifest" {
		worldID := id
		if descriptor.Kind == "worldCore" {
			worldID = id
		}
		_ = worldID
	}
	return nil
}

func materializationEntityOrder(values []sourceMaterializationEntityV1) {
	sort.Slice(values, func(i, j int) bool {
		if order := compareMaterializationUTF8(values[i].WorldID, values[j].WorldID); order != 0 {
			return order < 0
		}
		return compareMaterializationUTF8(values[i].ID, values[j].ID) < 0
	})
}

func materializationRelationshipOrder(values []sourceMaterializationRelationshipV1) {
	sort.Slice(values, func(i, j int) bool {
		pairs := [][2]string{{values[i].WorldID, values[j].WorldID}, {values[i].SourceEntityID, values[j].SourceEntityID}, {values[i].TargetEntityID, values[j].TargetEntityID}, {values[i].Type, values[j].Type}, {values[i].ID, values[j].ID}}
		for _, pair := range pairs {
			if order := compareMaterializationUTF8(pair[0], pair[1]); order != 0 {
				return order < 0
			}
		}
		return false
	})
}

func verifyAndNormalizeSourceMaterializationV2(begin *verifiedSourceMaterializationBeginV2, componentBytes map[string][]byte) (*normalizedSourceMaterializationV2, error) {
	if begin == nil {
		return nil, sourceMaterializationInvalid("verified begin control is required")
	}
	if len(componentBytes) != len(begin.Manifest.Components) {
		return nil, sourceMaterializationInvalid("component byte set does not match manifest count")
	}
	for id := range componentBytes {
		found := false
		for _, descriptor := range begin.Manifest.Components {
			if descriptor.ComponentID == id {
				found = true
				break
			}
		}
		if !found {
			return nil, sourceMaterializationInvalid("unmanifested component %q", id)
		}
	}

	var character *sourceMaterializationWorldCharacterV2
	var persona *sourceMaterializationRealmPersonaV2
	var world *sourceMaterializationWorldV1
	var coverage *sourceMaterializationCoverageManifestV1
	entities := make([]sourceMaterializationEntityV1, 0)
	relationships := make([]sourceMaterializationRelationshipV1, 0)
	entityByID := map[string]sourceMaterializationEntityV1{}
	componentDigests := make([]sourceMaterializationComponentDigestV1, 0, len(begin.Manifest.Components)-1)

	for index, descriptor := range begin.Manifest.Components {
		raw, exists := componentBytes[descriptor.ComponentID]
		if !exists {
			return nil, sourceMaterializationInvalid("component %q is missing", descriptor.ComponentID)
		}
		if err := verifyCanonicalSourceMaterializationComponent(descriptor, raw); err != nil {
			return nil, err
		}
		switch descriptor.Kind {
		case "worldCharacter":
			var value sourceMaterializationWorldCharacterV2
			if err := strictDecodeSourceMaterializationJSON(raw, &value); err != nil {
				return nil, sourceMaterializationInvalid("WorldCharacterCore strict decode failed: %v", err)
			}
			if err := validateMaterializationCharacter(value, raw); err != nil {
				return nil, err
			}
			if err := verifySourceMaterializationDescriptor(descriptor, value.ID, value.SchemaVersion, value.ContentRevision, value.ContentHash); err != nil {
				return nil, err
			}
			if descriptor.ComponentID != compactMaterializationRef("worldCharacter", value.WorldID, value.ID) {
				return nil, sourceMaterializationDenied("WorldCharacterCore component id mismatch")
			}
			character = &value
		case "realmPersona":
			var value sourceMaterializationRealmPersonaV2
			if err := strictDecodeSourceMaterializationJSON(raw, &value); err != nil {
				return nil, sourceMaterializationInvalid("RealmPersona strict decode failed: %v", err)
			}
			if err := validateMaterializationPersona(value, raw); err != nil {
				return nil, err
			}
			if err := verifySourceMaterializationDescriptor(descriptor, value.ID, value.SchemaVersion, value.ContentRevision, value.ContentHash); err != nil {
				return nil, err
			}
			if descriptor.ComponentID != compactMaterializationRef("realmPersona", value.HomeWorldID, value.ID) {
				return nil, sourceMaterializationDenied("RealmPersona component id mismatch")
			}
			persona = &value
		case "worldCore":
			var value sourceMaterializationWorldV1
			if err := strictDecodeSourceMaterializationJSON(raw, &value); err != nil {
				return nil, sourceMaterializationInvalid("WorldCore strict decode failed: %v", err)
			}
			if err := validateMaterializationWorld(value, raw); err != nil {
				return nil, err
			}
			if err := verifySourceMaterializationDescriptor(descriptor, value.ID, value.SchemaVersion, value.ContentRevision, value.ContentHash); err != nil {
				return nil, err
			}
			if descriptor.ComponentID != compactMaterializationRef("worldCore", value.ID, value.ID) {
				return nil, sourceMaterializationDenied("WorldCore component id mismatch")
			}
			world = &value
		case "worldEntity":
			var value sourceMaterializationEntityV1
			if err := strictDecodeSourceMaterializationJSON(raw, &value); err != nil {
				return nil, sourceMaterializationInvalid("WorldEntityCore strict decode failed: %v", err)
			}
			if err := validateMaterializationEntity(value, raw); err != nil {
				return nil, err
			}
			if err := verifySourceMaterializationDescriptor(descriptor, value.ID, value.SchemaVersion, value.ContentRevision, value.ContentHash); err != nil {
				return nil, err
			}
			if descriptor.ComponentID != compactMaterializationRef("worldEntity", value.WorldID, value.ID) {
				return nil, sourceMaterializationDenied("WorldEntityCore component id mismatch")
			}
			if _, duplicate := entityByID[value.ID]; duplicate {
				return nil, sourceMaterializationDenied("WorldEntityCore id is duplicated")
			}
			entities = append(entities, value)
			entityByID[value.ID] = value
		case "worldRelationship":
			var value sourceMaterializationRelationshipV1
			if err := strictDecodeSourceMaterializationJSON(raw, &value); err != nil {
				return nil, sourceMaterializationInvalid("WorldRelationshipCore strict decode failed: %v", err)
			}
			if err := validateMaterializationRelationship(value, raw); err != nil {
				return nil, err
			}
			if err := verifySourceMaterializationDescriptor(descriptor, value.ID, value.SchemaVersion, value.ContentRevision, value.ContentHash); err != nil {
				return nil, err
			}
			if descriptor.ComponentID != compactMaterializationRef("worldRelationship", value.WorldID, value.ID) {
				return nil, sourceMaterializationDenied("WorldRelationshipCore component id mismatch")
			}
			relationships = append(relationships, value)
		case "coverageManifest":
			var value sourceMaterializationCoverageManifestV1
			if err := strictDecodeSourceMaterializationJSON(raw, &value); err != nil {
				return nil, sourceMaterializationInvalid("CoverageManifestV1 strict decode failed: %v", err)
			}
			if descriptor.ComponentID != compactMaterializationRef("coverageManifest", "manifest", begin.Envelope.PacketID) || descriptor.SchemaVersion != sourceMaterializationCoverageV1 || descriptor.Revision != 1 {
				return nil, sourceMaterializationDenied("coverage manifest descriptor mismatch")
			}
			coverage = &value
		default:
			return nil, sourceMaterializationInvalid("component %d kind is not admitted", index)
		}
		if descriptor.Kind != "coverageManifest" {
			componentDigests = append(componentDigests, sourceMaterializationComponentDigestV1{ComponentID: descriptor.ComponentID, Kind: descriptor.Kind, ContentHash: descriptor.ContentHash})
		}
	}
	if world == nil || coverage == nil || (character == nil) == (persona == nil) {
		return nil, sourceMaterializationInvalid("component graph does not contain exactly one typed source/world/coverage")
	}
	if begin.Envelope.SourceRef.Kind == "worldCharacter" && character == nil || begin.Envelope.SourceRef.Kind == "realmPersona" && persona == nil {
		return nil, sourceMaterializationDenied("source kind/component mismatch")
	}

	var sourceUnion sourceMaterializationSourceUnionV2
	var closureUnion sourceMaterializationClosureUnionV1
	var snapshotClosureUnion sourceMaterializationSnapshotClosureUnionV1
	if character != nil {
		closure, err := validateAndBuildCharacterMaterializationClosure(begin, *character, *world, entities, relationships)
		if err != nil {
			return nil, err
		}
		sourceUnion.Character = character
		closureUnion.Character = closure
		snapshotClosureUnion.Character = &sourceMaterializationSnapshotCharacterClosureV1{
			Kind: closure.Kind, BoundEntity: closure.BoundEntity, IncidentRelationships: closure.IncidentRelationships,
			EndpointEntities: closure.EndpointEntities, ExplicitEntities: closure.explicitEntities, ExplicitDependencies: closure.ExplicitDependencies,
		}
	} else {
		if len(entities) != 0 || len(relationships) != 0 || len(begin.Manifest.Components) != 3 {
			return nil, sourceMaterializationDenied("RealmPersona packet invents entity or relationship closure")
		}
		if persona.HomeWorldID != world.ID || persona.Core.InteractionProfile.HomeWorldID != world.ID {
			return nil, sourceMaterializationDenied("RealmPersona home world closure mismatch")
		}
		closure := &sourceMaterializationPersonaClosureV1{Kind: "realmPersona", ExplicitDependencies: []sourceMaterializationDependencyRefV1{}}
		sourceUnion.Persona = persona
		closureUnion.Persona = closure
		snapshotClosureUnion.Persona = &sourceMaterializationSnapshotPersonaClosureV1{Kind: closure.Kind, ExplicitDependencies: closure.ExplicitDependencies}
	}
	if begin.Envelope.SourceRef.WorldID != world.ID || begin.Envelope.SourceRef.SourceID != sourceIDFromMaterializationUnion(sourceUnion) || begin.Envelope.SourceRef.SourceContentHash != sourceHashFromMaterializationUnion(sourceUnion) {
		return nil, sourceMaterializationDenied("sourceRef does not bind decoded canonical source")
	}
	if err := validateSourceMaterializationCoverage(begin, *coverage, componentBytes[begin.Manifest.Components[len(begin.Manifest.Components)-1].ComponentID], character, persona, *world, closureUnion); err != nil {
		return nil, err
	}
	if coverage.CoverageManifestHash != begin.Manifest.Components[len(begin.Manifest.Components)-1].ContentHash {
		return nil, sourceMaterializationDenied("coverage component contentHash mismatch")
	}

	sourceDigests := []sourceMaterializationComponentDigestV1{componentDigests[0]}
	worldDigests := append([]sourceMaterializationComponentDigestV1(nil), componentDigests[1:]...)
	contextHashInput := struct {
		ContextSchemaVersion            string                                   `json:"contextSchemaVersion"`
		SourceComponentDigests          []sourceMaterializationComponentDigestV1 `json:"sourceComponentDigests"`
		WorldAndClosureComponentDigests []sourceMaterializationComponentDigestV1 `json:"worldAndClosureComponentDigests"`
		ClosurePolicyVersion            string                                   `json:"closurePolicyVersion"`
		CoverageManifestHash            string                                   `json:"coverageManifestHash"`
	}{sourceMaterializationContextV1, sourceDigests, worldDigests, sourceMaterializationClosureV1, coverage.CoverageManifestHash}
	contextHash, err := hashSourceMaterializationDomainJCS(sourceMaterializationContextHashDomain, contextHashInput)
	if err != nil {
		return nil, sourceMaterializationInvalid("materialization context hash failed: %v", err)
	}
	contextValue := sourceMaterializationContextValueV1{
		ContextSchemaVersion: sourceMaterializationContextV1, SourceRef: begin.Envelope.SourceRef, OwningWorld: *world,
		DependencyClosure: closureUnion, SourceComponentDigests: sourceDigests, WorldAndClosureComponentDigests: worldDigests,
		ClosurePolicyVersion: sourceMaterializationClosureV1, CoverageManifestHash: coverage.CoverageManifestHash, MaterializationContextHash: contextHash,
	}
	payload := sourceMaterializationPayloadValueV2{
		PayloadSchemaVersion: sourceMaterializationPayloadV2SchemaVersion, PayloadAssemblyVersion: sourceMaterializationAssemblyV1,
		Source: sourceUnion, MaterializationContext: contextValue, CoverageManifest: *coverage,
		CoverageManifestHash: coverage.CoverageManifestHash, MaterializationContextHash: contextHash,
	}
	payloadHash, err := hashSourceMaterializationDomainJCS(sourceMaterializationPayloadHashDomain, payload)
	if err != nil {
		return nil, sourceMaterializationInvalid("semantic payload hash failed: %v", err)
	}
	if payloadHash != begin.Envelope.PayloadHash {
		return nil, sourceMaterializationDenied("semantic payload hash mismatch")
	}
	snapshotInput := sourceMaterializationSnapshotHashInputV1{
		SnapshotSchemaVersion: sourceMaterializationSnapshotV1, Source: sourceUnion, OwningWorld: *world, DependencyClosure: snapshotClosureUnion,
		CoverageManifestHash: coverage.CoverageManifestHash, MaterializationContextHash: contextHash, NormalizationVersion: sourceMaterializationNormalizationV1,
	}
	snapshotHash, err := hashSourceMaterializationDomainJCS(sourceMaterializationSnapshotHashDomain, snapshotInput)
	if err != nil {
		return nil, sourceMaterializationInvalid("snapshot hash failed: %v", err)
	}
	return &normalizedSourceMaterializationV2{
		SourceRef: begin.Envelope.SourceRef, Character: character, Persona: persona, OwningWorld: *world,
		CharacterClosure: snapshotClosureUnion.Character, PersonaClosure: snapshotClosureUnion.Persona, Coverage: *coverage, ComponentDigests: componentDigests,
		CoverageManifestHash: coverage.CoverageManifestHash, MaterializationContextHash: contextHash, PayloadHash: payloadHash,
		PacketID: begin.Envelope.PacketID, PacketHash: begin.PacketHash, Issuer: begin.Envelope.Issuer,
		KeyFingerprint: begin.KeyFingerprint, NormalizationVersion: sourceMaterializationNormalizationV1,
		SnapshotHashInput: snapshotInput, SnapshotHash: snapshotHash,
	}, nil
}

func sourceIDFromMaterializationUnion(value sourceMaterializationSourceUnionV2) string {
	if value.Character != nil {
		return value.Character.ID
	}
	return value.Persona.ID
}

func sourceHashFromMaterializationUnion(value sourceMaterializationSourceUnionV2) string {
	if value.Character != nil {
		return value.Character.ContentHash
	}
	return value.Persona.ContentHash
}
