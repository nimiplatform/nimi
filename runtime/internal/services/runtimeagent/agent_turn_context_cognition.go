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
		if strings.TrimSpace(candidate.UnitID) == "" || strings.TrimSpace(candidate.Category) == "" || strings.TrimSpace(candidate.SourcePath) == "" || strings.TrimSpace(candidate.Text) == "" || math.IsNaN(candidate.Score) || math.IsInf(candidate.Score, 0) || candidate.Score <= 0 {
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
		if candidates[i].Score != candidates[j].Score {
			return candidates[i].Score > candidates[j].Score
		}
		if candidates[i].Priority != candidates[j].Priority {
			return candidates[i].Priority > candidates[j].Priority
		}
		return candidates[i].UnitID < candidates[j].UnitID
	})
	for index, candidate := range candidates {
		content := agentTurnContextTypedContent("Optional snapshot-bound Cognition source candidate",
			agentTurnContextTextField{Name: "category", Values: []string{candidate.Category}},
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
	}
	for _, lane := range lanes {
		if lane.LaneID != agentTurnContextLaneCognitionSource {
			continue
		}
		manifest.IncludedUnitCount = lane.IncludedItemCount
		manifest.OmittedUnitCount = lane.OmittedItemCount + lane.TruncatedCount
		if input.CandidateCount > 0 && lane.IncludedItemCount == 0 {
			manifest.SelectionStatus = "no_result"
		}
		break
	}
	return manifest
}

func admittedAgentTurnCognitionAdapterStatus(status string) bool {
	switch status {
	case "unconfigured", "building", "unavailable", "failure", "ready", "no_hits":
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
