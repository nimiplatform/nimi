package runtimeagent

func validateMaterializationWorld(value sourceMaterializationWorldV1, raw []byte) error {
	if err := requireMaterializationTopFields(raw, "WorldCore", "id", "schemaVersion", "contentRevision", "contentHash", "origin", "creatorId", "visibility", "core", "createdAt", "updatedAt"); err != nil {
		return err
	}
	if err := requireMaterializationNestedFields(raw, "WorldCore", "core", "identity", "presentation", "ontology", "timeModel", "timeline", "entities", "relationships", "systems", "scenes", "assets", "authoring"); err != nil {
		return err
	}
	if value.SchemaVersion != "realm.world-core/v1" || value.ContentRevision == 0 || !isLowerSHA256(value.ContentHash) || !value.CreatorID.Present {
		return sourceMaterializationInvalid("WorldCore envelope is invalid")
	}
	if err := validateMaterializationString(value.ID, "WorldCore.id"); err != nil {
		return err
	}
	if err := validateMaterializationOrigin(value.Origin, "WorldCore.origin"); err != nil {
		return err
	}
	if err := validateMaterializationVisibility(value.Visibility, "WorldCore.visibility"); err != nil {
		return err
	}
	if err := validateMaterializationInstant(value.CreatedAt, "WorldCore.createdAt"); err != nil {
		return err
	}
	if err := validateMaterializationInstant(value.UpdatedAt, "WorldCore.updatedAt"); err != nil {
		return err
	}
	if err := validateMaterializationWorldCore(value.Core); err != nil {
		return err
	}
	computed, err := hashSourceMaterializationDomainlessJCS(struct {
		SchemaVersion string                              `json:"schemaVersion"`
		Origin        sourceMaterializationOriginV1       `json:"origin"`
		CreatorID     sourceMaterializationNullableString `json:"creatorId"`
		Visibility    string                              `json:"visibility"`
		Core          sourceMaterializationWorldCoreV1    `json:"core"`
	}{value.SchemaVersion, value.Origin, value.CreatorID, value.Visibility, value.Core})
	if err != nil || computed != value.ContentHash {
		return sourceMaterializationDenied("WorldCore contentHash mismatch")
	}
	return nil
}

func validateMaterializationCharacter(value sourceMaterializationWorldCharacterV2, raw []byte) error {
	if err := requireMaterializationTopFields(raw, "WorldCharacterCore", "kind", "id", "schemaVersion", "contentRevision", "contentHash", "createdAt", "updatedAt", "origin", "creatorId", "visibility", "worldId", "entityId", "core"); err != nil {
		return err
	}
	if err := requireMaterializationNestedFields(raw, "WorldCharacterCore", "core", "identity", "presentation", "placement", "biography", "psychology", "knowledge", "relationships", "capabilities", "interactionProfile", "assets", "authoring"); err != nil {
		return err
	}
	if value.Kind != "worldCharacter" || value.SchemaVersion != "realm.world-character-core/v1" || value.ContentRevision == 0 || !isLowerSHA256(value.ContentHash) {
		return sourceMaterializationInvalid("WorldCharacterCore envelope is invalid")
	}
	for field, text := range map[string]string{"id": value.ID, "creatorId": value.CreatorID, "worldId": value.WorldID, "entityId": value.EntityID} {
		if err := validateMaterializationString(text, "WorldCharacterCore."+field); err != nil {
			return err
		}
	}
	if err := validateMaterializationOrigin(value.Origin, "WorldCharacterCore.origin"); err != nil {
		return err
	}
	if err := validateMaterializationVisibility(value.Visibility, "WorldCharacterCore.visibility"); err != nil {
		return err
	}
	if err := validateMaterializationInstant(value.CreatedAt, "WorldCharacterCore.createdAt"); err != nil {
		return err
	}
	if err := validateMaterializationInstant(value.UpdatedAt, "WorldCharacterCore.updatedAt"); err != nil {
		return err
	}
	if err := validateMaterializationCharacterCore(value.Core, value.WorldID, value.EntityID); err != nil {
		return err
	}
	computed, err := hashSourceMaterializationDomainlessJCS(struct {
		SchemaVersion string                               `json:"schemaVersion"`
		Origin        sourceMaterializationOriginV1        `json:"origin"`
		WorldID       string                               `json:"worldId"`
		EntityID      string                               `json:"entityId"`
		Core          sourceMaterializationCharacterCoreV1 `json:"core"`
	}{value.SchemaVersion, value.Origin, value.WorldID, value.EntityID, value.Core})
	if err != nil || computed != value.ContentHash {
		return sourceMaterializationDenied("WorldCharacterCore contentHash mismatch")
	}
	return nil
}

