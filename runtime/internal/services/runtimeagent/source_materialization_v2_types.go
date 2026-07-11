package runtimeagent

import (
	"encoding/json"
	"fmt"
)

type sourceMaterializationWorldCoreV1 struct {
	Identity struct {
		Name        string    `json:"name"`
		Summary     string    `json:"summary"`
		WorldType   *string   `json:"worldType,omitempty"`
		Tagline     *string   `json:"tagline,omitempty"`
		Genre       *string   `json:"genre,omitempty"`
		Themes      *[]string `json:"themes,omitempty"`
		Era         *string   `json:"era,omitempty"`
		Divergences *[]string `json:"divergences,omitempty"`
	} `json:"identity"`
	Presentation struct {
		Title             *string   `json:"title,omitempty"`
		DisplayName       *string   `json:"displayName,omitempty"`
		Tagline           *string   `json:"tagline,omitempty"`
		Palette           *[]string `json:"palette,omitempty"`
		IconResourceRef   *string   `json:"iconResourceRef,omitempty"`
		BannerResourceRef *string   `json:"bannerResourceRef,omitempty"`
	} `json:"presentation"`
	Ontology struct {
		EntityKinds       []string `json:"entityKinds"`
		RelationshipTypes []string `json:"relationshipTypes"`
		Concepts          *[]struct {
			ConceptID string  `json:"conceptId"`
			Name      string  `json:"name"`
			Summary   *string `json:"summary,omitempty"`
		} `json:"concepts,omitempty"`
	} `json:"ontology"`
	TimeModel struct {
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
	} `json:"timeModel"`
	Timeline struct {
		Events []struct {
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
		} `json:"events"`
	} `json:"timeline"`
	Entities []struct {
		EntityID string  `json:"entityId"`
		Kind     string  `json:"kind"`
		Label    *string `json:"label,omitempty"`
		Summary  *string `json:"summary,omitempty"`
	} `json:"entities"`
	Relationships []struct {
		RelationshipID string                          `json:"relationshipId"`
		SourceEntityID string                          `json:"sourceEntityId"`
		TargetEntityID string                          `json:"targetEntityId"`
		Type           string                          `json:"type"`
		Summary        *string                         `json:"summary,omitempty"`
		Attributes     *sourceMaterializationJSONValue `json:"attributes,omitempty"`
	} `json:"relationships"`
	Systems []struct {
		SystemID   string                          `json:"systemId"`
		Name       string                          `json:"name"`
		Summary    string                          `json:"summary"`
		Principles *[]string                       `json:"principles,omitempty"`
		Parameters *sourceMaterializationJSONValue `json:"parameters,omitempty"`
	} `json:"systems"`
	Scenes []struct {
		SceneID    string    `json:"sceneId"`
		Name       string    `json:"name"`
		Summary    string    `json:"summary"`
		EntityRefs *[]string `json:"entityRefs,omitempty"`
		AssetRefs  *[]string `json:"assetRefs,omitempty"`
	} `json:"scenes"`
	Assets    sourceMaterializationAssetsV1    `json:"assets"`
	Authoring sourceMaterializationAuthoringV1 `json:"authoring"`
}

type sourceMaterializationEntityCoreV1 struct {
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
	Facts []struct {
		FactID     string                          `json:"factId"`
		Type       string                          `json:"type"`
		Label      string                          `json:"label"`
		Value      sourceMaterializationJSONValue  `json:"value"`
		SourceRefs *[]string                       `json:"sourceRefs,omitempty"`
		Confidence string                          `json:"confidence"`
		Attributes *sourceMaterializationJSONValue `json:"attributes,omitempty"`
	} `json:"facts"`
	Evidence struct {
		SourceRefs   []string `json:"sourceRefs"`
		Completeness string   `json:"completeness"`
	} `json:"evidence"`
	Assets    sourceMaterializationAssetsV1    `json:"assets"`
	Authoring sourceMaterializationAuthoringV1 `json:"authoring"`
}

type sourceMaterializationRelationshipCoreV1 struct {
	Endpoints struct {
		SourceEntityID string `json:"sourceEntityId"`
		TargetEntityID string `json:"targetEntityId"`
		Type           string `json:"type"`
	} `json:"endpoints"`
	Presentation struct {
		Summary *string `json:"summary,omitempty"`
	} `json:"presentation"`
	Evidence struct {
		SourceRefs []string `json:"sourceRefs"`
		Confidence string   `json:"confidence"`
	} `json:"evidence"`
	Attributes *sourceMaterializationJSONValue  `json:"attributes,omitempty"`
	Authoring  sourceMaterializationAuthoringV1 `json:"authoring"`
}

