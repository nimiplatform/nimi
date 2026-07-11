package runtimeagent

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

const (
	agentTurnContextPriorityIdentity      int64 = 1000
	agentTurnContextPriorityCoreBehavior  int64 = 900
	agentTurnContextPriorityWorldBaseline int64 = 800
	agentTurnContextPriorityRelationship  int64 = 700
	agentTurnContextPriorityKnowledge     int64 = 500
	agentTurnContextPriorityOptional      int64 = 100
)

func compileAgentTurnSourceSnapshot(snapshot localAgentSourceSnapshotV1) (map[agentTurnContextLaneID][]agentTurnContextItem, error) {
	if err := validateLocalAgentSourceSnapshotV1(snapshot); err != nil {
		return nil, fmt.Errorf("compile agent turn source snapshot: %w", err)
	}
	items := make(map[agentTurnContextLaneID][]agentTurnContextItem, len(agentTurnContextFixedLaneOrder))
	if err := compileAgentTurnWorld(snapshot, items); err != nil {
		return nil, err
	}
	if snapshot.Character != nil {
		if err := compileAgentTurnCharacter(snapshot, items); err != nil {
			return nil, err
		}
	} else if err := compileAgentTurnPersona(snapshot, items); err != nil {
		return nil, err
	}
	return items, nil
}

