package cognitionmemory

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestBridgeStartupReplayTransfersRealCustodyOnce(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	binding := createTestBinding(t, backend, store, "agent-a", true)
	ctx := context.Background()
	for _, item := range []struct {
		event     string
		operation string
		text      string
	}{{"event-a", "operation-a", "first preference"}, {"event-b", "operation-b", "second preference"}} {
		if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
			_, err := store.EnqueueCommittedEventTx(tx, "agent-a", testEnvelope(item.event, item.operation, item.text))
			return err
		}); err != nil {
			t.Fatalf("enqueue %s: %v", item.event, err)
		}
	}
	owner, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open Cognition owner: %v", err)
	}
	t.Cleanup(func() { _ = owner.Close() })
	authorizations := 0
	bridge := NewBridge(store, newTestOwnerPort(store, owner, nil), func(_ context.Context, current Binding) error {
		authorizations++
		if current.LocalAgentRef != "agent-a" || current.AccountSubjectRef == "" || current.State != "active" {
			return errors.New("unexpected binding")
		}
		return nil
	})
	if err := bridge.ReplayStartup(ctx); err != nil {
		t.Fatalf("startup replay: %v", err)
	}
	bound, err := store.BindingForAgent(ctx, "agent-a")
	if err != nil || bound.BankRef == "" || bound.LifecycleRef == "" || bound.DeliveryFrontier != 2 {
		t.Fatalf("Runtime binding/frontier not persisted: binding=%+v err=%v", bound, err)
	}
	ownerStatus, err := owner.InspectStatus(ctx, binding.BindingRef, bound.BankRef)
	if err != nil {
		t.Fatalf("inspect Cognition custody: %v", err)
	}
	if ownerStatus.Frontiers.Received != 2 || ownerStatus.Frontiers.Ready != 0 || len(ownerStatus.Events) != 2 || !ownerStatus.Events[0].PayloadPresent || !ownerStatus.Events[1].PayloadPresent {
		t.Fatalf("Cognition received/ready or payload custody was collapsed: %+v", ownerStatus)
	}
	rows, err := store.ListOutbox(ctx, binding.BindingRef)
	if err != nil || len(rows) != 2 || rows[0].State != "received" || rows[1].State != "received" || rows[0].PayloadPresent || rows[1].PayloadPresent {
		t.Fatalf("Runtime did not release custody-acked payloads: rows=%+v err=%v", rows, err)
	}
	if err := bridge.ReplayStartup(ctx); err != nil {
		t.Fatalf("empty replay after custody: %v", err)
	}
	afterReplay, err := owner.InspectStatus(ctx, binding.BindingRef, bound.BankRef)
	if err != nil || len(afterReplay.Events) != 2 || afterReplay.Frontiers.Received != 2 {
		t.Fatalf("empty replay duplicated Cognition custody: status=%+v err=%v", afterReplay, err)
	}
	if authorizations < 2 {
		t.Fatalf("drain did not reauthorize each owner call, count=%d", authorizations)
	}
}

func TestBridgeAuthorizationFailureLeavesOutboxPendingAndNoCustody(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	binding := createTestBinding(t, backend, store, "agent-a", true)
	ctx := context.Background()
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := store.EnqueueCommittedEventTx(tx, "agent-a", testEnvelope("event-a", "operation-a", "pre-authorization fact"))
		return err
	}); err != nil {
		t.Fatalf("enqueue event: %v", err)
	}
	owner, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open Cognition owner: %v", err)
	}
	t.Cleanup(func() { _ = owner.Close() })
	bridge := NewBridge(store, newTestOwnerPort(store, owner, nil), func(context.Context, Binding) error { return errors.New("lifecycle denied") })
	if _, err := bridge.DrainOne(ctx, "agent-a"); err == nil {
		t.Fatal("authorization failure was treated as custody success")
	}
	rows, err := store.ListOutbox(ctx, binding.BindingRef)
	if err != nil || len(rows) != 1 || rows[0].State != "pending" || !rows[0].PayloadPresent {
		t.Fatalf("authorization failure changed outbox custody: rows=%+v err=%v", rows, err)
	}
	if _, err := owner.EnsureBank(ctx, memoryv1.EnsureBankRequest{ContractVersion: memoryv1.ContractVersion, BindingRef: binding.BindingRef, OperationID: binding.BindingOperationID}); err != nil {
		t.Fatalf("direct ensure after denial: %v", err)
	}
	status, err := owner.InspectStatus(ctx, binding.BindingRef, mustBankRef(t, owner, binding))
	if err != nil || len(status.Events) != 0 {
		t.Fatalf("authorization failure created Cognition custody: status=%+v err=%v", status, err)
	}
}

