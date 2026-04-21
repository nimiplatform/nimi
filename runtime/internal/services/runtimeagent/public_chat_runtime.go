package runtimeagent

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type publicChatRuntime struct {
	svc *Service
}

func (s *Service) publicChatRuntime() publicChatRuntime {
	return publicChatRuntime{svc: s}
}

func (r publicChatRuntime) consumeAppMessage(ctx context.Context, event *runtimev1.AppMessageEvent) error {
	if r.svc == nil || r.svc.isClosed() {
		return status.Error(codes.FailedPrecondition, "runtime public chat surface unavailable")
	}
	if event == nil {
		return status.Error(codes.InvalidArgument, "public chat app message is required")
	}
	if strings.TrimSpace(event.GetToAppId()) != publicChatRuntimeAppID {
		return status.Error(codes.InvalidArgument, "public chat app message target invalid")
	}
	switch strings.TrimSpace(event.GetMessageType()) {
	case publicChatTurnRequestType:
		req, err := decodePublicChatTurnRequestPayload(event.GetPayload())
		if err != nil {
			return err
		}
		return r.handleTurnRequest(ctx, event, req)
	case publicChatTurnInterruptType:
		req, err := decodePublicChatTurnInterruptPayload(event.GetPayload())
		if err != nil {
			return err
		}
		return r.handleTurnInterrupt(event, req)
	case publicChatSessionSnapshotRequestType:
		req, err := decodePublicChatSessionSnapshotRequestPayload(event.GetPayload())
		if err != nil {
			return err
		}
		return r.handleSessionSnapshotRequest(event, req)
	default:
		return status.Error(codes.InvalidArgument, "public chat app message type invalid")
	}
}

func (r publicChatRuntime) handleTurnRequest(
	ctx context.Context,
	event *runtimev1.AppMessageEvent,
	req publicChatTurnRequestPayload,
) error {
	if r.svc == nil || !r.svc.HasPublicChatTurnExecutor() || !r.svc.HasPublicChatBindingResolver() || r.svc.chatAppEmit == nil {
		return status.Error(codes.FailedPrecondition, "runtime public chat surface unavailable")
	}
	callerAppID := strings.TrimSpace(event.GetFromAppId())
	subjectUserID := strings.TrimSpace(event.GetSubjectUserId())
	r.svc.cancelPublicChatFollowUpsForRequest(callerAppID, strings.TrimSpace(req.SessionID), strings.TrimSpace(req.ThreadID), "user_message")
	session, turn, turnCtx, err := r.reserveTurn(ctx, callerAppID, subjectUserID, req)
	if err != nil {
		return err
	}
	released := false
	defer func() {
		if released {
			return
		}
		r.releaseTurn(session.SessionID, turn.TurnID)
		_ = r.setExecutionState(session.AgentID, "", "", runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE)
	}()
	if err := r.setExecutionState(
		session.AgentID,
		session.SubjectUserID,
		strings.TrimSpace(req.WorldID),
		runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE,
	); err != nil {
		return err
	}
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnAcceptedType, publicChatAcceptedPayload(session)); err != nil {
		return err
	}
	released = true
	go r.runTurn(turnCtx, session, turn, req)
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
	var cancel context.CancelFunc
	r.svc.chatSurfaceMu.Lock()
	if current := r.svc.chatTurns[turn.TurnID]; current != nil {
		current.Interrupted = true
		current.InterruptReason = firstNonEmpty(strings.TrimSpace(req.Reason), "interrupt_requested")
		cancel = current.Cancel
	}
	r.svc.chatSurfaceMu.Unlock()
	r.svc.persistCurrentPublicChatSurfaceState()
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnInterruptAckType, map[string]any{
		"accepted":      true,
		"interrupt_for": firstNonEmpty(strings.TrimSpace(req.Reason), "interrupt_requested"),
	}); err != nil {
		return err
	}
	if cancel != nil {
		cancel()
	}
	return nil
}