func compileAgentTurnCharacter(snapshot localAgentSourceSnapshotV1, items map[agentTurnContextLaneID][]agentTurnContextItem) error {
	character := snapshot.Character
	if character == nil || snapshot.CharacterClosure == nil {
		return fmt.Errorf("compile agent turn Character: typed Character closure is required")
	}
	ref := agentTurnContextItemSourceRef{Kind: "worldCharacter", WorldID: character.WorldID, RefID: character.ID, SchemaVersion: character.SchemaVersion, ContentHash: character.ContentHash}
	core := character.Core
	if err := appendAgentTurnSourceItem(items, agentTurnContextLaneSourceIdentity, "source.identity.character", "character.core.identity", ref, agentTurnContextPriorityIdentity, 0, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("WorldCharacter identity",
			agentTurnContextTextField{Name: "name", Values: []string{core.Identity.Name}},
			agentTurnContextTextField{Name: "summary", Values: []string{core.Identity.Summary}},
			agentTurnContextTextField{Name: "aliases", Values: agentTurnContextOptionalStrings(core.Identity.Aliases)},
		)); err != nil {
		return err
	}
	if err := appendAgentTurnSourceItem(items, agentTurnContextLaneSourceIdentity, "source.presentation.character", "character.core.presentation", ref, agentTurnContextPriorityIdentity-10, 0, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("WorldCharacter presentation",
			agentTurnContextTextField{Name: "display_name", Values: []string{core.Presentation.DisplayName}},
			agentTurnContextTextField{Name: "short_bio", Values: []string{core.Presentation.ShortBio}},
		)); err != nil {
		return err
	}
	if err := appendAgentTurnSourceItem(items, agentTurnContextLaneSourceBehavior, "source.behavior.character.psychology", "character.core.psychology", ref, agentTurnContextPriorityCoreBehavior, 0, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("WorldCharacter psychology",
			agentTurnContextTextField{Name: "drives", Values: core.Psychology.Drives},
			agentTurnContextTextField{Name: "boundaries", Values: core.Psychology.Boundaries},
		)); err != nil {
		return err
	}
	if err := appendAgentTurnSourceItem(items, agentTurnContextLaneSourceBehavior, "source.behavior.character.interaction", "character.core.interactionProfile", ref, agentTurnContextPriorityCoreBehavior-10, 0, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("WorldCharacter interaction profile",
			agentTurnContextTextField{Name: "tone", Values: []string{core.InteractionProfile.Tone}},
			agentTurnContextTextField{Name: "cadence", Values: []string{core.InteractionProfile.Cadence}},
			agentTurnContextTextField{Name: "scenario", Values: agentTurnContextOptionalString(core.InteractionProfile.Scenario)},
		)); err != nil {
		return err
	}
	if err := appendAgentTurnSourceItem(items, agentTurnContextLaneSourceBehavior, "source.behavior.character.descriptive-capabilities", "character.core.capabilities", ref, agentTurnContextPriorityCoreBehavior-20, 0, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("Descriptive source capabilities; these do not grant Runtime tools",
			agentTurnContextTextField{Name: "interaction_modes", Values: core.Capabilities.InteractionModes},
			agentTurnContextTextField{Name: "descriptive_tools", Values: core.Capabilities.Tools},
		)); err != nil {
		return err
	}
	exemplars := agentTurnContextOptionalStrings(core.InteractionProfile.DialogueExemplars)
	for _, exemplar := range exemplars {
		if err := appendAgentTurnDynamicSourceItem(items, agentTurnContextLaneSourceBehavior, "source.behavior.character.exemplar", "character.core.interactionProfile.dialogueExemplars", ref, agentTurnContextPriorityOptional, 0, false, agentTurnContextTruncationExemplar,
			agentTurnContextTypedContent("WorldCharacter dialogue style exemplar", agentTurnContextTextField{Name: "example", Values: []string{exemplar}})); err != nil {
			return err
		}
	}
	if err := appendAgentTurnSourceItem(items, agentTurnContextLaneWorldContext, "source.world.character.placement", "character.core.placement", ref, agentTurnContextPriorityWorldBaseline-10, 0, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("WorldCharacter placement",
			agentTurnContextTextField{Name: "world_id", Values: []string{core.Placement.WorldID}},
			agentTurnContextTextField{Name: "entity_id", Values: []string{core.Placement.EntityID}},
			agentTurnContextTextField{Name: "role", Values: agentTurnContextOptionalString(core.Placement.Role)},
			agentTurnContextTextField{Name: "faction", Values: agentTurnContextOptionalString(core.Placement.Faction)},
			agentTurnContextTextField{Name: "rank", Values: agentTurnContextOptionalString(core.Placement.Rank)},
			agentTurnContextTextField{Name: "scene_refs", Values: core.Placement.SceneRefs},
		)); err != nil {
		return err
	}
	if err := appendAgentTurnEntity(items, snapshot.CharacterClosure.BoundEntity, "character.closure.boundEntity", true); err != nil {
		return err
	}
	for _, entity := range sortedAgentTurnEntities(snapshot.CharacterClosure.EndpointEntities, snapshot.CharacterClosure.ExplicitEntities) {
		if entity.ID == snapshot.CharacterClosure.BoundEntity.ID {
			continue
		}
		if err := appendAgentTurnEntity(items, entity, "character.closure.entities."+entity.ID, false); err != nil {
			return err
		}
	}
	for _, relationship := range sortedAgentTurnCharacterRelationships(core.Relationships) {
		content := agentTurnContextTypedContent("WorldCharacter declared relationship",
			agentTurnContextTextField{Name: "relationship_id", Values: []string{relationship.RelationshipID}},
			agentTurnContextTextField{Name: "target_kind", Values: []string{relationship.TargetRef.Kind}},
			agentTurnContextTextField{Name: "target_world_id", Values: []string{relationship.TargetRef.WorldID}},
			agentTurnContextTextField{Name: "target_entity_id", Values: []string{relationship.TargetRef.EntityID}},
			agentTurnContextTextField{Name: "relation_type", Values: []string{relationship.RelationType}},
			agentTurnContextTextField{Name: "target_label", Values: agentTurnContextOptionalString(relationship.TargetLabel)},
			agentTurnContextTextField{Name: "relation_label", Values: agentTurnContextOptionalString(relationship.RelationLabel)},
			agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(relationship.Summary)},
			agentTurnContextTextField{Name: "note", Values: agentTurnContextOptionalString(relationship.Note)},
		)
		stableID := "source.relationship.character." + relationship.RelationshipID
		if err := appendAgentTurnSourceItem(items, agentTurnContextLaneRelationshipContext, stableID, "character.core.relationships."+relationship.RelationshipID, ref, agentTurnContextPriorityRelationship, 0, true, agentTurnContextTruncationNone, content); err != nil {
			return err
		}
	}
	for _, relationship := range sortedAgentTurnClosureRelationships(snapshot.CharacterClosure.IncidentRelationships) {
		ref := agentTurnContextItemSourceRef{Kind: "worldRelationship", WorldID: relationship.WorldID, RefID: relationship.ID, SchemaVersion: relationship.SchemaVersion, ContentHash: relationship.ContentHash}
		content := agentTurnContextTypedContent("Canonical world relationship",
			agentTurnContextTextField{Name: "source_entity_id", Values: []string{relationship.SourceEntityID}},
			agentTurnContextTextField{Name: "target_entity_id", Values: []string{relationship.TargetEntityID}},
			agentTurnContextTextField{Name: "type", Values: []string{relationship.Type}},
			agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(relationship.Core.Presentation.Summary)},
		)
		if err := appendAgentTurnSourceItem(items, agentTurnContextLaneRelationshipContext, "source.relationship.world."+relationship.ID, "character.closure.incidentRelationships."+relationship.ID, ref, agentTurnContextPriorityRelationship-10, 0, true, agentTurnContextTruncationNone, content); err != nil {
			return err
		}
	}
	for _, topic := range core.Knowledge.Topics {
		if err := appendAgentTurnDynamicSourceItem(items, agentTurnContextLaneSourceKnowledge, "source.knowledge.character.topic", "character.core.knowledge.topics", ref, agentTurnContextPriorityKnowledge, 0, false, agentTurnContextTruncationKnowledge,
			agentTurnContextTypedContent("WorldCharacter knowledge topic", agentTurnContextTextField{Name: "topic", Values: []string{topic}})); err != nil {
			return err
		}
	}
	if len(core.Knowledge.Constraints) > 0 {
		if err := appendAgentTurnSourceItem(items, agentTurnContextLaneSourceKnowledge, "source.knowledge.character.constraints", "character.core.knowledge.constraints", ref, agentTurnContextPriorityKnowledge+100, 0, true, agentTurnContextTruncationNone,
			agentTurnContextTypedContent("WorldCharacter knowledge constraints", agentTurnContextTextField{Name: "constraints", Values: core.Knowledge.Constraints})); err != nil {
			return err
		}
	}
	for _, milestone := range core.Biography.Milestones {
		content := agentTurnContextTypedContent("WorldCharacter biography milestone",
			agentTurnContextTextField{Name: "title", Values: []string{milestone.Title}},
			agentTurnContextTextField{Name: "summary", Values: []string{milestone.Summary}},
		)
		if err := appendAgentTurnSourceItem(items, agentTurnContextLaneSourceKnowledge, "source.knowledge.character.milestone."+milestone.MilestoneID, "character.core.biography.milestones."+milestone.MilestoneID, ref, agentTurnContextPriorityOptional, 0, false, agentTurnContextTruncationKnowledge, content); err != nil {
			return err
		}
	}
	for _, note := range core.Biography.SourceNotes {
		if err := appendAgentTurnDynamicSourceItem(items, agentTurnContextLaneSourceKnowledge, "source.knowledge.character.note", "character.core.biography.sourceNotes", ref, agentTurnContextPriorityOptional-10, 0, false, agentTurnContextTruncationKnowledge,
			agentTurnContextTypedContent("WorldCharacter biography source note", agentTurnContextTextField{Name: "note", Values: []string{note}})); err != nil {
			return err
		}
	}
	return nil
}

