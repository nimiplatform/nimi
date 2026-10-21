package cognition

import (
	"context"
	"errors"
	"time"

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

// Index reads share this budget. Embedding is an existing Runtime AI Job
// with its own execution deadline; model loading is not an index read.
const agentSourceIndexReadBudget = 750 * time.Millisecond

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
	if s == nil || s.sourceBridge == nil {
		out := AgentSourceOutcome{Status: "unavailable", ScopeID: scopeID, SnapshotIdentity: snapshotIdentity}
		if len(query.ExactSourceRefs) > 0 {
			out.ExactStatus = "unavailable"
		}
		return out, nil
	}
	indexCtx, cancelIndex := context.WithTimeout(ctx, agentSourceIndexReadBudget)
	auth := agentSourceAuthorization(accountID, scopeID, nimicognition.RuntimeAuthorizationActionSearchAgentSource, nimicognition.RuntimeBridgeOperationSearchAgentSource)
	state, err := s.sourceBridge.InspectAgentSource(indexCtx, auth, scopeID, snapshotIdentity)
	deadline, _ := indexCtx.Deadline()
	remaining := time.Until(deadline)
	cancelIndex()
	if err != nil {
		return AgentSourceOutcome{}, err
	}
	if remaining <= 0 {
		return AgentSourceOutcome{}, context.DeadlineExceeded
	}

	semantic := projectAgentSourceOutcome(state)
	execution := AgentSourceEmbeddingExecution{Status: "unconfigured"}
	if state.Status == "ready" {
		if executor := s.agentSourceExecutor(); executor != nil {
			// Capture and execution remain under the caller cancellation and
			// the existing AI Job deadline, not the index read deadline.
			var executionErr error
			execution, executionErr = executor(ctx, accountID, localAgentRef, []string{query.Text}, "retrieval-query")
			execution.Status = normalizeAgentSourceEmbeddingStatus(execution.Status)
			if execution.Status == "ready" && (executionErr != nil || len(execution.Vectors) != 1) {
				execution.Status = "failure"
			}
			if executionErr != nil || execution.Status != "ready" {
				if s.logger != nil {
					s.logger.Warn("source Cognition query embedding did not reach ready", "status", execution.Status, "error", executionErr)
				}
			}
		}
		semantic.Status = execution.Status
	}
	if ctx.Err() != nil {
		return AgentSourceOutcome{}, ctx.Err()
	}

	// Both semantic lookup and exact body read use the remaining index budget.
	// Read exact bodies after model I/O so unavailable semantics cannot return
	// a body whose source was deleted while the embedding was in flight.
	indexCtx, cancelIndex = context.WithTimeout(ctx, remaining)
	defer cancelIndex()
	if semantic.Status == "ready" {
		auth = agentSourceAuthorization(accountID, scopeID, nimicognition.RuntimeAuthorizationActionSearchAgentSource, nimicognition.RuntimeBridgeOperationSearchAgentSource)
		out, searchErr := s.sourceBridge.SearchAgentSource(indexCtx, auth, scopeID, snapshotIdentity, execution.Identity, query.Text, execution.Vectors[0], query.Limit)
		if searchErr != nil {
			if len(query.ExactSourceRefs) == 0 {
				return AgentSourceOutcome{}, searchErr
			}
			semantic.Status = "failure"
		} else {
			semantic = projectAgentSourceOutcome(out)
			for _, unit := range out.Units {
				semantic.Units = append(semantic.Units, projectAgentSourceUnit(unit))
			}
		}
	}
	if len(query.ExactSourceRefs) == 0 {
		return semantic, nil
	}
	selections := make([]nimicognition.RuntimeSourceSelection, 0, len(query.ExactSourceRefs))
	for _, selection := range query.ExactSourceRefs {
		ref := selection.SourceRef
		selections = append(selections, nimicognition.RuntimeSourceSelection{SourceRef: nimicognition.RuntimeSourceRef{Kind: ref.Kind, WorldID: ref.WorldID, RefID: ref.RefID, SchemaVersion: ref.SchemaVersion, ContentHash: ref.ContentHash}, Basis: selection.Basis, Term: selection.Term, Units: append([]nimicognition.RuntimeSourceUnitBinding{}, selection.Units...)})
	}
	auth = agentSourceAuthorization(accountID, scopeID, nimicognition.RuntimeAuthorizationActionSearchAgentSource, nimicognition.RuntimeBridgeOperationSearchAgentSource)
	out, err := s.sourceBridge.ReadAgentSourceReferences(indexCtx, auth, nimicognition.RuntimeSourceReferenceRead{ScopeID: scopeID, SnapshotIdentity: snapshotIdentity, PartitionIdentity: query.PartitionIdentity, UnitCount: query.UnitCount, OmissionCount: query.OmissionCount, Selections: selections, Limit: query.Limit})
	if err != nil {
		return AgentSourceOutcome{}, err
	}
	exact := projectAgentSourceOutcome(out)
	for _, unit := range out.Units {
		exact.Units = append(exact.Units, projectAgentSourceUnit(unit))
	}
	result := exact
	result.Status = semantic.Status
	if semantic.Generation != exact.Generation {
		// The body is current, but the earlier semantic result belongs to a
		// different generation. Keep the exact read without its old scores.
		result.Status = "unavailable"
		return result, nil
	}
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
