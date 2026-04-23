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
	r.svc.cancelPublicChatFollowUpsForRequest(callerAppID, strings.TrimSpace(req.ConversationAnchorID), strings.TrimSpace(req.ThreadID), "user_message")
	session, turn, turnCtx, err := r.reserveTurn(ctx, callerAppID, subjectUserID, req)
	if err != nil {
		return err
	}
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
		"interrupted_turn_id": turn.TurnID,
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
	session, activeTurn, lastTurn, pendingFollowUp, err := r.svc.snapshotPublicChatAnchorForCaller(strings.TrimSpace(event.GetFromAppId()), req.ConversationAnchorID)
	if err != nil {
		return err
	}
	// K-AGCORE-037 session_envelope requires agent_id + conversation_anchor_id
	// at the envelope; per `runtime-agent-event-projection.yaml`
	// `session_events.runtime.agent.session.snapshot.detail.snapshot` is the
	// only admitted carrier for committed continuity / execution / follow-up
	// truth. Runtime carrier execution truth (model_resolved, trace_id,
	// transcript metadata, follow-up state, etc.) lives ONLY inside this
	// `detail.snapshot` projection — never on `runtime.agent.turn.*`.
	snapshotDetail := map[string]any{
		"thread_id":                session.ThreadID,
		"subject_user_id":          session.SubjectUserID,
		"session_status":           publicChatSessionStatus(activeTurn, pendingFollowUp),
		"transcript_message_count": len(session.Transcript),
		"transcript":               publicChatMessageEnvelopePayloads(session.Transcript),
		"execution_binding":        publicChatExecutionBindingProjectionPayload(session.Binding),
	}
	if trimmed := strings.TrimSpace(req.RequestID); trimmed != "" {
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
	payload := map[string]any{
		"agent_id":               session.AgentID,
		"conversation_anchor_id": session.ConversationAnchorID,
		"detail": map[string]any{
			"snapshot": snapshotDetail,
		},
	}
	return r.emitEvent(session.CallerAppID, session.SubjectUserID, publicChatSessionSnapshotType, payload)
}

