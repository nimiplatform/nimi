package runtimeagent

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

const (
	agentTurnContextV3PriorityIdentity      int64 = 1000
	agentTurnContextV3PriorityCoreBehavior  int64 = 900
	agentTurnContextV3PriorityWorldBaseline int64 = 800
	agentTurnContextV3PriorityRelationship  int64 = 700
	agentTurnContextV3PriorityKnowledge     int64 = 500
	agentTurnContextV3PriorityOptional      int64 = 100
)

type realmSourceCompilerProfileV3 struct {
	ProfileSchemaVersion string                                      `json:"profileSchemaVersion"`
	Identity             realmSourceCompilerProfileIdentityV3        `json:"identity"`
	Presentation         realmSourceCompilerProfilePresentationV3    `json:"presentation"`
	Narrative            realmSourceCompilerProfileNarrativeV3       `json:"narrative"`
	Psychology           *realmSourceCompilerProfilePsychologyV3     `json:"psychology,omitempty"`
	Knowledge            *realmSourceCompilerProfileKnowledgeV3      `json:"knowledge,omitempty"`
	Relationships        *[]realmSourceCompilerProfileRelationshipV3 `json:"relationships,omitempty"`
	Capabilities         *realmSourceCompilerProfileCapabilitiesV3   `json:"capabilities,omitempty"`
	InteractionProfile   realmSourceCompilerInteractionProfileV3     `json:"interactionProfile"`
	Assets               sourceMaterializationJSONValue              `json:"assets"`
	Authoring            sourceMaterializationJSONValue              `json:"authoring"`
	ProfileCoverage      sourceMaterializationJSONValue              `json:"profileCoverage"`
	ProfileHash          string                                      `json:"profileHash"`
}

type realmSourceCompilerProfileIdentityV3 struct {
	Name    string    `json:"name"`
	Summary string    `json:"summary"`
	Handle  *string   `json:"handle,omitempty"`
	Aliases *[]string `json:"aliases,omitempty"`
}

type realmSourceCompilerProfilePresentationV3 struct {
	DisplayName             string  `json:"displayName"`
	ShortBio                *string `json:"shortBio,omitempty"`
	ProfileLine             *string `json:"profileLine,omitempty"`
	AvatarResourceRef       *string `json:"avatarResourceRef,omitempty"`
	ProfileCoverResourceRef *string `json:"profileCoverResourceRef,omitempty"`
}

type realmSourceCompilerProfileNarrativeV3 struct {
	Summary    string                                   `json:"summary"`
	Archetype  *string                                  `json:"archetype,omitempty"`
	Traits     *[]string                                `json:"traits,omitempty"`
	Milestones *[]realmSourceCompilerProfileMilestoneV3 `json:"milestones,omitempty"`
}

type realmSourceCompilerProfileMilestoneV3 struct {
	MilestoneID string   `json:"milestoneId"`
	Sequence    *float64 `json:"sequence,omitempty"`
	Title       *string  `json:"title,omitempty"`
	Summary     *string  `json:"summary,omitempty"`
}

type realmSourceCompilerProfilePsychologyV3 struct {
	Drives     *[]string `json:"drives,omitempty"`
	Boundaries *[]string `json:"boundaries,omitempty"`
}

type realmSourceCompilerProfileKnowledgeV3 struct {
	Topics      *[]string `json:"topics,omitempty"`
	Constraints *[]string `json:"constraints,omitempty"`
}

type realmSourceCompilerProfileRelationshipV3 struct {
	RelationshipID string                                `json:"relationshipId"`
	TargetRef      sourceMaterializationWorldEntityRefV3 `json:"targetRef"`
	RelationType   string                                `json:"relationType"`
	Summary        *string                               `json:"summary,omitempty"`
}

type realmSourceCompilerProfileCapabilitiesV3 struct {
	Tools *[]realmSourceCompilerProfileToolV3 `json:"tools,omitempty"`
}

type realmSourceCompilerProfileToolV3 struct {
	ToolID  string  `json:"toolId"`
	Name    *string `json:"name,omitempty"`
	Summary *string `json:"summary,omitempty"`
}

type realmSourceCompilerInteractionProfileV3 struct {
	InteractionModes  []string                                 `json:"interactionModes"`
	Tone              *string                                  `json:"tone,omitempty"`
	Cadence           *string                                  `json:"cadence,omitempty"`
	Scenario          *string                                  `json:"scenario,omitempty"`
	Greeting          *string                                  `json:"greeting,omitempty"`
	GreetingVariants  *[]string                                `json:"greetingVariants,omitempty"`
	DialogueExemplars *[]realmSourceCompilerDialogueExemplarV3 `json:"dialogueExemplars,omitempty"`
}

type realmSourceCompilerDialogueExemplarV3 struct {
	ExemplarID string  `json:"exemplarId"`
	User       *string `json:"user,omitempty"`
	Character  string  `json:"character"`
}

type realmSourceCompilerWorldCoreV3 struct {
	Identity      realmSourceCompilerWorldIdentityV3       `json:"identity"`
	Presentation  realmSourceCompilerWorldPresentationV3   `json:"presentation"`
	Ontology      realmSourceCompilerWorldOntologyV3       `json:"ontology"`
	TimeModel     realmSourceCompilerWorldTimeModelV3      `json:"timeModel"`
	Timeline      realmSourceCompilerWorldTimelineV3       `json:"timeline"`
	Entities      []realmSourceCompilerWorldEntityRefV3    `json:"entities"`
	Relationships []realmSourceCompilerWorldRelationshipV3 `json:"relationships"`
	Systems       []realmSourceCompilerWorldSystemV3       `json:"systems"`
	Scenes        []realmSourceCompilerWorldSceneV3        `json:"scenes"`
	Assets        sourceMaterializationJSONValue           `json:"assets"`
	Authoring     sourceMaterializationJSONValue           `json:"authoring"`
}

