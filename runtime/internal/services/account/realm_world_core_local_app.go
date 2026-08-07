package account

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/url"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
)

const (
	localAppWorldCoreMaxItems      = 1_000
	localAppWorldCoreMaxArrayItems = 20_000
	localAppWorldCoreMaxNodes      = 100_000
	localAppWorldCoreMaxDepth      = 32
	localAppWorldCoreMaxTextBytes  = 64 * 1024
)

type worldCoreDTOValidation struct {
	nodes int
}

func projectLocalAppWorldCoreListResponse(response *runtimev1.InvokeRealmUnaryResponse) *runtimev1.InvokeRealmUnaryResponse {
	if response == nil || !response.GetAccepted() || response.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED ||
		response.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED ||
		response.GetProductionInert() || response.GetHttpStatus() < 200 || response.GetHttpStatus() >= 300 ||
		response.GetErrorMessage() != "" || len(response.GetResponseJson()) == 0 || len(response.GetResponseJson()) > 1<<20 {
		return localAppWorldCoreContractFailure(response)
	}
	raw := []byte(response.GetResponseJson())
	if err := jsonstrict.RejectDuplicateKeys(raw); err != nil {
		return localAppWorldCoreContractFailure(response)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var decoded any
	if err := decoder.Decode(&decoded); err != nil {
		return localAppWorldCoreContractFailure(response)
	}
	if err := requireWorldCoreJSONEOF(decoder); err != nil {
		return localAppWorldCoreContractFailure(response)
	}
	items, ok := decoded.([]any)
	if !ok || len(items) > localAppWorldCoreMaxItems {
		return localAppWorldCoreContractFailure(response)
	}
	validation := &worldCoreDTOValidation{}
	for _, item := range items {
		if !validation.worldCore(item, 0) {
			return localAppWorldCoreContractFailure(response)
		}
	}
	canonical, err := json.Marshal(items)
	if err != nil || len(canonical) > 1<<20 {
		return localAppWorldCoreContractFailure(response)
	}
	projected := *response
	projected.ResponseJson = string(canonical)
	return &projected
}

func localAppWorldCoreContractFailure(response *runtimev1.InvokeRealmUnaryResponse) *runtimev1.InvokeRealmUnaryResponse {
	status := int32(0)
	if response != nil {
		status = response.GetHttpStatus()
	}
	return realmUnaryFailure(
		runtimev1.ReasonCode_REALM_CONTRACT_INVALID,
		runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONTRACT_FAILED,
		"Realm WorldCore response violates the exact DTO contract",
		int(status),
	)
}

func requireWorldCoreJSONEOF(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("trailing WorldCore JSON")
	}
	return nil
}

func (validation *worldCoreDTOValidation) worldCore(value any, depth int) bool {
	object, ok := validation.object(value, depth,
		[]string{"id", "schemaVersion", "contentRevision", "contentHash", "origin", "visibility", "core", "createdAt", "updatedAt", "creatorId"},
		[]string{"id", "schemaVersion", "contentRevision", "contentHash", "origin", "visibility", "core", "createdAt", "updatedAt"})
	if !ok || !text(object["id"], true, 512) || !text(object["schemaVersion"], true, 128) ||
		!number(object["contentRevision"]) || !text(object["contentHash"], true, 512) ||
		!oneOfText(object["visibility"], "private", "unlisted", "public", "system") ||
		!timestamp(object["createdAt"]) || !timestamp(object["updatedAt"]) {
		return false
	}
	if creator, exists := object["creatorId"]; exists && creator != nil && !text(creator, false, 512) {
		return false
	}
	return validation.origin(object["origin"], depth+1) && validation.core(object["core"], depth+1)
}

