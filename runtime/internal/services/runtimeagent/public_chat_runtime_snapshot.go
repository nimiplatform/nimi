package runtimeagent

import (
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func (r publicChatRuntime) buildSessionSnapshot(
	callerAppID string,
	anchorID string,
	requestID string,
) (*structpb.Struct, publicChatAnchorState, bool, bool, bool, error) {
	startedAt := time.Now()
	if r.svc == nil || r.svc.isClosed() {
		return nil, publicChatAnchorState{}, false, false, false, status.Error(codes.FailedPrecondition, "runtime public chat surface unavailable")
	}
	session, activeTurn, lastTurn, pendingFollowUp, err := r.svc.snapshotPublicChatAnchorForCaller(strings.TrimSpace(callerAppID), anchorID)
	if err != nil {
		return nil, publicChatAnchorState{}, false, false, false, err
	}
	return r.buildSessionSnapshotFromState(startedAt, callerAppID, requestID, session, activeTurn, lastTurn, pendingFollowUp)
}

func (r publicChatRuntime) buildScopedBindingSessionSnapshot(
	callerAppID string,
	anchorID string,
	requestID string,
) (*structpb.Struct, publicChatAnchorState, bool, bool, bool, error) {
	startedAt := time.Now()
	if r.svc == nil || r.svc.isClosed() {
		return nil, publicChatAnchorState{}, false, false, false, status.Error(codes.FailedPrecondition, "runtime public chat surface unavailable")
	}
	session, activeTurn, lastTurn, pendingFollowUp, err := r.svc.snapshotPublicChatAnchorForScopedBinding(anchorID)
	if err != nil {
		return nil, publicChatAnchorState{}, false, false, false, err
	}
	return r.buildSessionSnapshotFromState(startedAt, callerAppID, requestID, session, activeTurn, lastTurn, pendingFollowUp)
}

func (r publicChatRuntime) buildSessionSnapshotFromState(
	startedAt time.Time,
	callerAppID string,
	requestID string,
	session publicChatAnchorState,
	activeTurn *publicChatTurnProjectionState,
	lastTurn *publicChatTurnProjectionState,
	pendingFollowUp *publicChatFollowUpState,
) (*structpb.Struct, publicChatAnchorState, bool, bool, bool, error) {
	// Full public chat session snapshot is a unary query projection. Runtime
	// carrier execution truth (model_resolved, trace_id, transcript metadata,
	// follow-up state, etc.) lives in this snapshot, never on turn delta events.
	snapshotDetail := map[string]any{
		"thread_id":                session.ThreadID,
		"subject_user_id":          session.SubjectUserID,
		"session_status":           publicChatSessionStatus(activeTurn, pendingFollowUp),
		"transcript_message_count": len(session.Transcript),
		"transcript":               publicChatMessageEnvelopePayloads(session.Transcript),
		"execution_binding":        publicChatExecutionBindingProjectionPayload(session.Binding),
	}
	if trimmed := strings.TrimSpace(requestID); trimmed != "" {
		snapshotDetail["request_id"] = trimmed
	}
	if strings.TrimSpace(session.SystemPrompt) != "" {
		snapshotDetail["system_prompt"] = strings.TrimSpace(session.SystemPrompt)
	}
	if session.MaxTokens > 0 {
		snapshotDetail["max_output_tokens"] = session.MaxTokens
	}
	if reasoning := publicChatReasoningPayloadFromConfig(session.Reasoning); reasoning != nil {
		snapshotDetail["reasoning"] = map[string]any{
			"mode":          reasoning.Mode,
			"trace_mode":    reasoning.TraceMode,
			"budget_tokens": reasoning.BudgetTokens,
		}
	}
	if activeTurn != nil {
		snapshotDetail["active_turn"] = activeTurn.payload()
	}
	if lastTurn != nil {
		snapshotDetail["last_turn"] = lastTurn.payload()
	}
	if pendingFollowUp != nil {
		snapshotDetail["pending_follow_up"] = publicChatPendingFollowUpPayload(pendingFollowUp)
	}
	snapshot, err := structpb.NewStruct(snapshotDetail)
	if err != nil {
		return nil, publicChatAnchorState{}, false, false, false, status.Errorf(codes.Internal, "public chat session snapshot invalid: %v", err)
	}
	r.svc.observeCounter("runtime_agent_session_snapshot_query_total", 1,
		"caller_app_id", strings.TrimSpace(callerAppID),
		"agent_id", session.AgentID,
		"conversation_anchor_id", session.ConversationAnchorID,
		"request_id", strings.TrimSpace(requestID),
		"has_active_turn", activeTurn != nil,
		"has_last_turn", lastTurn != nil,
		"has_pending_follow_up", pendingFollowUp != nil,
	)
	r.svc.observeLatency("runtime.agent.session.snapshot_query_ms", startedAt,
		"caller_app_id", strings.TrimSpace(callerAppID),
		"agent_id", session.AgentID,
		"conversation_anchor_id", session.ConversationAnchorID,
		"request_id", strings.TrimSpace(requestID),
		"has_active_turn", activeTurn != nil,
		"has_last_turn", lastTurn != nil,
		"has_pending_follow_up", pendingFollowUp != nil,
	)
	return snapshot, session, activeTurn != nil, lastTurn != nil, pendingFollowUp != nil, nil
}
