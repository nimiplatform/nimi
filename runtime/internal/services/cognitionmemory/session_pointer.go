package cognitionmemory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	sessionPointerMilestoneCooldown = 30 * time.Minute
	maxPointerThrottleEntries       = 2048
)

type sessionPointerThrottleKey struct {
	localAgentRef  string
	workSessionRef string
}

type sessionPointerThrottleState struct {
	lastCommittedAt time.Time
	lastSummary     string
}

func isTaintedSessionPointerSource(bodyKind string) bool {
	kind := strings.ToLower(strings.TrimSpace(bodyKind))
	return kind == "" ||
		kind == "channel_external" ||
		strings.Contains(kind, "external") ||
		strings.Contains(kind, "untrusted") ||
		strings.Contains(kind, "tainted")
}

// CommitSessionPointer enqueues and drains a single-slot `session_pointer_committed`
// fact for (localAgentRef, workSessionRef), enforcing v2.1's milestone throttle
// and source taint gating:
//   - "initial_goal" / "completed" / "archived" always commit immediately
//   - incremental updates require real topic change AND >= 30 minutes since last commit
//   - external / untrusted sources are rejected before entering Cognition memory
//
// @nimi-authority: rule.nimi.cognition.runtime-bridge.session-pointer-and-delete-session
func (f *Facade) CommitSessionPointer(
	ctx context.Context,
	localAgentRef string,
	workSessionRef string,
	milestoneKind string,
	topicSummary string,
	bodyKind string,
	now time.Time,
) (bool, error) {
	if f == nil || f.store == nil || f.owner == nil || f.bridge == nil {
		return false, nil
	}
	summary := strings.TrimSpace(topicSummary)
	if !validRef(localAgentRef) || !validRef(workSessionRef) || summary == "" {
		return false, nil
	}
	if isTaintedSessionPointerSource(bodyKind) {
		return false, nil
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	milestone := strings.ToLower(strings.TrimSpace(milestoneKind))
	isBypassMilestone := milestone == "initial_goal" || milestone == "completed" || milestone == "archived"

	unlock := f.bridge.lockAgent(localAgentRef)
	defer unlock()

	key := sessionPointerThrottleKey{localAgentRef: localAgentRef, workSessionRef: workSessionRef}
	f.pointerThrottleMu.Lock()
	if f.pointerThrottleCache == nil {
		f.pointerThrottleCache = make(map[sessionPointerThrottleKey]sessionPointerThrottleState)
	}
	prev, seen := f.pointerThrottleCache[key]
	if seen && !isBypassMilestone {
		if prev.lastSummary == summary || now.Sub(prev.lastCommittedAt) < sessionPointerMilestoneCooldown {
			f.pointerThrottleMu.Unlock()
			return false, nil
		}
	}
	f.pointerThrottleMu.Unlock()

	binding, err := f.store.BindingForAgent(ctx, localAgentRef)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	if cutOff, cutoffErr := f.store.IsDeletedSessionCutoff(ctx, localAgentRef, workSessionRef); cutoffErr != nil {
		return false, cutoffErr
	} else if cutOff {
		return false, nil
	}
	if !binding.Enabled || binding.AdoptionRequired {
		return false, nil
	}
	if binding.BankRef != "" {
		cutOff, cutoffErr := f.owner.IsSessionCutoff(ctx, binding.BindingRef, binding.BankRef, workSessionRef)
		if cutoffErr != nil {
			return false, cutoffErr
		}
		if cutOff {
			return false, nil
		}
	}
	if err := f.authorize(ctx, binding); err != nil {
		return false, err
	}

	slotKey := "session_ref:" + workSessionRef
	eventRef := "cmevt_" + ulid.Make().String()
	operationID := "cmop_" + ulid.Make().String()
	envelope := &runtimev1.CognitionMemoryCommittedEventEnvelope{
		Event:       &runtimev1.CognitionMemoryEventRef{Value: eventRef},
		Operation:   &runtimev1.CognitionMemoryOperationRef{Value: operationID},
		Subjects:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: binding.AccountSubjectRef}},
		Sources:     []*runtimev1.CognitionMemorySourceRef{{Kind: "session", Value: workSessionRef}},
		CommittedAt: timestamppb.New(now.UTC()),
		Fact: &runtimev1.CognitionMemoryCommittedEventEnvelope_SessionPointerCommitted{
			SessionPointerCommitted: &runtimev1.CognitionMemorySessionPointerCommitted{
				WorkSessionRef: workSessionRef,
				ScopeTag:       memoryv1.ScopeTagSessionPointer,
				SlotKey:        slotKey,
				TopicSummary:   summary,
				BodyKind:       strings.TrimSpace(bodyKind),
			},
		},
	}

	if err := f.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := f.store.EnqueueCommittedEventTx(tx, localAgentRef, envelope)
		return err
	}); err != nil {
		if errors.Is(err, ErrMemoryDisabled) {
			return false, nil
		}
		return false, err
	}

	// Drain & commit the session pointer through the standard custody pipeline.
	for {
		drained, err := f.bridge.drainOneLocked(ctx, localAgentRef)
		if err != nil {
			return false, fmt.Errorf("commit session pointer drain: %w", err)
		}
		if !drained.Drained {
			return false, nil
		}
		if drained.Outcome != memoryv1.OutcomeNoEffect {
			result, err := f.processRememberLocked(ctx, localAgentRef, drained.OperationID)
			if err != nil {
				return false, fmt.Errorf("commit session pointer remember: %w", err)
			}
			if drained.OperationID == operationID && result.Outcome == memoryv1.OutcomeNoEffect {
				return false, nil
			}
		} else if drained.OperationID == operationID {
			return false, nil
		}
		if drained.OperationID == operationID {
			break
		}
	}

	f.pointerThrottleMu.Lock()
	if f.pointerThrottleCache == nil {
		f.pointerThrottleCache = make(map[sessionPointerThrottleKey]sessionPointerThrottleState)
	}
	if len(f.pointerThrottleCache) >= maxPointerThrottleEntries {
		for k := range f.pointerThrottleCache {
			delete(f.pointerThrottleCache, k)
			if len(f.pointerThrottleCache) < maxPointerThrottleEntries/2 {
				break
			}
		}
	}
	f.pointerThrottleCache[key] = sessionPointerThrottleState{
		lastCommittedAt: now.UTC(),
		lastSummary:     summary,
	}
	f.pointerThrottleMu.Unlock()
	return true, nil
}

