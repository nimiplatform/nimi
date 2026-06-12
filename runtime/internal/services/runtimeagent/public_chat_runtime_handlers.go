package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
		return status.Error(codes.FailedPrecondition, "runtime public chat surface unavailable")
	}
	callerAppID := strings.TrimSpace(event.GetFromAppId())
	subjectUserID := strings.TrimSpace(event.GetSubjectUserId())
	if err := r.svc.cancelPublicChatFollowUpsForRequest(callerAppID, strings.TrimSpace(req.ConversationAnchorID), strings.TrimSpace(req.ThreadID), "user_message"); err != nil {
		return err
	}
	session, turn, turnCtx, err := r.reserveTurn(ctx, callerAppID, subjectUserID, req)
	if err != nil {
		return err
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
		return err
	}
	requestID := strings.TrimSpace(req.RequestID)
	if requestID == "" {
		requestID = strings.TrimSpace(event.GetMessageId())
	}
	r.svc.setPublicChatTurnRequestID(turn.TurnID, requestID)
	turn.RequestID = requestID
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnAcceptedType, publicChatAcceptedDetail(requestID)); err != nil {
		return err
	}
	released = true
	if !r.svc.startPublicChatAsync(func() {
		r.runTurn(turnCtx, session, turn, req)
	}) {
		r.releaseTurn(session.ConversationAnchorID, turn.TurnID)
		return status.Error(codes.FailedPrecondition, "runtime public chat surface unavailable")
	}
	return nil
}

func (r publicChatRuntime) handleTurnInterrupt(
	event *runtimev1.AppMessageEvent,
	req publicChatTurnInterruptPayload,
) error {
	session, turn, err := r.lookupTurnForInterrupt(strings.TrimSpace(event.GetFromAppId()), req)
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
