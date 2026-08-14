package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// @nimi-authority: definition.nimi.runtime.agent-participation.hook-intent-plane
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
	waitUntilDue := s.chatFollowUpWait
	s.chatSurfaceMu.Unlock()
	if waitUntilDue == nil {
		waitUntilDue = waitForPublicChatFollowUpDue
	}
	if !s.startPublicChatAsync(func() {
		if !waitUntilDue(followUp.Context, followUp.ScheduledFor) {
			return
		}
		s.launchPublicChatFollowUp(followUp.FollowUpID)
	}) {
		cancel()
	}
}

func waitForPublicChatFollowUpDue(ctx context.Context, scheduledFor time.Time) bool {
	delay := time.Until(scheduledFor)
	if delay < 0 {
		delay = 0
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-ctx.Done():
		return false
	}
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
		_ = s.emitPublicChatFollowUpCanceled(*followUp, "anchor_unavailable", runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, "", "public chat anchor unavailable")
		return
	}
	req := publicChatTurnRequestPayload{
		LocalAgentRef:        session.LocalAgentRef,
		OwnerUserID:          session.OwnerUserID,
		RuntimeSourceRef:     session.RuntimeSourceRef,
		ConversationAnchorID: session.ConversationAnchorID,
		ThreadID:             session.ThreadID,
		MaxOutputTokens:      session.MaxTokens,
		Messages:             publicChatFollowUpInstructionInput(followUp.Instruction),
		Reasoning:            publicChatReasoningPayloadFromConfig(session.Reasoning),
	}
	reservedSession, reservedTurn, turnCtx, err := s.reservePublicChatTurn(context.Background(), followUp.CallerAppID, followUp.SubjectUserID, req)
	if err != nil {
		failure := runtimeErrorDetailFromError(err)
		_ = s.emitPublicChatFollowUpCanceled(*followUp, "runtime_unavailable", failure.ReasonCode, failure.ActionHint, failure.Message)
		return
	}
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
		_ = s.emitPublicChatFollowUpCanceled(*followUp, "runtime_unavailable", failure.ReasonCode, failure.ActionHint, failure.Message)
		return
	}
	s.setPublicChatTurnRequestID(turn.TurnID, followUp.FollowUpID)
	turn.RequestID = followUp.FollowUpID
	if err := s.emitPublicChatTurnEvent(reservedSession, turn.TurnID, publicChatTurnAcceptedType, publicChatAcceptedDetail(followUp.FollowUpID)); err != nil {
		s.releasePublicChatTurn(reservedSession.ConversationAnchorID, reservedTurn.TurnID)
		failure := runtimeErrorDetailFromError(err)
		_ = s.emitPublicChatFollowUpCanceled(*followUp, "runtime_unavailable", failure.ReasonCode, failure.ActionHint, failure.Message)
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