type sourceMaterializationCharacterCoreV1 struct {
	Identity struct {
		Name    string    `json:"name"`
		Summary string    `json:"summary"`
		Aliases *[]string `json:"aliases,omitempty"`
	} `json:"identity"`
	Presentation struct {
		DisplayName             string  `json:"displayName"`
		ShortBio                string  `json:"shortBio"`
		AvatarResourceRef       *string `json:"avatarResourceRef,omitempty"`
		ProfileCoverResourceRef *string `json:"profileCoverResourceRef,omitempty"`
	} `json:"presentation"`
	Placement struct {
		WorldID   string   `json:"worldId"`
		EntityID  string   `json:"entityId"`
		Role      *string  `json:"role,omitempty"`
		Faction   *string  `json:"faction,omitempty"`
		Rank      *string  `json:"rank,omitempty"`
		SceneRefs []string `json:"sceneRefs"`
	} `json:"placement"`
	Biography struct {
		Milestones []struct {
			MilestoneID string   `json:"milestoneId"`
			Title       string   `json:"title"`
			Summary     string   `json:"summary"`
			Sequence    *float64 `json:"sequence,omitempty"`
		} `json:"milestones"`
		SourceNotes []string `json:"sourceNotes"`
	} `json:"biography"`
	Psychology struct {
		Drives     []string `json:"drives"`
		Boundaries []string `json:"boundaries"`
	} `json:"psychology"`
	Knowledge struct {
		Topics      []string `json:"topics"`
		Constraints []string `json:"constraints"`
	} `json:"knowledge"`
	Relationships []struct {
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
	} `json:"relationships"`
	Capabilities struct {
		InteractionModes []string `json:"interactionModes"`
		Tools            []string `json:"tools"`
	} `json:"capabilities"`
	InteractionProfile struct {
		Tone              string    `json:"tone"`
		Cadence           string    `json:"cadence"`
		Scenario          *string   `json:"scenario,omitempty"`
		Greeting          *string   `json:"greeting,omitempty"`
		GreetingVariants  *[]string `json:"greetingVariants,omitempty"`
		DialogueExemplars *[]string `json:"dialogueExemplars,omitempty"`
	} `json:"interactionProfile"`
	Assets    sourceMaterializationAssetsV1    `json:"assets"`
	Authoring sourceMaterializationAuthoringV1 `json:"authoring"`
}

type sourceMaterializationPersonaCoreV1 struct {
	Identity struct {
		Handle  string    `json:"handle"`
		Name    string    `json:"name"`
		Summary string    `json:"summary"`
		Concept *string   `json:"concept,omitempty"`
		Aliases *[]string `json:"aliases,omitempty"`
	} `json:"identity"`
	Presentation struct {
		DisplayName             string  `json:"displayName"`
		ProfileLine             string  `json:"profileLine"`
		ShortBio                *string `json:"shortBio,omitempty"`
		AvatarResourceRef       *string `json:"avatarResourceRef,omitempty"`
		ProfileCoverResourceRef *string `json:"profileCoverResourceRef,omitempty"`
	} `json:"presentation"`
	PersonaStyle struct {
		Archetype          string    `json:"archetype"`
		Traits             []string  `json:"traits"`
		Voice              string    `json:"voice"`
		Pacing             string    `json:"pacing"`
		CommunicationStyle *string   `json:"communicationStyle,omitempty"`
		DialogueExemplars  *[]string `json:"dialogueExemplars,omitempty"`
	} `json:"personaStyle"`
	ContentProfile struct {
		Topics     []string `json:"topics"`
		Boundaries []string `json:"boundaries"`
		Guidelines []struct {
			GuidelineID string  `json:"guidelineId"`
			Statement   string  `json:"statement"`
			Source      *string `json:"source,omitempty"`
		} `json:"guidelines"`
	} `json:"contentProfile"`
	InteractionProfile struct {
		HomeWorldID       string    `json:"homeWorldId"`
		InteractionModes  []string  `json:"interactionModes"`
		Scenario          *string   `json:"scenario,omitempty"`
		Greeting          *string   `json:"greeting,omitempty"`
		GreetingVariants  *[]string `json:"greetingVariants,omitempty"`
		DialogueExemplars *[]string `json:"dialogueExemplars,omitempty"`
	} `json:"interactionProfile"`
	Assets    sourceMaterializationAssetsV1    `json:"assets"`
	Authoring sourceMaterializationAuthoringV1 `json:"authoring"`
}