func validateMaterializationPersona(value sourceMaterializationRealmPersonaV2, raw []byte) error {
	if err := requireMaterializationTopFields(raw, "RealmPersona", "kind", "id", "schemaVersion", "contentRevision", "contentHash", "createdAt", "updatedAt", "origin", "ownerId", "homeWorldId", "visibility", "core"); err != nil {
		return err
	}
	if err := requireMaterializationNestedFields(raw, "RealmPersona", "core", "identity", "presentation", "personaStyle", "contentProfile", "interactionProfile", "assets", "authoring"); err != nil {
		return err
	}
	if value.Kind != "realmPersona" || value.SchemaVersion != "realm.persona/v1" || value.ContentRevision == 0 || !isLowerSHA256(value.ContentHash) {
		return sourceMaterializationInvalid("RealmPersona envelope is invalid")
	}
	for field, text := range map[string]string{"id": value.ID, "ownerId": value.OwnerID, "homeWorldId": value.HomeWorldID} {
		if err := validateMaterializationString(text, "RealmPersona."+field); err != nil {
			return err
		}
	}
	if err := validateMaterializationOrigin(value.Origin, "RealmPersona.origin"); err != nil {
		return err
	}
	if err := validateMaterializationVisibility(value.Visibility, "RealmPersona.visibility"); err != nil {
		return err
	}
	if err := validateMaterializationInstant(value.CreatedAt, "RealmPersona.createdAt"); err != nil {
		return err
	}
	if err := validateMaterializationInstant(value.UpdatedAt, "RealmPersona.updatedAt"); err != nil {
		return err
	}
	if err := validateMaterializationPersonaCore(value.Core, value.HomeWorldID); err != nil {
		return err
	}
	computed, err := hashSourceMaterializationDomainlessJCS(struct {
		SchemaVersion string                             `json:"schemaVersion"`
		Origin        sourceMaterializationOriginV1      `json:"origin"`
		OwnerID       string                             `json:"ownerId"`
		HomeWorldID   string                             `json:"homeWorldId"`
		Visibility    string                             `json:"visibility"`
		Core          sourceMaterializationPersonaCoreV1 `json:"core"`
	}{value.SchemaVersion, value.Origin, value.OwnerID, value.HomeWorldID, value.Visibility, value.Core})
	if err != nil || computed != value.ContentHash {
		return sourceMaterializationDenied("RealmPersona contentHash mismatch")
	}
	return nil
}

