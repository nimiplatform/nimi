package account

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"regexp"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
)

var localAppPersonaHashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

// @nimi-authority: rule.nimi.platform.core-protocol.p-proto-048
// @nimi-authority: rule.nimi.runtime.protected-session.r032
func validateLocalAppPersonaCharacterRequest(operation LocalAppOperation, request realmUnaryRequestJSON) error {
	switch operation {
	case LocalAppOperationPersonaListOwned:
		if len(request.Path) != 0 || localAppPersonaBodyPresent(request.Body) {
			return errors.New("owner PersonaCharacter list path or body is invalid")
		}
		for key, value := range request.Query {
			switch key {
			case "scope":
				if value != "owned" {
					return errors.New("owner PersonaCharacter scope is invalid")
				}
			case "worldId", "afterId":
				if !localAppPersonaText(value, true, 512) {
					return errors.New("owner PersonaCharacter list identifier is invalid")
				}
			case "visibility":
				if !localAppPersonaWritableVisibility(value) {
					return errors.New("owner PersonaCharacter visibility is invalid")
				}
			case "take":
				if !localAppPersonaTake(value) {
					return errors.New("owner PersonaCharacter take is invalid")
				}
			default:
				return errors.New("owner PersonaCharacter list query is invalid")
			}
		}
		if request.Query["scope"] != "owned" {
			return errors.New("owner PersonaCharacter scope is required")
		}
		return nil
	case LocalAppOperationPersonaGetOwned:
		return validateLocalAppPersonaCharacterPathOnly(request)
	case LocalAppOperationPersonaCreate:
		if len(request.Path) != 0 || len(request.Query) != 0 {
			return errors.New("owner PersonaCharacter create envelope is invalid")
		}
		return validateLocalAppPersonaCharacterInput(request.Body, false)
	case LocalAppOperationPersonaReplace:
		if err := validateLocalAppPersonaCharacterPathOnly(realmUnaryRequestJSON{Path: request.Path, Query: request.Query}); err != nil {
			return err
		}
		return validateLocalAppPersonaCharacterInput(request.Body, true)
	default:
		return nil
	}
}

func validateLocalAppPersonaCharacterPathOnly(request realmUnaryRequestJSON) error {
	if len(request.Path) != 1 || len(request.Query) != 0 || localAppPersonaBodyPresent(request.Body) ||
		!localAppPersonaText(request.Path["personaCharacterId"], true, 512) {
		return errors.New("owner PersonaCharacter identity is invalid")
	}
	return nil
}

func validateLocalAppPersonaCharacterInput(raw json.RawMessage, replace bool) error {
	decoded, ok := decodeLocalAppPersonaJSON(raw)
	if !ok {
		return errors.New("owner PersonaCharacter body is invalid")
	}
	validation := &worldCoreDTOValidation{}
	required := []string{"worldId", "visibility", "origin", "profile"}
	allowed := append([]string(nil), required...)
	if replace {
		allowed = append(allowed, "baseContentHash")
		required = append(required, "baseContentHash")
	}
	object, ok := validation.object(decoded, 0, allowed, required)
	if !ok || !localAppPersonaText(object["worldId"], true, 512) ||
		!localAppPersonaWritableVisibility(object["visibility"]) ||
		!localAppPersonaOpaqueObject(validation, object["origin"], 1) ||
		!localAppPersonaProfile(validation, object["profile"], 1, false) {
		return errors.New("owner PersonaCharacter body violates the proxy contract")
	}
	if replace && !localAppPersonaHash(object["baseContentHash"]) {
		return errors.New("owner PersonaCharacter baseContentHash is invalid")
	}
	return nil
}

func localAppPersonaBodyPresent(raw json.RawMessage) bool {
	trimmed := strings.TrimSpace(string(raw))
	return trimmed != "" && trimmed != "null"
}

