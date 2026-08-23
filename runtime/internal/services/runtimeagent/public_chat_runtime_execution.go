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
	defer r.finishTurnReservation(session, turn.TurnID)
	accumulatedText := &strings.Builder{}
	var usage *runtimev1.UsageStats
	var finish *runtimev1.ScenarioStreamCompleted
	var failed *runtimev1.ScenarioStreamFailed
	modelResolved := strings.TrimSpace(session.Binding.ModelID)
	routeDecision := session.Binding.RoutePolicy
	traceID := ""
	streamCompletedAt := time.Time{}
	firstDeltaObserved := false
	contextCompilation, compositionErr := r.composePublicChatTurnContext(ctx, session, turn, req)
	if compositionErr != nil {
		failure := runtimeErrorDetailFromError(compositionErr)
		var contextSummary *runtimev1.AgentTurnContextSummary
		var typedCompositionErr *publicChatContextCompositionError
		if errors.As(compositionErr, &typedCompositionErr) {
			contextSummary = cloneAgentTurnContextSummary(typedCompositionErr.summary)
		}
		r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
			projection.Status = publicChatTurnStatusFailed
			projection.ContextSummary = contextSummary
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
	r.svc.mutatePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
		projection.ContextSummary = cloneAgentTurnContextSummary(contextCompilation.Summary)
	})
	err := r.svc.currentPublicChatTurnExecutor().StreamChatTurn(ctx, &PublicChatTurnExecutionRequest{
		AppID:            session.CallerAppID,
		SubjectUserID:    session.SubjectUserID,
		Messages:         publicChatAgentTurnProviderMessages(contextCompilation.ProviderPrompt.Messages),
		MaxTokens:        int32(contextCompilation.Manifest.Budget.ReservedOutputTokens),
		Binding:          session.Binding,
		AvailableActions: turn.AvailableActions,
		Reasoning:        normalizePublicChatReasoning(req.Reasoning),
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
		if errors.Is(err, context.DeadlineExceeded) {
			r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
				projection.Status = publicChatTurnStatusFailed
				projection.TraceID = traceID
				projection.ModelResolved = modelResolved
				projection.RouteDecision = routeDecision
				projection.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
				projection.Message = "runtime public chat turn timed out"
			})
			r.emitTurnFailed(session, turn, traceID, modelResolved, routeDecision, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, "runtime public chat turn timed out", "")
			return
		}
		if interrupted || errors.Is(err, context.Canceled) {
			reason := firstNonEmpty(interruptReason, "user_cancel")
			r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
				projection.Status = publicChatTurnStatusInterrupted
				projection.TraceID = traceID
				projection.ModelResolved = modelResolved
				projection.RouteDecision = routeDecision
				projection.ReasonCode = runtimev1.ReasonCode_AI_STREAM_BROKEN
				projection.Message = reason
			})
			r.emitTurnInterrupted(session, turn, traceID, modelResolved, routeDecision, reason)
			return
		}
		failure := runtimeErrorDetailFromError(err)
		if failure.ReasonCode == runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED && publicChatTurnCarriesUserAttachment(req) {
			r.failVisionUnsupportedAttachmentTurn(ctx, session, turn, req, traceID, modelResolved, routeDecision)
			return
		}
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
		reason := firstNonEmpty(interruptReason, "user_cancel")
		r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
			projection.Status = publicChatTurnStatusInterrupted
			projection.TraceID = traceID
			projection.ModelResolved = modelResolved
			projection.RouteDecision = routeDecision
			projection.ReasonCode = runtimev1.ReasonCode_AI_STREAM_BROKEN
			projection.Message = reason
		})
		r.emitTurnInterrupted(session, turn, traceID, modelResolved, routeDecision, reason)
		return
	}
	if failed != nil {
		if failed.GetReasonCode() == runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED && publicChatTurnCarriesUserAttachment(req) {
			r.failVisionUnsupportedAttachmentTurn(ctx, session, turn, req, traceID, modelResolved, routeDecision)
			return
		}
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
	rawStructuredOutput := accumulatedText.String()
	structured, parseErr := parsePublicChatStructuredEnvelope(rawStructuredOutput)
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
	// K-AGCORE-039 commit point: atomically persist the canonical transcript
	// turn together with a completed message projection. Event delivery is a
	// post-commit projection and can never redefine this durable result.
	messageCommitStartedAt := time.Now()
	finalizeCommittedProjection := func(projection *publicChatTurnProjectionState) {
		applyCommittedPublicChatMessageProjection(projection, traceID, modelResolved, routeDecision, structured, usage, finish, nil)
	}
	var commitErr error
	if len(req.Messages) == 1 && strings.TrimSpace(req.Messages[0].Role) == "user" {
		commitErr = r.svc.commitPublicChatTurnTranscriptForTurnWithProjection(
			ctx,
			session.ConversationAnchorID,
			turn.TurnID,
			publicChatCurrentUserCommitMessage(req),
			structured.Message.Text,
			finalizeCommittedProjection,
		)
	} else if len(req.Messages) == 1 && strings.TrimSpace(req.Messages[0].Role) == publicChatInternalFollowUpInstructionRole {
		commitErr = r.svc.commitPublicChatFollowUpTranscriptWithProjection(
			ctx,
			session.ConversationAnchorID,
			turn.TurnID,
			req.Messages[0].Content,
			structured.Message.Text,
			finalizeCommittedProjection,
		)
	} else {
		commitErr = errors.New("Runtime transcript commit requires exactly one admitted current-turn input")
	}
	if commitErr != nil {
		r.failUncommittedPublicChatTurn(session, turn, traceID, modelResolved, routeDecision, structured, usage, finish, runtimev1.ReasonCode_AI_STREAM_BROKEN, "commit Runtime transcript failed: "+commitErr.Error())
		return
	}
	// Once the durable commit succeeds, app-facing text_delta may expose the
	// typed message text. It must never expose raw APML/model chunks, and it
	// must precede the public message_committed event so consumers can treat
	// every delta as provisional until that explicit commit point.
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnTextDeltaType, map[string]any{
		"text": structured.Message.Text,
	}); err != nil {
		r.completeCommittedPublicChatTurnWithDiagnostic(session, turn, traceID, modelResolved, routeDecision, structured, usage, finish, nil, runtimev1.ReasonCode_AI_STREAM_BROKEN, "emit public chat committed text_delta event failed: "+err.Error())
		return
	}
	if err := r.emitTurnMessageCommitted(session, turn.TurnID, structured.Message.MessageID, structured.Message.Text); err != nil {
		r.completeCommittedPublicChatTurnWithDiagnostic(session, turn, traceID, modelResolved, routeDecision, structured, usage, finish, nil, runtimev1.ReasonCode_AI_STREAM_BROKEN, "emit public chat message_committed event failed: "+err.Error())
		return
	}
	// Project committed runtime interpretation into state+presentation per
	// K-AGCORE-037 / K-AGCORE-038 only after the commit point succeeds.
	r.projectCommittedStatusCue(session, turn, structured)
	// Voice/lipsync projection is policy-gated. Missing avatar autoplay,
	// speech model, route, voice reference, or audio bytes leaves the turn as
	// normal text-only output.
	r.projectCommittedVoiceLipsync(ctx, session, turn, structured)
	postCommitReasonCode := runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	postCommitDiagnostic := ""
	actionErr := r.executeCommittedActions(ctx, session, turn, structured)
	if barrierErr := r.ensureCoupledPublicChatActionTerminal(session, turn, structured); actionErr == nil && barrierErr != nil {
		actionErr = barrierErr
	}
	if actionErr != nil {
		postCommitReasonCode = publicChatActionFailureReason(actionErr)
		postCommitDiagnostic = actionErr.Error()
		if r.svc.logger != nil {
			r.svc.logger.Warn("public chat committed action failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", actionErr)
		}
	}
	if hasCoupledPublicChatImageAction(structured) {
		interrupted, interruptReason, _ = r.svc.publicChatInterruptStatus(turn.TurnID)
		if interrupted {
			reason := firstNonEmpty(interruptReason, "user_cancel")
			r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
				projection.Status = publicChatTurnStatusInterrupted
				projection.TraceID = traceID
				projection.ModelResolved = modelResolved
				projection.RouteDecision = routeDecision
				projection.ReasonCode = runtimev1.ReasonCode_AI_STREAM_BROKEN
				projection.Message = reason
			})
			r.emitTurnInterrupted(session, turn, traceID, modelResolved, routeDecision, reason)
			return
		}
	}
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
	r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
		applyCompletedPublicChatTurnProjection(projection, traceID, modelResolved, routeDecision, structured, usage, finish, &postTurnOutcome)
		projection.ReasonCode = postCommitReasonCode
		projection.Message = boundedPublicChatPostCommitDiagnostic(postCommitDiagnostic)
	})
	// yaml `turn.post_turn.detail` admits indication-only `action?` and
	// `hook_intent?`. Runtime execution truth (assistant_memory result,
	// chat_sidecar outcome, follow-up scheduling state, trace_id) lives on
	// the unary public chat session snapshot `last_turn` only;
	// canonical hook lifecycle remains on `runtime.agent.hook.*`.
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnPostTurnType, publicChatPostTurnIndicationDetail(structured, postTurnOutcome.FollowUp)); err != nil {
		r.completeCommittedPublicChatTurnWithDiagnostic(session, turn, traceID, modelResolved, routeDecision, structured, usage, finish, &postTurnOutcome, runtimev1.ReasonCode_AI_STREAM_BROKEN, "emit public chat post-turn event failed: "+err.Error())
		return
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
	// yaml `turn.completed.detail` admits only `terminal_reason?`. The
	// committed message text/message_id is on `turn.message_committed`;
	// usage / finish_reason / stream_simulated / model_resolved /
	// route_decision are runtime execution truth and live on
	// the unary public chat session snapshot `last_turn` only.
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnCompletedType, publicChatTurnCompletedDetail(finish.GetFinishReason())); err != nil {
		r.completeCommittedPublicChatTurnWithDiagnostic(session, turn, traceID, modelResolved, routeDecision, structured, usage, finish, &postTurnOutcome, runtimev1.ReasonCode_AI_STREAM_BROKEN, "emit public chat completion failed: "+err.Error())
		return
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

func (r publicChatRuntime) failUncommittedPublicChatTurn(
	session publicChatAnchorState,
	turn publicChatTurnState,
	traceID string,
	modelResolved string,
	routeDecision runtimev1.RoutePolicy,
	structured *publicChatStructuredEnvelope,
	usage *runtimev1.UsageStats,
	finish *runtimev1.ScenarioStreamCompleted,
	reasonCode runtimev1.ReasonCode,
	message string,
) {
	r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
		projection.Status = publicChatTurnStatusFailed
		projection.TraceID = traceID
		projection.ModelResolved = modelResolved
		projection.RouteDecision = routeDecision
		projection.OutputObserved = true
		if structured != nil {
			projection.MessageID = structured.Message.MessageID
			projection.AssistantText = structured.Message.Text
			projection.Structured = clonePublicChatStructuredEnvelope(structured)
		}
		projection.ReasonCode = reasonCode
		projection.Message = strings.TrimSpace(message)
		if finish != nil {
			projection.FinishReason = publicChatFinishReasonLabel(finish.GetFinishReason())
			projection.StreamSimulated = finish.GetStreamSimulated()
		}
		if usage != nil {
			projection.Usage = proto.Clone(usage).(*runtimev1.UsageStats)
		}
	})
	r.emitTurnFailed(session, turn, traceID, modelResolved, routeDecision, reasonCode, message, "")
}