func compileAgentTurnPersona(snapshot localAgentSourceSnapshotV1, items map[agentTurnContextLaneID][]agentTurnContextItem) error {
	persona := snapshot.Persona
	if persona == nil || snapshot.PersonaClosure == nil {
		return fmt.Errorf("compile agent turn Persona: typed Persona closure is required")
	}
	ref := agentTurnContextItemSourceRef{Kind: "realmPersona", WorldID: persona.HomeWorldID, RefID: persona.ID, SchemaVersion: persona.SchemaVersion, ContentHash: persona.ContentHash}
	core := persona.Core
	if err := appendAgentTurnSourceItem(items, agentTurnContextLaneSourceIdentity, "source.identity.persona", "persona.core.identity", ref, agentTurnContextPriorityIdentity, 0, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("RealmPersona identity",
			agentTurnContextTextField{Name: "handle", Values: []string{core.Identity.Handle}},
			agentTurnContextTextField{Name: "name", Values: []string{core.Identity.Name}},
			agentTurnContextTextField{Name: "summary", Values: []string{core.Identity.Summary}},
			agentTurnContextTextField{Name: "concept", Values: agentTurnContextOptionalString(core.Identity.Concept)},
			agentTurnContextTextField{Name: "aliases", Values: agentTurnContextOptionalStrings(core.Identity.Aliases)},
		)); err != nil {
		return err
	}
	if err := appendAgentTurnSourceItem(items, agentTurnContextLaneSourceIdentity, "source.presentation.persona", "persona.core.presentation", ref, agentTurnContextPriorityIdentity-10, 0, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("RealmPersona presentation",
			agentTurnContextTextField{Name: "display_name", Values: []string{core.Presentation.DisplayName}},
			agentTurnContextTextField{Name: "profile_line", Values: []string{core.Presentation.ProfileLine}},
			agentTurnContextTextField{Name: "short_bio", Values: agentTurnContextOptionalString(core.Presentation.ShortBio)},
		)); err != nil {
		return err
	}
	if err := appendAgentTurnSourceItem(items, agentTurnContextLaneSourceBehavior, "source.behavior.persona.style", "persona.core.personaStyle", ref, agentTurnContextPriorityCoreBehavior, 0, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("RealmPersona style",
			agentTurnContextTextField{Name: "archetype", Values: []string{core.PersonaStyle.Archetype}},
			agentTurnContextTextField{Name: "traits", Values: core.PersonaStyle.Traits},
			agentTurnContextTextField{Name: "voice", Values: []string{core.PersonaStyle.Voice}},
			agentTurnContextTextField{Name: "pacing", Values: []string{core.PersonaStyle.Pacing}},
			agentTurnContextTextField{Name: "communication_style", Values: agentTurnContextOptionalString(core.PersonaStyle.CommunicationStyle)},
		)); err != nil {
		return err
	}
	if err := appendAgentTurnSourceItem(items, agentTurnContextLaneSourceBehavior, "source.behavior.persona.interaction", "persona.core.interactionProfile", ref, agentTurnContextPriorityCoreBehavior-10, 0, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("RealmPersona interaction profile",
			agentTurnContextTextField{Name: "home_world_id", Values: []string{core.InteractionProfile.HomeWorldID}},
			agentTurnContextTextField{Name: "interaction_modes", Values: core.InteractionProfile.InteractionModes},
			agentTurnContextTextField{Name: "scenario", Values: agentTurnContextOptionalString(core.InteractionProfile.Scenario)},
		)); err != nil {
		return err
	}
	if len(core.ContentProfile.Boundaries) > 0 {
		if err := appendAgentTurnSourceItem(items, agentTurnContextLaneSourceBehavior, "source.behavior.persona.boundaries", "persona.core.contentProfile.boundaries", ref, agentTurnContextPriorityCoreBehavior-20, 0, true, agentTurnContextTruncationNone,
			agentTurnContextTypedContent("RealmPersona boundaries", agentTurnContextTextField{Name: "boundaries", Values: core.ContentProfile.Boundaries})); err != nil {
			return err
		}
	}
	for _, guideline := range core.ContentProfile.Guidelines {
		content := agentTurnContextTypedContent("RealmPersona guideline",
			agentTurnContextTextField{Name: "statement", Values: []string{guideline.Statement}},
			agentTurnContextTextField{Name: "source", Values: agentTurnContextOptionalString(guideline.Source)},
		)
		if err := appendAgentTurnSourceItem(items, agentTurnContextLaneSourceBehavior, "source.behavior.persona.guideline."+guideline.GuidelineID, "persona.core.contentProfile.guidelines."+guideline.GuidelineID, ref, agentTurnContextPriorityCoreBehavior-30, 0, true, agentTurnContextTruncationNone, content); err != nil {
			return err
		}
	}
	exemplars := append(agentTurnContextOptionalStrings(core.PersonaStyle.DialogueExemplars), agentTurnContextOptionalStrings(core.InteractionProfile.DialogueExemplars)...)
	for _, exemplar := range exemplars {
		if err := appendAgentTurnDynamicSourceItem(items, agentTurnContextLaneSourceBehavior, "source.behavior.persona.exemplar", "persona.core.dialogueExemplars", ref, agentTurnContextPriorityOptional, 0, false, agentTurnContextTruncationExemplar,
			agentTurnContextTypedContent("RealmPersona dialogue style exemplar", agentTurnContextTextField{Name: "example", Values: []string{exemplar}})); err != nil {
			return err
		}
	}
	for _, topic := range core.ContentProfile.Topics {
		if err := appendAgentTurnDynamicSourceItem(items, agentTurnContextLaneSourceKnowledge, "source.knowledge.persona.topic", "persona.core.contentProfile.topics", ref, agentTurnContextPriorityKnowledge, 0, false, agentTurnContextTruncationKnowledge,
			agentTurnContextTypedContent("RealmPersona content topic", agentTurnContextTextField{Name: "topic", Values: []string{topic}})); err != nil {
			return err
		}
	}
	return nil
}

