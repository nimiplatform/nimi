package runtimeagent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
)

type sourceMaterializationCanonicalSourceWireV3 struct {
	ID                       string                                              `json:"id"`
	SchemaVersion            string                                              `json:"schemaVersion"`
	ContentRevision          uint64                                              `json:"contentRevision"`
	ContentHash              string                                              `json:"contentHash"`
	CreatedAt                string                                              `json:"createdAt"`
	UpdatedAt                string                                              `json:"updatedAt"`
	Origin                   sourceMaterializationOriginV3                       `json:"origin"`
	CreatorID                string                                              `json:"creatorId,omitempty"`
	OwnerAccountID           string                                              `json:"ownerAccountId,omitempty"`
	Visibility               string                                              `json:"visibility"`
	WorldID                  string                                              `json:"worldId"`
	WorldEntityRef           *sourceMaterializationWorldEntityRefV3              `json:"worldEntityRef,omitempty"`
	LorebookDeclaration      sourceMaterializationCharacterLorebookDeclarationV1 `json:"lorebookDeclaration"`
	Profile                  json.RawMessage                                     `json:"profile"`
	Validity                 sourceMaterializationValidityV3                     `json:"validity"`
	MaterializationReadiness sourceMaterializationReadinessV3                    `json:"materializationReadiness"`
	SourceHash               string                                              `json:"sourceHash"`
}

func decodeSourceMaterializationCanonicalSourceV3(raw []byte, sourceRef sourceMaterializationCharacterSourceRefV3) (sourceMaterializationCanonicalSourceV3, error) {
	var wire sourceMaterializationCanonicalSourceWireV3
	if err := strictDecodeSourceMaterializationV3(raw, &wire); err != nil {
		return sourceMaterializationCanonicalSourceV3{}, err
	}
	if len(wire.Profile) == 0 {
		return sourceMaterializationCanonicalSourceV3{}, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonicalSource.profile is required")
	}
	profileValue, err := decodeSourceMaterializationJSON(wire.Profile)
	if err != nil {
		return sourceMaterializationCanonicalSourceV3{}, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonicalSource.profile is invalid: %v", err)
	}
	profileMap, ok := profileValue.(map[string]any)
	if !ok {
		return sourceMaterializationCanonicalSourceV3{}, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonicalSource.profile must be an object")
	}
	profileHash, ok := profileMap["profileHash"].(string)
	if !ok || !isLowerSHA256V3(profileHash) {
		return sourceMaterializationCanonicalSourceV3{}, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonicalSource.profile.profileHash is invalid")
	}
	if err := validateSourceMaterializationProfileShapeV3(profileMap); err != nil {
		return sourceMaterializationCanonicalSourceV3{}, err
	}
	if err := validateSourceMaterializationProfileShapeJSONV3(profileMap, "$.semanticPayload.canonicalSource.profile"); err != nil {
		return sourceMaterializationCanonicalSourceV3{}, err
	}
	normalizedProfile, err := normalizeSourceMaterializationJSONValue(profileValue)
	if err != nil {
		return sourceMaterializationCanonicalSourceV3{}, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonicalSource.profile is not canonical JSON: %v", err)
	}
	result := sourceMaterializationCanonicalSourceV3{
		Kind: sourceRef.Kind, ID: wire.ID, SchemaVersion: wire.SchemaVersion,
		ContentRevision: wire.ContentRevision, ContentHash: wire.ContentHash,
		CreatedAt: wire.CreatedAt, UpdatedAt: wire.UpdatedAt, Origin: wire.Origin,
		CreatorID: wire.CreatorID, OwnerAccountID: wire.OwnerAccountID,
		Visibility: wire.Visibility, WorldID: wire.WorldID, WorldEntityRef: wire.WorldEntityRef,
		LorebookDeclaration: wire.LorebookDeclaration,
		Profile:             normalizedProfile, ProfileHash: profileHash, Validity: wire.Validity,
		MaterializationReadiness: wire.MaterializationReadiness, SourceHash: wire.SourceHash,
	}
	if err := validateSourceMaterializationCanonicalSourceV3(result, sourceRef, profileMap); err != nil {
		return sourceMaterializationCanonicalSourceV3{}, err
	}
	return result, nil
}

