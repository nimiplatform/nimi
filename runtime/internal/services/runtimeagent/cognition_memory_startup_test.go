package runtimeagent

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
)

func openMemoryStartupService(t *testing.T, path string) (*Service, *memoryv1.Core) {
	t.Helper()
	backend, err := runtimepersistence.Open(nil, path)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := memoryv1.Open(filepath.Join(filepath.Dir(path), "cognition-memory-v1-test"))
	if err != nil {
		_ = backend.Close()
		t.Fatal(err)
	}
	svc, err := NewWithBackend(nil, path, backend)
	if err != nil {
		_ = owner.Close()
		_ = backend.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { svc.Close(); _ = owner.Close(); _ = backend.Close() })
	return svc, owner
}

func startupMemoryComposition(svc *Service, owner *memoryv1.Core, decorate func(cognitionmemory.OwnerPort) cognitionmemory.OwnerPort) (*cognitionmemory.Store, *cognitionmemory.Bridge, *cognitionmemory.Facade, *cognitionmemory.TerminationService) {
	store := cognitionmemory.NewStore(svc.backend)
	var ownerPort cognitionmemory.OwnerPort = cognitionmemory.NewOwnerAdapter(owner, store.BindingForOwner, nil)
	if decorate != nil {
		ownerPort = decorate(ownerPort)
	}
	bridge := cognitionmemory.NewBridge(store, ownerPort, svc.AuthorizeCognitionMemoryBinding)
	facade := cognitionmemory.NewFacade(store, ownerPort, bridge, svc.AuthorizeCognitionMemoryBinding, func(context.Context, cognitionmemory.Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return memoryv1.CapabilitySnapshot{Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil, nil
	})
	return store, bridge, facade, cognitionmemory.NewTerminationService(store, ownerPort)
}

type unavailableStartupEnsureOwner struct {
	cognitionmemory.OwnerPort
	binding string
}

func (o *unavailableStartupEnsureOwner) EnsureBank(ctx context.Context, req *runtimev1.CognitionMemoryEnsureBankRequest) (*runtimev1.CognitionMemoryEnsureBankResponse, error) {
	if req.GetBankBinding().GetValue() == o.binding {
		return &runtimev1.CognitionMemoryEnsureBankResponse{Outcome: runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_UNAVAILABLE}, errors.New("injected optional bank owner unavailable")
	}
	return o.OwnerPort.EnsureBank(ctx, req)
}

func TestMemoryStartupEnsureFailureDoesNotBlockRuntimeOrOtherAgent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "local-state.json")
	first, _, closeFirst := openRuntimeAgentTestCompositionWithOwner(t, path)
	t.Cleanup(closeFirst)
	bindings := make([]cognitionmemory.Binding, 0, 2)
	for _, source := range []string{"startup-ensure-unavailable", "startup-ensure-available"} {
		agent, err := materializeRealmSourceTestAgent(t, first, context.Background(), &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(source)})
		if err != nil {
			t.Fatal(err)
		}
		bindings = append(bindings, enqueueEnsureRaceEvent(t, first, agent.GetAgent().GetLocalAgentRef()))
	}
	closeFirst()
	svc, owner := openMemoryStartupService(t, path)
	store, bridge, facade, termination := startupMemoryComposition(svc, owner, func(base cognitionmemory.OwnerPort) cognitionmemory.OwnerPort {
		return &unavailableStartupEnsureOwner{OwnerPort: base, binding: bindings[0].BindingRef}
	})
	if err := svc.ConfigureCognitionMemory(store, bridge, facade, termination); err != nil {
		t.Fatalf("optional bank failure prevented Runtime startup: %v", err)
	}
	svc.cognitionMemoryWG.Wait()
	projection, err := facade.Inspect(context.Background(), cognitionmemory.InspectIntent{LocalAgentRef: bindings[0].LocalAgentRef})
	if err != nil || projection.Outcome != memoryv1.OutcomeUnconfigured || len(projection.Items) != 0 {
		t.Fatalf("unensured bank fabricated readiness: %+v %v", projection, err)
	}
	rows, err := store.ListOutbox(context.Background(), bindings[0].BindingRef)
	if err != nil || len(rows) != 1 || rows[0].State != "pending" || !rows[0].PayloadPresent {
		t.Fatalf("unavailable bank lost pending custody: %+v %v", rows, err)
	}
	if _, err := svc.agentByID(bindings[0].LocalAgentRef); err != nil {
		t.Fatalf("optional Memory failure made Agent unavailable: %v", err)
	}
	other, err := store.BindingForAgent(context.Background(), bindings[1].LocalAgentRef)
	if err != nil || other.BankRef == "" {
		t.Fatalf("other Agent binding did not recover: %+v %v", other, err)
	}
	items, err := owner.ListMemories(context.Background(), other.BankRef, false)
	if err != nil || len(items) != 1 {
		t.Fatalf("other Agent backlog did not recover: %+v %v", items, err)
	}
}