type realmSourceCompilerWorldIdentityV3 struct {
	Name        string    `json:"name"`
	Summary     string    `json:"summary"`
	WorldType   *string   `json:"worldType,omitempty"`
	Tagline     *string   `json:"tagline,omitempty"`
	Genre       *string   `json:"genre,omitempty"`
	Themes      *[]string `json:"themes,omitempty"`
	Era         *string   `json:"era,omitempty"`
	Divergences *[]string `json:"divergences,omitempty"`
}

type realmSourceCompilerWorldPresentationV3 struct {
	Title             *string   `json:"title,omitempty"`
	DisplayName       *string   `json:"displayName,omitempty"`
	Tagline           *string   `json:"tagline,omitempty"`
	Palette           *[]string `json:"palette,omitempty"`
	IconResourceRef   *string   `json:"iconResourceRef,omitempty"`
	BannerResourceRef *string   `json:"bannerResourceRef,omitempty"`
}

type realmSourceCompilerWorldOntologyV3 struct {
	EntityKinds       []string                             `json:"entityKinds"`
	RelationshipTypes []string                             `json:"relationshipTypes"`
	Concepts          *[]realmSourceCompilerWorldConceptV3 `json:"concepts,omitempty"`
}

type realmSourceCompilerWorldConceptV3 struct {
	ConceptID string  `json:"conceptId"`
	Name      string  `json:"name"`
	Summary   *string `json:"summary,omitempty"`
}

type realmSourceCompilerWorldTimeModelV3 struct {
	Mode      string  `json:"mode"`
	FlowRatio float64 `json:"flowRatio"`
	IsPaused  *bool   `json:"isPaused"`
	Anchor    struct {
		RealStartedAt         string `json:"realStartedAt"`
		WorldStartedAt        string `json:"worldStartedAt"`
		WorldStartedAtDisplay string `json:"worldStartedAtDisplay"`
	} `json:"anchor"`
	PausedWorldTime sourceMaterializationNullableString `json:"pausedWorldTime"`
	Calendar        sourceMaterializationNullableString `json:"calendar"`
	DisplayFormat   sourceMaterializationNullableString `json:"displayFormat"`
}

type realmSourceCompilerWorldTimelineV3 struct {
	Events []realmSourceCompilerWorldEventV3 `json:"events"`
}

type realmSourceCompilerWorldEventV3 struct {
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
}

type realmSourceCompilerWorldEntityRefV3 struct {
	EntityID string  `json:"entityId"`
	Kind     string  `json:"kind"`
	Label    *string `json:"label,omitempty"`
	Summary  *string `json:"summary,omitempty"`
}

type realmSourceCompilerWorldRelationshipV3 struct {
	RelationshipID string                          `json:"relationshipId"`
	SourceEntityID string                          `json:"sourceEntityId"`
	TargetEntityID string                          `json:"targetEntityId"`
	Type           string                          `json:"type"`
	Summary        *string                         `json:"summary,omitempty"`
	Attributes     *sourceMaterializationJSONValue `json:"attributes,omitempty"`
}

type realmSourceCompilerWorldSystemV3 struct {
	SystemID   string                          `json:"systemId"`
	Name       string                          `json:"name"`
	Summary    string                          `json:"summary"`
	Principles *[]string                       `json:"principles,omitempty"`
	Parameters *sourceMaterializationJSONValue `json:"parameters,omitempty"`
}

type realmSourceCompilerWorldSceneV3 struct {
	SceneID    string    `json:"sceneId"`
	Name       string    `json:"name"`
	Summary    string    `json:"summary"`
	EntityRefs *[]string `json:"entityRefs,omitempty"`
	AssetRefs  *[]string `json:"assetRefs,omitempty"`
}

type realmSourceCompilerEntityCoreV3 struct {
	Identity struct {
		Name    string    `json:"name"`
		Summary string    `json:"summary"`
		Kind    string    `json:"kind"`
		Aliases *[]string `json:"aliases,omitempty"`
	} `json:"identity"`
	Classification struct {
		Tags             []string  `json:"tags"`
		SourceCategories *[]string `json:"sourceCategories,omitempty"`
	} `json:"classification"`
	Facts     []sourceMaterializationJSONValue `json:"facts"`
	Evidence  sourceMaterializationJSONValue   `json:"evidence"`
	Assets    sourceMaterializationJSONValue   `json:"assets"`
	Authoring sourceMaterializationJSONValue   `json:"authoring"`
}

type realmSourceCompilerRelationshipCoreV3 struct {
	Endpoints struct {
		SourceEntityID string `json:"sourceEntityId"`
		TargetEntityID string `json:"targetEntityId"`
		Type           string `json:"type"`
	} `json:"endpoints"`
	Presentation struct {
		Summary *string `json:"summary,omitempty"`
	} `json:"presentation"`
	Evidence   sourceMaterializationJSONValue  `json:"evidence"`
	Attributes *sourceMaterializationJSONValue `json:"attributes,omitempty"`
	Authoring  sourceMaterializationJSONValue  `json:"authoring"`
}