func (validation *worldCoreDTOValidation) origin(value any, depth int) bool {
	object, ok := validation.object(value, depth,
		[]string{"kind", "parentCharacterId", "parentWorldId", "sourceContentHash", "sourceId", "sourceVersion"},
		[]string{"kind"})
	if !ok || !oneOfText(object["kind"], "manual", "forge", "worldCharacterDerivation", "import", "system") {
		return false
	}
	return optionalTextFields(object, 512, "parentCharacterId", "parentWorldId", "sourceContentHash", "sourceId", "sourceVersion")
}

func (validation *worldCoreDTOValidation) core(value any, depth int) bool {
	object, ok := validation.object(value, depth,
		[]string{"identity", "presentation", "ontology", "timeModel", "timeline", "entities", "relationships", "systems", "scenes", "assets", "authoring"},
		[]string{"identity", "presentation", "ontology", "timeModel", "timeline", "entities", "relationships", "systems", "scenes", "assets", "authoring"})
	if !ok || !validation.identity(object["identity"], depth+1) || !validation.presentation(object["presentation"], depth+1) ||
		!validation.ontology(object["ontology"], depth+1) || !validation.timeModel(object["timeModel"], depth+1) ||
		!validation.timeline(object["timeline"], depth+1) || !validation.assets(object["assets"], depth+1) ||
		!validation.authoring(object["authoring"], depth+1) {
		return false
	}
	return validation.arrayObjects(object["entities"], depth+1, validation.entity) &&
		validation.arrayObjects(object["relationships"], depth+1, validation.relationship) &&
		validation.arrayObjects(object["systems"], depth+1, validation.system) &&
		validation.arrayObjects(object["scenes"], depth+1, validation.scene)
}

func (validation *worldCoreDTOValidation) identity(value any, depth int) bool {
	object, ok := validation.object(value, depth,
		[]string{"name", "summary", "divergences", "era", "genre", "tagline", "themes", "worldType"},
		[]string{"name", "summary"})
	if !ok || !text(object["name"], true, 4_096) || !text(object["summary"], true, localAppWorldCoreMaxTextBytes) ||
		!optionalTextFields(object, 4_096, "era", "genre", "tagline", "worldType") {
		return false
	}
	return validation.optionalTextArray(object, "divergences", depth+1, true) && validation.optionalTextArray(object, "themes", depth+1, true)
}

func (validation *worldCoreDTOValidation) presentation(value any, depth int) bool {
	object, ok := validation.object(value, depth,
		[]string{"bannerResourceRef", "displayName", "iconResourceRef", "palette", "tagline", "title"}, nil)
	return ok && optionalTextFields(object, 4_096, "bannerResourceRef", "displayName", "iconResourceRef", "tagline", "title") &&
		validation.optionalTextArray(object, "palette", depth+1, true)
}

func (validation *worldCoreDTOValidation) ontology(value any, depth int) bool {
	object, ok := validation.object(value, depth,
		[]string{"concepts", "entityKinds", "relationshipTypes"}, []string{"entityKinds", "relationshipTypes"})
	if !ok || !validation.textArray(object["entityKinds"], depth+1, true) || !validation.textArray(object["relationshipTypes"], depth+1, true) {
		return false
	}
	if concepts, exists := object["concepts"]; exists {
		return validation.arrayObjects(concepts, depth+1, validation.concept)
	}
	return true
}

func (validation *worldCoreDTOValidation) concept(value any, depth int) bool {
	object, ok := validation.object(value, depth, []string{"conceptId", "name", "summary"}, []string{"conceptId", "name"})
	return ok && text(object["conceptId"], true, 512) && text(object["name"], true, 4_096) && optionalTextFields(object, localAppWorldCoreMaxTextBytes, "summary")
}