func validateSourceMaterializationCanonicalSourceV3(source sourceMaterializationCanonicalSourceV3, ref sourceMaterializationCharacterSourceRefV3, profile map[string]any) error {
	for field, value := range map[string]string{
		"id": source.ID, "schemaVersion": source.SchemaVersion, "contentHash": source.ContentHash,
		"createdAt": source.CreatedAt, "updatedAt": source.UpdatedAt, "visibility": source.Visibility,
		"worldId": source.WorldID, "sourceHash": source.SourceHash,
	} {
		if value == "" {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonicalSource.%s is required", field)
		}
	}
	if !isLowerSHA256V3(source.ContentHash) || !isLowerSHA256V3(source.SourceHash) {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonicalSource hashes are invalid")
	}
	if source.ID != ref.ID || source.WorldID != ref.WorldID || source.SourceHash != ref.SourceHash {
		return sourceMaterializationV3Error(sourceMaterializationFailureSourceBindingV3, "canonicalSource does not match sourceRef")
	}
	if _, err := parseSourceMaterializationInstantV3(source.CreatedAt, "canonicalSource.createdAt"); err != nil {
		return err
	}
	if _, err := parseSourceMaterializationInstantV3(source.UpdatedAt, "canonicalSource.updatedAt"); err != nil {
		return err
	}
	if source.Validity.Status != "valid" || len(source.Validity.Issues) != 0 ||
		source.MaterializationReadiness.Status != "ready" || len(source.MaterializationReadiness.Blockers) != 0 {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonicalSource is not valid and ready")
	}
	if err := validateCharacterLorebookDeclarationV1(source.LorebookDeclaration); err != nil {
		return err
	}
	var sourceHashInput any
	switch ref.Kind {
	case "worldCharacter":
		if source.SchemaVersion != "realm.world-character-core/v1" || source.CreatorID == "" || source.OwnerAccountID != "" ||
			source.WorldEntityRef == nil || ref.WorldEntityRef == nil || *source.WorldEntityRef != *ref.WorldEntityRef {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "worldCharacter canonicalSource is invalid")
		}
		sourceHashInput = map[string]any{
			"sourceKind": "worldCharacter", "schemaVersion": source.SchemaVersion, "id": source.ID,
			"contentRevision": source.ContentRevision, "creatorId": source.CreatorID,
			"visibility": source.Visibility, "worldId": source.WorldID, "worldEntityRef": source.WorldEntityRef,
			"lorebookDeclaration": source.LorebookDeclaration,
			"profileHash":         source.ProfileHash,
		}
	case "personaCharacter":
		if source.SchemaVersion != "realm.persona-character-core/v1" || source.OwnerAccountID == "" || source.CreatorID != "" ||
			source.WorldEntityRef != nil || source.OwnerAccountID != ref.OwnerAccountID {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "personaCharacter canonicalSource is invalid")
		}
		sourceHashInput = map[string]any{
			"sourceKind": "personaCharacter", "schemaVersion": source.SchemaVersion, "id": source.ID,
			"contentRevision": source.ContentRevision, "ownerAccountId": source.OwnerAccountID,
			"visibility": source.Visibility, "worldId": source.WorldID,
			"lorebookDeclaration": source.LorebookDeclaration, "profileHash": source.ProfileHash,
		}
	default:
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonicalSource kind is invalid")
	}
	domain := sourceMaterializationWorldCharacterHashDomainV3
	if ref.Kind == "personaCharacter" {
		domain = sourceMaterializationPersonaCharacterHashDomainV3
	}
	expectedSourceHash, err := hashSourceMaterializationRealmDomainV3(domain, sourceHashInput)
	if err != nil || expectedSourceHash != source.SourceHash {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonicalSource.sourceHash is stale")
	}
	expectedProfileHash, err := sourceMaterializationProfileHashV3(profile)
	if err != nil || expectedProfileHash != source.ProfileHash {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonicalSource.profile.profileHash is stale")
	}
	return nil
}

func validateSourceMaterializationProfileShapeV3(profile map[string]any) error {
	required := []string{"profileSchemaVersion", "identity", "presentation", "narrative", "interactionProfile", "assets", "authoring", "profileCoverage", "profileHash"}
	allowed := map[string]struct{}{
		"profileSchemaVersion": {}, "identity": {}, "presentation": {}, "narrative": {}, "psychology": {},
		"knowledge": {}, "relationships": {}, "capabilities": {}, "interactionProfile": {}, "assets": {},
		"authoring": {}, "profileCoverage": {}, "profileHash": {},
	}
	for _, key := range required {
		if _, ok := profile[key]; !ok {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonicalSource.profile.%s is required", key)
		}
	}
	for key := range profile {
		if _, ok := allowed[key]; !ok {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonicalSource.profile.%s is not admitted", key)
		}
	}
	if profile["profileSchemaVersion"] != "realm.character-profile-core/v1" {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonicalSource.profile schema is invalid")
	}
	return nil
}

