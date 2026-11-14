package runtimeagent

import "fmt"

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
		if err := validateConversationContextSelection(anchor.ConversationContext, len(anchor.CommittedTranscript)); err != nil {
			return nil, nil, false, err
		}
		read := &lifeConversationRead{AnchorID: anchor.ConversationAnchorID, Revision: conversationContextRevision(anchor.ConversationContext), FirstSequence: anchor.ConversationContext.FirstTurnSequence}
		var recent [publicChatRecentVerbatimTurnLimit]agentTurnTranscriptPairInput
		start := len(recent)
		// The Conversation owner already validated the immutable transcript at
		// admission/persistence. Read only enough complete pairs for Life.
		for i := len(anchor.CommittedTranscript) - 1; i >= int(read.FirstSequence) && start > 0; i-- {
			turn := anchor.CommittedTranscript[i]
			if pair, eligible := publicChatCommittedTranscriptPair(turn); eligible {
				pair.KnownAt = turn.CommittedAt
				start--
				recent[start] = pair
			}
		}
		return recent[start:], read, anchor.ConversationContext.OmitSupplementalContext, nil
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