func (r publicChatRuntime) handleSessionSnapshotRequest(
	event *runtimev1.AppMessageEvent,
	req publicChatSessionSnapshotRequestPayload,
) error {
	if r.svc == nil || r.svc.isClosed() || r.svc.chatAppEmit == nil {
		return status.Error(codes.FailedPrecondition, "runtime public chat surface unavailable")
	}
	session, activeTurn, lastTurn, pendingFollowUp, err := r.svc.snapshotPublicChatSessionForCaller(strings.TrimSpace(event.GetFromAppId()), req.SessionID)
	if err != nil {
		return err
	}
	payload := map[string]any{
		"agent_id":                 session.AgentID,
		"session_id":               session.SessionID,
		"thread_id":                session.ThreadID,
		"subject_user_id":          session.SubjectUserID,
		"session_status":           publicChatSessionStatus(activeTurn, pendingFollowUp),
		"transcript_message_count": len(session.Transcript),
		"execution_binding":        publicChatExecutionBindingProjectionPayload(session.Binding),
	}
	if trimmed := strings.TrimSpace(req.RequestID); trimmed != "" {
		payload["request_id"] = trimmed
	}
	if strings.TrimSpace(session.SystemPrompt) != "" {
		payload["system_prompt"] = strings.TrimSpace(session.SystemPrompt)
	}
	if session.MaxTokens > 0 {
		payload["max_output_tokens"] = session.MaxTokens
	}
	if reasoning := publicChatReasoningPayloadFromConfig(session.Reasoning); reasoning != nil {
		payload["reasoning"] = map[string]any{
			"mode":          reasoning.Mode,
			"trace_mode":    reasoning.TraceMode,
			"budget_tokens": reasoning.BudgetTokens,
		}
	}
	if activeTurn != nil {
		payload["active_turn"] = activeTurn.payload()
	}
	if lastTurn != nil {
		payload["last_turn"] = lastTurn.payload()
	}
	if pendingFollowUp != nil {
		payload["pending_follow_up"] = publicChatPendingFollowUpPayload(pendingFollowUp)
	}
	return r.emitEvent(session.CallerAppID, session.SubjectUserID, publicChatSessionSnapshotType, payload)
}

