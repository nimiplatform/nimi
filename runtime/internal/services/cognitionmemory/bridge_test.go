package cognitionmemory

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
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

func TestDamagedOutboxPreservesPriorCustodyAndLaterDelivery(t *testing.T) {
	for _, prior := range []bool{false, true} {
		t.Run(fmt.Sprint("prior-custody-", prior), func(t *testing.T) {
			f := newEmbeddingRecoveryFixture(t, "corruption")
			facade := f.facade(nil)
			bridge := facade.bridge
			if err := f.backend.WriteTx(f.ctx, func(tx *sql.Tx) error {
				for _, id := range []string{"damaged", "later"} {
					if _, err := f.store.EnqueueCommittedEventTx(tx, f.binding.LocalAgentRef, testEnvelope("event-"+id, "op-"+id, "I prefer "+id+" tea")); err != nil {
						return err
					}
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if prior {
				item, err := f.store.NextPending(f.ctx, f.binding.BindingRef)
				if err != nil {
					t.Fatal(err)
				}
				item.Envelope.LifecycleCutoff = &runtimev1.CognitionMemoryLifecycleCutoffRef{Value: f.binding.LifecycleRef}
				ack, err := f.owner.Commit(f.ctx, &runtimev1.CognitionMemoryCommitRequest{Envelope: item.Envelope})
				if err != nil || ownerMemoryOutcome(ack.GetOutcome()) != memoryv1.OutcomeReceived {
					t.Fatalf("prior custody: %v %v", ack, err)
				}
			}
			corrupted := []byte{255}
			if !prior {
				var original []byte
				if err := f.backend.DB().QueryRow("SELECT payload FROM runtime_cognition_memory_outbox WHERE operation_id='op-damaged'").Scan(&original); err != nil {
					t.Fatal(err)
				}
				corrupted = bytes.Replace(original, []byte("I prefer damaged tea"), []byte("I prefer changed tea"), 1)
				if bytes.Equal(original, corrupted) {
					t.Fatal("test did not change the decodable payload")
				}
			}
			if _, err := f.backend.DB().Exec("UPDATE runtime_cognition_memory_outbox SET payload=? WHERE operation_id='op-damaged'", corrupted); err != nil {
				t.Fatal(err)
			}
			// Simulate losing the Runtime acknowledgement after the real owner settled.
			item, err := f.store.NextPending(f.ctx, f.binding.BindingRef)
			if err != nil || item.damagedDigest == "" {
				t.Fatalf("damage: %+v %v", item, err)
			}
			handoff := memoryv1.DamagedHandoff{BindingRef: item.BindingRef, BankRef: item.BankRef, LifecycleRef: item.LifecycleRef, EventRef: item.EventRef, OperationID: item.OperationID, DeliverySequence: item.DeliverySequence, PayloadSHA256: item.damagedDigest}
			if _, err := f.owner.RejectDamagedHandoff(f.ctx, handoff); err != nil {
				t.Fatal(err)
			}
			settled, err := bridge.DrainOne(f.ctx, f.binding.LocalAgentRef)
			want := memoryv1.OutcomeRejected
			if prior {
				want = memoryv1.OutcomeReceived
			}
			if err != nil || !settled.Drained || settled.Outcome != want {
				t.Fatalf("settlement: %+v %v", settled, err)
			}
			decision, err := facade.ProcessRemember(f.ctx, f.binding.LocalAgentRef, settled.OperationID)
			if err != nil || (prior && decision.Outcome != memoryv1.OutcomeAdmitted) || (!prior && decision.Outcome != memoryv1.OutcomeRejected) {
				t.Fatalf("replayed decision: %+v %v", decision, err)
			}
			next, err := bridge.DrainOne(f.ctx, f.binding.LocalAgentRef)
			if err != nil || next.OperationID != "op-later" {
				t.Fatalf("later event blocked: %+v %v", next, err)
			}
			if _, err := facade.ProcessRemember(f.ctx, f.binding.LocalAgentRef, next.OperationID); err != nil {
				t.Fatal(err)
			}
			status, err := f.owner.core.InspectStatus(f.ctx, f.binding.BindingRef, f.binding.BankRef)
			if err != nil || status.Frontiers.Received != 3 || status.Frontiers.Ready != 3 {
				t.Fatalf("frontiers: %+v %v", status, err)
			}
			rows, err := f.store.ListOutbox(f.ctx, f.binding.BindingRef)
			if err != nil || rows[1].PayloadPresent || (!prior && (rows[1].State != "terminated" || rows[1].Outcome != "rejected")) {
				t.Fatalf("runtime disposition: %+v %v", rows, err)
			}
			memories, err := f.owner.core.ListMemories(f.ctx, f.binding.BankRef, false)
			if err != nil {
				t.Fatal(err)
			}
			seen := map[string]bool{}
			for _, m := range memories {
				seen[m.EventRef] = true
			}
			if seen["event-damaged"] != prior || !seen["event-later"] {
				t.Fatalf("unexpected canonical effects: %v", seen)
			}
		})
	}
}

func TestReplayKeepsUnidentifiableHeadAndDrainsIndependentAgent(t *testing.T) {
	ctx := context.Background()
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "state.json"))
	store := NewStore(backend)
	core, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = core.Close() })
	bridge := NewBridge(store, newTestOwnerPort(store, core, nil), func(context.Context, Binding) error { return nil })
	for _, agent := range []string{"agent-a", "agent-b"} {
		createTestBinding(t, backend, store, agent, true)
		if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
			_, err := store.EnqueueCommittedEventTx(tx, agent, testEnvelope(agent+"-event", agent+"-op", "I prefer jasmine tea"))
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := backend.DB().Exec("UPDATE runtime_cognition_memory_outbox SET payload=NULL,request_key='' WHERE operation_id='agent-a-op'"); err != nil {
		t.Fatal(err)
	}
	if err := bridge.ReplayStartup(ctx); err == nil {
		t.Fatal("unidentifiable event reported as success")
	}
	for agent, want := range map[string]uint64{"agent-a": 0, "agent-b": 1} {
		b, err := store.BindingForAgent(ctx, agent)
		if err != nil || b.DeliveryFrontier != want {
			t.Fatalf("%s frontier: %v %v", agent, b, err)
		}
	}
}
