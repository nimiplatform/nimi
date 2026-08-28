package runtimeagent

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
)

type ensureCommitBarrierOwner struct {
	cognitionmemory.OwnerPort
	committed chan struct{}
	release   chan struct{}
	once      sync.Once
	bankRef   string
}

func (o *ensureCommitBarrierOwner) EnsureBank(ctx context.Context, request *runtimev1.CognitionMemoryEnsureBankRequest) (*runtimev1.CognitionMemoryEnsureBankResponse, error) {
	response, err := o.OwnerPort.EnsureBank(ctx, request)
	if err == nil && response.GetOutcome() == runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_COMMITTED {
		o.bankRef = response.GetBank().GetValue()
		o.once.Do(func() { close(o.committed) })
		select {
		case <-ctx.Done():
			return response, ctx.Err()
		case <-o.release:
		}
	}
	return response, err
}

func installEnsureCommitBarrierOwner(t *testing.T, svc *Service, owner *memoryv1.Core) *ensureCommitBarrierOwner {
	t.Helper()
	store := svc.cognitionMemoryStore
	capabilities := func(context.Context, cognitionmemory.Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error) {
		return memoryv1.CapabilitySnapshot{Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil, nil
	}
	base := cognitionmemory.NewOwnerAdapter(owner, store.BindingForOwner, func(ctx context.Context, binding cognitionmemory.Binding) (memoryv1.CapabilitySnapshot, error) {
		snapshot, _, err := capabilities(ctx, binding)
		return snapshot, err
	})
	barrier := &ensureCommitBarrierOwner{OwnerPort: base, committed: make(chan struct{}), release: make(chan struct{})}
	bridge := cognitionmemory.NewBridge(store, barrier, svc.AuthorizeCognitionMemoryBinding)
	svc.cognitionMemoryBridge = bridge
	svc.cognitionMemoryFacade = cognitionmemory.NewFacade(store, barrier, bridge, svc.AuthorizeCognitionMemoryBinding, capabilities)
	svc.cognitionMemoryTermination = cognitionmemory.NewTerminationService(store, barrier)
	return barrier
}

func enqueueEnsureRaceEvent(t *testing.T, svc *Service, localAgentRef string) cognitionmemory.Binding {
	t.Helper()
	binding, err := svc.cognitionMemoryStore.BindingForAgent(context.Background(), localAgentRef)
	if err != nil {
		t.Fatal(err)
	}
	envelope := cognitionMemoryMessageEnvelope(
		binding,
		time.Now().UTC(),
		&runtimev1.CognitionMemorySourceRef{Kind: "conversation_turn", Value: "turn-" + localAgentRef},
		&runtimev1.CognitionMemorySourceRef{Kind: "conversation", Value: "conversation-" + localAgentRef},
		publicChatTurnOriginUser,
		"I prefer a lifecycle-race proof",
		nil,
		true,
	)
	if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := svc.cognitionMemoryStore.EnqueueCommittedEventTx(tx, localAgentRef, envelope)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return binding
}

func waitEnsureRaceBlocked(t *testing.T, done <-chan error) {
	t.Helper()
	select {
	case err := <-done:
		t.Fatalf("lifecycle operation crossed the owner Ensure/Runtime bind boundary: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestMemoryDisableWaitsForOwnerEnsureBindAndCutsOffTheSameBank(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	svc, owner, closeFn := openRuntimeAgentTestCompositionWithOwner(t, localStatePath)
	defer closeFn()
	const runtimeSourceRef = "ensure-disable-race"
	agent, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)})
	if err != nil {
		t.Fatal(err)
	}
	localAgentRef := agent.GetAgent().GetLocalAgentRef()
	original := enqueueEnsureRaceEvent(t, svc, localAgentRef)
	barrier := installEnsureCommitBarrierOwner(t, svc, owner)
	processDone := make(chan error, 1)
	go func() { processDone <- svc.processCognitionMemoryAgent(context.Background(), localAgentRef) }()
	<-barrier.committed

	decision, callCtx := localAppConfigureContext(accountservice.LocalAppOperationMemorySwitch, 0x72, agent.GetAgent().GetOwnerUserId())
	handle := mintLocalAppAgentHandle(decision, localAgentRef)
	cutoffDone := make(chan error, 1)
	go func() {
		_, callErr := svc.SetLocalAppAgentMemoryEnabled(callCtx, &runtimev1.SetLocalAppAgentMemoryEnabledRequest{AgentHandle: handle, Enabled: false})
		cutoffDone <- callErr
	}()
	waitEnsureRaceBlocked(t, cutoffDone)
	close(barrier.release)
	if err := <-cutoffDone; err != nil {
		t.Fatalf("disable after ensured owner bank: %v", err)
	}
	<-processDone

	current, err := svc.cognitionMemoryStore.BindingForAgent(context.Background(), localAgentRef)
	if err != nil || current.Enabled || current.BindingRef == original.BindingRef || current.BankRef != barrier.bankRef || current.LifecycleRef == "" {
		t.Fatalf("disable did not cut off the owner-ensured bank: binding=%+v bank=%q err=%v", current, barrier.bankRef, err)
	}
	if _, err := owner.ListMemories(context.Background(), barrier.bankRef, true); err != nil {
		t.Fatalf("disable orphaned the owner bank instead of retaining it behind the cutoff: %v", err)
	}
}

