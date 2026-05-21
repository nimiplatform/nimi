package runtimeagent

import (
	"database/sql"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// deleteAgent forwards to the agent state runtime hard delete. See
// agentStateRuntime.deleteAgent for the K-AGCORE-141 semantics.
func (s *Service) deleteAgent(localAgentRef string, txHook runtimeAgentStateTxHook, liveEvents ...*runtimev1.AgentEvent) error {
	return s.agentStateRuntime().deleteAgent(localAgentRef, txHook, liveEvents...)
}

// purgeAgentScopedChatSurfaceState cancels every in-flight chat turn and armed
// follow-up for localAgentRef and removes the agent's ConversationAnchor /
// turn / follow-up projection from the public chat surface, then persists the
// surface state.
//
// This satisfies the K-AGCORE-141 requirement to cancel in-flight execution
// before the projection row is removed: a public chat turn owns a cancelable
// execution context and a follow-up owns an armed timer context, so deletion
// must not strand them. The anchors/turns/follow-ups themselves are per-agent
// projection that would otherwise reference a deleted local_agent_ref, so they
// are removed in the same pass to avoid an orphaned chat projection.
func (s *Service) purgeAgentScopedChatSurfaceState(localAgentRef string) {
	ref := strings.TrimSpace(localAgentRef)
	if ref == "" {
		return
	}
	cancels := make([]func(), 0)
	s.chatSurfaceMu.Lock()
	for turnID, turn := range s.chatTurns {
		if turn == nil || strings.TrimSpace(turn.AgentID) != ref {
			continue
		}
		if turn.Cancel != nil {
			cancels = append(cancels, turn.Cancel)
		}
		delete(s.chatTurns, turnID)
	}
	for followUpID, followUp := range s.chatFollowUps {
		if followUp == nil || strings.TrimSpace(followUp.AgentID) != ref {
			continue
		}
		if followUp.Cancel != nil {
			cancels = append(cancels, followUp.Cancel)
		}
		delete(s.chatFollowUps, followUpID)
	}
	for anchorID, anchor := range s.chatAnchors {
		if anchor == nil {
			continue
		}
		if strings.TrimSpace(anchor.AgentID) != ref && strings.TrimSpace(anchor.LocalAgentRef) != ref {
			continue
		}
		delete(s.chatAnchors, anchorID)
	}
	delete(s.chatActiveByAgent, ref)
	for instanceID, binding := range s.avatarLiveInstanceBindings {
		if binding == nil {
			continue
		}
		if strings.TrimSpace(binding.AgentID) != ref && strings.TrimSpace(binding.LocalAgentRef) != ref {
			continue
		}
		delete(s.avatarLiveInstanceBindings, instanceID)
	}
	s.chatSurfaceMu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
	s.persistCurrentPublicChatSurfaceState()
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
