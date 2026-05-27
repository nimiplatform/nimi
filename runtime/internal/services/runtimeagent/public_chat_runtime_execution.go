package runtimeagent

import (
	"context"
	"errors"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func (r publicChatRuntime) runTurn(
	ctx context.Context,
	session publicChatAnchorState,
	turn publicChatTurnState,
	req publicChatTurnRequestPayload,
) {
	runStartedAt := time.Now()
	r.svc.observeLatency("runtime.agent.turn.accepted_to_run_start_ms", turn.TimelineStartedAt,
		"caller_app_id", session.CallerAppID,
		"agent_id", session.AgentID,
		"conversation_anchor_id", session.ConversationAnchorID,
		"turn_id", turn.TurnID,
		"stream_id", turn.StreamID,
		"thread_id", session.ThreadID,
		"request_id", strings.TrimSpace(turn.RequestID),
	)
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
	streamCompletedAt := time.Time{}
	firstDeltaObserved := false
	assembledSystemPrompt, assemblyErr := r.assemblePublicChatSystemPrompt(ctx, session, req)
	if assemblyErr != nil {
		failure := runtimeErrorDetailFromError(assemblyErr)
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
	err := r.svc.currentPublicChatTurnExecutor().StreamChatTurn(ctx, &PublicChatTurnExecutionRequest{
		AppID:         session.CallerAppID,
		SubjectUserID: session.SubjectUserID,
		Messages:      toProtoPublicChatMessages(req.Messages),
		SystemPrompt:  assembledSystemPrompt,
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
			r.svc.observeLatency("runtime.agent.turn.accepted_to_started_ms", turn.TimelineStartedAt,
				"caller_app_id", session.CallerAppID,
				"agent_id", session.AgentID,
				"conversation_anchor_id", session.ConversationAnchorID,
				"turn_id", turn.TurnID,
				"stream_id", turn.StreamID,
				"thread_id", session.ThreadID,
				"request_id", strings.TrimSpace(turn.RequestID),
				"trace_id", traceID,
				"resolved_model_id", modelResolved,
				"route_decision", routeDecision.String(),
			)
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
				if !firstDeltaObserved {
					firstDeltaObserved = true
					r.svc.observeLatency("runtime.agent.turn.started_to_first_text_delta_ms", runStartedAt,
						"caller_app_id", session.CallerAppID,
						"agent_id", session.AgentID,
						"conversation_anchor_id", session.ConversationAnchorID,
						"turn_id", turn.TurnID,
						"stream_id", turn.StreamID,
						"thread_id", session.ThreadID,
						"request_id", strings.TrimSpace(turn.RequestID),
						"trace_id", traceID,
						"resolved_model_id", modelResolved,
						"route_decision", routeDecision.String(),
					)
				}
				accumulatedText.WriteString(textDelta)
				r.svc.mutatePublicChatTurnProjection(turn.TurnID, false, func(projection *publicChatTurnProjectionState) {
					projection.Status = publicChatTurnStatusStreaming
					projection.TraceID = traceID
					projection.OutputObserved = true
				})
				// Raw model chunks are APML input, not durable app-facing text.
				// They remain internal until the APML envelope validates and the
				// committed message event succeeds.
				return nil
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
				streamCompletedAt = time.Now()
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
	structuredStartedAt := time.Now()
	structured, parseErr := parsePublicChatStructuredEnvelope(accumulatedText.String())
	if !streamCompletedAt.IsZero() {
		r.svc.observeLatency("runtime.agent.turn.stream_completed_to_structured_ms", streamCompletedAt,
			"caller_app_id", session.CallerAppID,
			"agent_id", session.AgentID,
			"conversation_anchor_id", session.ConversationAnchorID,
			"turn_id", turn.TurnID,
			"stream_id", turn.StreamID,
			"thread_id", session.ThreadID,
			"request_id", strings.TrimSpace(turn.RequestID),
			"trace_id", traceID,
			"resolved_model_id", modelResolved,
			"route_decision", routeDecision.String(),
		)
	}
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
	// K-AGCORE-039 commit point: emit `runtime.agent.turn.message_committed`
	// with the schema-compliant detail (`message_id`, `text`) and the
	// required `message_id` envelope extra per yaml `extra_fields_by_event`.
	messageCommitStartedAt := time.Now()
	if err := r.emitTurnMessageCommitted(session, turn.TurnID, structured.Message.MessageID, structured.Message.Text); err != nil {
		if r.svc.logger != nil {
			r.svc.logger.Warn("emit public chat message_committed event failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
		}
		r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
			projection.Status = publicChatTurnStatusFailed
			projection.TraceID = traceID
			projection.ModelResolved = modelResolved
			projection.RouteDecision = routeDecision
			projection.ReasonCode = runtimev1.ReasonCode_AI_STREAM_BROKEN
			projection.Message = strings.TrimSpace(err.Error())
		})
		r.emitTurnFailed(session, turn, traceID, modelResolved, routeDecision, runtimev1.ReasonCode_AI_STREAM_BROKEN, err.Error(), "")
		return
	}
	// After the commit point succeeds, app-facing text_delta may expose the
	// typed message text. It must never expose raw APML/model chunks.
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnTextDeltaType, map[string]any{
		"text": structured.Message.Text,
	}); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit public chat committed text_delta event failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
	}
	// Project committed runtime interpretation into state+presentation per
	// K-AGCORE-037 / K-AGCORE-038 only after the commit point succeeds.
	r.projectCommittedStatusCue(session, turn, structured)
	// K-AGCORE-051 voice/lipsync projection: derive runtime-owned timeline
	// events (`voice_playback_requested` + `lipsync_frame_batch`) from the
	// committed assistant text. Synthesizer + emit failures are logged but
	// do not block turn completion (parallels projectCommittedStatusCue).
	r.projectCommittedVoiceLipsync(session, turn, structured)
	r.svc.observeCounter("runtime_agent_turn_message_committed_total", 1,
		"caller_app_id", session.CallerAppID,
		"agent_id", session.AgentID,
		"conversation_anchor_id", session.ConversationAnchorID,
		"turn_id", turn.TurnID,
		"stream_id", turn.StreamID,
		"thread_id", session.ThreadID,
		"request_id", strings.TrimSpace(turn.RequestID),
		"trace_id", traceID,
		"message_id", structured.Message.MessageID,
	)
	r.svc.observeLatency("runtime.agent.turn.structured_to_message_committed_ms", structuredStartedAt,
		"caller_app_id", session.CallerAppID,
		"agent_id", session.AgentID,
		"conversation_anchor_id", session.ConversationAnchorID,
		"turn_id", turn.TurnID,
		"stream_id", turn.StreamID,
		"thread_id", session.ThreadID,
		"request_id", strings.TrimSpace(turn.RequestID),
		"trace_id", traceID,
		"message_id", structured.Message.MessageID,
	)
	postTurnOutcome := r.applyPostTurn(ctx, session, turn, req, structured)
	postTurnEventStartedAt := time.Now()
	// yaml `turn.post_turn.detail` admits indication-only `action?` and
	// `hook_intent?`. Runtime execution truth (assistant_memory result,
	// chat_sidecar outcome, follow-up scheduling state, trace_id) lives on
	// the unary public chat session snapshot `last_turn` only;
	// canonical hook lifecycle remains on `runtime.agent.hook.*`.
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnPostTurnType, publicChatPostTurnIndicationDetail(structured, postTurnOutcome.FollowUp)); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit public chat post-turn event failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
	}
	r.svc.observeLatency("runtime.agent.turn.message_committed_to_post_turn_ms", messageCommitStartedAt,
		"caller_app_id", session.CallerAppID,
		"agent_id", session.AgentID,
		"conversation_anchor_id", session.ConversationAnchorID,
		"turn_id", turn.TurnID,
		"stream_id", turn.StreamID,
		"thread_id", session.ThreadID,
		"request_id", strings.TrimSpace(turn.RequestID),
		"trace_id", traceID,
		"message_id", structured.Message.MessageID,
	)
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
	// the unary public chat session snapshot `last_turn` only.
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnCompletedType, publicChatTurnCompletedDetail(finish.GetFinishReason())); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit public chat completion failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
	}
	r.svc.observeCounter("runtime_agent_turn_completed_total", 1,
		"caller_app_id", session.CallerAppID,
		"agent_id", session.AgentID,
		"conversation_anchor_id", session.ConversationAnchorID,
		"turn_id", turn.TurnID,
		"stream_id", turn.StreamID,
		"thread_id", session.ThreadID,
		"request_id", strings.TrimSpace(turn.RequestID),
		"trace_id", traceID,
		"finish_reason", finish.GetFinishReason().String(),
	)
	r.svc.observeLatency("runtime.agent.turn.post_turn_to_completed_ms", postTurnEventStartedAt,
		"caller_app_id", session.CallerAppID,
		"agent_id", session.AgentID,
		"conversation_anchor_id", session.ConversationAnchorID,
		"turn_id", turn.TurnID,
		"stream_id", turn.StreamID,
		"thread_id", session.ThreadID,
		"request_id", strings.TrimSpace(turn.RequestID),
		"trace_id", traceID,
		"finish_reason", finish.GetFinishReason().String(),
	)
}