func compileAgentTurnWorld(snapshot localAgentSourceSnapshotV1, items map[agentTurnContextLaneID][]agentTurnContextItem) error {
	world := snapshot.OwningWorld
	ref := agentTurnContextItemSourceRef{Kind: "worldCore", WorldID: world.ID, RefID: world.ID, SchemaVersion: world.SchemaVersion, ContentHash: world.ContentHash}
	core := world.Core
	baseline := agentTurnContextTypedContent("Canonical world baseline",
		agentTurnContextTextField{Name: "name", Values: []string{core.Identity.Name}},
		agentTurnContextTextField{Name: "summary", Values: []string{core.Identity.Summary}},
		agentTurnContextTextField{Name: "world_type", Values: agentTurnContextOptionalString(core.Identity.WorldType)},
		agentTurnContextTextField{Name: "tagline", Values: agentTurnContextOptionalString(core.Identity.Tagline)},
		agentTurnContextTextField{Name: "genre", Values: agentTurnContextOptionalString(core.Identity.Genre)},
		agentTurnContextTextField{Name: "themes", Values: agentTurnContextOptionalStrings(core.Identity.Themes)},
		agentTurnContextTextField{Name: "era", Values: agentTurnContextOptionalString(core.Identity.Era)},
		agentTurnContextTextField{Name: "divergences", Values: agentTurnContextOptionalStrings(core.Identity.Divergences)},
		agentTurnContextTextField{Name: "entity_kinds", Values: core.Ontology.EntityKinds},
		agentTurnContextTextField{Name: "relationship_types", Values: core.Ontology.RelationshipTypes},
		agentTurnContextTextField{Name: "time_mode", Values: []string{core.TimeModel.Mode}},
		agentTurnContextTextField{Name: "time_flow_ratio", Values: []string{strconv.FormatFloat(core.TimeModel.FlowRatio, 'g', -1, 64)}},
	)
	if err := appendAgentTurnSourceItem(items, agentTurnContextLaneWorldContext, "source.world.baseline", "world.core.baseline", ref, agentTurnContextPriorityWorldBaseline, 0, true, agentTurnContextTruncationNone, baseline); err != nil {
		return err
	}
	for _, system := range sortedAgentTurnWorldSystems(core.Systems) {
		content := agentTurnContextTypedContent("Canonical world system",
			agentTurnContextTextField{Name: "name", Values: []string{system.Name}},
			agentTurnContextTextField{Name: "summary", Values: []string{system.Summary}},
			agentTurnContextTextField{Name: "principles", Values: agentTurnContextOptionalStrings(system.Principles)},
		)
		if err := appendAgentTurnSourceItem(items, agentTurnContextLaneWorldContext, "source.world.system."+system.SystemID, "world.core.systems."+system.SystemID, ref, agentTurnContextPriorityOptional, 0, false, agentTurnContextTruncationWorldDetail, content); err != nil {
			return err
		}
	}
	for _, scene := range sortedAgentTurnWorldScenes(core.Scenes) {
		content := agentTurnContextTypedContent("Canonical world scene",
			agentTurnContextTextField{Name: "name", Values: []string{scene.Name}},
			agentTurnContextTextField{Name: "summary", Values: []string{scene.Summary}},
			agentTurnContextTextField{Name: "entity_refs", Values: agentTurnContextOptionalStrings(scene.EntityRefs)},
		)
		if err := appendAgentTurnSourceItem(items, agentTurnContextLaneWorldContext, "source.world.scene."+scene.SceneID, "world.core.scenes."+scene.SceneID, ref, agentTurnContextPriorityOptional-10, 0, false, agentTurnContextTruncationWorldDetail, content); err != nil {
			return err
		}
	}
	for _, event := range sortedAgentTurnWorldEvents(core.Timeline.Events) {
		content := agentTurnContextTypedContent("Canonical world timeline event",
			agentTurnContextTextField{Name: "title", Values: []string{event.Title}},
			agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(event.Summary)},
			agentTurnContextTextField{Name: "timestamp", Values: agentTurnContextOptionalString(event.Timestamp)},
			agentTurnContextTextField{Name: "starts_at", Values: agentTurnContextOptionalString(event.StartsAt)},
			agentTurnContextTextField{Name: "ends_at", Values: agentTurnContextOptionalString(event.EndsAt)},
		)
		if err := appendAgentTurnSourceItem(items, agentTurnContextLaneWorldContext, "source.world.timeline."+event.EventID, "world.core.timeline.events."+event.EventID, ref, agentTurnContextPriorityOptional-20, 0, false, agentTurnContextTruncationWorldDetail, content); err != nil {
			return err
		}
	}
	for _, entity := range sortedAgentTurnWorldEntities(core.Entities) {
		content := agentTurnContextTypedContent("Canonical world entity reference",
			agentTurnContextTextField{Name: "entity_id", Values: []string{entity.EntityID}},
			agentTurnContextTextField{Name: "kind", Values: []string{entity.Kind}},
			agentTurnContextTextField{Name: "label", Values: agentTurnContextOptionalString(entity.Label)},
			agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(entity.Summary)},
		)
		if err := appendAgentTurnSourceItem(items, agentTurnContextLaneWorldContext, "source.world.entity-ref."+entity.EntityID, "world.core.entities."+entity.EntityID, ref, agentTurnContextPriorityOptional-30, 0, false, agentTurnContextTruncationWorldDetail, content); err != nil {
			return err
		}
	}
	for _, relationship := range sortedAgentTurnWorldRelationships(core.Relationships) {
		content := agentTurnContextTypedContent("Canonical world relationship reference",
			agentTurnContextTextField{Name: "source_entity_id", Values: []string{relationship.SourceEntityID}},
			agentTurnContextTextField{Name: "target_entity_id", Values: []string{relationship.TargetEntityID}},
			agentTurnContextTextField{Name: "type", Values: []string{relationship.Type}},
			agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(relationship.Summary)},
		)
		if err := appendAgentTurnSourceItem(items, agentTurnContextLaneRelationshipContext, "source.world.relationship-ref."+relationship.RelationshipID, "world.core.relationships."+relationship.RelationshipID, ref, agentTurnContextPriorityOptional, 0, false, agentTurnContextTruncationWorldDetail, content); err != nil {
			return err
		}
	}
	return nil
}