// compileAgentTurnSourceSnapshotV3 is the only SnapshotV2 source compiler.
// It emits exactly the five validated Realm-source lanes; Runtime policy,
// memory, transcript, capabilities, and the caller turn remain separate owners.
func compileAgentTurnSourceSnapshotV3(
	snapshot localAgentSourceSnapshotV2,
) (map[agentTurnContextLaneID][]agentTurnContextItem, error) {
	if err := validateLocalAgentSourceSnapshotV2(snapshot); err != nil {
		return nil, fmt.Errorf("compile Realm source SnapshotV2: %w", err)
	}
	profile, err := decodeRealmSourceCompilerProfileV3(snapshot.Semantic.Source.Profile)
	if err != nil {
		return nil, err
	}
	world, err := decodeRealmSourceCompilerWorldCoreV3(snapshot.Semantic.OwningWorld.Core)
	if err != nil {
		return nil, err
	}
	items := make(map[agentTurnContextLaneID][]agentTurnContextItem, 5)
	if err := compileRealmSourceProfileV3(snapshot, profile, items); err != nil {
		return nil, err
	}
	if err := compileRealmSourceWorldV3(snapshot, world, items); err != nil {
		return nil, err
	}
	if err := compileRealmSourceClosureV3(snapshot, items); err != nil {
		return nil, err
	}
	for laneID := range items {
		switch laneID {
		case agentTurnContextLaneSourceIdentity, agentTurnContextLaneSourceBehavior,
			agentTurnContextLaneWorldContext, agentTurnContextLaneRelationshipContext,
			agentTurnContextLaneSourceKnowledge:
		default:
			return nil, fmt.Errorf("Realm source compiler emitted inadmissible lane %q", laneID)
		}
	}
	return items, nil
}

func decodeRealmSourceCompilerProfileV3(value sourceMaterializationJSONValue) (realmSourceCompilerProfileV3, error) {
	profileValue := value.interfaceValue()
	if err := validateSourceMaterializationProfileShapeJSONV3(profileValue, "$.snapshot.semantic.source.profile"); err != nil {
		return realmSourceCompilerProfileV3{}, fmt.Errorf("validate SnapshotV2 CharacterProfileCoreV1: %w", err)
	}
	raw, err := canonicalizeSourceMaterializationRealmV3(profileValue)
	if err != nil {
		return realmSourceCompilerProfileV3{}, fmt.Errorf("encode SnapshotV2 CharacterProfileCoreV1: %w", err)
	}
	var profile realmSourceCompilerProfileV3
	if err := strictDecodeSourceMaterializationV3(raw, &profile); err != nil {
		return realmSourceCompilerProfileV3{}, fmt.Errorf("decode typed SnapshotV2 CharacterProfileCoreV1: %w", err)
	}
	if profile.ProfileSchemaVersion != "realm.character-profile-core/v1" ||
		!isLowerSHA256V3(profile.ProfileHash) || strings.TrimSpace(profile.Identity.Name) == "" ||
		strings.TrimSpace(profile.Identity.Summary) == "" || strings.TrimSpace(profile.Presentation.DisplayName) == "" ||
		strings.TrimSpace(profile.Narrative.Summary) == "" || profile.InteractionProfile.InteractionModes == nil ||
		profile.Assets.Kind != sourceMaterializationJSONObject || profile.Authoring.Kind != sourceMaterializationJSONObject ||
		profile.ProfileCoverage.Kind != sourceMaterializationJSONObject {
		return realmSourceCompilerProfileV3{}, fmt.Errorf("SnapshotV2 CharacterProfileCoreV1 required fields are invalid")
	}
	return profile, nil
}

func decodeRealmSourceCompilerWorldCoreV3(value sourceMaterializationJSONValue) (realmSourceCompilerWorldCoreV3, error) {
	worldValue := value.interfaceValue()
	if _, err := sourceMaterializationClosedObjectV3(worldValue, "$.snapshot.semantic.owningWorld.core", []string{
		"identity", "presentation", "ontology", "timeModel", "timeline", "entities", "relationships", "systems", "scenes", "assets", "authoring",
	}, nil); err != nil {
		return realmSourceCompilerWorldCoreV3{}, fmt.Errorf("validate SnapshotV2 WorldCore: %w", err)
	}
	raw, err := canonicalizeSourceMaterializationRealmV3(worldValue)
	if err != nil {
		return realmSourceCompilerWorldCoreV3{}, fmt.Errorf("encode SnapshotV2 WorldCore: %w", err)
	}
	var world realmSourceCompilerWorldCoreV3
	if err := strictDecodeSourceMaterializationV3(raw, &world); err != nil {
		return realmSourceCompilerWorldCoreV3{}, fmt.Errorf("decode typed SnapshotV2 WorldCore: %w", err)
	}
	if strings.TrimSpace(world.Identity.Name) == "" || strings.TrimSpace(world.Identity.Summary) == "" ||
		strings.TrimSpace(world.TimeModel.Mode) == "" || world.Ontology.EntityKinds == nil ||
		world.Ontology.RelationshipTypes == nil || world.Timeline.Events == nil || world.Entities == nil ||
		world.Relationships == nil || world.Systems == nil || world.Scenes == nil ||
		world.Assets.Kind != sourceMaterializationJSONObject || world.Authoring.Kind != sourceMaterializationJSONObject {
		return realmSourceCompilerWorldCoreV3{}, fmt.Errorf("SnapshotV2 WorldCore required fields are invalid")
	}
	return world, nil
}

