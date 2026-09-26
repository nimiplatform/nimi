package cognitionmemory

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
)

// The stores, Core, owner adapter, facade and Runtime port are production code.
// Only bounded execution output and a one-shot acknowledgement failure are injected.
type dispositionFaultPort struct {
	delegate *RuntimeEmbeddingPort
	after    func()
	failAck  bool
}

func (p *dispositionFaultPort) Embed(ctx context.Context, req memoryv1.AIEmbeddingRequest) (memoryv1.AIEmbeddingResult, error) {
	result, err := p.delegate.Embed(ctx, req)
	if err == nil && p.after != nil {
		p.after()
	}
	return result, err
}
func (p *dispositionFaultPort) AcknowledgeConsumed(ctx context.Context, id string) error {
	if p.failAck {
		p.failAck = false
		return errors.New("injected one-shot acknowledgement write failure")
	}
	return p.delegate.AcknowledgeConsumed(ctx, id)
}
func (p *dispositionFaultPort) FinalizeStale(ctx context.Context, id string) error {
	if p.failAck {
		p.failAck = false
		return errors.New("injected one-shot disposal failure")
	}
	return p.delegate.FinalizeStale(ctx, id)
}

func TestStaleEmbeddingDisposalSurvivesGenerationReplacement(t *testing.T) {
	f := newEmbeddingRecoveryFixture(t, "agent-stale-disposal")
	executions := 0
	port := f.embeddingPort(&executions)
	const operationID = "old-generation"
	racing := &dispositionFaultPort{delegate: port, failAck: true, after: func() {
		f.rememberAdditional(t, "later-event", "later-remember", "I prefer quiet mountain hikes")
	}}
	outcome, err := f.owner.RebuildEmbedding(f.ctx, operationID, f.binding.BankRef, f.snapshot, racing)
	if err == nil || outcome != memoryv1.OutcomeUnavailable {
		t.Fatalf("expected disposal failure: %s %v", outcome, err)
	}
	f.assertRuntimeJob(t, operationID, "ready", true, 1)
	// Publishing a replacement prunes the failed generation, but must not lose
	// the old operation's cleanup obligation.
	if _, err := f.owner.RebuildEmbedding(f.ctx, "replacement", f.binding.BankRef, f.snapshot, port); err != nil {
		t.Fatal(err)
	}
	if err := f.owner.ResumeEmbeddingDispositions(f.ctx, f.binding.BankRef, port); err != nil {
		t.Fatal(err)
	}
	f.assertRuntimeJob(t, operationID, "consumed", false, 2)
	for i := 0; i < 3; i++ {
		if err := f.facade(port).ResumeDerived(f.ctx, f.binding.LocalAgentRef); err != nil {
			t.Fatal(err)
		}
	}
	if executions != 2 {
		t.Fatalf("disposition reran model: %d", executions)
	}
}

func TestRecallFailureDisposesQueryResultAndNeverReplaysIt(t *testing.T) {
	f := newEmbeddingRecoveryFixture(t, "audit-recall-stale")
	executions := 0
	port := f.embeddingPort(&executions)
	if outcome, err := f.owner.RebuildEmbedding(f.ctx, "audit-seed-index", f.binding.BankRef, f.snapshot, port); err != nil || outcome != memoryv1.OutcomeReady {
		t.Fatalf("seed index: %s %v", outcome, err)
	}
	const operationID = "audit-recall"
	racing := &dispositionFaultPort{delegate: port, after: func() {
		f.rememberAdditional(t, "audit-recall-later-event", "audit-recall-later-remember", "I prefer quiet mountain hikes")
	}}
	result, err := f.owner.core.Recall(f.ctx, memoryv1.RecallRequest{
		OperationID: operationID, BindingRef: f.binding.BindingRef, BankRef: f.binding.BankRef,
		LifecycleRef: f.binding.LifecycleRef, Subject: memoryv1.TypedRef{Kind: "account_subject", Value: f.binding.AccountSubjectRef},
		Query: "What tea do I prefer?", Limit: 5, Capabilities: f.snapshot,
	}, racing)
	if err == nil || result.Outcome != memoryv1.OutcomeUnavailable {
		t.Fatalf("expected stale generation failure: %+v %v", result, err)
	}
	f.assertRuntimeJob(t, operationID, "consumed", false, 2)
	if err := f.facade(port).ResumeDerived(f.ctx, f.binding.LocalAgentRef); err != nil {
		t.Fatal(err)
	}
	var status string
	var retained bool
	if err := f.backend.DB().QueryRow(`SELECT status, result_json IS NOT NULL FROM runtime_cognition_memory_ai_job WHERE operation_id = ?`, operationID).Scan(&status, &retained); err != nil {
		t.Fatal(err)
	}
	if status != "consumed" || retained {
		t.Fatalf("observed state changed: status=%s retained=%v", status, retained)
	}
	if executions != 3 {
		t.Fatalf("query was replayed during recovery: %d", executions)
	}
}

