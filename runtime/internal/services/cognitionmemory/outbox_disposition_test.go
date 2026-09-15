package cognitionmemory

import (
	"context"
	"database/sql"
	"testing"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type auditForgetThenCommitOwner struct {
	OwnerPort
	after func()
}

func (o *auditForgetThenCommitOwner) Forget(ctx context.Context, req *runtimev1.CognitionMemoryForgetRequest) (*runtimev1.CognitionMemoryForgetResponse, error) {
	result, err := o.OwnerPort.Forget(ctx, req)
	if err == nil {
		o.after()
	}
	return result, err
}

func TestTargetForgetPreservesLaterUnrelatedOutboxBackup(t *testing.T) {
	f := newEmbeddingRecoveryFixture(t, "audit-backup-target")
	items, err := f.owner.core.ListMemories(f.ctx, f.binding.BankRef, false)
	if err != nil || len(items) != 1 {
		t.Fatalf("target: %+v %v", items, err)
	}
	var backupPath string
	// Equivalent to a new committed Conversation event and a regular backup
	// interleaving after Core commits the exact target's forget barrier.
	owner := &auditForgetThenCommitOwner{OwnerPort: f.owner, after: func() {
		if err := f.backend.WriteTx(f.ctx, func(tx *sql.Tx) error {
			_, err := f.store.EnqueueCommittedEventTx(tx, f.binding.LocalAgentRef, testEnvelope("later-unrelated-event", "later-unrelated-operation", "I enjoy evening walks"))
			return err
		}); err != nil {
			t.Fatal(err)
		}
		backupPath, err = f.backend.BackupNow(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
	}}
	authorize := func(context.Context, Binding) error { return nil }
	facade := NewFacade(f.store, owner, NewBridge(f.store, owner, authorize), authorize, nil)
	result, err := facade.Forget(f.ctx, f.binding.LocalAgentRef, []string{items[0].MemoryRef}, true)
	if err != nil || result.Outcome != memoryv1.OutcomeForgotten {
		t.Fatalf("forget: %+v %v", result, err)
	}
	var state string
	var present bool
	if err := f.backend.DB().QueryRow(`SELECT state,payload IS NOT NULL FROM runtime_cognition_memory_outbox WHERE operation_id = 'later-unrelated-operation'`).Scan(&state, &present); err != nil {
		t.Fatal(err)
	}
	t.Logf("live unrelated event: state=%s payload=%v", state, present)
	if state != "pending" || !present {
		t.Fatal("fixture did not preserve a live unrelated pending event")
	}
	backup, err := sql.Open("sqlite", backupPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := backup.Close(); err != nil {
			t.Errorf("close outbox backup: %v", err)
		}
	})
	if err := backup.QueryRow(`SELECT state,payload IS NOT NULL FROM runtime_cognition_memory_outbox WHERE operation_id = 'later-unrelated-operation'`).Scan(&state, &present); err != nil {
		t.Fatal(err)
	}
	t.Logf("recoverable backup after target forget: state=%s payload=%v", state, present)
	if state != "pending" || !present {
		t.Fatalf("target forget removed unrelated later event from recovery: state=%s payload=%v", state, present)
	}
}

func TestReceivedOutboxBackupIsDisposedAfterHandoffBatch(t *testing.T) {
	f := newEmbeddingRecoveryFixture(t, "received-backup")
	if err := f.backend.WriteTx(f.ctx, func(tx *sql.Tx) error {
		_, err := f.store.EnqueueCommittedEventTx(tx, f.binding.LocalAgentRef, testEnvelope("received-event", "received-operation", "I prefer mountain hikes"))
		return err
	}); err != nil {
		t.Fatal(err)
	}
	path, err := f.backend.BackupNow(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	bridge := NewBridge(f.store, f.owner, func(context.Context, Binding) error { return nil })
	if result, err := bridge.DrainOne(f.ctx, f.binding.LocalAgentRef); err != nil || !result.Drained {
		t.Fatalf("handoff: %+v %v", result, err)
	}
	if err := f.facade(nil).ResumePending(f.ctx, f.binding.LocalAgentRef); err != nil {
		t.Fatal(err)
	}
	backup, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := backup.Close(); err != nil {
			t.Errorf("close outbox backup: %v", err)
		}
	})
	var state string
	var payload bool
	if err := backup.QueryRow(`SELECT state,payload IS NOT NULL FROM runtime_cognition_memory_outbox WHERE operation_id = 'received-operation'`).Scan(&state, &payload); err != nil {
		t.Fatal(err)
	}
	if state != "received" || payload {
		t.Fatalf("settled copy retained in backup: %s %v", state, payload)
	}
}
