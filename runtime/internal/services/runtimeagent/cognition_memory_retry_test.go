package runtimeagent

import (
	"context"
	"errors"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
)

// Inject only a transient failure. Accepted events, both databases, canonical
// decisions, lifecycle checks and the drain are the production composition.
type transientRememberOwner struct {
	cognitionmemory.OwnerPort
	calls       atomic.Int32
	afterCommit bool
	alwaysFail  bool
	failed      chan struct{}
	failure     error
}

func (o *transientRememberOwner) ExecuteRemember(ctx context.Context, operationID string) (memoryv1.DecisionResult, error) {
	call := o.calls.Add(1)
	if call == 1 || o.alwaysFail {
		if call == 1 && o.failed != nil {
			close(o.failed)
		}
		if o.afterCommit {
			if _, err := o.OwnerPort.ExecuteRemember(ctx, operationID); err != nil {
				return memoryv1.DecisionResult{}, err
			}
		}
		failure := o.failure
		if failure == nil {
			failure = errors.New("transient Memory owner unavailable")
		}
		outcome := memoryv1.OutcomeUnavailable
		if memoryv1.IsOutcome(failure, memoryv1.OutcomeInvalid) {
			outcome = memoryv1.OutcomeInvalid
		}
		return memoryv1.DecisionResult{Outcome: outcome}, failure
	}
	return o.OwnerPort.ExecuteRemember(ctx, operationID)
}

func TestMemoryRetryStopsAtLifecycleAndAttemptBounds(t *testing.T) {
	for _, action := range []string{"disable", "close", "exhaust", "invalid"} {
		t.Run(action, func(t *testing.T) {
			svc, owner, closeFn := openRuntimeAgentTestCompositionWithOwner(t, filepath.Join(t.TempDir(), "local-state.json"))
			defer closeFn()
			agent, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext("retry-bound-" + action)})
			if err != nil {
				t.Fatal(err)
			}
			svc.cognitionMemoryWG.Wait()
			ref := agent.GetAgent().GetLocalAgentRef()
			enqueueEnsureRaceEvent(t, svc, ref)
			var transient *transientRememberOwner
			store, bridge, facade, termination := startupMemoryComposition(svc, owner, func(base cognitionmemory.OwnerPort) cognitionmemory.OwnerPort {
				transient = &transientRememberOwner{OwnerPort: base, alwaysFail: action == "exhaust", failed: make(chan struct{})}
				if action == "invalid" {
					transient.failure = &memoryv1.ContractError{Outcome: memoryv1.OutcomeInvalid, Code: "injected-invalid"}
				}
				return transient
			})
			svc.cognitionMemoryStore, svc.cognitionMemoryBridge, svc.cognitionMemoryFacade, svc.cognitionMemoryTermination = store, bridge, facade, termination
			svc.triggerCognitionMemory(ref)
			select {
			case <-transient.failed:
			case <-time.After(2 * time.Second):
				t.Fatal("failure was not exercised")
			}
			switch action {
			case "disable":
				if _, err := facade.SetEnabled(context.Background(), ref, false); err != nil {
					t.Fatal(err)
				}
			case "close":
				svc.Close()
			}
			done := make(chan struct{})
			go func() { svc.cognitionMemoryWG.Wait(); close(done) }()
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				t.Fatal("recovery did not stop within its lifecycle/attempt bound")
			}
			if action == "exhaust" {
				if calls := transient.calls.Load(); calls < 2 || calls > 4 {
					t.Fatalf("retry attempts are not bounded: %d", calls)
				}
			} else if calls := transient.calls.Load(); calls != 1 {
				t.Fatalf("retry executed after %s: %d calls", action, calls)
			}
			binding, err := store.BindingForAgent(context.Background(), ref)
			if err != nil {
				t.Fatal(err)
			}
			items, err := owner.ListMemories(context.Background(), binding.BankRef, false)
			if err != nil || len(items) != 0 {
				t.Fatalf("failed or fenced recovery wrote Memory: %v %v", items, err)
			}
			if action == "exhaust" {
				pending, err := transient.ListPendingEvents(context.Background(), binding.BindingRef, binding.BankRef)
				if err != nil || len(pending) != 1 {
					t.Fatalf("exhaustion lost durable pending work: %v %v", pending, err)
				}
			}
		})
	}
}

