package runtimeagent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
)

func coverageWithoutHash(value sourceMaterializationCoverageManifestV1) (map[string]any, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	decoded, err := decodeSourceMaterializationJSON(encoded)
	if err != nil {
		return nil, err
	}
	record, ok := decoded.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("coverage manifest must be an object")
	}
	delete(record, "coverageManifestHash")
	return record, nil
}

func compactMaterializationRef(kind string, worldID string, id string) string {
	return kind + ":" + worldID + ":" + id
}

func compareMaterializationUTF8(left string, right string) int {
	return bytes.Compare([]byte(left), []byte(right))
}

func buildExpectedSourceMaterializationCoverage(
	begin *verifiedSourceMaterializationBeginV2,
	character *sourceMaterializationWorldCharacterV2,
	persona *sourceMaterializationRealmPersonaV2,
	world sourceMaterializationWorldV1,
	closure sourceMaterializationClosureUnionV1,
) sourceMaterializationCoverageManifestV1 {
	sections := []string{"identity", "presentation", "personaStyle", "contentProfile", "interactionProfile", "assets", "authoring"}
	if character != nil {
		sections = []string{"identity", "presentation", "placement", "biography", "psychology", "knowledge", "relationships", "capabilities", "interactionProfile", "assets", "authoring"}
	}
	sort.Slice(sections, func(i, j int) bool { return compareMaterializationUTF8(sections[i], sections[j]) < 0 })
	requiredSections := make([]sourceMaterializationCoverageRequiredSectionV1, 0, len(sections))
	for _, section := range sections {
		requiredSections = append(requiredSections, sourceMaterializationCoverageRequiredSectionV1{Path: "source.core." + section, State: "present"})
	}
	var avatar, cover *string
	if character != nil {
		avatar = character.Core.Presentation.AvatarResourceRef
		cover = character.Core.Presentation.ProfileCoverResourceRef
	} else {
		avatar = persona.Core.Presentation.AvatarResourceRef
		cover = persona.Core.Presentation.ProfileCoverResourceRef
	}
	optionalRefs := make([]sourceMaterializationCoverageOptionalRefV1, 0, 2)
	for _, item := range []struct {
		path  string
		value *string
	}{
		{"source.core.presentation.avatarResourceRef", avatar},
		{"source.core.presentation.profileCoverResourceRef", cover},
	} {
		if item.value != nil && len(*item.value) > 0 {
			optionalRefs = append(optionalRefs, sourceMaterializationCoverageOptionalRefV1{Path: item.path, RefKind: "resource", RefID: *item.value, State: "resolved"})
		} else {
			reason := "not-declared"
			optionalRefs = append(optionalRefs, sourceMaterializationCoverageOptionalRefV1{Path: item.path, RefKind: "resource", RefID: "absent:" + item.path, State: "omitted", OmissionReason: &reason})
		}
	}
	requiredRefs := []sourceMaterializationCoverageRequiredRefV1{{
		Path: "source.homeWorldId", RefKind: "worldCore", RefID: world.ID, State: "resolved",
	}}
	if character != nil {
		requiredRefs[0].Path = "source.worldId"
	}
	checks := []sourceMaterializationCoverageCrossReferenceV1{{
		CheckID: "source-owning-world", State: "valid",
		SourceRef: compactMaterializationRef(begin.Envelope.SourceRef.Kind, world.ID, begin.Envelope.SourceRef.SourceID),
		TargetRef: compactMaterializationRef("worldCore", world.ID, world.ID),
	}}
	if character != nil {
		sourceRef := compactMaterializationRef("worldCharacter", character.WorldID, character.ID)
		requiredRefs = append(requiredRefs, sourceMaterializationCoverageRequiredRefV1{Path: "source.entityId", RefKind: "worldEntity", RefID: character.EntityID, State: "resolved"})
		checks = append(checks, sourceMaterializationCoverageCrossReferenceV1{CheckID: "source-bound-entity", State: "valid", SourceRef: sourceRef, TargetRef: compactMaterializationRef("worldEntity", character.WorldID, character.EntityID)})
		for index, relationship := range character.Core.Relationships {
			requiredRefs = append(requiredRefs, sourceMaterializationCoverageRequiredRefV1{Path: fmt.Sprintf("source.core.relationships[%d].targetRef", index), RefKind: "worldEntity", RefID: relationship.TargetRef.EntityID, State: "resolved"})
			checks = append(checks, sourceMaterializationCoverageCrossReferenceV1{CheckID: "source-relationship-target:" + relationship.RelationshipID, State: "valid", SourceRef: sourceRef, TargetRef: compactMaterializationRef("worldEntity", relationship.TargetRef.WorldID, relationship.TargetRef.EntityID)})
		}
		for _, relationship := range closure.Character.IncidentRelationships {
			relationshipRef := compactMaterializationRef("worldRelationship", relationship.WorldID, relationship.ID)
			for _, endpoint := range []struct{ label, id string }{{"source", relationship.SourceEntityID}, {"target", relationship.TargetEntityID}} {
				requiredRefs = append(requiredRefs, sourceMaterializationCoverageRequiredRefV1{Path: fmt.Sprintf("dependencyClosure.incidentRelationships[%s].%sEntityId", relationship.ID, endpoint.label), RefKind: "worldEntity", RefID: endpoint.id, State: "resolved"})
				checks = append(checks, sourceMaterializationCoverageCrossReferenceV1{CheckID: fmt.Sprintf("incident-relationship-%s-endpoint:%s", endpoint.label, relationship.ID), State: "valid", SourceRef: relationshipRef, TargetRef: compactMaterializationRef("worldEntity", relationship.WorldID, endpoint.id)})
			}
		}
		for index, sceneID := range character.Core.Placement.SceneRefs {
			requiredRefs = append(requiredRefs, sourceMaterializationCoverageRequiredRefV1{Path: fmt.Sprintf("source.core.placement.sceneRefs[%d]", index), RefKind: "worldScene", RefID: sceneID, State: "resolved"})
			checks = append(checks, sourceMaterializationCoverageCrossReferenceV1{CheckID: "placement-scene:" + sceneID, State: "valid", SourceRef: sourceRef, TargetRef: compactMaterializationRef("worldScene", world.ID, sceneID)})
		}
	} else {
		requiredRefs = append(requiredRefs, sourceMaterializationCoverageRequiredRefV1{Path: "source.core.interactionProfile.homeWorldId", RefKind: "worldCore", RefID: persona.Core.InteractionProfile.HomeWorldID, State: "resolved"})
		checks = append(checks, sourceMaterializationCoverageCrossReferenceV1{CheckID: "persona-interaction-home-world", State: "valid", SourceRef: compactMaterializationRef("realmPersona", persona.HomeWorldID, persona.ID), TargetRef: compactMaterializationRef("worldCore", world.ID, persona.Core.InteractionProfile.HomeWorldID)})
	}
	sort.Slice(requiredRefs, func(i, j int) bool {
		for _, pair := range [][2]string{{requiredRefs[i].Path, requiredRefs[j].Path}, {requiredRefs[i].RefKind, requiredRefs[j].RefKind}, {requiredRefs[i].RefID, requiredRefs[j].RefID}} {
			if compared := compareMaterializationUTF8(pair[0], pair[1]); compared != 0 {
				return compared < 0
			}
		}
		return false
	})
	sort.Slice(checks, func(i, j int) bool { return compareMaterializationUTF8(checks[i].CheckID, checks[j].CheckID) < 0 })
	components := make([]sourceMaterializationCoverageComponentV1, 0, len(begin.Manifest.Components)-1)
	for _, descriptor := range begin.Manifest.Components[:len(begin.Manifest.Components)-1] {
		components = append(components, sourceMaterializationCoverageComponentV1{ComponentID: descriptor.ComponentID, Kind: descriptor.Kind, SchemaVersion: descriptor.SchemaVersion, Revision: descriptor.Revision, ContentHash: descriptor.ContentHash})
	}
	return sourceMaterializationCoverageManifestV1{
		ManifestSchemaVersion: sourceMaterializationCoverageV1, ClosurePolicyVersion: sourceMaterializationClosureV1,
		RequiredSections: requiredSections, RequiredRefs: requiredRefs, OptionalRefs: optionalRefs, Components: components,
		CrossReferenceChecks: checks, AggregateStatus: "complete",
	}
}