func appendAgentTurnEntity(items map[agentTurnContextLaneID][]agentTurnContextItem, entity sourceMaterializationEntityV1, path string, mandatory bool) error {
	ref := agentTurnContextItemSourceRef{Kind: "worldEntity", WorldID: entity.WorldID, RefID: entity.ID, SchemaVersion: entity.SchemaVersion, ContentHash: entity.ContentHash}
	content := agentTurnContextTypedContent("Canonical world entity",
		agentTurnContextTextField{Name: "name", Values: []string{entity.Core.Identity.Name}},
		agentTurnContextTextField{Name: "summary", Values: []string{entity.Core.Identity.Summary}},
		agentTurnContextTextField{Name: "kind", Values: []string{entity.Core.Identity.Kind}},
		agentTurnContextTextField{Name: "aliases", Values: agentTurnContextOptionalStrings(entity.Core.Identity.Aliases)},
		agentTurnContextTextField{Name: "tags", Values: entity.Core.Classification.Tags},
	)
	class := agentTurnContextTruncationWorldDetail
	priority := agentTurnContextPriorityOptional
	if mandatory {
		class = agentTurnContextTruncationNone
		priority = agentTurnContextPriorityWorldBaseline - 20
	}
	return appendAgentTurnSourceItem(items, agentTurnContextLaneWorldContext, "source.world.entity."+entity.ID, path, ref, priority, 0, mandatory, class, content)
}

