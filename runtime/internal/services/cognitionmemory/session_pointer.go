package cognitionmemory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const sessionPointerMilestoneCooldown = 30 * time.Minute

type sessionPointerThrottleKey struct {
	localAgentRef  string
	workSessionRef string
}

type sessionPointerThrottleState struct {
	lastCommittedAt time.Time
	lastSummary     string
}

var (
	pointerThrottleMu    sync.Mutex
	pointerThrottleCache = make(map[sessionPointerThrottleKey]sessionPointerThrottleState)
)

// CommitSessionPointer enqueues and drains a single-slot `session_pointer_committed`
// fact for (localAgentRef, workSessionRef), enforcing v2.1's milestone throttle:
//   - "initial_goal" / "completed" / "archived" always commit immediately
//   - incremental updates require real topic change AND >= 30 minutes since last commit
//
// @nimi-authority: rule.nimi.runtime.memory-world.session-pointer-recall
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
	if now.IsZero() {
		now = time.Now().UTC()
	}
	milestone := strings.ToLower(strings.TrimSpace(milestoneKind))
	isBypassMilestone := milestone == "initial_goal" || milestone == "completed" || milestone == "archived"

	key := sessionPointerThrottleKey{localAgentRef: localAgentRef, workSessionRef: workSessionRef}
	pointerThrottleMu.Lock()
	prev, seen := pointerThrottleCache[key]
	if seen && !isBypassMilestone {
		if prev.lastSummary == summary || now.Sub(prev.lastCommittedAt) < sessionPointerMilestoneCooldown {
			pointerThrottleMu.Unlock()
			return false, nil
		}
	}
	pointerThrottleMu.Unlock()

	binding, err := f.store.BindingForAgent(ctx, localAgentRef)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	if !binding.Enabled || binding.AdoptionRequired {
		return false, nil
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
		drained, err := f.bridge.DrainOne(ctx, localAgentRef)
		if err != nil {
			return false, fmt.Errorf("commit session pointer drain: %w", err)
		}
		if !drained.Drained {
			break
		}
		if _, err := f.ProcessRemember(ctx, localAgentRef, drained.OperationID); err != nil {
			return false, fmt.Errorf("commit session pointer remember: %w", err)
		}
		if drained.OperationID == operationID {
			break
		}
	}

	pointerThrottleMu.Lock()
	pointerThrottleCache[key] = sessionPointerThrottleState{
		lastCommittedAt: now.UTC(),
		lastSummary:     summary,
	}
	pointerThrottleMu.Unlock()
	return true, nil
}

// ForgetSessionLineage implements v2.1's anti-resurrection DeleteSession memory
// cleanup sequence:
//  1. Neutralize all pending runtime_cognition_memory_outbox rows linked to
//     (source_kind='session', source_ref=workSessionRef) with
//     state='cutoff_non_effecting' and payload=NULL FIRST.
//  2. Query memory_lineage(ref_type='source', ref_kind='session', ref_value=workSessionRef)
//     for all already-committed memory_refs.
//  3. Call Facade.Forget(..., confirmed=true) to atomically forget them.
//
// @nimi-authority: rule.nimi.runtime.memory-world.session-pointer-recall
func (f *Facade) ForgetSessionLineage(ctx context.Context, localAgentRef, workSessionRef string) (uint32, int64, error) {
	if f == nil || f.store == nil || f.owner == nil || !validRef(localAgentRef) || !validRef(workSessionRef) {
		return 0, 0, nil
	}
	// Step 1: Neutralize pending outbox rows BEFORE touching canonical memories.
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

	// Step 2: Look up all committed memory_refs via memory_lineage.
	refs, err := f.owner.FindMemoryRefsBySource(ctx, binding.BindingRef, binding.BankRef, "session", workSessionRef)
	if err != nil {
		return 0, neutralized, err
	}
	if len(refs) == 0 {
		return 0, neutralized, nil
	}

	// Step 3: Exact Forget through canonical Facade.Forget.
	outcome, err := f.Forget(ctx, localAgentRef, refs, true)
	if err != nil {
		return 0, neutralized, err
	}
	pointerThrottleMu.Lock()
	delete(pointerThrottleCache, sessionPointerThrottleKey{localAgentRef: localAgentRef, workSessionRef: workSessionRef})
	pointerThrottleMu.Unlock()
	return uint32(len(outcome.AffectedMemoryRefs)), neutralized, nil
}