func validateSourceMaterializationCoverage(
	begin *verifiedSourceMaterializationBeginV2,
	coverage sourceMaterializationCoverageManifestV1,
	raw []byte,
	character *sourceMaterializationWorldCharacterV2,
	persona *sourceMaterializationRealmPersonaV2,
	world sourceMaterializationWorldV1,
	closure sourceMaterializationClosureUnionV1,
) error {
	if err := requireMaterializationTopFields(raw, "CoverageManifestV1", "manifestSchemaVersion", "closurePolicyVersion", "requiredSections", "requiredRefs", "optionalRefs", "components", "crossReferenceChecks", "aggregateStatus", "coverageManifestHash"); err != nil {
		return err
	}
	if coverage.ManifestSchemaVersion != sourceMaterializationCoverageV1 || coverage.ClosurePolicyVersion != sourceMaterializationClosureV1 || coverage.AggregateStatus != "complete" || !isLowerSHA256(coverage.CoverageManifestHash) {
		return sourceMaterializationInvalid("coverage manifest state/schema/hash is invalid")
	}
	unsigned, err := coverageWithoutHash(coverage)
	if err != nil {
		return sourceMaterializationInvalid("coverage manifest encode failed")
	}
	computedHash, err := hashSourceMaterializationDomainJCS(sourceMaterializationCoverageHashDomain, unsigned)
	if err != nil || computedHash != coverage.CoverageManifestHash {
		return sourceMaterializationDenied("coverage manifest hash mismatch")
	}
	expected := buildExpectedSourceMaterializationCoverage(begin, character, persona, world, closure)
	expectedUnsigned, err := coverageWithoutHash(expected)
	if err != nil {
		return err
	}
	actualCanonical, err := canonicalizeSourceMaterializationJCS(unsigned)
	if err != nil {
		return err
	}
	expectedCanonical, err := canonicalizeSourceMaterializationJCS(expectedUnsigned)
	if err != nil {
		return err
	}
	if !bytes.Equal(actualCanonical, expectedCanonical) {
		return sourceMaterializationDenied("coverage manifest does not prove the canonical complete graph")
	}
	return nil
}
