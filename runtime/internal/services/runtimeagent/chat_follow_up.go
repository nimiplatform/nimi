package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

type publicChatFollowUpState struct {
	FollowUpID       string
	SessionID        string
	AgentID          string
	CallerAppID      string
	SubjectUserID    string
	ThreadID         string
	Instruction      string
	ScheduledFor     time.Time
	ChainID          string
	FollowUpDepth    int
	MaxFollowUpTurns int
	SourceTurnID     string
	SourceActionID   string
	Context          context.Context
	Cancel           context.CancelFunc
	Armed            bool
}

type publicChatFollowUpOutcome struct {
	Status           string
	FollowUpID       string
	ChainID          string
	ScheduledFor     string
	FollowUpDepth    int
	MaxFollowUpTurns int
	SourceTurnID     string
	SourceActionID   string
	ReasonCode       runtimev1.ReasonCode
	ActionHint       string
	Message          string
}

func (o publicChatFollowUpOutcome) payload() map[string]any {
	payload := map[string]any{
		"status":              o.Status,
		"follow_up_depth":     o.FollowUpDepth,
		"max_follow_up_turns": o.MaxFollowUpTurns,
	}
	if strings.TrimSpace(o.FollowUpID) != "" {
		payload["follow_up_id"] = strings.TrimSpace(o.FollowUpID)
	}
	if strings.TrimSpace(o.ChainID) != "" {
		payload["chain_id"] = strings.TrimSpace(o.ChainID)
	}
	if strings.TrimSpace(o.ScheduledFor) != "" {
		payload["scheduled_for"] = strings.TrimSpace(o.ScheduledFor)
	}
	if strings.TrimSpace(o.SourceTurnID) != "" {
		payload["source_turn_id"] = strings.TrimSpace(o.SourceTurnID)
	}
	if strings.TrimSpace(o.SourceActionID) != "" {
		payload["source_action_id"] = strings.TrimSpace(o.SourceActionID)
	}
	if o.ReasonCode != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		payload["reason_code"] = publicChatReasonCodeLabel(o.ReasonCode)
	}
	if strings.TrimSpace(o.ActionHint) != "" {
		payload["action_hint"] = strings.TrimSpace(o.ActionHint)
	}
	if strings.TrimSpace(o.Message) != "" {
		payload["message"] = strings.TrimSpace(o.Message)
	}
	return payload
}

func (s *Service) publicChatTurnMetadataPayload(turnID string) map[string]any {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	turn := s.chatTurns[strings.TrimSpace(turnID)]
	if turn == nil {
		return map[string]any{}
	}
	payload := map[string]any{
		"turn_origin": firstNonEmpty(strings.TrimSpace(turn.Origin), publicChatTurnOriginUser),
	}
	if strings.TrimSpace(turn.ChainID) != "" {
		payload["chain_id"] = turn.ChainID
	}
	if turn.FollowUpDepth > 0 {
		payload["follow_up_depth"] = turn.FollowUpDepth
	}
	if turn.MaxFollowUpTurns > 0 {
		payload["max_follow_up_turns"] = turn.MaxFollowUpTurns
	}
	if strings.TrimSpace(turn.SourceTurnID) != "" {
		payload["source_turn_id"] = turn.SourceTurnID
	}
	if strings.TrimSpace(turn.SourceActionID) != "" {
		payload["source_action_id"] = turn.SourceActionID
	}
	return payload
}

