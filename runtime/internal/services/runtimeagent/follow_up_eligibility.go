package runtimeagent

import "time"

const publicChatFollowUpGrace = 30 * time.Minute

func followUpSourceSelected(anchor *publicChatAnchorState, sourceTurnID string) bool {
	if anchor == nil {
		return false
	}
	for _, turn := range anchor.CommittedTranscript {
		if turn.TurnID == sourceTurnID {
			return turn.Sequence >= anchor.ConversationContext.FirstTurnSequence
		}
	}
	return false
}

// A continuation stays short-lived. Deferred work is reconsidered by the
// existing cheap maintenance sweep, without another planner or model call.
func (s *Service) maintainPublicChatFollowUps(now time.Time) {
	s.mu.RLock()
	s.chatSurfaceMu.Lock()
	var ready []*publicChatFollowUpState
	var expired []*publicChatFollowUpState
	for _, f := range s.chatFollowUps {
		anchor := s.chatAnchors[f.ConversationAnchorID]
		if anchor == nil {
			continue
		}
		if now.After(f.ScheduledFor.Add(publicChatFollowUpGrace)) || !followUpSourceSelected(anchor, f.SourceTurnID) {
			expired = append(expired, f)
			continue
		}
		if !f.Armed && anchor.ActiveTurnID == "" && lifeContactAllowed(s.agents[anchor.LocalAgentRef], now) {
			ready = append(ready, f)
		}
	}
	s.chatSurfaceMu.Unlock()
	s.mu.RUnlock()
	for _, f := range expired {
		if _, err := s.cancelExpectedPublicChatFollowUp(f.ConversationAnchorID, f.FollowUpID, "follow_up_expired_or_source_excluded", true); err != nil && s.logger != nil {
			s.logger.Warn("follow-up cleanup failed", "error", err)
		}
	}
	for _, f := range ready {
		s.armPublicChatFollowUp(f)
	}
}
