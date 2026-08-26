package runtimeagent

import (
	"fmt"
	"slices"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const localAgentSourcePartitionSchemaV1 = "nimi.runtime.local-agent-source-partition/v1"
const localAgentSourcePartitionHashDomainV1 = "nimi.runtime.local-agent-source-partition/v1\x00"

// This is the provider-neutral semantic text envelope bound, not a tokenizer
// estimate. The projector never truncates: a larger semantic item becomes a
// typed omission while its exact source/provenance binding remains covered.
const localAgentCognitionTextMaxBytes = 8 * 1024

type localAgentLorebookV1 struct {
	Character sourceMaterializationCharacterLorebookDeclarationV1 `json:"character"`
	World     sourceMaterializationWorldLorebookDeclarationV1     `json:"world"`
}

type localAgentCognitionSourceUnitV1 struct {
	StableID       string                        `json:"stableId"`
	Category       string                        `json:"category"`
	SourcePath     string                        `json:"sourcePath"`
	SourceRef      agentTurnContextItemSourceRef `json:"sourceRef"`
	Text           string                        `json:"text"`
	ProvenanceRefs []string                      `json:"provenanceRefs"`
	Priority       int64                         `json:"priority"`
}

type localAgentCognitionSourceOmissionV1 struct {
	StableID       string                        `json:"stableId"`
	Category       string                        `json:"category"`
	SourcePath     string                        `json:"sourcePath"`
	SourceRef      agentTurnContextItemSourceRef `json:"sourceRef"`
	OmissionReason string                        `json:"omissionReason"`
	ProvenanceRefs []string                      `json:"provenanceRefs"`
}

// @nimi-authority: rule.nimi.runtime.agent-service.r058
// @nimi-authority: rule.nimi.runtime.memory-world.r019
type localAgentSourcePartitionV1 struct {
	SchemaVersion  string                                `json:"schemaVersion"`
	Lorebook       localAgentLorebookV1                  `json:"lorebook"`
	CognitionUnits []localAgentCognitionSourceUnitV1     `json:"cognitionUnits"`
	Omissions      []localAgentCognitionSourceOmissionV1 `json:"omissions"`
	PartitionHash  string                                `json:"partitionHash"`
}

// localAgentSourcePartitionBindingV1 is the only partition state persisted by
// Runtime. The non-lorebook unit bodies and omissions are Cognition-owned
// derived state and exist in Runtime only while materializing or replaying the
// immutable snapshot.
type localAgentSourcePartitionBindingV1 struct {
	SchemaVersion string               `json:"schemaVersion"`
	Lorebook      localAgentLorebookV1 `json:"lorebook"`
	UnitCount     uint32               `json:"unitCount"`
	OmissionCount uint32               `json:"omissionCount"`
	PartitionHash string               `json:"partitionHash"`
}

func (value localAgentSourcePartitionV1) binding() localAgentSourcePartitionBindingV1 {
	return localAgentSourcePartitionBindingV1{
		SchemaVersion: value.SchemaVersion,
		Lorebook:      value.Lorebook,
		UnitCount:     uint32(len(value.CognitionUnits)),
		OmissionCount: uint32(len(value.Omissions)),
		PartitionHash: value.PartitionHash,
	}
}

func projectLocalAgentSourcePartitionV1(snapshot localAgentSourceSnapshotV2) (localAgentSourcePartitionV1, error) {
	partition := localAgentSourcePartitionV1{
		SchemaVersion: localAgentSourcePartitionSchemaV1,
		Lorebook: localAgentLorebookV1{
			Character: snapshot.Semantic.Source.LorebookDeclaration,
			World:     snapshot.Semantic.OwningWorld.LorebookDeclaration,
		},
		CognitionUnits: make([]localAgentCognitionSourceUnitV1, 0),
		Omissions:      []localAgentCognitionSourceOmissionV1{},
	}
	seenSourcePaths := make(map[string]localAgentCognitionSourceUnitV1)
	seenCoverageIDs := make(map[string]struct{})
	if err := projectLocalAgentTypedCorpusV1(snapshot, &partition, seenSourcePaths, seenCoverageIDs); err != nil {
		return localAgentSourcePartitionV1{}, err
	}
	sort.Slice(partition.CognitionUnits, func(i, j int) bool {
		return partition.CognitionUnits[i].StableID < partition.CognitionUnits[j].StableID
	})
	sort.Slice(partition.Omissions, func(i, j int) bool {
		return partition.Omissions[i].StableID < partition.Omissions[j].StableID
	})
	partitionHash, err := hashLocalAgentSourcePartitionV1(partition)
	if err != nil {
		return localAgentSourcePartitionV1{}, err
	}
	partition.PartitionHash = partitionHash
	return partition, validateLocalAgentSourcePartitionV1(partition)
}

func appendLocalAgentSemanticCoverageUnitsV1(
	snapshot localAgentSourceSnapshotV2,
	partition *localAgentSourcePartitionV1,
	seenSourcePaths map[string]localAgentCognitionSourceUnitV1,
	seenCoverageIDs map[string]struct{},
) error {
	if partition == nil {
		return fmt.Errorf("LocalAgent Cognition partition is unavailable")
	}
	closure := snapshot.Semantic.DependencyClosure
	entities := append([]sourceMaterializationEntityRecordV3(nil), closure.ExplicitEntities...)
	relationships := []sourceMaterializationRelationshipRecordV3(nil)
	if closure.BoundEntity != nil {
		entities = append(entities, *closure.BoundEntity)
	}
	if closure.EndpointEntities != nil {
		entities = append(entities, (*closure.EndpointEntities)...)
	}
	if closure.IncidentRelationships != nil {
		relationships = append(relationships, (*closure.IncidentRelationships)...)
	}
	if closure.ExplicitRelationships != nil {
		relationships = append(relationships, (*closure.ExplicitRelationships)...)
	}
	worldRef := agentTurnContextItemSourceRef{Kind: "worldCore", WorldID: snapshot.Semantic.OwningWorld.ID, RefID: snapshot.Semantic.OwningWorld.ID, SchemaVersion: snapshot.Semantic.OwningWorld.SchemaVersion, ContentHash: snapshot.Semantic.OwningWorld.ContentHash}
	if len(entities) == 0 {
		if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, "source.world.closure.entities", "world_entity", "semanticPayload.materializationContext.dependencyClosure.entities", worldRef, "explicit_source_section_empty"); err != nil {
			return err
		}
	}
	if len(relationships) == 0 {
		if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, "source.relationship.closure.none", "relationship_detail", "semanticPayload.materializationContext.dependencyClosure.relationships", worldRef, "explicit_source_section_empty"); err != nil {
			return err
		}
	}
	seenEntities := make(map[string]struct{}, len(entities))
	for _, entity := range realmSourceCompilerSortedByIDV3(entities, func(value sourceMaterializationEntityRecordV3) string { return value.ID }) {
		if _, duplicate := seenEntities[entity.ID]; duplicate {
			continue
		}
		seenEntities[entity.ID] = struct{}{}
		core, err := decodeRealmSourceCompilerEntityCoreV3(entity.Core, "semanticPayload.materializationContext.dependencyClosure.entities."+entity.ID+".core")
		if err != nil {
			return err
		}
		ref := agentTurnContextItemSourceRef{Kind: "worldEntity", WorldID: entity.WorldID, RefID: entity.ID, SchemaVersion: entity.SchemaVersion, ContentHash: entity.ContentHash}
		entityPath := "semanticPayload.materializationContext.dependencyClosure.entities." + entity.ID
		if err := appendLocalAgentCognitionUnitV1(partition, seenSourcePaths, seenCoverageIDs, localAgentCognitionSourceUnitV1{StableID: "source.world.entity." + entity.ID, Category: "world_entity", SourcePath: entityPath, SourceRef: ref, Text: agentTurnContextTypedContent("Canonical world entity",
			agentTurnContextTextField{Name: "name", Values: []string{core.Identity.Name}}, agentTurnContextTextField{Name: "summary", Values: []string{core.Identity.Summary}}, agentTurnContextTextField{Name: "kind", Values: []string{core.Identity.Kind}}, agentTurnContextTextField{Name: "aliases", Values: agentTurnContextOptionalStrings(core.Identity.Aliases)}, agentTurnContextTextField{Name: "tags", Values: core.Classification.Tags}, agentTurnContextTextField{Name: "source_categories", Values: agentTurnContextOptionalStrings(core.Classification.SourceCategories)}), Priority: agentTurnContextV3PriorityOptional}); err != nil {
			return err
		}
		factsPath := "semanticPayload.materializationContext.dependencyClosure.entities." + entity.ID + ".core.facts"
		if len(core.Facts) == 0 {
			if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, "source.world.fact.entity."+entity.ID+".none", "world_fact", factsPath, ref, "explicit_source_section_empty"); err != nil {
				return err
			}
		} else {
			for index, fact := range core.Facts {
				text, provenanceRefs, semanticPresent, err := splitLocalAgentCognitionProvenanceV1(fact)
				if err != nil {
					return fmt.Errorf("project LocalAgent world entity fact: %w", err)
				}
				stableID := fmt.Sprintf("source.world.fact.entity.%s.%d", entity.ID, index)
				path := fmt.Sprintf("%s.%d", factsPath, index)
				category := explicitLocalAgentFactCategoryV1(fact, core.Classification.SourceCategories)
				if !semanticPresent {
					if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, stableID, category, path, ref, "provenance_only", provenanceRefs); err != nil {
						return err
					}
					continue
				}
				if err := appendLocalAgentCognitionUnitV1(partition, seenSourcePaths, seenCoverageIDs, localAgentCognitionSourceUnitV1{StableID: stableID, Category: category, SourcePath: path, SourceRef: ref, Text: text, ProvenanceRefs: provenanceRefs, Priority: agentTurnContextV3PriorityOptional}); err != nil {
					return err
				}
			}
		}
		if err := appendLocalAgentCognitionJSONWithProvenanceV1(partition, seenSourcePaths, seenCoverageIDs, "source.world.entity."+entity.ID+".evidence", "source_evidence", "semanticPayload.materializationContext.dependencyClosure.entities."+entity.ID+".core.evidence", ref, core.Evidence); err != nil {
			return err
		}
		if err := appendLocalAgentCognitionJSONOrOmissionV1(partition, seenSourcePaths, seenCoverageIDs, "source.world.entity."+entity.ID+".assets", "source_asset_detail", "semanticPayload.materializationContext.dependencyClosure.entities."+entity.ID+".core.assets", ref, core.Assets); err != nil {
			return err
		}
	}
	seenRelationships := make(map[string]struct{}, len(relationships))
	for _, relationship := range realmSourceCompilerSortedByIDV3(relationships, func(value sourceMaterializationRelationshipRecordV3) string { return value.ID }) {
		if _, duplicate := seenRelationships[relationship.ID]; duplicate {
			continue
		}
		seenRelationships[relationship.ID] = struct{}{}
		core, err := decodeRealmSourceCompilerRelationshipCoreV3(relationship.Core, "semanticPayload.materializationContext.dependencyClosure.relationships."+relationship.ID+".core")
		if err != nil {
			return err
		}
		ref := agentTurnContextItemSourceRef{Kind: "worldRelationship", WorldID: relationship.WorldID, RefID: relationship.ID, SchemaVersion: relationship.SchemaVersion, ContentHash: relationship.ContentHash}
		if err := appendLocalAgentCognitionUnitV1(partition, seenSourcePaths, seenCoverageIDs, localAgentCognitionSourceUnitV1{StableID: "source.relationship.closure." + relationship.ID, Category: "relationship_detail", SourcePath: "semanticPayload.materializationContext.dependencyClosure.relationships." + relationship.ID, SourceRef: ref, Text: agentTurnContextTypedContent("Canonical world relationship",
			agentTurnContextTextField{Name: "source_entity_id", Values: []string{relationship.SourceEntityID}}, agentTurnContextTextField{Name: "target_entity_id", Values: []string{relationship.TargetEntityID}}, agentTurnContextTextField{Name: "type", Values: []string{relationship.Type}}, agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(core.Presentation.Summary)}), Priority: agentTurnContextV3PriorityOptional}); err != nil {
			return err
		}
		if err := appendLocalAgentCognitionJSONWithProvenanceV1(partition, seenSourcePaths, seenCoverageIDs, "source.relationship.evidence."+relationship.ID, "source_evidence", "semanticPayload.materializationContext.dependencyClosure.relationships."+relationship.ID+".core.evidence", ref, core.Evidence); err != nil {
			return err
		}
		if core.Attributes != nil {
			if err := appendLocalAgentCognitionJSONOrOmissionV1(partition, seenSourcePaths, seenCoverageIDs, "source.relationship.attributes."+relationship.ID, "relationship_detail", "semanticPayload.materializationContext.dependencyClosure.relationships."+relationship.ID+".core.attributes", ref, *core.Attributes); err != nil {
				return err
			}
		} else if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, "source.relationship.attributes."+relationship.ID, "relationship_detail", "semanticPayload.materializationContext.dependencyClosure.relationships."+relationship.ID+".core.attributes", ref, "optional_source_section_absent"); err != nil {
			return err
		}
	}
	return nil
}