func publicChatAcceptedPayload(session publicChatSessionState) map[string]any {
	payload := map[string]any{
		"session_status":           "turn_active",
		"transcript_message_count": len(session.Transcript),
		"execution_binding":        publicChatExecutionBindingProjectionPayload(session.Binding),
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
	return payload
}

func clonePublicChatReasoningConfig(input *publicChatReasoningConfig) *publicChatReasoningConfig {
	if input == nil {
		return nil
	}
	out := *input
	return &out
}

func publicChatReasoningPayloadFromConfig(input *publicChatReasoningConfig) *publicChatReasoningPayload {
	if input == nil {
		return nil
	}
	return &publicChatReasoningPayload{
		Mode:         strings.ToLower(strings.TrimPrefix(input.Mode.String(), "REASONING_MODE_")),
		TraceMode:    strings.ToLower(strings.TrimPrefix(input.TraceMode.String(), "REASONING_TRACE_MODE_")),
		BudgetTokens: input.BudgetTokens,
	}
}

func publicChatMessagePayloadsFromProto(input []*runtimev1.ChatMessage) []publicChatMessagePayload {
	out := make([]publicChatMessagePayload, 0, len(input))
	for _, item := range input {
		if item == nil {
			continue
		}
		role := strings.TrimSpace(item.GetRole())
		content := strings.TrimSpace(item.GetContent())
		if role == "" || content == "" {
			continue
		}
		out = append(out, publicChatMessagePayload{
			Role:    role,
			Content: content,
			Name:    strings.TrimSpace(item.GetName()),
		})
	}
	return out
}

func (s *Service) appendPublicChatAssistantMessage(sessionID string, assistantText string) {
	if strings.TrimSpace(sessionID) == "" || strings.TrimSpace(assistantText) == "" {
		return
	}
	s.chatSurfaceMu.Lock()
	session := s.chatSessions[strings.TrimSpace(sessionID)]
	if session == nil {
		s.chatSurfaceMu.Unlock()
		return
	}
	session.Transcript = append(session.Transcript, &runtimev1.ChatMessage{
		Role:    "assistant",
		Content: strings.TrimSpace(assistantText),
	})
	s.chatSurfaceMu.Unlock()
	s.persistCurrentPublicChatSurfaceState()
}

func (s *Service) publicChatSessionSnapshot(sessionID string) (publicChatSessionState, bool) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	session := s.chatSessions[strings.TrimSpace(sessionID)]
	if session == nil {
		return publicChatSessionState{}, false
	}
	snapshot := *session
	snapshot.Reasoning = clonePublicChatReasoningConfig(session.Reasoning)
	snapshot.Transcript = cloneChatMessages(session.Transcript)
	return snapshot, true
}

func (s *Service) setPublicChatStoredFollowUpOutcome(sessionID string, sourceTurnID string, outcome publicChatFollowUpOutcome) {
	trimmedSessionID := strings.TrimSpace(sessionID)
	trimmedSourceTurnID := strings.TrimSpace(sourceTurnID)
	if trimmedSessionID == "" || trimmedSourceTurnID == "" {
		return
	}
	changed := false
	s.chatSurfaceMu.Lock()
	session := s.chatSessions[trimmedSessionID]
	if session != nil {
		for _, snapshot := range []*publicChatTurnProjectionState{session.ActiveTurnSnapshot, session.LastTurnSnapshot} {
			if snapshot == nil || strings.TrimSpace(snapshot.TurnID) != trimmedSourceTurnID {
				continue
			}
			snapshot.FollowUp = clonePublicChatFollowUpOutcome(&outcome)
			snapshot.UpdatedAt = time.Now().UTC()
			changed = true
		}
	}
	s.chatSurfaceMu.Unlock()
	if changed {
		s.persistCurrentPublicChatSurfaceState()
	}
}

func (s *Service) setPublicChatSessionBaseSystemPrompt(sessionID string, systemPrompt string) {
	s.chatSurfaceMu.Lock()
	session := s.chatSessions[strings.TrimSpace(sessionID)]
	if session == nil {
		s.chatSurfaceMu.Unlock()
		return
	}
	session.SystemPrompt = strings.TrimSpace(systemPrompt)
	s.chatSurfaceMu.Unlock()
	s.persistCurrentPublicChatSurfaceState()
}

func buildPublicChatFollowUpSystemPrompt(base string, instruction string, depth int, maxTurns int) string {
	followUpInstruction := strings.TrimSpace(instruction)
	if followUpInstruction == "" {
		return strings.TrimSpace(base)
	}
	sections := make([]string, 0, 2)
	if trimmed := strings.TrimSpace(base); trimmed != "" {
		sections = append(sections, trimmed)
	}
	sections = append(sections, fmt.Sprintf(
		"FollowUpInstruction:\n%s\n\nTreat this as an internal continuation cue, not a new user message. Continue naturally from the latest assistant turn. Add only net-new content. Do not restate the previous assistant reply. The current follow-up depth is %d of %d. If no natural continuation is needed, return an empty actions array and do not repeat the prior message.",
		followUpInstruction,
		depth,
		maxTurns,
	))
	return strings.Join(sections, "\n\n")
}

