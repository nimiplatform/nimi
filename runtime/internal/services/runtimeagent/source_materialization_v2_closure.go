package runtimeagent

import (
	"sort"
)

func validateAndBuildCharacterMaterializationClosure(
	begin *verifiedSourceMaterializationBeginV2,
	character sourceMaterializationWorldCharacterV2,
	world sourceMaterializationWorldV1,
	manifestEntities []sourceMaterializationEntityV1,
	manifestRelationships []sourceMaterializationRelationshipV1,
) (*sourceMaterializationCharacterClosureV1, error) {
	if character.WorldID != world.ID {
		return nil, sourceMaterializationDenied("WorldCharacterCore owning world binding mismatch")
	}
	entityByID := make(map[string]sourceMaterializationEntityV1, len(manifestEntities))
	for _, entity := range manifestEntities {
		if entity.WorldID != world.ID {
			return nil, sourceMaterializationDenied("WorldCharacterCore closure has cross-world entity")
		}
		entityByID[entity.ID] = entity
	}
	bound, exists := entityByID[character.EntityID]
	if !exists {
		return nil, sourceMaterializationDenied("WorldCharacterCore bound entity is missing")
	}
	worldEntityIndex := map[string]string{}
	for _, index := range world.Core.Entities {
		worldEntityIndex[index.EntityID] = index.Kind
	}
	for _, entity := range manifestEntities {
		kind, indexed := worldEntityIndex[entity.ID]
		if !indexed || kind != entity.Kind {
			return nil, sourceMaterializationDenied("WorldCore entity index does not resolve closure entity %q", entity.ID)
		}
	}
	worldRelationshipIndex := map[string]struct{ source, target, kind string }{}
	for _, index := range world.Core.Relationships {
		worldRelationshipIndex[index.RelationshipID] = struct{ source, target, kind string }{index.SourceEntityID, index.TargetEntityID, index.Type}
	}
	endpointIDs := map[string]struct{}{}
	seenRelationships := map[string]struct{}{}
	for _, relationship := range manifestRelationships {
		if relationship.WorldID != world.ID || relationship.SourceEntityID != character.EntityID && relationship.TargetEntityID != character.EntityID {
			return nil, sourceMaterializationDenied("WorldCharacterCore closure has non-incident or cross-world relationship")
		}
		if _, duplicate := seenRelationships[relationship.ID]; duplicate {
			return nil, sourceMaterializationDenied("WorldRelationshipCore id is duplicated")
		}
		seenRelationships[relationship.ID] = struct{}{}
		indexed, exists := worldRelationshipIndex[relationship.ID]
		if !exists || indexed.source != relationship.SourceEntityID || indexed.target != relationship.TargetEntityID || indexed.kind != relationship.Type {
			return nil, sourceMaterializationDenied("WorldCore relationship index does not resolve closure relationship %q", relationship.ID)
		}
		for _, endpointID := range []string{relationship.SourceEntityID, relationship.TargetEntityID} {
			if _, exists := entityByID[endpointID]; !exists {
				return nil, sourceMaterializationDenied("WorldRelationshipCore endpoint %q is unresolved", endpointID)
			}
			if endpointID != character.EntityID {
				endpointIDs[endpointID] = struct{}{}
			}
		}
	}
	explicitIDs := map[string]struct{}{}
	explicitDependenciesByID := map[string]sourceMaterializationDependencyRefV1{}
	for _, relationship := range character.Core.Relationships {
		entity, exists := entityByID[relationship.TargetRef.EntityID]
		if !exists {
			return nil, sourceMaterializationDenied("WorldCharacterCore typed relationship target %q is unresolved", relationship.TargetRef.EntityID)
		}
		if entity.WorldID != relationship.TargetRef.WorldID {
			return nil, sourceMaterializationDenied("WorldCharacterCore typed relationship target world mismatch")
		}
		if entity.ID != character.EntityID {
			explicitIDs[entity.ID] = struct{}{}
		}
		explicitDependenciesByID[entity.ID] = sourceMaterializationDependencyRefV1{Kind: "worldEntity", WorldID: entity.WorldID, ID: entity.ID, ContentHash: entity.ContentHash}
	}
	requiredDependencyIDs := map[string]struct{}{}
	for id := range endpointIDs {
		requiredDependencyIDs[id] = struct{}{}
	}
	for id := range explicitIDs {
		requiredDependencyIDs[id] = struct{}{}
	}
	if len(manifestEntities) != len(requiredDependencyIDs)+1 {
		return nil, sourceMaterializationDenied("WorldCharacterCore closure has missing or unreferenced entity components")
	}
	for _, entity := range manifestEntities {
		if entity.ID == character.EntityID {
			continue
		}
		if _, required := requiredDependencyIDs[entity.ID]; !required {
			return nil, sourceMaterializationDenied("WorldCharacterCore closure entity %q is not referenced", entity.ID)
		}
	}
	for _, sceneID := range character.Core.Placement.SceneRefs {
		resolved := false
		for _, scene := range world.Core.Scenes {
			if scene.SceneID == sceneID {
				resolved = true
				break
			}
		}
		if !resolved {
			return nil, sourceMaterializationDenied("WorldCharacterCore placement scene %q is unresolved", sceneID)
		}
	}

	sortedRelationships := make([]sourceMaterializationRelationshipV1, len(manifestRelationships))
	copy(sortedRelationships, manifestRelationships)
	materializationRelationshipOrder(sortedRelationships)
	for index := range sortedRelationships {
		if sortedRelationships[index].ID != manifestRelationships[index].ID {
			return nil, sourceMaterializationDenied("WorldRelationshipCore components are not canonically sorted")
		}
	}
	endpointEntities := make([]sourceMaterializationEntityV1, 0, len(endpointIDs))
	explicitEntities := make([]sourceMaterializationEntityV1, 0, len(explicitIDs))
	dependencyEntities := make([]sourceMaterializationEntityV1, 0, len(requiredDependencyIDs))
	for id := range endpointIDs {
		endpointEntities = append(endpointEntities, entityByID[id])
	}
	for id := range requiredDependencyIDs {
		dependencyEntities = append(dependencyEntities, entityByID[id])
	}
	for id := range explicitIDs {
		if _, endpoint := endpointIDs[id]; !endpoint {
			explicitEntities = append(explicitEntities, entityByID[id])
		}
	}
	materializationEntityOrder(endpointEntities)
	materializationEntityOrder(explicitEntities)
	materializationEntityOrder(dependencyEntities)
	manifestDependencyEntities := make([]sourceMaterializationEntityV1, 0, len(manifestEntities)-1)
	for _, entity := range manifestEntities {
		if entity.ID != character.EntityID {
			manifestDependencyEntities = append(manifestDependencyEntities, entity)
		}
	}
	for index := range dependencyEntities {
		if dependencyEntities[index].ID != manifestDependencyEntities[index].ID {
			return nil, sourceMaterializationDenied("WorldEntityCore components are not canonically sorted")
		}
	}
	explicitDependencies := make([]sourceMaterializationDependencyRefV1, 0, len(explicitDependenciesByID))
	for _, dependency := range explicitDependenciesByID {
		explicitDependencies = append(explicitDependencies, dependency)
	}
	sort.Slice(explicitDependencies, func(i, j int) bool {
		for _, pair := range [][2]string{{explicitDependencies[i].Kind, explicitDependencies[j].Kind}, {explicitDependencies[i].WorldID, explicitDependencies[j].WorldID}, {explicitDependencies[i].ID, explicitDependencies[j].ID}} {
			if order := compareMaterializationUTF8(pair[0], pair[1]); order != 0 {
				return order < 0
			}
		}
		return false
	})
	closure := &sourceMaterializationCharacterClosureV1{
		Kind: "worldCharacter", BoundEntity: bound, IncidentRelationships: sortedRelationships,
		EndpointEntities: endpointEntities, ExplicitDependencies: explicitDependencies,
		explicitEntities: explicitEntities,
	}
	expectedIDs := []string{
		compactMaterializationRef("worldCharacter", world.ID, character.ID),
		compactMaterializationRef("worldCore", world.ID, world.ID),
		compactMaterializationRef("worldEntity", world.ID, bound.ID),
	}
	for _, relationship := range sortedRelationships {
		expectedIDs = append(expectedIDs, compactMaterializationRef("worldRelationship", world.ID, relationship.ID))
	}
	for _, entity := range dependencyEntities {
		expectedIDs = append(expectedIDs, compactMaterializationRef("worldEntity", world.ID, entity.ID))
	}
	expectedIDs = append(expectedIDs, compactMaterializationRef("coverageManifest", "manifest", begin.Envelope.PacketID))
	if len(expectedIDs) != len(begin.Manifest.Components) {
		return nil, sourceMaterializationDenied("WorldCharacterCore canonical component coverage mismatch")
	}
	for index, id := range expectedIDs {
		if begin.Manifest.Components[index].ComponentID != id {
			return nil, sourceMaterializationDenied("WorldCharacterCore component order mismatch at ordinal %d", index)
		}
	}
	return closure, nil
}