type sourceMaterializationWorldV1 struct {
	ID              string                              `json:"id"`
	SchemaVersion   string                              `json:"schemaVersion"`
	ContentRevision uint64                              `json:"contentRevision"`
	ContentHash     string                              `json:"contentHash"`
	Origin          sourceMaterializationOriginV1       `json:"origin"`
	CreatorID       sourceMaterializationNullableString `json:"creatorId"`
	Visibility      string                              `json:"visibility"`
	Core            sourceMaterializationWorldCoreV1    `json:"core"`
	CreatedAt       string                              `json:"createdAt"`
	UpdatedAt       string                              `json:"updatedAt"`
}

type sourceMaterializationEntityV1 struct {
	ID              string                            `json:"id"`
	SchemaVersion   string                            `json:"schemaVersion"`
	ContentRevision uint64                            `json:"contentRevision"`
	ContentHash     string                            `json:"contentHash"`
	Origin          sourceMaterializationOriginV1     `json:"origin"`
	WorldID         string                            `json:"worldId"`
	Kind            string                            `json:"kind"`
	Core            sourceMaterializationEntityCoreV1 `json:"core"`
	CreatedAt       string                            `json:"createdAt"`
	UpdatedAt       string                            `json:"updatedAt"`
}

type sourceMaterializationRelationshipV1 struct {
	ID              string                                  `json:"id"`
	SchemaVersion   string                                  `json:"schemaVersion"`
	ContentRevision uint64                                  `json:"contentRevision"`
	ContentHash     string                                  `json:"contentHash"`
	Origin          sourceMaterializationOriginV1           `json:"origin"`
	WorldID         string                                  `json:"worldId"`
	SourceEntityID  string                                  `json:"sourceEntityId"`
	TargetEntityID  string                                  `json:"targetEntityId"`
	Type            string                                  `json:"type"`
	Core            sourceMaterializationRelationshipCoreV1 `json:"core"`
	CreatedAt       string                                  `json:"createdAt"`
	UpdatedAt       string                                  `json:"updatedAt"`
}

type sourceMaterializationWorldCharacterV2 struct {
	Kind            string                               `json:"kind"`
	ID              string                               `json:"id"`
	SchemaVersion   string                               `json:"schemaVersion"`
	ContentRevision uint64                               `json:"contentRevision"`
	ContentHash     string                               `json:"contentHash"`
	CreatedAt       string                               `json:"createdAt"`
	UpdatedAt       string                               `json:"updatedAt"`
	Origin          sourceMaterializationOriginV1        `json:"origin"`
	CreatorID       string                               `json:"creatorId"`
	Visibility      string                               `json:"visibility"`
	WorldID         string                               `json:"worldId"`
	EntityID        string                               `json:"entityId"`
	Core            sourceMaterializationCharacterCoreV1 `json:"core"`
}

type sourceMaterializationRealmPersonaV2 struct {
	Kind            string                             `json:"kind"`
	ID              string                             `json:"id"`
	SchemaVersion   string                             `json:"schemaVersion"`
	ContentRevision uint64                             `json:"contentRevision"`
	ContentHash     string                             `json:"contentHash"`
	CreatedAt       string                             `json:"createdAt"`
	UpdatedAt       string                             `json:"updatedAt"`
	Origin          sourceMaterializationOriginV1      `json:"origin"`
	OwnerID         string                             `json:"ownerId"`
	HomeWorldID     string                             `json:"homeWorldId"`
	Visibility      string                             `json:"visibility"`
	Core            sourceMaterializationPersonaCoreV1 `json:"core"`
}

type sourceMaterializationDependencyRefV1 struct {
	Kind        string `json:"kind"`
	WorldID     string `json:"worldId"`
	ID          string `json:"id"`
	ContentHash string `json:"contentHash"`
}