func decodeLocalAppPersonaJSON(raw []byte) (any, bool) {
	if len(raw) == 0 || jsonstrict.RejectDuplicateKeys(raw) != nil {
		return nil, false
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var decoded any
	if decoder.Decode(&decoded) != nil {
		return nil, false
	}
	var trailing any
	return decoded, decoder.Decode(&trailing) == io.EOF
}

func projectLocalAppPersonaCharacterListResponse(response *runtimev1.InvokeRealmUnaryResponse, accountID string) *runtimev1.InvokeRealmUnaryResponse {
	decoded, ok := decodeLocalAppWorldCoreResponse(response)
	if !ok {
		return localAppPersonaContractFailure(response)
	}
	items, ok := decoded.([]any)
	if !ok || len(items) > 500 {
		return localAppPersonaContractFailure(response)
	}
	validation := &worldCoreDTOValidation{}
	for _, item := range items {
		switch validation.personaCharacter(item, 0, accountID) {
		case localAppPersonaOwnerValid:
			continue
		case localAppPersonaSessionOwnerMissing:
			return localAppPersonaSessionOwnerFailure(response)
		case localAppPersonaOwnerMismatch:
			return localAppPersonaAccessDenied(response)
		default:
			return localAppPersonaContractFailure(response)
		}
	}
	return projectCanonicalLocalAppWorldCoreResponse(response, items)
}

func projectLocalAppPersonaCharacterResponse(response *runtimev1.InvokeRealmUnaryResponse, accountID string) *runtimev1.InvokeRealmUnaryResponse {
	decoded, ok := decodeLocalAppWorldCoreResponse(response)
	if !ok {
		return localAppPersonaContractFailure(response)
	}
	validation := &worldCoreDTOValidation{}
	switch validation.personaCharacter(decoded, 0, accountID) {
	case localAppPersonaOwnerValid:
		return projectCanonicalLocalAppWorldCoreResponse(response, decoded)
	case localAppPersonaSessionOwnerMissing:
		return localAppPersonaSessionOwnerFailure(response)
	case localAppPersonaOwnerMismatch:
		return localAppPersonaAccessDenied(response)
	default:
		return localAppPersonaContractFailure(response)
	}
}

type localAppPersonaOwnerState uint8

const (
	localAppPersonaOwnerInvalid localAppPersonaOwnerState = iota
	localAppPersonaSessionOwnerMissing
	localAppPersonaOwnerMismatch
	localAppPersonaOwnerValid
)

func (validation *worldCoreDTOValidation) personaCharacter(value any, depth int, accountID string) localAppPersonaOwnerState {
	object, ok := validation.object(value, depth,
		[]string{"id", "schemaVersion", "contentRevision", "contentHash", "origin", "ownerAccountId", "worldId", "visibility", "profile", "validity", "materializationReadiness", "sourceHash", "createdAt", "updatedAt"},
		[]string{"id", "schemaVersion", "contentRevision", "contentHash", "origin", "ownerAccountId", "worldId", "visibility", "profile", "validity", "materializationReadiness", "sourceHash", "createdAt", "updatedAt"})
	if !ok {
		return localAppPersonaOwnerInvalid
	}
	if strings.TrimSpace(accountID) == "" {
		return localAppPersonaSessionOwnerMissing
	}
	owner, ownerOK := object["ownerAccountId"].(string)
	if !ownerOK || strings.TrimSpace(owner) == "" {
		return localAppPersonaOwnerInvalid
	}
	if owner != accountID {
		return localAppPersonaOwnerMismatch
	}
	if !localAppPersonaText(object["id"], true, 512) || object["schemaVersion"] != "realm.persona-character-core/v1" ||
		!nonnegativeInteger(object["contentRevision"]) || !localAppPersonaHash(object["contentHash"]) ||
		!localAppPersonaOpaqueObject(validation, object["origin"], depth+1) ||
		!localAppPersonaText(object["worldId"], true, 512) || !localAppPersonaOutputVisibility(object["visibility"]) ||
		!localAppPersonaProfile(validation, object["profile"], depth+1, true) ||
		!localAppPersonaOpaqueObject(validation, object["validity"], depth+1) ||
		!localAppPersonaOpaqueObject(validation, object["materializationReadiness"], depth+1) ||
		!localAppPersonaHash(object["sourceHash"]) || !localAppPersonaText(object["createdAt"], true, 4_096) ||
		!localAppPersonaText(object["updatedAt"], true, 4_096) {
		return localAppPersonaOwnerInvalid
	}
	delete(object, "ownerAccountId")
	return localAppPersonaOwnerValid
}

func localAppPersonaProfile(validation *worldCoreDTOValidation, value any, depth int, output bool) bool {
	profile, ok := value.(map[string]any)
	if !ok || !validation.dynamicJSON(profile, depth) {
		return false
	}
	if output {
		if profile["profileSchemaVersion"] != "realm.character-profile-core/v1" ||
			!localAppPersonaHash(profile["profileHash"]) {
			return false
		}
		if coverage, ok := profile["profileCoverage"].(map[string]any); !ok ||
			!localAppPersonaHash(coverage["profileCoverageHash"]) ||
			!validation.dynamicJSON(coverage, depth+1) {
			return false
		}
	} else if _, hasHash := profile["profileHash"]; hasHash {
		return false
	} else if _, hasCoverage := profile["profileCoverage"]; hasCoverage {
		return false
	}
	return localAppPersonaExternalRefsSafe(profile)
}

func localAppPersonaExternalRefsSafe(profile map[string]any) bool {
	assetsValue, exists := profile["assets"]
	if !exists {
		return true
	}
	assets, ok := assetsValue.(map[string]any)
	if !ok {
		return false
	}
	externalValue, exists := assets["externalRefs"]
	if !exists {
		return true
	}
	externalRefs, ok := externalValue.([]any)
	if !ok || len(externalRefs) > localAppWorldCoreMaxArrayItems {
		return false
	}
	for _, value := range externalRefs {
		row, ok := value.(map[string]any)
		if !ok || !safeWorldCoreExternalURI(row["uri"]) {
			return false
		}
	}
	return true
}

func localAppPersonaOpaqueObject(validation *worldCoreDTOValidation, value any, depth int) bool {
	object, ok := value.(map[string]any)
	return ok && validation.dynamicJSON(object, depth)
}

func localAppPersonaHash(value any) bool {
	textValue, ok := value.(string)
	return ok && localAppPersonaHashPattern.MatchString(textValue)
}

func localAppPersonaText(value any, nonempty bool, maximum int) bool {
	textValue, ok := value.(string)
	if !ok || textValue != strings.TrimSpace(textValue) || len([]byte(textValue)) > maximum || strings.ContainsRune(textValue, '\x00') {
		return false
	}
	return !nonempty || textValue != ""
}

func localAppPersonaWritableVisibility(value any) bool {
	return oneOfText(value, "private", "unlisted", "public")
}

func localAppPersonaOutputVisibility(value any) bool {
	return oneOfText(value, "private", "unlisted", "public", "system")
}

func localAppPersonaTake(value any) bool {
	switch numberValue := value.(type) {
	case json.Number:
		parsed, err := numberValue.Int64()
		return err == nil && parsed >= 1 && parsed <= 500
	case float64:
		return !math.IsInf(numberValue, 0) && !math.IsNaN(numberValue) && math.Trunc(numberValue) == numberValue && numberValue >= 1 && numberValue <= 500
	default:
		return false
	}
}

func localAppPersonaSessionOwnerFailure(response *runtimev1.InvokeRealmUnaryResponse) *runtimev1.InvokeRealmUnaryResponse {
	return localAppPersonaFailure(response, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE)
}

func localAppPersonaAccessDenied(response *runtimev1.InvokeRealmUnaryResponse) *runtimev1.InvokeRealmUnaryResponse {
	return localAppPersonaFailure(response, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_FORBIDDEN)
}

func localAppPersonaFailure(response *runtimev1.InvokeRealmUnaryResponse, reason runtimev1.ReasonCode, accountReason runtimev1.AccountReasonCode) *runtimev1.InvokeRealmUnaryResponse {
	status := 0
	if response != nil {
		status = int(response.GetHttpStatus())
	}
	return sanitizeLocalAppRealmFailure(realmUnaryFailure(reason, accountReason, "owner PersonaCharacter projection was denied", status))
}

func localAppPersonaContractFailure(response *runtimev1.InvokeRealmUnaryResponse) *runtimev1.InvokeRealmUnaryResponse {
	status := 0
	if response != nil {
		status = int(response.GetHttpStatus())
	}
	return sanitizeLocalAppRealmFailure(realmUnaryFailure(
		runtimev1.ReasonCode_REALM_CONTRACT_INVALID,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONTRACT_FAILED,
		"Realm PersonaCharacter response violates the typed proxy contract",
		status,
	))
}
