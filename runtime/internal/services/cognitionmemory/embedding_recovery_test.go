package cognitionmemory

import (
	"context"
	"database/sql"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

func TestEmbeddingBuildRecoversReadyRuntimeJobWithOriginalOperation(t *testing.T) {
	fixture := newEmbeddingRecoveryFixture(t, "agent-ready-job")
	paidExecutions := 0
	port := fixture.embeddingPort(&paidExecutions)
	operationID := "embedding-recover-ready-job"

	requireEmbeddingRecoveryPanic(t, func() {
		_, _ = fixture.owner.RebuildEmbedding(fixture.ctx, operationID, fixture.binding.BankRef, fixture.snapshot, &panicAfterReadyEmbeddingPort{delegate: port})
	})
	fixture.assertRuntimeJob(t, operationID, "ready", true, 1)

	if err := fixture.facade(port).ResumePending(fixture.ctx, fixture.binding.LocalAgentRef); err != nil {
		t.Fatalf("resume ready Runtime embedding Job: %v", err)
	}
	if paidExecutions != 1 {
		t.Fatalf("recovery paid for embedding execution %d times, want once", paidExecutions)
	}
	fixture.assertRecovered(t, operationID)
}

func TestEmbeddingBuildRecoversPublishedGenerationAndAcknowledgesRuntimeResult(t *testing.T) {
	fixture := newEmbeddingRecoveryFixture(t, "agent-published-generation")
	paidExecutions := 0
	port := fixture.embeddingPort(&paidExecutions)
	operationID := "embedding-recover-published-generation"

	requireEmbeddingRecoveryPanic(t, func() {
		_, _ = fixture.owner.RebuildEmbedding(fixture.ctx, operationID, fixture.binding.BankRef, fixture.snapshot, &panicBeforeEmbeddingAckPort{delegate: port})
	})
	fixture.assertRuntimeJob(t, operationID, "ready", true, 1)

	if err := fixture.facade(port).ResumePending(fixture.ctx, fixture.binding.LocalAgentRef); err != nil {
		t.Fatalf("resume published embedding generation: %v", err)
	}
	if paidExecutions != 1 {
		t.Fatalf("published-generation recovery paid for embedding execution %d times, want once", paidExecutions)
	}
	fixture.assertRecovered(t, operationID)
}

func TestEmbeddingBuildFinalizesStaleReadyJobBeforeBuildingCurrentGeneration(t *testing.T) {
	fixture := newEmbeddingRecoveryFixture(t, "agent-stale-ready-job")
	paidExecutions := 0
	port := fixture.embeddingPort(&paidExecutions)
	operationID := "embedding-recover-stale-ready-job"

	requireEmbeddingRecoveryPanic(t, func() {
		_, _ = fixture.owner.RebuildEmbedding(fixture.ctx, operationID, fixture.binding.BankRef, fixture.snapshot, &panicAfterReadyEmbeddingPort{delegate: port})
	})
	fixture.assertRuntimeJob(t, operationID, "ready", true, 1)
	fixture.rememberAdditional(t, "event-after-embedding-crash", "remember-after-embedding-crash", "I prefer quiet mountain hikes")
	pending, err := fixture.owner.PendingEmbeddingRebuilds(fixture.ctx, fixture.binding.BankRef)
	if err != nil || len(pending) != 1 || pending[0].OperationID != operationID || !pending[0].Stale {
		t.Fatalf("stale interrupted embedding operation was not recoverable: pending=%+v err=%v", pending, err)
	}

	if err := fixture.facade(port).ResumePending(fixture.ctx, fixture.binding.LocalAgentRef); err != nil {
		t.Fatalf("finalize stale embedding Job and build current generation: %v", err)
	}
	if paidExecutions != 2 {
		t.Fatalf("stale recovery executions=%d, want old paid Job once and one current-corpus build", paidExecutions)
	}
	fixture.assertRuntimeJob(t, operationID, "consumed", false, 2)
	var consumed, retainedResults int
	if err := fixture.backend.DB().QueryRow(`SELECT COALESCE(SUM(CASE WHEN status = 'consumed' THEN 1 ELSE 0 END), 0), COALESCE(SUM(CASE WHEN result_json IS NOT NULL THEN 1 ELSE 0 END), 0) FROM runtime_cognition_memory_ai_job WHERE local_agent_ref = ?`, fixture.binding.LocalAgentRef).Scan(&consumed, &retainedResults); err != nil || consumed != 2 || retainedResults != 0 {
		t.Fatalf("stale/current Runtime Jobs were not terminally cleaned: consumed=%d retained_results=%d err=%v", consumed, retainedResults, err)
	}
	pending, err = fixture.owner.PendingEmbeddingRebuilds(fixture.ctx, fixture.binding.BankRef)
	if err != nil || len(pending) != 0 {
		t.Fatalf("stale embedding route/generation remained pending: pending=%+v err=%v", pending, err)
	}
	if needs, err := fixture.owner.NeedsEmbeddingRebuild(fixture.ctx, fixture.binding.BankRef, fixture.snapshot); err != nil || needs {
		t.Fatalf("current embedding generation was blocked by stale recovery: needs_rebuild=%v err=%v", needs, err)
	}
}

func TestConcurrentResumePendingSerializesOneInterruptedEmbeddingOperation(t *testing.T) {
	fixture := newEmbeddingRecoveryFixture(t, "agent-concurrent-resume")
	paidExecutions := 0
	port := fixture.embeddingPort(&paidExecutions)
	const operationID = "embedding-concurrent-resume"
	requireEmbeddingRecoveryPanic(t, func() {
		_, _ = fixture.owner.RebuildEmbedding(fixture.ctx, operationID, fixture.binding.BankRef, fixture.snapshot, &panicAfterReadyEmbeddingPort{delegate: port})
	})
	blocking := &blockingReadyRecoveryPort{delegate: port, entered: make(chan struct{}), release: make(chan struct{})}
	facade := fixture.facade(blocking)
	results := make(chan error, 2)
	go func() { results <- facade.ResumePending(fixture.ctx, fixture.binding.LocalAgentRef) }()
	<-blocking.entered
	go func() { results <- facade.ResumePending(fixture.ctx, fixture.binding.LocalAgentRef) }()
	select {
	case err := <-results:
		t.Fatalf("concurrent ResumePending crossed the active embedding recovery: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	if calls := blocking.calls.Load(); calls != 1 {
		t.Fatalf("same interrupted embedding operation entered Runtime %d times", calls)
	}
	close(blocking.release)
	for index := 0; index < 2; index++ {
		if err := <-results; err != nil {
			t.Fatalf("ResumePending %d: %v", index, err)
		}
	}
	if paidExecutions != 1 || blocking.calls.Load() != 1 {
		t.Fatalf("concurrent recovery executions: paid=%d recovery_calls=%d", paidExecutions, blocking.calls.Load())
	}
	fixture.assertRecovered(t, operationID)
}

type embeddingRecoveryFixture struct {
	ctx      context.Context
	backend  *runtimepersistence.Backend
	store    *Store
	binding  Binding
	owner    *OwnerAdapter
	snapshot memoryv1.CapabilitySnapshot
}

func newEmbeddingRecoveryFixture(t *testing.T, localAgentRef string) embeddingRecoveryFixture {
	t.Helper()
	root := t.TempDir()
	backend := openTestBackend(t, filepath.Join(root, "runtime-state.sqlite3"))
	store := NewStore(backend)
	createTestBinding(t, backend, store, localAgentRef, true)
	core, err := memoryv1.Open(filepath.Join(root, "memory-owner"))
	if err != nil {
		t.Fatalf("open Cognition Memory owner: %v", err)
	}
	t.Cleanup(func() { _ = core.Close() })
	owner := newTestOwnerPort(store, core, nil)
	ctx := context.Background()
	authorize := func(context.Context, Binding) error { return nil }
	bridge := NewBridge(store, owner, authorize)
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := store.EnqueueCommittedEventTx(tx, localAgentRef, testEnvelope("event-"+localAgentRef, "remember-"+localAgentRef, "I prefer jasmine tea"))
		return err
	}); err != nil {
		t.Fatalf("enqueue recovery fixture Memory: %v", err)
	}
	drained, err := bridge.DrainOne(ctx, localAgentRef)
	if err != nil || !drained.Drained {
		t.Fatalf("transfer recovery fixture Memory: result=%+v err=%v", drained, err)
	}
	seedFacade := NewFacade(store, owner, bridge, authorize, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return memoryv1.CapabilitySnapshot{Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil, nil
	})
	if result, err := seedFacade.ProcessRemember(ctx, localAgentRef, drained.OperationID); err != nil || result.Outcome != memoryv1.OutcomeAdmitted {
		t.Fatalf("materialize recovery fixture Memory: result=%+v err=%v", result, err)
	}
	binding, err := store.BindingForAgent(ctx, localAgentRef)
	if err != nil || binding.BankRef == "" {
		t.Fatalf("load recovery fixture binding: binding=%+v err=%v", binding, err)
	}
	return embeddingRecoveryFixture{
		ctx:     ctx,
		backend: backend,
		store:   store,
		binding: binding,
		owner:   owner,
		snapshot: memoryv1.CapabilitySnapshot{
			ConfigRevision: 7, EmbeddingSpaceRef: "embedding-space-recovery",
			Available: []memoryv1.Capability{memoryv1.CapabilityTextEmbed, memoryv1.CapabilityVectorIndex},
		},
	}
}

