package cognitionmemory

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

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
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	bridge := NewBridge(f.store, f.owner, func(context.Context, Binding) error { return nil })
	if result, err := bridge.DrainOne(f.ctx, f.binding.LocalAgentRef); err != nil || !result.Drained {
		t.Fatalf("handoff: %+v %v", result, err)
	}
	if cleanupErr, err := f.facade(nil).ResumePending(f.ctx, f.binding.LocalAgentRef); cleanupErr != nil || err != nil {
		t.Fatalf("resume pending: cleanup=%v processing=%v", cleanupErr, err)
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
	if err := backup.Close(); err != nil {
		t.Fatal(err)
	}
	cleanInfo, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	replacement := filepath.Join(filepath.Dir(path), "replacement.tmp")
	if err := os.WriteFile(replacement, original, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(replacement, cleanInfo.ModTime(), cleanInfo.ModTime()); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(replacement, path); err != nil {
		t.Fatal(err)
	}
	if err := f.store.disposeSettledOutboxCopies(f.ctx, f.binding.LocalAgentRef); err != nil {
		t.Fatal(err)
	}
	replaced, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := replaced.Close(); err != nil {
			t.Error(err)
		}
	}()
	if err := replaced.QueryRow(`SELECT payload IS NOT NULL FROM runtime_cognition_memory_outbox WHERE operation_id='received-operation'`).Scan(&payload); err != nil || payload {
		t.Fatalf("replacement retained delivered body: %v %v", payload, err)
	}

}

func TestSameBackupRedactsOnlyItsSettledItems(t *testing.T) {
	f := newEmbeddingRecoveryFixture(t, "separate-handoffs")
	agent := f.binding.LocalAgentRef
	for _, id := range []string{"first", "later"} {
		if err := f.backend.WriteTx(f.ctx, func(tx *sql.Tx) error {
			_, err := f.store.EnqueueCommittedEventTx(tx, agent, testEnvelope("event-"+id, "operation-"+id, "I like walking"))
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	path, err := f.backend.BackupNow(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	bridge := NewBridge(f.store, f.owner, func(context.Context, Binding) error { return nil })
	for _, want := range []int{1, 0} {
		if out, err := bridge.DrainOne(f.ctx, agent); err != nil || !out.Drained {
			t.Fatalf("handoff: %+v %v", out, err)
		}
		if err := f.store.disposeSettledOutboxCopies(f.ctx, agent); err != nil {
			t.Fatal(err)
		}
		db, err := sql.Open("sqlite", path)
		if err != nil {
			t.Fatal(err)
		}
		var bodies int
		err = db.QueryRow(`SELECT count(*) FROM runtime_cognition_memory_outbox WHERE operation_id IN ('operation-first','operation-later') AND payload IS NOT NULL`).Scan(&bodies)
		if err := db.Close(); err != nil {
			t.Error(err)
		}
		if err != nil || bodies != want {
			t.Fatalf("remaining backup bodies: %d, want %d: %v", bodies, want, err)
		}
	}
}

func TestSettledOutboxScaleAndSharedWriter(t *testing.T) {
	for _, count := range []int{1000, 10000} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			f := newEmbeddingRecoveryFixture(t, "scale")
			err := f.backend.WriteTx(f.ctx, func(tx *sql.Tx) error {
				_, err := tx.Exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?)
      INSERT INTO runtime_cognition_memory_outbox(operation_id,binding_ref,event_ref,delivery_sequence,lifecycle_ref,event_kind,request_key,payload,state,created_at)
      SELECT 'scale-'||i,o.binding_ref,'scale-event-'||i,100+i,o.lifecycle_ref,o.event_kind,'key-'||i,zeroblob(512),'pending',o.created_at FROM n CROSS JOIN runtime_cognition_memory_outbox o WHERE o.operation_id='remember-scale'`, count)
				return err
			})
			if err != nil {
				t.Fatal(err)
			}
			var path string
			run := func(label string, compete bool) {
				start := time.Now()
				completed := make(chan error, 1)
				go func() { completed <- f.store.disposeSettledOutboxCopies(f.ctx, f.binding.LocalAgentRef) }()
				if compete {
					// A nonempty copy creates a private WAL before scanning or redacting.
					// Place the other writer behind that operation, not merely behind a timer.
					if label == "pending copy" {
						deadline := time.Now().Add(5 * time.Second)
						for {
							if _, err := os.Stat(path + "-wal"); err == nil {
								break
							}
							select {
							case err := <-completed:
								if err != nil {
									t.Fatal(err)
								}
								t.Log("disposition completed before another write could overlap")
								return
							default:
							}
							if time.Now().After(deadline) {
								t.Fatal("no backup writer observed")
							}
							time.Sleep(100 * time.Microsecond)
						}
					}
					queueStart := time.Now()
					err := f.backend.WriteTx(f.ctx, func(tx *sql.Tx) error {
						_, err := tx.Exec(`INSERT OR REPLACE INTO runtime_local_agent_meta(key,value) VALUES('unrelated-scale-writer','1')`)
						return err
					})
					if err != nil {
						t.Fatal(err)
					}
					t.Logf("%s unrelated writer completion %v", label, time.Since(queueStart))
				}
				if err := <-completed; err != nil {
					t.Fatal(err)
				}
				t.Logf("%s total %v", label, time.Since(start))
			}
			run("no backup", false)
			path, err = f.backend.BackupNow(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			_, err = f.backend.DB().Exec(`UPDATE runtime_cognition_memory_outbox SET payload=NULL,state='received' WHERE operation_id LIKE 'scale-%'`)
			if err != nil {
				t.Fatal(err)
			}
			run("pending copy", true)
			run("clean copy", false)
			run("clean copy concurrent", true)
			db, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if err := db.Close(); err != nil {
					t.Error(err)
				}
			}()
			var total, redacted int
			if err := db.QueryRow(`SELECT count(*),sum(payload IS NULL AND state='received') FROM runtime_cognition_memory_outbox WHERE operation_id LIKE 'scale-%'`).Scan(&total, &redacted); err != nil || total != count || redacted != count {
				t.Fatalf("coverage %d %d: %v", total, redacted, err)
			}
		})
	}
}