func compileRealmSourceProfileV3(snapshot localAgentSourceSnapshotV2, profile realmSourceCompilerProfileV3, items map[agentTurnContextLaneID][]agentTurnContextItem) error {
	ref := realmSourceCompilerSourceRefV3(snapshot)
	if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceIdentity,
		"source.identity.core", "source.profile.identity", ref, agentTurnContextV3PriorityIdentity, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("Realm Character identity",
			agentTurnContextTextField{Name: "name", Values: []string{profile.Identity.Name}},
			agentTurnContextTextField{Name: "summary", Values: []string{profile.Identity.Summary}},
			agentTurnContextTextField{Name: "handle", Values: agentTurnContextOptionalString(profile.Identity.Handle)},
			agentTurnContextTextField{Name: "aliases", Values: agentTurnContextOptionalStrings(profile.Identity.Aliases)},
		)); err != nil {
		return err
	}
	if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceIdentity,
		"source.identity.presentation", "source.profile.presentation", ref, agentTurnContextV3PriorityIdentity-10, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("Realm Character presentation identity",
			agentTurnContextTextField{Name: "display_name", Values: []string{profile.Presentation.DisplayName}},
			agentTurnContextTextField{Name: "short_bio", Values: agentTurnContextOptionalString(profile.Presentation.ShortBio)},
			agentTurnContextTextField{Name: "profile_line", Values: agentTurnContextOptionalString(profile.Presentation.ProfileLine)},
		)); err != nil {
		return err
	}
	if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceBehavior,
		"source.behavior.narrative", "source.profile.narrative", ref, agentTurnContextV3PriorityCoreBehavior, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("Realm Character narrative behavior",
			agentTurnContextTextField{Name: "summary", Values: []string{profile.Narrative.Summary}},
			agentTurnContextTextField{Name: "archetype", Values: agentTurnContextOptionalString(profile.Narrative.Archetype)},
			agentTurnContextTextField{Name: "traits", Values: agentTurnContextOptionalStrings(profile.Narrative.Traits)},
		)); err != nil {
		return err
	}
	if profile.Psychology != nil {
		if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceBehavior,
			"source.behavior.psychology", "source.profile.psychology", ref, agentTurnContextV3PriorityCoreBehavior-10, true, agentTurnContextTruncationNone,
			agentTurnContextTypedContent("Realm Character psychology",
				agentTurnContextTextField{Name: "drives", Values: agentTurnContextOptionalStrings(profile.Psychology.Drives)},
				agentTurnContextTextField{Name: "boundaries", Values: agentTurnContextOptionalStrings(profile.Psychology.Boundaries)},
			)); err != nil {
			return err
		}
	}
	interaction := profile.InteractionProfile
	if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceBehavior,
		"source.behavior.interaction", "source.profile.interactionProfile", ref, agentTurnContextV3PriorityCoreBehavior-20, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("Realm Character interaction profile",
			agentTurnContextTextField{Name: "interaction_modes", Values: interaction.InteractionModes},
			agentTurnContextTextField{Name: "tone", Values: agentTurnContextOptionalString(interaction.Tone)},
			agentTurnContextTextField{Name: "cadence", Values: agentTurnContextOptionalString(interaction.Cadence)},
			agentTurnContextTextField{Name: "scenario", Values: agentTurnContextOptionalString(interaction.Scenario)},
			agentTurnContextTextField{Name: "greeting", Values: agentTurnContextOptionalString(interaction.Greeting)},
			agentTurnContextTextField{Name: "greeting_variants", Values: agentTurnContextOptionalStrings(interaction.GreetingVariants)},
		)); err != nil {
		return err
	}
	if profile.Capabilities != nil && profile.Capabilities.Tools != nil {
		for _, tool := range append([]realmSourceCompilerProfileToolV3(nil), (*profile.Capabilities.Tools)...) {
			if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceBehavior,
				"source.behavior.descriptive-capability."+tool.ToolID,
				"source.profile.capabilities.tools."+tool.ToolID, ref, agentTurnContextV3PriorityCoreBehavior-30, true, agentTurnContextTruncationNone,
				agentTurnContextTypedContent("Descriptive Realm source capability; this does not grant a Runtime tool",
					agentTurnContextTextField{Name: "tool_id", Values: []string{tool.ToolID}},
					agentTurnContextTextField{Name: "name", Values: agentTurnContextOptionalString(tool.Name)},
					agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(tool.Summary)},
				)); err != nil {
				return err
			}
		}
	}
	if interaction.DialogueExemplars != nil {
		for _, exemplar := range append([]realmSourceCompilerDialogueExemplarV3(nil), (*interaction.DialogueExemplars)...) {
			if err := appendRealmSourceCompilerExemplarV3(items, ref, exemplar); err != nil {
				return err
			}
		}
	}
	if profile.Relationships != nil {
		for _, relationship := range append([]realmSourceCompilerProfileRelationshipV3(nil), (*profile.Relationships)...) {
			content := agentTurnContextTypedContent("Realm Character declared relationship",
				agentTurnContextTextField{Name: "relationship_id", Values: []string{relationship.RelationshipID}},
				agentTurnContextTextField{Name: "target_kind", Values: []string{relationship.TargetRef.Kind}},
				agentTurnContextTextField{Name: "target_world_id", Values: []string{relationship.TargetRef.WorldID}},
				agentTurnContextTextField{Name: "target_entity_id", Values: []string{relationship.TargetRef.EntityID}},
				agentTurnContextTextField{Name: "relation_type", Values: []string{relationship.RelationType}},
				agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(relationship.Summary)},
			)
			if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneRelationshipContext,
				"source.relationship.profile."+relationship.RelationshipID,
				"source.profile.relationships."+relationship.RelationshipID, ref,
				agentTurnContextV3PriorityRelationship, true, agentTurnContextTruncationNone, content); err != nil {
				return err
			}
		}
	}
	if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceKnowledge,
		"source.knowledge.narrative.summary", "source.profile.narrative.summary", ref,
		agentTurnContextV3PriorityKnowledge, false, agentTurnContextTruncationKnowledge,
		agentTurnContextTypedContent("Realm Character source narrative",
			agentTurnContextTextField{Name: "summary", Values: []string{profile.Narrative.Summary}},
		)); err != nil {
		return err
	}
	if profile.Narrative.Milestones != nil {
		for _, milestone := range append([]realmSourceCompilerProfileMilestoneV3(nil), (*profile.Narrative.Milestones)...) {
			content := agentTurnContextTypedContent("Realm Character narrative milestone",
				agentTurnContextTextField{Name: "milestone_id", Values: []string{milestone.MilestoneID}},
				agentTurnContextTextField{Name: "sequence", Values: realmSourceCompilerOptionalFloatV3(milestone.Sequence)},
				agentTurnContextTextField{Name: "title", Values: agentTurnContextOptionalString(milestone.Title)},
				agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(milestone.Summary)},
			)
			if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceKnowledge,
				"source.knowledge.narrative.milestone."+milestone.MilestoneID,
				"source.profile.narrative.milestones."+milestone.MilestoneID, ref,
				agentTurnContextV3PriorityOptional, false, agentTurnContextTruncationKnowledge, content); err != nil {
				return err
			}
		}
	}
	if profile.Knowledge != nil {
		for _, topic := range agentTurnContextOptionalStrings(profile.Knowledge.Topics) {
			if err := appendRealmSourceCompilerDynamicItemV3(items, agentTurnContextLaneSourceKnowledge,
				"source.knowledge.topic", "source.profile.knowledge.topics", ref,
				agentTurnContextV3PriorityKnowledge-10, false, agentTurnContextTruncationKnowledge,
				agentTurnContextTypedContent("Realm Character source knowledge topic", agentTurnContextTextField{Name: "topic", Values: []string{topic}})); err != nil {
				return err
			}
		}
		constraints := agentTurnContextOptionalStrings(profile.Knowledge.Constraints)
		if len(constraints) > 0 {
			if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceKnowledge,
				"source.knowledge.constraints", "source.profile.knowledge.constraints", ref,
				agentTurnContextV3PriorityKnowledge+100, true, agentTurnContextTruncationNone,
				agentTurnContextTypedContent("Realm Character source knowledge constraints", agentTurnContextTextField{Name: "constraints", Values: constraints})); err != nil {
				return err
			}
		}
	}
	return nil
}