func explicitLocalAgentFactCategoryV1(value sourceMaterializationJSONValue, sourceCategories *[]string) string {
	explicit := make([]string, 0)
	if record, ok := value.interfaceValue().(map[string]any); ok {
		if factType, ok := record["type"].(string); ok {
			explicit = append(explicit, factType)
		}
	}
	if sourceCategories != nil {
		explicit = append(explicit, (*sourceCategories)...)
	}
	for _, category := range explicit {
		switch strings.ToLower(strings.TrimSpace(category)) {
		case "work", "creative-work", "authored-work":
			return "work"
		case "preference", "preference-fact":
			return "preference"
		}
	}
	return "world_fact"
}

func appendLocalAgentCognitionJSONOrOmissionV1(partition *localAgentSourcePartitionV1, seenSourcePaths map[string]localAgentCognitionSourceUnitV1, seenCoverageIDs map[string]struct{}, stableID, category, path string, ref agentTurnContextItemSourceRef, value sourceMaterializationJSONValue) error {
	text, err := canonicalLocalAgentCognitionJSONTextV1(value)
	if err != nil {
		return err
	}
	if text == "{}" || text == "[]" || text == "null" {
		return appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, stableID, category, path, ref, "explicit_source_section_empty")
	}
	return appendLocalAgentCognitionUnitV1(partition, seenSourcePaths, seenCoverageIDs, localAgentCognitionSourceUnitV1{StableID: stableID, Category: category, SourcePath: path, SourceRef: ref, Text: text, Priority: agentTurnContextV3PriorityOptional})
}

