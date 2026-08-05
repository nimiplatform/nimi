package runtimeagent

import (
	"fmt"
	"sort"
	"strings"
)

type agentTurnContextBudgetResult struct {
	Manifest agentTurnContextBudgetManifestV1
}

type agentTurnContextTruncationCandidate struct {
	LaneIndex int
	ItemIndex int
	Class     agentTurnContextTruncationClass
	Rank      int64
	Priority  int64
	StableID  string
}

const (
	agentTurnContextOptionalRealmSourceBudgetDivisor        uint64 = 8
	agentTurnContextOptionalRealmSourceOutputBudgetMultiple uint64 = 4
)

var agentTurnContextTruncationOrder = []agentTurnContextTruncationClass{
	agentTurnContextTruncationWorldDetail,
	agentTurnContextTruncationHistory,
	agentTurnContextTruncationMemory,
	agentTurnContextTruncationExemplar,
	agentTurnContextTruncationKnowledge,
}

func applyAgentTurnContextBudget(lanes []agentTurnContextLane, input agentTurnContextBudgetInput) (agentTurnContextBudgetResult, error) {
	reserved, ok := addAgentTurnContextTokens(input.ReservedOutputTokens, input.ReservedSafetyTokens, input.ReservedAdapterTokens)
	if !ok || input.ContextWindowTokens == 0 {
		return agentTurnContextBudgetResult{}, fmt.Errorf("agent turn context model budget is invalid")
	}
	var inputBudget uint64
	if input.ContextWindowTokens > reserved {
		inputBudget = input.ContextWindowTokens - reserved
	}
	var allocated uint64
	var required uint64
	for laneIndex := range lanes {
		lane := &lanes[laneIndex]
		lane.AllocatedTokens = 0
		for itemIndex := range lane.Items {
			item := &lane.Items[itemIndex]
			if item.OmissionReason != "" {
				if strings.TrimSpace(item.OmissionReason) != item.OmissionReason || item.Mandatory ||
					item.TruncationClass != agentTurnContextTruncationNone || item.TokenEstimate != 0 ||
					len(item.Segments) != 0 || len(item.Media) != 0 || !validSHA256Hex(item.ContentHash) {
					return agentTurnContextBudgetResult{}, fmt.Errorf("agent turn context omission item %q is invalid", item.StableID)
				}
				item.Included = false
				item.Truncated = false
				continue
			}
			item.Included = true
			item.Truncated = false
			var ok bool
			lane.AllocatedTokens, ok = addAgentTurnContextTokens(lane.AllocatedTokens, item.TokenEstimate)
			if !ok {
				return agentTurnContextBudgetResult{}, fmt.Errorf("agent turn context lane token estimate overflow")
			}
			allocated, ok = addAgentTurnContextTokens(allocated, item.TokenEstimate)
			if !ok {
				return agentTurnContextBudgetResult{}, fmt.Errorf("agent turn context token estimate overflow")
			}
			if item.Mandatory {
				required, ok = addAgentTurnContextTokens(required, item.TokenEstimate)
				if !ok {
					return agentTurnContextBudgetResult{}, fmt.Errorf("agent turn context required token estimate overflow")
				}
			}
		}
	}
	// A model's context capacity is not an interactive latency target. Keep
	// optional Realm materialization detail within a bounded share of the
	// resolved input budget so a large World closure cannot consume nearly the
	// entire prompt merely because the model advertises a large context window.
	// Mandatory source identity/behavior, Runtime transcript, memory, policy,
	// capabilities, and the current turn do not participate in this sub-budget.
	optionalRealmSourceBudget := agentTurnContextOptionalRealmSourceBudget(inputBudget, input.ReservedOutputTokens)
	optionalRealmSourceTokens := truncateOptionalRealmSourceContext(lanes, optionalRealmSourceBudget)
	retainedTokens, ok := addAgentTurnContextTokens(optionalRealmSourceTokens, agentTurnContextIncludedNonOptionalRealmSourceTokens(lanes))
	if !ok || retainedTokens > allocated {
		return agentTurnContextBudgetResult{}, fmt.Errorf("agent turn context optional Realm source token estimate is invalid")
	}
	used := retainedTokens
	if used > inputBudget {
		candidates := collectAgentTurnContextTruncationCandidates(lanes)
		for _, class := range agentTurnContextTruncationOrder {
			classCandidates := candidates[class]
			orderAgentTurnContextTruncationCandidates(class, classCandidates)
			for _, candidate := range classCandidates {
				if used <= inputBudget {
					break
				}
				item := &lanes[candidate.LaneIndex].Items[candidate.ItemIndex]
				if !item.Included || item.Mandatory {
					continue
				}
				item.Included = false
				item.Truncated = true
				used -= item.TokenEstimate
			}
		}
	}
	refreshAgentTurnContextLaneBudgetStats(lanes)
	manifest := agentTurnContextBudgetManifestV1{
		ContextWindowTokens:   input.ContextWindowTokens,
		ReservedOutputTokens:  input.ReservedOutputTokens,
		ReservedSafetyTokens:  input.ReservedSafetyTokens,
		ReservedAdapterTokens: input.ReservedAdapterTokens,
		InputBudgetTokens:     inputBudget,
		RequiredTokens:        required,
		AllocatedTokens:       allocated,
		UsedTokens:            used,
	}
	if used > inputBudget || required > inputBudget {
		return agentTurnContextBudgetResult{Manifest: manifest}, &agentTurnContextCapacityExceededError{
			RequiredTokens:  required,
			AvailableTokens: inputBudget,
			BlockingLane:    agentTurnContextBlockingLane(lanes, inputBudget),
		}
	}
	return agentTurnContextBudgetResult{Manifest: manifest}, nil
}