func TestRejectedForgetReleasesItsFenceAndCompletedForgetRejectsStaleCapture(t *testing.T) {
	f := newEmbeddingRecoveryFixture(t, "agent-forget-guard")
	count := 0
	port := f.embeddingPort(&count)
	facade := f.facade(port)
	if result, err := facade.Forget(f.ctx, f.binding.LocalAgentRef, []string{"missing-memory"}, true); err == nil || result.Outcome != memoryv1.OutcomeConflict {
		t.Fatalf("bad target was not rejected: %+v %v", result, err)
	}
	request := memoryv1.AIEmbeddingRequest{BankRef: f.binding.BankRef, LifecycleRef: f.binding.LifecycleRef}
	if err := f.store.ValidateEmbeddingCapture(f.ctx, f.binding, request); err != nil {
		t.Fatalf("rejected request permanently fenced Memory: %v", err)
	}
	items, err := f.owner.core.ListMemories(f.ctx, f.binding.BankRef, false)
	if err != nil || len(items) != 1 {
		t.Fatalf("Memory prerequisite: %+v %v", items, err)
	}
	target := items[0].MemoryRef
	if result, err := facade.Forget(f.ctx, f.binding.LocalAgentRef, []string{target}, true); err != nil || result.Outcome != memoryv1.OutcomeForgotten {
		t.Fatalf("valid later forget: %+v %v", result, err)
	}
	request.MemoryRefs = []string{target}
	if err := f.store.ValidateEmbeddingCapture(f.ctx, f.binding, request); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale copied content admitted after deletion: %v", err)
	}
	request.MemoryRefs = nil
	if err := f.store.ValidateEmbeddingCapture(f.ctx, f.binding, request); err != nil {
		t.Fatalf("unrelated new Memory work blocked: %v", err)
	}
}

func TestDeleteAllKeepsFenceUntilPayloadOwnerConfirms(t *testing.T) {
	f := newEmbeddingRecoveryFixture(t, "agent-delete-disposal")
	count := 0
	port := f.embeddingPort(&count)
	if _, err := port.Embed(f.ctx, memoryv1.AIEmbeddingRequest{OperationID: "ready-copy", ConfigRevision: f.snapshot.ConfigRevision, EmbeddingSpaceRef: f.snapshot.EmbeddingSpaceRef, Inputs: []string{"copied Memory"}}); err != nil {
		t.Fatal(err)
	}
	f.store.SetEmbeddingDisposer(func(context.Context, string, string, []byte) error { return errors.New("owner unavailable") })
	facade := f.facade(port)
	if result, err := facade.DeleteAll(f.ctx, f.binding.LocalAgentRef, true); err == nil || result.Outcome != memoryv1.OutcomeUnavailable {
		t.Fatalf("early deletion success: %+v %v", result, err)
	}
	row, found, err := facade.pendingCutoff(f.ctx, f.binding.LocalAgentRef)
	if err != nil || !found || row.Phase == "completed" {
		t.Fatalf("cleanup obligation lost: %+v %v", row, err)
	}
	binding, err := f.store.BindingForAgent(f.ctx, f.binding.LocalAgentRef)
	if err != nil || binding.Enabled {
		t.Fatalf("deletion fence reopened: %+v %v", binding, err)
	}
	f.store.SetEmbeddingDisposer(func(context.Context, string, string, []byte) error { return nil })
	if err := facade.ResumeCutoff(f.ctx, f.binding.LocalAgentRef); err != nil {
		t.Fatal(err)
	}
	var disposition string
	if err := f.backend.DB().QueryRow(`SELECT payload_disposition FROM runtime_cognition_memory_ai_job WHERE operation_id = 'ready-copy'`).Scan(&disposition); err != nil || disposition != "disposed" {
		t.Fatalf("payload remained: %s %v", disposition, err)
	}
	if count != 1 {
		t.Fatalf("cleanup executed model: %d", count)
	}
}