func (r publicChatRuntime) completeCommittedPublicChatTurnWithDiagnostic(
	session publicChatAnchorState,
	turn publicChatTurnState,
	traceID string,
	modelResolved string,
	routeDecision runtimev1.RoutePolicy,
	structured *publicChatStructuredEnvelope,
	usage *runtimev1.UsageStats,
	finish *runtimev1.ScenarioStreamCompleted,
	postTurnOutcome *publicChatPostTurnOutcome,
	reasonCode runtimev1.ReasonCode,
	message string,
) {
	boundedMessage := boundedPublicChatPostCommitDiagnostic(message)
	r.svc.finalizePublicChatTurnProjection(turn.TurnID, true, func(projection *publicChatTurnProjectionState) {
		applyCompletedPublicChatTurnProjection(projection, traceID, modelResolved, routeDecision, structured, usage, finish, postTurnOutcome)
		projection.ReasonCode = reasonCode
		projection.ActionHint = ""
		projection.Message = boundedMessage
	})
	if r.svc.logger != nil {
		r.svc.logger.Warn("public chat post-commit diagnostic", "agent_id", session.AgentID, "turn_id", turn.TurnID, "reason_code", reasonCode.String(), "message", boundedMessage)
	}
}

func applyCommittedPublicChatMessageProjection(
	projection *publicChatTurnProjectionState,
	traceID string,
	modelResolved string,
	routeDecision runtimev1.RoutePolicy,
	structured *publicChatStructuredEnvelope,
	usage *runtimev1.UsageStats,
	finish *runtimev1.ScenarioStreamCompleted,
	postTurnOutcome *publicChatPostTurnOutcome,
) {
	if projection == nil {
		return
	}
	projection.Status = publicChatTurnStatusCommitted
	projection.TraceID = strings.TrimSpace(traceID)
	projection.ModelResolved = strings.TrimSpace(modelResolved)
	projection.RouteDecision = routeDecision
	projection.OutputObserved = true
	projection.ReasonCode = runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	projection.ActionHint = ""
	projection.Message = ""
	if structured != nil {
		projection.MessageID = strings.TrimSpace(structured.Message.MessageID)
		projection.AssistantText = strings.TrimSpace(structured.Message.Text)
		projection.Structured = clonePublicChatStructuredEnvelope(structured)
	}
	if postTurnOutcome != nil {
		projection.AssistantMemory = clonePublicChatAssistantMemoryOutcome(&postTurnOutcome.AssistantMemory)
		projection.Sidecar = clonePublicChatSidecarOutcome(&postTurnOutcome.Sidecar)
		projection.FollowUp = clonePublicChatFollowUpOutcome(&postTurnOutcome.FollowUp)
	}
	if finish != nil {
		projection.FinishReason = publicChatFinishReasonLabel(finish.GetFinishReason())
		projection.StreamSimulated = finish.GetStreamSimulated()
	}
	if usage != nil {
		projection.Usage = proto.Clone(usage).(*runtimev1.UsageStats)
	}
}

func applyCompletedPublicChatTurnProjection(
	projection *publicChatTurnProjectionState,
	traceID string,
	modelResolved string,
	routeDecision runtimev1.RoutePolicy,
	structured *publicChatStructuredEnvelope,
	usage *runtimev1.UsageStats,
	finish *runtimev1.ScenarioStreamCompleted,
	postTurnOutcome *publicChatPostTurnOutcome,
) {
	applyCommittedPublicChatMessageProjection(projection, traceID, modelResolved, routeDecision, structured, usage, finish, postTurnOutcome)
	if projection != nil {
		projection.Status = publicChatTurnStatusCompleted
	}
}

func boundedPublicChatPostCommitDiagnostic(message string) string {
	const maxRunes = 512
	trimmed := strings.TrimSpace(message)
	if trimmed == "" {
		return ""
	}
	runes := []rune(trimmed)
	if len(runes) <= maxRunes {
		return trimmed
	}
	return string(runes[:maxRunes])
}