func TestBridgeAcceptsOwnerRetryAfterTerminalDecisionAsDurableCustody(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "local-state.json"))
	store := NewStore(backend)
	binding := createTestBinding(t, backend, store, "agent-terminal-retry", true)
	core, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = core.Close() })
	owner := newTestOwnerPort(store, core, nil)
	ctx := context.Background()
	ensured, err := owner.EnsureBank(ctx, &runtimev1.CognitionMemoryEnsureBankRequest{
		ContractVersion: memoryv1.ContractVersion, BankBinding: &runtimev1.CognitionMemoryBankBindingRef{Value: binding.BindingRef}, Operation: &runtimev1.CognitionMemoryOperationRef{Value: binding.BindingOperationID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.BindEnsuredBank(ctx, binding.BindingRef, ensured.GetBank().GetValue(), ensured.GetLifecycleCutoff().GetValue()); err != nil {
		t.Fatal(err)
	}
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := store.EnqueueCommittedEventTx(tx, "agent-terminal-retry", testEnvelope("event-terminal-retry", "operation-terminal-retry", "I prefer cedar forests"))
		return err
	}); err != nil {
		t.Fatal(err)
	}
	item, err := store.NextPending(ctx, binding.BindingRef)
	if err != nil {
		t.Fatal(err)
	}
	envelope := proto.Clone(item.Envelope).(*runtimev1.CognitionMemoryCommittedEventEnvelope)
	envelope.LifecycleCutoff = ensured.GetLifecycleCutoff()
	if received, err := owner.Commit(ctx, &runtimev1.CognitionMemoryCommitRequest{Envelope: envelope}); err != nil || received.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_RECEIVED {
		t.Fatalf("seed owner custody: response=%+v err=%v", received, err)
	}
	if decision, err := owner.ExecuteRemember(ctx, item.OperationID); err != nil || decision.Outcome != memoryv1.OutcomeAdmitted {
		t.Fatalf("seed terminal owner decision: result=%+v err=%v", decision, err)
	}
	bridge := NewBridge(store, owner, func(context.Context, Binding) error { return nil })
	drained, err := bridge.DrainOne(ctx, "agent-terminal-retry")
	if err != nil || !drained.Drained || drained.Outcome != memoryv1.OutcomeReceived {
		t.Fatalf("terminal owner retry: result=%+v err=%v", drained, err)
	}
	rows, err := store.ListOutbox(ctx, binding.BindingRef)
	if err != nil || len(rows) != 1 || rows[0].State != "received" || rows[0].PayloadPresent {
		t.Fatalf("terminal owner retry did not close Runtime custody: rows=%+v err=%v", rows, err)
	}
}

func mustBankRef(t *testing.T, owner *memoryv1.Core, binding Binding) string {
	t.Helper()
	result, err := owner.EnsureBank(context.Background(), memoryv1.EnsureBankRequest{ContractVersion: memoryv1.ContractVersion, BindingRef: binding.BindingRef, OperationID: binding.BindingOperationID})
	if err != nil {
		t.Fatalf("ensure bank: %v", err)
	}
	return result.BankRef
}
