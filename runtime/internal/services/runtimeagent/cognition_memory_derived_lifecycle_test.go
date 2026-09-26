package runtimeagent

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
)

// Only inference output is injected. Both stores, capture/disposition guards,
// the Core, Runtime lifecycle admission and tracked drain are production code.
func derivedLifecycleComposition(svc *Service, owner *memoryv1.Core, execute func(context.Context, cognitionmemory.Binding, int) (memoryv1.AIEmbeddingResult, error)) (*cognitionmemory.Store, *cognitionmemory.Bridge, *cognitionmemory.Facade, *cognitionmemory.TerminationService) {
	store := svc.cognitionMemoryStore
	if store == nil {
		store = cognitionmemory.NewStore(svc.backend)
	}
	dispose := func(context.Context, string, string, []byte) error { return nil }
	store.SetEmbeddingDisposer(dispose)
	snapshot := memoryv1.CapabilitySnapshot{ConfigRevision: 1, EmbeddingSpaceRef: "lifecycle-test-space", Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex, memoryv1.CapabilityTextEmbed, memoryv1.CapabilityVectorIndex}}
	capabilities := func(_ context.Context, binding cognitionmemory.Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		port := cognitionmemory.NewRuntimeEmbeddingPort(svc.backend, binding.AccountSubjectRef, binding.LocalAgentRef,
			func(_ context.Context, _, _ string, request memoryv1.AIEmbeddingRequest) (cognitionmemory.ResolvedEmbeddingBinding, error) {
				return cognitionmemory.ResolvedEmbeddingBinding{ConfigRevision: snapshot.ConfigRevision, EmbeddingSpaceRef: snapshot.EmbeddingSpaceRef, Execution: []byte(fmt.Sprintf(`{"count":%d}`, len(request.Inputs))), Validate: func(tx *sql.Tx) error {
					return cognitionmemory.ValidateEmbeddingCaptureTx(tx, binding, request)
				}}, nil
			}, func(ctx context.Context, input []byte) (memoryv1.AIEmbeddingResult, error) {
				var capture struct {
					Count int `json:"count"`
				}
				if err := json.Unmarshal(input, &capture); err != nil {
					return memoryv1.AIEmbeddingResult{}, err
				}
				return execute(ctx, binding, capture.Count)
			}, dispose)
		port.SetCaptureGuard(store.EmbeddingCaptureMutex(binding.LocalAgentRef), func(ctx context.Context, request memoryv1.AIEmbeddingRequest) error {
			return store.ValidateEmbeddingCapture(ctx, binding, request)
		})
		return snapshot, port, nil
	}
	ownerPort := cognitionmemory.NewOwnerAdapter(owner, store.BindingForOwner, func(context.Context, cognitionmemory.Binding) (memoryv1.CapabilitySnapshot, error) {
		return snapshot, nil
	})
	bridge := cognitionmemory.NewBridge(store, ownerPort, svc.AuthorizeCognitionMemoryBinding)
	return store, bridge, cognitionmemory.NewFacade(store, ownerPort, bridge, svc.AuthorizeCognitionMemoryBinding, capabilities), cognitionmemory.NewTerminationService(store, ownerPort)
}

func derivedLifecycleVectors(count int) memoryv1.AIEmbeddingResult {
	vectors := make([][]float64, count)
	for i := range vectors {
		vectors[i] = []float64{1, 0}
	}
	return memoryv1.AIEmbeddingResult{Vectors: vectors, Dimension: 2, SpaceID: "lifecycle-test-space"}
}

func awaitMemoryLifecycle(t *testing.T, done <-chan error, operation string) {
	t.Helper()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("%s: %v", operation, err)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("%s waited for unrelated model execution", operation)
	}
}

