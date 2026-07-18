package runtimeagent

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

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
