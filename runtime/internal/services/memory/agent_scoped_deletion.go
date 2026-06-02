package memory

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// DeleteAgentScopedBanks hard-deletes every memory bank owned by the supplied
// agent: the singular `MEMORY_BANK_SCOPE_AGENT_CORE` bank and every
// `MEMORY_BANK_SCOPE_AGENT_DYADIC` bank keyed `(agentId, userId)`. This is the
// memory half of the K-AGCORE-141 LocalAgent projection hard delete.
//
// `RuntimeAgentService.TerminateAgent` owns the runtime-agent row half; this
// method is the agent-scoped memory counterpart and is internal-only: there is
// no public `DeleteBank` path for agent-scoped banks because
// `fullLocatorFromPublic` admits only app/workspace-private scopes.
//
// The bank removal and the `bank_locator_key`/`locator_key` keyed projection
// purge run inside one persisted snapshot transaction. `persistSnapshot`
// rewrites `memory_bank` / `memory_record` / `memory_record_fts` /
// `memory_record_embedding` / `memory_replication_backlog` from in-memory
// state, so removing the bank from `s.banks` excludes those tables. The
// narrative / truth / relation / recall-feedback / review tables are NOT
// snapshot-rewritten — they persist independently keyed by the bank locator
// key — so a tx hook physically deletes their rows. Leaving them would be the
// orphaned partial deletion K-AGCORE-141 forbids.
//
// Substrate failure fails closed: if persistence fails, the in-memory bank set
// is rolled back and a typed error is returned. An agent with no materialized
// banks is a typed no-op (idempotent).
//
// It returns the sorted bank locator keys that were removed so the caller can
// purge any caller-owned tables keyed by those same locator keys inside its
// own deletion transaction.
func (s *Service) DeleteAgentScopedBanks(ctx context.Context, agentID string) ([]string, error) {
	trimmedAgentID := strings.TrimSpace(agentID)
	if trimmedAgentID == "" {
		return nil, fmt.Errorf("delete agent-scoped banks: agent id is required")
	}

	corePrefix := "agent-core::" + trimmedAgentID
	dyadicPrefix := "agent-dyadic::" + trimmedAgentID + "::"

	s.mu.Lock()
	defer s.mu.Unlock()

	removedKeys := make([]string, 0)
	removedStates := make(map[string]*bankState)
	for key, state := range s.banks {
		if state == nil || state.Bank == nil {
			continue
		}
		if !agentScopedBankKeyMatches(key, state.Bank.GetLocator(), trimmedAgentID, corePrefix, dyadicPrefix) {
			continue
		}
		removedKeys = append(removedKeys, key)
		removedStates[key] = state
	}
	if len(removedKeys) == 0 {
		return nil, nil
	}
	sort.Strings(removedKeys)

	previousSequence := s.sequence
	previousBacklog := make(map[string]*ReplicationBacklogItem)
	for backlogKey, item := range s.replicationBacklog {
		if item == nil {
			continue
		}
		if _, ok := removedStates[locatorKey(item.Locator)]; !ok {
			continue
		}
		previousBacklog[backlogKey] = cloneReplicationBacklogItem(item)
	}

	events := make([]*runtimev1.MemoryEvent, 0, len(removedKeys))
	for _, key := range removedKeys {
		state := removedStates[key]
		delete(s.banks, key)
		s.removeReplicationBacklogForBankLocked(key)
		event := &runtimev1.MemoryEvent{
			EventType: runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_BANK_DELETED,
			Bank:      cloneLocator(state.Bank.GetLocator()),
			Timestamp: timestamppb.New(s.now().UTC()),
			Detail: &runtimev1.MemoryEvent_BankDeleted{
				BankDeleted: cloneBank(state.Bank),
			},
		}
		s.assignSequenceLocked(event)
		events = append(events, event)
	}

	if err := s.persistLockedWithTxHook(agentScopedBankProjectionPurgeHook(removedKeys)); err != nil {
		for key, state := range removedStates {
			s.banks[key] = state
		}
		for backlogKey, item := range previousBacklog {
			s.replicationBacklog[backlogKey] = item
		}
		s.sequence = previousSequence
		return nil, fmt.Errorf("delete agent-scoped banks: %w", err)
	}

	targetsByEvent := make([][]*subscriber, 0, len(events))
	for _, event := range events {
		targetsByEvent = append(targetsByEvent, s.matchingSubscribersLocked(event))
	}
	for i, event := range events {
		s.broadcast(event, targetsByEvent[i])
	}
	return removedKeys, nil
}

// agentScopedBankKeyMatches reports whether a bank locator key belongs to the
// supplied agent. It verifies both the locator key prefix and the decoded
// locator owner so a user-id that itself contains "::" cannot let a foreign
// dyadic bank match by raw string prefix alone.
func agentScopedBankKeyMatches(key string, locator *runtimev1.MemoryBankLocator, agentID, corePrefix, dyadicPrefix string) bool {
	if locator == nil {
		return false
	}
	switch locator.GetScope() {
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE:
		return key == corePrefix && strings.TrimSpace(locator.GetAgentCore().GetAgentId()) == agentID
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC:
		return strings.HasPrefix(key, dyadicPrefix) && strings.TrimSpace(locator.GetAgentDyadic().GetAgentId()) == agentID
	default:
		return false
	}
}

// agentScopedBankProjectionPurgeHook physically deletes every row keyed by the
// removed bank locator keys from the projection tables that
// `persistSnapshotWithTxHook` does NOT rewrite from in-memory bank state.
//
// Verified against the runtime sqlite schema in
// internal/runtimepersistence/backend.go: the snapshot rewrite clears and
// reinserts only `memory_bank`, `memory_record`, `memory_record_fts`,
// `memory_record_embedding`, and `memory_replication_backlog`. Every other
// table carrying a `bank_locator_key` or `locator_key` column is purged here.
func agentScopedBankProjectionPurgeHook(bankLocatorKeys []string) persistTxHook {
	keys := uniqueTrimmedStrings(bankLocatorKeys)
	if len(keys) == 0 {
		return nil
	}
	// bankLocatorKeyColumn maps each table to the column carrying the bank
	// locator key. memory_record* / memory_bank / memory_replication_backlog
	// are intentionally absent: the snapshot rewrite already drops them when a
	// bank leaves s.banks.
	bankLocatorKeyColumn := []struct {
		table  string
		column string
	}{
		{"memory_narrative", "bank_locator_key"},
		{"memory_narrative_embedding", "locator_key"},
		{"memory_narrative_alias", "bank_locator_key"},
		{"narrative_source", "bank_locator_key"},
		{"memory_relation", "bank_locator_key"},
		{"memory_recall_feedback_event", "bank_locator_key"},
		{"memory_recall_feedback_summary", "bank_locator_key"},
		{"agent_truth", "bank_locator_key"},
		{"truth_source", "bank_locator_key"},
		{"memory_review_commit", "bank_locator_key"},
		{"memory_review_checkpoint", "bank_locator_key"},
		{"memory_embedding_intent", "locator_key"},
	}
	args := stringsSliceToAny(keys)
	placeholders := sqlPlaceholders(len(keys))
	return func(ctx context.Context, tx *sql.Tx) error {
		for _, target := range bankLocatorKeyColumn {
			stmt := fmt.Sprintf(`DELETE FROM %s WHERE %s IN (%s)`, target.table, target.column, placeholders)
			if _, err := tx.ExecContext(ctx, stmt, args...); err != nil {
				return fmt.Errorf("purge agent-scoped %s rows: %w", target.table, err)
			}
		}
		return nil
	}
}