func appendLocalAgentCognitionJSONWithProvenanceV1(partition *localAgentSourcePartitionV1, seenSourcePaths map[string]localAgentCognitionSourceUnitV1, seenCoverageIDs map[string]struct{}, stableID, category, path string, ref agentTurnContextItemSourceRef, value sourceMaterializationJSONValue) error {
	text, provenanceRefs, semanticPresent, err := splitLocalAgentCognitionProvenanceV1(value)
	if err != nil {
		return err
	}
	if !semanticPresent {
		return appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, stableID, category, path, ref, "provenance_only", provenanceRefs)
	}
	return appendLocalAgentCognitionUnitV1(partition, seenSourcePaths, seenCoverageIDs, localAgentCognitionSourceUnitV1{StableID: stableID, Category: category, SourcePath: path, SourceRef: ref, Text: text, ProvenanceRefs: provenanceRefs, Priority: agentTurnContextV3PriorityOptional})
}

func splitLocalAgentCognitionProvenanceV1(value sourceMaterializationJSONValue) (string, []string, bool, error) {
	generic := value.interfaceValue()
	record, ok := generic.(map[string]any)
	if !ok {
		text, err := canonicalLocalAgentCognitionJSONTextV1(value)
		return text, []string{}, text != "{}" && text != "[]" && text != "null", err
	}
	semantic := make(map[string]any, len(record))
	for key, field := range record {
		if key != "sourceRefs" {
			semantic[key] = field
		}
	}
	provenanceRefs := []string{}
	if rawRefs, present := record["sourceRefs"]; present {
		items, valid := rawRefs.([]any)
		if !valid {
			return "", nil, false, fmt.Errorf("LocalAgent Cognition provenance refs are not an array")
		}
		provenanceRefs = make([]string, 0, len(items))
		for _, item := range items {
			ref, valid := item.(string)
			if !valid {
				return "", nil, false, fmt.Errorf("LocalAgent Cognition provenance ref is not text")
			}
			provenanceRefs = append(provenanceRefs, ref)
		}
	}
	raw, err := canonicalizeSourceMaterializationRealmV3(semantic)
	if err != nil {
		return "", nil, false, err
	}
	text := string(raw)
	return text, provenanceRefs, text != "{}", nil
}

func canonicalLocalAgentCognitionJSONTextV1(value sourceMaterializationJSONValue) (string, error) {
	raw, err := canonicalizeSourceMaterializationRealmV3(value.interfaceValue())
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func appendLocalAgentCognitionUnitV1(partition *localAgentSourcePartitionV1, seenSourcePaths map[string]localAgentCognitionSourceUnitV1, seenCoverageIDs map[string]struct{}, unit localAgentCognitionSourceUnitV1) error {
	if unit.ProvenanceRefs == nil {
		unit.ProvenanceRefs = []string{}
	} else {
		unit.ProvenanceRefs = append([]string(nil), unit.ProvenanceRefs...)
	}
	if err := validateLocalAgentCognitionTextV1(unit.Text); err != nil {
		if strings.TrimSpace(unit.Text) != "" && strings.TrimSpace(unit.Text) == unit.Text && utf8.ValidString(unit.Text) && len([]byte(unit.Text)) > localAgentCognitionTextMaxBytes {
			return appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, unit.StableID, unit.Category, unit.SourcePath, unit.SourceRef, "semantic_text_exceeds_ingestion_bound", unit.ProvenanceRefs)
		}
		return err
	}
	if _, duplicate := seenCoverageIDs[unit.StableID]; duplicate {
		return fmt.Errorf("LocalAgent Cognition coverage id %q is duplicated", unit.StableID)
	}
	pathKey := localAgentSourcePathIdentityV1(unit.SourceRef, unit.SourcePath)
	if existing, duplicate := seenSourcePaths[pathKey]; duplicate {
		if existing.Category != unit.Category || existing.Text != unit.Text || existing.Priority != unit.Priority || !slices.Equal(existing.ProvenanceRefs, unit.ProvenanceRefs) {
			return fmt.Errorf("LocalAgent Cognition source path %q has conflicting projections", unit.SourcePath)
		}
		return nil
	}
	seenCoverageIDs[unit.StableID] = struct{}{}
	seenSourcePaths[pathKey] = unit
	partition.CognitionUnits = append(partition.CognitionUnits, unit)
	return nil
}

func appendLocalAgentCognitionOmissionV1(partition *localAgentSourcePartitionV1, seenCoverageIDs map[string]struct{}, stableID, category, path string, ref agentTurnContextItemSourceRef, reason string, provenance ...[]string) error {
	if _, duplicate := seenCoverageIDs[stableID]; duplicate {
		return fmt.Errorf("LocalAgent Cognition coverage id %q is duplicated", stableID)
	}
	provenanceRefs := []string{}
	if len(provenance) > 0 {
		provenanceRefs = append(provenanceRefs, provenance[0]...)
	}
	seenCoverageIDs[stableID] = struct{}{}
	partition.Omissions = append(partition.Omissions, localAgentCognitionSourceOmissionV1{StableID: stableID, Category: category, SourcePath: path, SourceRef: ref, OmissionReason: reason, ProvenanceRefs: provenanceRefs})
	return nil
}

func localAgentSourcePathIdentityV1(ref agentTurnContextItemSourceRef, sourcePath string) string {
	return strings.Join([]string{ref.Kind, ref.WorldID, ref.RefID, ref.SchemaVersion, ref.ContentHash, sourcePath}, "\x00")
}

