package runtimeagent

import (
	"context"
	"fmt"

	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
)

func unionMemoryReadSet(a, b cognitionmemory.MemoryReadSet) (cognitionmemory.MemoryReadSet, error) {
	return mergeMemoryReadSets(a, b, 64)
}

func unionStoredMemoryReadSets(a, b cognitionmemory.MemoryReadSet) (cognitionmemory.MemoryReadSet, error) {
	return mergeMemoryReadSets(a, b, 8192)
}

func mergeMemoryReadSets(a, b cognitionmemory.MemoryReadSet, limit int) (cognitionmemory.MemoryReadSet, error) {
	if len(a.Refs) > limit || len(b.Refs) > limit {
		return a, fmt.Errorf("Memory read set exceeds context bound")
	}
	if len(a.Refs) == 0 {
		return b, nil
	}
	if len(b.Refs) == 0 {
		return a, nil
	}
	if a.BindingRef != b.BindingRef || a.BankRef != b.BankRef || a.LifecycleRef != b.LifecycleRef {
		return a, fmt.Errorf("Memory lifecycle changed between model rounds")
	}
	out := a
	out.Refs = append([]string(nil), a.Refs...)
	seen := map[string]bool{}
	for _, ref := range out.Refs {
		seen[ref] = true
	}
	for _, ref := range b.Refs {
		if !seen[ref] {
			seen[ref] = true
			out.Refs = append(out.Refs, ref)
		}
	}
	if len(out.Refs) > limit {
		return a, fmt.Errorf("Memory read set exceeds context bound")
	}
	return out, nil
}

func (s *Service) recordConversationMemoryReads(turnID string, compiled *agentTurnContextCompilation, pre cognitionmemory.MemoryReadSet, recall *agentTurnPrivateRecallInput, life *agentTurnLifeContextInput, session publicChatAnchorState, summary *agentTurnConversationSummaryInput) {
	actual := map[string]bool{}
	explanation := false
	var conversationRead *lifeConversationRead
	includeSequence := func(sequence uint64) {
		read := &lifeConversationRead{AnchorID: session.ConversationAnchorID, Revision: conversationContextRevision(session.ConversationContext), FirstSequence: sequence}
		conversationRead, _ = combineConversationReads(conversationRead, read)
	}
	for _, lane := range compiled.PrivateLanes {
		for _, item := range lane.Items {
			if !item.Included {
				continue
			}
			if lane.LaneID == agentTurnContextLaneCanonicalMemory {
				actual[item.SourceRef.RefID] = true
			}
			if lane.LaneID == agentTurnContextLaneConversationHistory {
				includeSequence(uint64(item.Rank))
			}
			if lane.LaneID == agentTurnContextLaneConversationSummary && summary != nil {
				includeSequence(summary.CoveredSequenceStart)
			}
			if lane.LaneID == agentTurnContextLaneLifeContext && item.StableID == "life.explanation" {
				explanation = true
			}
			if life != nil && lane.LaneID == agentTurnContextLaneLifeContext {
				var read *lifeConversationRead
				switch item.StableID {
				case "life.state":
					read = life.CoreConversationRead
				case "life.explanation":
					read = life.ExplanationConversationRead
				}
				if read != nil {
					includeSequence(read.FirstSequence)
				}
			}
		}
	}
	sets := []cognitionmemory.MemoryReadSet{pre}
	if recall != nil {
		sets = append(sets, recall.MemoryReadSet)
	}
	var read cognitionmemory.MemoryReadSet
	var err error
	if life != nil {
		read = life.CoreMemoryReadSet
	}
	for _, set := range sets {
		filtered := set
		filtered.Refs = nil
		for _, ref := range set.Refs {
			if actual[ref] {
				filtered.Refs = append(filtered.Refs, ref)
			}
		}
		read, err = unionMemoryReadSet(read, filtered)
		if err != nil {
			break
		}
	}
	if err == nil && explanation && life != nil {
		read, err = unionMemoryReadSet(read, life.MemoryReadSet)
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	if turn := s.chatTurns[turnID]; turn != nil {
		if life != nil {
			turn.LifeReadRevision = life.Revision
		}
		var contextErr error
		turn.ConversationRead, contextErr = combineConversationReads(turn.ConversationRead, conversationRead)
		if contextErr != nil {
			turn.MemorySourcesInvalid = true
		}
		if err == nil {
			turn.MemoryReadSet, err = unionMemoryReadSet(turn.MemoryReadSet, read)
		}
		if err != nil {
			turn.MemorySourcesInvalid = true
		}
	}
}

// The caller holds cognitionMemoryOwnerLifecycleMu through its later commit.
func (s *Service) qualifyConversationMemoryReads(ctx context.Context, ref, turnID string) error {
	s.chatSurfaceMu.Lock()
	turn := s.chatTurns[turnID]
	var read cognitionmemory.MemoryReadSet
	invalid := false
	if turn != nil {
		read = turn.MemoryReadSet
		invalid = turn.MemorySourcesInvalid
		invalid = invalid || !s.lifeConversationReadCurrentLocked(turn.ConversationRead)
	}
	s.chatSurfaceMu.Unlock()
	if invalid {
		return fmt.Errorf("Conversation Memory sources changed")
	}
	if len(read.Refs) == 0 {
		return nil
	}
	if s.cognitionMemoryFacade == nil {
		return fmt.Errorf("Conversation Memory qualification unavailable")
	}
	qualified, err := s.cognitionMemoryFacade.QualifyReadSet(ctx, ref, read)
	if err != nil {
		return err
	}
	if len(qualified) != len(read.Refs) {
		return fmt.Errorf("Conversation Memory sources changed")
	}
	return nil
}

func (s *Service) invalidateConversationMemoryReads(ref string, refs map[string]bool, all bool) {
	s.chatSurfaceMu.Lock()
	var cancels []context.CancelFunc
	if work := s.backgroundByAgent[ref]; work != nil {
		for _, memoryRef := range work.memoryRefs {
			if all || refs[memoryRef] {
				work.invalidated = true
				cancels = append(cancels, work.cancel)
				break
			}
		}
	}
	for _, turn := range s.chatTurns {
		if turn.AgentID != ref {
			continue
		}
		for _, memoryRef := range turn.MemoryReadSet.Refs {
			if all || refs[memoryRef] {
				turn.MemorySourcesInvalid = true
				if turn.Cancel != nil {
					cancels = append(cancels, turn.Cancel)
				}
				break
			}
		}
	}
	s.chatSurfaceMu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}
