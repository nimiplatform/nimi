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
		SchemaVersion:              runtimev1.AgentTurnContextSummarySchemaVersion_AGENT_TURN_CONTEXT_SUMMARY_SCHEMA_VERSION_V1,
		Ready:                      true,
		State:                      runtimev1.AgentTurnContextState_AGENT_TURN_CONTEXT_STATE_READY,
		ReasonCode:                 runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_NONE,
		ManifestSchemaVersion:      runtimev1.AgentTurnContextManifestSchemaVersion_AGENT_TURN_CONTEXT_MANIFEST_SCHEMA_VERSION_V1,
		CompilerSchemaVersion:      runtimev1.AgentTurnContextCompilerSchemaVersion_AGENT_TURN_CONTEXT_COMPILER_SCHEMA_VERSION_V1,
		ManifestInstanceHash:       manifest.ManifestInstanceHash,
		ContextContentHash:         manifest.ContextContentHash,
		PromptHash:                 manifest.PromptHash,
		SourceSnapshotHash:         manifest.SourceSnapshotHash,
		SourceRef:                  sourceMaterializationProtoRefFromSnapshot(manifest.SourceRef),
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
	}
}

func projectAgentTurnContextCapacityFailure(input agentTurnContextCompileInput, lanes []agentTurnContextLane, budget agentTurnContextBudgetManifestV1, toolCount uint32) *runtimev1.AgentTurnContextSummary {
	return &runtimev1.AgentTurnContextSummary{
		SchemaVersion:              runtimev1.AgentTurnContextSummarySchemaVersion_AGENT_TURN_CONTEXT_SUMMARY_SCHEMA_VERSION_V1,
		Ready:                      false,
		State:                      runtimev1.AgentTurnContextState_AGENT_TURN_CONTEXT_STATE_CONTEXT_CAPACITY_EXCEEDED,
		ReasonCode:                 runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_CAPACITY_EXCEEDED,
		ManifestSchemaVersion:      runtimev1.AgentTurnContextManifestSchemaVersion_AGENT_TURN_CONTEXT_MANIFEST_SCHEMA_VERSION_V1,
		CompilerSchemaVersion:      runtimev1.AgentTurnContextCompilerSchemaVersion_AGENT_TURN_CONTEXT_COMPILER_SCHEMA_VERSION_V1,
		SourceSnapshotHash:         input.Snapshot.SnapshotHash,
		SourceRef:                  sourceMaterializationProtoRefFromSnapshot(input.Snapshot.SourceRef),
		WorldContentHash:           input.Snapshot.OwningWorld.ContentHash,
		MaterializationContextHash: input.Snapshot.MaterializationContextHash,
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
	return &runtimev1.AgentTurnContextBudgetSummary{
		ContextWindowTokens:   budget.ContextWindowTokens,
		ReservedOutputTokens:  budget.ReservedOutputTokens,
		ReservedSafetyTokens:  budget.ReservedSafetyTokens,
		ReservedAdapterTokens: budget.ReservedAdapterTokens,
		InputBudgetTokens:     budget.InputBudgetTokens,
		UsedTokens:            budget.UsedTokens,
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
	if summary == nil || summary.GetSchemaVersion() != runtimev1.AgentTurnContextSummarySchemaVersion_AGENT_TURN_CONTEXT_SUMMARY_SCHEMA_VERSION_V1 || len(summary.GetLanes()) != len(agentTurnContextFixedLaneOrder) {
		return fmt.Errorf("agent turn context bounded summary is invalid")
	}
	for index, lane := range summary.GetLanes() {
		if lane.GetLaneId() != agentTurnContextProtoLaneID(agentTurnContextFixedLaneOrder[index]) || lane.GetState() == runtimev1.AgentTurnContextLaneState_AGENT_TURN_CONTEXT_LANE_STATE_UNSPECIFIED || lane.GetState() == runtimev1.AgentTurnContextLaneState_AGENT_TURN_CONTEXT_LANE_STATE_INVALID {
			return fmt.Errorf("agent turn context bounded lane summary is invalid")
		}
	}
	return nil
}
