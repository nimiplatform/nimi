package runtimeagent

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// agentChatSurfaceDeletionRollback is a shallow snapshot of the Runtime-owned
// chat maps. Hard deletion only removes map entries, so retaining the original
// pointers is sufficient to restore the exact pre-transaction in-memory state
// when the shared SQLite commit fails.
type agentChatSurfaceDeletionRollback struct {
	version        uint64
	anchors        map[string]*publicChatAnchorState
	turns          map[string]*publicChatTurnState
	followUps      map[string]*publicChatFollowUpState
	activeByAgent  map[string]string
	avatarBindings map[string]*avatarLiveInstanceBindingState
}

func (s *Service) beginAgentTerminationFence(localAgentRef string) {
	ref := strings.TrimSpace(localAgentRef)
	if s == nil || ref == "" {
		return
	}
	s.chatSurfaceMu.Lock()
	if s.chatTerminatingAgents == nil {
		s.chatTerminatingAgents = make(map[string]uint32)
	}
	s.chatTerminatingAgents[ref]++
	s.chatSurfaceMu.Unlock()
}

func (s *Service) endAgentTerminationFence(localAgentRef string) {
	ref := strings.TrimSpace(localAgentRef)
	if s == nil || ref == "" {
		return
	}
	s.chatSurfaceMu.Lock()
	if count := s.chatTerminatingAgents[ref]; count > 1 {
		s.chatTerminatingAgents[ref] = count - 1
	} else {
		delete(s.chatTerminatingAgents, ref)
	}
	s.chatSurfaceMu.Unlock()
}

func (s *Service) agentTerminationFencedLocked(localAgentRef string) bool {
	return s.chatTerminatingAgents[strings.TrimSpace(localAgentRef)] > 0
}

// fenceAgentChatExecutionForTerminationLocked closes the target Agent's
// execution generations before Cognition or durable Runtime deletion starts.
// The caller holds Service.mu, preventing new Agent admission; chatSurfaceMu
// serializes the interrupted flag with the irreversible transcript commit
// check. Conversation and the last valid summary remain intact when a later
// delete prerequisite fails, but the canceled execution cannot commit late.
func (s *Service) fenceAgentChatExecutionForTerminationLocked(localAgentRef string) ([]func(), []*publicChatConversationSummaryJob) {
	ref := strings.TrimSpace(localAgentRef)
	if ref == "" {
		return nil, nil
	}
	s.chatSurfaceMu.Lock()
	cancels := make([]func(), 0)
	for _, turn := range s.chatTurns {
		if turn == nil || strings.TrimSpace(turn.AgentID) != ref {
			continue
		}
		turn.Interrupted = true
		turn.InterruptReason = "room_closed"
		if turn.Cancel != nil {
			cancels = append(cancels, turn.Cancel)
		}
	}
	for _, followUp := range s.chatFollowUps {
		if followUp == nil || strings.TrimSpace(followUp.AgentID) != ref || followUp.Cancel == nil {
			continue
		}
		cancels = append(cancels, followUp.Cancel)
	}
	summaryJobs := s.detachAgentPublicChatConversationSummaryJobsLocked(ref)
	s.chatSurfaceMu.Unlock()
	return cancels, summaryJobs
}