func appendAgentTurnDynamicSourceItem(items map[agentTurnContextLaneID][]agentTurnContextItem, laneID agentTurnContextLaneID, prefix, path string, ref agentTurnContextItemSourceRef, priority, rank int64, mandatory bool, class agentTurnContextTruncationClass, content string) error {
	digest, err := hashAgentTurnContextRef(prefix, ref.RefID, ref.SchemaVersion, path+"\x00"+content)
	if err != nil {
		return err
	}
	return appendAgentTurnSourceItem(items, laneID, prefix+"."+digest[:16], path+"."+digest[:16], ref, priority, rank, mandatory, class, content)
}

func appendAgentTurnSourceItem(items map[agentTurnContextLaneID][]agentTurnContextItem, laneID agentTurnContextLaneID, stableID, path string, ref agentTurnContextItemSourceRef, priority, rank int64, mandatory bool, class agentTurnContextTruncationClass, content string) error {
	item, err := newAgentTurnContextItem(laneID, stableID, path, ref, agentTurnContextAuthorityRealmSnapshot, agentTurnContextTrustValidatedSource, priority, rank, mandatory, class, []agentTurnContextSegment{{Role: "system", Content: content}}, nil)
	if err != nil {
		return err
	}
	for _, existing := range items[laneID] {
		if existing.StableID == item.StableID {
			if existing.ContentHash == item.ContentHash {
				return nil
			}
			return fmt.Errorf("source compiler produced conflicting stable item id %q", item.StableID)
		}
	}
	items[laneID] = append(items[laneID], item)
	return nil
}