func TestBlockedEmbeddingDoesNotHoldOtherBankOrLifecycleAdmission(t *testing.T) {
	svc, owner, closeFn := openRuntimeAgentTestCompositionWithOwner(t, filepath.Join(t.TempDir(), "local-state.json"))
	defer closeFn()
	agents := make([]*runtimev1.LocalAgentRecord, 0, 2)
	for _, source := range []string{"derived-blocked-a", "derived-independent-b"} {
		result, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(source)})
		if err != nil {
			t.Fatal(err)
		}
		agents = append(agents, result.GetAgent())
		seedCognitionMemoryForTerminationTest(t, svc, result.GetAgent().GetLocalAgentRef(), "I prefer cedar forests")
	}
	svc.cognitionMemoryWG.Wait()
	blocked, other := agents[0], agents[1]
	entered, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	store, bridge, facade, termination := derivedLifecycleComposition(svc, owner, func(ctx context.Context, binding cognitionmemory.Binding, count int) (memoryv1.AIEmbeddingResult, error) {
		if binding.LocalAgentRef == blocked.GetLocalAgentRef() {
			close(entered)
			select {
			case <-release:
			case <-ctx.Done():
				return memoryv1.AIEmbeddingResult{}, ctx.Err()
			}
		}
		return derivedLifecycleVectors(count), nil
	})
	svc.cognitionMemoryStore, svc.cognitionMemoryBridge, svc.cognitionMemoryFacade, svc.cognitionMemoryTermination = store, bridge, facade, termination
	svc.triggerCognitionMemory(blocked.GetLocalAgentRef())
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("blocked bank did not enter inference")
	}
	otherDerived := make(chan error, 1)
	go func() { otherDerived <- facade.ResumeDerived(context.Background(), other.GetLocalAgentRef()) }()
	awaitMemoryLifecycle(t, otherDerived, "other bank rebuild")
	binding, err := store.BindingForAgent(context.Background(), other.GetLocalAgentRef())
	if err != nil {
		t.Fatal(err)
	}
	items, err := owner.ListMemories(context.Background(), binding.BankRef, false)
	if err != nil || len(items) != 1 {
		t.Fatalf("other bank prerequisite: %v %v", items, err)
	}
	decision, callCtx := localAppConfigureContext(accountservice.LocalAppOperationMemoryForget, 0x73, other.GetOwnerUserId())
	forgotten := make(chan error, 1)
	go func() {
		response, err := svc.ForgetLocalAppAgentMemory(callCtx, &runtimev1.ForgetLocalAppAgentMemoryRequest{AgentHandle: mintLocalAppAgentHandle(decision, other.GetLocalAgentRef()), MemoryIds: []string{items[0].MemoryRef}, Confirmed: true})
		if err == nil && response.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_FORGOTTEN {
			err = fmt.Errorf("unexpected Forget outcome %v", response.GetOutcome())
		}
		forgotten <- err
	}()
	awaitMemoryLifecycle(t, forgotten, "other bank Forget")
	// The same bank's cutoff also must not join inference. The captured late
	// result remains fenced by the existing Runtime and Core publication checks.
	decision, callCtx = localAppConfigureContext(accountservice.LocalAppOperationMemorySwitch, 0x74, blocked.GetOwnerUserId())
	disabled := make(chan error, 1)
	go func() {
		_, err := svc.SetLocalAppAgentMemoryEnabled(callCtx, &runtimev1.SetLocalAppAgentMemoryEnabledRequest{AgentHandle: mintLocalAppAgentHandle(decision, blocked.GetLocalAgentRef()), Enabled: false})
		disabled <- err
	}()
	awaitMemoryLifecycle(t, disabled, "blocked bank disable")
	unblock()
	svc.cognitionMemoryWG.Wait()
	var retained int
	if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_cognition_memory_ai_job WHERE local_agent_ref = ? AND (result_json IS NOT NULL OR payload_disposition <> 'disposed')`, blocked.GetLocalAgentRef()).Scan(&retained); err != nil || retained != 0 {
		t.Fatalf("late model result survived cutoff: retained=%d err=%v", retained, err)
	}
}

func TestCognitionMemoryStartupRestoresBarriersBeforeTrackedDerivedWorkAndCloseJoins(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	first, _, closeFirst := openRuntimeAgentTestCompositionWithOwner(t, localStatePath)
	refs := make([]string, 0, 2)
	for _, source := range []string{"startup-derive", "startup-cutoff"} {
		agent, err := materializeRealmSourceTestAgent(t, first, context.Background(), &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(source)})
		if err != nil {
			closeFirst()
			t.Fatal(err)
		}
		refs = append(refs, agent.GetAgent().GetLocalAgentRef())
		seedCognitionMemoryForTerminationTest(t, first, refs[len(refs)-1], "I prefer cedar forests")
	}
	if _, err := first.backend.DB().Exec(`CREATE TRIGGER inject_cutoff_rotation_failure BEFORE UPDATE OF state ON runtime_cognition_memory_stream WHEN NEW.state = 'retired' BEGIN SELECT RAISE(ABORT, 'injected cutoff rotation failure'); END`); err != nil {
		closeFirst()
		t.Fatal(err)
	}
	if _, err := first.cognitionMemoryFacade.SetEnabled(context.Background(), refs[1], false); err == nil {
		closeFirst()
		t.Fatal("cutoff recovery prerequisite did not fail")
	}
	if _, err := first.backend.DB().Exec(`DROP TRIGGER inject_cutoff_rotation_failure`); err != nil {
		closeFirst()
		t.Fatal(err)
	}
	closeFirst()

	backend, err := runtimepersistence.Open(nil, localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = backend.Close() }()
	owner, err := memoryv1.Open(filepath.Join(filepath.Dir(localStatePath), "cognition-memory-v1-test"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = owner.Close() }()
	svc, err := NewWithBackend(nil, localStatePath, backend)
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	entered, canceled, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	store, bridge, facade, termination := derivedLifecycleComposition(svc, owner, func(ctx context.Context, _ cognitionmemory.Binding, count int) (memoryv1.AIEmbeddingResult, error) {
		close(entered)
		select {
		case <-ctx.Done():
			close(canceled)
			<-release
			return memoryv1.AIEmbeddingResult{}, ctx.Err()
		case <-release:
			return derivedLifecycleVectors(count), nil
		}
	})
	configured := make(chan error, 1)
	go func() { configured <- svc.ConfigureCognitionMemory(store, bridge, facade, termination) }()
	awaitMemoryLifecycle(t, configured, "startup configuration")
	var pending int
	if err := backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_cognition_memory_cutoff WHERE phase <> 'completed'`).Scan(&pending); err != nil || pending != 0 {
		t.Fatalf("startup returned before durable cutoff recovery: pending=%d err=%v", pending, err)
	}
	cutoffBinding, err := store.BindingForAgent(context.Background(), refs[1])
	if err != nil || cutoffBinding.Enabled {
		t.Fatalf("startup cutoff reopened bank: %+v %v", cutoffBinding, err)
	}
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("tracked startup recovery did not start derived execution")
	}
	binding, err := store.BindingForAgent(context.Background(), refs[0])
	if err != nil {
		t.Fatal(err)
	}
	builds, err := owner.PendingEmbeddingRebuilds(context.Background(), binding.BankRef)
	if err != nil || len(builds) != 1 {
		t.Fatalf("startup fabricated derived readiness: pending=%v err=%v", builds, err)
	}
	closed := make(chan error, 1)
	go func() { svc.Close(); closed <- nil }()
	select {
	case <-canceled:
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not cancel tracked inference")
	}
	// Closed admission cannot add another worker while Close waits for the
	// already admitted worker's actual return, including cancellation cleanup.
	svc.triggerCognitionMemory(refs[0])
	select {
	case <-closed:
		t.Fatal("Close returned before inference settled")
	default:
	}
	unblock()
	awaitMemoryLifecycle(t, closed, "Close joining derived work")
	svc.cognitionMemoryDrainMu.Lock()
	remaining := len(svc.cognitionMemoryDraining)
	svc.cognitionMemoryDrainMu.Unlock()
	if remaining != 0 {
		t.Fatalf("Close retained %d active drains", remaining)
	}
}