func (r publicChatRuntime) runTurn(
	ctx context.Context,
	session publicChatSessionState,
	turn publicChatTurnState,
	req publicChatTurnRequestPayload,
) {
	defer r.releaseTurn(session.SessionID, turn.TurnID)
	defer func() {
		if err := r.setExecutionState(session.AgentID, "", "", runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE); err != nil && r.svc.logger != nil {
			r.svc.logger.Warn("set public chat agent idle state failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
		}
	}()

	accumulatedText := &strings.Builder{}
	var usage *runtimev1.UsageStats
	var finish *runtimev1.ScenarioStreamCompleted
	var failed *runtimev1.ScenarioStreamFailed
	modelResolved := strings.TrimSpace(session.Binding.ModelID)
	routeDecision := session.Binding.RoutePolicy
	traceID := ""

	err := r.svc.currentPublicChatTurnExecutor().StreamChatTurn(ctx, &PublicChatTurnExecutionRequest{
		AppID:         publicChatRuntimeAppID,
		SubjectUserID: session.SubjectUserID,
		Messages:      toProtoPublicChatMessages(req.Messages),
		SystemPrompt:  strings.TrimSpace(req.SystemPrompt),
		MaxTokens:     req.MaxOutputTokens,
		Binding:       session.Binding,
		Reasoning:     normalizePublicChatReasoning(req.Reasoning),
	}, func(event *runtimev1.StreamScenarioEvent) error {
		if event == nil {
			return nil
		}
		if trimmedTraceID := strings.TrimSpace(event.GetTraceId()); trimmedTraceID != "" {
			traceID = trimmedTraceID
			r.svc.recordPublicChatTraceID(turn.TurnID, trimmedTraceID)
		}
		switch event.GetEventType() {
		case runtimev1.StreamEventType_STREAM_EVENT_STARTED:
			started := event.GetStarted()
			if started != nil {
				modelResolved = strings.TrimSpace(started.GetModelResolved())
				routeDecision = started.GetRouteDecision()
			}
			r.svc.mutatePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
				projection.Status = publicChatTurnStatusStarted
				projection.TraceID = traceID
				projection.ModelResolved = modelResolved
				projection.RouteDecision = routeDecision
			})
			return r.emitTurnEvent(session, turn.TurnID, publicChatTurnStartedType, map[string]any{
				"trace_id":       traceID,
				"model_resolved": modelResolved,
				"route_decision": publicChatRouteLabel(routeDecision),
			})
		case runtimev1.StreamEventType_STREAM_EVENT_DELTA:
			delta := event.GetDelta()
			if delta == nil {
				return nil
			}
			switch item := delta.GetDelta().(type) {
			case *runtimev1.ScenarioStreamDelta_Text:
				textDelta := item.Text.GetText()
				if textDelta == "" {
					return nil
				}
				accumulatedText.WriteString(textDelta)
				r.svc.mutatePublicChatTurnProjection(turn.TurnID, false, func(projection *publicChatTurnProjectionState) {
					projection.Status = publicChatTurnStatusStreaming
					projection.TraceID = traceID
					projection.OutputObserved = true
				})
				return r.emitTurnEvent(session, turn.TurnID, publicChatTurnTextDeltaType, map[string]any{
					"trace_id": traceID,
					"text":     textDelta,
				})
			case *runtimev1.ScenarioStreamDelta_Reasoning:
				reasoningDelta := item.Reasoning.GetText()
				if reasoningDelta == "" {
					return nil
				}
				r.svc.mutatePublicChatTurnProjection(turn.TurnID, false, func(projection *publicChatTurnProjectionState) {
					projection.Status = publicChatTurnStatusStreaming
					projection.TraceID = traceID
					projection.ReasoningObserved = true
				})
				return r.emitTurnEvent(session, turn.TurnID, publicChatTurnReasoningDeltaType, map[string]any{
					"trace_id": traceID,
					"text":     item.Reasoning.GetText(),
				})
			default:
				return nil
			}
		case runtimev1.StreamEventType_STREAM_EVENT_USAGE:
			if event.GetUsage() != nil {
				usage = proto.Clone(event.GetUsage()).(*runtimev1.UsageStats)
			}
			return nil
		case runtimev1.StreamEventType_STREAM_EVENT_COMPLETED:
			if event.GetCompleted() != nil {
				finish = proto.Clone(event.GetCompleted()).(*runtimev1.ScenarioStreamCompleted)
				if finish.GetUsage() != nil {
					usage = proto.Clone(finish.GetUsage()).(*runtimev1.UsageStats)
				}
			}
			return nil
		case runtimev1.StreamEventType_STREAM_EVENT_FAILED:
			if event.GetFailed() != nil {
				failed = proto.Clone(event.GetFailed()).(*runtimev1.ScenarioStreamFailed)
			}
			return nil
		default:
			return nil
		}
	})
	interrupted, interruptReason, lastTraceID := r.svc.publicChatInterruptStatus(turn.TurnID)
	if traceID == "" {
		traceID = lastTraceID
	}
	if err != nil {
		if interrupted || errors.Is(err, context.Canceled) {
			r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
				projection.Status = publicChatTurnStatusInterrupted
				projection.TraceID = traceID
				projection.ModelResolved = modelResolved
				projection.RouteDecision = routeDecision
				projection.ReasonCode = runtimev1.ReasonCode_AI_STREAM_BROKEN
				projection.Message = firstNonEmpty(interruptReason, "interrupt_requested")
			})
			r.emitTurnInterrupted(session, turn, traceID, modelResolved, routeDecision, firstNonEmpty(interruptReason, "interrupt_requested"))
			return
		}
		failure := runtimeErrorDetailFromError(err)
		r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
			projection.Status = publicChatTurnStatusFailed
			projection.TraceID = traceID
			projection.ModelResolved = modelResolved
			projection.RouteDecision = routeDecision
			projection.ReasonCode = failure.ReasonCode
			projection.ActionHint = failure.ActionHint
			projection.Message = failure.Message
		})
		r.emitTurnFailed(session, turn, traceID, modelResolved, routeDecision, failure.ReasonCode, failure.Message, failure.ActionHint)
		return
	}
	if interrupted {
		r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
			projection.Status = publicChatTurnStatusInterrupted
			projection.TraceID = traceID
			projection.ModelResolved = modelResolved
			projection.RouteDecision = routeDecision
			projection.ReasonCode = runtimev1.ReasonCode_AI_STREAM_BROKEN
			projection.Message = firstNonEmpty(interruptReason, "interrupt_requested")
		})
		r.emitTurnInterrupted(session, turn, traceID, modelResolved, routeDecision, firstNonEmpty(interruptReason, "interrupt_requested"))
		return
	}
	if failed != nil {
		r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
			projection.Status = publicChatTurnStatusFailed
			projection.TraceID = traceID
			projection.ModelResolved = modelResolved
			projection.RouteDecision = routeDecision
			projection.ReasonCode = failed.GetReasonCode()
			projection.ActionHint = strings.TrimSpace(failed.GetActionHint())
			projection.Message = "runtime public chat turn failed"
		})
		r.emitTurnFailed(session, turn, traceID, modelResolved, routeDecision, failed.GetReasonCode(), "runtime public chat turn failed", strings.TrimSpace(failed.GetActionHint()))
		return
	}
	if finish == nil {
		r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
			projection.Status = publicChatTurnStatusFailed
			projection.TraceID = traceID
			projection.ModelResolved = modelResolved
			projection.RouteDecision = routeDecision
			projection.ReasonCode = runtimev1.ReasonCode_AI_STREAM_BROKEN
			projection.Message = "runtime public chat turn ended without terminal completion"
		})
		r.emitTurnFailed(session, turn, traceID, modelResolved, routeDecision, runtimev1.ReasonCode_AI_STREAM_BROKEN, "runtime public chat turn ended without terminal completion", "")
		return
	}
	structured, parseErr := parsePublicChatStructuredEnvelope(accumulatedText.String())
	if parseErr != nil {
		r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
			projection.Status = publicChatTurnStatusFailed
			projection.TraceID = traceID
			projection.ModelResolved = modelResolved
			projection.RouteDecision = routeDecision
			projection.ReasonCode = runtimev1.ReasonCode_AI_OUTPUT_INVALID
			projection.Message = strings.TrimSpace(parseErr.Error())
		})
		r.emitTurnFailed(session, turn, traceID, modelResolved, routeDecision, runtimev1.ReasonCode_AI_OUTPUT_INVALID, parseErr.Error(), "")
		return
	}
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnStructuredType, map[string]any{
		"trace_id":   traceID,
		"structured": structured.payload(),
	}); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit public chat structured event failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
	}
	postTurnOutcome := r.applyPostTurn(ctx, session, turn, req, structured)
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnPostTurnType, map[string]any{
		"trace_id":         traceID,
		"assistant_memory": postTurnOutcome.AssistantMemory.payload(),
		"chat_sidecar":     postTurnOutcome.Sidecar.payload(),
		"follow_up":        postTurnOutcome.FollowUp.payload(),
	}); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit public chat post-turn event failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
	}
	r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
		projection.Status = publicChatTurnStatusCompleted
		projection.TraceID = traceID
		projection.ModelResolved = modelResolved
		projection.RouteDecision = routeDecision
		projection.OutputObserved = true
		projection.MessageID = structured.Message.MessageID
		projection.AssistantText = structured.Message.Text
		projection.Structured = clonePublicChatStructuredEnvelope(structured)
		projection.AssistantMemory = clonePublicChatAssistantMemoryOutcome(&postTurnOutcome.AssistantMemory)
		projection.Sidecar = clonePublicChatSidecarOutcome(&postTurnOutcome.Sidecar)
		projection.FollowUp = clonePublicChatFollowUpOutcome(&postTurnOutcome.FollowUp)
		projection.FinishReason = publicChatFinishReasonLabel(finish.GetFinishReason())
		projection.StreamSimulated = finish.GetStreamSimulated()
	})
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnCompletedType, map[string]any{
		"trace_id":         traceID,
		"text":             structured.Message.Text,
		"message_id":       structured.Message.MessageID,
		"finish_reason":    publicChatFinishReasonLabel(finish.GetFinishReason()),
		"stream_simulated": finish.GetStreamSimulated(),
		"usage":            usagePayload(usage),
		"model_resolved":   modelResolved,
		"route_decision":   publicChatRouteLabel(routeDecision),
	}); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit public chat completion failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
	}
}