func TestMemoryStartupPendingCutoffCleanupKeepsDurableBarrierWithoutBlockingRuntime(t *testing.T) {
	path := filepath.Join(t.TempDir(), "local-state.json")
	first, _, closeFirst := openRuntimeAgentTestCompositionWithOwner(t, path)
	t.Cleanup(closeFirst)
	agent, err := materializeRealmSourceTestAgent(t, first, context.Background(), &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext("startup-cutoff-unavailable")})
	if err != nil {
		t.Fatal(err)
	}
	ref := agent.GetAgent().GetLocalAgentRef()
	seedCognitionMemoryForTerminationTest(t, first, ref, "I prefer cedar forests")
	failDispose := func(context.Context, string) error {
		return errors.New("injected required payload cleanup unavailable")
	}
	first.cognitionMemoryStore.SetAgentEmbeddingDisposer(failDispose)
	if result, err := first.cognitionMemoryFacade.SetEnabled(context.Background(), ref, false); err == nil || result.Outcome != memoryv1.OutcomeUnavailable {
		t.Fatalf("cutoff failure prerequisite: %+v %v", result, err)
	}
	closeFirst()
	svc, owner := openMemoryStartupService(t, path)
	store, bridge, facade, termination := startupMemoryComposition(svc, owner, nil)
	store.SetAgentEmbeddingDisposer(failDispose)
	if err := svc.ConfigureCognitionMemory(store, bridge, facade, termination); err != nil {
		t.Fatalf("fenced cleanup debt prevented Runtime startup: %v", err)
	}
	svc.cognitionMemoryWG.Wait()
	var pending int
	if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_cognition_memory_cutoff WHERE local_agent_ref = ? AND phase <> 'completed'`, ref).Scan(&pending); err != nil || pending != 1 {
		t.Fatalf("required cutoff cleanup falsely completed: pending=%d err=%v", pending, err)
	}
	recalled, err := facade.Recall(context.Background(), cognitionmemory.RecallIntent{LocalAgentRef: ref, Query: "cedar"})
	if err != nil || recalled.Outcome != memoryv1.OutcomeUnconfigured || len(recalled.Hits) != 0 {
		t.Fatalf("pending cutoff admitted Recall: %+v %v", recalled, err)
	}
	if _, err := bridge.DrainOne(context.Background(), ref); !errors.Is(err, cognitionmemory.ErrMemoryDisabled) {
		t.Fatalf("pending cutoff admitted delivery: %v", err)
	}
	if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error { return store.SetEnabledTx(tx, ref, true) }); !errors.Is(err, cognitionmemory.ErrConflict) {
		t.Fatalf("incomplete cutoff was re-enabled: %v", err)
	}
}

func TestMemoryStartupFailsWhenDurableTerminationFencesCannotBeRead(t *testing.T) {
	svc, owner := openMemoryStartupService(t, filepath.Join(t.TempDir(), "local-state.json"))
	store, bridge, facade, termination := startupMemoryComposition(svc, owner, nil)
	if _, err := svc.backend.DB().Exec(`ALTER TABLE runtime_cognition_memory_termination RENAME TO unavailable_termination_fixture`); err != nil {
		t.Fatal(err)
	}
	err := svc.ConfigureCognitionMemory(store, bridge, facade, termination)
	if err == nil || !strings.Contains(err.Error(), "inspect durable termination fences") {
		t.Fatalf("startup bypassed unknown termination fences: %v", err)
	}
	if len(svc.cognitionMemoryDraining) != 0 {
		t.Fatal("startup admitted Memory work without termination fences")
	}
}