func (r publicChatRuntime) runTurn(
	ctx context.Context,
	session publicChatAnchorState,
	turn publicChatTurnState,
	req publicChatTurnRequestPayload,
) {
	defer r.releaseTurn(session.ConversationAnchorID, turn.TurnID)
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
		AppID:         session.CallerAppID,
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
			// Per yaml `turn.started.detail` the only admitted field is
			// `track: enum(chat|life)`. trace_id / model_resolved /
			// route_decision are runtime execution truth and live on the
			// session.snapshot active_turn projection only.
			return r.emitTurnEvent(session, turn.TurnID, publicChatTurnStartedType, map[string]any{
				"track": publicChatTurnTrackLabel,
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
				// yaml `turn.text_delta.detail` admits only `text`. trace_id
				// is runtime-internal and is recovered through session.snapshot.
				return r.emitTurnEvent(session, turn.TurnID, publicChatTurnTextDeltaType, map[string]any{
					"text": textDelta,
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
				// yaml `turn.reasoning_delta.detail` admits only `text`.
				return r.emitTurnEvent(session, turn.TurnID, publicChatTurnReasoningDeltaType, map[string]any{
					"text": item.Reasoning.GetText(),
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
		if r.svc.logger != nil {
			r.svc.logger.Warn("public chat structured parse failed",
				"agent_id", session.AgentID,
				"turn_id", turn.TurnID,
				"trace_id", traceID,
				"model_resolved", modelResolved,
				"route_decision", routeDecision.String(),
				"error", parseErr,
			)
		}
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
	// yaml `turn.structured.detail` admits `kind` + `payload` only. The full
	// structured envelope lives under `payload`; the schema id is the
	// admitted `kind`. trace_id is recovered through session.snapshot.
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnStructuredType, map[string]any{
		"kind":    structured.SchemaID,
		"payload": structured.payload(),
	}); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit public chat structured event failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
	}
	// Project committed runtime interpretation into state+presentation per
	// K-AGCORE-037 / K-AGCORE-038: StatusCue.Mood is the committed emotion
	// update for this turn. emotion_changed carries real anchor/turn/stream
	// origin linkage (this IS a chat turn); presentation.expression_requested
	// is stream-scoped and uses the same identifiers. Mood is optional — when
	// absent, no presentation/emotion projection is synthesized.
	r.projectCommittedStatusCue(session, turn, structured)
	// K-AGCORE-039 commit point: emit `runtime.agent.turn.message_committed`
	// with the schema-compliant detail (`message_id`, `text`) and the
	// required `message_id` envelope extra per yaml `extra_fields_by_event`.
	// All `text_delta` slices preceding this commit point are provisional;
	// late-join consumers reconcile the committed text from this event.
	if err := r.emitTurnMessageCommitted(session, turn.TurnID, structured.Message.MessageID, structured.Message.Text); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit public chat message_committed event failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
	}
	postTurnOutcome := r.applyPostTurn(ctx, session, turn, req, structured)
	// yaml `turn.post_turn.detail` admits indication-only `action?` and
	// `hook_intent?`. Runtime execution truth (assistant_memory result,
	// chat_sidecar outcome, follow-up scheduling state, trace_id) lives on
	// `runtime.agent.session.snapshot.detail.snapshot.last_turn` only;
	// canonical hook lifecycle remains on `runtime.agent.hook.*`.
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnPostTurnType, publicChatPostTurnIndicationDetail(structured, postTurnOutcome.FollowUp)); err != nil && r.svc.logger != nil {
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
		if usage != nil {
			projection.Usage = proto.Clone(usage).(*runtimev1.UsageStats)
		}
	})
	// yaml `turn.completed.detail` admits only `terminal_reason?`. The
	// committed message text/message_id is on `turn.message_committed`;
	// usage / finish_reason / stream_simulated / model_resolved /
	// route_decision are runtime execution truth and live on
	// `session.snapshot.detail.snapshot.last_turn` only.
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnCompletedType, publicChatTurnCompletedDetail(finish.GetFinishReason())); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit public chat completion failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
	}
}