func (r publicChatRuntime) reserveTurn(
	parent context.Context,
	callerAppID string,
	subjectUserID string,
	req publicChatTurnRequestPayload,
) (publicChatSessionState, publicChatTurnState, context.Context, error) {
	agentID := strings.TrimSpace(req.AgentID)
	if callerAppID == "" || agentID == "" {
		return publicChatSessionState{}, publicChatTurnState{}, nil, status.Error(codes.InvalidArgument, "public chat request requires caller app and agent id")
	}
	entry, err := r.svc.agentByID(agentID)
	if err != nil {
		return publicChatSessionState{}, publicChatTurnState{}, nil, err
	}
	if entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		return publicChatSessionState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "agent is not active")
	}

	sessionID := firstNonEmpty(strings.TrimSpace(req.SessionID), "agent_chat_session_"+ulid.Make().String())
	binding, hasBinding, err := r.svc.resolvePublicChatBinding(parent, subjectUserID, req)
	if err != nil {
		return publicChatSessionState{}, publicChatTurnState{}, nil, err
	}
	reasoning := normalizePublicChatReasoning(req.Reasoning)
	transcript := cloneChatMessages(toProtoPublicChatMessages(req.Messages))

	r.svc.chatSurfaceMu.Lock()
	if activeTurnID := strings.TrimSpace(r.svc.chatActiveByAgent[agentID]); activeTurnID != "" {
		if activeTurn := r.svc.chatTurns[activeTurnID]; activeTurn != nil {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatSessionState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "agent already has an active public chat turn")
		}
		delete(r.svc.chatActiveByAgent, agentID)
	}

	session := r.svc.chatSessions[sessionID]
	if session == nil {
		if !hasBinding {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatSessionState{}, publicChatTurnState{}, nil, status.Error(codes.InvalidArgument, "public chat request requires execution_binding for a new session")
		}
		session = &publicChatSessionState{
			SessionID:     sessionID,
			AgentID:       agentID,
			CallerAppID:   callerAppID,
			SubjectUserID: strings.TrimSpace(subjectUserID),
			ThreadID:      strings.TrimSpace(req.ThreadID),
			Binding:       binding,
			SystemPrompt:  strings.TrimSpace(req.SystemPrompt),
			MaxTokens:     req.MaxOutputTokens,
			Reasoning:     clonePublicChatReasoningConfig(reasoning),
			Transcript:    transcript,
		}
		r.svc.chatSessions[sessionID] = session
	} else {
		if session.CallerAppID != callerAppID {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatSessionState{}, publicChatTurnState{}, nil, status.Error(codes.PermissionDenied, "public chat session caller mismatch")
		}
		if session.AgentID != agentID {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatSessionState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat session agent mismatch")
		}
		if session.ActiveTurnID != "" {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatSessionState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat session already has an active turn")
		}
		if trimmed := strings.TrimSpace(subjectUserID); trimmed != "" &&
			strings.TrimSpace(session.SubjectUserID) != "" &&
			strings.TrimSpace(session.SubjectUserID) != trimmed {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatSessionState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat session subject_user_id mismatch")
		}
		if trimmed := strings.TrimSpace(req.ThreadID); trimmed != "" &&
			strings.TrimSpace(session.ThreadID) != "" &&
			strings.TrimSpace(session.ThreadID) != trimmed {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatSessionState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat session thread_id mismatch")
		}
		if hasBinding {
			if publicChatExecutionBindingMismatch(session.Binding, binding) {
				r.svc.chatSurfaceMu.Unlock()
				return publicChatSessionState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat session execution_binding mismatch")
			}
			session.Binding = binding
		}
		if session.Binding.ModelID == "" || session.Binding.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatSessionState{}, publicChatTurnState{}, nil, status.Error(codes.InvalidArgument, "public chat session requires execution_binding")
		}
		if trimmed := strings.TrimSpace(subjectUserID); trimmed != "" {
			session.SubjectUserID = trimmed
		}
		if trimmed := strings.TrimSpace(req.ThreadID); trimmed != "" {
			session.ThreadID = trimmed
		}
		if trimmed := strings.TrimSpace(req.SystemPrompt); trimmed != "" || session.SystemPrompt == "" {
			session.SystemPrompt = trimmed
		}
		if req.MaxOutputTokens > 0 || session.MaxTokens == 0 {
			session.MaxTokens = req.MaxOutputTokens
		}
		if reasoning != nil || session.Reasoning == nil {
			session.Reasoning = clonePublicChatReasoningConfig(reasoning)
		}
		if len(transcript) > 0 {
			session.Transcript = transcript
		}
	}

	if parent == nil {
		parent = context.Background()
	}
	turnID := "agent_turn_" + ulid.Make().String()
	turnCtx, cancel := context.WithCancel(parent)
	turn := &publicChatTurnState{
		SessionID:     session.SessionID,
		TurnID:        turnID,
		AgentID:       session.AgentID,
		CallerAppID:   session.CallerAppID,
		SubjectUserID: session.SubjectUserID,
		ThreadID:      session.ThreadID,
		Cancel:        cancel,
		Origin:        publicChatTurnOriginUser,
	}
	turn.Projection = newPublicChatTurnProjection(turn)
	session.ActiveTurnID = turnID
	session.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(turn.Projection)
	r.svc.chatTurns[turnID] = turn
	r.svc.chatActiveByAgent[agentID] = turnID
	snapshot := *session
	turnSnapshot := *turn
	r.svc.chatSurfaceMu.Unlock()
	r.svc.persistCurrentPublicChatSurfaceState()
	return snapshot, turnSnapshot, turnCtx, nil
}

