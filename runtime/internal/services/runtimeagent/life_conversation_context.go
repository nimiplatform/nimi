package runtimeagent

import (
	"fmt"
)

func combineConversationReads(a, b *lifeConversationRead) (*lifeConversationRead, error) {
	if a == nil {
		return b, nil
	}
	if b == nil {
		return a, nil
	}
	if a.AnchorID != b.AnchorID || a.Revision != b.Revision {
		return nil, fmt.Errorf("Conversation context changed between reads")
	}
	out := *a
	out.FirstSequence = min(a.FirstSequence, b.FirstSequence)
	return &out, nil
}

func (s *Service) lifeConversationSelection(ref string) *lifeConversationRead {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	for _, anchor := range s.chatAnchors {
		if anchor.LocalAgentRef == ref && conversationAnchorIsResumable(anchor.Status) {
			return &lifeConversationRead{AnchorID: anchor.ConversationAnchorID, Revision: conversationContextRevision(anchor.ConversationContext), FirstSequence: anchor.ConversationContext.FirstTurnSequence}
		}
	}
	return nil
}

func (s *Service) lifeConversationInput(ref string) ([]agentTurnTranscriptPairInput, *lifeConversationRead, bool, error) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	for _, anchor := range s.chatAnchors {
		if anchor.LocalAgentRef != ref || !conversationAnchorIsResumable(anchor.Status) {
			continue
		}
		transcript, err := selectedCommittedTranscript(anchor)
		if err != nil {
			return nil, nil, false, err
		}
		transcript = transcript[max(0, len(transcript)-publicChatRecentVerbatimTurnLimit):]
		read := &lifeConversationRead{AnchorID: anchor.ConversationAnchorID, Revision: conversationContextRevision(anchor.ConversationContext), FirstSequence: anchor.ConversationContext.FirstTurnSequence}
		known := make(map[string]publicChatCommittedTranscriptTurn, len(anchor.CommittedTranscript))
		for _, turn := range anchor.CommittedTranscript {
			known[turn.TurnID] = turn
		}
		for i := range transcript {
			// This content time is immutable; late usage and UI projection
			// updates cannot turn old dialogue into newly learned content.
			// Missing historical times stay unknown, never inferred.
			transcript[i].KnownAt = known[transcript[i].TurnID].CommittedAt
		}
		return transcript, read, anchor.ConversationContext.OmitSupplementalContext, nil
	}
	return nil, nil, false, nil
}

func sourceConversationAllowed(source, selection *lifeConversationRead) bool {
	return source == nil || selection != nil && source.AnchorID == selection.AnchorID && source.FirstSequence >= selection.FirstSequence
}

func projectConversationRead(source, selection *lifeConversationRead) *lifeConversationRead {
	if source == nil || !sourceConversationAllowed(source, selection) {
		return nil
	}
	out := *source
	out.Revision = selection.Revision
	return &out
}

func (s *Service) lifeConversationReadCurrentLocked(read *lifeConversationRead) bool {
	if read == nil {
		return true
	}
	anchor := s.chatAnchors[read.AnchorID]
	return anchor != nil && conversationContextRevision(anchor.ConversationContext) == read.Revision && anchor.ConversationContext.FirstTurnSequence <= read.FirstSequence
}