func compileRealmSourceWorldV3(snapshot localAgentSourceSnapshotV2, world realmSourceCompilerWorldCoreV3, items map[agentTurnContextLaneID][]agentTurnContextItem) error {
	ref := agentTurnContextItemSourceRef{
		Kind: "worldCore", WorldID: snapshot.Semantic.OwningWorld.ID,
		RefID:         snapshot.Semantic.OwningWorld.ID,
		SchemaVersion: snapshot.Semantic.OwningWorld.SchemaVersion,
		ContentHash:   snapshot.Semantic.OwningWorld.ContentHash,
	}
	baseline := agentTurnContextTypedContent("Canonical Realm WorldCore baseline",
		agentTurnContextTextField{Name: "world_id", Values: []string{snapshot.Semantic.OwningWorld.ID}},
		agentTurnContextTextField{Name: "name", Values: []string{world.Identity.Name}},
		agentTurnContextTextField{Name: "summary", Values: []string{world.Identity.Summary}},
		agentTurnContextTextField{Name: "world_type", Values: agentTurnContextOptionalString(world.Identity.WorldType)},
		agentTurnContextTextField{Name: "tagline", Values: agentTurnContextOptionalString(world.Identity.Tagline)},
		agentTurnContextTextField{Name: "genre", Values: agentTurnContextOptionalString(world.Identity.Genre)},
		agentTurnContextTextField{Name: "themes", Values: agentTurnContextOptionalStrings(world.Identity.Themes)},
		agentTurnContextTextField{Name: "era", Values: agentTurnContextOptionalString(world.Identity.Era)},
		agentTurnContextTextField{Name: "divergences", Values: agentTurnContextOptionalStrings(world.Identity.Divergences)},
		agentTurnContextTextField{Name: "entity_kinds", Values: world.Ontology.EntityKinds},
		agentTurnContextTextField{Name: "relationship_types", Values: world.Ontology.RelationshipTypes},
		agentTurnContextTextField{Name: "time_mode", Values: []string{world.TimeModel.Mode}},
		agentTurnContextTextField{Name: "time_flow_ratio", Values: []string{strconv.FormatFloat(world.TimeModel.FlowRatio, 'g', -1, 64)}},
	)
	if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneWorldContext,
		"source.world.baseline", "world.core.baseline", ref,
		agentTurnContextV3PriorityWorldBaseline, true, agentTurnContextTruncationNone, baseline); err != nil {
		return err
	}
	for _, system := range realmSourceCompilerSortedByIDV3(world.Systems, func(value realmSourceCompilerWorldSystemV3) string { return value.SystemID }) {
		content := agentTurnContextTypedContent("Canonical Realm world system",
			agentTurnContextTextField{Name: "system_id", Values: []string{system.SystemID}},
			agentTurnContextTextField{Name: "name", Values: []string{system.Name}},
			agentTurnContextTextField{Name: "summary", Values: []string{system.Summary}},
			agentTurnContextTextField{Name: "principles", Values: agentTurnContextOptionalStrings(system.Principles)},
		)
		if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneWorldContext,
			"source.world.system."+system.SystemID, "world.core.systems."+system.SystemID,
			ref, agentTurnContextV3PriorityOptional, false, agentTurnContextTruncationWorldDetail, content); err != nil {
			return err
		}
	}
	for _, scene := range realmSourceCompilerSortedByIDV3(world.Scenes, func(value realmSourceCompilerWorldSceneV3) string { return value.SceneID }) {
		content := agentTurnContextTypedContent("Canonical Realm world scene",
			agentTurnContextTextField{Name: "scene_id", Values: []string{scene.SceneID}},
			agentTurnContextTextField{Name: "name", Values: []string{scene.Name}},
			agentTurnContextTextField{Name: "summary", Values: []string{scene.Summary}},
			agentTurnContextTextField{Name: "entity_refs", Values: agentTurnContextOptionalStrings(scene.EntityRefs)},
		)
		if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneWorldContext,
			"source.world.scene."+scene.SceneID, "world.core.scenes."+scene.SceneID,
			ref, agentTurnContextV3PriorityOptional-10, false, agentTurnContextTruncationWorldDetail, content); err != nil {
			return err
		}
	}
	for _, event := range realmSourceCompilerSortedByIDV3(world.Timeline.Events, func(value realmSourceCompilerWorldEventV3) string { return value.EventID }) {
		content := agentTurnContextTypedContent("Canonical Realm world timeline event",
			agentTurnContextTextField{Name: "event_id", Values: []string{event.EventID}},
			agentTurnContextTextField{Name: "title", Values: []string{event.Title}},
			agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(event.Summary)},
			agentTurnContextTextField{Name: "sequence", Values: realmSourceCompilerOptionalFloatV3(event.Sequence)},
			agentTurnContextTextField{Name: "timestamp", Values: agentTurnContextOptionalString(event.Timestamp)},
			agentTurnContextTextField{Name: "starts_at", Values: agentTurnContextOptionalString(event.StartsAt)},
			agentTurnContextTextField{Name: "ends_at", Values: agentTurnContextOptionalString(event.EndsAt)},
		)
		if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneWorldContext,
			"source.world.timeline."+event.EventID, "world.core.timeline.events."+event.EventID,
			ref, agentTurnContextV3PriorityOptional-20, false, agentTurnContextTruncationWorldDetail, content); err != nil {
			return err
		}
	}
	for _, entity := range realmSourceCompilerSortedByIDV3(world.Entities, func(value realmSourceCompilerWorldEntityRefV3) string { return value.EntityID }) {
		content := agentTurnContextTypedContent("Canonical Realm WorldCore entity reference",
			agentTurnContextTextField{Name: "entity_id", Values: []string{entity.EntityID}},
			agentTurnContextTextField{Name: "kind", Values: []string{entity.Kind}},
			agentTurnContextTextField{Name: "label", Values: agentTurnContextOptionalString(entity.Label)},
			agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(entity.Summary)},
		)
		if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneWorldContext,
			"source.world.entity-ref."+entity.EntityID, "world.core.entities."+entity.EntityID,
			ref, agentTurnContextV3PriorityOptional-30, false, agentTurnContextTruncationWorldDetail, content); err != nil {
			return err
		}
	}
	for _, relationship := range realmSourceCompilerSortedByIDV3(world.Relationships, func(value realmSourceCompilerWorldRelationshipV3) string { return value.RelationshipID }) {
		content := agentTurnContextTypedContent("Canonical Realm WorldCore relationship reference",
			agentTurnContextTextField{Name: "relationship_id", Values: []string{relationship.RelationshipID}},
			agentTurnContextTextField{Name: "source_entity_id", Values: []string{relationship.SourceEntityID}},
			agentTurnContextTextField{Name: "target_entity_id", Values: []string{relationship.TargetEntityID}},
			agentTurnContextTextField{Name: "type", Values: []string{relationship.Type}},
			agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(relationship.Summary)},
		)
		if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneRelationshipContext,
			"source.world.relationship-ref."+relationship.RelationshipID,
			"world.core.relationships."+relationship.RelationshipID, ref,
			agentTurnContextV3PriorityOptional, false, agentTurnContextTruncationWorldDetail, content); err != nil {
			return err
		}
	}
	return nil
}

