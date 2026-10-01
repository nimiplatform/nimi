package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.local-app-text-behaviors
// Compatibility is a fact of the unique exact registration, not its marketing
// model name. This projection never executes or rewrites a caller transcript;
// normal request admission still checks the complete behavior combination.
func projectTextReplay(registrations []textBehaviorAdapterRegistration, facts textBehaviorAdapterResolutionFacts) *runtimev1.TextReplayCompatibility {
	if !validTextBehaviorResolutionFacts(facts) {
		return nil
	}
	matches := []textBehaviorAdapterRegistration{}
	for _, registration := range registrations {
		if validTextBehaviorAdapterRegistration(registration) && textBehaviorAdapterMatchesFacts(registration, facts) {
			matches = append(matches, registration)
		}
	}
	if len(matches) > 1 {
		return nil
	}
	result := &runtimev1.TextReplayCompatibility{}
	if len(matches) == 0 {
		return result
	}
	support := matches[0].Support.Reasoning
	if support == nil || !support.OpaqueContinuityCarrier {
		return result
	}
	if !exactNonEmptyTextBehaviorValue(support.ContinuityKind) || support.ContinuityVersion == 0 {
		return nil
	}
	format := &runtimev1.TextReplayCarrierFormat{Kind: support.ContinuityKind, Version: support.ContinuityVersion}
	seen := map[runtimev1.ExecutionMode]bool{}
	for _, combination := range matches[0].Support.Combinations {
		if !combination.Reasoning {
			continue
		}
		for _, mode := range combination.Modes {
			if seen[mode] {
				continue
			}
			seen[mode] = true
			if mode == runtimev1.ExecutionMode_EXECUTION_MODE_SYNC {
				format.ExecutionModes = append(format.ExecutionModes, runtimev1.TextReplayExecutionMode_TEXT_REPLAY_EXECUTION_MODE_SYNC)
			}
			if mode == runtimev1.ExecutionMode_EXECUTION_MODE_STREAM {
				format.ExecutionModes = append(format.ExecutionModes, runtimev1.TextReplayExecutionMode_TEXT_REPLAY_EXECUTION_MODE_STREAM)
			}
		}
	}
	result.AcceptedCarriers = []*runtimev1.TextReplayCarrierFormat{format}
	return result
}
