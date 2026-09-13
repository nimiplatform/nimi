package account

import (
	"encoding/json"
	"errors"
	"math"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// @nimi-authority: rule.nimi.platform.core-protocol.world-creator-app-operations
func isLocalAppWorldCreatorOperation(operation LocalAppOperation) bool {
	switch operation {
	case LocalAppOperationRealmWorldCoreList, LocalAppOperationRealmWorldCoreCreate,
		LocalAppOperationRealmWorldCreationEligibilityGet, LocalAppOperationRealmWorldCoreGet, LocalAppOperationRealmWorldCoreReplace,
		LocalAppOperationRealmWorldCharacterList, LocalAppOperationRealmWorldCharacterGet,
		LocalAppOperationRealmWorldCharacterCreate, LocalAppOperationRealmWorldCharacterReplace,
		LocalAppOperationRealmWorldEntityList, LocalAppOperationRealmWorldEntityGet, LocalAppOperationRealmWorldEntityCreate,
		LocalAppOperationRealmWorldRelationshipList, LocalAppOperationRealmWorldRelationshipGet:
		return true
	default:
		return false
	}
}

// This selects the DTO only; InvokeRealmUnary retains the existing Desktop
// caller admission and does not grant any Local App operation or write access.
func desktopWorldSourceReadOperation(methodID string) LocalAppOperation {
	switch methodID {
	case "WorldCoreController_getWorldCharacter":
		return LocalAppOperationRealmWorldCharacterGet
	case "WorldCoreController_getWorldEntity":
		return LocalAppOperationRealmWorldEntityGet
	case "WorldCoreController_listWorldRelationships":
		return LocalAppOperationRealmWorldRelationshipList
	default:
		return 0
	}
}

func worldCreatorShape(operation LocalAppOperation) (family, action, pathKey string) {
	switch operation {
	case LocalAppOperationRealmWorldCreationEligibilityGet:
		return "eligibility", "get", ""
	case LocalAppOperationRealmWorldCoreList:
		return "world", "list", ""
	case LocalAppOperationRealmWorldCoreCreate:
		return "world", "create", ""
	case LocalAppOperationRealmWorldCoreGet:
		return "world", "get", "worldId"
	case LocalAppOperationRealmWorldCoreReplace:
		return "world", "replace", "worldId"
	case LocalAppOperationRealmWorldCharacterList:
		return "character", "list", "worldId"
	case LocalAppOperationRealmWorldCharacterGet:
		return "character", "get", "characterId"
	case LocalAppOperationRealmWorldCharacterCreate:
		return "character", "create", "worldId"
	case LocalAppOperationRealmWorldCharacterReplace:
		return "character", "replace", "characterId"
	case LocalAppOperationRealmWorldEntityList:
		return "entity", "list", "worldId"
	case LocalAppOperationRealmWorldEntityGet:
		return "entity", "get", "entityId"
	case LocalAppOperationRealmWorldEntityCreate:
		return "entity", "create", "worldId"
	case LocalAppOperationRealmWorldRelationshipList:
		return "relationship", "list", "worldId"
	case LocalAppOperationRealmWorldRelationshipGet:
		return "relationship", "get", "relationshipId"
	default:
		return "", "", ""
	}
}

func validateLocalAppWorldCreatorRequest(operation LocalAppOperation, request realmUnaryRequestJSON) error {
	family, action, pathKey := worldCreatorShape(operation)
	invalid := errors.New("world creator request violates its typed contract")
	if family == "" {
		return invalid
	}
	if (pathKey == "" && len(request.Path) != 0) || (pathKey != "" && (len(request.Path) != 1 || !worldCreatorIdentifier(request.Path[pathKey]))) {
		return invalid
	}
	if action == "list" {
		if localAppPersonaBodyPresent(request.Body) {
			return invalid
		}
		for key, value := range request.Query {
			switch key {
			case "take":
				if family == "world" {
					if !worldCreatorListTake(value) {
						return invalid
					}
				} else if !localAppPersonaTake(value) {
					return invalid
				}
			case "visibility":
				if (family != "world" && family != "character") || !localAppPersonaOutputVisibility(value) {
					return invalid
				}
			case "afterId":
				if family == "world" || !worldCreatorIdentifier(value) {
					return invalid
				}
			case "kind":
				if family != "entity" || !worldCreatorIdentifier(value) {
					return invalid
				}
			case "entityId", "sourceEntityId", "targetEntityId", "type":
				if family != "relationship" || !worldCreatorIdentifier(value) {
					return invalid
				}
			default:
				return invalid
			}
		}
		return nil
	}
	if len(request.Query) != 0 {
		return invalid
	}
	if action == "get" {
		if localAppPersonaBodyPresent(request.Body) {
			return invalid
		}
		return nil
	}
	decoded, ok := decodeLocalAppPersonaJSON(request.Body)
	if !ok {
		return invalid
	}
	validation := &worldCoreDTOValidation{}
	required := []string{"origin"}
	allowed := []string{"id", "origin"}
	switch family {
	case "world":
		required = append(required, "core", "lorebookDeclaration")
		allowed = append(allowed, "core", "lorebookDeclaration", "visibility")
	case "character":
		required = append(required, "profile", "lorebookDeclaration", "worldEntityRef")
		allowed = append(allowed, "profile", "lorebookDeclaration", "worldEntityRef", "visibility")
	case "entity":
		required = append(required, "core", "kind")
		allowed = append(allowed, "core", "kind")
	default:
		return invalid
	}
	if action == "replace" {
		required = append(required, "baseContentHash")
		allowed = append(allowed, "baseContentHash")
	}
	body, ok := validation.object(decoded, 0, allowed, required)
	if !ok || !validation.origin(body["origin"], 1) {
		return invalid
	}
	if id, exists := body["id"]; exists && (!worldCreatorIdentifier(id) || (action == "replace" && id != request.Path[pathKey])) {
		return invalid
	}
	if visibility, exists := body["visibility"]; exists && !localAppPersonaWritableVisibility(visibility) {
		return invalid
	}
	if action == "replace" && !localAppPersonaHash(body["baseContentHash"]) {
		return invalid
	}
	switch family {
	case "world":
		if body["lorebookDeclaration"] == nil || !validation.worldLorebookDeclaration(body["lorebookDeclaration"], 1) || !validation.core(body["core"], 1) {
			return invalid
		}
	case "character":
		// CharacterProfileCore is shared structure, never an owner-Persona read or fallback.
		if !validation.characterLorebookDeclaration(body["lorebookDeclaration"], 1) || !localAppPersonaProfile(validation, body["profile"], 1, false) {
			return invalid
		}
		ref, valid := worldCreatorEntityRef(validation, body["worldEntityRef"], 1)
		if !valid || (action == "create" && ref["worldId"] != request.Path["worldId"]) {
			return invalid
		}
	case "entity":
		if !worldCreatorIdentifier(body["kind"]) || !worldCreatorEntityCore(validation, body["core"], 1) {
			return invalid
		}
	}
	return nil
}

func worldCreatorListTake(value any) bool {
	switch number := value.(type) {
	case json.Number:
		parsed, err := number.Int64()
		return err == nil && parsed >= 0
	case float64:
		return !math.IsNaN(number) && !math.IsInf(number, 0) && math.Trunc(number) == number && number >= 0
	default:
		return false
	}
}

func worldCreatorIdentifier(value any) bool {
	text, ok := value.(string)
	return ok && strings.TrimSpace(text) == text && localAppPersonaText(value, true, 512)
}

func worldCreatorEntityRef(validation *worldCoreDTOValidation, value any, depth int) (map[string]any, bool) {
	fields := []string{"kind", "worldId", "entityId"}
	ref, ok := validation.object(value, depth, fields, fields)
	return ref, ok && ref["kind"] == "worldEntity" && worldCreatorIdentifier(ref["worldId"]) && worldCreatorIdentifier(ref["entityId"])
}

func worldCreatorEntityCore(validation *worldCoreDTOValidation, value any, depth int) bool {
	fields := []string{"identity", "classification", "facts", "assets", "evidence", "authoring"}
	core, ok := validation.object(value, depth, fields, fields)
	if !ok {
		return false
	}
	identity, ok := validation.object(core["identity"], depth+1,
		[]string{"name", "summary", "kind", "aliases"}, []string{"name", "summary", "kind"})
	if !ok || !text(identity["name"], true, localAppWorldCoreMaxTextBytes) ||
		!text(identity["summary"], true, localAppWorldCoreMaxTextBytes) || !worldCreatorIdentifier(identity["kind"]) ||
		!validation.optionalTextArray(identity, "aliases", depth+2, true) {
		return false
	}
	classification, ok := validation.object(core["classification"], depth+1,
		[]string{"tags", "sourceCategories"}, []string{"tags"})
	if !ok || !validation.textArray(classification["tags"], depth+2, true) ||
		!validation.optionalTextArray(classification, "sourceCategories", depth+2, true) {
		return false
	}
	evidence, ok := validation.object(core["evidence"], depth+1,
		[]string{"sourceRefs", "completeness"}, []string{"sourceRefs", "completeness"})
	return ok && validation.textArray(evidence["sourceRefs"], depth+2, true) &&
		oneOfText(evidence["completeness"], "stub", "partial", "substantial", "complete") &&
		validation.assets(core["assets"], depth+1) && worldCreatorGraphAuthoring(validation, core["authoring"], depth+1) &&
		validation.arrayObjects(core["facts"], depth+1, func(value any, depth int) bool {
			return worldCreatorEntityFact(validation, value, depth)
		})
}

func worldCreatorEntityFact(validation *worldCoreDTOValidation, value any, depth int) bool {
	fact, ok := validation.object(value, depth,
		[]string{"factId", "type", "label", "value", "confidence", "sourceRefs", "attributes"},
		[]string{"factId", "type", "label", "value", "confidence"})
	if !ok || !worldCreatorIdentifier(fact["factId"]) || !worldCreatorIdentifier(fact["type"]) ||
		!text(fact["label"], true, localAppWorldCoreMaxTextBytes) || !worldCreatorConfidence(fact["confidence"]) ||
		!validation.optionalTextArray(fact, "sourceRefs", depth+1, true) {
		return false
	}
	if attributes, exists := fact["attributes"]; exists && !validation.dynamicObject(attributes, depth+1) {
		return false
	}
	// Fact values allow scalars, arbitrary objects, or one array of those values.
	if items, ok := fact["value"].([]any); ok {
		for _, item := range items {
			if _, nestedArray := item.([]any); nestedArray {
				return false
			}
		}
	}
	return validation.dynamicJSON(fact["value"], depth+1)
}

func worldCreatorConfidence(value any) bool {
	return oneOfText(value, "recorded", "normalized", "inferred", "editorial", "rejected")
}

func worldCreatorGraphAuthoring(validation *worldCoreDTOValidation, value any, depth int) bool {
	_, ok := validation.object(value, depth,
		[]string{"source", "maintainers", "notes", "review"}, []string{"source"})
	return ok && validation.authoring(value, depth)
}

func projectLocalAppWorldCreatorResponse(operation LocalAppOperation, request realmUnaryRequestJSON, accountID string, response *runtimev1.InvokeRealmUnaryResponse) *runtimev1.InvokeRealmUnaryResponse {
	decoded, ok := decodeLocalAppWorldCoreResponse(response)
	if !ok {
		return localAppWorldCoreContractFailure(response)
	}
	family, action, pathKey := worldCreatorShape(operation)
	validation := &worldCoreDTOValidation{}
	if family == "eligibility" {
		value, valid := validation.object(decoded, 0, []string{"canCreateWorld"}, []string{"canCreateWorld"})
		if !valid {
			return localAppWorldCoreContractFailure(response)
		}
		if _, valid = value["canCreateWorld"].(bool); !valid {
			return localAppWorldCoreContractFailure(response)
		}
		return projectCanonicalLocalAppWorldCoreResponse(response, value)
	}
	validate := func(value any) bool {
		object, ok := value.(map[string]any)
		if !ok {
			return false
		}
		switch family {
		case "world":
			if !validation.worldCore(object, 0) {
				return false
			}
		case "character":
			if !validateWorldCreatorCharacter(validation, object) {
				return false
			}
		case "entity", "relationship":
			if !validateWorldCreatorGraphRecord(validation, object, family) {
				return false
			}
		default:
			return false
		}
		if action == "get" || action == "replace" {
			if object["id"] != request.Path[pathKey] {
				return false
			}
		}
		if family != "world" && pathKey == "worldId" && object["worldId"] != request.Path["worldId"] {
			return false
		}
		if action == "create" || action == "replace" {
			body, _ := decodeLocalAppPersonaJSON(request.Body)
			input, ok := body.(map[string]any)
			if !ok {
				return false
			}
			if id, exists := input["id"]; exists && object["id"] != id {
				return false
			}
			if family == "world" || family == "character" {
				if accountID == "" || object["creatorId"] != accountID || object["lorebookDeclaration"] == nil {
					return false
				}
			}
			if family == "character" {
				ref, _ := object["worldEntityRef"].(map[string]any)
				requested, _ := input["worldEntityRef"].(map[string]any)
				if ref["worldId"] != requested["worldId"] || ref["entityId"] != requested["entityId"] {
					return false
				}
			}
		}
		return true
	}
	if action == "list" {
		rows, ok := decoded.([]any)
		maxItems := 500
		if family == "world" {
			maxItems = localAppWorldCoreMaxItems
		}
		if !ok || len(rows) > maxItems {
			return localAppWorldCoreContractFailure(response)
		}
		for _, row := range rows {
			if !validate(row) {
				return localAppWorldCoreContractFailure(response)
			}
		}
	} else if !validate(decoded) {
		return localAppWorldCoreContractFailure(response)
	}
	return projectCanonicalLocalAppWorldCoreResponse(response, decoded)
}

func validateWorldCreatorCharacter(validation *worldCoreDTOValidation, value any) bool {
	fields := []string{"id", "schemaVersion", "contentRevision", "contentHash", "origin", "creatorId", "worldId", "worldEntityRef", "visibility", "lorebookDeclaration", "profile", "validity", "materializationReadiness", "sourceHash", "createdAt", "updatedAt"}
	object, ok := validation.object(value, 0, fields, fields)
	if !ok || object["schemaVersion"] != "realm.world-character-core/v1" || !worldCreatorIdentifier(object["id"]) || !worldCreatorIdentifier(object["creatorId"]) || !worldCreatorIdentifier(object["worldId"]) || !nonnegativeInteger(object["contentRevision"]) || !localAppPersonaHash(object["contentHash"]) || !localAppPersonaHash(object["sourceHash"]) || !validation.origin(object["origin"], 1) || !localAppPersonaOutputVisibility(object["visibility"]) || !timestamp(object["createdAt"]) || !timestamp(object["updatedAt"]) {
		return false
	}
	ref, ok := worldCreatorEntityRef(validation, object["worldEntityRef"], 1)
	if !ok || ref["worldId"] != object["worldId"] {
		return false
	}
	return (object["lorebookDeclaration"] == nil || validation.characterLorebookDeclaration(object["lorebookDeclaration"], 1)) &&
		localAppPersonaProfile(validation, object["profile"], 1, true) &&
		worldCreatorStatusResult(validation, object["validity"], "issues", []string{"valid", "invalid"}) &&
		worldCreatorStatusResult(validation, object["materializationReadiness"], "blockers", []string{"ready", "blocked", "invalid"})
}

func worldCreatorStatusResult(validation *worldCoreDTOValidation, value any, entriesKey string, statuses []string) bool {
	keys := []string{"status", entriesKey}
	object, ok := validation.object(value, 1, keys, keys)
	if !ok || !oneOfText(object["status"], statuses...) {
		return false
	}
	return validation.arrayObjects(object[entriesKey], 2, func(value any, depth int) bool {
		keys := []string{"path", "code", "message"}
		entry, ok := validation.object(value, depth, keys, keys)
		return ok && text(entry["path"], false, localAppWorldCoreMaxTextBytes) &&
			text(entry["code"], false, localAppWorldCoreMaxTextBytes) && text(entry["message"], false, localAppWorldCoreMaxTextBytes)
	})
}

func validateWorldCreatorGraphRecord(validation *worldCoreDTOValidation, value any, family string) bool {
	fields := []string{"id", "schemaVersion", "contentRevision", "contentHash", "origin", "worldId", "core", "createdAt", "updatedAt"}
	if family == "entity" {
		fields = append(fields, "kind")
	} else {
		fields = append(fields, "sourceEntityId", "targetEntityId", "type")
	}
	object, ok := validation.object(value, 0, fields, fields)
	if !ok || !worldCreatorIdentifier(object["id"]) || !worldCreatorIdentifier(object["worldId"]) || !text(object["schemaVersion"], true, 128) || !nonnegativeInteger(object["contentRevision"]) || !localAppPersonaHash(object["contentHash"]) || !validation.origin(object["origin"], 1) || !timestamp(object["createdAt"]) || !timestamp(object["updatedAt"]) {
		return false
	}
	if family == "entity" {
		return worldCreatorIdentifier(object["kind"]) && worldCreatorEntityCore(validation, object["core"], 1)
	}
	for _, key := range []string{"sourceEntityId", "targetEntityId", "type"} {
		if !worldCreatorIdentifier(object[key]) {
			return false
		}
	}
	core, ok := validation.object(object["core"], 1, []string{"endpoints", "evidence", "presentation", "authoring", "attributes"}, []string{"endpoints", "evidence", "presentation", "authoring"})
	if !ok {
		return false
	}
	keys := []string{"sourceEntityId", "targetEntityId", "type"}
	endpoints, ok := validation.object(core["endpoints"], 2, keys, keys)
	if !ok || endpoints["sourceEntityId"] != object["sourceEntityId"] || endpoints["targetEntityId"] != object["targetEntityId"] || endpoints["type"] != object["type"] {
		return false
	}
	evidence, ok := validation.object(core["evidence"], 2, []string{"sourceRefs", "confidence"}, []string{"sourceRefs", "confidence"})
	if !ok || !validation.textArray(evidence["sourceRefs"], 3, true) || !worldCreatorConfidence(evidence["confidence"]) {
		return false
	}
	presentation, ok := validation.object(core["presentation"], 2, []string{"summary"}, nil)
	if !ok || !optionalTextFields(presentation, localAppWorldCoreMaxTextBytes, "summary") || !worldCreatorGraphAuthoring(validation, core["authoring"], 2) {
		return false
	}
	if attributes, exists := core["attributes"]; exists && !validation.dynamicObject(attributes, 2) {
		return false
	}
	return true
}