func compileRealmSourceClosureV3(snapshot localAgentSourceSnapshotV2, items map[agentTurnContextLaneID][]agentTurnContextItem) error {
	closure := snapshot.Semantic.DependencyClosure
	switch closure.Kind {
	case "worldCharacter":
		if closure.BoundEntity == nil || closure.IncidentRelationships == nil || closure.EndpointEntities == nil || closure.ExplicitRelationships != nil {
			return fmt.Errorf("compile Realm WorldCharacter closure: typed closure branch is invalid")
		}
		if err := appendRealmSourceCompilerEntityV3(items, *closure.BoundEntity, "source.closure.boundEntity", "source.world.entity.bound.", true); err != nil {
			return err
		}
		for _, entity := range realmSourceCompilerSortedByIDV3(*closure.EndpointEntities, func(value sourceMaterializationEntityRecordV3) string { return value.ID }) {
			if err := appendRealmSourceCompilerEntityV3(items, entity, "source.closure.endpointEntities."+entity.ID, "source.world.entity.endpoint.", false); err != nil {
				return err
			}
		}
		for _, relationship := range realmSourceCompilerSortedByIDV3(*closure.IncidentRelationships, func(value sourceMaterializationRelationshipRecordV3) string { return value.ID }) {
			if err := appendRealmSourceCompilerRelationshipV3(items, relationship, "source.closure.incidentRelationships."+relationship.ID, "source.relationship.incident.", true); err != nil {
				return err
			}
		}
	case "personaCharacter":
		if closure.BoundEntity != nil || closure.IncidentRelationships != nil || closure.EndpointEntities != nil || closure.ExplicitRelationships == nil {
			return fmt.Errorf("compile Realm PersonaCharacter closure: typed closure branch is invalid")
		}
		for _, relationship := range realmSourceCompilerSortedByIDV3(*closure.ExplicitRelationships, func(value sourceMaterializationRelationshipRecordV3) string { return value.ID }) {
			if err := appendRealmSourceCompilerRelationshipV3(items, relationship, "source.closure.explicitRelationships."+relationship.ID, "source.relationship.explicit.", true); err != nil {
				return err
			}
		}
	default:
		return fmt.Errorf("compile Realm source closure: kind %q is not admitted", closure.Kind)
	}
	for _, entity := range realmSourceCompilerSortedByIDV3(closure.ExplicitEntities, func(value sourceMaterializationEntityRecordV3) string { return value.ID }) {
		if err := appendRealmSourceCompilerEntityV3(items, entity, "source.closure.explicitEntities."+entity.ID, "source.world.entity.explicit.", false); err != nil {
			return err
		}
	}
	return nil
}

