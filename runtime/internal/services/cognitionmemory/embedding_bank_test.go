package cognitionmemory

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
)

func waitEmbeddingBankUsers(t *testing.T, facade *Facade, bank string, want int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		facade.embeddingMu.Lock()
		gate := facade.embeddingBanks[bank]
		matched := gate != nil && gate.users == want
		facade.embeddingMu.Unlock()
		if matched {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("bank gate never acquired %d users", want)
}

func TestEmbeddingBankAdmissionRechecksLifecycleAndAuthorization(t *testing.T) {
	for _, change := range []string{"disable", "authorization"} {
		t.Run(change, func(t *testing.T) {
			fixture := newEmbeddingRecoveryFixture(t, "agent-queued-"+change)
			var capabilitiesCalled atomic.Int32
			var denied atomic.Bool
			deniedErr := errors.New("owner is no longer authorized")
			authorize := func(context.Context, Binding) error {
				if denied.Load() {
					return deniedErr
				}
				return nil
			}
			facade := NewFacade(fixture.store, fixture.owner, NewBridge(fixture.store, fixture.owner, authorize), authorize, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
				capabilitiesCalled.Add(1)
				return fixture.snapshot, batchEmbeddingPort{}, nil
			})
			release, err := facade.acquireEmbeddingBank(fixture.ctx, fixture.binding.BankRef)
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if release != nil {
					release()
				}
			}()
			done := make(chan error, 1)
			go func() { done <- facade.ResumeDerived(fixture.ctx, fixture.binding.LocalAgentRef) }()
			waitEmbeddingBankUsers(t, facade, fixture.binding.BankRef, 2)
			if change == "disable" {
				if _, err := facade.SetEnabled(fixture.ctx, fixture.binding.LocalAgentRef, false); err != nil {
					t.Fatal(err)
				}
			} else {
				denied.Store(true)
			}
			release()
			release = nil
			err = <-done
			if change == "disable" && err != nil || change == "authorization" && !errors.Is(err, deniedErr) {
				t.Fatalf("queued admission outcome: %v", err)
			}
			if capabilitiesCalled.Load() != 0 {
				t.Fatal("queued work used its pre-wait binding to invoke embedding capabilities")
			}
			if len(facade.embeddingBanks) != 0 {
				t.Fatal("idle bank gate was retained")
			}
		})
	}
}

func TestEmbeddingBankWaitIsCancelableAndDoesNotBlockAnotherBank(t *testing.T) {
	fixture := newEmbeddingRecoveryFixture(t, "agent-cancel-queued")
	facade := fixture.facade(batchEmbeddingPort{})
	release, err := facade.acquireEmbeddingBank(fixture.ctx, fixture.binding.BankRef)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	ctx, cancel := context.WithCancel(fixture.ctx)
	done := make(chan error, 1)
	go func() { done <- facade.ResumeDerived(ctx, fixture.binding.LocalAgentRef) }()
	waitEmbeddingBankUsers(t, facade, fixture.binding.BankRef, 2)
	otherRelease, err := facade.acquireEmbeddingBank(fixture.ctx, "other-bank")
	if err != nil {
		t.Fatal(err)
	}
	otherRelease()
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("waiting work ignored cancellation: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("canceled waiter still waits for model execution")
	}
}

func TestOptionalEmbeddingFailureDoesNotRejectCommittedMemoryMutation(t *testing.T) {
	for _, mutation := range []string{"correct", "forget"} {
		t.Run(mutation, func(t *testing.T) {
			fixture := newEmbeddingRecoveryFixture(t, "agent-optional-"+mutation)
			unavailable := errors.New("embedding model unavailable")
			facade := fixture.facade(nil)
			facade.capabilities = func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
				return memoryv1.CapabilitySnapshot{}, nil, unavailable
			}
			items, err := fixture.owner.core.ListMemories(fixture.ctx, fixture.binding.BankRef, false)
			if err != nil || len(items) != 1 {
				t.Fatalf("seed memories: %v %v", items, err)
			}
			var result MutationOutcome
			if mutation == "correct" {
				result, err = facade.Correct(fixture.ctx, fixture.binding.LocalAgentRef, items[0].MemoryRef, "I prefer cedar tea", nil)
				if result.Outcome != memoryv1.OutcomeAdmitted {
					t.Fatalf("correction not committed: %+v %v", result, err)
				}
			} else {
				result, err = facade.Forget(fixture.ctx, fixture.binding.LocalAgentRef, []string{items[0].MemoryRef}, true)
				if result.Outcome != memoryv1.OutcomeForgotten {
					t.Fatalf("forget not completed: %+v %v", result, err)
				}
			}
			if err != nil {
				t.Fatalf("optional model rejected committed mutation: %v", err)
			}
			if err := facade.ResumeDerived(fixture.ctx, fixture.binding.LocalAgentRef); !errors.Is(err, unavailable) {
				t.Fatalf("derived failure was hidden: %v", err)
			}
		})
	}
}
