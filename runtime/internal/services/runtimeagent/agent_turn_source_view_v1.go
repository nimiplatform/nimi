package runtimeagent

import (
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	cognitionservice "github.com/nimiplatform/nimi/runtime/internal/services/cognition"
)

// localAgentTurnSourceViewV1 is the immutable Runtime-owned turn projection
// hydrated when a materialized snapshot is committed or restored. Ordinary
// turns consume only this compact view; the complete snapshot remains limited
// to materialization, recovery, rebuild, and termination owner paths.
// @nimi-authority: rule.nimi.runtime.agent-service.r058
// @nimi-authority: rule.nimi.runtime.agent-service.r062
type localAgentTurnSourceViewV1 struct {
	LocalAgentRef               string
	SnapshotHash                string
	SourceRef                   sourceMaterializationCharacterSourceRefV3
	SourceSchemaVersion         string
	SourceContentHash           string
	WorldRef                    agentTurnContextItemSourceRef
	WorldContentHash            string
	MaterializationContextHash  string
	Partition                   localAgentSourcePartitionBindingV1
	SnapshotCandidateSourceRefs []agentTurnContextItemSourceRef
	NamedSourceRefs             []localAgentNamedSourceRefV1
	CognitionUnitBindings       []localAgentSourceUnitBindingV1
	CognitionMetadataStatus     string
	CognitionMetadataFailure    string
}

func localAgentTurnSourceViewFromSnapshotV1(snapshot localAgentSourceSnapshotV2) (localAgentTurnSourceViewV1, error) {
	if err := validateLocalAgentSourceSnapshotV2(snapshot); err != nil {
		return localAgentTurnSourceViewV1{}, fmt.Errorf("hydrate LocalAgent turn source view: %w", err)
	}
	partitionRaw, err := canonicalizeSourceMaterializationRealmV3(snapshot.Partition)
	if err != nil {
		return localAgentTurnSourceViewV1{}, fmt.Errorf("encode LocalAgent turn partition binding: %w", err)
	}
	var partition localAgentSourcePartitionBindingV1
	if err := strictDecodeSourceMaterializationV3(partitionRaw, &partition); err != nil {
		return localAgentTurnSourceViewV1{}, fmt.Errorf("decode LocalAgent turn partition binding: %w", err)
	}
	sourceRef := snapshot.Semantic.SourceRef
	if sourceRef.WorldEntityRef != nil {
		worldEntityRef := *sourceRef.WorldEntityRef
		sourceRef.WorldEntityRef = &worldEntityRef
	}
	view := localAgentTurnSourceViewV1{
		LocalAgentRef:       snapshot.LocalAgentRef,
		SnapshotHash:        snapshot.SnapshotHash,
		SourceRef:           sourceRef,
		SourceSchemaVersion: snapshot.Semantic.Source.SchemaVersion,
		SourceContentHash:   snapshot.Semantic.Source.ContentHash,
		WorldRef: agentTurnContextItemSourceRef{
			Kind: "worldCore", WorldID: snapshot.Semantic.OwningWorld.ID, RefID: snapshot.Semantic.OwningWorld.ID,
			SchemaVersion: snapshot.Semantic.OwningWorld.SchemaVersion, ContentHash: snapshot.Semantic.OwningWorld.ContentHash,
		},
		WorldContentHash:           snapshot.Semantic.WorldContentHash,
		MaterializationContextHash: snapshot.Semantic.MaterializationContextHash,
		Partition:                  partition,
	}
	view.SnapshotCandidateSourceRefs = localAgentTurnCandidateSourceRefsV1(snapshot)
	if err := validateLocalAgentTurnSourceViewV1(view); err != nil {
		return localAgentTurnSourceViewV1{}, err
	}
	return localAgentTurnSourceViewWithCognitionMetadataV1(view, snapshot), nil
}

func localAgentTurnSourceViewWithCognitionMetadataV1(view localAgentTurnSourceViewV1, snapshot localAgentSourceSnapshotV2) localAgentTurnSourceViewV1 {
	view.NamedSourceRefs, view.CognitionUnitBindings = nil, nil
	view.CognitionMetadataStatus, view.CognitionMetadataFailure = "", ""
	optional, err := hydrateLocalAgentTurnSourceCognitionMetadataV1(view, snapshot)
	if err != nil {
		view.CognitionMetadataStatus = "failure"
		view.CognitionMetadataFailure = err.Error()
		return view
	}
	return optional
}

