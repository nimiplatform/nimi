package runtimeagent

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

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
		if action.Modality == "follow-up-turn" {
			return action
		}
	}
	return nil
}