func appendRealmSourceCompilerEntityV3(items map[agentTurnContextLaneID][]agentTurnContextItem, entity sourceMaterializationEntityRecordV3, path, stablePrefix string, mandatory bool) error {
	core, err := decodeRealmSourceCompilerEntityCoreV3(entity.Core, path+".core")
	if err != nil {
		return err
	}
	ref := agentTurnContextItemSourceRef{Kind: "worldEntity", WorldID: entity.WorldID, RefID: entity.ID, SchemaVersion: entity.SchemaVersion, ContentHash: entity.ContentHash}
	priority := agentTurnContextV3PriorityOptional
	class := agentTurnContextTruncationWorldDetail
	if mandatory {
		priority = agentTurnContextV3PriorityWorldBaseline - 20
		class = agentTurnContextTruncationNone
	}
	content := agentTurnContextTypedContent("Canonical Realm world entity",
		agentTurnContextTextField{Name: "entity_id", Values: []string{entity.ID}},
		agentTurnContextTextField{Name: "name", Values: []string{core.Identity.Name}},
		agentTurnContextTextField{Name: "summary", Values: []string{core.Identity.Summary}},
		agentTurnContextTextField{Name: "kind", Values: []string{core.Identity.Kind}},
		agentTurnContextTextField{Name: "aliases", Values: agentTurnContextOptionalStrings(core.Identity.Aliases)},
		agentTurnContextTextField{Name: "tags", Values: core.Classification.Tags},
	)
	return appendRealmSourceCompilerItemV3(items, agentTurnContextLaneWorldContext,
		stablePrefix+entity.ID, path, ref, priority, mandatory, class, content)
}

func decodeRealmSourceCompilerEntityCoreV3(value sourceMaterializationJSONValue, path string) (realmSourceCompilerEntityCoreV3, error) {
	generic := value.interfaceValue()
	if _, err := sourceMaterializationClosedObjectV3(generic, path, []string{"identity", "classification", "facts", "evidence", "assets", "authoring"}, nil); err != nil {
		return realmSourceCompilerEntityCoreV3{}, fmt.Errorf("validate typed Realm world entity core: %w", err)
	}
	raw, err := canonicalizeSourceMaterializationRealmV3(generic)
	if err != nil {
		return realmSourceCompilerEntityCoreV3{}, err
	}
	var core realmSourceCompilerEntityCoreV3
	if err := strictDecodeSourceMaterializationV3(raw, &core); err != nil {
		return realmSourceCompilerEntityCoreV3{}, fmt.Errorf("decode typed Realm world entity core: %w", err)
	}
	if strings.TrimSpace(core.Identity.Name) == "" || strings.TrimSpace(core.Identity.Summary) == "" ||
		strings.TrimSpace(core.Identity.Kind) == "" || core.Classification.Tags == nil || core.Facts == nil ||
		core.Evidence.Kind != sourceMaterializationJSONObject || core.Assets.Kind != sourceMaterializationJSONObject ||
		core.Authoring.Kind != sourceMaterializationJSONObject {
		return realmSourceCompilerEntityCoreV3{}, fmt.Errorf("typed Realm world entity core required fields are invalid")
	}
	return core, nil
}

func appendRealmSourceCompilerRelationshipV3(items map[agentTurnContextLaneID][]agentTurnContextItem, relationship sourceMaterializationRelationshipRecordV3, path, stablePrefix string, mandatory bool) error {
	core, err := decodeRealmSourceCompilerRelationshipCoreV3(relationship.Core, path+".core")
	if err != nil {
		return err
	}
	if core.Endpoints.SourceEntityID != relationship.SourceEntityID || core.Endpoints.TargetEntityID != relationship.TargetEntityID || core.Endpoints.Type != relationship.Type {
		return fmt.Errorf("typed Realm world relationship core endpoint binding mismatch")
	}
	ref := agentTurnContextItemSourceRef{Kind: "worldRelationship", WorldID: relationship.WorldID, RefID: relationship.ID, SchemaVersion: relationship.SchemaVersion, ContentHash: relationship.ContentHash}
	priority := agentTurnContextV3PriorityOptional
	class := agentTurnContextTruncationWorldDetail
	if mandatory {
		priority = agentTurnContextV3PriorityRelationship - 10
		class = agentTurnContextTruncationNone
	}
	content := agentTurnContextTypedContent("Canonical Realm world relationship",
		agentTurnContextTextField{Name: "relationship_id", Values: []string{relationship.ID}},
		agentTurnContextTextField{Name: "source_entity_id", Values: []string{relationship.SourceEntityID}},
		agentTurnContextTextField{Name: "target_entity_id", Values: []string{relationship.TargetEntityID}},
		agentTurnContextTextField{Name: "type", Values: []string{relationship.Type}},
		agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(core.Presentation.Summary)},
	)
	return appendRealmSourceCompilerItemV3(items, agentTurnContextLaneRelationshipContext,
		stablePrefix+relationship.ID, path, ref, priority, mandatory, class, content)
}