func TestAccountTerminationRetrySharesMemoryCloseAdmission(t *testing.T) {
	svc, _, closeFn := openRuntimeAgentTestCompositionWithOwner(t, filepath.Join(t.TempDir(), "local-state.json"))
	defer closeFn()
	svc.cognitionMemoryDrainMu.Lock()
	scheduled := make(chan error, 1)
	go func() { svc.scheduleRealmAccountTerminationRetry(); scheduled <- nil }()
	select {
	case <-scheduled:
		svc.cognitionMemoryDrainMu.Unlock()
		t.Fatal("retry admitted a shared WaitGroup worker outside Memory lifecycle admission")
	case <-time.After(25 * time.Millisecond):
	}
	closed := make(chan error, 1)
	go func() { svc.Close(); closed <- nil }()
	svc.cognitionMemoryDrainMu.Unlock()
	awaitMemoryLifecycle(t, scheduled, "retry admission racing Close")
	awaitMemoryLifecycle(t, closed, "Close racing retry admission")
	svc.accountTerminationRetryMu.Lock()
	running := svc.accountTerminationRetrying
	svc.accountTerminationRetryMu.Unlock()
	if running {
		t.Fatal("Close returned with an active termination retry")
	}
}

func TestSameAgentRememberDoesNotWaitForDerivedModel(t *testing.T) {
	svc, owner, closeFn := openRuntimeAgentTestCompositionWithOwner(t, filepath.Join(t.TempDir(), "local-state.json"))
	defer closeFn()
	result, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext("canonical-before-derived")})
	if err != nil {
		t.Fatal(err)
	}
	ref := result.GetAgent().GetLocalAgentRef()
	bank := seedCognitionMemoryForTerminationTest(t, svc, ref, "I prefer cedar forests")
	svc.cognitionMemoryWG.Wait()
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	defer once.Do(func() { close(release) })
	calls := 0
	store, bridge, facade, termination := derivedLifecycleComposition(svc, owner, func(ctx context.Context, _ cognitionmemory.Binding, count int) (memoryv1.AIEmbeddingResult, error) {
		calls++
		if calls == 1 {
			close(entered)
			select {
			case <-release:
			case <-ctx.Done():
				return memoryv1.AIEmbeddingResult{}, ctx.Err()
			}
		}
		return derivedLifecycleVectors(count), nil
	})
	svc.cognitionMemoryStore, svc.cognitionMemoryBridge, svc.cognitionMemoryFacade, svc.cognitionMemoryTermination = store, bridge, facade, termination
	svc.triggerCognitionMemory(ref)
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("derived model did not start")
	}
	binding, err := store.BindingForAgent(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	envelope := cognitionMemoryMessageEnvelope(binding, time.Now(), &runtimev1.CognitionMemorySourceRef{Kind: "conversation_turn", Value: "new-turn"}, &runtimev1.CognitionMemorySourceRef{Kind: "conversation", Value: "new-conversation"}, publicChatTurnOriginUser, "I like mountain hikes", nil, true)
	if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error { _, err := store.EnqueueCommittedEventTx(tx, ref, envelope); return err }); err != nil {
		t.Fatal(err)
	}
	svc.triggerCognitionMemory(ref)
	deadline := time.Now().Add(2 * time.Second)
	for {
		items, err := owner.ListMemories(context.Background(), bank, false)
		if err != nil {
			t.Fatal(err)
		}
		if len(items) == 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("new canonical Memory waited for the old model")
		}
		time.Sleep(time.Millisecond)
	}
	once.Do(func() { close(release) })
	svc.cognitionMemoryWG.Wait()
}
