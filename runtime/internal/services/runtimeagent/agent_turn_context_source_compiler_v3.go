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
	Assets               realmSourceCompilerProfileAssetsV3          `json:"assets"`
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

type realmSourceCompilerProfileAssetsV3 struct {
	ResourceRefs []realmSourceCompilerProfileAssetRefV3    `json:"resourceRefs"`
	ExternalRefs *[]realmSourceCompilerProfileAssetRefV3   `json:"externalRefs,omitempty"`
	Intents      []realmSourceCompilerProfileAssetIntentV3 `json:"intents"`
}

type realmSourceCompilerProfileAssetRefV3 struct {
	RefID   string  `json:"refId"`
	Kind    string  `json:"kind"`
	URI     *string `json:"uri,omitempty"`
	Purpose *string `json:"purpose,omitempty"`
	Label   *string `json:"label,omitempty"`
}

type realmSourceCompilerProfileAssetIntentV3 struct {
	IntentID string  `json:"intentId"`
	Kind     string  `json:"kind"`
	Summary  *string `json:"summary,omitempty"`
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
		profile.Assets.ResourceRefs == nil || profile.Assets.Intents == nil || profile.Authoring.Kind != sourceMaterializationJSONObject ||
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
		"source.identity", "semanticPayload.canonicalSource.profile.identity", ref, agentTurnContextV3PriorityIdentity, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("Source identity",
			agentTurnContextTextField{Name: "name", Values: []string{profile.Identity.Name}},
			agentTurnContextTextField{Name: "summary", Values: []string{profile.Identity.Summary}},
			agentTurnContextTextField{Name: "aliases", Values: agentTurnContextOptionalStrings(profile.Identity.Aliases)},
			agentTurnContextTextField{Name: "handle", Values: agentTurnContextOptionalString(profile.Identity.Handle)},
		)); err != nil {
		return err
	}
	if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceIdentity,
		"source.presentation", "semanticPayload.canonicalSource.profile.presentation", ref, agentTurnContextV3PriorityIdentity-10, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("Source presentation",
			agentTurnContextTextField{Name: "display_name", Values: []string{profile.Presentation.DisplayName}},
			agentTurnContextTextField{Name: "profile_line", Values: agentTurnContextOptionalString(profile.Presentation.ProfileLine)},
			agentTurnContextTextField{Name: "short_bio", Values: agentTurnContextOptionalString(profile.Presentation.ShortBio)},
			agentTurnContextTextField{Name: "avatar_resource_ref", Values: agentTurnContextOptionalString(profile.Presentation.AvatarResourceRef)},
			agentTurnContextTextField{Name: "profile_cover_resource_ref", Values: agentTurnContextOptionalString(profile.Presentation.ProfileCoverResourceRef)},
		)); err != nil {
		return err
	}
	if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceIdentity,
		"source.asset-intents", "semanticPayload.canonicalSource.profile.assets", ref, agentTurnContextV3PriorityIdentity-20, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("Proof-covered source asset intents",
			agentTurnContextTextField{Name: "resource_refs", Values: realmSourceCompilerProfileAssetRefsV3(profile.Assets.ResourceRefs)},
			agentTurnContextTextField{Name: "intents", Values: realmSourceCompilerProfileAssetIntentsV3(profile.Assets.Intents)},
			agentTurnContextTextField{Name: "external_refs", Values: realmSourceCompilerProfileOptionalAssetRefsV3(profile.Assets.ExternalRefs)},
		)); err != nil {
		return err
	}
	if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceBehavior,
		"source.behavior.narrative", "semanticPayload.canonicalSource.profile.narrative", ref, agentTurnContextV3PriorityCoreBehavior, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("Source narrative behavior",
			agentTurnContextTextField{Name: "summary", Values: []string{profile.Narrative.Summary}},
			agentTurnContextTextField{Name: "archetype", Values: agentTurnContextOptionalString(profile.Narrative.Archetype)},
			agentTurnContextTextField{Name: "traits", Values: agentTurnContextOptionalStrings(profile.Narrative.Traits)},
		)); err != nil {
		return err
	}
	interaction := profile.InteractionProfile
	if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceBehavior,
		"source.behavior.interaction", "semanticPayload.canonicalSource.profile.interactionProfile", ref, agentTurnContextV3PriorityCoreBehavior-10, true, agentTurnContextTruncationNone,
		agentTurnContextTypedContent("Source interaction behavior",
			agentTurnContextTextField{Name: "interaction_modes", Values: interaction.InteractionModes},
			agentTurnContextTextField{Name: "tone", Values: agentTurnContextOptionalString(interaction.Tone)},
			agentTurnContextTextField{Name: "cadence", Values: agentTurnContextOptionalString(interaction.Cadence)},
			agentTurnContextTextField{Name: "scenario", Values: agentTurnContextOptionalString(interaction.Scenario)},
		)); err != nil {
		return err
	}
	// Greeting values remain immutable proof-covered SnapshotV2 data. They are
	// deliberately not part of the per-turn provider context: only the
	// Runtime-owned new-conversation lifecycle may surface one greeting.
	if profile.Psychology != nil {
		if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceBehavior,
			"source.behavior.psychology", "semanticPayload.canonicalSource.profile.psychology", ref, agentTurnContextV3PriorityCoreBehavior-20, true, agentTurnContextTruncationNone,
			agentTurnContextTypedContent("Source psychology",
				agentTurnContextTextField{Name: "drives", Values: agentTurnContextOptionalStrings(profile.Psychology.Drives)},
				agentTurnContextTextField{Name: "boundaries", Values: agentTurnContextOptionalStrings(profile.Psychology.Boundaries)},
			)); err != nil {
			return err
		}
	} else if err := appendRealmSourceCompilerOmittedItemV3(items, agentTurnContextLaneSourceBehavior,
		"source.behavior.psychology", "semanticPayload.canonicalSource.profile.psychology", ref,
		agentTurnContextV3PriorityCoreBehavior-20, "optional_source_section_absent"); err != nil {
		return err
	}
	if profile.Capabilities != nil {
		if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceBehavior,
			"source.behavior.descriptive-capabilities", "semanticPayload.canonicalSource.profile.capabilities", ref,
			agentTurnContextV3PriorityCoreBehavior-30, true, agentTurnContextTruncationNone,
			agentTurnContextTypedContent("Descriptive source capabilities; these grant no Runtime tool",
				agentTurnContextTextField{Name: "tools", Values: realmSourceCompilerProfileToolsV3(profile.Capabilities.Tools)},
			)); err != nil {
			return err
		}
	} else if err := appendRealmSourceCompilerOmittedItemV3(items, agentTurnContextLaneSourceBehavior,
		"source.behavior.descriptive-capabilities", "semanticPayload.canonicalSource.profile.capabilities", ref,
		agentTurnContextV3PriorityCoreBehavior-30, "optional_source_section_absent"); err != nil {
		return err
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
			content := agentTurnContextTypedContent("Declared source relationship",
				agentTurnContextTextField{Name: "relationship_id", Values: []string{relationship.RelationshipID}},
				agentTurnContextTextField{Name: "target_kind", Values: []string{relationship.TargetRef.Kind}},
				agentTurnContextTextField{Name: "target_world_id", Values: []string{relationship.TargetRef.WorldID}},
				agentTurnContextTextField{Name: "target_entity_id", Values: []string{relationship.TargetRef.EntityID}},
				agentTurnContextTextField{Name: "relation_type", Values: []string{relationship.RelationType}},
				agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(relationship.Summary)},
			)
			if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneRelationshipContext,
				"source.relationship.profile."+relationship.RelationshipID,
				"semanticPayload.canonicalSource.profile.relationships."+relationship.RelationshipID, ref,
				agentTurnContextV3PriorityRelationship, true, agentTurnContextTruncationNone, content); err != nil {
				return err
			}
		}
	}
	if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceKnowledge,
		"source.knowledge.narrative", "semanticPayload.canonicalSource.profile.narrative", ref,
		agentTurnContextV3PriorityKnowledge, false, agentTurnContextTruncationKnowledge,
		agentTurnContextTypedContent("Source narrative knowledge",
			agentTurnContextTextField{Name: "summary", Values: []string{profile.Narrative.Summary}},
			agentTurnContextTextField{Name: "archetype", Values: agentTurnContextOptionalString(profile.Narrative.Archetype)},
			agentTurnContextTextField{Name: "traits", Values: agentTurnContextOptionalStrings(profile.Narrative.Traits)},
		)); err != nil {
		return err
	}
	if profile.Knowledge != nil {
		if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceKnowledge,
			"source.knowledge.typed", "semanticPayload.canonicalSource.profile.knowledge", ref,
			agentTurnContextV3PriorityKnowledge+100, false, agentTurnContextTruncationKnowledge,
			agentTurnContextTypedContent("Typed source knowledge",
				agentTurnContextTextField{Name: "topics", Values: agentTurnContextOptionalStrings(profile.Knowledge.Topics)},
				agentTurnContextTextField{Name: "constraints", Values: agentTurnContextOptionalStrings(profile.Knowledge.Constraints)},
			)); err != nil {
			return err
		}
	} else if err := appendRealmSourceCompilerOmittedItemV3(items, agentTurnContextLaneSourceKnowledge,
		"source.knowledge.typed", "semanticPayload.canonicalSource.profile.knowledge", ref,
		agentTurnContextV3PriorityKnowledge+100, "optional_source_section_absent"); err != nil {
		return err
	}
	if profile.Narrative.Milestones != nil {
		for _, milestone := range append([]realmSourceCompilerProfileMilestoneV3(nil), (*profile.Narrative.Milestones)...) {
			content := agentTurnContextTypedContent("Source narrative milestone",
				agentTurnContextTextField{Name: "sequence", Values: realmSourceCompilerOptionalFloatV3(milestone.Sequence)},
				agentTurnContextTextField{Name: "title", Values: agentTurnContextOptionalString(milestone.Title)},
				agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(milestone.Summary)},
			)
			if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneSourceKnowledge,
				"source.knowledge.milestone."+milestone.MilestoneID,
				"semanticPayload.canonicalSource.profile.narrative.milestones."+milestone.MilestoneID, ref,
				agentTurnContextV3PriorityOptional, false, agentTurnContextTruncationKnowledge, content); err != nil {
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
	baseline := agentTurnContextTypedContent("Canonical owning world baseline",
		agentTurnContextTextField{Name: "name", Values: []string{world.Identity.Name}},
		agentTurnContextTextField{Name: "summary", Values: []string{world.Identity.Summary}},
		agentTurnContextTextField{Name: "world_type", Values: agentTurnContextOptionalString(world.Identity.WorldType)},
		agentTurnContextTextField{Name: "tagline", Values: realmSourceCompilerFirstOptionalStringV3(world.Identity.Tagline, world.Presentation.Tagline)},
		agentTurnContextTextField{Name: "genre", Values: agentTurnContextOptionalString(world.Identity.Genre)},
		agentTurnContextTextField{Name: "themes", Values: agentTurnContextOptionalStrings(world.Identity.Themes)},
		agentTurnContextTextField{Name: "era", Values: agentTurnContextOptionalString(world.Identity.Era)},
		agentTurnContextTextField{Name: "entity_kinds", Values: world.Ontology.EntityKinds},
		agentTurnContextTextField{Name: "relationship_types", Values: world.Ontology.RelationshipTypes},
		agentTurnContextTextField{Name: "time_mode", Values: []string{world.TimeModel.Mode}},
		agentTurnContextTextField{Name: "time_flow_ratio", Values: []string{strconv.FormatFloat(world.TimeModel.FlowRatio, 'g', -1, 64)}},
	)
	if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneWorldContext,
		"source.world.baseline", "semanticPayload.materializationContext.owningWorld.core", ref,
		agentTurnContextV3PriorityWorldBaseline, true, agentTurnContextTruncationNone, baseline); err != nil {
		return err
	}
	if snapshot.Semantic.SourceRef.Kind == "worldCharacter" {
		placement := snapshot.Semantic.SourceRef.WorldEntityRef
		if placement == nil {
			return fmt.Errorf("compile Realm WorldCharacter placement: sourceRef.worldEntityRef is absent")
		}
		if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneWorldContext,
			"source.world.character-placement", "sourceRef.worldEntityRef", realmSourceCompilerSourceRefV3(snapshot),
			agentTurnContextV3PriorityWorldBaseline-10, true, agentTurnContextTruncationNone,
			agentTurnContextTypedContent("WorldCharacter placement",
				agentTurnContextTextField{Name: "world_id", Values: []string{snapshot.Semantic.SourceRef.WorldID}},
				agentTurnContextTextField{Name: "entity_id", Values: []string{placement.EntityID}},
				agentTurnContextTextField{Name: "entity_kind", Values: []string{placement.Kind}},
			)); err != nil {
			return err
		}
	}
	for _, system := range realmSourceCompilerSortedByIDV3(world.Systems, func(value realmSourceCompilerWorldSystemV3) string { return value.SystemID }) {
		content := agentTurnContextTypedContent("Canonical world system",
			agentTurnContextTextField{Name: "name", Values: []string{system.Name}},
			agentTurnContextTextField{Name: "summary", Values: []string{system.Summary}},
			agentTurnContextTextField{Name: "principles", Values: agentTurnContextOptionalStrings(system.Principles)},
		)
		if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneWorldContext,
			"source.world.system."+system.SystemID, "semanticPayload.materializationContext.owningWorld.core.system."+system.SystemID,
			ref, agentTurnContextV3PriorityOptional, false, agentTurnContextTruncationWorldDetail, content); err != nil {
			return err
		}
	}
	for _, scene := range realmSourceCompilerSortedByIDV3(world.Scenes, func(value realmSourceCompilerWorldSceneV3) string { return value.SceneID }) {
		content := agentTurnContextTypedContent("Canonical world scene",
			agentTurnContextTextField{Name: "name", Values: []string{scene.Name}},
			agentTurnContextTextField{Name: "summary", Values: []string{scene.Summary}},
			agentTurnContextTextField{Name: "entity_refs", Values: agentTurnContextOptionalStrings(scene.EntityRefs)},
		)
		if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneWorldContext,
			"source.world.scene."+scene.SceneID, "semanticPayload.materializationContext.owningWorld.core.scene."+scene.SceneID,
			ref, agentTurnContextV3PriorityOptional, false, agentTurnContextTruncationWorldDetail, content); err != nil {
			return err
		}
	}
	for _, event := range realmSourceCompilerSortedByIDV3(world.Timeline.Events, func(value realmSourceCompilerWorldEventV3) string { return value.EventID }) {
		content := agentTurnContextTypedContent("Canonical world timeline",
			agentTurnContextTextField{Name: "title", Values: []string{event.Title}},
			agentTurnContextTextField{Name: "summary", Values: agentTurnContextOptionalString(event.Summary)},
			agentTurnContextTextField{Name: "entity_refs", Values: agentTurnContextOptionalStrings(event.EntityRefs)},
			agentTurnContextTextField{Name: "timestamp", Values: agentTurnContextOptionalString(event.Timestamp)},
			agentTurnContextTextField{Name: "starts_at", Values: agentTurnContextOptionalString(event.StartsAt)},
			agentTurnContextTextField{Name: "ends_at", Values: agentTurnContextOptionalString(event.EndsAt)},
		)
		if err := appendRealmSourceCompilerItemV3(items, agentTurnContextLaneWorldContext,
			"source.world.timeline."+event.EventID, "semanticPayload.materializationContext.owningWorld.core.timeline."+event.EventID,
			ref, agentTurnContextV3PriorityOptional, false, agentTurnContextTruncationWorldDetail, content); err != nil {
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
		bound := *closure.BoundEntity
		if err := appendRealmSourceCompilerEntityV3(items, bound,
			"semanticPayload.materializationContext.dependencyClosure.entities."+bound.ID,
			"source.world.entity.", true); err != nil {
			return err
		}
		entities := append(append([]sourceMaterializationEntityRecordV3(nil), (*closure.EndpointEntities)...), closure.ExplicitEntities...)
		seen := map[string]struct{}{bound.ID: {}}
		for _, entity := range realmSourceCompilerSortedByIDV3(entities, func(value sourceMaterializationEntityRecordV3) string { return value.ID }) {
			if _, duplicate := seen[entity.ID]; duplicate {
				continue
			}
			seen[entity.ID] = struct{}{}
			if err := appendRealmSourceCompilerEntityV3(items, entity,
				"semanticPayload.materializationContext.dependencyClosure.entities."+entity.ID,
				"source.world.entity.", false); err != nil {
				return err
			}
		}
		for _, relationship := range realmSourceCompilerSortedByIDV3(*closure.IncidentRelationships, func(value sourceMaterializationRelationshipRecordV3) string { return value.ID }) {
			if err := appendRealmSourceCompilerRelationshipV3(items, relationship,
				"semanticPayload.materializationContext.dependencyClosure.relationships."+relationship.ID,
				"source.relationship.world.", true); err != nil {
				return err
			}
		}
	case "personaCharacter":
		if closure.BoundEntity != nil || closure.IncidentRelationships != nil || closure.EndpointEntities != nil || closure.ExplicitRelationships == nil {
			return fmt.Errorf("compile Realm PersonaCharacter closure: typed closure branch is invalid")
		}
		for _, relationship := range realmSourceCompilerSortedByIDV3(*closure.ExplicitRelationships, func(value sourceMaterializationRelationshipRecordV3) string { return value.ID }) {
			if err := appendRealmSourceCompilerRelationshipV3(items, relationship,
				"semanticPayload.materializationContext.dependencyClosure.relationships."+relationship.ID,
				"source.relationship.world.", true); err != nil {
				return err
			}
		}
		for _, entity := range realmSourceCompilerSortedByIDV3(closure.ExplicitEntities, func(value sourceMaterializationEntityRecordV3) string { return value.ID }) {
			if err := appendRealmSourceCompilerEntityV3(items, entity,
				"semanticPayload.materializationContext.dependencyClosure.entities."+entity.ID,
				"source.world.entity.", false); err != nil {
				return err
			}
		}
	default:
		return fmt.Errorf("compile Realm source closure: kind %q is not admitted", closure.Kind)
	}
	if len(items[agentTurnContextLaneRelationshipContext]) == 0 {
		if err := appendRealmSourceCompilerOmittedItemV3(items, agentTurnContextLaneRelationshipContext,
			"source.relationship.none", "semanticPayload.canonicalSource.profile.relationships",
			realmSourceCompilerSourceRefV3(snapshot), agentTurnContextV3PriorityOptional,
			"no_source_or_closure_relationships"); err != nil {
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
	content := agentTurnContextTypedContent("Canonical world entity",
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
	content := agentTurnContextTypedContent("Canonical world relationship",
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
			"Source dialogue exemplar user role; not transcript",
			agentTurnContextTextField{Name: "exemplar_id", Values: []string{exemplar.ExemplarID}},
			agentTurnContextTextField{Name: "utterance", Values: []string{*exemplar.User}},
		)})
	}
	segments = append(segments, agentTurnContextSegment{Role: "assistant", Content: agentTurnContextTypedContent(
		"Source dialogue exemplar character role; not transcript",
		agentTurnContextTextField{Name: "exemplar_id", Values: []string{exemplar.ExemplarID}},
		agentTurnContextTextField{Name: "utterance", Values: []string{exemplar.Character}},
	)})
	item, err := newAgentTurnContextItem(
		agentTurnContextLaneSourceBehavior, "source.behavior.exemplar."+exemplar.ExemplarID,
		"semanticPayload.canonicalSource.profile.interactionProfile.dialogueExemplars."+exemplar.ExemplarID,
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

func appendRealmSourceCompilerOmittedItemV3(
	items map[agentTurnContextLaneID][]agentTurnContextItem,
	laneID agentTurnContextLaneID,
	stableID string,
	path string,
	ref agentTurnContextItemSourceRef,
	priority int64,
	omissionReason string,
) error {
	omissionReason = strings.TrimSpace(omissionReason)
	if omissionReason == "" {
		return fmt.Errorf("Realm source compiler omission reason is empty")
	}
	item, err := newAgentTurnContextItem(
		laneID, stableID, path, ref, agentTurnContextAuthorityRealmSnapshot,
		agentTurnContextTrustValidatedSource, priority, 0, false,
		agentTurnContextTruncationNone,
		[]agentTurnContextSegment{{Role: "system", Content: omissionReason}}, nil,
	)
	if err != nil {
		return err
	}
	item.OmissionReason = omissionReason
	item.Segments = []agentTurnContextSegment{}
	item.Media = []agentTurnContextMedia{}
	item.TokenEstimate = 0
	item.Included = false
	item.Truncated = false
	item.ContentHash, err = hashAgentTurnContextItem(item)
	if err != nil {
		return fmt.Errorf("hash omitted Realm source item %s: %w", stableID, err)
	}
	return appendRealmSourceCompilerUniqueItemV3(items, item)
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

func realmSourceCompilerFirstOptionalStringV3(values ...*string) []string {
	for _, value := range values {
		if result := agentTurnContextOptionalString(value); len(result) > 0 {
			return result
		}
	}
	return nil
}

func realmSourceCompilerProfileAssetRefsV3(values []realmSourceCompilerProfileAssetRefV3) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, value.RefID+":"+value.Kind+":"+realmSourceCompilerOptionalStringValueV3(value.Purpose))
	}
	return result
}

func realmSourceCompilerProfileOptionalAssetRefsV3(values *[]realmSourceCompilerProfileAssetRefV3) []string {
	if values == nil {
		return nil
	}
	return realmSourceCompilerProfileAssetRefsV3(*values)
}

func realmSourceCompilerProfileAssetIntentsV3(values []realmSourceCompilerProfileAssetIntentV3) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, value.IntentID+":"+value.Kind+":"+realmSourceCompilerOptionalStringValueV3(value.Summary))
	}
	return result
}

func realmSourceCompilerProfileToolsV3(values *[]realmSourceCompilerProfileToolV3) []string {
	if values == nil {
		return nil
	}
	result := make([]string, 0, len(*values))
	for _, value := range *values {
		result = append(result, value.ToolID+":"+realmSourceCompilerOptionalStringValueV3(value.Name)+":"+realmSourceCompilerOptionalStringValueV3(value.Summary))
	}
	return result
}

func realmSourceCompilerOptionalStringValueV3(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
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