// @nimi-authority: rule.nimi.runtime.agent-service.r060
func hydrateLocalAgentTurnSourceCognitionMetadataV1(view localAgentTurnSourceViewV1, snapshot localAgentSourceSnapshotV2) (localAgentTurnSourceViewV1, error) {
	unitPartition, err := projectLocalAgentSourcePartitionV1(snapshot)
	if err != nil {
		return localAgentTurnSourceViewV1{}, fmt.Errorf("hydrate LocalAgent source unit identities: %w", err)
	}
	if unitPartition.PartitionHash != view.Partition.PartitionHash {
		return localAgentTurnSourceViewV1{}, fmt.Errorf("hydrate LocalAgent source unit identities: invalid partition")
	}
	for _, unit := range cognitionUnitsFromPartition(unitPartition) {
		view.CognitionUnitBindings = append(view.CognitionUnitBindings, localAgentSourceUnitBindingV1{UnitID: unit.UnitID, SourceRef: agentTurnContextItemSourceRef{Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: unit.SourceRef.RefID, SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: unit.SourceRef.ContentHash}, ContentHash: cognitionservice.AgentSourceUnitContentHash(unit)})
	}
	var namesErr error
	view.NamedSourceRefs, namesErr = localAgentTurnNamedSourceRefsV1(snapshot)
	if namesErr != nil {
		return localAgentTurnSourceViewV1{}, fmt.Errorf("hydrate LocalAgent source names: %w", namesErr)
	}
	view.CognitionMetadataStatus = "ready"
	if err := validateLocalAgentTurnSourceCognitionMetadataV1(view); err != nil {
		return localAgentTurnSourceViewV1{}, err
	}
	return view, nil
}

func localAgentTurnCandidateSourceRefsV1(snapshot localAgentSourceSnapshotV2) []agentTurnContextItemSourceRef {
	refs := []agentTurnContextItemSourceRef{
		realmSourceCompilerSourceRefV3(snapshot),
		{
			Kind: "worldCore", WorldID: snapshot.Semantic.OwningWorld.ID, RefID: snapshot.Semantic.OwningWorld.ID,
			SchemaVersion: snapshot.Semantic.OwningWorld.SchemaVersion, ContentHash: snapshot.Semantic.OwningWorld.ContentHash,
		},
	}
	appendEntity := func(entity sourceMaterializationEntityRecordV3) {
		refs = append(refs, agentTurnContextItemSourceRef{Kind: "worldEntity", WorldID: entity.WorldID, RefID: entity.ID, SchemaVersion: entity.SchemaVersion, ContentHash: entity.ContentHash})
	}
	appendRelationship := func(relationship sourceMaterializationRelationshipRecordV3) {
		refs = append(refs, agentTurnContextItemSourceRef{Kind: "worldRelationship", WorldID: relationship.WorldID, RefID: relationship.ID, SchemaVersion: relationship.SchemaVersion, ContentHash: relationship.ContentHash})
	}
	closure := snapshot.Semantic.DependencyClosure
	if closure.BoundEntity != nil {
		appendEntity(*closure.BoundEntity)
	}
	for _, entity := range closure.ExplicitEntities {
		appendEntity(entity)
	}
	if closure.EndpointEntities != nil {
		for _, entity := range *closure.EndpointEntities {
			appendEntity(entity)
		}
	}
	if closure.IncidentRelationships != nil {
		for _, relationship := range *closure.IncidentRelationships {
			appendRelationship(relationship)
		}
	}
	if closure.ExplicitRelationships != nil {
		for _, relationship := range *closure.ExplicitRelationships {
			appendRelationship(relationship)
		}
	}
	sort.Slice(refs, func(i, j int) bool {
		return localAgentTurnSourceRefKeyV1(refs[i]) < localAgentTurnSourceRefKeyV1(refs[j])
	})
	unique := refs[:0]
	for _, ref := range refs {
		if len(unique) == 0 || localAgentTurnSourceRefKeyV1(unique[len(unique)-1]) != localAgentTurnSourceRefKeyV1(ref) {
			unique = append(unique, ref)
		}
	}
	return append([]agentTurnContextItemSourceRef(nil), unique...)
}