func validateMaterializationEntity(value sourceMaterializationEntityV1, raw []byte) error {
	if err := requireMaterializationTopFields(raw, "WorldEntityCore", "id", "schemaVersion", "contentRevision", "contentHash", "origin", "worldId", "kind", "core", "createdAt", "updatedAt"); err != nil {
		return err
	}
	if err := requireMaterializationNestedFields(raw, "WorldEntityCore", "core", "identity", "classification", "facts", "evidence", "assets", "authoring"); err != nil {
		return err
	}
	if value.SchemaVersion != "realm.world-entity-core/v1" || value.ContentRevision == 0 || !isLowerSHA256(value.ContentHash) {
		return sourceMaterializationInvalid("WorldEntityCore envelope is invalid")
	}
	for field, text := range map[string]string{"id": value.ID, "worldId": value.WorldID, "kind": value.Kind} {
		if err := validateMaterializationString(text, "WorldEntityCore."+field); err != nil {
			return err
		}
	}
	if err := validateMaterializationOrigin(value.Origin, "WorldEntityCore.origin"); err != nil {
		return err
	}
	if err := validateMaterializationInstant(value.CreatedAt, "WorldEntityCore.createdAt"); err != nil {
		return err
	}
	if err := validateMaterializationInstant(value.UpdatedAt, "WorldEntityCore.updatedAt"); err != nil {
		return err
	}
	if err := validateMaterializationEntityCore(value.Core); err != nil {
		return err
	}
	computed, err := hashSourceMaterializationDomainlessJCS(struct {
		SchemaVersion string                            `json:"schemaVersion"`
		Origin        sourceMaterializationOriginV1     `json:"origin"`
		WorldID       string                            `json:"worldId"`
		Kind          string                            `json:"kind"`
		Core          sourceMaterializationEntityCoreV1 `json:"core"`
	}{value.SchemaVersion, value.Origin, value.WorldID, value.Kind, value.Core})
	if err != nil || computed != value.ContentHash {
		return sourceMaterializationDenied("WorldEntityCore contentHash mismatch")
	}
	return nil
}

func validateMaterializationRelationship(value sourceMaterializationRelationshipV1, raw []byte) error {
	if err := requireMaterializationTopFields(raw, "WorldRelationshipCore", "id", "schemaVersion", "contentRevision", "contentHash", "origin", "worldId", "sourceEntityId", "targetEntityId", "type", "core", "createdAt", "updatedAt"); err != nil {
		return err
	}
	if err := requireMaterializationNestedFields(raw, "WorldRelationshipCore", "core", "endpoints", "presentation", "evidence", "authoring"); err != nil {
		return err
	}
	if value.SchemaVersion != "realm.world-relationship-core/v1" || value.ContentRevision == 0 || !isLowerSHA256(value.ContentHash) {
		return sourceMaterializationInvalid("WorldRelationshipCore envelope is invalid")
	}
	for field, text := range map[string]string{"id": value.ID, "worldId": value.WorldID, "sourceEntityId": value.SourceEntityID, "targetEntityId": value.TargetEntityID, "type": value.Type} {
		if err := validateMaterializationString(text, "WorldRelationshipCore."+field); err != nil {
			return err
		}
	}
	if err := validateMaterialOriginAndTimes(value.Origin, value.CreatedAt, value.UpdatedAt, "WorldRelationshipCore"); err != nil {
		return err
	}
	if err := validateMaterializationRelationshipCore(value.Core, value.SourceEntityID, value.TargetEntityID, value.Type); err != nil {
		return err
	}
	computed, err := hashSourceMaterializationDomainlessJCS(struct {
		SchemaVersion  string                                  `json:"schemaVersion"`
		Origin         sourceMaterializationOriginV1           `json:"origin"`
		WorldID        string                                  `json:"worldId"`
		SourceEntityID string                                  `json:"sourceEntityId"`
		TargetEntityID string                                  `json:"targetEntityId"`
		Type           string                                  `json:"type"`
		Core           sourceMaterializationRelationshipCoreV1 `json:"core"`
	}{value.SchemaVersion, value.Origin, value.WorldID, value.SourceEntityID, value.TargetEntityID, value.Type, value.Core})
	if err != nil || computed != value.ContentHash {
		return sourceMaterializationDenied("WorldRelationshipCore contentHash mismatch")
	}
	return nil
}

func validateMaterialOriginAndTimes(origin sourceMaterializationOriginV1, createdAt string, updatedAt string, field string) error {
	if err := validateMaterializationOrigin(origin, field+".origin"); err != nil {
		return err
	}
	if err := validateMaterializationInstant(createdAt, field+".createdAt"); err != nil {
		return err
	}
	return validateMaterializationInstant(updatedAt, field+".updatedAt")
}

func hashSourceMaterializationDomainlessJCS(value any) (string, error) {
	canonical, err := canonicalizeSourceMaterializationJCS(value)
	if err != nil {
		return "", err
	}
	return sha256HexBytes(canonical), nil
}