func projectLocalAgentTypedCorpusV1(snapshot localAgentSourceSnapshotV2, partition *localAgentSourcePartitionV1, seenSourcePaths map[string]localAgentCognitionSourceUnitV1, seenCoverageIDs map[string]struct{}) error {
	profile, err := decodeRealmSourceCompilerProfileV3(snapshot.Semantic.Source.Profile)
	if err != nil {
		return err
	}
	world, err := decodeRealmSourceCompilerWorldCoreV3(snapshot.Semantic.OwningWorld.Core)
	if err != nil {
		return err
	}
	characterRef := realmSourceCompilerSourceRefV3(snapshot)
	worldRef := agentTurnContextItemSourceRef{Kind: "worldCore", WorldID: snapshot.Semantic.OwningWorld.ID, RefID: snapshot.Semantic.OwningWorld.ID, SchemaVersion: snapshot.Semantic.OwningWorld.SchemaVersion, ContentHash: snapshot.Semantic.OwningWorld.ContentHash}
	appendUnit := func(stableID, category, path string, ref agentTurnContextItemSourceRef, priority int64, heading string, fields ...agentTurnContextTextField) error {
		return appendLocalAgentCognitionUnitV1(partition, seenSourcePaths, seenCoverageIDs, localAgentCognitionSourceUnitV1{StableID: stableID, Category: category, SourcePath: path, SourceRef: ref, Text: agentTurnContextTypedContent(heading, fields...), Priority: priority})
	}
	appendOptionalStrings := func(stableID, category, path string, ref agentTurnContextItemSourceRef, priority int64, heading, field string, values []string) error {
		if len(values) == 0 {
			return appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, stableID, category, path, ref, "explicit_source_section_empty")
		}
		return appendUnit(stableID, category, path, ref, priority, heading, agentTurnContextTextField{Name: field, Values: values})
	}
	if err := appendUnit("source.identity", "character_identity_detail", "semanticPayload.canonicalSource.profile.identity", characterRef, agentTurnContextV3PriorityIdentity, "Source character identity detail",
		agentTurnContextTextField{Name: "name", Values: []string{profile.Identity.Name}},
		agentTurnContextTextField{Name: "summary", Values: []string{profile.Identity.Summary}},
		agentTurnContextTextField{Name: "aliases", Values: agentTurnContextOptionalStrings(profile.Identity.Aliases)},
		agentTurnContextTextField{Name: "handle", Values: agentTurnContextOptionalString(profile.Identity.Handle)}); err != nil {
		return err
	}
	if err := appendUnit("source.presentation", "character_identity_detail", "semanticPayload.canonicalSource.profile.presentation", characterRef, agentTurnContextV3PriorityIdentity-10, "Source character presentation detail",
		agentTurnContextTextField{Name: "display_name", Values: []string{profile.Presentation.DisplayName}},
		agentTurnContextTextField{Name: "profile_line", Values: agentTurnContextOptionalString(profile.Presentation.ProfileLine)},
		agentTurnContextTextField{Name: "short_bio", Values: agentTurnContextOptionalString(profile.Presentation.ShortBio)},
		agentTurnContextTextField{Name: "avatar_resource_ref", Values: agentTurnContextOptionalString(profile.Presentation.AvatarResourceRef)},
		agentTurnContextTextField{Name: "profile_cover_resource_ref", Values: agentTurnContextOptionalString(profile.Presentation.ProfileCoverResourceRef)}); err != nil {
		return err
	}
	assetValues := append(realmSourceCompilerProfileAssetRefsV3(profile.Assets.ResourceRefs), realmSourceCompilerProfileAssetIntentsV3(profile.Assets.Intents)...)
	assetValues = append(assetValues, realmSourceCompilerProfileOptionalAssetRefsV3(profile.Assets.ExternalRefs)...)
	if err := appendOptionalStrings("source.assets", "source_asset_detail", "semanticPayload.canonicalSource.profile.assets", characterRef, agentTurnContextV3PriorityOptional, "Proof-covered source asset detail", "assets", assetValues); err != nil {
		return err
	}
	if err := appendUnit("source.biography.summary", "biography_event", "semanticPayload.canonicalSource.profile.narrative.summary", characterRef, agentTurnContextV3PriorityKnowledge, "Source biography detail", agentTurnContextTextField{Name: "summary", Values: []string{profile.Narrative.Summary}}); err != nil {
		return err
	}
	if err := appendOptionalStrings("source.behavior.archetype", "behavior_detail", "semanticPayload.canonicalSource.profile.narrative.archetype", characterRef, agentTurnContextV3PriorityCoreBehavior, "Source behavior archetype", "archetype", agentTurnContextOptionalString(profile.Narrative.Archetype)); err != nil {
		return err
	}
	if err := appendOptionalStrings("source.behavior.traits", "behavior_detail", "semanticPayload.canonicalSource.profile.narrative.traits", characterRef, agentTurnContextV3PriorityCoreBehavior, "Source behavior traits", "traits", agentTurnContextOptionalStrings(profile.Narrative.Traits)); err != nil {
		return err
	}
	if profile.Narrative.Milestones == nil || len(*profile.Narrative.Milestones) == 0 {
		if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, "source.biography.milestones", "biography_event", "semanticPayload.canonicalSource.profile.narrative.milestones", characterRef, "explicit_source_section_empty"); err != nil {
			return err
		}
	} else {
		for _, milestone := range realmSourceCompilerSortedByIDV3(*profile.Narrative.Milestones, func(value realmSourceCompilerProfileMilestoneV3) string { return value.MilestoneID }) {
			if err := appendUnit("source.biography.milestone."+milestone.MilestoneID, "biography_event", "semanticPayload.canonicalSource.profile.narrative.milestones."+milestone.MilestoneID, characterRef, agentTurnContextV3PriorityOptional, "Source biography event",
				agentTurnContextTextField{Name: "sequence", Values: realmSourceCompilerOptionalFloatV3(milestone.Sequence)},
				agentTurnContextTextField{Name: "title", Values: agentTurnContextOptionalString(milestone.Title)},
				agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(milestone.Summary)}); err != nil {
				return err
			}
		}
	}
	interaction := profile.InteractionProfile
	if err := appendUnit("source.interaction", "speaking_interaction_detail", "semanticPayload.canonicalSource.profile.interactionProfile", characterRef, agentTurnContextV3PriorityCoreBehavior, "Source speaking and interaction detail",
		agentTurnContextTextField{Name: "interaction_modes", Values: interaction.InteractionModes},
		agentTurnContextTextField{Name: "tone", Values: agentTurnContextOptionalString(interaction.Tone)},
		agentTurnContextTextField{Name: "cadence", Values: agentTurnContextOptionalString(interaction.Cadence)},
		agentTurnContextTextField{Name: "scenario", Values: agentTurnContextOptionalString(interaction.Scenario)},
		agentTurnContextTextField{Name: "greeting", Values: agentTurnContextOptionalString(interaction.Greeting)},
		agentTurnContextTextField{Name: "greeting_variants", Values: agentTurnContextOptionalStrings(interaction.GreetingVariants)}); err != nil {
		return err
	}
	if interaction.DialogueExemplars == nil || len(*interaction.DialogueExemplars) == 0 {
		if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, "source.dialogue-exemplars", "dialogue_exemplar", "semanticPayload.canonicalSource.profile.interactionProfile.dialogueExemplars", characterRef, "explicit_source_section_empty"); err != nil {
			return err
		}
	} else {
		for _, exemplar := range realmSourceCompilerSortedByIDV3(*interaction.DialogueExemplars, func(value realmSourceCompilerDialogueExemplarV3) string { return value.ExemplarID }) {
			if err := appendUnit("source.dialogue-exemplar."+exemplar.ExemplarID, "dialogue_exemplar", "semanticPayload.canonicalSource.profile.interactionProfile.dialogueExemplars."+exemplar.ExemplarID, characterRef, agentTurnContextV3PriorityOptional, "Source dialogue exemplar",
				agentTurnContextTextField{Name: "user", Values: agentTurnContextOptionalString(exemplar.User)},
				agentTurnContextTextField{Name: "character", Values: []string{exemplar.Character}}); err != nil {
				return err
			}
		}
	}
	if profile.Psychology == nil {
		if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, "source.psychology", "behavior_detail", "semanticPayload.canonicalSource.profile.psychology", characterRef, "optional_source_section_absent"); err != nil {
			return err
		}
	} else {
		if err := appendOptionalStrings("source.psychology.drives", "behavior_detail", "semanticPayload.canonicalSource.profile.psychology.drives", characterRef, agentTurnContextV3PriorityOptional, "Source psychology drives", "drives", agentTurnContextOptionalStrings(profile.Psychology.Drives)); err != nil {
			return err
		}
		if err := appendOptionalStrings("source.psychology.boundaries", "source_constraint_detail", "semanticPayload.canonicalSource.profile.psychology.boundaries", characterRef, agentTurnContextV3PriorityOptional, "Source behavior boundaries", "boundaries", agentTurnContextOptionalStrings(profile.Psychology.Boundaries)); err != nil {
			return err
		}
	}
	if profile.Knowledge == nil {
		if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, "source.knowledge", "source_knowledge_detail", "semanticPayload.canonicalSource.profile.knowledge", characterRef, "optional_source_section_absent"); err != nil {
			return err
		}
	} else {
		if err := appendOptionalStrings("source.knowledge.topics", "source_knowledge_detail", "semanticPayload.canonicalSource.profile.knowledge.topics", characterRef, agentTurnContextV3PriorityKnowledge, "Typed source knowledge topics", "topics", agentTurnContextOptionalStrings(profile.Knowledge.Topics)); err != nil {
			return err
		}
		if err := appendOptionalStrings("source.knowledge.constraints", "source_constraint_detail", "semanticPayload.canonicalSource.profile.knowledge.constraints", characterRef, agentTurnContextV3PriorityKnowledge, "Typed source constraints", "constraints", agentTurnContextOptionalStrings(profile.Knowledge.Constraints)); err != nil {
			return err
		}
	}
	if profile.Capabilities == nil {
		if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, "source.descriptive-capabilities", "behavior_detail", "semanticPayload.canonicalSource.profile.capabilities", characterRef, "optional_source_section_absent"); err != nil {
			return err
		}
	} else if err := appendOptionalStrings("source.descriptive-capabilities", "behavior_detail", "semanticPayload.canonicalSource.profile.capabilities.tools", characterRef, agentTurnContextV3PriorityOptional, "Descriptive source capabilities; these grant no Runtime tool", "tools", realmSourceCompilerProfileToolsV3(profile.Capabilities.Tools)); err != nil {
		return err
	}
	if profile.Relationships == nil || len(*profile.Relationships) == 0 {
		if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, "source.relationship.profile.none", "relationship_detail", "semanticPayload.canonicalSource.profile.relationships", characterRef, "explicit_source_section_empty"); err != nil {
			return err
		}
	} else {
		for _, relationship := range realmSourceCompilerSortedByIDV3(*profile.Relationships, func(value realmSourceCompilerProfileRelationshipV3) string { return value.RelationshipID }) {
			if err := appendUnit("source.relationship.profile."+relationship.RelationshipID, "relationship_detail", "semanticPayload.canonicalSource.profile.relationships."+relationship.RelationshipID, characterRef, agentTurnContextV3PriorityRelationship, "Declared source relationship",
				agentTurnContextTextField{Name: "target_kind", Values: []string{relationship.TargetRef.Kind}},
				agentTurnContextTextField{Name: "target_world_id", Values: []string{relationship.TargetRef.WorldID}},
				agentTurnContextTextField{Name: "target_entity_id", Values: []string{relationship.TargetRef.EntityID}},
				agentTurnContextTextField{Name: "relation_type", Values: []string{relationship.RelationType}},
				agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(relationship.Summary)}); err != nil {
				return err
			}
		}
	}
	if err := appendUnit("source.world.identity", "world_setting_detail", "semanticPayload.materializationContext.owningWorld.core.identity", worldRef, agentTurnContextV3PriorityWorldBaseline, "Owning world identity and setting detail",
		agentTurnContextTextField{Name: "name", Values: []string{world.Identity.Name}},
		agentTurnContextTextField{Name: "summary", Values: []string{world.Identity.Summary}},
		agentTurnContextTextField{Name: "world_type", Values: agentTurnContextOptionalString(world.Identity.WorldType)},
		agentTurnContextTextField{Name: "tagline", Values: worldIdentityTaglineV1(world)},
		agentTurnContextTextField{Name: "genre", Values: agentTurnContextOptionalString(world.Identity.Genre)},
		agentTurnContextTextField{Name: "themes", Values: agentTurnContextOptionalStrings(world.Identity.Themes)},
		agentTurnContextTextField{Name: "era", Values: agentTurnContextOptionalString(world.Identity.Era)},
		agentTurnContextTextField{Name: "divergences", Values: agentTurnContextOptionalStrings(world.Identity.Divergences)}); err != nil {
		return err
	}
	worldPresentationPresent := world.Presentation.Title != nil || world.Presentation.DisplayName != nil || world.Presentation.Tagline != nil || world.Presentation.Palette != nil || world.Presentation.IconResourceRef != nil || world.Presentation.BannerResourceRef != nil
	if !worldPresentationPresent {
		if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, "source.world.presentation", "world_setting_detail", "semanticPayload.materializationContext.owningWorld.core.presentation", worldRef, "explicit_source_section_empty"); err != nil {
			return err
		}
	} else if err := appendUnit("source.world.presentation", "world_setting_detail", "semanticPayload.materializationContext.owningWorld.core.presentation", worldRef, agentTurnContextV3PriorityOptional, "Owning world presentation detail",
		agentTurnContextTextField{Name: "title", Values: agentTurnContextOptionalString(world.Presentation.Title)},
		agentTurnContextTextField{Name: "display_name", Values: agentTurnContextOptionalString(world.Presentation.DisplayName)},
		agentTurnContextTextField{Name: "tagline", Values: agentTurnContextOptionalString(world.Presentation.Tagline)},
		agentTurnContextTextField{Name: "palette", Values: agentTurnContextOptionalStrings(world.Presentation.Palette)},
		agentTurnContextTextField{Name: "icon_resource_ref", Values: agentTurnContextOptionalString(world.Presentation.IconResourceRef)},
		agentTurnContextTextField{Name: "banner_resource_ref", Values: agentTurnContextOptionalString(world.Presentation.BannerResourceRef)}); err != nil {
		return err
	}
	if err := appendUnit("source.world.ontology", "world_setting_detail", "semanticPayload.materializationContext.owningWorld.core.ontology", worldRef, agentTurnContextV3PriorityWorldBaseline, "Owning world ontology detail",
		agentTurnContextTextField{Name: "entity_kinds", Values: world.Ontology.EntityKinds},
		agentTurnContextTextField{Name: "relationship_types", Values: world.Ontology.RelationshipTypes}); err != nil {
		return err
	}
	if world.Ontology.Concepts == nil || len(*world.Ontology.Concepts) == 0 {
		if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, "source.world.concepts", "world_fact", "semanticPayload.materializationContext.owningWorld.core.ontology.concepts", worldRef, "explicit_source_section_empty"); err != nil {
			return err
		}
	} else {
		for _, concept := range realmSourceCompilerSortedByIDV3(*world.Ontology.Concepts, func(value realmSourceCompilerWorldConceptV3) string { return value.ConceptID }) {
			if err := appendUnit("source.world.concept."+concept.ConceptID, "world_fact", "semanticPayload.materializationContext.owningWorld.core.ontology.concepts."+concept.ConceptID, worldRef, agentTurnContextV3PriorityOptional, "Canonical world concept",
				agentTurnContextTextField{Name: "name", Values: []string{concept.Name}}, agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(concept.Summary)}); err != nil {
				return err
			}
		}
	}
	if err := appendUnit("source.world.time-model", "world_setting_detail", "semanticPayload.materializationContext.owningWorld.core.timeModel", worldRef, agentTurnContextV3PriorityWorldBaseline, "Owning world time model",
		agentTurnContextTextField{Name: "mode", Values: []string{world.TimeModel.Mode}},
		agentTurnContextTextField{Name: "flow_ratio", Values: []string{strconv.FormatFloat(world.TimeModel.FlowRatio, 'g', -1, 64)}},
		agentTurnContextTextField{Name: "is_paused", Values: localAgentOptionalBoolTextV1(world.TimeModel.IsPaused)},
		agentTurnContextTextField{Name: "real_started_at", Values: []string{world.TimeModel.Anchor.RealStartedAt}},
		agentTurnContextTextField{Name: "world_started_at", Values: []string{world.TimeModel.Anchor.WorldStartedAt}},
		agentTurnContextTextField{Name: "world_started_at_display", Values: []string{world.TimeModel.Anchor.WorldStartedAtDisplay}},
		agentTurnContextTextField{Name: "paused_world_time", Values: localAgentNullableStringTextV1(world.TimeModel.PausedWorldTime)},
		agentTurnContextTextField{Name: "calendar", Values: localAgentNullableStringTextV1(world.TimeModel.Calendar)},
		agentTurnContextTextField{Name: "display_format", Values: localAgentNullableStringTextV1(world.TimeModel.DisplayFormat)}); err != nil {
		return err
	}
	if snapshot.Semantic.SourceRef.Kind == "worldCharacter" {
		placement := snapshot.Semantic.SourceRef.WorldEntityRef
		bound := snapshot.Semantic.DependencyClosure.BoundEntity
		if placement == nil || bound == nil || bound.ID != placement.EntityID || bound.WorldID != snapshot.Semantic.SourceRef.WorldID {
			return fmt.Errorf("project LocalAgent Cognition WorldCharacter placement binding is invalid")
		}
		placementRef := agentTurnContextItemSourceRef{Kind: "worldEntity", WorldID: bound.WorldID, RefID: bound.ID, SchemaVersion: bound.SchemaVersion, ContentHash: bound.ContentHash}
		if err := appendUnit("source.world.character-placement", "world_entity", "sourceRef.worldEntityRef", placementRef, agentTurnContextV3PriorityWorldBaseline, "WorldCharacter placement",
			agentTurnContextTextField{Name: "entity_id", Values: []string{placement.EntityID}}, agentTurnContextTextField{Name: "kind", Values: []string{placement.Kind}}); err != nil {
			return err
		}
	}
	if len(world.Entities) == 0 {
		if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, "source.world.entity-refs", "world_entity", "semanticPayload.materializationContext.owningWorld.core.entities", worldRef, "explicit_source_section_empty"); err != nil {
			return err
		}
	}
	for _, entity := range realmSourceCompilerSortedByIDV3(world.Entities, func(value realmSourceCompilerWorldEntityRefV3) string { return value.EntityID }) {
		if err := appendUnit("source.world.entity-ref."+entity.EntityID, "world_entity", "semanticPayload.materializationContext.owningWorld.core.entities."+entity.EntityID, worldRef, agentTurnContextV3PriorityOptional, "Owning world entity reference",
			agentTurnContextTextField{Name: "kind", Values: []string{entity.Kind}}, agentTurnContextTextField{Name: "label", Values: agentTurnContextOptionalString(entity.Label)}, agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(entity.Summary)}); err != nil {
			return err
		}
	}
	if len(world.Relationships) == 0 {
		if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, "source.relationship.world-core.none", "relationship_detail", "semanticPayload.materializationContext.owningWorld.core.relationships", worldRef, "explicit_source_section_empty"); err != nil {
			return err
		}
	}
	for _, relationship := range realmSourceCompilerSortedByIDV3(world.Relationships, func(value realmSourceCompilerWorldRelationshipV3) string { return value.RelationshipID }) {
		attributes := []string(nil)
		if relationship.Attributes != nil {
			encoded, encodeErr := canonicalLocalAgentCognitionJSONTextV1(*relationship.Attributes)
			if encodeErr != nil {
				return encodeErr
			}
			attributes = []string{encoded}
		}
		if err := appendUnit("source.relationship.world-core."+relationship.RelationshipID, "relationship_detail", "semanticPayload.materializationContext.owningWorld.core.relationships."+relationship.RelationshipID, worldRef, agentTurnContextV3PriorityOptional, "Owning world relationship reference",
			agentTurnContextTextField{Name: "source_entity_id", Values: []string{relationship.SourceEntityID}}, agentTurnContextTextField{Name: "target_entity_id", Values: []string{relationship.TargetEntityID}}, agentTurnContextTextField{Name: "type", Values: []string{relationship.Type}}, agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(relationship.Summary)}, agentTurnContextTextField{Name: "attributes", Values: attributes}); err != nil {
			return err
		}
	}
	if len(world.Systems) == 0 {
		if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, "source.world.systems", "world_system", "semanticPayload.materializationContext.owningWorld.core.systems", worldRef, "explicit_source_section_empty"); err != nil {
			return err
		}
	}
	for _, system := range realmSourceCompilerSortedByIDV3(world.Systems, func(value realmSourceCompilerWorldSystemV3) string { return value.SystemID }) {
		parameters := []string(nil)
		if system.Parameters != nil {
			encoded, encodeErr := canonicalLocalAgentCognitionJSONTextV1(*system.Parameters)
			if encodeErr != nil {
				return encodeErr
			}
			parameters = []string{encoded}
		}
		if err := appendUnit("source.world.system."+system.SystemID, "world_system", "semanticPayload.materializationContext.owningWorld.core.systems."+system.SystemID, worldRef, agentTurnContextV3PriorityOptional, "Canonical world system",
			agentTurnContextTextField{Name: "name", Values: []string{system.Name}}, agentTurnContextTextField{Name: "summary", Values: []string{system.Summary}}, agentTurnContextTextField{Name: "principles", Values: agentTurnContextOptionalStrings(system.Principles)}, agentTurnContextTextField{Name: "parameters", Values: parameters}); err != nil {
			return err
		}
	}
	if len(world.Scenes) == 0 {
		if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, "source.world.scenes", "world_scene", "semanticPayload.materializationContext.owningWorld.core.scenes", worldRef, "explicit_source_section_empty"); err != nil {
			return err
		}
	}
	for _, scene := range realmSourceCompilerSortedByIDV3(world.Scenes, func(value realmSourceCompilerWorldSceneV3) string { return value.SceneID }) {
		if err := appendUnit("source.world.scene."+scene.SceneID, "world_scene", "semanticPayload.materializationContext.owningWorld.core.scenes."+scene.SceneID, worldRef, agentTurnContextV3PriorityOptional, "Canonical world scene",
			agentTurnContextTextField{Name: "name", Values: []string{scene.Name}}, agentTurnContextTextField{Name: "summary", Values: []string{scene.Summary}}, agentTurnContextTextField{Name: "entity_refs", Values: agentTurnContextOptionalStrings(scene.EntityRefs)}, agentTurnContextTextField{Name: "asset_refs", Values: agentTurnContextOptionalStrings(scene.AssetRefs)}); err != nil {
			return err
		}
	}
	if len(world.Timeline.Events) == 0 {
		if err := appendLocalAgentCognitionOmissionV1(partition, seenCoverageIDs, "source.world.events", "world_fact", "semanticPayload.materializationContext.owningWorld.core.timeline.events", worldRef, "explicit_source_section_empty"); err != nil {
			return err
		}
	}
	for _, event := range realmSourceCompilerSortedByIDV3(world.Timeline.Events, func(value realmSourceCompilerWorldEventV3) string { return value.EventID }) {
		text := agentTurnContextTypedContent("Canonical world event",
			agentTurnContextTextField{Name: "title", Values: []string{event.Title}}, agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(event.Summary)}, agentTurnContextTextField{Name: "sequence", Values: realmSourceCompilerOptionalFloatV3(event.Sequence)}, agentTurnContextTextField{Name: "importance", Values: realmSourceCompilerOptionalFloatV3(event.Importance)}, agentTurnContextTextField{Name: "entity_refs", Values: agentTurnContextOptionalStrings(event.EntityRefs)}, agentTurnContextTextField{Name: "character_refs", Values: agentTurnContextOptionalStrings(event.CharacterRefs)}, agentTurnContextTextField{Name: "scene_refs", Values: agentTurnContextOptionalStrings(event.SceneRefs)}, agentTurnContextTextField{Name: "location_refs", Values: agentTurnContextOptionalStrings(event.LocationRefs)}, agentTurnContextTextField{Name: "timestamp", Values: agentTurnContextOptionalString(event.Timestamp)}, agentTurnContextTextField{Name: "starts_at", Values: agentTurnContextOptionalString(event.StartsAt)}, agentTurnContextTextField{Name: "ends_at", Values: agentTurnContextOptionalString(event.EndsAt)})
		if err := appendLocalAgentCognitionUnitV1(partition, seenSourcePaths, seenCoverageIDs, localAgentCognitionSourceUnitV1{StableID: "source.world.event." + event.EventID, Category: "world_fact", SourcePath: "semanticPayload.materializationContext.owningWorld.core.timeline.events." + event.EventID, SourceRef: worldRef, Text: text, ProvenanceRefs: agentTurnContextOptionalStrings(event.SourceRefs), Priority: agentTurnContextV3PriorityOptional}); err != nil {
			return err
		}
	}
	if err := appendLocalAgentCognitionJSONOrOmissionV1(partition, seenSourcePaths, seenCoverageIDs, "source.world.assets", "source_asset_detail", "semanticPayload.materializationContext.owningWorld.core.assets", worldRef, world.Assets); err != nil {
		return err
	}
	if err := appendLocalAgentSemanticCoverageUnitsV1(snapshot, partition, seenSourcePaths, seenCoverageIDs); err != nil {
		return err
	}
	return nil
}