func (validation *worldCoreDTOValidation) timeModel(value any, depth int) bool {
	object, ok := validation.object(value, depth,
		[]string{"mode", "flowRatio", "isPaused", "anchor", "pausedWorldTime", "calendar", "displayFormat"},
		[]string{"mode", "flowRatio", "isPaused", "anchor", "pausedWorldTime", "calendar", "displayFormat"})
	if !ok || !oneOfText(object["mode"], "wallClockAnchored", "static") || !number(object["flowRatio"]) {
		return false
	}
	if _, ok := object["isPaused"].(bool); !ok {
		return false
	}
	for _, key := range []string{"pausedWorldTime", "calendar", "displayFormat"} {
		if object[key] != nil && !text(object[key], false, 4_096) {
			return false
		}
	}
	anchor, ok := validation.object(object["anchor"], depth+1,
		[]string{"realStartedAt", "worldStartedAt", "worldStartedAtDisplay"},
		[]string{"realStartedAt", "worldStartedAt", "worldStartedAtDisplay"})
	return ok && text(anchor["realStartedAt"], true, 4_096) && text(anchor["worldStartedAt"], true, 4_096) && text(anchor["worldStartedAtDisplay"], true, 4_096)
}

func (validation *worldCoreDTOValidation) timeline(value any, depth int) bool {
	object, ok := validation.object(value, depth, []string{"events"}, []string{"events"})
	return ok && validation.arrayObjects(object["events"], depth+1, validation.event)
}

func (validation *worldCoreDTOValidation) event(value any, depth int) bool {
	object, ok := validation.object(value, depth,
		[]string{"characterRefs", "endsAt", "entityRefs", "eventId", "importance", "locationRefs", "sceneRefs", "sequence", "sourceRefs", "startsAt", "summary", "timestamp", "title"},
		[]string{"eventId", "title"})
	if !ok || !text(object["eventId"], true, 512) || !text(object["title"], true, 4_096) ||
		!optionalTextFields(object, localAppWorldCoreMaxTextBytes, "endsAt", "startsAt", "summary", "timestamp") {
		return false
	}
	for _, key := range []string{"importance", "sequence"} {
		if field, exists := object[key]; exists && !number(field) {
			return false
		}
	}
	for _, key := range []string{"characterRefs", "entityRefs", "locationRefs", "sceneRefs", "sourceRefs"} {
		if !validation.optionalTextArray(object, key, depth+1, true) {
			return false
		}
	}
	return true
}

func (validation *worldCoreDTOValidation) entity(value any, depth int) bool {
	object, ok := validation.object(value, depth, []string{"entityId", "kind", "label", "summary"}, []string{"entityId", "kind"})
	return ok && text(object["entityId"], true, 512) && text(object["kind"], true, 512) && optionalTextFields(object, localAppWorldCoreMaxTextBytes, "label", "summary")
}

func (validation *worldCoreDTOValidation) relationship(value any, depth int) bool {
	object, ok := validation.object(value, depth,
		[]string{"attributes", "relationshipId", "sourceEntityId", "summary", "targetEntityId", "type"},
		[]string{"relationshipId", "sourceEntityId", "targetEntityId", "type"})
	if !ok || !text(object["relationshipId"], true, 512) || !text(object["sourceEntityId"], true, 512) ||
		!text(object["targetEntityId"], true, 512) || !text(object["type"], true, 512) ||
		!optionalTextFields(object, localAppWorldCoreMaxTextBytes, "summary") {
		return false
	}
	if attributes, exists := object["attributes"]; exists {
		return validation.dynamicObject(attributes, depth+1)
	}
	return true
}

func (validation *worldCoreDTOValidation) system(value any, depth int) bool {
	object, ok := validation.object(value, depth,
		[]string{"name", "parameters", "principles", "summary", "systemId"}, []string{"systemId", "name", "summary"})
	if !ok || !text(object["systemId"], true, 512) || !text(object["name"], true, 4_096) || !text(object["summary"], true, localAppWorldCoreMaxTextBytes) ||
		!validation.optionalTextArray(object, "principles", depth+1, true) {
		return false
	}
	if parameters, exists := object["parameters"]; exists {
		return validation.dynamicObject(parameters, depth+1)
	}
	return true
}

