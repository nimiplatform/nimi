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
	_, err := r.handleTurnRequestWithID(ctx, event, req)
	return err
}

func (r publicChatRuntime) handleTurnRequestWithID(
	ctx context.Context,
	event *runtimev1.AppMessageEvent,
	req publicChatTurnRequestPayload,
) (string, error) {
	reserveStartedAt := time.Now()
	if r.svc == nil || !r.svc.HasPublicChatTurnExecutor() || !r.svc.HasPublicChatBindingResolver() || r.svc.chatAppEmit == nil {
		return "", publicChatDiagnosticError(
			status.Error(codes.FailedPrecondition, "runtime public chat surface unavailable"),
			"runtime_agent_public_chat_surface",
		)
	}
	callerAppID := strings.TrimSpace(event.GetFromAppId())
	subjectUserID := strings.TrimSpace(event.GetSubjectUserId())
	if req.RequestID == "" {
		req.RequestID = strings.TrimSpace(event.GetMessageId())
	}
	if req.resolvedAttachments == nil {
		resolvedAttachments, err := r.svc.resolvePublicChatTurnAttachments(subjectUserID, callerAppID, req.Messages)
		if err != nil {
			return "", publicChatDiagnosticError(err, "runtime_agent_public_chat_turn_attachment")
		}
		req.resolvedAttachments = resolvedAttachments
	}
	session, turn, turnCtx, err := r.reserveTurn(ctx, callerAppID, subjectUserID, req)
	if err != nil {
		return "", publicChatDiagnosticError(err, "runtime_agent_public_chat_turn_reserve")
	}
	if turn.AdmissionReused {
		return turn.TurnID, nil
	}
	if canceled := turn.CanceledFollowUp; canceled != nil {
		if canceled.Cancel != nil {
			canceled.Cancel()
		}
		if err := r.svc.emitPublicChatFollowUpCanceled(*canceled, "user_message", runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, "", ""); err != nil && r.svc.logger != nil {
			r.svc.logger.Warn("publish admitted continuation cancellation failed", "turn_id", turn.TurnID, "error", err)
		}
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
	failAccepted := func(stage string, failure error) (string, error) {
		if r.svc.logger != nil {
			r.svc.logger.Warn("admitted conversation could not start", "turn_id", turn.TurnID, "stage", stage, "error", failure)
		}
		r.failUncommittedPublicChatTurn(session, turn, "", session.Binding.ModelID, session.Binding.RoutePolicy, nil, nil, nil, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE, "Your input was saved, but the reply could not start.")
		return turn.TurnID, nil
	}
	if err := r.setExecutionStateWithOrigin(
		session.AgentID,
		session.SubjectUserID,
		strings.TrimSpace(req.WorldID),
		runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE,
		turnOrigin,
	); err != nil {
		return failAccepted("execution_state", err)
	}
	requestID := strings.TrimSpace(req.RequestID)
	if requestID == "" {
		requestID = strings.TrimSpace(event.GetMessageId())
	}
	r.svc.setPublicChatTurnRequestID(turn.TurnID, requestID)
	turn.RequestID = requestID
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnAcceptedType, publicChatAcceptedDetail(requestID)); err != nil {
		return failAccepted("accepted_emit", err)
	}
	if !r.svc.startPublicChatAsync(func() {
		r.runTurn(turnCtx, session, turn, req)
	}) {
		return failAccepted("async_start", status.Error(codes.FailedPrecondition, "runtime public chat surface unavailable"))
	}
	released = true
	return turn.TurnID, nil
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
	_, err := r.handleTurnInterruptWithID(event, req)
	return err
}

func (r publicChatRuntime) handleTurnInterruptWithID(
	event *runtimev1.AppMessageEvent,
	req publicChatTurnInterruptPayload,
) (string, error) {
	session, turn, err := r.lookupTurnForInterrupt(
		strings.TrimSpace(event.GetFromAppId()),
		strings.TrimSpace(event.GetSubjectUserId()),
		req,
	)
	if err != nil {
		if req.ExpectedTurnID != "" && status.Code(err) == codes.NotFound {
			return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_TURN_NOT_ACTIVE)
		}
		return "", err
	}
	reason, err := normalizePublicChatCancellationReason(req.Reason)
	if err != nil {
		return "", err
	}
	var cancel context.CancelFunc
	var ack map[string]any
	var ackErr error
	r.svc.chatSurfaceMu.Lock()
	// @nimi-authority: rule.nimi.runtime.agent-participation.r175
	// Compare and interrupt under the same owner lock. A snapshot at the App
	// cannot fence another App starting a later turn before this RPC arrives.
	if req.ExpectedTurnID != "" {
		anchor := r.svc.chatAnchors[session.ConversationAnchorID]
		current := r.svc.chatTurns[turn.TurnID]
		if anchor == nil || turn.TurnID != req.ExpectedTurnID || current == nil || current.ConversationAnchorID != anchor.ConversationAnchorID || current.Interrupted || current.TerminalProjection != nil {
			r.svc.chatSurfaceMu.Unlock()
			return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_TURN_NOT_ACTIVE)
		}
	}
	current := r.svc.chatTurns[turn.TurnID]
	if current == nil {
		r.svc.chatSurfaceMu.Unlock()
		return "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AGENT_TURN_NOT_ACTIVE)
	}
	current.Interrupted = true
	current.InterruptReason = reason
	cancel = current.Cancel
	// Capture the real accepted turn, sequence and timeline before cancellation
	// can finish execution and release its live entry. This does no I/O.
	sequence := r.svc.nextPublicChatStreamSequenceLocked(turn.TurnID)
	turn = *current
	timeline, timelineErr := publicChatBuildTimelineEnvelope(turn, publicChatTurnInterruptAckType, sequence, time.Now())
	ackErr = timelineErr
	ack = map[string]any{
		"conversation_anchor_id": session.ConversationAnchorID,
		"turn_id":                turn.TurnID,
		"stream_id":              turn.StreamID,
		"timeline":               timeline,
		"detail":                 map[string]any{"interrupted_turn_id": turn.TurnID},
	}
	r.svc.chatSurfaceMu.Unlock()
	// Once the owner accepts Stop, cancellation must not depend on saving or
	// publishing its acknowledgement. No service lock is held by the callback.
	if cancel != nil {
		cancel()
	}
	r.svc.persistCurrentPublicChatSurfaceState(session.ConversationAnchorID)
	if ackErr != nil {
		return "", ackErr
	}
	if err := r.emitEvent(firstNonEmpty(turn.SubjectUserID, session.SubjectUserID), publicChatTurnInterruptAckType, ack); err != nil {
		return "", err
	}
	return turn.TurnID, nil
}