// reserveTurn binds a new turn to an existing ConversationAnchor. Per
// K-AGCORE-034/K-AGCORE-035 runtime MUST NOT implicitly create anchors from
// turn requests; `OpenConversationAnchor` is the only admitted anchor-open
// seam. An unknown `conversation_anchor_id` fails-closed with NotFound.
func (r publicChatRuntime) reserveTurn(
	parent context.Context,
	callerAppID string,
	subjectUserID string,
	req publicChatTurnRequestPayload,
) (publicChatAnchorState, publicChatTurnState, context.Context, error) {
	agentID := strings.TrimSpace(req.AgentID)
	anchorID := strings.TrimSpace(req.ConversationAnchorID)
	if callerAppID == "" || agentID == "" {
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.InvalidArgument, "public chat request requires caller app and agent id")
	}
	if anchorID == "" {
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.InvalidArgument, "public chat request requires conversation_anchor_id")
	}
	entry, err := r.svc.agentByID(agentID)
	if err != nil {
		return publicChatAnchorState{}, publicChatTurnState{}, nil, err
	}
	if entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "agent is not active")
	}

	binding, hasBinding, err := r.svc.resolvePublicChatBinding(parent, subjectUserID, req)
	if err != nil {
		return publicChatAnchorState{}, publicChatTurnState{}, nil, err
	}
	reasoning := normalizePublicChatReasoning(req.Reasoning)
	transcript := cloneChatMessages(toProtoPublicChatMessages(req.Messages))

	r.svc.chatSurfaceMu.Lock()
	if activeTurnID := strings.TrimSpace(r.svc.chatActiveByAgent[agentID]); activeTurnID != "" {
		if activeTurn := r.svc.chatTurns[activeTurnID]; activeTurn != nil {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "agent already has an active public chat turn")
		}
		delete(r.svc.chatActiveByAgent, agentID)
	}

	session := r.svc.chatAnchors[anchorID]
	if session == nil {
		// Hard fail: runtime.agent.turn.request must reference an existing
		// ConversationAnchor opened through OpenConversationAnchor.
		r.svc.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.NotFound, "conversation_anchor_id not found; open ConversationAnchor first")
	}
	if session.CallerAppID != callerAppID {
		r.svc.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.PermissionDenied, "public chat anchor caller mismatch")
	}
	if session.AgentID != agentID {
		r.svc.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat anchor agent mismatch")
	}
	if session.Status == runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_CLOSED {
		r.svc.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "conversation anchor is closed")
	}
	if session.ActiveTurnID != "" {
		r.svc.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat anchor already has an active turn")
	}
	if trimmed := strings.TrimSpace(subjectUserID); trimmed != "" &&
		strings.TrimSpace(session.SubjectUserID) != "" &&
		strings.TrimSpace(session.SubjectUserID) != trimmed {
		r.svc.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat anchor subject_user_id mismatch")
	}
	if trimmed := strings.TrimSpace(req.ThreadID); trimmed != "" &&
		strings.TrimSpace(session.ThreadID) != "" &&
		strings.TrimSpace(session.ThreadID) != trimmed {
		r.svc.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat anchor thread_id mismatch")
	}
	if hasBinding {
		if session.Binding.ModelID != "" && publicChatExecutionBindingMismatch(session.Binding, binding) {
			r.svc.chatSurfaceMu.Unlock()
			return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.FailedPrecondition, "public chat anchor execution_binding mismatch")
		}
		session.Binding = binding
	}
	if session.Binding.ModelID == "" || session.Binding.RoutePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		r.svc.chatSurfaceMu.Unlock()
		return publicChatAnchorState{}, publicChatTurnState{}, nil, status.Error(codes.InvalidArgument, "public chat anchor requires execution_binding")
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

	// Public chat turn execution is asynchronous relative to the ingress
	// app-message handler. The runtime-owned turn context must therefore not
	// inherit the handler/request lifetime; otherwise the handler returning can
	// cancel the turn before AI execution even starts and surface false
	// AI_PROVIDER_UNAVAILABLE failures from downstream scheduler/provider paths.
	parent = context.Background()
	turnID := "agent_turn_" + ulid.Make().String()
	streamID := "agent_stream_" + ulid.Make().String()
	turnCtx, cancel := context.WithCancel(parent)
	turn := &publicChatTurnState{
		ConversationAnchorID: session.ConversationAnchorID,
		TurnID:               turnID,
		StreamID:             streamID,
		AgentID:              session.AgentID,
		CallerAppID:          session.CallerAppID,
		SubjectUserID:        session.SubjectUserID,
		ThreadID:             session.ThreadID,
		Cancel:               cancel,
		Origin:               publicChatTurnOriginUser,
	}
	turn.Projection = newPublicChatTurnProjection(turn)
	session.ActiveTurnID = turnID
	session.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(turn.Projection)
	session.UpdatedAt = time.Now().UTC()
	r.svc.chatTurns[turnID] = turn
	r.svc.chatActiveByAgent[agentID] = turnID
	snapshot := *session
	turnSnapshot := *turn
	r.svc.chatSurfaceMu.Unlock()
	r.svc.persistCurrentPublicChatSurfaceState()
	return snapshot, turnSnapshot, turnCtx, nil
}

func (r publicChatRuntime) releaseTurn(anchorID string, turnID string) {
	r.svc.chatSurfaceMu.Lock()
	turn := r.svc.chatTurns[strings.TrimSpace(turnID)]
	delete(r.svc.chatTurns, strings.TrimSpace(turnID))
	if session := r.svc.chatAnchors[strings.TrimSpace(anchorID)]; session != nil && session.ActiveTurnID == strings.TrimSpace(turnID) {
		session.ActiveTurnID = ""
		session.ActiveTurnSnapshot = nil
		session.UpdatedAt = time.Now().UTC()
	}
	if turn != nil && strings.TrimSpace(r.svc.chatActiveByAgent[turn.AgentID]) == strings.TrimSpace(turnID) {
		delete(r.svc.chatActiveByAgent, turn.AgentID)
	}
	r.svc.chatSurfaceMu.Unlock()
	r.svc.persistCurrentPublicChatSurfaceState()
}