// ForgetSessionLineage implements v2.1's anti-resurrection DeleteSession memory
// cleanup sequence under the per-agent lifecycle lock:
//  1. Neutralize all pending runtime_cognition_memory_outbox rows linked to
//     (source_kind='session', source_ref=workSessionRef) with
//     state='cutoff_non_effecting' and payload=NULL FIRST.
//  2. Neutralize any already-received (not yet remembered) memory_receipts in
//     Cognition matching that session so in-flight drains cannot resurrect it.
//  3. Settle any head cutoff_non_effecting outbox rows via zero-payload NoOpCutoff
//     so received_frontier/ready_frontier/delivery_frontier advance with zero gap.
//  4. Query memory_lineage(ref_type='source', ref_kind='session', ref_value=workSessionRef)
//     and atomically forget all committed memories through Facade.Forget.
//
// @nimi-authority: rule.nimi.cognition.runtime-bridge.session-pointer-and-delete-session
func (f *Facade) ForgetSessionLineage(ctx context.Context, localAgentRef, workSessionRef string) (uint32, int64, error) {
	if f == nil || f.store == nil || f.owner == nil || !validRef(localAgentRef) || !validRef(workSessionRef) {
		return 0, 0, nil
	}
	unlock := func() {}
	if f.bridge != nil {
		unlock = f.bridge.lockAgent(localAgentRef)
	}
	defer unlock()

	// Commit the Runtime cutoff and neutralize queued payloads in a single transaction.
	neutralized, err := f.store.NeutralizeSessionOutbox(ctx, localAgentRef, workSessionRef)
	if err != nil {
		return 0, 0, err
	}

	binding, err := f.store.BindingForAgent(ctx, localAgentRef)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, neutralized, nil
		}
		return 0, neutralized, err
	}
	if binding.BankRef == "" {
		return 0, neutralized, nil
	}
	if err := f.authorize(ctx, binding); err != nil {
		return 0, neutralized, err
	}

	// Step 1.5: Persist irreversible session deletion cutoff inside memory.db
	// so late CommitSessionPointer calls or in-flight receipts can never
	// resurrect this deleted session.
	if err := f.owner.RecordSessionCutoff(ctx, binding.BindingRef, binding.BankRef, workSessionRef); err != nil {
		return 0, neutralized, err
	}

	// Step 4: Look up all committed memory_refs via memory_lineage.
	refs, err := f.owner.FindMemoryRefsBySource(ctx, binding.BindingRef, binding.BankRef, "session", workSessionRef)
	if err != nil {
		return 0, neutralized, err
	}
	if len(refs) > 0 {
		n, err := f.store.neutralizeSessionCorrections(ctx, localAgentRef, refs)
		if err != nil {
			return 0, neutralized, err
		}
		neutralized += n
	}

	// Step 2: Neutralize any already-received or processing receipts in Cognition.
	neutralizedReceipts, err := f.owner.NeutralizePendingReceiptsBySource(ctx, binding.BindingRef, binding.BankRef, "session", workSessionRef)
	if err != nil {
		return 0, neutralized, err
	}
	neutralized += neutralizedReceipts

	// Step 3: Settle any head neutralized outbox rows so frontiers stay contiguous.
	if f.bridge != nil && binding.Enabled && !binding.AdoptionRequired {
		for {
			nextItem, nextErr := f.store.NextPending(ctx, binding.BindingRef)
			if nextErr != nil && !errors.Is(nextErr, sql.ErrNoRows) {
				return 0, neutralized, nextErr
			}
			if errors.Is(nextErr, sql.ErrNoRows) || nextItem.State != "cutoff_non_effecting" {
				break
			}
			if _, drainErr := f.bridge.drainOneLocked(ctx, localAgentRef); drainErr != nil {
				return 0, neutralized, drainErr
			}
		}
	}

	clearThrottle := func() {
		f.pointerThrottleMu.Lock()
		delete(f.pointerThrottleCache, sessionPointerThrottleKey{localAgentRef: localAgentRef, workSessionRef: workSessionRef})
		f.pointerThrottleMu.Unlock()
	}
	if len(refs) == 0 {
		_ = f.store.disposeSettledOutboxCopies(ctx, localAgentRef)
		clearThrottle()
		return 0, neutralized, nil
	}

	// Step 5: Exact Forget through canonical Facade.forgetLocked.
	outcome, err := f.forgetLocked(ctx, localAgentRef, refs, true)
	if err != nil {
		return 0, neutralized, err
	}
	_ = f.store.disposeSettledOutboxCopies(ctx, localAgentRef)
	clearThrottle()
	return uint32(len(outcome.AffectedMemoryRefs)), neutralized, nil
}
