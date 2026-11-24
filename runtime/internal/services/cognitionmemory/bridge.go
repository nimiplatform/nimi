package cognitionmemory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

type DrainAuthorizer func(context.Context, Binding) error

type Bridge struct {
	store       *Store
	owner       OwnerPort
	authorize   DrainAuthorizer
	agentLockMu sync.Mutex
	agentLocks  map[string]*sync.Mutex
}

type DrainResult struct {
	Drained          bool
	BindingRef       string
	EventRef         string
	OperationID      string
	DeliverySequence uint64
	Outcome          memoryv1.Outcome
}

func NewBridge(store *Store, owner OwnerPort, authorize DrainAuthorizer) *Bridge {
	return &Bridge{
		store:      store,
		owner:      owner,
		authorize:  authorize,
		agentLocks: make(map[string]*sync.Mutex),
	}
}

// lockAgent serializes outbox drain, session-pointer commits, and DeleteSession
// neutralization/forgetting for the same localAgentRef to eliminate memory
// resurrection races and concurrent forget-journal collisions.
func (b *Bridge) lockAgent(localAgentRef string) func() {
	if b == nil || localAgentRef == "" {
		return func() {}
	}
	b.agentLockMu.Lock()
	if b.agentLocks == nil {
		b.agentLocks = make(map[string]*sync.Mutex)
	}
	mu := b.agentLocks[localAgentRef]
	if mu == nil {
		mu = &sync.Mutex{}
		b.agentLocks[localAgentRef] = mu
	}
	b.agentLockMu.Unlock()
	mu.Lock()
	return mu.Unlock
}

// EnsureBinding restores only the stable owner Ensure/Runtime bind boundary.
// It neither transfers outbox payloads nor executes Remember or model work.
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r019
func (b *Bridge) EnsureBinding(ctx context.Context, localAgentRef string) error {
	_, _, err := b.bindingForDrain(ctx, localAgentRef)
	return err
}

