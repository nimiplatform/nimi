package runtimeagent

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

func normalizeAgentTurnCognitionInput(input agentTurnCognitionInput) agentTurnCognitionInput {
	if strings.TrimSpace(input.AdapterStatus) == "" {
		input.AdapterStatus = "unavailable"
	}
	if strings.TrimSpace(input.SelectionStatus) == "" {
		input.SelectionStatus = input.AdapterStatus
	}
	return input
}

func validateAgentTurnCognitionInput(input agentTurnCognitionInput) error {
	if !admittedAgentTurnCognitionAdapterStatus(input.AdapterStatus) || !admittedAgentTurnCognitionSelectionStatus(input.SelectionStatus) {
		return fmt.Errorf("agent turn Cognition status is invalid")
	}
	if input.CandidateCount < uint32(len(input.Candidates)) {
		return fmt.Errorf("agent turn Cognition candidate count is invalid")
	}
	seen := make(map[string]struct{}, len(input.Candidates))
	for _, candidate := range input.Candidates {
		if strings.TrimSpace(candidate.UnitID) == "" || strings.TrimSpace(candidate.Category) == "" || strings.TrimSpace(candidate.SourcePath) == "" || strings.TrimSpace(candidate.Text) == "" || !validAgentTurnCognitionSelection(candidate) {
			return fmt.Errorf("agent turn Cognition candidate is invalid")
		}
		if _, duplicate := seen[candidate.UnitID]; duplicate {
			return fmt.Errorf("agent turn Cognition candidate is duplicated")
		}
		seen[candidate.UnitID] = struct{}{}
	}
	return nil
}

func appendAgentTurnCognitionInputs(items map[agentTurnContextLaneID][]agentTurnContextItem, input agentTurnCognitionInput) error {
	candidates := append([]agentTurnCognitionCandidateInput(nil), input.Candidates...)
	sort.SliceStable(candidates, func(i, j int) bool {
		iExact, jExact := agentTurnCognitionCandidateIsExact(candidates[i]), agentTurnCognitionCandidateIsExact(candidates[j])
		if iExact != jExact {
			return iExact
		}
		if iExact {
			return false
		} // Preserve the bounded exact order supplied by Cognition.
		if !iExact && candidates[i].Score != candidates[j].Score {
			return candidates[i].Score > candidates[j].Score
		}
		if candidates[i].Priority != candidates[j].Priority {
			return candidates[i].Priority > candidates[j].Priority
		}
		return candidates[i].UnitID < candidates[j].UnitID
	})
	for index, candidate := range candidates {
		basis := candidate.SelectionBasis
		if basis == "" {
			basis = "embedding"
		}
		content := agentTurnContextTypedContent("Optional snapshot-bound Cognition source candidate",
			agentTurnContextTextField{Name: "category", Values: []string{candidate.Category}},
			agentTurnContextTextField{Name: "selection_basis", Values: []string{basis}},
			agentTurnContextTextField{Name: "matched_term", Values: []string{candidate.MatchedTerm}},
			agentTurnContextTextField{Name: "source", Values: []string{candidate.Text}},
		)
		item, err := newAgentTurnContextItem(
			agentTurnContextLaneCognitionSource,
			"cognition.source."+candidate.UnitID,
			candidate.SourcePath,
			candidate.SourceRef,
			agentTurnContextAuthorityCognitionSource,
			agentTurnContextTrustValidatedSource,
			candidate.Priority,
			int64(len(candidates)-index),
			false,
			agentTurnContextTruncationCognition,
			[]agentTurnContextSegment{{Role: "system", Content: content}},
			nil,
		)
		if err != nil {
			return err
		}
		items[agentTurnContextLaneCognitionSource] = append(items[agentTurnContextLaneCognitionSource], item)
	}
	return nil
}

func projectAgentTurnContextCognitionManifest(lanes []agentTurnContextLane, input agentTurnCognitionInput) agentTurnContextCognitionManifestV1 {
	manifest := agentTurnContextCognitionManifestV1{
		AdapterStatus: input.AdapterStatus, SelectionStatus: input.SelectionStatus,
		Generation: input.Generation, CandidateCount: input.CandidateCount,
		ExactStatus: input.ExactStatus, GenerationStatus: input.GenerationStatus, Ambiguous: input.Ambiguous,
		FailureReason: input.FailureReason,
	}
	included := make(map[string]struct{})
	for _, lane := range lanes {
		if lane.LaneID != agentTurnContextLaneCognitionSource {
			continue
		}
		manifest.IncludedUnitCount = lane.IncludedItemCount
		manifest.OmittedUnitCount = lane.OmittedItemCount + lane.TruncatedCount
		for _, item := range lane.Items {
			if item.Included {
				included[item.StableID] = struct{}{}
			}
		}
		if input.CandidateCount > 0 && lane.IncludedItemCount == 0 {
			manifest.SelectionStatus = "no_result"
		}
		break
	}
	for _, candidate := range input.Candidates {
		basis := candidate.SelectionBasis
		if basis == "" {
			basis = "embedding"
		}
		_, selected := included["cognition.source."+candidate.UnitID]
		selection := agentTurnCognitionSelectionManifestV1{UnitID: candidate.UnitID, Basis: basis, Term: candidate.MatchedTerm, Included: selected}
		if candidate.HasSemanticScore || !agentTurnCognitionCandidateIsExact(candidate) {
			score := candidate.Score
			selection.SemanticScore = &score
		}
		manifest.Selections = append(manifest.Selections, selection)
	}
	return manifest
}

func agentTurnCognitionCandidateIsExact(candidate agentTurnCognitionCandidateInput) bool {
	return candidate.SelectionBasis == "source_ref" || candidate.SelectionBasis == "name" || candidate.SelectionBasis == "alias"
}

func validAgentTurnCognitionSelection(candidate agentTurnCognitionCandidateInput) bool {
	if math.IsNaN(candidate.Score) || math.IsInf(candidate.Score, 0) {
		return false
	}
	if agentTurnCognitionCandidateIsExact(candidate) {
		return strings.TrimSpace(candidate.MatchedTerm) != "" && (candidate.HasSemanticScore || candidate.Score == 0)
	}
	return (candidate.SelectionBasis == "" || candidate.SelectionBasis == "embedding") && candidate.Score > 0
}

func admittedAgentTurnCognitionAdapterStatus(status string) bool {
	switch status {
	case "unconfigured", "building", "unavailable", "failure", "ready", "no_hits", "not_requested":
		return true
	default:
		return false
	}
}

func admittedAgentTurnCognitionSelectionStatus(status string) bool {
	return admittedAgentTurnCognitionAdapterStatus(status) || status == "no_result"
}

func projectAgentTurnContextConversationSummaryManifest(lanes []agentTurnContextLane, input *agentTurnConversationSummaryInput) agentTurnContextConversationSummaryManifestV1 {
	if input == nil {
		return agentTurnContextConversationSummaryManifestV1{Status: "absent"}
	}
	status := input.Status
	if status == "ready" && input.Revision > 0 {
		for _, lane := range lanes {
			if lane.LaneID == agentTurnContextLaneConversationSummary && lane.IncludedItemCount == 0 {
				status = "omitted"
			}
		}
	}
	return agentTurnContextConversationSummaryManifestV1{Status: status, Revision: input.Revision, CoveredSequenceStart: input.CoveredSequenceStart, CoveredSequenceEnd: input.CoveredSequenceEnd}
}