func sourceMaterializationProfileHashV3(profile map[string]any) (string, error) {
	input := make(map[string]any)
	for _, key := range []string{"profileSchemaVersion", "identity", "presentation", "narrative", "psychology", "knowledge", "relationships", "capabilities", "interactionProfile", "assets"} {
		if value, ok := profile[key]; ok {
			input[key] = value
		}
	}
	if authoring, ok := profile["authoring"].(map[string]any); ok {
		if extensions, ok := authoring["extensions"].(map[string]any); ok {
			semantic := make(map[string]any)
			for key, value := range extensions {
				extension, ok := value.(map[string]any)
				if !ok {
					return "", fmt.Errorf("authoring extension %s is invalid", key)
				}
				productSemantic, ok := extension["productSemantic"].(bool)
				if !ok {
					return "", fmt.Errorf("authoring extension %s productSemantic is invalid", key)
				}
				if productSemantic {
					semantic[key] = extension
				}
			}
			if len(semantic) > 0 {
				input["authoring"] = map[string]any{"extensions": semantic}
			}
		}
	}
	return hashSourceMaterializationRealmDomainV3("nimi.realm.character-profile-core/v1\x00", input)
}

func sourceMaterializationV3Any(value any) (any, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return decodeSourceMaterializationJSON(raw)
}

func sourceMaterializationV3CanonicalEqual(left, right any) bool {
	leftBytes, leftErr := canonicalizeSourceMaterializationJCS(left)
	rightBytes, rightErr := canonicalizeSourceMaterializationJCS(right)
	return leftErr == nil && rightErr == nil && bytes.Equal(leftBytes, rightBytes)
}

func sourceMaterializationDependencyContentHashesV3(closure any) ([]any, error) {
	byIdentity := make(map[string]map[string]any)
	var visit func(any) error
	visit = func(value any) error {
		switch typed := value.(type) {
		case []any:
			for _, item := range typed {
				if err := visit(item); err != nil {
					return err
				}
			}
		case map[string]any:
			contentHash, hasHash := typed["contentHash"].(string)
			id, hasID := typed["id"].(string)
			if hasHash && hasID && isLowerSHA256V3(contentHash) {
				schemaVersion, _ := typed["schemaVersion"].(string)
				kind, _ := typed["kind"].(string)
				switch {
				case kind == "worldEntity" || kind == "worldRelationship":
				case schemaVersion == "realm.world-entity-core/v1":
					kind = "worldEntity"
				case schemaVersion == "realm.world-relationship-core/v1":
					kind = "worldRelationship"
				default:
					kind = "dependency"
				}
				worldID, _ := typed["worldId"].(string)
				identity := kind + "\x00" + schemaVersion + "\x00" + worldID + "\x00" + id
				digest := map[string]any{"kind": kind, "schemaVersion": schemaVersion, "worldId": worldID, "id": id, "contentHash": contentHash}
				if existing, ok := byIdentity[identity]; ok && existing["contentHash"] != contentHash {
					return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "dependency identity conflict")
				}
				byIdentity[identity] = digest
			}
			for _, child := range typed {
				if err := visit(child); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := visit(closure); err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(byIdentity))
	for key := range byIdentity {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]any, 0, len(keys))
	for _, key := range keys {
		result = append(result, byIdentity[key])
	}
	return result, nil
}

func sourceMaterializationComponentContentHashV3(kind string, value any) (string, error) {
	record, ok := value.(map[string]any)
	if !ok {
		return "", fmt.Errorf("component value is not an object")
	}
	if kind == "materializationCoverage" {
		without := make(map[string]any, len(record)-1)
		for key, child := range record {
			if key != "materializationCoverageHash" {
				without[key] = child
			}
		}
		return hashSourceMaterializationRealmDomainV3(sourceMaterializationCoverageHashDomainV3, without)
	}
	var fields []string
	switch kind {
	case "worldCharacter":
		fields = []string{"schemaVersion", "origin", "creatorId", "visibility", "worldId", "worldEntityRef", "lorebookDeclaration", "profile", "validity", "materializationReadiness"}
	case "personaCharacter":
		fields = []string{"schemaVersion", "origin", "ownerAccountId", "visibility", "worldId", "lorebookDeclaration", "profile", "validity", "materializationReadiness"}
	case "worldCore":
		fields = []string{"schemaVersion", "origin", "creatorId", "visibility", "lorebookDeclaration", "core"}
	case "worldEntity":
		fields = []string{"schemaVersion", "origin", "worldId", "kind", "core"}
	case "worldRelationship":
		fields = []string{"schemaVersion", "origin", "worldId", "sourceEntityId", "targetEntityId", "type", "core"}
	default:
		return "", fmt.Errorf("component kind %s is not admitted", kind)
	}
	projection := make(map[string]any, len(fields))
	for _, field := range fields {
		value, ok := record[field]
		if !ok {
			return "", fmt.Errorf("component field %s is missing", field)
		}
		projection[field] = value
	}
	bytes, err := canonicalizeSourceMaterializationJCS(projection)
	if err != nil {
		return "", err
	}
	return sha256HexBytes(bytes), nil
}