func (r publicChatRuntime) releaseTurn(sessionID string, turnID string) {
	r.svc.chatSurfaceMu.Lock()
	turn := r.svc.chatTurns[strings.TrimSpace(turnID)]
	delete(r.svc.chatTurns, strings.TrimSpace(turnID))
	if session := r.svc.chatSessions[strings.TrimSpace(sessionID)]; session != nil && session.ActiveTurnID == strings.TrimSpace(turnID) {
		session.ActiveTurnID = ""
		session.ActiveTurnSnapshot = nil
	}
	if turn != nil && strings.TrimSpace(r.svc.chatActiveByAgent[turn.AgentID]) == strings.TrimSpace(turnID) {
		delete(r.svc.chatActiveByAgent, turn.AgentID)
	}
	r.svc.chatSurfaceMu.Unlock()
	r.svc.persistCurrentPublicChatSurfaceState()
}

func (r publicChatRuntime) lookupTurnForInterrupt(
	callerAppID string,
	req publicChatTurnInterruptPayload,
) (publicChatSessionState, publicChatTurnState, error) {
	sessionID := strings.TrimSpace(req.SessionID)
	if callerAppID == "" || sessionID == "" {
		return publicChatSessionState{}, publicChatTurnState{}, status.Error(codes.InvalidArgument, "public chat interrupt requires caller app and session id")
	}
	r.svc.chatSurfaceMu.Lock()
	defer r.svc.chatSurfaceMu.Unlock()
	session := r.svc.chatSessions[sessionID]
	if session == nil {
		return publicChatSessionState{}, publicChatTurnState{}, status.Error(codes.NotFound, "public chat session not found")
	}
	if session.CallerAppID != callerAppID {
		return publicChatSessionState{}, publicChatTurnState{}, status.Error(codes.PermissionDenied, "public chat session caller mismatch")
	}
	turnID := firstNonEmpty(strings.TrimSpace(req.TurnID), session.ActiveTurnID)
	turn := r.svc.chatTurns[turnID]
	if turn == nil {
		return publicChatSessionState{}, publicChatTurnState{}, status.Error(codes.NotFound, "public chat turn not found")
	}
	return *session, *turn, nil
}