// lookupTurnForInterrupt resolves the anchor+turn pair targeted by an
// interrupt. Per K-AGCORE-035 interrupt semantics are anchor-scoped; only
// turns under the referenced `conversation_anchor_id` are candidates.
func (r publicChatRuntime) lookupTurnForInterrupt(
	callerAppID string,
	req publicChatTurnInterruptPayload,
) (publicChatAnchorState, publicChatTurnState, error) {
	anchorID := strings.TrimSpace(req.ConversationAnchorID)
	if callerAppID == "" || anchorID == "" {
		return publicChatAnchorState{}, publicChatTurnState{}, status.Error(codes.InvalidArgument, "public chat interrupt requires caller app and conversation_anchor_id")
	}
	r.svc.chatSurfaceMu.Lock()
	defer r.svc.chatSurfaceMu.Unlock()
	session := r.svc.chatAnchors[anchorID]
	if session == nil {
		return publicChatAnchorState{}, publicChatTurnState{}, status.Error(codes.NotFound, "conversation anchor not found")
	}
	if session.CallerAppID != callerAppID {
		return publicChatAnchorState{}, publicChatTurnState{}, status.Error(codes.PermissionDenied, "public chat anchor caller mismatch")
	}
	turnID := firstNonEmpty(strings.TrimSpace(req.TurnID), session.ActiveTurnID)
	turn := r.svc.chatTurns[turnID]
	if turn == nil {
		return publicChatAnchorState{}, publicChatTurnState{}, status.Error(codes.NotFound, "public chat turn not found")
	}
	// Anchor-scoped isolation: the resolved turn must live under the
	// referenced anchor. Different anchors under the same agent MUST NOT
	// share interrupt propagation by implication (K-AGCORE-035).
	if strings.TrimSpace(turn.ConversationAnchorID) != "" && turn.ConversationAnchorID != session.ConversationAnchorID {
		return publicChatAnchorState{}, publicChatTurnState{}, status.Error(codes.NotFound, "public chat turn not found under referenced anchor")
	}
	return *session, *turn, nil
}

// setExecutionState mutates committed execution-state truth and, when the
// execution state actually transitions, emits
// `runtime.agent.state.execution_state_changed` with optional origin linkage
// back to the anchor/turn/stream that caused the change. Per K-AGCORE-037
// state_envelope origin linkage is OPTIONAL and MUST be omitted when the
// transition has no real continuity branch (e.g. IDLE on shutdown).
func (r publicChatRuntime) setExecutionState(agentID string, subjectUserID string, worldID string, state runtimev1.AgentExecutionState) error {
	return r.setExecutionStateWithOrigin(agentID, subjectUserID, worldID, state, stateEventOrigin{})
}

func (r publicChatRuntime) setExecutionStateWithOrigin(agentID string, subjectUserID string, worldID string, state runtimev1.AgentExecutionState, origin stateEventOrigin) error {
	if r.svc == nil || r.svc.isClosed() {
		return nil
	}
	entry, err := r.svc.agentByID(strings.TrimSpace(agentID))
	if err != nil {
		return err
	}
	previousExecution := entry.State.GetExecutionState()
	executionChanged := false
	if previousExecution != state {
		entry.State.ExecutionState = state
		executionChanged = true
	}
	if trimmed := strings.TrimSpace(subjectUserID); trimmed != "" && entry.State.GetActiveUserId() != trimmed {
		entry.State.ActiveUserId = trimmed
	}
	if trimmed := strings.TrimSpace(worldID); trimmed != "" && entry.State.GetActiveWorldId() != trimmed {
		entry.State.ActiveWorldId = trimmed
	}
	if !executionChanged && strings.TrimSpace(subjectUserID) == "" && strings.TrimSpace(worldID) == "" {
		return nil
	}
	now := time.Now().UTC()
	entry.State.UpdatedAt = timestamppb.New(now)
	events := make([]*runtimev1.AgentEvent, 0, 1)
	if executionChanged {
		events = append(events, r.svc.stateExecutionStateChangedEvent(entry.Agent.GetAgentId(), state, previousExecution, origin, now))
	}
	return r.svc.updateAgent(entry, events...)
}