func TestAgentTerminationWaitsForOwnerEnsureBindAndDeletesTheSameBank(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	svc, owner, closeFn := openRuntimeAgentTestCompositionWithOwner(t, localStatePath)
	defer closeFn()
	const runtimeSourceRef = "ensure-termination-race"
	agent, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)})
	if err != nil {
		t.Fatal(err)
	}
	localAgentRef := agent.GetAgent().GetLocalAgentRef()
	enqueueEnsureRaceEvent(t, svc, localAgentRef)
	barrier := installEnsureCommitBarrierOwner(t, svc, owner)
	processDone := make(chan error, 1)
	go func() { processDone <- svc.processCognitionMemoryAgent(context.Background(), localAgentRef) }()
	<-barrier.committed

	terminationDone := make(chan error, 1)
	go func() {
		_, terminateErr := svc.TerminateAgent(context.Background(), &runtimev1.TerminateAgentRequest{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)})
		terminationDone <- terminateErr
	}()
	waitEnsureRaceBlocked(t, terminationDone)
	close(barrier.release)
	if err := <-terminationDone; err != nil {
		t.Fatalf("termination after ensured owner bank: %v", err)
	}
	<-processDone

	if _, err := owner.ListMemories(context.Background(), barrier.bankRef, true); !memoryv1.IsOutcome(err, memoryv1.OutcomeConflict) {
		t.Fatalf("termination left the late owner-ensured bank readable: %v", err)
	}
	if _, err := svc.cognitionMemoryStore.BindingForAgent(context.Background(), localAgentRef); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("termination retained the Runtime Memory binding: %v", err)
	}
}

func TestOwnerEnsureCommitBeforeRestartReusesStableBindingOperation(t *testing.T) {
	root := t.TempDir()
	localStatePath := filepath.Join(root, "local-state.json")
	first, owner, closeFirst := openRuntimeAgentTestCompositionWithOwner(t, localStatePath)
	const runtimeSourceRef = "ensure-before-restart"
	agent, err := materializeRealmSourceTestAgent(t, first, context.Background(), &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)})
	if err != nil {
		closeFirst()
		t.Fatal(err)
	}
	localAgentRef := agent.GetAgent().GetLocalAgentRef()
	binding := enqueueEnsureRaceEvent(t, first, localAgentRef)
	ensured, err := owner.EnsureBank(context.Background(), memoryv1.EnsureBankRequest{
		ContractVersion: memoryv1.ContractVersion,
		BindingRef:      binding.BindingRef,
		OperationID:     binding.BindingOperationID,
	})
	if err != nil {
		closeFirst()
		t.Fatal(err)
	}
	closeFirst()

	reopened, _, closeSecond := openRuntimeAgentTestCompositionWithOwner(t, localStatePath)
	defer closeSecond()
	recovered, err := reopened.cognitionMemoryStore.BindingForAgent(context.Background(), localAgentRef)
	if err != nil || recovered.BankRef != ensured.BankRef || recovered.LifecycleRef != ensured.LifecycleRef {
		t.Fatalf("restart did not bind the stable owner Ensure result: binding=%+v ensured=%+v err=%v", recovered, ensured, err)
	}
}
