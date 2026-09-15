package cognitionmemory

import (
	"context"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
)

// Only the ACK delivery is delayed. Core, Runtime SQLite custody, cutoff,
// facade lifecycle orchestration and the delegate disposition are real owners.
type auditAckWindowPort struct {
	*RuntimeEmbeddingPort
	entered chan struct{}
	release chan struct{}
}

func (p *auditAckWindowPort) AcknowledgeConsumed(ctx context.Context, id string) error {
	close(p.entered)
	<-p.release
	return p.RuntimeEmbeddingPort.AcknowledgeConsumed(ctx, id)
}

func TestRecallAckWindowHonorsCompletedDeleteAll(t *testing.T) {
	f := newEmbeddingRecoveryFixture(t, "audit-ack-window-agent")
	executions := 0
	port := f.embeddingPort(&executions)
	f.store.SetEmbeddingDisposer(func(context.Context, string, string, []byte) error { return nil })
	if outcome, err := f.owner.RebuildEmbedding(f.ctx, "audit-ack-window-build", f.binding.BankRef, f.snapshot, port); err != nil || outcome != memoryv1.OutcomeReady {
		t.Fatalf("seed actual index: %s %v", outcome, err)
	}
	blocking := &auditAckWindowPort{RuntimeEmbeddingPort: port, entered: make(chan struct{}), release: make(chan struct{})}
	type response struct {
		result memoryv1.RecallResult
		err    error
	}
	returned := make(chan response, 1)
	go func() {
		result, err := f.owner.core.Recall(f.ctx, memoryv1.RecallRequest{
			OperationID: "audit-ack-window-recall", BindingRef: f.binding.BindingRef,
			BankRef: f.binding.BankRef, LifecycleRef: f.binding.LifecycleRef,
			Subject: memoryv1.TypedRef{Kind: "account_subject", Value: f.binding.AccountSubjectRef},
			Query:   "What tea do I prefer?", Limit: 5, Capabilities: f.snapshot,
		}, blocking)
		returned <- response{result, err}
	}()
	select {
	case <-blocking.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("ACK not reached")
	}
	deleted, deleteErr := f.facade(port).DeleteAll(f.ctx, f.binding.LocalAgentRef, true)
	if deleteErr != nil || deleted.Outcome != memoryv1.OutcomeCommitted {
		close(blocking.release)
		<-returned
		t.Fatalf("owner cutoff did not complete: %+v %v", deleted, deleteErr)
	}
	items, err := f.owner.core.ListMemories(f.ctx, f.binding.BankRef, true)
	if err != nil || len(items) != 0 {
		t.Fatalf("delete-all canonical effect missing: %+v %v", items, err)
	}
	close(blocking.release)
	got := <-returned
	t.Logf("DeleteAll=%s; canonical_count=%d; stale_Recall=%s hits=%d err=%v", deleted.Outcome, len(items), got.result.Outcome, len(got.result.Hits), got.err)
	if got.err == nil || got.result.Outcome == memoryv1.OutcomeReady || len(got.result.Hits) != 0 {
		t.Fatalf("ACK response restored pre-cut Ready/hits after successful DeleteAll: %+v %v", got.result, got.err)
	}
}