func (r publicChatRuntime) setExecutionState(agentID string, subjectUserID string, worldID string, state runtimev1.AgentExecutionState) error {
	if r.svc == nil || r.svc.isClosed() {
		return nil
	}
	entry, err := r.svc.agentByID(strings.TrimSpace(agentID))
	if err != nil {
		return err
	}
	changed := false
	if entry.State.GetExecutionState() != state {
		entry.State.ExecutionState = state
		changed = true
	}
	if trimmed := strings.TrimSpace(subjectUserID); trimmed != "" && entry.State.GetActiveUserId() != trimmed {
		entry.State.ActiveUserId = trimmed
		changed = true
	}
	if trimmed := strings.TrimSpace(worldID); trimmed != "" && entry.State.GetActiveWorldId() != trimmed {
		entry.State.ActiveWorldId = trimmed
		changed = true
	}
	if !changed {
		return nil
	}
	entry.State.UpdatedAt = timestamppb.New(time.Now().UTC())
	return r.svc.updateAgent(entry)
}

func (r publicChatRuntime) emitTurnInterrupted(session publicChatSessionState, turn publicChatTurnState, traceID string, modelResolved string, routeDecision runtimev1.RoutePolicy, reason string) {
	payload := map[string]any{
		"trace_id": traceID,
		"reason":   firstNonEmpty(reason, "interrupt_requested"),
	}
	if trimmed := strings.TrimSpace(modelResolved); trimmed != "" {
		payload["model_resolved"] = trimmed
	}
	if routeDecision != runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		payload["route_decision"] = publicChatRouteLabel(routeDecision)
	}
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnInterruptedType, payload); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit public chat interrupted event failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
	}
}