type sourceMaterializationCharacterClosureV1 struct {
	Kind                  string                                 `json:"kind"`
	BoundEntity           sourceMaterializationEntityV1          `json:"boundEntity"`
	IncidentRelationships []sourceMaterializationRelationshipV1  `json:"incidentRelationships"`
	EndpointEntities      []sourceMaterializationEntityV1        `json:"endpointEntities"`
	ExplicitDependencies  []sourceMaterializationDependencyRefV1 `json:"explicitDependencies"`
	explicitEntities      []sourceMaterializationEntityV1
}

type sourceMaterializationPersonaClosureV1 struct {
	Kind                 string                                 `json:"kind"`
	ExplicitDependencies []sourceMaterializationDependencyRefV1 `json:"explicitDependencies"`
}

type sourceMaterializationComponentDigestV1 struct {
	ComponentID string `json:"componentId"`
	Kind        string `json:"kind"`
	ContentHash string `json:"contentHash"`
}

type sourceMaterializationCoverageRequiredSectionV1 struct {
	Path  string `json:"path"`
	State string `json:"state"`
}

type sourceMaterializationCoverageRequiredRefV1 struct {
	Path    string `json:"path"`
	RefKind string `json:"refKind"`
	RefID   string `json:"refId"`
	State   string `json:"state"`
}

type sourceMaterializationCoverageOptionalRefV1 struct {
	Path           string  `json:"path"`
	RefKind        string  `json:"refKind"`
	RefID          string  `json:"refId"`
	State          string  `json:"state"`
	OmissionReason *string `json:"omissionReason,omitempty"`
}

type sourceMaterializationCoverageComponentV1 struct {
	ComponentID   string `json:"componentId"`
	Kind          string `json:"kind"`
	SchemaVersion string `json:"schemaVersion"`
	Revision      uint64 `json:"revision"`
	ContentHash   string `json:"contentHash"`
}

type sourceMaterializationCoverageCrossReferenceV1 struct {
	CheckID   string `json:"checkId"`
	State     string `json:"state"`
	SourceRef string `json:"sourceRef"`
	TargetRef string `json:"targetRef"`
}

type sourceMaterializationCoverageManifestV1 struct {
	ManifestSchemaVersion string                                           `json:"manifestSchemaVersion"`
	ClosurePolicyVersion  string                                           `json:"closurePolicyVersion"`
	RequiredSections      []sourceMaterializationCoverageRequiredSectionV1 `json:"requiredSections"`
	RequiredRefs          []sourceMaterializationCoverageRequiredRefV1     `json:"requiredRefs"`
	OptionalRefs          []sourceMaterializationCoverageOptionalRefV1     `json:"optionalRefs"`
	Components            []sourceMaterializationCoverageComponentV1       `json:"components"`
	CrossReferenceChecks  []sourceMaterializationCoverageCrossReferenceV1  `json:"crossReferenceChecks"`
	AggregateStatus       string                                           `json:"aggregateStatus"`
	CoverageManifestHash  string                                           `json:"coverageManifestHash"`
}

type sourceMaterializationSourceUnionV2 struct {
	Character *sourceMaterializationWorldCharacterV2
	Persona   *sourceMaterializationRealmPersonaV2
}

func (value sourceMaterializationSourceUnionV2) MarshalJSON() ([]byte, error) {
	if (value.Character == nil) == (value.Persona == nil) {
		return nil, fmt.Errorf("source materialization source union requires exactly one variant")
	}
	if value.Character != nil {
		return json.Marshal(value.Character)
	}
	return json.Marshal(value.Persona)
}

type sourceMaterializationClosureUnionV1 struct {
	Character *sourceMaterializationCharacterClosureV1
	Persona   *sourceMaterializationPersonaClosureV1
}

type sourceMaterializationSnapshotCharacterClosureV1 struct {
	Kind                  string                                 `json:"kind"`
	BoundEntity           sourceMaterializationEntityV1          `json:"boundEntity"`
	IncidentRelationships []sourceMaterializationRelationshipV1  `json:"incidentRelationships"`
	EndpointEntities      []sourceMaterializationEntityV1        `json:"endpointEntities"`
	ExplicitEntities      []sourceMaterializationEntityV1        `json:"explicitEntities"`
	ExplicitDependencies  []sourceMaterializationDependencyRefV1 `json:"explicitDependencies"`
}