func (validation *worldCoreDTOValidation) scene(value any, depth int) bool {
	object, ok := validation.object(value, depth,
		[]string{"assetRefs", "entityRefs", "name", "sceneId", "summary"}, []string{"sceneId", "name", "summary"})
	return ok && text(object["sceneId"], true, 512) && text(object["name"], true, 4_096) && text(object["summary"], true, localAppWorldCoreMaxTextBytes) &&
		validation.optionalTextArray(object, "assetRefs", depth+1, true) && validation.optionalTextArray(object, "entityRefs", depth+1, true)
}

func (validation *worldCoreDTOValidation) assets(value any, depth int) bool {
	object, ok := validation.object(value, depth,
		[]string{"externalRefs", "intents", "resourceRefs"}, []string{"intents", "resourceRefs"})
	if !ok || !validation.arrayObjects(object["intents"], depth+1, validation.intent) ||
		!validation.arrayObjects(object["resourceRefs"], depth+1, validation.resourceRef) {
		return false
	}
	if external, exists := object["externalRefs"]; exists {
		return validation.arrayObjects(external, depth+1, validation.externalRef)
	}
	return true
}

func (validation *worldCoreDTOValidation) resourceRef(value any, depth int) bool {
	object, ok := validation.object(value, depth, []string{"kind", "label", "purpose", "refId"}, []string{"refId", "kind"})
	return ok && text(object["refId"], true, 512) && text(object["kind"], true, 512) && optionalTextFields(object, 4_096, "label", "purpose")
}

func (validation *worldCoreDTOValidation) intent(value any, depth int) bool {
	object, ok := validation.object(value, depth, []string{"intentId", "kind", "summary"}, []string{"intentId", "kind"})
	return ok && text(object["intentId"], true, 512) && text(object["kind"], true, 512) && optionalTextFields(object, localAppWorldCoreMaxTextBytes, "summary")
}

func (validation *worldCoreDTOValidation) externalRef(value any, depth int) bool {
	object, ok := validation.object(value, depth, []string{"kind", "label", "purpose", "refId", "uri"}, []string{"refId", "kind", "uri"})
	return ok && text(object["refId"], true, 512) && text(object["kind"], true, 512) && optionalTextFields(object, 4_096, "label", "purpose") && safeWorldCoreExternalURI(object["uri"])
}

func (validation *worldCoreDTOValidation) authoring(value any, depth int) bool {
	object, ok := validation.object(value, depth,
		[]string{"extensions", "maintainers", "notes", "review", "source"}, []string{"source"})
	if !ok || !text(object["source"], true, 4_096) || !validation.optionalTextArray(object, "maintainers", depth+1, true) ||
		!validation.optionalTextArray(object, "notes", depth+1, true) {
		return false
	}
	if extensions, exists := object["extensions"]; exists && !validation.dynamicObject(extensions, depth+1) {
		return false
	}
	if review, exists := object["review"]; exists {
		reviewObject, reviewOK := validation.object(review, depth+1,
			[]string{"reviewedAt", "reviewedBy", "status"}, []string{"status"})
		return reviewOK && text(reviewObject["status"], true, 512) && optionalTextFields(reviewObject, 4_096, "reviewedAt", "reviewedBy")
	}
	return true
}

