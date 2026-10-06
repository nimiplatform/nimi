package runtimeagent

import (
	"fmt"
	"slices"
	"sort"
)

type localAgentSourceUnitBindingV1 struct {
	UnitID      string
	SourceRef   agentTurnContextItemSourceRef
	ContentHash string
}

// @nimi-authority: rule.nimi.runtime.agent-service.r058
func localAgentTurnNamedSourceRefsV1(snapshot localAgentSourceSnapshotV2) ([]localAgentNamedSourceRefV1, error) {
	var names []localAgentNamedSourceRefV1
	closure := snapshot.Semantic.DependencyClosure
	entities := append([]sourceMaterializationEntityRecordV3(nil), closure.ExplicitEntities...)
	if closure.BoundEntity != nil {
		entities = append(entities, *closure.BoundEntity)
	}
	if closure.EndpointEntities != nil {
		entities = append(entities, (*closure.EndpointEntities)...)
	}
	seen := make(map[string]struct{})
	actorRef := realmSourceCompilerSourceRefV3(snapshot)
	for _, entity := range realmSourceCompilerSortedByIDV3(entities, func(value sourceMaterializationEntityRecordV3) string { return value.ID }) {
		ref := agentTurnContextItemSourceRef{Kind: "worldEntity", WorldID: entity.WorldID, RefID: entity.ID, SchemaVersion: entity.SchemaVersion, ContentHash: entity.ContentHash}
		key := localAgentTurnSourceRefKeyV1(ref)
		if _, present := seen[key]; present {
			continue
		}
		seen[key] = struct{}{}
		core, err := decodeRealmSourceCompilerEntityCoreV3(entity.Core, "snapshot source-name metadata")
		if err != nil {
			return nil, err
		}
		names = append(names, localAgentNamedSourceRefV1{SourceRef: ref, Name: core.Identity.Name, Aliases: append([]string(nil), agentTurnContextOptionalStrings(core.Identity.Aliases)...)})
		if snapshot.Semantic.SourceRef.WorldEntityRef != nil && entity.ID == snapshot.Semantic.SourceRef.WorldEntityRef.EntityID && entity.WorldID == snapshot.Semantic.SourceRef.WorldEntityRef.WorldID {
			actorRef = ref
		}
	}
	profile, err := decodeRealmSourceCompilerProfileV3(snapshot.Semantic.Source.Profile)
	if err != nil {
		return nil, fmt.Errorf("decode source name metadata: %w", err)
	}
	profileAliases := append([]string(nil), agentTurnContextOptionalStrings(profile.Identity.Aliases)...)
	merged := false
	for index := range names {
		if localAgentTurnSourceRefKeyV1(names[index].SourceRef) == localAgentTurnSourceRefKeyV1(actorRef) && names[index].Name == profile.Identity.Name {
			names[index].Aliases = append(names[index].Aliases, profileAliases...)
			merged = true
			break
		}
	}
	if !merged {
		names = append(names, localAgentNamedSourceRefV1{SourceRef: actorRef, Name: profile.Identity.Name, Aliases: profileAliases})
	}
	world, err := decodeRealmSourceCompilerWorldCoreV3(snapshot.Semantic.OwningWorld.Core)
	if err != nil {
		return nil, fmt.Errorf("decode world name metadata: %w", err)
	}
	names = append(names, localAgentNamedSourceRefV1{SourceRef: agentTurnContextItemSourceRef{Kind: "worldCore", WorldID: snapshot.Semantic.OwningWorld.ID, RefID: snapshot.Semantic.OwningWorld.ID, SchemaVersion: snapshot.Semantic.OwningWorld.SchemaVersion, ContentHash: snapshot.Semantic.OwningWorld.ContentHash}, Name: world.Identity.Name})
	for index := range names {
		sort.Strings(names[index].Aliases)
		names[index].Aliases = slices.Compact(names[index].Aliases)
	}
	sort.Slice(names, func(i, j int) bool {
		left, right := localAgentTurnSourceRefKeyV1(names[i].SourceRef), localAgentTurnSourceRefKeyV1(names[j].SourceRef)
		if left != right {
			return left < right
		}
		return names[i].Name < names[j].Name
	})
	return names, nil
}