func sortedAgentTurnEntities(groups ...[]sourceMaterializationEntityV1) []sourceMaterializationEntityV1 {
	var out []sourceMaterializationEntityV1
	for _, group := range groups {
		out = append(out, group...)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func sortedAgentTurnCharacterRelationships(input []struct {
	RelationshipID string `json:"relationshipId"`
	TargetRef      struct {
		Kind     string `json:"kind"`
		WorldID  string `json:"worldId"`
		EntityID string `json:"entityId"`
	} `json:"targetRef"`
	RelationType  string  `json:"relationType"`
	TargetLabel   *string `json:"targetLabel,omitempty"`
	RelationLabel *string `json:"relationLabel,omitempty"`
	Note          *string `json:"note,omitempty"`
	Summary       *string `json:"summary,omitempty"`
}) []struct {
	RelationshipID string `json:"relationshipId"`
	TargetRef      struct {
		Kind     string `json:"kind"`
		WorldID  string `json:"worldId"`
		EntityID string `json:"entityId"`
	} `json:"targetRef"`
	RelationType  string  `json:"relationType"`
	TargetLabel   *string `json:"targetLabel,omitempty"`
	RelationLabel *string `json:"relationLabel,omitempty"`
	Note          *string `json:"note,omitempty"`
	Summary       *string `json:"summary,omitempty"`
} {
	out := append([]struct {
		RelationshipID string `json:"relationshipId"`
		TargetRef      struct {
			Kind     string `json:"kind"`
			WorldID  string `json:"worldId"`
			EntityID string `json:"entityId"`
		} `json:"targetRef"`
		RelationType  string  `json:"relationType"`
		TargetLabel   *string `json:"targetLabel,omitempty"`
		RelationLabel *string `json:"relationLabel,omitempty"`
		Note          *string `json:"note,omitempty"`
		Summary       *string `json:"summary,omitempty"`
	}(nil), input...)
	sort.Slice(out, func(i, j int) bool { return out[i].RelationshipID < out[j].RelationshipID })
	return out
}

func sortedAgentTurnClosureRelationships(input []sourceMaterializationRelationshipV1) []sourceMaterializationRelationshipV1 {
	out := append([]sourceMaterializationRelationshipV1(nil), input...)
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func sortedAgentTurnWorldSystems(input []struct {
	SystemID   string                          `json:"systemId"`
	Name       string                          `json:"name"`
	Summary    string                          `json:"summary"`
	Principles *[]string                       `json:"principles,omitempty"`
	Parameters *sourceMaterializationJSONValue `json:"parameters,omitempty"`
}) []struct {
	SystemID   string                          `json:"systemId"`
	Name       string                          `json:"name"`
	Summary    string                          `json:"summary"`
	Principles *[]string                       `json:"principles,omitempty"`
	Parameters *sourceMaterializationJSONValue `json:"parameters,omitempty"`
} {
	out := append([]struct {
		SystemID   string                          `json:"systemId"`
		Name       string                          `json:"name"`
		Summary    string                          `json:"summary"`
		Principles *[]string                       `json:"principles,omitempty"`
		Parameters *sourceMaterializationJSONValue `json:"parameters,omitempty"`
	}(nil), input...)
	sort.Slice(out, func(i, j int) bool { return out[i].SystemID < out[j].SystemID })
	return out
}

func sortedAgentTurnWorldScenes(input []struct {
	SceneID    string    `json:"sceneId"`
	Name       string    `json:"name"`
	Summary    string    `json:"summary"`
	EntityRefs *[]string `json:"entityRefs,omitempty"`
	AssetRefs  *[]string `json:"assetRefs,omitempty"`
}) []struct {
	SceneID    string    `json:"sceneId"`
	Name       string    `json:"name"`
	Summary    string    `json:"summary"`
	EntityRefs *[]string `json:"entityRefs,omitempty"`
	AssetRefs  *[]string `json:"assetRefs,omitempty"`
} {
	out := append([]struct {
		SceneID    string    `json:"sceneId"`
		Name       string    `json:"name"`
		Summary    string    `json:"summary"`
		EntityRefs *[]string `json:"entityRefs,omitempty"`
		AssetRefs  *[]string `json:"assetRefs,omitempty"`
	}(nil), input...)
	sort.Slice(out, func(i, j int) bool { return out[i].SceneID < out[j].SceneID })
	return out
}

func sortedAgentTurnWorldEvents(input []struct {
	EventID       string    `json:"eventId"`
	Title         string    `json:"title"`
	Summary       *string   `json:"summary,omitempty"`
	Sequence      *float64  `json:"sequence,omitempty"`
	Timestamp     *string   `json:"timestamp,omitempty"`
	StartsAt      *string   `json:"startsAt,omitempty"`
	EndsAt        *string   `json:"endsAt,omitempty"`
	Importance    *float64  `json:"importance,omitempty"`
	SceneRefs     *[]string `json:"sceneRefs,omitempty"`
	LocationRefs  *[]string `json:"locationRefs,omitempty"`
	EntityRefs    *[]string `json:"entityRefs,omitempty"`
	CharacterRefs *[]string `json:"characterRefs,omitempty"`
	SourceRefs    *[]string `json:"sourceRefs,omitempty"`
}) []struct {
	EventID       string    `json:"eventId"`
	Title         string    `json:"title"`
	Summary       *string   `json:"summary,omitempty"`
	Sequence      *float64  `json:"sequence,omitempty"`
	Timestamp     *string   `json:"timestamp,omitempty"`
	StartsAt      *string   `json:"startsAt,omitempty"`
	EndsAt        *string   `json:"endsAt,omitempty"`
	Importance    *float64  `json:"importance,omitempty"`
	SceneRefs     *[]string `json:"sceneRefs,omitempty"`
	LocationRefs  *[]string `json:"locationRefs,omitempty"`
	EntityRefs    *[]string `json:"entityRefs,omitempty"`
	CharacterRefs *[]string `json:"characterRefs,omitempty"`
	SourceRefs    *[]string `json:"sourceRefs,omitempty"`
} {
	out := append([]struct {
		EventID       string    `json:"eventId"`
		Title         string    `json:"title"`
		Summary       *string   `json:"summary,omitempty"`
		Sequence      *float64  `json:"sequence,omitempty"`
		Timestamp     *string   `json:"timestamp,omitempty"`
		StartsAt      *string   `json:"startsAt,omitempty"`
		EndsAt        *string   `json:"endsAt,omitempty"`
		Importance    *float64  `json:"importance,omitempty"`
		SceneRefs     *[]string `json:"sceneRefs,omitempty"`
		LocationRefs  *[]string `json:"locationRefs,omitempty"`
		EntityRefs    *[]string `json:"entityRefs,omitempty"`
		CharacterRefs *[]string `json:"characterRefs,omitempty"`
		SourceRefs    *[]string `json:"sourceRefs,omitempty"`
	}(nil), input...)
	sort.Slice(out, func(i, j int) bool {
		if out[i].Sequence != nil && out[j].Sequence != nil && *out[i].Sequence != *out[j].Sequence {
			return *out[i].Sequence < *out[j].Sequence
		}
		return out[i].EventID < out[j].EventID
	})
	return out
}

func sortedAgentTurnWorldEntities(input []struct {
	EntityID string  `json:"entityId"`
	Kind     string  `json:"kind"`
	Label    *string `json:"label,omitempty"`
	Summary  *string `json:"summary,omitempty"`
}) []struct {
	EntityID string  `json:"entityId"`
	Kind     string  `json:"kind"`
	Label    *string `json:"label,omitempty"`
	Summary  *string `json:"summary,omitempty"`
} {
	out := append([]struct {
		EntityID string  `json:"entityId"`
		Kind     string  `json:"kind"`
		Label    *string `json:"label,omitempty"`
		Summary  *string `json:"summary,omitempty"`
	}(nil), input...)
	sort.Slice(out, func(i, j int) bool { return out[i].EntityID < out[j].EntityID })
	return out
}

func sortedAgentTurnWorldRelationships(input []struct {
	RelationshipID string                          `json:"relationshipId"`
	SourceEntityID string                          `json:"sourceEntityId"`
	TargetEntityID string                          `json:"targetEntityId"`
	Type           string                          `json:"type"`
	Summary        *string                         `json:"summary,omitempty"`
	Attributes     *sourceMaterializationJSONValue `json:"attributes,omitempty"`
}) []struct {
	RelationshipID string                          `json:"relationshipId"`
	SourceEntityID string                          `json:"sourceEntityId"`
	TargetEntityID string                          `json:"targetEntityId"`
	Type           string                          `json:"type"`
	Summary        *string                         `json:"summary,omitempty"`
	Attributes     *sourceMaterializationJSONValue `json:"attributes,omitempty"`
} {
	out := append([]struct {
		RelationshipID string                          `json:"relationshipId"`
		SourceEntityID string                          `json:"sourceEntityId"`
		TargetEntityID string                          `json:"targetEntityId"`
		Type           string                          `json:"type"`
		Summary        *string                         `json:"summary,omitempty"`
		Attributes     *sourceMaterializationJSONValue `json:"attributes,omitempty"`
	}(nil), input...)
	sort.Slice(out, func(i, j int) bool { return out[i].RelationshipID < out[j].RelationshipID })
	return out
}

func agentTurnContextNoArbitraryJSONDump(content string) bool {
	trimmed := strings.TrimSpace(content)
	return !strings.HasPrefix(trimmed, "{") && !strings.HasPrefix(trimmed, "[")
}