func (b *Bridge) bindingForDrain(ctx context.Context, localAgentRef string) (Binding, DrainResult, error) {
	if b == nil || b.store == nil || b.owner == nil || b.authorize == nil {
		return Binding{}, DrainResult{Outcome: memoryv1.OutcomeUnavailable}, fmt.Errorf("drain cognition memory outbox: bridge unavailable")
	}
	binding, err := b.store.BindingForAgent(ctx, localAgentRef)
	if err != nil {
		return Binding{}, DrainResult{Outcome: memoryv1.OutcomeUnavailable}, fmt.Errorf("drain cognition memory outbox: load binding: %w", err)
	}
	if !binding.Enabled || binding.AdoptionRequired {
		return Binding{}, DrainResult{BindingRef: binding.BindingRef, Outcome: memoryv1.OutcomeNoEffect}, ErrMemoryDisabled
	}
	if err := b.authorize(ctx, binding); err != nil {
		return Binding{}, DrainResult{BindingRef: binding.BindingRef, Outcome: memoryv1.OutcomeInvalid}, fmt.Errorf("drain cognition memory outbox: authorize current lifecycle: %w", err)
	}
	if binding.BankRef == "" || binding.LifecycleRef == "" {
		ensured, err := b.owner.EnsureBank(ctx, &runtimev1.CognitionMemoryEnsureBankRequest{
			ContractVersion: memoryv1.ContractVersion,
			BankBinding:     &runtimev1.CognitionMemoryBankBindingRef{Value: binding.BindingRef},
			Operation:       &runtimev1.CognitionMemoryOperationRef{Value: binding.BindingOperationID},
		})
		if err != nil {
			return Binding{}, DrainResult{BindingRef: binding.BindingRef, Outcome: ownerMemoryOutcome(ensured.GetOutcome())}, fmt.Errorf("drain cognition memory outbox: ensure bank: %w", err)
		}
		if ensured.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_COMMITTED || ensured.GetBankBinding().GetValue() != binding.BindingRef || ensured.GetBank().GetValue() == "" || ensured.GetLifecycleCutoff().GetValue() == "" {
			return Binding{}, DrainResult{BindingRef: binding.BindingRef, Outcome: ownerMemoryOutcome(ensured.GetOutcome())}, fmt.Errorf("drain cognition memory outbox: invalid ensure owner result")
		}
		if err := b.store.BindEnsuredBank(ctx, binding.BindingRef, ensured.GetBank().GetValue(), ensured.GetLifecycleCutoff().GetValue()); err != nil {
			return Binding{}, DrainResult{BindingRef: binding.BindingRef, Outcome: memoryv1.OutcomeUnavailable}, err
		}
		binding.BankRef = ensured.GetBank().GetValue()
		binding.LifecycleRef = ensured.GetLifecycleCutoff().GetValue()
	}
	return binding, DrainResult{}, nil
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r005
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r019
func (b *Bridge) DrainOne(ctx context.Context, localAgentRef string) (DrainResult, error) {
	unlock := b.lockAgent(localAgentRef)
	defer unlock()
	return b.drainOneLocked(ctx, localAgentRef)
}

func (b *Bridge) drainOneLocked(ctx context.Context, localAgentRef string) (DrainResult, error) {
	binding, rejected, err := b.bindingForDrain(ctx, localAgentRef)
	if err != nil {
		return rejected, err
	}
	item, err := b.store.NextPending(ctx, binding.BindingRef)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return DrainResult{BindingRef: binding.BindingRef}, nil
		}
		return DrainResult{BindingRef: binding.BindingRef, Outcome: memoryv1.OutcomeUnavailable}, err
	}
	if item.State == "cutoff_non_effecting" {
		settled, err := b.owner.ReceiveNoOpCutoff(ctx, binding.BindingRef, binding.BankRef, binding.LifecycleRef, item.EventRef, item.OperationID, item.DeliverySequence)
		if err != nil {
			return DrainResult{BindingRef: binding.BindingRef, EventRef: item.EventRef, OperationID: item.OperationID, DeliverySequence: item.DeliverySequence, Outcome: settled.Outcome}, fmt.Errorf("drain cognition memory outbox: settle cutoff noop: %w", err)
		}
		if err := b.store.AcknowledgeCutoffNoOp(ctx, item.OperationID, item.EventRef, item.DeliverySequence); err != nil {
			return DrainResult{BindingRef: binding.BindingRef, EventRef: item.EventRef, OperationID: item.OperationID, DeliverySequence: item.DeliverySequence, Outcome: memoryv1.OutcomeUnavailable}, fmt.Errorf("drain cognition memory outbox: acknowledge cutoff noop: %w", err)
		}
		return DrainResult{Drained: true, BindingRef: binding.BindingRef, EventRef: item.EventRef, OperationID: item.OperationID, DeliverySequence: item.DeliverySequence, Outcome: memoryv1.OutcomeNoEffect}, nil
	}
	if item.Envelope == nil {
		return DrainResult{BindingRef: binding.BindingRef, EventRef: item.EventRef, OperationID: item.OperationID, DeliverySequence: item.DeliverySequence, Outcome: memoryv1.OutcomeInvalid}, fmt.Errorf("drain cognition memory outbox: committed envelope unavailable")
	}
	envelope := proto.Clone(item.Envelope).(*runtimev1.CognitionMemoryCommittedEventEnvelope)
	envelope.ContractVersion = memoryv1.ContractVersion
	envelope.BankBinding = &runtimev1.CognitionMemoryBankBindingRef{Value: binding.BindingRef}
	envelope.Bank = &runtimev1.CognitionMemoryBankRef{Value: binding.BankRef}
	envelope.DeliverySequence = item.DeliverySequence
	envelope.LifecycleCutoff = &runtimev1.CognitionMemoryLifecycleCutoffRef{Value: binding.LifecycleRef}
	received, err := b.owner.Commit(ctx, &runtimev1.CognitionMemoryCommitRequest{Envelope: envelope})
	if err != nil {
		return DrainResult{BindingRef: binding.BindingRef, EventRef: item.EventRef, OperationID: item.OperationID, DeliverySequence: item.DeliverySequence, Outcome: ownerMemoryOutcome(received.GetOutcome())}, fmt.Errorf("drain cognition memory outbox: transfer custody: %w", err)
	}
	ownerOutcome := ownerMemoryOutcome(received.GetOutcome())
	if (ownerOutcome != memoryv1.OutcomeReceived && !ownerOutcome.TerminalRemember()) || received.GetBank().GetValue() != binding.BankRef || received.GetEvent().GetValue() != item.EventRef || received.GetOperation().GetValue() != item.OperationID || received.GetDeliverySequence() != item.DeliverySequence {
		return DrainResult{BindingRef: binding.BindingRef, EventRef: item.EventRef, OperationID: item.OperationID, DeliverySequence: item.DeliverySequence, Outcome: ownerOutcome}, fmt.Errorf("drain cognition memory outbox: invalid custody owner result")
	}
	acknowledgement := proto.Clone(received).(*runtimev1.CognitionMemoryCommitResponse)
	acknowledgement.Outcome = runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_RECEIVED
	if err := b.store.AcknowledgeReceived(ctx, acknowledgement); err != nil {
		return DrainResult{BindingRef: binding.BindingRef, EventRef: item.EventRef, OperationID: item.OperationID, DeliverySequence: item.DeliverySequence, Outcome: memoryv1.OutcomeUnavailable}, fmt.Errorf("drain cognition memory outbox: persist custody acknowledgement: %w", err)
	}
	return DrainResult{Drained: true, BindingRef: binding.BindingRef, EventRef: item.EventRef, OperationID: item.OperationID, DeliverySequence: item.DeliverySequence, Outcome: ownerOutcome}, nil
}

func (b *Bridge) ReplayStartup(ctx context.Context) error {
	bindings, err := b.store.ActiveBindings(ctx)
	if err != nil {
		return fmt.Errorf("replay cognition memory startup: list bindings: %w", err)
	}
	for _, binding := range bindings {
		if !binding.Enabled || binding.AdoptionRequired {
			continue
		}
		for {
			result, err := b.DrainOne(ctx, binding.LocalAgentRef)
			if err != nil {
				return err
			}
			if !result.Drained {
				break
			}
		}
	}
	return nil
}

func errorOutcome(err error) memoryv1.Outcome {
	for _, outcome := range []memoryv1.Outcome{memoryv1.OutcomeUnsupported, memoryv1.OutcomeInvalid, memoryv1.OutcomeConflict, memoryv1.OutcomeDuplicate, memoryv1.OutcomeUnavailable, memoryv1.OutcomeRejected} {
		if memoryv1.IsOutcome(err, outcome) {
			return outcome
		}
	}
	return memoryv1.OutcomeFailed
}