func (f embeddingRecoveryFixture) embeddingPort(paidExecutions *int) *RuntimeEmbeddingPort {
	profile := &runtimev1.MemoryEmbeddingProfile{
		Provider: "provider-recovery", ModelId: "model-recovery", Dimension: 2, Version: "v1",
		DistanceMetric: runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
	}
	return NewRuntimeEmbeddingPort(
		f.backend,
		f.binding.AccountSubjectRef,
		f.binding.LocalAgentRef,
		func(context.Context, string, string) (ResolvedEmbeddingBinding, error) {
			return ResolvedEmbeddingBinding{ConfigRevision: f.snapshot.ConfigRevision, EmbeddingSpaceRef: f.snapshot.EmbeddingSpaceRef, Profile: profile}, nil
		},
		func(_ context.Context, _ *runtimev1.MemoryEmbeddingProfile, inputs []string) ([][]float64, error) {
			(*paidExecutions)++
			vectors := make([][]float64, len(inputs))
			for index := range vectors {
				vectors[index] = []float64{1, 0}
			}
			return vectors, nil
		},
	)
}

func (f embeddingRecoveryFixture) facade(port memoryv1.EmbeddingPort) *Facade {
	authorize := func(context.Context, Binding) error { return nil }
	return NewFacade(f.store, f.owner, NewBridge(f.store, f.owner, authorize), authorize, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return f.snapshot, port, nil
	})
}

