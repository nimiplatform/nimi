package runtimeagent

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

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