// emitTurnInterrupted projects yaml `turn.interrupted.detail.reason`.
// trace_id / model_resolved / route_decision belong to runtime execution
// truth and surface only via session.snapshot.detail.snapshot.last_turn.
func (r publicChatRuntime) emitTurnInterrupted(session publicChatAnchorState, turn publicChatTurnState, _ string, _ string, _ runtimev1.RoutePolicy, reason string) {
	payload := map[string]any{
		"reason": firstNonEmpty(reason, "interrupt_requested"),
	}
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnInterruptedType, payload); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit public chat interrupted event failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
	}
}

// emitTurnFailed projects yaml `turn.failed.detail` admitting only
// `reason_code` (required) and `message?`. action_hint / trace_id /
// model_resolved / route_decision are runtime execution truth and live
// on session.snapshot.detail.snapshot.last_turn only.
func (r publicChatRuntime) emitTurnFailed(session publicChatAnchorState, turn publicChatTurnState, _ string, _ string, _ runtimev1.RoutePolicy, reasonCode runtimev1.ReasonCode, message string, _ string) {
	payload := map[string]any{
		"reason_code": publicChatReasonCodeLabel(reasonCode),
	}
	if trimmed := strings.TrimSpace(message); trimmed != "" {
		payload["message"] = trimmed
	}
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnFailedType, payload); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit public chat failed event failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
	}
}

// projectCommittedStatusCue emits runtime.agent.state.emotion_changed and
// runtime.agent.presentation.expression_requested derived from the structured
// envelope's StatusCue once the turn has committed. Runtime MUST NOT emit
// presentation events without real stream identity; when origin linkage
// cannot be constructed the projection is skipped rather than fabricated.
func (r publicChatRuntime) projectCommittedStatusCue(session publicChatAnchorState, turn publicChatTurnState, structured *publicChatStructuredEnvelope) {
	if r.svc == nil || r.svc.isClosed() || structured == nil || structured.StatusCue == nil {
		return
	}
	mood := strings.TrimSpace(structured.StatusCue.Mood)
	if mood == "" {
		return
	}
	anchorID := strings.TrimSpace(session.ConversationAnchorID)
	turnID := strings.TrimSpace(turn.TurnID)
	streamID := strings.TrimSpace(turn.StreamID)
	if anchorID == "" || turnID == "" || streamID == "" {
		return
	}
	entry, err := r.svc.agentByID(strings.TrimSpace(session.AgentID))
	if err != nil {
		return
	}
	now := time.Now().UTC()
	origin := stateEventOrigin{
		ConversationAnchorID: anchorID,
		OriginatingTurnID:    turnID,
		OriginatingStreamID:  streamID,
	}
	previousEmotion := strings.TrimSpace(entry.State.GetCurrentEmotion())
	if previousEmotion == mood {
		// Already at this emotion; skip re-emission to preserve
		// durable-until-replace semantics per K-AGCORE-038.
		return
	}
	// K-AGCORE-038: current_emotion is durable runtime state. Commit it into
	// AgentStateProjection alongside the projection event so GetAgentState /
	// snapshot / recovery observe the same truth.
	entry.State.CurrentEmotion = mood
	entry.State.UpdatedAt = timestamppb.New(now)
	events := make([]*runtimev1.AgentEvent, 0, 2)
	events = append(events, r.svc.stateEmotionChangedEvent(
		entry.Agent.GetAgentId(),
		mood,
		previousEmotion,
		"chat_status_cue",
		origin,
		now,
	))
	presentationEvent, perr := r.svc.emitPresentationExpressionEvent(entry.Agent.GetAgentId(), anchorID, turnID, streamID, mood, 0, now)
	if perr != nil {
		if r.svc.logger != nil {
			r.svc.logger.Warn("skip presentation.expression_requested; envelope invalid", "agent_id", session.AgentID, "error", perr)
		}
	} else {
		events = append(events, presentationEvent)
	}
	if err := r.svc.updateAgent(entry, events...); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit runtime.agent.state+presentation from status cue failed", "agent_id", session.AgentID, "turn_id", turnID, "error", err)
	}
}