func TestOrdinaryDisposalFailureDoesNotBlockNewMemoryIndex(t *testing.T) {
	f := newEmbeddingRecoveryFixture(t, "agent-independent-cleanup")
	executions := 0
	port := f.embeddingPort(&executions)
	port.dispose = func(context.Context, string, string, []byte) error { return errors.New("copy cleanup unavailable") }
	f.store.SetEmbeddingDisposer(port.dispose)
	if _, err := f.owner.RebuildEmbedding(f.ctx, "old-copy", f.binding.BankRef, f.snapshot, port); err == nil {
		t.Fatal("cleanup failure was hidden")
	}
	f.rememberAdditional(t, "independent-event", "independent-remember", "I prefer mountain hikes")
	if err := f.facade(port).ResumeDerived(f.ctx, f.binding.LocalAgentRef); err == nil {
		t.Fatal("cleanup debt was not reported")
	}
	if executions != 2 {
		t.Fatalf("old cleanup blocked new corpus work: %d executions", executions)
	}
	if needs, err := f.owner.NeedsEmbeddingRebuild(f.ctx, f.binding.BankRef, f.snapshot); err != nil || needs {
		t.Fatalf("new index not available: %v %v", needs, err)
	}
	binding, err := f.store.BindingForAgent(f.ctx, f.binding.LocalAgentRef)
	if err != nil || !binding.Enabled {
		t.Fatalf("ordinary cleanup fenced bank: %+v %v", binding, err)
	}
}

func TestEmbeddingResolverDoesNotHoldSerializedWriter(t *testing.T) {
	backend := openTestBackend(t, filepath.Join(t.TempDir(), "audit-state.json"))
	var ownerMu sync.Mutex
	ownerMu.Lock()
	entered := make(chan struct{})
	port := NewRuntimeEmbeddingPort(backend, "account-a", "agent-a",
		func(context.Context, string, string, memoryv1.AIEmbeddingRequest) (ResolvedEmbeddingBinding, error) {
			close(entered)
			ownerMu.Lock()
			defer ownerMu.Unlock()
			return ResolvedEmbeddingBinding{ConfigRevision: 1, EmbeddingSpaceRef: "space-a", Execution: []byte(`{"capture":"synthetic"}`)}, nil
		}, func(context.Context, []byte) (memoryv1.AIEmbeddingResult, error) {
			return memoryv1.AIEmbeddingResult{Vectors: [][]float64{{1}}, Dimension: 1, SpaceID: "space-a"}, nil
		})
	done := make(chan error, 1)
	go func() {
		_, err := port.Embed(context.Background(), memoryv1.AIEmbeddingRequest{OperationID: "op-lock", ConfigRevision: 1, EmbeddingSpaceRef: "space-a", Inputs: []string{"synthetic"}})
		done <- err
	}()
	<-entered
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	err := backend.WriteTx(ctx, func(*sql.Tx) error { return nil })
	cancel()
	ownerMu.Unlock()
	if embedErr := <-done; embedErr != nil {
		t.Fatalf("fixture execution: %v", embedErr)
	}
	if err != nil {
		t.Fatalf("writer blocked by callback waiting on owner lock: %v", err)
	}
}
