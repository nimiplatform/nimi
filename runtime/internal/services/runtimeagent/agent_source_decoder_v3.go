package runtimeagent

import (
	"fmt"
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