func TestMemoryDrainRecoversWithoutAnotherUserInteraction(t *testing.T) {
	for _, name := range []string{"before-commit", "lost-commit-response", "dependency-deadline"} {
		afterCommit := name == "lost-commit-response"
		t.Run(name, func(t *testing.T) {
			svc, owner, closeFn := openRuntimeAgentTestCompositionWithOwner(t, filepath.Join(t.TempDir(), "local-state.json"))
			defer closeFn()
			agent, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext("retry-" + name)})
			if err != nil {
				t.Fatal(err)
			}
			svc.cognitionMemoryWG.Wait()
			ref := agent.GetAgent().GetLocalAgentRef()
			enqueueEnsureRaceEvent(t, svc, ref)
			var transient *transientRememberOwner
			store, bridge, facade, termination := startupMemoryComposition(svc, owner, func(base cognitionmemory.OwnerPort) cognitionmemory.OwnerPort {
				transient = &transientRememberOwner{OwnerPort: base, afterCommit: afterCommit}
				if name == "dependency-deadline" {
					transient.failure = context.DeadlineExceeded
				}
				return transient
			})
			svc.cognitionMemoryStore, svc.cognitionMemoryBridge, svc.cognitionMemoryFacade, svc.cognitionMemoryTermination = store, bridge, facade, termination
			svc.triggerCognitionMemory(ref)
			deadline := time.Now().Add(3 * time.Second)
			for !afterCommit && transient.calls.Load() < 2 && time.Now().Before(deadline) {
				time.Sleep(10 * time.Millisecond)
			}
			if !afterCommit && transient.calls.Load() < 2 {
				t.Fatalf("recovered owner was never retried without a new trigger: calls=%d", transient.calls.Load())
			}
			svc.cognitionMemoryWG.Wait()
			binding, err := store.BindingForAgent(context.Background(), ref)
			if err != nil {
				t.Fatal(err)
			}
			items, err := owner.ListMemories(context.Background(), binding.BankRef, false)
			if err != nil || len(items) != 1 {
				t.Fatalf("recovery must commit exactly one Memory: items=%d err=%v", len(items), err)
			}
			pending, err := transient.ListPendingEvents(context.Background(), binding.BindingRef, binding.BankRef)
			if err != nil || len(pending) != 0 {
				t.Fatalf("recovery left canonical work pending: %v %v", pending, err)
			}
		})
	}
}

func TestMemoryDerivedRecoversWithoutAnotherUserInteraction(t *testing.T) {
	svc, owner, closeFn := openRuntimeAgentTestCompositionWithOwner(t, filepath.Join(t.TempDir(), "local-state.json"))
	defer closeFn()
	agent, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext("derived-transient")})
	if err != nil {
		t.Fatal(err)
	}
	ref := agent.GetAgent().GetLocalAgentRef()
	seedCognitionMemoryForTerminationTest(t, svc, ref, "I prefer cedar forests")
	svc.cognitionMemoryWG.Wait()
	var calls atomic.Int32
	store, bridge, facade, termination := derivedLifecycleComposition(svc, owner, func(_ context.Context, _ cognitionmemory.Binding, count int) (memoryv1.AIEmbeddingResult, error) {
		if calls.Add(1) == 1 {
			return memoryv1.AIEmbeddingResult{}, errors.New("transient embedding dependency unavailable")
		}
		return derivedLifecycleVectors(count), nil
	})
	svc.cognitionMemoryStore, svc.cognitionMemoryBridge, svc.cognitionMemoryFacade, svc.cognitionMemoryTermination = store, bridge, facade, termination
	svc.triggerCognitionMemoryDerived(ref)
	deadline := time.Now().Add(3 * time.Second)
	for calls.Load() < 2 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if calls.Load() < 2 {
		t.Fatalf("recovered embedding dependency was never retried without a new trigger: calls=%d", calls.Load())
	}
	svc.cognitionMemoryWG.Wait()
	result, err := facade.Recall(context.Background(), cognitionmemory.RecallIntent{LocalAgentRef: ref, Query: "cedar"})
	if err != nil || result.Outcome != memoryv1.OutcomeReady || len(result.Hits) != 1 {
		t.Fatalf("derived recovery did not produce a usable index: %+v %v", result, err)
	}
}
