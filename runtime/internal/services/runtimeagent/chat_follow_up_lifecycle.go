package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
)

// @nimi-authority: definition.nimi.runtime.agent-participation.hook-intent-plane
func (s *Service) armPublicChatFollowUp(followUp *publicChatFollowUpState) {
	if followUp == nil || s == nil || s.isClosed() || !s.canRunPublicChatFollowUps() {
		return
	}
	lifetime := s.publicChatAsyncLifetime()
	s.chatSurfaceMu.Lock()
	if followUp.Armed || s.chatFollowUps[followUp.FollowUpID] != followUp {
		s.chatSurfaceMu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(lifetime)
	followUp.Context = ctx
	followUp.Cancel = cancel
	followUp.Armed = true
	due := followUp.ScheduledFor
	wait := s.chatFollowUpWait
	s.chatSurfaceMu.Unlock()
	if wait == nil {
		wait = waitForPublicChatFollowUpDue
	}
	if !s.startPublicChatAsync(func() {
		defer cancel()
		if !wait(ctx, due) {
			return
		}
		s.chatSurfaceMu.Lock()
		current := s.chatFollowUps[followUp.FollowUpID]
		if current != followUp || ctx.Err() != nil {
			s.chatSurfaceMu.Unlock()
			return
		}
		// A still-running text turn will wake this task when it releases its
		// slot. Otherwise keep the timer claimed through launch: clearing Armed
		// before the atomic turn claim allowed a second timer to replace Cancel.
		if anchor := s.chatAnchors[followUp.ConversationAnchorID]; anchor != nil && anchor.ActiveTurnID != "" {
			followUp.Armed = false
			s.chatSurfaceMu.Unlock()
			return
		}
		s.chatSurfaceMu.Unlock()
		s.launchPublicChatFollowUp(followUp.FollowUpID)
		s.chatSurfaceMu.Lock()
		if s.chatFollowUps[followUp.FollowUpID] == followUp {
			followUp.Armed = false
		}
		s.chatSurfaceMu.Unlock()
	}) {
		cancel()
		s.chatSurfaceMu.Lock()
		if s.chatFollowUps[followUp.FollowUpID] == followUp {
			followUp.Armed = false
		}
		s.chatSurfaceMu.Unlock()
	}
}

func (s *Service) wakeDuePublicChatFollowUp(anchorID string) {
	s.chatSurfaceMu.Lock()
	anchor := s.chatAnchors[anchorID]
	var pending *publicChatFollowUpState
	if anchor != nil && anchor.EffectiveFreeContactEnabled && anchor.ActiveTurnID == "" {
		pending = s.chatFollowUps[anchor.PendingFollowUpID]
	}
	s.chatSurfaceMu.Unlock()
	if pending != nil {
		s.armPublicChatFollowUp(pending)
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
	s.chatSurfaceMu.Lock()
	pending := s.chatFollowUps[followUpID]
	if pending == nil {
		s.chatSurfaceMu.Unlock()
		return
	}
	followUp := *pending
	anchor := s.chatAnchors[followUp.ConversationAnchorID]
	if anchor == nil || !anchor.EffectiveFreeContactEnabled || anchor.ActiveTurnID != "" {
		s.chatSurfaceMu.Unlock()
		return
	}
	session := *anchor
	s.chatSurfaceMu.Unlock()
	work := s.claimAgentBackgroundFor(s.publicChatAsyncLifetime(), session.LocalAgentRef, "follow_up")
	if work == nil {
		return
	}
	defer s.releaseAgentBackground(session.LocalAgentRef, work)
	if s.runtimeAccountProjection == nil {
		return
	}
	projection, ok := s.runtimeAccountProjection.AuthenticatedRuntimeProjection(context.Background())
	if !ok || projection.GetAccountId() != session.SubjectUserID {
		return
	}
	req := publicChatTurnRequestPayload{LocalAgentRef: session.LocalAgentRef, OwnerUserID: session.OwnerUserID, RuntimeSourceRef: session.RuntimeSourceRef, ConversationAnchorID: session.ConversationAnchorID, ThreadID: session.ThreadID, RequestID: followUp.FollowUpID, MaxOutputTokens: session.MaxTokens, Messages: publicChatFollowUpInstructionInput(publicChatContinuationInstruction), Reasoning: publicChatReasoningPayloadFromConfig(session.Reasoning), followUpClaim: &followUp}
	req.backgroundAdmission = work
	ownerCtx := executionintent.WithRuntimeAccountSubject(work.ctx, projection.GetAccountId())
	turnID, err := s.publicChatRuntime().handleTurnRequestWithID(ownerCtx, &runtimev1.AppMessageEvent{SubjectUserId: followUp.SubjectUserID, MessageId: followUp.FollowUpID}, req)
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("pending follow-up not claimed", "follow_up_id", followUpID, "error", err)
		}
		return
	}
	if followUp.Cancel != nil {
		followUp.Cancel()
	}
	if turnID != "" {
		s.setPublicChatStoredFollowUpOutcome(followUp.ConversationAnchorID, followUp.SourceTurnID, publicChatFollowUpOutcome{Status: "launched", FollowUpID: followUp.FollowUpID, ChainID: followUp.ChainID, ScheduledFor: followUp.ScheduledFor.Format(time.RFC3339Nano), FollowUpDepth: followUp.FollowUpDepth, MaxFollowUpTurns: followUp.MaxFollowUpTurns, SourceTurnID: followUp.SourceTurnID, SourceActionID: followUp.SourceActionID})
	}
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