func worldIdentityTaglineV1(world realmSourceCompilerWorldCoreV3) []string {
	return realmSourceCompilerFirstOptionalStringV3(world.Identity.Tagline, world.Presentation.Tagline)
}

func localAgentOptionalBoolTextV1(value *bool) []string {
	if value == nil {
		return nil
	}
	return []string{strconv.FormatBool(*value)}
}

func localAgentNullableStringTextV1(value sourceMaterializationNullableString) []string {
	if !value.Present || value.Value == nil {
		return nil
	}
	return []string{*value.Value}
}

func hashLocalAgentSourcePartitionV1(value localAgentSourcePartitionV1) (string, error) {
	value.PartitionHash = ""
	return hashSourceMaterializationRealmDomainV3(localAgentSourcePartitionHashDomainV1, map[string]any{
		"schemaVersion":  value.SchemaVersion,
		"lorebook":       value.Lorebook,
		"cognitionUnits": value.CognitionUnits,
		"omissions":      value.Omissions,
	})
}

func validateLocalAgentSourcePartitionV1(value localAgentSourcePartitionV1) error {
	if value.SchemaVersion != localAgentSourcePartitionSchemaV1 || !isLowerSHA256V3(value.PartitionHash) || value.CognitionUnits == nil || value.Omissions == nil {
		return fmt.Errorf("LocalAgent source partition is invalid")
	}
	if err := validateCharacterLorebookDeclarationV1(value.Lorebook.Character); err != nil {
		return err
	}
	if err := validateWorldLorebookDeclarationV1(value.Lorebook.World); err != nil {
		return err
	}
	seen := make(map[string]struct{}, len(value.CognitionUnits))
	for _, unit := range value.CognitionUnits {
		if strings.TrimSpace(unit.StableID) == "" || !isLocalAgentSourceSemanticCategoryV1(unit.Category) || strings.TrimSpace(unit.SourcePath) == "" || validateLocalAgentCognitionTextV1(unit.Text) != nil {
			return fmt.Errorf("LocalAgent Cognition source unit is invalid")
		}
		if err := validateLocalAgentCognitionProvenanceRefsV1(unit.ProvenanceRefs); err != nil {
			return fmt.Errorf("LocalAgent Cognition source unit provenance is invalid: %w", err)
		}
		if strings.TrimSpace(unit.SourceRef.Kind) == "" || strings.TrimSpace(unit.SourceRef.RefID) == "" || strings.TrimSpace(unit.SourceRef.SchemaVersion) == "" || !validSHA256Hex(unit.SourceRef.ContentHash) {
			return fmt.Errorf("LocalAgent Cognition source unit ref is invalid")
		}
		if !localAgentSourceCategoryMatchesRefKindV1(unit.Category, unit.SourceRef.Kind) {
			return fmt.Errorf("LocalAgent Cognition source unit category/ref binding is invalid")
		}
		if _, exists := seen[unit.StableID]; exists {
			return fmt.Errorf("LocalAgent Cognition source unit id %q is duplicated", unit.StableID)
		}
		seen[unit.StableID] = struct{}{}
	}
	for _, omission := range value.Omissions {
		if strings.TrimSpace(omission.StableID) == "" || !isLocalAgentSourceSemanticCategoryV1(omission.Category) ||
			strings.TrimSpace(omission.SourcePath) == "" || strings.TrimSpace(omission.OmissionReason) == "" {
			return fmt.Errorf("LocalAgent Cognition source omission is invalid")
		}
		if err := validateLocalAgentCognitionProvenanceRefsV1(omission.ProvenanceRefs); err != nil {
			return fmt.Errorf("LocalAgent Cognition source omission provenance is invalid: %w", err)
		}
		if strings.TrimSpace(omission.SourceRef.Kind) == "" || strings.TrimSpace(omission.SourceRef.RefID) == "" || strings.TrimSpace(omission.SourceRef.SchemaVersion) == "" || !validSHA256Hex(omission.SourceRef.ContentHash) {
			return fmt.Errorf("LocalAgent Cognition source omission ref is invalid")
		}
		if !localAgentSourceCategoryMatchesRefKindV1(omission.Category, omission.SourceRef.Kind) {
			return fmt.Errorf("LocalAgent Cognition source omission category/ref binding is invalid")
		}
		if _, exists := seen[omission.StableID]; exists {
			return fmt.Errorf("LocalAgent Cognition source coverage id %q is duplicated", omission.StableID)
		}
		seen[omission.StableID] = struct{}{}
	}
	expected, err := hashLocalAgentSourcePartitionV1(value)
	if err != nil || expected != value.PartitionHash {
		return fmt.Errorf("LocalAgent source partition hash mismatch")
	}
	return nil
}

