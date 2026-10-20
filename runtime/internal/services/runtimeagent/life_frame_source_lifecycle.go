package runtimeagent

import (
	"context"
	"fmt"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
)

// Caller serializes with the Memory lifecycle owner. Short qualification reads
// never invoke Recall, embeddings or inference while holding this lock.
func (s *Service) qualifyLifeState(ctx context.Context, ref string) (*agentEntry, error) {
	entry, err := s.agentByID(ref)
	if err != nil {
		return nil, err
	}
	read := entry.Life.MemoryReadSet
	if len(read.Refs) == 0 {
		return entry, nil
	}
	if s.cognitionMemoryFacade == nil {
		return nil, fmt.Errorf("life Memory qualification unavailable")
	}
	qualified, err := s.cognitionMemoryFacade.QualifyReadSet(ctx, ref, read)
	if err != nil {
		return nil, err
	}
	invalid := map[string]bool{}
	for _, r := range read.Refs {
		if !qualified[r] {
			invalid[r] = true
		}
	}
	if len(invalid) == 0 {
		return entry, nil
	}
	if err := s.invalidateLifeMemorySources(ref, invalid, false); err != nil {
		return nil, err
	}
	return s.agentByID(ref)
}

func (s *Service) invalidateLifeMemorySources(ref string, refs map[string]bool, all bool) error {
	s.invalidateConversationMemoryReads(ref, refs, all)
	return s.mutateAgent(ref, func(entry *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		l := entry.Life
		changed := l.invalidateMemory(refs, all)
		remaining := l.MemoryReadSet.Refs[:0]
		for _, r := range l.MemoryReadSet.Refs {
			if !all && !refs[r] {
				remaining = append(remaining, r)
			}
		}
		l.MemoryReadSet.Refs = remaining
		if changed {
			l.cancelFreeIntents("life")
			now := time.Now().UTC()
			if l.Current != nil && l.Current.Invalidated {
				l.interruptCurrent(now)
				l.NextCheckAt = now
			}
			l.reviewFuture(now)
			return nil, nil, l.changed()
		}
		return nil, nil, nil
	})
}

func mergeLifeReadSet(prior cognitionmemory.MemoryReadSet, recall cognitionmemory.MemoryReadSet, memories []agentTurnMemoryInput) (cognitionmemory.MemoryReadSet, []agentTurnMemoryInput) {
	read := prior
	if len(read.Refs) == 0 {
		read = recall
		read.Refs = nil
	}
	if len(prior.Refs) > 0 && len(recall.Refs) > 0 && (prior.BankRef != recall.BankRef || prior.BindingRef != recall.BindingRef || prior.LifecycleRef != recall.LifecycleRef) {
		return prior, nil
	}
	read.Refs = append([]string(nil), read.Refs...)
	seen := map[string]bool{}
	for _, ref := range read.Refs {
		seen[ref] = true
	}
	kept := make([]agentTurnMemoryInput, 0, len(memories))
	for _, memory := range memories {
		if !seen[memory.MemoryID] {
			if len(read.Refs) >= 64 {
				continue
			}
			read.Refs = append(read.Refs, memory.MemoryID)
			seen[memory.MemoryID] = true
		}
		kept = append(kept, memory)
	}
	return read, kept
}

func (s *Service) chatLifeContext(ctx context.Context, session publicChatAnchorState) *agentTurnLifeContextInput {
	s.cognitionMemoryOwnerLifecycleMu.Lock()
	defer s.cognitionMemoryOwnerLifecycleMu.Unlock()
	entry, err := s.qualifyLifeState(ctx, session.LocalAgentRef)
	if err != nil {
		entry, err = s.agentByID(session.LocalAgentRef)
		if err != nil {
			return nil
		}
		// Unavailable optional source material is excluded from this input;
		// uncertainty alone does not revoke accepted activity facts.
		entry.Life.Explanation = nil
		for _, a := range entry.Life.Activities {
			if len(a.MemoryRefs) > 0 {
				a.Title = "Activity"
				a.MemoryRefs = nil
			}
		}
		for _, f := range entry.Life.frames() {
			if len(f.MemoryRefs) > 0 {
				f.Title = "Activity"
				f.MemoryRefs = nil
			}
		}
	}
	selection := &lifeConversationRead{AnchorID: session.ConversationAnchorID, Revision: conversationContextRevision(session.ConversationContext), FirstSequence: session.ConversationContext.FirstTurnSequence}
	return projectLifeContext(entry.Life, false, session.ConversationContext.OmitSupplementalContext, selection, time.Now().UTC(), 1)
}
