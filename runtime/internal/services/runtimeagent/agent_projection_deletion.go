package runtimeagent

import (
	"database/sql"
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

// prepareAgentScopedChatSurfaceDeletionLocked removes the target Agent's chat
// projection while the caller holds chatSurfaceMu. It performs no I/O; the
// returned snapshot is persisted by the Memory-owned outer transaction. The
// caller invokes the collected cancels before committing so in-flight work
// cannot race a successfully deleted projection back into storage.
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

// agentProjectionPurgeHook physically deletes the runtime-agent-side
// projection rows the snapshot rewrite does NOT touch.
//
// Verified against internal/runtimepersistence/backend.go: persistSnapshot
// clears and reinserts only `runtime_local_agent`,
// `runtime_local_agent_state_projection`, `runtime_local_agent_hook`, and
// `runtime_local_agent_event_log`. The remaining agent-keyed runtime-agent
// tables persist independently and would otherwise be orphaned:
//   - `runtime_local_agent_behavioral_posture` (keyed local_agent_ref)
//   - `runtime_local_agent_review_run` (keyed local_agent_ref) — purged by ref,
//     which covers every review run the agent owns regardless of target bank.
//   - `runtime_local_agent_review_followup` (keyed bank_locator_key only) —
//     purged ONLY for the agent's own agent-core / agent-dyadic bank locator
//     keys. A review followup row for a shared world bank is account-scoped
//     truth wider than this agent and must not be deleted (K-AGCORE-141).
func agentProjectionPurgeHook(localAgentRef string, agentScopedBankLocatorKeys []string) runtimeAgentStateTxHook {
	ref := strings.TrimSpace(localAgentRef)
	if ref == "" {
		return nil
	}
	bankKeys := make([]string, 0, len(agentScopedBankLocatorKeys))
	seen := make(map[string]struct{}, len(agentScopedBankLocatorKeys))
	for _, key := range agentScopedBankLocatorKeys {
		trimmed := strings.TrimSpace(key)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		bankKeys = append(bankKeys, trimmed)
	}
	return func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM runtime_local_agent_behavioral_posture WHERE local_agent_ref = ?`, ref); err != nil {
			return fmt.Errorf("purge runtime_local_agent_behavioral_posture: %w", err)
		}
		if _, err := tx.Exec(`DELETE FROM runtime_local_agent_review_run WHERE local_agent_ref = ?`, ref); err != nil {
			return fmt.Errorf("purge runtime_local_agent_review_run: %w", err)
		}
		for _, bankKey := range bankKeys {
			if _, err := tx.Exec(`DELETE FROM runtime_local_agent_review_followup WHERE bank_locator_key = ?`, bankKey); err != nil {
				return fmt.Errorf("purge runtime_local_agent_review_followup: %w", err)
			}
		}
		return nil
	}
}
