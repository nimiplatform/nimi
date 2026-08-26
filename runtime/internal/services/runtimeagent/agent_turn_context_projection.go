package runtimeagent

import (
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func projectAgentTurnContextSummary(compilation *agentTurnContextCompilation) *runtimev1.AgentTurnContextSummary {
	if compilation == nil {
		return nil
	}
	manifest := compilation.Manifest
	return &runtimev1.AgentTurnContextSummary{
		SchemaVersion:              runtimev1.AgentTurnContextSummarySchemaVersion_AGENT_TURN_CONTEXT_SUMMARY_SCHEMA_VERSION_V2,
		Ready:                      true,
		State:                      runtimev1.AgentTurnContextState_AGENT_TURN_CONTEXT_STATE_READY,
		ReasonCode:                 runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_NONE,
		ManifestSchemaVersion:      runtimev1.AgentTurnContextManifestSchemaVersion_AGENT_TURN_CONTEXT_MANIFEST_SCHEMA_VERSION_V1,
		CompilerSchemaVersion:      runtimev1.AgentTurnContextCompilerSchemaVersion_AGENT_TURN_CONTEXT_COMPILER_SCHEMA_VERSION_V1,
		ManifestInstanceHash:       manifest.ManifestInstanceHash,
		ContextContentHash:         manifest.ContextContentHash,
		PromptHash:                 manifest.PromptHash,
		SourceSnapshotHash:         manifest.SourceSnapshotHash,
		SourceRef:                  sourceMaterializationProtoRefV3(manifest.SourceRef),
		WorldContentHash:           manifest.WorldContentHash,
		MaterializationContextHash: manifest.MaterializationContextHash,
		Lanes:                      projectAgentTurnContextLanes(compilation.PrivateLanes),
		Budget:                     projectAgentTurnContextBudget(manifest.Budget),
		Truncation:                 projectAgentTurnContextTruncation(compilation.PrivateLanes, false),
		TranscriptTurnCount:        manifest.Transcript.CommittedTurnCount,
		MemoryItemCount:            manifest.MemoryItemCount,
		MediaCount:                 manifest.MediaCount,
		ToolCount:                  manifest.ToolCount,
		RouteDigest:                manifest.RouteDigest,
		CatalogRevisionDigest:      manifest.CatalogRevisionDigest,
		LocalAgentRef:              manifest.LocalAgentRef,
		ConversationAnchorId:       manifest.ConversationAnchorID,
		TurnId:                     manifest.TurnID,
		SourceCognition:            projectAgentSourceCognitionSummary(manifest.Cognition),
		ConversationSummary:        projectAgentConversationContextSummary(manifest.ConversationSummary),
		PrivateRecallCount:         manifest.PrivateRecallCount,
	}
}

func projectAgentTurnContextCapacityFailure(input agentTurnContextCompileInput, lanes []agentTurnContextLane, budget agentTurnContextBudgetManifestV1, toolCount uint32) *runtimev1.AgentTurnContextSummary {
	return &runtimev1.AgentTurnContextSummary{
		SchemaVersion:              runtimev1.AgentTurnContextSummarySchemaVersion_AGENT_TURN_CONTEXT_SUMMARY_SCHEMA_VERSION_V2,
		Ready:                      false,
		State:                      runtimev1.AgentTurnContextState_AGENT_TURN_CONTEXT_STATE_CONTEXT_CAPACITY_EXCEEDED,
		ReasonCode:                 runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_CAPACITY_EXCEEDED,
		ManifestSchemaVersion:      runtimev1.AgentTurnContextManifestSchemaVersion_AGENT_TURN_CONTEXT_MANIFEST_SCHEMA_VERSION_V1,
		CompilerSchemaVersion:      runtimev1.AgentTurnContextCompilerSchemaVersion_AGENT_TURN_CONTEXT_COMPILER_SCHEMA_VERSION_V1,
		SourceSnapshotHash:         input.Source.SnapshotHash,
		SourceRef:                  sourceMaterializationProtoRefV3(input.Source.SourceRef),
		WorldContentHash:           input.Source.WorldContentHash,
		MaterializationContextHash: input.Source.MaterializationContextHash,
		Lanes:                      projectAgentTurnContextLanes(lanes),
		Budget:                     projectAgentTurnContextBudget(budget),
		Truncation:                 projectAgentTurnContextTruncation(lanes, true),
		TranscriptTurnCount:        uint32(len(input.Transcript)),
		MemoryItemCount:            uint32(len(input.Memory)),
		MediaCount:                 uint32(len(input.CurrentUserTurn.Media)),
		ToolCount:                  toolCount,
		RouteDigest:                input.Route.RouteDigest,
		CatalogRevisionDigest:      input.Route.CatalogRevisionDigest,
		LocalAgentRef:              input.LocalAgentRef,
		ConversationAnchorId:       input.ConversationAnchorID,
		TurnId:                     input.TurnID,
		SourceCognition:            projectAgentSourceCognitionSummary(projectAgentTurnContextCognitionManifest(lanes, input.Cognition)),
		ConversationSummary:        projectAgentConversationContextSummary(projectAgentTurnContextConversationSummaryManifest(lanes, input.ConversationSummary)),
		PrivateRecallCount:         agentTurnPrivateRecallCount(input.PrivateRecall),
	}
}

func projectAgentTurnContextLanes(lanes []agentTurnContextLane) []*runtimev1.AgentTurnContextLaneSummary {
	out := make([]*runtimev1.AgentTurnContextLaneSummary, 0, len(lanes))
	for _, lane := range lanes {
		out = append(out, &runtimev1.AgentTurnContextLaneSummary{
			LaneId:             agentTurnContextProtoLaneID(lane.LaneID),
			State:              agentTurnContextProtoLaneState(lane),
			IncludedItemCount:  lane.IncludedItemCount,
			OmittedItemCount:   lane.OmittedItemCount,
			TruncatedItemCount: lane.TruncatedCount,
			AllocatedTokens:    lane.AllocatedTokens,
			UsedTokens:         lane.UsedTokens,
		})
	}
	return out
}

func projectAgentTurnContextBudget(budget agentTurnContextBudgetManifestV1) *runtimev1.AgentTurnContextBudgetSummary {
	requiredContextWindow, ok := addAgentTurnContextTokens(budget.RequiredTokens, budget.ReservedOutputTokens)
	if ok {
		requiredContextWindow, ok = addAgentTurnContextTokens(requiredContextWindow, budget.ReservedReasoningTokens)
	}
	if ok {
		requiredContextWindow, ok = addAgentTurnContextTokens(requiredContextWindow, budget.ReservedSafetyTokens)
	}
	if ok {
		requiredContextWindow, ok = addAgentTurnContextTokens(requiredContextWindow, budget.ReservedAdapterTokens)
	}
	if !ok {
		requiredContextWindow = 0
	}
	return &runtimev1.AgentTurnContextBudgetSummary{
		ContextWindowTokens:         budget.ContextWindowTokens,
		ReservedOutputTokens:        budget.ReservedOutputTokens,
		ReservedReasoningTokens:     budget.ReservedReasoningTokens,
		ReservedSafetyTokens:        budget.ReservedSafetyTokens,
		ReservedAdapterTokens:       budget.ReservedAdapterTokens,
		InputBudgetTokens:           budget.InputBudgetTokens,
		UsedTokens:                  budget.UsedTokens,
		RequiredInputTokens:         budget.RequiredTokens,
		RequiredContextWindowTokens: requiredContextWindow,
	}
}

func projectAgentTurnContextTruncation(lanes []agentTurnContextLane, capacityExceeded bool) []*runtimev1.AgentTurnContextTruncationSummary {
	var omitted uint32
	var truncated uint32
	for _, lane := range lanes {
		omitted += lane.OmittedItemCount
		truncated += lane.TruncatedCount
	}
	if capacityExceeded {
		return []*runtimev1.AgentTurnContextTruncationSummary{{
			Reason:             runtimev1.AgentTurnContextTruncationReason_AGENT_TURN_CONTEXT_TRUNCATION_REASON_CONTEXT_CAPACITY_EXCEEDED,
			OmittedItemCount:   omitted,
			TruncatedItemCount: truncated,
		}}
	}
	if omitted == 0 && truncated == 0 {
		return []*runtimev1.AgentTurnContextTruncationSummary{{Reason: runtimev1.AgentTurnContextTruncationReason_AGENT_TURN_CONTEXT_TRUNCATION_REASON_NONE}}
	}
	return []*runtimev1.AgentTurnContextTruncationSummary{{
		Reason:             runtimev1.AgentTurnContextTruncationReason_AGENT_TURN_CONTEXT_TRUNCATION_REASON_INPUT_BUDGET_EXHAUSTED,
		OmittedItemCount:   omitted,
		TruncatedItemCount: truncated,
	}}
}

func agentTurnContextProtoLaneID(laneID agentTurnContextLaneID) runtimev1.AgentTurnContextLaneId {
	switch laneID {
	case agentTurnContextLaneRuntimePolicy:
		return runtimev1.AgentTurnContextLaneId_AGENT_TURN_CONTEXT_LANE_ID_RUNTIME_POLICY
	case agentTurnContextLaneOutputContract:
		return runtimev1.AgentTurnContextLaneId_AGENT_TURN_CONTEXT_LANE_ID_OUTPUT_CONTRACT
	case agentTurnContextLaneSourceIdentity:
		return runtimev1.AgentTurnContextLaneId_AGENT_TURN_CONTEXT_LANE_ID_SOURCE_IDENTITY
	case agentTurnContextLaneSourceBehavior:
		return runtimev1.AgentTurnContextLaneId_AGENT_TURN_CONTEXT_LANE_ID_SOURCE_BEHAVIOR
	case agentTurnContextLaneWorldContext:
		return runtimev1.AgentTurnContextLaneId_AGENT_TURN_CONTEXT_LANE_ID_WORLD_CONTEXT
	case agentTurnContextLaneRelationshipContext:
		return runtimev1.AgentTurnContextLaneId_AGENT_TURN_CONTEXT_LANE_ID_RELATIONSHIP_CONTEXT
	case agentTurnContextLaneSourceKnowledge:
		return runtimev1.AgentTurnContextLaneId_AGENT_TURN_CONTEXT_LANE_ID_SOURCE_KNOWLEDGE
	case agentTurnContextLaneCognitionSource:
		return runtimev1.AgentTurnContextLaneId_AGENT_TURN_CONTEXT_LANE_ID_COGNITION_SOURCE
	case agentTurnContextLaneConversationSummary:
		return runtimev1.AgentTurnContextLaneId_AGENT_TURN_CONTEXT_LANE_ID_CONVERSATION_SUMMARY
	case agentTurnContextLanePrivateRecall:
		return runtimev1.AgentTurnContextLaneId_AGENT_TURN_CONTEXT_LANE_ID_PRIVATE_RECALL
	case agentTurnContextLaneCanonicalMemory:
		return runtimev1.AgentTurnContextLaneId_AGENT_TURN_CONTEXT_LANE_ID_CANONICAL_MEMORY
	case agentTurnContextLaneConversationHistory:
		return runtimev1.AgentTurnContextLaneId_AGENT_TURN_CONTEXT_LANE_ID_CONVERSATION_HISTORY
	case agentTurnContextLaneCapabilityContext:
		return runtimev1.AgentTurnContextLaneId_AGENT_TURN_CONTEXT_LANE_ID_CAPABILITY_CONTEXT
	case agentTurnContextLaneCurrentUserTurn:
		return runtimev1.AgentTurnContextLaneId_AGENT_TURN_CONTEXT_LANE_ID_CURRENT_USER_TURN
	default:
		return runtimev1.AgentTurnContextLaneId_AGENT_TURN_CONTEXT_LANE_ID_UNSPECIFIED
	}
}

func agentTurnContextProtoLaneState(lane agentTurnContextLane) runtimev1.AgentTurnContextLaneState {
	if lane.TruncatedCount > 0 {
		return runtimev1.AgentTurnContextLaneState_AGENT_TURN_CONTEXT_LANE_STATE_TRUNCATED
	}
	if lane.IncludedItemCount > 0 {
		return runtimev1.AgentTurnContextLaneState_AGENT_TURN_CONTEXT_LANE_STATE_INCLUDED
	}
	if lane.OmittedItemCount > 0 {
		return runtimev1.AgentTurnContextLaneState_AGENT_TURN_CONTEXT_LANE_STATE_OMITTED
	}
	if len(lane.Items) == 0 {
		return runtimev1.AgentTurnContextLaneState_AGENT_TURN_CONTEXT_LANE_STATE_EMPTY
	}
	return runtimev1.AgentTurnContextLaneState_AGENT_TURN_CONTEXT_LANE_STATE_INVALID
}

func validateAgentTurnContextProjection(summary *runtimev1.AgentTurnContextSummary) error {
	if summary == nil || summary.GetSchemaVersion() != runtimev1.AgentTurnContextSummarySchemaVersion_AGENT_TURN_CONTEXT_SUMMARY_SCHEMA_VERSION_V2 {
		return fmt.Errorf("agent turn context bounded summary is invalid")
	}
	expectedIndex := 0
	for _, lane := range summary.GetLanes() {
		for expectedIndex < len(agentTurnContextFixedLaneOrder) && optionalAgentTurnContextLane(agentTurnContextFixedLaneOrder[expectedIndex]) && lane.GetLaneId() != agentTurnContextProtoLaneID(agentTurnContextFixedLaneOrder[expectedIndex]) {
			expectedIndex++
		}
		if expectedIndex >= len(agentTurnContextFixedLaneOrder) || lane.GetLaneId() != agentTurnContextProtoLaneID(agentTurnContextFixedLaneOrder[expectedIndex]) || lane.GetState() == runtimev1.AgentTurnContextLaneState_AGENT_TURN_CONTEXT_LANE_STATE_UNSPECIFIED || lane.GetState() == runtimev1.AgentTurnContextLaneState_AGENT_TURN_CONTEXT_LANE_STATE_INVALID {
			return fmt.Errorf("agent turn context bounded lane summary is invalid")
		}
		expectedIndex++
	}
	for expectedIndex < len(agentTurnContextFixedLaneOrder) && optionalAgentTurnContextLane(agentTurnContextFixedLaneOrder[expectedIndex]) {
		expectedIndex++
	}
	if expectedIndex != len(agentTurnContextFixedLaneOrder) {
		return fmt.Errorf("agent turn context bounded lane summary is incomplete")
	}
	return nil
}

func projectAgentConversationContextSummary(input agentTurnContextConversationSummaryManifestV1) *runtimev1.AgentConversationContextSummary {
	status := runtimev1.AgentConversationSummaryStatus_AGENT_CONVERSATION_SUMMARY_STATUS_UNSPECIFIED
	switch input.Status {
	case "absent":
		status = runtimev1.AgentConversationSummaryStatus_AGENT_CONVERSATION_SUMMARY_STATUS_ABSENT
	case "ready":
		status = runtimev1.AgentConversationSummaryStatus_AGENT_CONVERSATION_SUMMARY_STATUS_READY
	case "failed":
		status = runtimev1.AgentConversationSummaryStatus_AGENT_CONVERSATION_SUMMARY_STATUS_FAILED
	case "unavailable":
		status = runtimev1.AgentConversationSummaryStatus_AGENT_CONVERSATION_SUMMARY_STATUS_UNAVAILABLE
	case "omitted":
		status = runtimev1.AgentConversationSummaryStatus_AGENT_CONVERSATION_SUMMARY_STATUS_OMITTED
	}
	return &runtimev1.AgentConversationContextSummary{Status: status, Revision: input.Revision, CoveredSequenceStart: input.CoveredSequenceStart, CoveredSequenceEnd: input.CoveredSequenceEnd}
}

func projectAgentSourceCognitionSummary(input agentTurnContextCognitionManifestV1) *runtimev1.AgentSourceCognitionSummary {
	return &runtimev1.AgentSourceCognitionSummary{
		AdapterStatus:   projectAgentSourceCognitionStatus(input.AdapterStatus),
		SelectionStatus: projectAgentSourceCognitionStatus(input.SelectionStatus),
		Generation:      input.Generation, CandidateCount: input.CandidateCount,
		IncludedUnitCount: input.IncludedUnitCount, OmittedUnitCount: input.OmittedUnitCount,
	}
}

func projectAgentSourceCognitionStatus(status string) runtimev1.AgentSourceCognitionStatus {
	switch status {
	case "unconfigured":
		return runtimev1.AgentSourceCognitionStatus_AGENT_SOURCE_COGNITION_STATUS_UNCONFIGURED
	case "building":
		return runtimev1.AgentSourceCognitionStatus_AGENT_SOURCE_COGNITION_STATUS_BUILDING
	case "ready":
		return runtimev1.AgentSourceCognitionStatus_AGENT_SOURCE_COGNITION_STATUS_READY
	case "unavailable":
		return runtimev1.AgentSourceCognitionStatus_AGENT_SOURCE_COGNITION_STATUS_UNAVAILABLE
	case "failure":
		return runtimev1.AgentSourceCognitionStatus_AGENT_SOURCE_COGNITION_STATUS_FAILURE
	case "no_hits":
		return runtimev1.AgentSourceCognitionStatus_AGENT_SOURCE_COGNITION_STATUS_NO_HITS
	case "no_result":
		return runtimev1.AgentSourceCognitionStatus_AGENT_SOURCE_COGNITION_STATUS_NO_RESULT
	default:
		return runtimev1.AgentSourceCognitionStatus_AGENT_SOURCE_COGNITION_STATUS_UNSPECIFIED
	}
}