func validateLocalAgentCognitionTextV1(text string) error {
	if strings.TrimSpace(text) == "" || strings.TrimSpace(text) != text || !utf8.ValidString(text) {
		return fmt.Errorf("semantic text must be exact non-empty UTF-8")
	}
	if len([]byte(text)) > localAgentCognitionTextMaxBytes {
		return fmt.Errorf("semantic text exceeds %d UTF-8 bytes", localAgentCognitionTextMaxBytes)
	}
	return nil
}

func validateLocalAgentCognitionProvenanceRefsV1(refs []string) error {
	if refs == nil {
		return fmt.Errorf("provenance refs must be an explicit array")
	}
	seen := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		if strings.TrimSpace(ref) == "" || strings.TrimSpace(ref) != ref || !utf8.ValidString(ref) {
			return fmt.Errorf("provenance ref must be exact non-empty UTF-8")
		}
		if _, duplicate := seen[ref]; duplicate {
			return fmt.Errorf("provenance ref %q is duplicated", ref)
		}
		seen[ref] = struct{}{}
	}
	return nil
}

func isLocalAgentSourceSemanticCategoryV1(category string) bool {
	switch category {
	case "character_identity_detail", "behavior_detail", "speaking_interaction_detail",
		"biography_event", "relationship_detail", "work", "preference",
		"source_knowledge_detail", "source_constraint_detail", "source_asset_detail",
		"dialogue_exemplar", "world_setting_detail", "world_fact", "world_entity",
		"world_system", "world_scene", "source_evidence":
		return true
	default:
		return false
	}
}