func (r publicChatRuntime) emitTurnFailed(session publicChatSessionState, turn publicChatTurnState, traceID string, modelResolved string, routeDecision runtimev1.RoutePolicy, reasonCode runtimev1.ReasonCode, message string, actionHint string) {
	payload := map[string]any{
		"trace_id":    traceID,
		"reason_code": publicChatReasonCodeLabel(reasonCode),
		"message":     strings.TrimSpace(message),
	}
	if trimmed := strings.TrimSpace(actionHint); trimmed != "" {
		payload["action_hint"] = trimmed
	}
	if trimmed := strings.TrimSpace(modelResolved); trimmed != "" {
		payload["model_resolved"] = trimmed
	}
	if routeDecision != runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		payload["route_decision"] = publicChatRouteLabel(routeDecision)
	}
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnFailedType, payload); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit public chat failed event failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
	}
}

func (r publicChatRuntime) emitTurnEvent(session publicChatSessionState, turnID string, messageType string, payload map[string]any) error {
	out := map[string]any{
		"agent_id":        session.AgentID,
		"session_id":      session.SessionID,
		"turn_id":         strings.TrimSpace(turnID),
		"thread_id":       session.ThreadID,
		"stream_sequence": r.svc.nextPublicChatStreamSequence(turnID),
	}
	for key, value := range r.svc.publicChatTurnMetadataPayload(turnID) {
		out[key] = value
	}
	for key, value := range payload {
		out[key] = value
	}
	return r.emitEvent(session.CallerAppID, session.SubjectUserID, messageType, out)
}

func (r publicChatRuntime) emitEvent(callerAppID string, subjectUserID string, messageType string, payload map[string]any) error {
	if r.svc == nil || r.svc.isClosed() {
		return nil
	}
	if r.svc.chatAppEmit == nil {
		return fmt.Errorf("runtime public chat app emitter unavailable")
	}
	structPayload, err := structpb.NewStruct(payload)
	if err != nil {
		return err
	}
	_, err = r.svc.chatAppEmit(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId:     publicChatRuntimeAppID,
		ToAppId:       strings.TrimSpace(callerAppID),
		SubjectUserId: strings.TrimSpace(subjectUserID),
		MessageType:   strings.TrimSpace(messageType),
		Payload:       structPayload,
	})
	return err
}

func (r publicChatRuntime) shutdownSurface() {
	r.svc.chatSurfaceMu.Lock()
	turns := make([]*publicChatTurnState, 0, len(r.svc.chatTurns))
	for _, turn := range r.svc.chatTurns {
		if turn != nil {
			turns = append(turns, turn)
		}
	}
	followUps := make([]*publicChatFollowUpState, 0, len(r.svc.chatFollowUps))
	for _, followUp := range r.svc.chatFollowUps {
		if followUp != nil {
			followUps = append(followUps, followUp)
		}
	}
	r.svc.chatAppEmit = nil
	r.svc.chatSurfaceMu.Unlock()
	r.svc.setPublicChatTurnExecutor(nil)
	for _, turn := range turns {
		if turn.Cancel != nil {
			turn.Cancel()
		}
	}
	for _, followUp := range followUps {
		if followUp.Cancel != nil {
			followUp.Cancel()
		}
	}
}

