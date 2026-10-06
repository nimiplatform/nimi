package cognition

import (
	"context"
	"errors"

	nimicognition "github.com/nimiplatform/nimi/nimi-cognition/cognition"
)

type AgentSourceUnitBinding = nimicognition.RuntimeSourceUnitBinding

type AgentSourceSelection struct {
	SourceRef AgentSourceRef
	Basis     string
	Term      string
	Units     []AgentSourceUnitBinding
}

type AgentSourceQuery struct {
	Text              string
	PartitionIdentity string
	UnitCount         uint32
	OmissionCount     uint32
	ExactSourceRefs   []AgentSourceSelection
	Limit             int
}

func AgentSourceUnitContentHash(unit AgentSourceUnit) string {
	return nimicognition.RuntimeSourceUnitContentHash(nimicognition.RuntimeSourceUnit{UnitID: unit.UnitID, Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: nimicognition.RuntimeSourceRef{Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: unit.SourceRef.RefID, SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: unit.SourceRef.ContentHash}, Text: unit.Text, ProvenanceRefs: unit.ProvenanceRefs, Priority: unit.Priority})
}

func projectAgentSourceUnit(unit nimicognition.RuntimeSourceUnit) AgentSourceUnit {
	return AgentSourceUnit{UnitID: unit.UnitID, Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: AgentSourceRef{Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: unit.SourceRef.RefID, SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: unit.SourceRef.ContentHash}, Text: unit.Text, ProvenanceRefs: append([]string{}, unit.ProvenanceRefs...), Priority: unit.Priority, Score: unit.Score, HasSemanticScore: unit.HasSemanticScore, SelectionBasis: unit.SelectionBasis, MatchedTerm: unit.MatchedTerm}
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r013
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r015
func (s *Service) SearchAgentSource(ctx context.Context, accountID, localAgentRef, scopeID, snapshotIdentity string, query AgentSourceQuery) (AgentSourceOutcome, error) {
	if query.Limit <= 0 || query.Limit > 12 {
		return AgentSourceOutcome{}, errors.New("cognition service: source query limit is invalid")
	}
	var exact AgentSourceOutcome
	if len(query.ExactSourceRefs) > 0 {
		if s == nil || s.sourceBridge == nil {
			return AgentSourceOutcome{Status: "unavailable", ExactStatus: "unavailable", ScopeID: scopeID, SnapshotIdentity: snapshotIdentity}, nil
		}
		selections := make([]nimicognition.RuntimeSourceSelection, 0, len(query.ExactSourceRefs))
		for _, selection := range query.ExactSourceRefs {
			ref := selection.SourceRef
			selections = append(selections, nimicognition.RuntimeSourceSelection{SourceRef: nimicognition.RuntimeSourceRef{Kind: ref.Kind, WorldID: ref.WorldID, RefID: ref.RefID, SchemaVersion: ref.SchemaVersion, ContentHash: ref.ContentHash}, Basis: selection.Basis, Term: selection.Term, Units: append([]nimicognition.RuntimeSourceUnitBinding{}, selection.Units...)})
		}
		auth := agentSourceAuthorization(accountID, scopeID, nimicognition.RuntimeAuthorizationActionSearchAgentSource, nimicognition.RuntimeBridgeOperationSearchAgentSource)
		out, err := s.sourceBridge.ReadAgentSourceReferences(ctx, auth, nimicognition.RuntimeSourceReferenceRead{ScopeID: scopeID, SnapshotIdentity: snapshotIdentity, PartitionIdentity: query.PartitionIdentity, UnitCount: query.UnitCount, OmissionCount: query.OmissionCount, Selections: selections, Limit: query.Limit})
		if err != nil {
			return AgentSourceOutcome{}, err
		}
		exact = projectAgentSourceOutcome(out)
		for _, unit := range out.Units {
			exact.Units = append(exact.Units, projectAgentSourceUnit(unit))
		}
	}
	semantic, err := s.searchAgentSourceSemantics(ctx, accountID, localAgentRef, scopeID, snapshotIdentity, query.Text, query.Limit)
	if err != nil {
		if len(query.ExactSourceRefs) == 0 {
			return AgentSourceOutcome{}, err
		}
		exact.Status = "failure"
		return exact, nil
	}
	if len(query.ExactSourceRefs) == 0 {
		return semantic, nil
	}
	result := exact
	result.Status = semantic.Status
	result.GenerationStatus = semantic.GenerationStatus
	result.Generation = semantic.Generation
	if semantic.ScopeID != exact.ScopeID || semantic.SnapshotIdentity != exact.SnapshotIdentity || semantic.PartitionIdentity != exact.PartitionIdentity || semantic.UnitCount != exact.UnitCount || semantic.OmissionCount != exact.OmissionCount {
		return AgentSourceOutcome{}, errors.New("cognition service: source query binding changed")
	}
	seen := make(map[string]int, len(result.Units))
	for index, unit := range result.Units {
		seen[unit.UnitID] = index
	}
	for _, unit := range semantic.Units {
		if index, duplicate := seen[unit.UnitID]; duplicate {
			if AgentSourceUnitContentHash(result.Units[index]) != AgentSourceUnitContentHash(unit) {
				return AgentSourceOutcome{}, errors.New("cognition service: source query content changed")
			}
			result.Units[index].Score = unit.Score
			result.Units[index].HasSemanticScore = unit.HasSemanticScore
			continue
		}
		if len(result.Units) < query.Limit {
			seen[unit.UnitID] = len(result.Units)
			result.Units = append(result.Units, unit)
		}
	}
	return result, nil
}