func (f embeddingRecoveryFixture) rememberAdditional(t *testing.T, eventRef, operationID, text string) {
	t.Helper()
	if err := f.backend.WriteTx(f.ctx, func(tx *sql.Tx) error {
		_, err := f.store.EnqueueCommittedEventTx(tx, f.binding.LocalAgentRef, testEnvelope(eventRef, operationID, text))
		return err
	}); err != nil {
		t.Fatalf("enqueue later Memory after embedding crash: %v", err)
	}
	authorize := func(context.Context, Binding) error { return nil }
	bridge := NewBridge(f.store, f.owner, authorize)
	drained, err := bridge.DrainOne(f.ctx, f.binding.LocalAgentRef)
	if err != nil || !drained.Drained || drained.OperationID != operationID {
		t.Fatalf("transfer later Memory after embedding crash: result=%+v err=%v", drained, err)
	}
	if result, err := NewFacade(f.store, f.owner, bridge, authorize, nil).ProcessRemember(f.ctx, f.binding.LocalAgentRef, operationID); err != nil || result.Outcome != memoryv1.OutcomeAdmitted {
		t.Fatalf("commit later Memory before embedding recovery: result=%+v err=%v", result, err)
	}
}

func (f embeddingRecoveryFixture) assertRuntimeJob(t *testing.T, operationID, wantStatus string, wantResult bool, wantCount int) {
	t.Helper()
	var status string
	var resultPresent bool
	if err := f.backend.DB().QueryRow(`SELECT status, result_json IS NOT NULL FROM runtime_cognition_memory_ai_job WHERE operation_id = ?`, operationID).Scan(&status, &resultPresent); err != nil {
		t.Fatalf("inspect Runtime embedding Job: %v", err)
	}
	if status != wantStatus || resultPresent != wantResult {
		t.Fatalf("Runtime embedding Job state=(%s,%v), want=(%s,%v)", status, resultPresent, wantStatus, wantResult)
	}
	var count int
	if err := f.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_cognition_memory_ai_job WHERE local_agent_ref = ?`, f.binding.LocalAgentRef).Scan(&count); err != nil || count != wantCount {
		t.Fatalf("Runtime embedding Job count=%d want=%d err=%v", count, wantCount, err)
	}
}

func (f embeddingRecoveryFixture) assertRecovered(t *testing.T, operationID string) {
	t.Helper()
	f.assertRuntimeJob(t, operationID, "consumed", false, 1)
	pending, err := f.owner.PendingEmbeddingRebuilds(f.ctx, f.binding.BankRef)
	if err != nil || len(pending) != 0 {
		t.Fatalf("interrupted embedding build was not closed: pending=%+v err=%v", pending, err)
	}
	needsRebuild, err := f.owner.NeedsEmbeddingRebuild(f.ctx, f.binding.BankRef, f.snapshot)
	if err != nil || needsRebuild {
		t.Fatalf("recovered embedding generation is not ready: needs_rebuild=%v err=%v", needsRebuild, err)
	}
}

type panicAfterReadyEmbeddingPort struct {
	delegate *RuntimeEmbeddingPort
}

func (p *panicAfterReadyEmbeddingPort) Embed(ctx context.Context, request memoryv1.AIEmbeddingRequest) (memoryv1.AIEmbeddingResult, error) {
	result, err := p.delegate.Embed(ctx, request)
	if err == nil {
		panic("injected crash after Runtime Job became ready")
	}
	return result, err
}

func (p *panicAfterReadyEmbeddingPort) AcknowledgeConsumed(ctx context.Context, operationID string) error {
	return p.delegate.AcknowledgeConsumed(ctx, operationID)
}

type panicBeforeEmbeddingAckPort struct {
	delegate *RuntimeEmbeddingPort
}

type blockingReadyRecoveryPort struct {
	delegate *RuntimeEmbeddingPort
	calls    atomic.Int32
	entered  chan struct{}
	release  chan struct{}
}

func (p *blockingReadyRecoveryPort) Embed(ctx context.Context, request memoryv1.AIEmbeddingRequest) (memoryv1.AIEmbeddingResult, error) {
	result, err := p.delegate.Embed(ctx, request)
	if err != nil {
		return result, err
	}
	if p.calls.Add(1) == 1 {
		close(p.entered)
	}
	select {
	case <-p.release:
		return result, nil
	case <-ctx.Done():
		return memoryv1.AIEmbeddingResult{}, ctx.Err()
	}
}

func (p *blockingReadyRecoveryPort) AcknowledgeConsumed(ctx context.Context, operationID string) error {
	return p.delegate.AcknowledgeConsumed(ctx, operationID)
}

func (p *blockingReadyRecoveryPort) FinalizeStale(ctx context.Context, operationID string) error {
	return p.delegate.FinalizeStale(ctx, operationID)
}

func (p *panicBeforeEmbeddingAckPort) Embed(ctx context.Context, request memoryv1.AIEmbeddingRequest) (memoryv1.AIEmbeddingResult, error) {
	return p.delegate.Embed(ctx, request)
}

func (p *panicBeforeEmbeddingAckPort) AcknowledgeConsumed(context.Context, string) error {
	panic("injected crash before Runtime embedding result acknowledgement")
}

func requireEmbeddingRecoveryPanic(t *testing.T, run func()) {
	t.Helper()
	panicked := false
	func() {
		defer func() { panicked = recover() != nil }()
		run()
	}()
	if !panicked {
		t.Fatal("embedding recovery crash injection did not fire")
	}
}
