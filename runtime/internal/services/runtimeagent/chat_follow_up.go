package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

// publicChatFollowUpState is post-turn runtime-owned follow-up bookkeeping.
// Per K-AGCORE-034 it is bound to a ConversationAnchor; continuity is via
// `ConversationAnchorID`, never a freestanding session identity.
type publicChatFollowUpState struct {
	FollowUpID           string
	ConversationAnchorID string
	AgentID              string
	CallerAppID          string
	SubjectUserID        string
	ThreadID             string
	Instruction          string
	ScheduledFor         time.Time
	ChainID              string
	FollowUpDepth        int
	MaxFollowUpTurns     int
	SourceTurnID         string
	SourceActionID       string
	Context              context.Context
	Cancel               context.CancelFunc
	Armed                bool
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

// publicChatAcceptedDetail builds the
// `runtime.agent.turn.accepted.detail` payload per yaml. Only `request_id`
// is admitted on the detail; transcript/binding/session_status etc. are
// session-level execution truth and live exclusively on
// `runtime.agent.session.snapshot.detail.snapshot`. RequestID is the
// inbound `runtime.agent.turn.request` message id (or, for follow-up
// turns, the runtime-owned follow-up id) — when neither is available we
// emit `{}` rather than fabricating one.
func publicChatAcceptedDetail(requestID string) map[string]any {
	out := map[string]any{}
	if trimmed := strings.TrimSpace(requestID); trimmed != "" {
		out["request_id"] = trimmed
	}
	return out
}

// publicChatPostTurnIndicationDetail scrubs the `turn.post_turn.detail`
// down to the mounted indication-only shape: `action?` (the modeled
// action selected at turn-close, when present) and `hook_intent?` (a
// turn-close indication; canonical hook lifecycle is on
// `runtime.agent.hook.*`). Runtime execution truth (assistant_memory,
// chat_sidecar, follow_up scheduling) is NOT carried here; consumers
// recover it from `session.snapshot.detail.snapshot.last_turn`.
func publicChatPostTurnIndicationDetail(structured *publicChatStructuredEnvelope, followUp publicChatFollowUpOutcome) map[string]any {
	out := map[string]any{}
	action := firstPublicChatTopLevelAction(structured)
	if action != nil {
		out["action"] = map[string]any{
			"action_id":   action.ActionID,
			"modality":    action.Modality,
			"operation":   action.Operation,
			"action_cue":  publicChatStatusCueActionLabel(structured),
			"source_kind": "structured_action",
		}
	}
	if hookIntent := publicChatHookIntentIndication(structured, followUp); hookIntent != nil {
		out["hook_intent"] = hookIntent
	}
	return out
}

// publicChatHookIntentIndication projects only the mounted HookIntent
// vocabulary back onto `turn.post_turn.detail.hook_intent` when the turn
// selected a follow-up proposal. This is an indication seam only: it must
// not leak session/execution truth such as `follow_up_id`, `scheduled_for`,
// runtime cancellation state, or delivery outcomes back onto turn events.
func publicChatHookIntentIndication(structured *publicChatStructuredEnvelope, followUp publicChatFollowUpOutcome) map[string]any {
	action := firstPublicChatFollowUpAction(structured)
	if action == nil {
		return nil
	}
	admissionState := publicChatHookIntentAdmissionState(followUp.Status)
	if admissionState == "" {
		return nil
	}
	out := map[string]any{
		"trigger_family": "time",
		"trigger_detail": map[string]any{
			"time": map[string]any{
				"delay_ms": action.PromptPayload.DelayMs,
			},
		},
		"effect":          "follow-up-turn",
		"admission_state": admissionState,
	}
	// Use the modeled action id as the indication identifier so the turn-close
	// seam does not leak runtime follow-up execution ids back onto turn events.
	if trimmed := strings.TrimSpace(action.ActionID); trimmed != "" {
		out["intent_id"] = trimmed
	}
	return out
}

func publicChatHookIntentAdmissionState(status string) string {
	switch strings.TrimSpace(status) {
	case "scheduled":
		return "pending"
	case "rejected":
		return "rejected"
	default:
		return ""
	}
}

func firstPublicChatTopLevelAction(structured *publicChatStructuredEnvelope) *publicChatStructuredAction {
	if structured == nil {
		return nil
	}
	for index := range structured.Actions {
		action := &structured.Actions[index]
		if strings.TrimSpace(action.ActionID) == "" {
			continue
		}
		return action
	}
	return nil
}

func publicChatStatusCueActionLabel(structured *publicChatStructuredEnvelope) string {
	if structured == nil || structured.StatusCue == nil {
		return ""
	}
	return strings.TrimSpace(structured.StatusCue.ActionCue)
}

// publicChatTurnCompletedDetail projects yaml `turn.completed.detail`
// admitting only `terminal_reason?`. The terminal reason mirrors the
// committed finish reason when one is observed. Runtime execution truth
// (usage, finish_reason, stream_simulated, model/route resolution) is
// recovered through session.snapshot only.
func publicChatTurnCompletedDetail(finish runtimev1.FinishReason) map[string]any {
	out := map[string]any{}
	if finish != runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED {
		out["terminal_reason"] = publicChatFinishReasonLabel(finish)
	}
	return out
}

// setPublicChatTurnRequestID records the upstream request id onto
// runtime-owned turn state so subsequent `accepted` emissions can
// surface it on `accepted.detail.request_id` per yaml.
func (s *Service) setPublicChatTurnRequestID(turnID string, requestID string) {
	trimmedTurnID := strings.TrimSpace(turnID)
	if trimmedTurnID == "" {
		return
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	turn := s.chatTurns[trimmedTurnID]
	if turn == nil {
		return
	}
	turn.RequestID = strings.TrimSpace(requestID)
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

func publicChatMessageEnvelopePayloads(input []*runtimev1.ChatMessage) []any {
	payloads := publicChatMessagePayloadsFromProto(input)
	out := make([]any, 0, len(payloads))
	for _, item := range payloads {
		out = append(out, map[string]any{
			"role":    item.Role,
			"content": item.Content,
			"name":    item.Name,
		})
	}
	return out
}

func (s *Service) appendPublicChatAssistantMessage(anchorID string, assistantText string) {
	if strings.TrimSpace(anchorID) == "" || strings.TrimSpace(assistantText) == "" {
		return
	}
	s.chatSurfaceMu.Lock()
	session := s.chatAnchors[strings.TrimSpace(anchorID)]
	if session == nil {
		s.chatSurfaceMu.Unlock()
		return
	}
	session.Transcript = append(session.Transcript, &runtimev1.ChatMessage{
		Role:    "assistant",
		Content: strings.TrimSpace(assistantText),
	})
	session.UpdatedAt = time.Now().UTC()
	s.chatSurfaceMu.Unlock()
	s.persistCurrentPublicChatSurfaceState()
}

func (s *Service) publicChatAnchorSnapshot(anchorID string) (publicChatAnchorState, bool) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	session := s.chatAnchors[strings.TrimSpace(anchorID)]
	if session == nil {
		return publicChatAnchorState{}, false
	}
	snapshot := *session
	snapshot.Reasoning = clonePublicChatReasoningConfig(session.Reasoning)
	snapshot.Transcript = cloneChatMessages(session.Transcript)
	return snapshot, true
}

func (s *Service) setPublicChatStoredFollowUpOutcome(anchorID string, sourceTurnID string, outcome publicChatFollowUpOutcome) {
	trimmedAnchorID := strings.TrimSpace(anchorID)
	trimmedSourceTurnID := strings.TrimSpace(sourceTurnID)
	if trimmedAnchorID == "" || trimmedSourceTurnID == "" {
		return
	}
	changed := false
	s.chatSurfaceMu.Lock()
	session := s.chatAnchors[trimmedAnchorID]
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

func (s *Service) setPublicChatAnchorBaseSystemPrompt(anchorID string, systemPrompt string) {
	s.chatSurfaceMu.Lock()
	session := s.chatAnchors[strings.TrimSpace(anchorID)]
	if session == nil {
		s.chatSurfaceMu.Unlock()
		return
	}
	session.SystemPrompt = strings.TrimSpace(systemPrompt)
	session.UpdatedAt = time.Now().UTC()
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
	session publicChatAnchorState,
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
		FollowUpID:           followUpID,
		ConversationAnchorID: session.ConversationAnchorID,
		AgentID:              session.AgentID,
		CallerAppID:          session.CallerAppID,
		SubjectUserID:        session.SubjectUserID,
		ThreadID:             session.ThreadID,
		Instruction:          strings.TrimSpace(action.PromptPayload.PromptText),
		ScheduledFor:         scheduledFor,
		ChainID:              chainID,
		FollowUpDepth:        nextDepth,
		MaxFollowUpTurns:     maxTurns,
		SourceTurnID:         turn.TurnID,
		SourceActionID:       action.ActionID,
		Context:              ctx,
		Cancel:               cancel,
	}

	s.cancelPublicChatFollowUpForAnchor(session.ConversationAnchorID, "superseded", false)

	s.chatSurfaceMu.Lock()
	if current := s.chatAnchors[session.ConversationAnchorID]; current != nil {
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
	session, ok := s.publicChatAnchorSnapshot(followUp.ConversationAnchorID)
	if !ok {
		s.emitPublicChatFollowUpCanceled(*followUp, "anchor_unavailable", runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, "", "public chat anchor unavailable")
		return
	}
	req := publicChatTurnRequestPayload{
		AgentID:              session.AgentID,
		ConversationAnchorID: session.ConversationAnchorID,
		ThreadID:             session.ThreadID,
		SystemPrompt:         buildPublicChatFollowUpSystemPrompt(session.SystemPrompt, followUp.Instruction, followUp.FollowUpDepth, followUp.MaxFollowUpTurns),
		MaxOutputTokens:      session.MaxTokens,
		Messages:             publicChatMessagePayloadsFromProto(session.Transcript),
		Reasoning:            publicChatReasoningPayloadFromConfig(session.Reasoning),
	}
	reservedSession, reservedTurn, turnCtx, err := s.reservePublicChatTurn(context.Background(), followUp.CallerAppID, followUp.SubjectUserID, req)
	if err != nil {
		failure := runtimeErrorDetailFromError(err)
		s.emitPublicChatFollowUpCanceled(*followUp, "runtime_unavailable", failure.ReasonCode, failure.ActionHint, failure.Message)
		return
	}
	s.setPublicChatAnchorBaseSystemPrompt(reservedSession.ConversationAnchorID, session.SystemPrompt)
	turn := s.markPublicChatTurnAsFollowUp(reservedTurn.TurnID, *followUp)
	s.persistCurrentPublicChatSurfaceState()
	if err := s.setPublicChatExecutionStateWithOrigin(
		reservedSession.AgentID,
		reservedSession.SubjectUserID,
		"",
		runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE,
		stateEventOrigin{
			ConversationAnchorID: reservedSession.ConversationAnchorID,
			OriginatingTurnID:    reservedTurn.TurnID,
			OriginatingStreamID:  reservedTurn.StreamID,
		},
	); err != nil {
		s.releasePublicChatTurn(reservedSession.ConversationAnchorID, reservedTurn.TurnID)
		failure := runtimeErrorDetailFromError(err)
		s.emitPublicChatFollowUpCanceled(*followUp, "runtime_unavailable", failure.ReasonCode, failure.ActionHint, failure.Message)
		return
	}
	s.setPublicChatTurnRequestID(turn.TurnID, followUp.FollowUpID)
	turn.RequestID = followUp.FollowUpID
	if err := s.emitPublicChatTurnEvent(reservedSession, turn.TurnID, publicChatTurnAcceptedType, publicChatAcceptedDetail(followUp.FollowUpID)); err != nil {
		s.releasePublicChatTurn(reservedSession.ConversationAnchorID, reservedTurn.TurnID)
		failure := runtimeErrorDetailFromError(err)
		s.emitPublicChatFollowUpCanceled(*followUp, "runtime_unavailable", failure.ReasonCode, failure.ActionHint, failure.Message)
		return
	}
	s.setPublicChatStoredFollowUpOutcome(followUp.ConversationAnchorID, followUp.SourceTurnID, publicChatFollowUpOutcome{
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
	if session := s.chatAnchors[turn.ConversationAnchorID]; session != nil {
		session.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(turn.Projection)
	}
	return *turn
}

// cancelPublicChatFollowUpForAnchor cancels any pending follow-up bound to
// the given ConversationAnchor. Interrupt/cancel propagation is anchor-scoped
// per K-AGCORE-035; other anchors under the same agent are not affected.
func (s *Service) cancelPublicChatFollowUpForAnchor(anchorID string, reason string, emit bool) *publicChatFollowUpState {
	s.chatSurfaceMu.Lock()
	session := s.chatAnchors[strings.TrimSpace(anchorID)]
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
	anchorIDs := make([]string, 0)
	s.chatSurfaceMu.Lock()
	for _, session := range s.chatAnchors {
		if session == nil {
			continue
		}
		if strings.TrimSpace(session.CallerAppID) == callerAppID && strings.TrimSpace(session.ThreadID) == threadID && strings.TrimSpace(session.PendingFollowUpID) != "" {
			anchorIDs = append(anchorIDs, session.ConversationAnchorID)
		}
	}
	s.chatSurfaceMu.Unlock()
	for _, anchorID := range anchorIDs {
		s.cancelPublicChatFollowUpForAnchor(anchorID, reason, true)
	}
}

func (s *Service) cancelPublicChatFollowUpsForRequest(callerAppID string, anchorID string, threadID string, reason string) {
	callerAppID = strings.TrimSpace(callerAppID)
	anchorID = strings.TrimSpace(anchorID)
	threadID = strings.TrimSpace(threadID)
	if callerAppID == "" {
		return
	}
	if anchorID != "" {
		s.chatSurfaceMu.Lock()
		session := s.chatAnchors[anchorID]
		ownedByCaller := session != nil && strings.TrimSpace(session.CallerAppID) == callerAppID
		s.chatSurfaceMu.Unlock()
		if ownedByCaller {
			s.cancelPublicChatFollowUpForAnchor(anchorID, reason, true)
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
	if session := s.chatAnchors[followUp.ConversationAnchorID]; session != nil && session.PendingFollowUpID == strings.TrimSpace(followUpID) {
		session.PendingFollowUpID = ""
	}
	s.chatSurfaceMu.Unlock()
	s.persistCurrentPublicChatSurfaceState()
	return followUp
}

// emitPublicChatFollowUpCanceled records the follow-up cancellation into the
// runtime-owned turn projection only. Per Exec Pack 1 scope, no stealth
// `runtime.agent.follow_up.*` public event family is minted; the cancellation
// surfaces via the admitted session_envelope projection
// (`session.snapshot.last_turn.follow_up.status == "canceled"`). Expanding
// public event families beyond `turn.*` / `session.*` would require a new
// authority admission outside Exec Pack 1.
func (s *Service) emitPublicChatFollowUpCanceled(
	followUp publicChatFollowUpState,
	reason string,
	reasonCode runtimev1.ReasonCode,
	actionHint string,
	message string,
) {
	_ = reason // retained for audit/debug logging only; not surfaced on any public event.
	s.setPublicChatStoredFollowUpOutcome(followUp.ConversationAnchorID, followUp.SourceTurnID, publicChatFollowUpOutcome{
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