func validateLocalAgentTurnSourceViewV1(view localAgentTurnSourceViewV1) error {
	if strings.TrimSpace(view.LocalAgentRef) == "" || strings.TrimSpace(view.LocalAgentRef) != view.LocalAgentRef ||
		!isLowerSHA256V3(view.SnapshotHash) || view.SourceRef.validate() != nil ||
		strings.TrimSpace(view.SourceSchemaVersion) == "" || !isLowerSHA256V3(view.SourceContentHash) ||
		!isLowerSHA256V3(view.WorldContentHash) ||
		!isLowerSHA256V3(view.MaterializationContextHash) || len(view.SnapshotCandidateSourceRefs) < 2 {
		return fmt.Errorf("LocalAgent turn source view is invalid")
	}
	if err := validateLocalAgentSourcePartitionBindingV1(view.Partition); err != nil {
		return fmt.Errorf("LocalAgent turn source view partition is invalid: %w", err)
	}
	if view.WorldRef.Kind != "worldCore" || view.WorldRef.WorldID != view.SourceRef.WorldID || view.WorldRef.RefID != view.SourceRef.WorldID ||
		strings.TrimSpace(view.WorldRef.SchemaVersion) == "" || !isLowerSHA256V3(view.WorldRef.ContentHash) || view.WorldRef.ContentHash != view.WorldContentHash {
		return fmt.Errorf("LocalAgent turn source world binding is invalid")
	}
	seen := make(map[string]struct{}, len(view.SnapshotCandidateSourceRefs))
	for _, ref := range view.SnapshotCandidateSourceRefs {
		if strings.TrimSpace(ref.Kind) == "" || strings.TrimSpace(ref.WorldID) == "" || strings.TrimSpace(ref.RefID) == "" ||
			strings.TrimSpace(ref.SchemaVersion) == "" || !isLowerSHA256V3(ref.ContentHash) {
			return fmt.Errorf("LocalAgent turn source candidate ref is invalid")
		}
		key := localAgentTurnSourceRefKeyV1(ref)
		if _, duplicate := seen[key]; duplicate {
			return fmt.Errorf("LocalAgent turn source candidate ref is duplicated")
		}
		seen[key] = struct{}{}
	}
	return nil
}

func validateLocalAgentTurnSourceCognitionMetadataV1(view localAgentTurnSourceViewV1) error {
	if view.CognitionMetadataStatus != "ready" {
		return fmt.Errorf("LocalAgent optional source metadata %s: %s", view.CognitionMetadataStatus, view.CognitionMetadataFailure)
	}
	seen := make(map[string]struct{}, len(view.SnapshotCandidateSourceRefs))
	for _, ref := range view.SnapshotCandidateSourceRefs {
		seen[localAgentTurnSourceRefKeyV1(ref)] = struct{}{}
	}
	for _, named := range view.NamedSourceRefs {
		if _, present := seen[localAgentTurnSourceRefKeyV1(named.SourceRef)]; !present ||
			strings.TrimSpace(named.Name) == "" || strings.TrimSpace(named.Name) != named.Name {
			return fmt.Errorf("LocalAgent turn source name binding is invalid")
		}
		for _, alias := range named.Aliases {
			if strings.TrimSpace(alias) == "" || strings.TrimSpace(alias) != alias {
				return fmt.Errorf("LocalAgent turn source alias is invalid")
			}
		}
	}
	if len(view.CognitionUnitBindings) != int(view.Partition.UnitCount) {
		return fmt.Errorf("LocalAgent turn source unit binding count is invalid")
	}
	unitIDs := make(map[string]struct{}, len(view.CognitionUnitBindings))
	for _, unit := range view.CognitionUnitBindings {
		if _, present := seen[localAgentTurnSourceRefKeyV1(unit.SourceRef)]; !present || strings.TrimSpace(unit.UnitID) == "" || strings.TrimSpace(unit.UnitID) != unit.UnitID || !isLowerSHA256V3(unit.ContentHash) {
			return fmt.Errorf("LocalAgent turn source unit binding is invalid")
		}
		if _, duplicate := unitIDs[unit.UnitID]; duplicate {
			return fmt.Errorf("LocalAgent turn source unit binding is duplicated")
		}
		unitIDs[unit.UnitID] = struct{}{}
	}
	return nil
}

func localAgentTurnSourceRefKeyV1(ref agentTurnContextItemSourceRef) string {
	return strings.Join([]string{ref.Kind, ref.WorldID, ref.RefID, ref.SchemaVersion, ref.ContentHash}, "\x00")
}

func (s *Service) turnSourceView(localAgentRef string) (localAgentTurnSourceViewV1, bool) {
	if s == nil {
		return localAgentTurnSourceViewV1{}, false
	}
	localAgentRef = strings.TrimSpace(localAgentRef)
	s.mu.RLock()
	entry := s.agents[localAgentRef]
	view, found := s.turnSourceViews[localAgentRef]
	active := entry != nil && entry.Agent != nil && entry.Agent.GetLifecycleStatus() == runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE
	s.mu.RUnlock()
	if !found || !active {
		return localAgentTurnSourceViewV1{}, false
	}
	return view, true
}