func (r publicChatRuntime) applyPostTurn(
	ctx context.Context,
	session publicChatSessionState,
	turn publicChatTurnState,
	req publicChatTurnRequestPayload,
	structured *publicChatStructuredEnvelope,
) publicChatPostTurnOutcome {
	outcome := publicChatPostTurnOutcome{
		AssistantMemory: publicChatAssistantMemoryOutcome{Status: "skipped"},
		Sidecar:         publicChatSidecarOutcome{Status: "skipped"},
		FollowUp:        publicChatFollowUpOutcome{Status: "skipped"},
	}
	if structured == nil {
		return outcome
	}
	assistantText := strings.TrimSpace(structured.Message.Text)
	if strings.TrimSpace(assistantText) == "" {
		return outcome
	}
	r.svc.appendPublicChatAssistantMessage(session.SessionID, assistantText)
	outcome.AssistantMemory = r.applyAssistantTurnMemory(ctx, session, turn, assistantText)
	summary, err := r.svc.executeChatTrackSidecar(ctx, ChatTrackSidecarExecutionRequest{
		AgentID:       session.AgentID,
		SourceEventID: turn.TurnID,
		Messages: append(
			toProtoPublicChatMessages(req.Messages),
			&runtimev1.ChatMessage{
				Role:    "assistant",
				Content: assistantText,
			},
		),
	})
	if err != nil {
		outcome.Sidecar = publicChatSidecarOutcome{
			Status:     "failed",
			ReasonCode: reasonCodeFromError(err),
			Message:    strings.TrimSpace(err.Error()),
		}
	} else if summary == nil {
		outcome.Sidecar = publicChatSidecarOutcome{Status: "skipped"}
	} else {
		outcome.Sidecar = publicChatSidecarOutcome{
			Status:              "applied",
			AcceptedMemoryCount: summary.AcceptedMemoryCount,
			CanceledHookIDs:     append([]string(nil), summary.CanceledHookIDs...),
			ScheduledHookID:     summary.ScheduledHookID,
			StatusText:          summary.StatusText,
		}
	}
	outcome.FollowUp = r.svc.schedulePublicChatFollowUp(session, turn, req, structured)
	return outcome
}

func (r publicChatRuntime) applyAssistantTurnMemory(
	ctx context.Context,
	session publicChatSessionState,
	turn publicChatTurnState,
	assistantText string,
) publicChatAssistantMemoryOutcome {
	entry, err := r.svc.agentByID(session.AgentID)
	if err != nil {
		return publicChatAssistantMemoryOutcome{
			Status:     "failed",
			ReasonCode: reasonCodeFromError(err),
			Message:    strings.TrimSpace(err.Error()),
		}
	}
	userID := firstNonEmpty(session.SubjectUserID, entry.State.GetActiveUserId())
	if userID == "" || strings.TrimSpace(assistantText) == "" {
		return publicChatAssistantMemoryOutcome{Status: "skipped"}
	}
	now := time.Now().UTC()
	resp, err := r.svc.WriteAgentMemory(ctx, &runtimev1.WriteAgentMemoryRequest{
		AgentId: session.AgentID,
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			{
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC,
				TargetBank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
					Owner: &runtimev1.MemoryBankLocator_AgentDyadic{
						AgentDyadic: &runtimev1.AgentDyadicBankOwner{
							AgentId: session.AgentID,
							UserId:  userID,
						},
					},
				},
				SourceEventId: turn.TurnID,
				PolicyReason:  publicChatAssistantMemoryPolicy,
				Record: &runtimev1.MemoryRecordInput{
					Kind:           runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
					CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC,
					Provenance: &runtimev1.MemoryProvenance{
						SourceSystem:  publicChatAssistantMemorySource,
						SourceEventId: turn.TurnID,
						AuthorId:      session.AgentID,
						TraceId:       session.ThreadID,
						CommittedAt:   timestamppb.New(now),
					},
					Payload: &runtimev1.MemoryRecordInput_Observational{
						Observational: &runtimev1.ObservationalMemoryRecord{
							Observation: strings.TrimSpace(assistantText),
							ObservedAt:  timestamppb.New(now),
							SourceRef:   session.ThreadID,
						},
					},
				},
			},
		},
	})
	if err != nil {
		return publicChatAssistantMemoryOutcome{
			Status:     "failed",
			ReasonCode: reasonCodeFromError(err),
			Message:    strings.TrimSpace(err.Error()),
		}
	}
	outcome := publicChatAssistantMemoryOutcome{
		Status:        "applied",
		AcceptedCount: len(resp.GetAccepted()),
		RejectedCount: len(resp.GetRejected()),
	}
	if len(resp.GetAccepted()) == 0 && len(resp.GetRejected()) > 0 {
		outcome.Status = "rejected"
		outcome.ReasonCode = resp.GetRejected()[0].GetReasonCode()
		outcome.Message = strings.TrimSpace(resp.GetRejected()[0].GetMessage())
	}
	return outcome
}