func decodeRealmSourceCompilerRelationshipCoreV3(value sourceMaterializationJSONValue, path string) (realmSourceCompilerRelationshipCoreV3, error) {
	generic := value.interfaceValue()
	if _, err := sourceMaterializationClosedObjectV3(generic, path, []string{"endpoints", "presentation", "evidence", "authoring"}, []string{"attributes"}); err != nil {
		return realmSourceCompilerRelationshipCoreV3{}, fmt.Errorf("validate typed Realm world relationship core: %w", err)
	}
	raw, err := canonicalizeSourceMaterializationRealmV3(generic)
	if err != nil {
		return realmSourceCompilerRelationshipCoreV3{}, err
	}
	var core realmSourceCompilerRelationshipCoreV3
	if err := strictDecodeSourceMaterializationV3(raw, &core); err != nil {
		return realmSourceCompilerRelationshipCoreV3{}, fmt.Errorf("decode typed Realm world relationship core: %w", err)
	}
	if strings.TrimSpace(core.Endpoints.SourceEntityID) == "" || strings.TrimSpace(core.Endpoints.TargetEntityID) == "" ||
		strings.TrimSpace(core.Endpoints.Type) == "" || core.Evidence.Kind != sourceMaterializationJSONObject ||
		core.Authoring.Kind != sourceMaterializationJSONObject {
		return realmSourceCompilerRelationshipCoreV3{}, fmt.Errorf("typed Realm world relationship core required fields are invalid")
	}
	return core, nil
}

func appendRealmSourceCompilerExemplarV3(items map[agentTurnContextLaneID][]agentTurnContextItem, ref agentTurnContextItemSourceRef, exemplar realmSourceCompilerDialogueExemplarV3) error {
	segments := make([]agentTurnContextSegment, 0, 2)
	if exemplar.User != nil {
		segments = append(segments, agentTurnContextSegment{Role: "user", Content: agentTurnContextTypedContent(
			"Realm source dialogue exemplar user role",
			agentTurnContextTextField{Name: "exemplar_id", Values: []string{exemplar.ExemplarID}},
			agentTurnContextTextField{Name: "utterance", Values: []string{*exemplar.User}},
		)})
	}
	segments = append(segments, agentTurnContextSegment{Role: "assistant", Content: agentTurnContextTypedContent(
		"Realm source dialogue exemplar character role",
		agentTurnContextTextField{Name: "exemplar_id", Values: []string{exemplar.ExemplarID}},
		agentTurnContextTextField{Name: "utterance", Values: []string{exemplar.Character}},
	)})
	item, err := newAgentTurnContextItem(
		agentTurnContextLaneSourceBehavior, "source.behavior.dialogue-exemplar."+exemplar.ExemplarID,
		"source.profile.interactionProfile.dialogueExemplars."+exemplar.ExemplarID,
		ref, agentTurnContextAuthorityRealmSnapshot, agentTurnContextTrustValidatedSource,
		agentTurnContextV3PriorityOptional, 0, false, agentTurnContextTruncationExemplar, segments, nil,
	)
	if err != nil {
		return err
	}
	return appendRealmSourceCompilerUniqueItemV3(items, item)
}

func appendRealmSourceCompilerDynamicItemV3(items map[agentTurnContextLaneID][]agentTurnContextItem, laneID agentTurnContextLaneID, prefix, path string, ref agentTurnContextItemSourceRef, priority int64, mandatory bool, class agentTurnContextTruncationClass, content string) error {
	digest, err := hashAgentTurnContextRef(prefix, ref.RefID, ref.SchemaVersion, path+"\x00"+content)
	if err != nil {
		return err
	}
	return appendRealmSourceCompilerItemV3(items, laneID, prefix+"."+digest[:16], path+"."+digest[:16], ref, priority, mandatory, class, content)
}

func appendRealmSourceCompilerItemV3(items map[agentTurnContextLaneID][]agentTurnContextItem, laneID agentTurnContextLaneID, stableID, path string, ref agentTurnContextItemSourceRef, priority int64, mandatory bool, class agentTurnContextTruncationClass, content string) error {
	item, err := newAgentTurnContextItem(
		laneID, stableID, path, ref, agentTurnContextAuthorityRealmSnapshot,
		agentTurnContextTrustValidatedSource, priority, 0, mandatory, class,
		[]agentTurnContextSegment{{Role: "system", Content: content}}, nil,
	)
	if err != nil {
		return err
	}
	return appendRealmSourceCompilerUniqueItemV3(items, item)
}

func appendRealmSourceCompilerUniqueItemV3(items map[agentTurnContextLaneID][]agentTurnContextItem, item agentTurnContextItem) error {
	for _, existing := range items[item.LaneID] {
		if existing.StableID != item.StableID {
			continue
		}
		if existing.ContentHash == item.ContentHash {
			return nil
		}
		return fmt.Errorf("Realm source compiler produced conflicting stable item id %q", item.StableID)
	}
	items[item.LaneID] = append(items[item.LaneID], item)
	return nil
}

func realmSourceCompilerSourceRefV3(snapshot localAgentSourceSnapshotV2) agentTurnContextItemSourceRef {
	return agentTurnContextItemSourceRef{
		Kind: snapshot.Semantic.SourceRef.Kind, WorldID: snapshot.Semantic.SourceRef.WorldID,
		RefID: snapshot.Semantic.SourceRef.ID, SchemaVersion: snapshot.Semantic.Source.SchemaVersion,
		ContentHash: snapshot.Semantic.Source.ContentHash,
	}
}

func realmSourceCompilerOptionalFloatV3(value *float64) []string {
	if value == nil {
		return nil
	}
	return []string{strconv.FormatFloat(*value, 'g', -1, 64)}
}

func realmSourceCompilerSortedByIDV3[T any](input []T, id func(T) string) []T {
	result := append([]T(nil), input...)
	sort.Slice(result, func(left, right int) bool {
		return strings.Compare(id(result[left]), id(result[right])) < 0
	})
	return result
}
