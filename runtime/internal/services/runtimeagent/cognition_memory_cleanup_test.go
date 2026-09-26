package runtimeagent

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
)

func TestOrdinaryCleanupDebtStillSchedulesDerived(t *testing.T) {
	ctx := context.Background()
	svc, owner, closeFn := openRuntimeAgentTestCompositionWithOwner(t, filepath.Join(t.TempDir(), "local-state.json"))
	defer closeFn()
	result, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext("cleanup-cleanup-derived")})
	if err != nil {
		t.Fatal(err)
	}
	ref := result.GetAgent().GetLocalAgentRef()
	bank := seedCognitionMemoryForTerminationTest(t, svc, ref, "I prefer cedar forests")
	svc.cognitionMemoryWG.Wait()
	store := svc.cognitionMemoryStore
	snapshot := memoryv1.CapabilitySnapshot{ConfigRevision: 1, EmbeddingSpaceRef: "lifecycle-test-space", Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex, memoryv1.CapabilityTextEmbed, memoryv1.CapabilityVectorIndex}}
	var calls atomic.Int32
	dispose := func(context.Context, string, string, []byte) error { return errors.New("ordinary cleanup unavailable") }
	store.SetEmbeddingDisposer(dispose)
	caps := func(_ context.Context, binding cognitionmemory.Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		port := cognitionmemory.NewRuntimeEmbeddingPort(svc.backend, binding.AccountSubjectRef, ref,
			func(_ context.Context, _, _ string, request memoryv1.AIEmbeddingRequest) (cognitionmemory.ResolvedEmbeddingBinding, error) {
				return cognitionmemory.ResolvedEmbeddingBinding{ConfigRevision: 1, EmbeddingSpaceRef: snapshot.EmbeddingSpaceRef, Execution: []byte(fmt.Sprintf(`{"count":%d}`, len(request.Inputs))), Validate: func(tx *sql.Tx) error { return cognitionmemory.ValidateEmbeddingCaptureTx(tx, binding, request) }}, nil
			}, func(_ context.Context, execution []byte) (memoryv1.AIEmbeddingResult, error) {
				calls.Add(1)
				var request struct {
					Count int `json:"count"`
				}
				if err := json.Unmarshal(execution, &request); err != nil {
					return memoryv1.AIEmbeddingResult{}, err
				}
				return derivedLifecycleVectors(request.Count), nil
			}, dispose)
		port.SetCaptureGuard(store.EmbeddingCaptureMutex(ref), func(ctx context.Context, request memoryv1.AIEmbeddingRequest) error {
			return store.ValidateEmbeddingCapture(ctx, binding, request)
		})
		return snapshot, port, nil
	}
	ownerPort := cognitionmemory.NewOwnerAdapter(owner, store.BindingForOwner, func(context.Context, cognitionmemory.Binding) (memoryv1.CapabilitySnapshot, error) {
		return snapshot, nil
	})
	bridge := cognitionmemory.NewBridge(store, ownerPort, svc.AuthorizeCognitionMemoryBinding)
	svc.cognitionMemoryBridge = bridge
	svc.cognitionMemoryFacade = cognitionmemory.NewFacade(store, ownerPort, bridge, svc.AuthorizeCognitionMemoryBinding, caps)
	svc.triggerCognitionMemory(ref)
	svc.cognitionMemoryWG.Wait()
	if calls.Load() != 1 {
		t.Fatalf("initial build calls=%d", calls.Load())
	}
	if needs, err := owner.NeedsEmbeddingRebuild(ctx, bank, snapshot); err != nil || needs {
		t.Fatalf("first index unpublished: needs=%v err=%v", needs, err)
	}
	binding, err := store.BindingForAgent(ctx, ref)
	if err != nil {
		t.Fatal(err)
	}
	envelope := cognitionMemoryMessageEnvelope(binding, time.Now(), &runtimev1.CognitionMemorySourceRef{Kind: "conversation_turn", Value: "cleanup-next-turn"}, &runtimev1.CognitionMemorySourceRef{Kind: "conversation", Value: "cleanup-next-conversation"}, publicChatTurnOriginUser, "I like mountain hikes", nil, true)
	if err := svc.backend.WriteTx(ctx, func(tx *sql.Tx) error { _, err := store.EnqueueCommittedEventTx(tx, ref, envelope); return err }); err != nil {
		t.Fatal(err)
	}
	svc.triggerCognitionMemory(ref)
	svc.cognitionMemoryWG.Wait()
	items, err := owner.ListMemories(ctx, bank, false)
	if err != nil || len(items) != 2 {
		t.Fatalf("canonical processing failed: count=%d err=%v", len(items), err)
	}
	fts, err := owner.Recall(ctx, memoryv1.RecallRequest{OperationID: "cleanup-fts-after-cleanup-debt", BindingRef: binding.BindingRef, BankRef: bank, LifecycleRef: binding.LifecycleRef, Subject: memoryv1.TypedRef{Kind: "account_subject", Value: binding.AccountSubjectRef}, Query: "mountain", Limit: 8, Capabilities: memoryv1.CapabilitySnapshot{Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}}, nil)
	if err != nil || fts.Outcome != memoryv1.OutcomeReady || len(fts.Hits) != 1 {
		t.Fatalf("FTS impacted: %+v err=%v", fts, err)
	}
	needs, err := owner.NeedsEmbeddingRebuild(ctx, bank, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("canonical_count=%d FTS_new_fact_hits=%d embedding_calls=%d needs_embedding_rebuild=%v", len(items), len(fts.Hits), calls.Load(), needs)
	if calls.Load() != 2 || needs {
		t.Fatalf("ordinary cleanup stopped derived work: calls=%d want=2, needs_rebuild=%v", calls.Load(), needs)
	}
}
