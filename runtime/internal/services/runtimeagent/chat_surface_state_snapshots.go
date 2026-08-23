package runtimeagent

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func toPersistedPublicChatTurnSnapshot(input *publicChatTurnProjectionState) *persistedPublicChatTurnSnapshot {
	if input == nil {
		return nil
	}
	return &persistedPublicChatTurnSnapshot{
		TurnID:            input.TurnID,
		StreamID:          input.StreamID,
		Status:            input.Status,
		TraceID:           input.TraceID,
		StreamSequence:    input.StreamSequence,
		TimelineStartedAt: formatOptionalTime(input.TimelineStartedAt),
		Origin:            input.Origin,
		ChainID:           input.ChainID,
		FollowUpDepth:     input.FollowUpDepth,
		MaxFollowUpTurns:  input.MaxFollowUpTurns,
		SourceTurnID:      input.SourceTurnID,
		SourceActionID:    input.SourceActionID,
		ModelResolved:     input.ModelResolved,
		RouteDecision:     input.RouteDecision,
		OutputObserved:    input.OutputObserved,
		ReasoningObserved: input.ReasoningObserved,
		MessageID:         input.MessageID,
		AssistantText:     input.AssistantText,
		Structured:        clonePublicChatStructuredEnvelope(input.Structured),
		AssistantMemory:   clonePublicChatAssistantMemoryOutcome(input.AssistantMemory),
		Sidecar:           clonePublicChatSidecarOutcome(input.Sidecar),
		FollowUp:          clonePublicChatFollowUpOutcome(input.FollowUp),
		ContextSummary:    toPersistedAgentTurnContextSummary(input.ContextSummary),
		FinishReason:      input.FinishReason,
		StreamSimulated:   input.StreamSimulated,
		ReasonCode:        input.ReasonCode,
		ReasonCodeToken:   input.ReasonCodeToken,
		ActionHint:        input.ActionHint,
		Message:           input.Message,
		ActionStatus:      input.ActionStatus,
		ActionReasonCode:  input.ActionReasonCode,
		ActionMessage:     input.ActionMessage,
		UpdatedAt:         input.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func toPersistedAgentTurnContextSummary(input *runtimev1.AgentTurnContextSummary) *persistedAgentTurnContextSummary {
	if input == nil {
		return nil
	}
	return &persistedAgentTurnContextSummary{Summary: cloneAgentTurnContextSummary(input)}
}

func toPersistedPublicChatTurnSnapshotMap(input map[string]*publicChatTurnProjectionState) map[string]*persistedPublicChatTurnSnapshot {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]*persistedPublicChatTurnSnapshot, len(input))
	for key, projection := range input {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" && projection != nil {
			trimmedKey = strings.TrimSpace(projection.TurnID)
		}
		if trimmedKey == "" || projection == nil {
			continue
		}
		out[trimmedKey] = toPersistedPublicChatTurnSnapshot(projection)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func fromPersistedPublicChatTurnSnapshot(input *persistedPublicChatTurnSnapshot) *publicChatTurnProjectionState {
	if input == nil {
		return nil
	}
	updatedAt := time.Time{}
	if strings.TrimSpace(input.UpdatedAt) != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, input.UpdatedAt); err == nil {
			updatedAt = parsed.UTC()
		}
	}
	return &publicChatTurnProjectionState{
		TurnID:            input.TurnID,
		StreamID:          input.StreamID,
		Status:            input.Status,
		TraceID:           input.TraceID,
		StreamSequence:    input.StreamSequence,
		TimelineStartedAt: parseOptionalTime(input.TimelineStartedAt),
		Origin:            input.Origin,
		ChainID:           input.ChainID,
		FollowUpDepth:     input.FollowUpDepth,
		MaxFollowUpTurns:  input.MaxFollowUpTurns,
		SourceTurnID:      input.SourceTurnID,
		SourceActionID:    input.SourceActionID,
		ModelResolved:     input.ModelResolved,
		RouteDecision:     input.RouteDecision,
		OutputObserved:    input.OutputObserved,
		ReasoningObserved: input.ReasoningObserved,
		MessageID:         input.MessageID,
		AssistantText:     input.AssistantText,
		Structured:        clonePublicChatStructuredEnvelope(input.Structured),
		AssistantMemory:   clonePublicChatAssistantMemoryOutcome(input.AssistantMemory),
		Sidecar:           clonePublicChatSidecarOutcome(input.Sidecar),
		FollowUp:          clonePublicChatFollowUpOutcome(input.FollowUp),
		ContextSummary:    fromPersistedAgentTurnContextSummary(input.ContextSummary),
		FinishReason:      input.FinishReason,
		StreamSimulated:   input.StreamSimulated,
		ReasonCode:        input.ReasonCode,
		ReasonCodeToken:   input.ReasonCodeToken,
		ActionHint:        input.ActionHint,
		Message:           input.Message,
		ActionStatus:      input.ActionStatus,
		ActionReasonCode:  input.ActionReasonCode,
		ActionMessage:     input.ActionMessage,
		UpdatedAt:         updatedAt,
	}
}

func fromPersistedAgentTurnContextSummary(input *persistedAgentTurnContextSummary) *runtimev1.AgentTurnContextSummary {
	if input == nil {
		return nil
	}
	return cloneAgentTurnContextSummary(input.Summary)
}

func fromPersistedPublicChatTurnSnapshotMap(input map[string]*persistedPublicChatTurnSnapshot) map[string]*publicChatTurnProjectionState {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]*publicChatTurnProjectionState, len(input))
	for key, projection := range input {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" && projection != nil {
			trimmedKey = strings.TrimSpace(projection.TurnID)
		}
		if trimmedKey == "" || projection == nil {
			continue
		}
		out[trimmedKey] = fromPersistedPublicChatTurnSnapshot(projection)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