func (validation *worldCoreDTOValidation) object(value any, depth int, allowed []string, required []string) (map[string]any, bool) {
	if depth > localAppWorldCoreMaxDepth || !validation.addNode() {
		return nil, false
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, key := range allowed {
		allowedSet[key] = struct{}{}
	}
	for key := range object {
		if len(key) == 0 || len(key) > 512 {
			return nil, false
		}
		if _, admitted := allowedSet[key]; !admitted {
			return nil, false
		}
	}
	for _, key := range required {
		if _, exists := object[key]; !exists {
			return nil, false
		}
	}
	return object, true
}

func (validation *worldCoreDTOValidation) arrayObjects(value any, depth int, validate func(any, int) bool) bool {
	items, ok := value.([]any)
	if !ok || len(items) > localAppWorldCoreMaxArrayItems || depth > localAppWorldCoreMaxDepth {
		return false
	}
	for _, item := range items {
		if !validate(item, depth+1) {
			return false
		}
	}
	return true
}

func (validation *worldCoreDTOValidation) textArray(value any, depth int, nonempty bool) bool {
	items, ok := value.([]any)
	if !ok || len(items) > localAppWorldCoreMaxArrayItems || depth > localAppWorldCoreMaxDepth {
		return false
	}
	for _, item := range items {
		if !validation.addNode() || !text(item, nonempty, localAppWorldCoreMaxTextBytes) {
			return false
		}
	}
	return true
}

func (validation *worldCoreDTOValidation) optionalTextArray(object map[string]any, key string, depth int, nonempty bool) bool {
	value, exists := object[key]
	return !exists || validation.textArray(value, depth, nonempty)
}

func (validation *worldCoreDTOValidation) dynamicObject(value any, depth int) bool {
	object, ok := value.(map[string]any)
	if !ok {
		return false
	}
	return validation.dynamicJSON(object, depth)
}

func (validation *worldCoreDTOValidation) dynamicJSON(value any, depth int) bool {
	if depth > localAppWorldCoreMaxDepth || !validation.addNode() {
		return false
	}
	switch typed := value.(type) {
	case nil, bool:
		return true
	case string:
		return len(typed) <= localAppWorldCoreMaxTextBytes && !strings.ContainsRune(typed, '\x00')
	case json.Number:
		return number(typed)
	case []any:
		if len(typed) > localAppWorldCoreMaxArrayItems {
			return false
		}
		for _, item := range typed {
			if !validation.dynamicJSON(item, depth+1) {
				return false
			}
		}
		return true
	case map[string]any:
		if len(typed) > localAppWorldCoreMaxArrayItems {
			return false
		}
		for key, item := range typed {
			if key == "" || len(key) > 512 || !validation.dynamicJSON(item, depth+1) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

func (validation *worldCoreDTOValidation) addNode() bool {
	validation.nodes++
	return validation.nodes <= localAppWorldCoreMaxNodes
}

func optionalTextFields(object map[string]any, maximum int, keys ...string) bool {
	for _, key := range keys {
		if value, exists := object[key]; exists && !text(value, false, maximum) {
			return false
		}
	}
	return true
}

func text(value any, nonempty bool, maximum int) bool {
	textValue, ok := value.(string)
	if !ok || len(textValue) > maximum || strings.ContainsRune(textValue, '\x00') {
		return false
	}
	return !nonempty || len(textValue) > 0
}

func oneOfText(value any, admitted ...string) bool {
	textValue, ok := value.(string)
	if !ok {
		return false
	}
	for _, candidate := range admitted {
		if textValue == candidate {
			return true
		}
	}
	return false
}

func number(value any) bool {
	numberValue, ok := value.(json.Number)
	if !ok {
		return false
	}
	parsed, err := numberValue.Float64()
	return err == nil && !math.IsInf(parsed, 0) && !math.IsNaN(parsed)
}

func timestamp(value any) bool {
	textValue, ok := value.(string)
	if !ok || len(textValue) > 128 {
		return false
	}
	_, err := time.Parse(time.RFC3339Nano, textValue)
	return err == nil
}

func safeWorldCoreExternalURI(value any) bool {
	textValue, ok := value.(string)
	if !ok || len(textValue) == 0 || len(textValue) > 2_048 {
		return false
	}
	parsed, err := url.Parse(textValue)
	return err == nil && parsed.Scheme == "https" && parsed.Hostname() != "" && parsed.User == nil &&
		parsed.RawQuery == "" && !parsed.ForceQuery && parsed.Fragment == "" && parsed.RawFragment == ""
}