func localAgentSourceCategoryMatchesRefKindV1(category, refKind string) bool {
	switch refKind {
	case "worldCharacter", "personaCharacter":
		switch category {
		case "character_identity_detail", "behavior_detail", "speaking_interaction_detail", "biography_event",
			"relationship_detail", "source_knowledge_detail", "source_constraint_detail", "source_asset_detail", "dialogue_exemplar":
			return true
		}
	case "worldCore":
		switch category {
		case "world_setting_detail", "world_fact", "world_entity", "world_system", "world_scene", "relationship_detail", "source_asset_detail":
			return true
		}
	case "worldEntity":
		switch category {
		case "world_entity", "world_fact", "work", "preference", "source_asset_detail", "source_evidence":
			return true
		}
	case "worldRelationship":
		return category == "relationship_detail" || category == "source_evidence"
	}
	return false
}

func validateLocalAgentSourcePartitionBindingV1(value localAgentSourcePartitionBindingV1) error {
	if value.SchemaVersion != localAgentSourcePartitionSchemaV1 || !isLowerSHA256V3(value.PartitionHash) ||
		value.UnitCount == 0 {
		return fmt.Errorf("LocalAgent source partition binding is invalid")
	}
	if err := validateCharacterLorebookDeclarationV1(value.Lorebook.Character); err != nil {
		return err
	}
	return validateWorldLorebookDeclarationV1(value.Lorebook.World)
}