func (s *Service) schedulePublicChatFollowUp(
	session publicChatSessionState,
	turn publicChatTurnState,
	_ publicChatTurnRequestPayload,
	structured *publicChatStructuredEnvelope,
) publicChatFollowUpOutcome {
	action := firstPublicChatFollowUpAction(structured)
	if action == nil {
		return publicChatFollowUpOutcome{Status: "skipped"}
	}
	nextDepth := turn.FollowUpDepth + 1
	maxTurns := turn.MaxFollowUpTurns
	if maxTurns <= 0 {
		maxTurns = publicChatMaxFollowUpTurns
	}
	if nextDepth > maxTurns {
		return publicChatFollowUpOutcome{
			Status:           "rejected",
			ChainID:          turn.ChainID,
			FollowUpDepth:    nextDepth,
			MaxFollowUpTurns: maxTurns,
			SourceTurnID:     turn.TurnID,
			SourceActionID:   action.ActionID,
			ReasonCode:       runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			Message:          "follow-up chain cap reached",
		}
	}
	followUpID := "agent_followup_" + ulid.Make().String()
	chainID := strings.TrimSpace(turn.ChainID)
	if chainID == "" {
		chainID = "agent_followup_chain_" + ulid.Make().String()
	}
	scheduledFor := time.Now().UTC().Add(time.Duration(action.PromptPayload.DelayMs) * time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	state := &publicChatFollowUpState{
		FollowUpID:       followUpID,
		SessionID:        session.SessionID,
		AgentID:          session.AgentID,
		CallerAppID:      session.CallerAppID,
		SubjectUserID:    session.SubjectUserID,
		ThreadID:         session.ThreadID,
		Instruction:      strings.TrimSpace(action.PromptPayload.PromptText),
		ScheduledFor:     scheduledFor,
		ChainID:          chainID,
		FollowUpDepth:    nextDepth,
		MaxFollowUpTurns: maxTurns,
		SourceTurnID:     turn.TurnID,
		SourceActionID:   action.ActionID,
		Context:          ctx,
		Cancel:           cancel,
	}

	s.cancelPublicChatFollowUpForSession(session.SessionID, "superseded", false)

	s.chatSurfaceMu.Lock()
	if current := s.chatSessions[session.SessionID]; current != nil {
		current.PendingFollowUpID = followUpID
	}
	s.chatFollowUps[followUpID] = state
	s.chatSurfaceMu.Unlock()

	s.persistCurrentPublicChatSurfaceState()
	s.armPublicChatFollowUp(state)
	return publicChatFollowUpOutcome{
		Status:           "scheduled",
		FollowUpID:       followUpID,
		ChainID:          chainID,
		ScheduledFor:     scheduledFor.Format(time.RFC3339Nano),
		FollowUpDepth:    nextDepth,
		MaxFollowUpTurns: maxTurns,
		SourceTurnID:     turn.TurnID,
		SourceActionID:   action.ActionID,
	}
}

func (s *Service) armPublicChatFollowUp(followUp *publicChatFollowUpState) {
	if followUp == nil || s == nil || s.isClosed() || !s.canRunPublicChatFollowUps() {
		return
	}
	s.chatSurfaceMu.Lock()
	if followUp.Armed {
		s.chatSurfaceMu.Unlock()
		return
	}
	if strings.TrimSpace(followUp.FollowUpID) == "" || s.chatFollowUps[followUp.FollowUpID] == nil {
		s.chatSurfaceMu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	followUp.Context = ctx
	followUp.Cancel = cancel
	followUp.Armed = true
	s.chatSurfaceMu.Unlock()
	go func() {
		delay := time.Until(followUp.ScheduledFor)
		if delay < 0 {
			delay = 0
		}
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-followUp.Context.Done():
			return
		}
		s.launchPublicChatFollowUp(followUp.FollowUpID)
	}()
}

func (s *Service) canRunPublicChatFollowUps() bool {
	return s != nil && !s.isClosed() && s.chatAppEmit != nil && s.HasPublicChatTurnExecutor()
}

func (s *Service) resumeRecoveredPublicChatFollowUps() {
	if s == nil || s.isClosed() {
		return
	}
	if !s.canRunPublicChatFollowUps() {
		return
	}
	s.chatSurfaceMu.Lock()
	followUps := make([]*publicChatFollowUpState, 0, len(s.chatFollowUps))
	for _, followUp := range s.chatFollowUps {
		if followUp != nil && !followUp.Armed {
			followUps = append(followUps, followUp)
		}
	}
	s.chatSurfaceMu.Unlock()
	for _, followUp := range followUps {
		s.armPublicChatFollowUp(followUp)
	}
}

func (s *Service) launchPublicChatFollowUp(followUpID string) {
	if s == nil || s.isClosed() {
		return
	}
	followUp := s.takePublicChatFollowUp(followUpID)
	if followUp == nil {
		return
	}
	session, ok := s.publicChatSessionSnapshot(followUp.SessionID)
	if !ok {
		s.emitPublicChatFollowUpCanceled(*followUp, "session_unavailable", runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, "", "public chat session unavailable")
		return
	}
	req := publicChatTurnRequestPayload{
		AgentID:         session.AgentID,
		SessionID:       session.SessionID,
		ThreadID:        session.ThreadID,
		SystemPrompt:    buildPublicChatFollowUpSystemPrompt(session.SystemPrompt, followUp.Instruction, followUp.FollowUpDepth, followUp.MaxFollowUpTurns),
		MaxOutputTokens: session.MaxTokens,
		Messages:        publicChatMessagePayloadsFromProto(session.Transcript),
		Reasoning:       publicChatReasoningPayloadFromConfig(session.Reasoning),
	}
	reservedSession, reservedTurn, turnCtx, err := s.reservePublicChatTurn(context.Background(), followUp.CallerAppID, followUp.SubjectUserID, req)
	if err != nil {
		failure := runtimeErrorDetailFromError(err)
		s.emitPublicChatFollowUpCanceled(*followUp, "runtime_unavailable", failure.ReasonCode, failure.ActionHint, failure.Message)
		return
	}
	s.setPublicChatSessionBaseSystemPrompt(reservedSession.SessionID, session.SystemPrompt)
	turn := s.markPublicChatTurnAsFollowUp(reservedTurn.TurnID, *followUp)
	s.persistCurrentPublicChatSurfaceState()
	if err := s.setPublicChatExecutionState(
		reservedSession.AgentID,
		reservedSession.SubjectUserID,
		"",
		runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE,
	); err != nil {
		s.releasePublicChatTurn(reservedSession.SessionID, reservedTurn.TurnID)
		failure := runtimeErrorDetailFromError(err)
		s.emitPublicChatFollowUpCanceled(*followUp, "runtime_unavailable", failure.ReasonCode, failure.ActionHint, failure.Message)
		return
	}
	if err := s.emitPublicChatTurnEvent(reservedSession, turn.TurnID, publicChatTurnAcceptedType, publicChatAcceptedPayload(reservedSession)); err != nil {
		s.releasePublicChatTurn(reservedSession.SessionID, reservedTurn.TurnID)
		failure := runtimeErrorDetailFromError(err)
		s.emitPublicChatFollowUpCanceled(*followUp, "runtime_unavailable", failure.ReasonCode, failure.ActionHint, failure.Message)
		return
	}
	s.setPublicChatStoredFollowUpOutcome(followUp.SessionID, followUp.SourceTurnID, publicChatFollowUpOutcome{
		Status:           "launched",
		FollowUpID:       followUp.FollowUpID,
		ChainID:          followUp.ChainID,
		ScheduledFor:     followUp.ScheduledFor.Format(time.RFC3339Nano),
		FollowUpDepth:    followUp.FollowUpDepth,
		MaxFollowUpTurns: followUp.MaxFollowUpTurns,
		SourceTurnID:     followUp.SourceTurnID,
		SourceActionID:   followUp.SourceActionID,
	})
	go s.runPublicChatTurn(turnCtx, reservedSession, turn, req)
}

func (s *Service) markPublicChatTurnAsFollowUp(turnID string, followUp publicChatFollowUpState) publicChatTurnState {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	turn := s.chatTurns[strings.TrimSpace(turnID)]
	if turn == nil {
		return publicChatTurnState{
			TurnID:           turnID,
			Origin:           publicChatTurnOriginFollowUp,
			ChainID:          followUp.ChainID,
			FollowUpDepth:    followUp.FollowUpDepth,
			MaxFollowUpTurns: followUp.MaxFollowUpTurns,
			SourceTurnID:     followUp.SourceTurnID,
			SourceActionID:   followUp.SourceActionID,
		}
	}
	turn.Origin = publicChatTurnOriginFollowUp
	turn.ChainID = followUp.ChainID
	turn.FollowUpDepth = followUp.FollowUpDepth
	turn.MaxFollowUpTurns = followUp.MaxFollowUpTurns
	turn.SourceTurnID = followUp.SourceTurnID
	turn.SourceActionID = followUp.SourceActionID
	if turn.Projection != nil {
		turn.Projection.Origin = publicChatTurnOriginFollowUp
		turn.Projection.ChainID = followUp.ChainID
		turn.Projection.FollowUpDepth = followUp.FollowUpDepth
		turn.Projection.MaxFollowUpTurns = followUp.MaxFollowUpTurns
		turn.Projection.SourceTurnID = followUp.SourceTurnID
		turn.Projection.SourceActionID = followUp.SourceActionID
		turn.Projection.UpdatedAt = time.Now().UTC()
	}
	if session := s.chatSessions[turn.SessionID]; session != nil {
		session.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(turn.Projection)
	}
	return *turn
}

func (s *Service) cancelPublicChatFollowUpForSession(sessionID string, reason string, emit bool) *publicChatFollowUpState {
	s.chatSurfaceMu.Lock()
	session := s.chatSessions[strings.TrimSpace(sessionID)]
	if session == nil || strings.TrimSpace(session.PendingFollowUpID) == "" {
		s.chatSurfaceMu.Unlock()
		return nil
	}
	followUpID := session.PendingFollowUpID
	followUp := s.chatFollowUps[followUpID]
	delete(s.chatFollowUps, followUpID)
	session.PendingFollowUpID = ""
	s.chatSurfaceMu.Unlock()
	if followUp != nil && followUp.Cancel != nil {
		followUp.Cancel()
	}
	s.persistCurrentPublicChatSurfaceState()
	if emit && followUp != nil {
		s.emitPublicChatFollowUpCanceled(*followUp, reason, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, "", "")
	}
	return followUp
}

func (s *Service) cancelPublicChatFollowUpsForThread(callerAppID string, threadID string, reason string) {
	callerAppID = strings.TrimSpace(callerAppID)
	threadID = strings.TrimSpace(threadID)
	if callerAppID == "" || threadID == "" {
		return
	}
	sessionIDs := make([]string, 0)
	s.chatSurfaceMu.Lock()
	for _, session := range s.chatSessions {
		if session == nil {
			continue
		}
		if strings.TrimSpace(session.CallerAppID) == callerAppID && strings.TrimSpace(session.ThreadID) == threadID && strings.TrimSpace(session.PendingFollowUpID) != "" {
			sessionIDs = append(sessionIDs, session.SessionID)
		}
	}
	s.chatSurfaceMu.Unlock()
	for _, sessionID := range sessionIDs {
		s.cancelPublicChatFollowUpForSession(sessionID, reason, true)
	}
}

func (s *Service) cancelPublicChatFollowUpsForRequest(callerAppID string, sessionID string, threadID string, reason string) {
	callerAppID = strings.TrimSpace(callerAppID)
	sessionID = strings.TrimSpace(sessionID)
	threadID = strings.TrimSpace(threadID)
	if callerAppID == "" {
		return
	}
	if sessionID != "" {
		s.chatSurfaceMu.Lock()
		session := s.chatSessions[sessionID]
		ownedByCaller := session != nil && strings.TrimSpace(session.CallerAppID) == callerAppID
		s.chatSurfaceMu.Unlock()
		if ownedByCaller {
			s.cancelPublicChatFollowUpForSession(sessionID, reason, true)
		}
	}
	if threadID != "" {
		s.cancelPublicChatFollowUpsForThread(callerAppID, threadID, reason)
	}
}

func (s *Service) takePublicChatFollowUp(followUpID string) *publicChatFollowUpState {
	s.chatSurfaceMu.Lock()
	followUp := s.chatFollowUps[strings.TrimSpace(followUpID)]
	if followUp == nil {
		s.chatSurfaceMu.Unlock()
		return nil
	}
	delete(s.chatFollowUps, strings.TrimSpace(followUpID))
	if session := s.chatSessions[followUp.SessionID]; session != nil && session.PendingFollowUpID == strings.TrimSpace(followUpID) {
		session.PendingFollowUpID = ""
	}
	s.chatSurfaceMu.Unlock()
	s.persistCurrentPublicChatSurfaceState()
	return followUp
}

func (s *Service) emitPublicChatFollowUpCanceled(
	followUp publicChatFollowUpState,
	reason string,
	reasonCode runtimev1.ReasonCode,
	actionHint string,
	message string,
) {
	s.setPublicChatStoredFollowUpOutcome(followUp.SessionID, followUp.SourceTurnID, publicChatFollowUpOutcome{
		Status:           "canceled",
		FollowUpID:       followUp.FollowUpID,
		ChainID:          followUp.ChainID,
		ScheduledFor:     followUp.ScheduledFor.Format(time.RFC3339Nano),
		FollowUpDepth:    followUp.FollowUpDepth,
		MaxFollowUpTurns: followUp.MaxFollowUpTurns,
		SourceTurnID:     followUp.SourceTurnID,
		SourceActionID:   followUp.SourceActionID,
		ReasonCode:       reasonCode,
		ActionHint:       strings.TrimSpace(actionHint),
		Message:          strings.TrimSpace(message),
	})
	payload := map[string]any{
		"agent_id":            followUp.AgentID,
		"session_id":          followUp.SessionID,
		"thread_id":           followUp.ThreadID,
		"follow_up_id":        followUp.FollowUpID,
		"chain_id":            followUp.ChainID,
		"follow_up_depth":     followUp.FollowUpDepth,
		"max_follow_up_turns": followUp.MaxFollowUpTurns,
		"source_turn_id":      followUp.SourceTurnID,
		"source_action_id":    followUp.SourceActionID,
		"reason":              strings.TrimSpace(reason),
		"scheduled_for":       followUp.ScheduledFor.Format(time.RFC3339Nano),
	}
	if reasonCode != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		payload["reason_code"] = publicChatReasonCodeLabel(reasonCode)
	}
	if trimmed := strings.TrimSpace(actionHint); trimmed != "" {
		payload["action_hint"] = trimmed
	}
	if trimmed := strings.TrimSpace(message); trimmed != "" {
		payload["message"] = trimmed
	}
	if err := s.emitPublicChatEvent(followUp.CallerAppID, followUp.SubjectUserID, publicChatFollowUpCanceledType, payload); err != nil && s.logger != nil {
		s.logger.Warn("emit public chat follow-up canceled event failed", "session_id", followUp.SessionID, "follow_up_id", followUp.FollowUpID, "error", err)
	}
}

func firstPublicChatFollowUpAction(structured *publicChatStructuredEnvelope) *publicChatStructuredAction {
	if structured == nil {
		return nil
	}
	for index := range structured.Actions {
		action := &structured.Actions[index]
		if action.Modality == "follow-up-turn" && action.Operation == "assistant.turn.schedule" {
			return action
		}
	}
	return nil
}
