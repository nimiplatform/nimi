package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

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

// projectCommittedStatusCue emits runtime.agent.state.emotion_changed plus
// runtime.agent.presentation.* requests derived from the structured envelope's
// StatusCue once the turn has committed. Runtime MUST NOT emit presentation
// events without real stream identity; when origin linkage cannot be
// constructed the projection is skipped rather than fabricated.
func (r publicChatRuntime) projectCommittedStatusCue(session publicChatAnchorState, turn publicChatTurnState, structured *publicChatStructuredEnvelope) {
	if r.svc == nil || r.svc.isClosed() || structured == nil || structured.StatusCue == nil {
		return
	}
	mood := strings.TrimSpace(structured.StatusCue.Mood)
	activityName := strings.TrimSpace(structured.StatusCue.ActionCue)
	if mood == "" && activityName == "" {
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
	events := make([]*runtimev1.AgentEvent, 0, 3)
	if mood != "" {
		previousEmotion := strings.TrimSpace(entry.State.GetCurrentEmotion())
		if previousEmotion != mood {
			// K-AGCORE-038: current_emotion is durable runtime state. Commit it into
			// AgentStateProjection alongside the projection event so GetAgentState /
			// snapshot / recovery observe the same truth.
			entry.State.CurrentEmotion = mood
			entry.State.UpdatedAt = timestamppb.New(now)
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
		}
	}
	if activityName != "" {
		category, intensity, ierr := normalizePublicChatActivityProjection(activityName, structured.StatusCue.Intensity)
		if ierr != nil {
			if r.svc.logger != nil {
				r.svc.logger.Warn("skip presentation.activity_requested; activity ontology invalid", "agent_id", session.AgentID, "error", ierr)
			}
			return
		}
		activityEvent, aerr := r.svc.emitPresentationActivityEvent(entry.Agent.GetAgentId(), anchorID, turnID, streamID, activityName, category, intensity, "apml_output", now)
		if aerr != nil {
			if r.svc.logger != nil {
				r.svc.logger.Warn("skip presentation.activity_requested; envelope invalid", "agent_id", session.AgentID, "error", aerr)
			}
		} else {
			events = append(events, activityEvent)
		}
	}
	if len(events) == 0 {
		return
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
	sequence := r.svc.nextPublicChatStreamSequence(trimmedTurnID)
	timeline, err := r.svc.publicChatTurnTimelineEnvelope(trimmedTurnID, messageType, sequence, time.Now())
	if err != nil {
		return err
	}
	out := map[string]any{
		"agent_id":               session.AgentID,
		"conversation_anchor_id": session.ConversationAnchorID,
		"turn_id":                trimmedTurnID,
		"stream_id":              streamID,
		"timeline":               timeline,
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
	sequence := r.svc.nextPublicChatStreamSequence(trimmedTurnID)
	timeline, err := r.svc.publicChatTurnTimelineEnvelope(trimmedTurnID, publicChatTurnMessageCommittedType, sequence, time.Now())
	if err != nil {
		return err
	}
	out := map[string]any{
		"agent_id":               session.AgentID,
		"conversation_anchor_id": session.ConversationAnchorID,
		"turn_id":                trimmedTurnID,
		"stream_id":              streamID,
		"message_id":             trimmedMessageID,
		"timeline":               timeline,
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