func compileAgentTurnLorebookViewV1(source localAgentTurnSourceViewV1) (map[agentTurnContextLaneID][]agentTurnContextItem, error) {
	items := make(map[agentTurnContextLaneID][]agentTurnContextItem, 5)
	characterRef := agentTurnContextItemSourceRef{
		Kind: source.SourceRef.Kind, WorldID: source.SourceRef.WorldID, RefID: source.SourceRef.ID,
		SchemaVersion: source.SourceSchemaVersion, ContentHash: source.SourceContentHash,
	}
	worldRef := source.WorldRef
	character := source.Partition.Lorebook.Character
	world := source.Partition.Lorebook.World
	if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceIdentity,
		"lorebook.character.identity", "semanticPayload.canonicalSource.lorebookDeclaration.identity", characterRef,
		agentTurnContextV3PriorityIdentity, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("Character lorebook identity", agentTurnContextTextField{Name: "identity", Values: []string{character.Identity}})); err != nil {
		return nil, err
	}
	if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceBehavior,
		"lorebook.character.behavior", "semanticPayload.canonicalSource.lorebookDeclaration", characterRef,
		agentTurnContextV3PriorityCoreBehavior, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("Character lorebook behavior",
			agentTurnContextTextField{Name: "behavior", Values: character.Behavior},
			agentTurnContextTextField{Name: "speaking", Values: character.Speaking},
			agentTurnContextTextField{Name: "immutable_boundaries", Values: character.ImmutableBoundaries})); err != nil {
		return nil, err
	}
	if len(character.RelationshipPostures) > 0 {
		values := make([]string, 0, len(character.RelationshipPostures))
		for _, posture := range character.RelationshipPostures {
			values = append(values, posture.TargetRef+": "+posture.Statement)
		}
		if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneRelationshipContext,
			"lorebook.character.relationship-posture", "semanticPayload.canonicalSource.lorebookDeclaration.relationshipPostures", characterRef,
			agentTurnContextV3PriorityRelationship, true, agentTurnContextTruncationNone,
			agentTurnContextTypedContent("Character lorebook relationship posture", agentTurnContextTextField{Name: "postures", Values: values})); err != nil {
			return nil, err
		}
	}
	worldRules := make([]string, 0, len(world.WorldRules))
	for _, rule := range world.WorldRules {
		worldRules = append(worldRules, rule.Statement)
	}
	placements := make([]string, 0, len(world.RolePlacements))
	for _, placement := range world.RolePlacements {
		placements = append(placements, placement.Statement)
	}
	if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneWorldContext,
		"lorebook.world.core", "semanticPayload.materializationContext.owningWorld.lorebookDeclaration", worldRef,
		agentTurnContextV3PriorityWorldBaseline, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("World lorebook core",
			agentTurnContextTextField{Name: "identity_base_setting", Values: []string{world.IdentityBaseSetting}},
			agentTurnContextTextField{Name: "world_rules", Values: worldRules},
			agentTurnContextTextField{Name: "role_placements", Values: placements})); err != nil {
		return nil, err
	}
	return items, nil
}
