package runtimeagent

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

func validateMaterializationString(value string, field string) error {
	if strings.TrimSpace(value) == "" {
		return sourceMaterializationInvalid("%s must be non-empty", field)
	}
	return nil
}

func validateMaterializationStrings(values []string, field string) error {
	if values == nil {
		return sourceMaterializationInvalid("%s is required", field)
	}
	for index, value := range values {
		if err := validateMaterializationString(value, fmt.Sprintf("%s[%d]", field, index)); err != nil {
			return err
		}
	}
	return nil
}

func validateMaterializationOptionalStrings(values *[]string, field string) error {
	if values == nil {
		return nil
	}
	return validateMaterializationStrings(*values, field)
}

func validateMaterializationInstant(value string, field string) error {
	if !strings.HasSuffix(value, "Z") {
		return sourceMaterializationInvalid("%s must be a UTC instant", field)
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil || parsed.Nanosecond()%int(time.Millisecond) != 0 {
		return sourceMaterializationInvalid("%s must be a millisecond UTC instant", field)
	}
	return nil
}

func validateMaterializationVisibility(value string, field string) error {
	switch value {
	case "private", "unlisted", "public", "system":
		return nil
	default:
		return sourceMaterializationInvalid("%s is not an admitted visibility", field)
	}
}

func validateMaterializationOrigin(value sourceMaterializationOriginV1, field string) error {
	required := func(pointer *string, name string) error {
		if pointer == nil {
			return sourceMaterializationInvalid("%s.%s is required for origin kind %s", field, name, value.Kind)
		}
		return validateMaterializationString(*pointer, field+"."+name)
	}
	switch value.Kind {
	case "manual":
	case "forge":
		for name, pointer := range map[string]*string{"sourceId": value.SourceID, "sourceVersion": value.SourceVersion, "sourceContentHash": value.SourceContentHash} {
			if err := required(pointer, name); err != nil {
				return err
			}
		}
	case "worldCharacterDerivation":
		for name, pointer := range map[string]*string{"parentWorldId": value.ParentWorldID, "parentCharacterId": value.ParentCharacterID, "sourceContentHash": value.SourceContentHash} {
			if err := required(pointer, name); err != nil {
				return err
			}
		}
	case "import":
		for name, pointer := range map[string]*string{"sourceId": value.SourceID, "sourceContentHash": value.SourceContentHash} {
			if err := required(pointer, name); err != nil {
				return err
			}
		}
	case "system":
		if err := required(value.SourceID, "sourceId"); err != nil {
			return err
		}
	default:
		return sourceMaterializationInvalid("%s.kind is not admitted", field)
	}
	return nil
}

func validateMaterializationJSONValue(value sourceMaterializationJSONValue, objectRequired bool, field string) error {
	if !value.Present {
		return sourceMaterializationInvalid("%s is required", field)
	}
	if objectRequired && value.Kind != sourceMaterializationJSONObject {
		return sourceMaterializationInvalid("%s must be an object", field)
	}
	switch value.Kind {
	case sourceMaterializationJSONNull, sourceMaterializationJSONBoolean, sourceMaterializationJSONString:
		return nil
	case sourceMaterializationJSONNumber:
		number, err := strconvParseMaterializationNumber(value.Number)
		if err != nil || math.IsInf(number, 0) || math.IsNaN(number) {
			return sourceMaterializationInvalid("%s contains an invalid number", field)
		}
	case sourceMaterializationJSONArray:
		for index, item := range value.Array {
			if err := validateMaterializationJSONValue(item, false, fmt.Sprintf("%s[%d]", field, index)); err != nil {
				return err
			}
		}
	case sourceMaterializationJSONObject:
		seen := map[string]struct{}{}
		for _, member := range value.Object {
			switch strings.ToLower(member.Name) {
			case "systempromptbase", "systemprompt", "rawsystemprompt", "developerprompt", "rawdeveloperprompt", "promptmap":
				return sourceMaterializationInvalid("%s contains forbidden raw prompt field %q", field, member.Name)
			}
			if _, duplicate := seen[member.Name]; duplicate {
				return sourceMaterializationInvalid("%s contains duplicate member %q", field, member.Name)
			}
			seen[member.Name] = struct{}{}
			if err := validateMaterializationJSONValue(member.Value, false, field+"."+member.Name); err != nil {
				return err
			}
		}
	default:
		return sourceMaterializationInvalid("%s contains an invalid JSON value", field)
	}
	return nil
}

func strconvParseMaterializationNumber(value string) (float64, error) {
	return strconv.ParseFloat(value, 64)
}

func validateMaterializationAssets(value sourceMaterializationAssetsV1, field string) error {
	if value.ResourceRefs == nil || value.Intents == nil {
		return sourceMaterializationInvalid("%s resourceRefs and intents are required", field)
	}
	for index, ref := range value.ResourceRefs {
		if err := validateMaterializationString(ref.RefID, fmt.Sprintf("%s.resourceRefs[%d].refId", field, index)); err != nil {
			return err
		}
		if err := validateMaterializationString(ref.Kind, fmt.Sprintf("%s.resourceRefs[%d].kind", field, index)); err != nil {
			return err
		}
	}
	if value.ExternalRefs != nil {
		for index, ref := range *value.ExternalRefs {
			if err := validateMaterializationString(ref.RefID, fmt.Sprintf("%s.externalRefs[%d].refId", field, index)); err != nil {
				return err
			}
			if err := validateMaterializationString(ref.Kind, fmt.Sprintf("%s.externalRefs[%d].kind", field, index)); err != nil {
				return err
			}
			if err := validateMaterializationString(ref.URI, fmt.Sprintf("%s.externalRefs[%d].uri", field, index)); err != nil {
				return err
			}
			lower := strings.ToLower(ref.URI)
			for _, marker := range []string{"x-amz-signature=", "signature=", "sig=", "token=", "expires="} {
				if strings.Contains(lower, marker) {
					return sourceMaterializationInvalid("%s.externalRefs[%d].uri contains transient credentials", field, index)
				}
			}
		}
	}
	for index, intent := range value.Intents {
		if err := validateMaterializationString(intent.IntentID, fmt.Sprintf("%s.intents[%d].intentId", field, index)); err != nil {
			return err
		}
		if err := validateMaterializationString(intent.Kind, fmt.Sprintf("%s.intents[%d].kind", field, index)); err != nil {
			return err
		}
	}
	return nil
}

func validateMaterializationAuthoring(value sourceMaterializationAuthoringV1, field string) error {
	if err := validateMaterializationString(value.Source, field+".source"); err != nil {
		return err
	}
	if err := validateMaterializationOptionalStrings(value.Maintainers, field+".maintainers"); err != nil {
		return err
	}
	if err := validateMaterializationOptionalStrings(value.Notes, field+".notes"); err != nil {
		return err
	}
	if value.Review != nil {
		if err := validateMaterializationString(value.Review.Status, field+".review.status"); err != nil {
			return err
		}
	}
	if value.Extensions != nil {
		if err := validateMaterializationJSONValue(*value.Extensions, true, field+".extensions"); err != nil {
			return err
		}
	}
	return nil
}

func requireMaterializationTopFields(raw []byte, field string, fields ...string) error {
	decoded, err := decodeSourceMaterializationJSON(raw)
	if err != nil {
		return sourceMaterializationInvalid("%s JSON is invalid: %v", field, err)
	}
	record, ok := decoded.(map[string]any)
	if !ok {
		return sourceMaterializationInvalid("%s must be an object", field)
	}
	for _, name := range fields {
		if _, exists := record[name]; !exists {
			return sourceMaterializationInvalid("%s.%s is required", field, name)
		}
	}
	return nil
}

func requireMaterializationNestedFields(raw []byte, field string, parent string, fields ...string) error {
	decoded, err := decodeSourceMaterializationJSON(raw)
	if err != nil {
		return sourceMaterializationInvalid("%s JSON is invalid: %v", field, err)
	}
	record, ok := decoded.(map[string]any)
	if !ok {
		return sourceMaterializationInvalid("%s must be an object", field)
	}
	nested, ok := record[parent].(map[string]any)
	if !ok {
		return sourceMaterializationInvalid("%s.%s must be an object", field, parent)
	}
	for _, name := range fields {
		if _, exists := nested[name]; !exists {
			return sourceMaterializationInvalid("%s.%s.%s is required", field, parent, name)
		}
	}
	return nil
}

func validateMaterializationWorldCore(value sourceMaterializationWorldCoreV1) error {
	if err := validateMaterializationString(value.Identity.Name, "WorldCore.core.identity.name"); err != nil {
		return err
	}
	if err := validateMaterializationString(value.Identity.Summary, "WorldCore.core.identity.summary"); err != nil {
		return err
	}
	if err := validateMaterializationOptionalStrings(value.Identity.Themes, "WorldCore.core.identity.themes"); err != nil {
		return err
	}
	if err := validateMaterializationOptionalStrings(value.Identity.Divergences, "WorldCore.core.identity.divergences"); err != nil {
		return err
	}
	if err := validateMaterializationStrings(value.Ontology.EntityKinds, "WorldCore.core.ontology.entityKinds"); err != nil {
		return err
	}
	if err := validateMaterializationStrings(value.Ontology.RelationshipTypes, "WorldCore.core.ontology.relationshipTypes"); err != nil {
		return err
	}
	if value.Ontology.Concepts != nil {
		for index, concept := range *value.Ontology.Concepts {
			if err := validateMaterializationString(concept.ConceptID, fmt.Sprintf("WorldCore.core.ontology.concepts[%d].conceptId", index)); err != nil {
				return err
			}
			if err := validateMaterializationString(concept.Name, fmt.Sprintf("WorldCore.core.ontology.concepts[%d].name", index)); err != nil {
				return err
			}
		}
	}
	if value.TimeModel.Mode != "wallClockAnchored" && value.TimeModel.Mode != "static" {
		return sourceMaterializationInvalid("WorldCore.core.timeModel.mode is not admitted")
	}
	if value.TimeModel.FlowRatio <= 0 || math.IsInf(value.TimeModel.FlowRatio, 0) || math.IsNaN(value.TimeModel.FlowRatio) || value.TimeModel.IsPaused == nil {
		return sourceMaterializationInvalid("WorldCore.core.timeModel flowRatio/isPaused is invalid")
	}
	for field, text := range map[string]string{
		"realStartedAt": value.TimeModel.Anchor.RealStartedAt, "worldStartedAt": value.TimeModel.Anchor.WorldStartedAt,
		"worldStartedAtDisplay": value.TimeModel.Anchor.WorldStartedAtDisplay,
	} {
		if err := validateMaterializationString(text, "WorldCore.core.timeModel.anchor."+field); err != nil {
			return err
		}
	}
	for field, nullable := range map[string]sourceMaterializationNullableString{
		"pausedWorldTime": value.TimeModel.PausedWorldTime, "calendar": value.TimeModel.Calendar, "displayFormat": value.TimeModel.DisplayFormat,
	} {
		if !nullable.Present {
			return sourceMaterializationInvalid("WorldCore.core.timeModel.%s is required", field)
		}
	}
	if value.Timeline.Events == nil || value.Entities == nil || value.Relationships == nil || value.Systems == nil || value.Scenes == nil {
		return sourceMaterializationInvalid("WorldCore.core graph arrays are required")
	}
	for index, event := range value.Timeline.Events {
		if err := validateMaterializationString(event.EventID, fmt.Sprintf("WorldCore.core.timeline.events[%d].eventId", index)); err != nil {
			return err
		}
		if err := validateMaterializationString(event.Title, fmt.Sprintf("WorldCore.core.timeline.events[%d].title", index)); err != nil {
			return err
		}
		if event.Sequence != nil && (math.IsInf(*event.Sequence, 0) || math.IsNaN(*event.Sequence)) {
			return sourceMaterializationInvalid("WorldCore timeline sequence is not finite")
		}
	}
	seenEntities := map[string]struct{}{}
	for index, entity := range value.Entities {
		if err := validateMaterializationString(entity.EntityID, fmt.Sprintf("WorldCore.core.entities[%d].entityId", index)); err != nil {
			return err
		}
		if err := validateMaterializationString(entity.Kind, fmt.Sprintf("WorldCore.core.entities[%d].kind", index)); err != nil {
			return err
		}
		if _, duplicate := seenEntities[entity.EntityID]; duplicate {
			return sourceMaterializationInvalid("WorldCore entity index is duplicated")
		}
		seenEntities[entity.EntityID] = struct{}{}
	}
	seenRelationships := map[string]struct{}{}
	for index, relationship := range value.Relationships {
		for name, text := range map[string]string{"relationshipId": relationship.RelationshipID, "sourceEntityId": relationship.SourceEntityID, "targetEntityId": relationship.TargetEntityID, "type": relationship.Type} {
			if err := validateMaterializationString(text, fmt.Sprintf("WorldCore.core.relationships[%d].%s", index, name)); err != nil {
				return err
			}
		}
		if _, duplicate := seenRelationships[relationship.RelationshipID]; duplicate {
			return sourceMaterializationInvalid("WorldCore relationship index is duplicated")
		}
		seenRelationships[relationship.RelationshipID] = struct{}{}
		if relationship.Attributes != nil {
			if err := validateMaterializationJSONValue(*relationship.Attributes, true, "WorldCore relationship attributes"); err != nil {
				return err
			}
		}
	}
	for index, system := range value.Systems {
		for name, text := range map[string]string{"systemId": system.SystemID, "name": system.Name, "summary": system.Summary} {
			if err := validateMaterializationString(text, fmt.Sprintf("WorldCore.core.systems[%d].%s", index, name)); err != nil {
				return err
			}
		}
		if system.Parameters != nil {
			if err := validateMaterializationJSONValue(*system.Parameters, true, "WorldCore system parameters"); err != nil {
				return err
			}
		}
	}
	for index, scene := range value.Scenes {
		for name, text := range map[string]string{"sceneId": scene.SceneID, "name": scene.Name, "summary": scene.Summary} {
			if err := validateMaterializationString(text, fmt.Sprintf("WorldCore.core.scenes[%d].%s", index, name)); err != nil {
				return err
			}
		}
	}
	if err := validateMaterializationAssets(value.Assets, "WorldCore.core.assets"); err != nil {
		return err
	}
	return validateMaterializationAuthoring(value.Authoring, "WorldCore.core.authoring")
}

func validateMaterializationCharacterCore(value sourceMaterializationCharacterCoreV1, worldID string, entityID string) error {
	for name, text := range map[string]string{"identity.name": value.Identity.Name, "identity.summary": value.Identity.Summary, "presentation.displayName": value.Presentation.DisplayName, "presentation.shortBio": value.Presentation.ShortBio, "placement.worldId": value.Placement.WorldID, "placement.entityId": value.Placement.EntityID, "interactionProfile.tone": value.InteractionProfile.Tone, "interactionProfile.cadence": value.InteractionProfile.Cadence} {
		if err := validateMaterializationString(text, "WorldCharacterCore.core."+name); err != nil {
			return err
		}
	}
	if value.Placement.WorldID != worldID || value.Placement.EntityID != entityID {
		return sourceMaterializationInvalid("WorldCharacterCore placement binding mismatch")
	}
	if err := validateMaterializationStrings(value.Placement.SceneRefs, "WorldCharacterCore.core.placement.sceneRefs"); err != nil {
		return err
	}
	if value.Biography.Milestones == nil || value.Biography.SourceNotes == nil || value.Relationships == nil {
		return sourceMaterializationInvalid("WorldCharacterCore required arrays are missing")
	}
	for index, milestone := range value.Biography.Milestones {
		for name, text := range map[string]string{"milestoneId": milestone.MilestoneID, "title": milestone.Title, "summary": milestone.Summary} {
			if err := validateMaterializationString(text, fmt.Sprintf("WorldCharacterCore.core.biography.milestones[%d].%s", index, name)); err != nil {
				return err
			}
		}
	}
	for field, values := range map[string][]string{
		"biography.sourceNotes": value.Biography.SourceNotes, "psychology.drives": value.Psychology.Drives, "psychology.boundaries": value.Psychology.Boundaries,
		"knowledge.topics": value.Knowledge.Topics, "knowledge.constraints": value.Knowledge.Constraints,
		"capabilities.interactionModes": value.Capabilities.InteractionModes, "capabilities.tools": value.Capabilities.Tools,
	} {
		if err := validateMaterializationStrings(values, "WorldCharacterCore.core."+field); err != nil {
			return err
		}
	}
	seenRelationships := map[string]struct{}{}
	for index, relationship := range value.Relationships {
		if err := validateMaterializationString(relationship.RelationshipID, fmt.Sprintf("WorldCharacterCore.core.relationships[%d].relationshipId", index)); err != nil {
			return err
		}
		if _, duplicate := seenRelationships[relationship.RelationshipID]; duplicate {
			return sourceMaterializationInvalid("WorldCharacterCore relationship id is duplicated")
		}
		seenRelationships[relationship.RelationshipID] = struct{}{}
		if relationship.TargetRef.Kind != "worldEntity" || relationship.TargetRef.WorldID != worldID {
			return sourceMaterializationInvalid("WorldCharacterCore relationship target must be a same-world worldEntity")
		}
		if err := validateMaterializationString(relationship.TargetRef.EntityID, fmt.Sprintf("WorldCharacterCore.core.relationships[%d].targetRef.entityId", index)); err != nil {
			return err
		}
		if err := validateMaterializationString(relationship.RelationType, fmt.Sprintf("WorldCharacterCore.core.relationships[%d].relationType", index)); err != nil {
			return err
		}
	}
	if err := validateMaterializationAssets(value.Assets, "WorldCharacterCore.core.assets"); err != nil {
		return err
	}
	return validateMaterializationAuthoring(value.Authoring, "WorldCharacterCore.core.authoring")
}

func validateMaterializationPersonaCore(value sourceMaterializationPersonaCoreV1, homeWorldID string) error {
	for name, text := range map[string]string{
		"identity.handle": value.Identity.Handle, "identity.name": value.Identity.Name, "identity.summary": value.Identity.Summary,
		"presentation.displayName": value.Presentation.DisplayName, "presentation.profileLine": value.Presentation.ProfileLine,
		"personaStyle.archetype": value.PersonaStyle.Archetype, "personaStyle.voice": value.PersonaStyle.Voice, "personaStyle.pacing": value.PersonaStyle.Pacing,
		"interactionProfile.homeWorldId": value.InteractionProfile.HomeWorldID,
	} {
		if err := validateMaterializationString(text, "RealmPersona.core."+name); err != nil {
			return err
		}
	}
	if value.InteractionProfile.HomeWorldID != homeWorldID {
		return sourceMaterializationInvalid("RealmPersona interactionProfile home world binding mismatch")
	}
	for field, values := range map[string][]string{
		"personaStyle.traits": value.PersonaStyle.Traits, "contentProfile.topics": value.ContentProfile.Topics,
		"contentProfile.boundaries": value.ContentProfile.Boundaries, "interactionProfile.interactionModes": value.InteractionProfile.InteractionModes,
	} {
		if err := validateMaterializationStrings(values, "RealmPersona.core."+field); err != nil {
			return err
		}
	}
	if value.ContentProfile.Guidelines == nil {
		return sourceMaterializationInvalid("RealmPersona contentProfile.guidelines is required")
	}
	for index, guideline := range value.ContentProfile.Guidelines {
		if err := validateMaterializationString(guideline.GuidelineID, fmt.Sprintf("RealmPersona.core.contentProfile.guidelines[%d].guidelineId", index)); err != nil {
			return err
		}
		if err := validateMaterializationString(guideline.Statement, fmt.Sprintf("RealmPersona.core.contentProfile.guidelines[%d].statement", index)); err != nil {
			return err
		}
	}
	if err := validateMaterializationAssets(value.Assets, "RealmPersona.core.assets"); err != nil {
		return err
	}
	return validateMaterializationAuthoring(value.Authoring, "RealmPersona.core.authoring")
}

func validateMaterializationEntityCore(value sourceMaterializationEntityCoreV1) error {
	for name, text := range map[string]string{"identity.name": value.Identity.Name, "identity.summary": value.Identity.Summary, "identity.kind": value.Identity.Kind} {
		if err := validateMaterializationString(text, "WorldEntityCore.core."+name); err != nil {
			return err
		}
	}
	if err := validateMaterializationStrings(value.Classification.Tags, "WorldEntityCore.core.classification.tags"); err != nil {
		return err
	}
	if value.Facts == nil {
		return sourceMaterializationInvalid("WorldEntityCore.core.facts is required")
	}
	for index, fact := range value.Facts {
		for name, text := range map[string]string{"factId": fact.FactID, "type": fact.Type, "label": fact.Label} {
			if err := validateMaterializationString(text, fmt.Sprintf("WorldEntityCore.core.facts[%d].%s", index, name)); err != nil {
				return err
			}
		}
		if err := validateMaterializationJSONValue(fact.Value, false, "WorldEntityCore fact value"); err != nil {
			return err
		}
		switch fact.Confidence {
		case "recorded", "normalized", "inferred", "editorial", "rejected":
		default:
			return sourceMaterializationInvalid("WorldEntityCore fact confidence is not admitted")
		}
	}
	if err := validateMaterializationStrings(value.Evidence.SourceRefs, "WorldEntityCore.core.evidence.sourceRefs"); err != nil {
		return err
	}
	switch value.Evidence.Completeness {
	case "stub", "partial", "substantial", "complete":
	default:
		return sourceMaterializationInvalid("WorldEntityCore evidence completeness is not admitted")
	}
	if err := validateMaterializationAssets(value.Assets, "WorldEntityCore.core.assets"); err != nil {
		return err
	}
	return validateMaterializationAuthoring(value.Authoring, "WorldEntityCore.core.authoring")
}

func validateMaterializationRelationshipCore(value sourceMaterializationRelationshipCoreV1, sourceID string, targetID string, relationType string) error {
	if value.Endpoints.SourceEntityID != sourceID || value.Endpoints.TargetEntityID != targetID || value.Endpoints.Type != relationType {
		return sourceMaterializationInvalid("WorldRelationshipCore endpoint binding mismatch")
	}
	if err := validateMaterializationStrings(value.Evidence.SourceRefs, "WorldRelationshipCore.core.evidence.sourceRefs"); err != nil {
		return err
	}
	switch value.Evidence.Confidence {
	case "recorded", "normalized", "inferred", "editorial", "rejected":
	default:
		return sourceMaterializationInvalid("WorldRelationshipCore evidence confidence is not admitted")
	}
	if value.Attributes != nil {
		if err := validateMaterializationJSONValue(*value.Attributes, true, "WorldRelationshipCore.core.attributes"); err != nil {
			return err
		}
	}
	return validateMaterializationAuthoring(value.Authoring, "WorldRelationshipCore.core.authoring")
}
