package runtimeagent

import (
	"fmt"
	"time"
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

func (s *Service) lifeConversationInput(ref string) ([]agentTurnTranscriptPairInput, *lifeConversationRead, time.Time, bool, error) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	for _, anchor := range s.chatAnchors {
		if anchor.LocalAgentRef != ref || !conversationAnchorIsResumable(anchor.Status) {
			continue
		}
		transcript, err := selectedCommittedTranscript(anchor)
		if err != nil {
			return nil, nil, time.Time{}, false, err
		}
		transcript = transcript[max(0, len(transcript)-publicChatRecentVerbatimTurnLimit):]
		read := &lifeConversationRead{AnchorID: anchor.ConversationAnchorID, Revision: conversationContextRevision(anchor.ConversationContext), FirstSequence: anchor.ConversationContext.FirstTurnSequence}
		// UpdatedAt is an owner-held conservative bound for this snapshot,
		// including the completed assistant text. It is never model supplied.
		return transcript, read, anchor.UpdatedAt, anchor.ConversationContext.OmitSupplementalContext, nil
	}
	return nil, nil, time.Time{}, false, nil
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