type sourceMaterializationSnapshotPersonaClosureV1 struct {
	Kind                 string                                 `json:"kind"`
	ExplicitDependencies []sourceMaterializationDependencyRefV1 `json:"explicitDependencies"`
}

type sourceMaterializationSnapshotClosureUnionV1 struct {
	Character *sourceMaterializationSnapshotCharacterClosureV1
	Persona   *sourceMaterializationSnapshotPersonaClosureV1
}

func (value sourceMaterializationSnapshotClosureUnionV1) MarshalJSON() ([]byte, error) {
	if (value.Character == nil) == (value.Persona == nil) {
		return nil, fmt.Errorf("source materialization snapshot closure union requires exactly one variant")
	}
	if value.Character != nil {
		return json.Marshal(value.Character)
	}
	return json.Marshal(value.Persona)
}

func (value sourceMaterializationClosureUnionV1) MarshalJSON() ([]byte, error) {
	if (value.Character == nil) == (value.Persona == nil) {
		return nil, fmt.Errorf("source materialization closure union requires exactly one variant")
	}
	if value.Character != nil {
		return json.Marshal(value.Character)
	}
	return json.Marshal(value.Persona)
}

type sourceMaterializationContextValueV1 struct {
	ContextSchemaVersion            string                                   `json:"contextSchemaVersion"`
	SourceRef                       sourceMaterializationSourceRefV2         `json:"sourceRef"`
	OwningWorld                     sourceMaterializationWorldV1             `json:"owningWorld"`
	DependencyClosure               sourceMaterializationClosureUnionV1      `json:"dependencyClosure"`
	SourceComponentDigests          []sourceMaterializationComponentDigestV1 `json:"sourceComponentDigests"`
	WorldAndClosureComponentDigests []sourceMaterializationComponentDigestV1 `json:"worldAndClosureComponentDigests"`
	ClosurePolicyVersion            string                                   `json:"closurePolicyVersion"`
	CoverageManifestHash            string                                   `json:"coverageManifestHash"`
	MaterializationContextHash      string                                   `json:"materializationContextHash"`
}

type sourceMaterializationPayloadValueV2 struct {
	PayloadSchemaVersion       string                                  `json:"payloadSchemaVersion"`
	PayloadAssemblyVersion     string                                  `json:"payloadAssemblyVersion"`
	Source                     sourceMaterializationSourceUnionV2      `json:"source"`
	MaterializationContext     sourceMaterializationContextValueV1     `json:"materializationContext"`
	CoverageManifest           sourceMaterializationCoverageManifestV1 `json:"coverageManifest"`
	CoverageManifestHash       string                                  `json:"coverageManifestHash"`
	MaterializationContextHash string                                  `json:"materializationContextHash"`
}

type sourceMaterializationSnapshotHashInputV1 struct {
	SnapshotSchemaVersion      string                                      `json:"snapshotSchemaVersion"`
	Source                     sourceMaterializationSourceUnionV2          `json:"source"`
	OwningWorld                sourceMaterializationWorldV1                `json:"owningWorld"`
	DependencyClosure          sourceMaterializationSnapshotClosureUnionV1 `json:"dependencyClosure"`
	CoverageManifestHash       string                                      `json:"coverageManifestHash"`
	MaterializationContextHash string                                      `json:"materializationContextHash"`
	NormalizationVersion       string                                      `json:"normalizationVersion"`
}

type normalizedSourceMaterializationV2 struct {
	SourceRef                  sourceMaterializationSourceRefV2
	Character                  *sourceMaterializationWorldCharacterV2
	Persona                    *sourceMaterializationRealmPersonaV2
	OwningWorld                sourceMaterializationWorldV1
	CharacterClosure           *sourceMaterializationSnapshotCharacterClosureV1
	PersonaClosure             *sourceMaterializationSnapshotPersonaClosureV1
	Coverage                   sourceMaterializationCoverageManifestV1
	ComponentDigests           []sourceMaterializationComponentDigestV1
	CoverageManifestHash       string
	MaterializationContextHash string
	PayloadHash                string
	PacketID                   string
	PacketHash                 string
	Issuer                     string
	KeyFingerprint             string
	NormalizationVersion       string
	SnapshotHashInput          sourceMaterializationSnapshotHashInputV1
	SnapshotHash               string
}