// emitTurnEvent composes the runtime.agent.turn.* envelope per
// K-AGCORE-037 / runtime-agent-event-projection.yaml `turn_envelope`:
// payload top level carries the required envelope fields (`agent_id`,
// `conversation_anchor_id`, `turn_id`, `stream_id`); event-specific
// fields live under `detail` per the mounted `turn_events.detail`
// schema. Runtime execution truth (model_resolved, trace_id,
// follow_up_depth, transcript metadata, etc.) is NOT carried on
// `runtime.agent.turn.*` projection events; it is recovered exclusively
// through `runtime.agent.session.snapshot.detail.snapshot`. Per
// K-AGCORE-030 stream identity is distinct from turn identity and is
// allocated at turn open onto `publicChatTurnState.StreamID`.
//
// Per yaml `extra_fields_by_event`, `runtime.agent.turn.message_committed`
// additionally carries `message_id` at envelope level; callers must
// emit it through emitTurnMessageCommitted, which sets that envelope
// extra explicitly rather than relying on detail merge.
func (r publicChatRuntime) emitTurnEvent(session publicChatAnchorState, turnID string, messageType string, detail map[string]any) error {
	trimmedTurnID := strings.TrimSpace(turnID)
	streamID := r.svc.publicChatTurnStreamID(trimmedTurnID)
	if streamID == "" {
		// Stream identity must be real per K-AGCORE-030; if lookup fails we
		// fail-closed rather than fabricate stream_id from turn_id.
		return status.Error(codes.FailedPrecondition, "runtime.agent.turn.* stream identity unavailable")
	}
	// Track stream sequence as runtime-private bookkeeping for the snapshot
	// projection only; do not surface as turn envelope/detail per yaml.
	r.svc.nextPublicChatStreamSequence(trimmedTurnID)
	out := map[string]any{
		"agent_id":               session.AgentID,
		"conversation_anchor_id": session.ConversationAnchorID,
		"turn_id":                trimmedTurnID,
		"stream_id":              streamID,
	}
	if detail == nil {
		out["detail"] = map[string]any{}
	} else {
		out["detail"] = detail
	}
	return r.emitEvent(session.CallerAppID, session.SubjectUserID, messageType, out)
}

// emitTurnMessageCommitted emits runtime.agent.turn.message_committed with
// the required `message_id` envelope extra (per
// runtime-agent-event-projection.yaml `extra_fields_by_event`) plus the
// committed message detail (`message_id`, `text`).
func (r publicChatRuntime) emitTurnMessageCommitted(session publicChatAnchorState, turnID string, messageID string, text string) error {
	trimmedTurnID := strings.TrimSpace(turnID)
	trimmedMessageID := strings.TrimSpace(messageID)
	if trimmedMessageID == "" {
		return status.Error(codes.FailedPrecondition, "runtime.agent.turn.message_committed requires message_id")
	}
	streamID := r.svc.publicChatTurnStreamID(trimmedTurnID)
	if streamID == "" {
		return status.Error(codes.FailedPrecondition, "runtime.agent.turn.* stream identity unavailable")
	}
	r.svc.nextPublicChatStreamSequence(trimmedTurnID)
	out := map[string]any{
		"agent_id":               session.AgentID,
		"conversation_anchor_id": session.ConversationAnchorID,
		"turn_id":                trimmedTurnID,
		"stream_id":              streamID,
		"message_id":             trimmedMessageID,
		"detail": map[string]any{
			"message_id": trimmedMessageID,
			"text":       strings.TrimSpace(text),
		},
	}
	return r.emitEvent(session.CallerAppID, session.SubjectUserID, publicChatTurnMessageCommittedType, out)
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
	session publicChatAnchorState,
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
	r.svc.appendPublicChatAssistantMessage(session.ConversationAnchorID, assistantText)
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
	session publicChatAnchorState,
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