func agentTurnContextOptionalRealmSourceBudget(inputBudget, reservedOutput uint64) uint64 {
	budget := inputBudget / agentTurnContextOptionalRealmSourceBudgetDivisor
	outputScaledBudget := inputBudget
	if reservedOutput <= inputBudget/agentTurnContextOptionalRealmSourceOutputBudgetMultiple {
		outputScaledBudget = reservedOutput * agentTurnContextOptionalRealmSourceOutputBudgetMultiple
	}
	if outputScaledBudget > budget {
		budget = outputScaledBudget
	}
	if budget > inputBudget {
		return inputBudget
	}
	return budget
}

func truncateOptionalRealmSourceContext(lanes []agentTurnContextLane, budget uint64) uint64 {
	var used uint64
	candidates := make([]agentTurnContextTruncationCandidate, 0)
	for laneIndex := range lanes {
		for itemIndex := range lanes[laneIndex].Items {
			item := &lanes[laneIndex].Items[itemIndex]
			if !isOptionalRealmSourceContextItem(*item) {
				continue
			}
			used += item.TokenEstimate
			candidates = append(candidates, agentTurnContextTruncationCandidate{
				LaneIndex: laneIndex,
				ItemIndex: itemIndex,
				Class:     item.TruncationClass,
				Rank:      item.Rank,
				Priority:  item.Priority,
				StableID:  item.StableID,
			})
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Priority != candidates[j].Priority {
			return candidates[i].Priority < candidates[j].Priority
		}
		return candidates[i].StableID < candidates[j].StableID
	})
	for _, candidate := range candidates {
		if used <= budget {
			break
		}
		item := &lanes[candidate.LaneIndex].Items[candidate.ItemIndex]
		if !item.Included {
			continue
		}
		item.Included = false
		item.Truncated = true
		used -= item.TokenEstimate
	}
	return used
}

func agentTurnContextIncludedNonOptionalRealmSourceTokens(lanes []agentTurnContextLane) uint64 {
	var tokens uint64
	for _, lane := range lanes {
		for _, item := range lane.Items {
			if item.Included && !isOptionalRealmSourceContextItem(item) {
				tokens += item.TokenEstimate
			}
		}
	}
	return tokens
}

func isOptionalRealmSourceContextItem(item agentTurnContextItem) bool {
	return !item.Mandatory &&
		item.AuthorityOwner == agentTurnContextAuthorityRealmSnapshot &&
		item.TruncationClass != agentTurnContextTruncationNone
}

func collectAgentTurnContextTruncationCandidates(lanes []agentTurnContextLane) map[agentTurnContextTruncationClass][]agentTurnContextTruncationCandidate {
	out := make(map[agentTurnContextTruncationClass][]agentTurnContextTruncationCandidate, len(agentTurnContextTruncationOrder))
	for laneIndex := range lanes {
		for itemIndex, item := range lanes[laneIndex].Items {
			if item.Mandatory || item.TruncationClass == agentTurnContextTruncationNone {
				continue
			}
			out[item.TruncationClass] = append(out[item.TruncationClass], agentTurnContextTruncationCandidate{
				LaneIndex: laneIndex,
				ItemIndex: itemIndex,
				Class:     item.TruncationClass,
				Rank:      item.Rank,
				Priority:  item.Priority,
				StableID:  item.StableID,
			})
		}
	}
	return out
}

func orderAgentTurnContextTruncationCandidates(class agentTurnContextTruncationClass, candidates []agentTurnContextTruncationCandidate) {
	sort.Slice(candidates, func(i, j int) bool {
		switch class {
		case agentTurnContextTruncationHistory:
			if candidates[i].Rank != candidates[j].Rank {
				return candidates[i].Rank < candidates[j].Rank
			}
		case agentTurnContextTruncationMemory:
			if candidates[i].Rank != candidates[j].Rank {
				return candidates[i].Rank < candidates[j].Rank
			}
		default:
			if candidates[i].Priority != candidates[j].Priority {
				return candidates[i].Priority < candidates[j].Priority
			}
		}
		return candidates[i].StableID < candidates[j].StableID
	})
}

func refreshAgentTurnContextLaneBudgetStats(lanes []agentTurnContextLane) {
	for laneIndex := range lanes {
		lane := &lanes[laneIndex]
		lane.UsedTokens = 0
		lane.IncludedItemCount = 0
		lane.OmittedItemCount = 0
		lane.TruncatedCount = 0
		for _, item := range lane.Items {
			if item.Included {
				lane.UsedTokens += item.TokenEstimate
				lane.IncludedItemCount++
			} else if item.Truncated {
				lane.TruncatedCount++
			} else {
				lane.OmittedItemCount++
			}
		}
	}
}

func agentTurnContextBlockingLane(lanes []agentTurnContextLane, inputBudget uint64) agentTurnContextLaneID {
	var cumulative uint64
	for _, lane := range lanes {
		for _, item := range lane.Items {
			if !item.Mandatory {
				continue
			}
			cumulative += item.TokenEstimate
			if cumulative > inputBudget {
				return lane.LaneID
			}
		}
	}
	return agentTurnContextLaneCurrentUserTurn
}

func addAgentTurnContextTokens(values ...uint64) (uint64, bool) {
	var total uint64
	for _, value := range values {
		if ^uint64(0)-total < value {
			return 0, false
		}
		total += value
	}
	return total, true
}
