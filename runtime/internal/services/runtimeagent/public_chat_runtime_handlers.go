package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (r publicChatRuntime) handleTurnRequest(
	ctx context.Context,
	event *runtimev1.AppMessageEvent,
	req publicChatTurnRequestPayload,
) error {
	reserveStartedAt := time.Now()
	if r.svc == nil || !r.svc.HasPublicChatTurnExecutor() || !r.svc.HasPublicChatBindingResolver() || r.svc.chatAppEmit == nil {
		return publicChatDiagnosticError(
			status.Error(codes.FailedPrecondition, "runtime public chat surface unavailable"),
			"runtime_agent_public_chat_surface",
		)
	}
	callerAppID := strings.TrimSpace(event.GetFromAppId())
	subjectUserID := strings.TrimSpace(event.GetSubjectUserId())
	session, turn, turnCtx, err := r.reserveTurn(ctx, callerAppID, subjectUserID, req)
	if err != nil {
		return publicChatDiagnosticError(err, "runtime_agent_public_chat_turn_reserve")
	}
	// A new authenticated turn cancels only the pending continuation on the
	// exact anchor that reserveTurn just admitted. App id is a delivery origin,
	// not authorization; thread ids must never widen cancellation across
	// anchors, agents, or subjects.
	if _, err := r.svc.cancelPublicChatFollowUpForAnchor(session.ConversationAnchorID, "user_message", true); err != nil {
		r.releaseTurn(session.ConversationAnchorID, turn.TurnID)
		return publicChatDiagnosticError(err, "runtime_agent_public_chat_follow_up_cancel")
	}
	r.svc.observeLatency("runtime.agent.turn.reserve_ms", reserveStartedAt,
		"caller_app_id", callerAppID,
		"agent_id", session.AgentID,
		"conversation_anchor_id", session.ConversationAnchorID,
		"turn_id", turn.TurnID,
		"stream_id", turn.StreamID,
		"thread_id", session.ThreadID,
	)
	released := false
	turnOrigin := stateEventOrigin{
		ConversationAnchorID: session.ConversationAnchorID,
		OriginatingTurnID:    turn.TurnID,
		OriginatingStreamID:  turn.StreamID,
	}
	defer func() {
		if released {
			return
		}
		r.releaseTurn(session.ConversationAnchorID, turn.TurnID)
		_ = r.setExecutionStateWithOrigin(session.AgentID, "", "", runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE, turnOrigin)
	}()
	if err := r.setExecutionStateWithOrigin(
		session.AgentID,
		session.SubjectUserID,
		strings.TrimSpace(req.WorldID),
		runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE,
		turnOrigin,
	); err != nil {
		return publicChatDiagnosticError(err, "runtime_agent_public_chat_execution_state")
	}
	requestID := strings.TrimSpace(req.RequestID)
	if requestID == "" {
		requestID = strings.TrimSpace(event.GetMessageId())
	}
	r.svc.setPublicChatTurnRequestID(turn.TurnID, requestID)
	turn.RequestID = requestID
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnAcceptedType, publicChatAcceptedDetail(requestID)); err != nil {
		return publicChatDiagnosticError(err, "runtime_agent_public_chat_turn_accepted_emit")
	}
	released = true
	if !r.svc.startPublicChatAsync(func() {
		r.runTurn(turnCtx, session, turn, req)
	}) {
		r.releaseTurn(session.ConversationAnchorID, turn.TurnID)
		return publicChatDiagnosticError(
			status.Error(codes.FailedPrecondition, "runtime public chat surface unavailable"),
			"runtime_agent_public_chat_async_start",
		)
	}
	return nil
}

func publicChatDiagnosticError(err error, stage string) error {
	if err == nil {
		return nil
	}
	if metadata, ok := grpcerr.ExtractReasonMetadata(err); ok && strings.TrimSpace(metadata["diagnostic_stage"]) != "" {
		return err
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		reason = runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	diagnosticStage := strings.TrimSpace(stage)
	switch reason {
	case runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
		runtimev1.ReasonCode_AI_LOCAL_MODEL_PROFILE_MISSING,
		runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID,
		runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID:
		diagnosticStage += "." + strings.ToLower(reason.String())
	}
	return grpcerr.WrapWithReasonCode(
		status.Code(err),
		reason,
		err,
		grpcerr.ReasonOptions{
			Metadata: map[string]string{"diagnostic_stage": diagnosticStage},
		},
	)
}

func (r publicChatRuntime) handleTurnInterrupt(
	event *runtimev1.AppMessageEvent,
	req publicChatTurnInterruptPayload,
) error {
	session, turn, err := r.lookupTurnForInterrupt(
		strings.TrimSpace(event.GetFromAppId()),
		strings.TrimSpace(event.GetSubjectUserId()),
		req,
	)
	if err != nil {
		return err
	}
	reason, err := normalizePublicChatCancellationReason(req.Reason)
	if err != nil {
		return err
	}
	var cancel context.CancelFunc
	r.svc.chatSurfaceMu.Lock()
	if current := r.svc.chatTurns[turn.TurnID]; current != nil {
		current.Interrupted = true
		current.InterruptReason = reason
		cancel = current.Cancel
	}
	r.svc.chatSurfaceMu.Unlock()
	r.svc.persistCurrentPublicChatSurfaceState()
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnInterruptAckType, map[string]any{
		"interrupted_turn_id": turn.TurnID,
	}); err != nil {
		return err
	}
	if cancel != nil {
		cancel()
	}
	return nil
}