// prepareAgentScopedChatSurfaceDeletionLocked removes the target Agent's chat
// projection while the caller holds chatSurfaceMu. It performs no I/O; the
// returned snapshot is persisted by the Runtime-owned outer transaction. The
// caller has already established the Agent execution fence; the collected
// cancel/release functions finish any remaining owned resources after the
// atomic commit without permitting a late projection write.
func (s *Service) prepareAgentScopedChatSurfaceDeletionLocked(localAgentRef string) (
	persistedPublicChatSurfaceState,
	[]string,
	[]func(),
	agentChatSurfaceDeletionRollback,
	error,
) {
	ref := strings.TrimSpace(localAgentRef)
	rollback := s.captureAgentChatSurfaceDeletionRollbackLocked()
	if ref == "" {
		return persistedPublicChatSurfaceState{}, nil, nil, rollback, fmt.Errorf("agent chat deletion local_agent_ref is required")
	}
	cancels := make([]func(), 0)
	anchorIDs := make([]string, 0)
	changed := false
	for turnID, turn := range s.chatTurns {
		if turn == nil || strings.TrimSpace(turn.AgentID) != ref {
			continue
		}
		if turn.Cancel != nil {
			cancels = append(cancels, turn.Cancel)
		}
		if turn.BindingRelease != nil {
			cancels = append(cancels, turn.BindingRelease)
			turn.BindingRelease = nil
		}
		delete(s.chatTurns, turnID)
		changed = true
	}
	for followUpID, followUp := range s.chatFollowUps {
		if followUp == nil || strings.TrimSpace(followUp.AgentID) != ref {
			continue
		}
		if followUp.Cancel != nil {
			cancels = append(cancels, followUp.Cancel)
		}
		delete(s.chatFollowUps, followUpID)
		changed = true
	}
	for anchorID, anchor := range s.chatAnchors {
		if anchor == nil {
			continue
		}
		if strings.TrimSpace(anchor.AgentID) != ref && strings.TrimSpace(anchor.LocalAgentRef) != ref {
			continue
		}
		delete(s.chatAnchors, anchorID)
		anchorIDs = append(anchorIDs, anchorID)
		changed = true
	}
	if _, exists := s.chatActiveByAgent[ref]; exists {
		delete(s.chatActiveByAgent, ref)
		changed = true
	}
	for instanceID, binding := range s.avatarLiveInstanceBindings {
		if binding == nil {
			continue
		}
		if strings.TrimSpace(binding.AgentID) != ref && strings.TrimSpace(binding.LocalAgentRef) != ref {
			continue
		}
		delete(s.avatarLiveInstanceBindings, instanceID)
		changed = true
	}
	if changed {
		if s.chatSurfaceVersion == math.MaxUint64 {
			s.restoreAgentChatSurfaceDeletionLocked(rollback)
			return persistedPublicChatSurfaceState{}, nil, nil, rollback, fmt.Errorf("public chat surface version exhausted")
		}
		s.chatSurfaceVersion++
	}
	snapshot, err := s.capturePublicChatSurfaceSnapshotLocked()
	if err != nil {
		s.restoreAgentChatSurfaceDeletionLocked(rollback)
		return persistedPublicChatSurfaceState{}, nil, nil, rollback, err
	}
	sort.Strings(anchorIDs)
	return snapshot, anchorIDs, cancels, rollback, nil
}

func (s *Service) captureAgentChatSurfaceDeletionRollbackLocked() agentChatSurfaceDeletionRollback {
	rollback := agentChatSurfaceDeletionRollback{
		version:        s.chatSurfaceVersion,
		anchors:        make(map[string]*publicChatAnchorState, len(s.chatAnchors)),
		turns:          make(map[string]*publicChatTurnState, len(s.chatTurns)),
		followUps:      make(map[string]*publicChatFollowUpState, len(s.chatFollowUps)),
		activeByAgent:  make(map[string]string, len(s.chatActiveByAgent)),
		avatarBindings: make(map[string]*avatarLiveInstanceBindingState, len(s.avatarLiveInstanceBindings)),
	}
	for key, value := range s.chatAnchors {
		rollback.anchors[key] = value
	}
	for key, value := range s.chatTurns {
		rollback.turns[key] = value
	}
	for key, value := range s.chatFollowUps {
		rollback.followUps[key] = value
	}
	for key, value := range s.chatActiveByAgent {
		rollback.activeByAgent[key] = value
	}
	for key, value := range s.avatarLiveInstanceBindings {
		rollback.avatarBindings[key] = value
	}
	return rollback
}

func (s *Service) restoreAgentChatSurfaceDeletionLocked(rollback agentChatSurfaceDeletionRollback) {
	s.chatSurfaceVersion = rollback.version
	s.chatAnchors = rollback.anchors
	s.chatTurns = rollback.turns
	s.chatFollowUps = rollback.followUps
	s.chatActiveByAgent = rollback.activeByAgent
	s.avatarLiveInstanceBindings = rollback.avatarBindings
}
