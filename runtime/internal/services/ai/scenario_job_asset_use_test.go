package ai

import (
	"errors"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/protobuf/types/known/timestamppb"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// This spy checks the actual Job-store ownership callbacks only; it does not
// claim model execution or filesystem product acceptance.
type repairUseSpy struct{ active int }

func (s *repairUseSpy) AcquireModelAssetUse(string, string) func() {
	s.active++
	released := false
	return func() {
		if !released {
			released = true
			s.active--
		}
	}
}

func TestRepairIdempotentJobMustReleaseUnpublishedUsePin(t *testing.T) {
	store, err := newScenarioJobStoreForLocalStatePath(filepath.Join(t.TempDir(), "local-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	spy := &repairUseSpy{}
	store.setModelAssetUseHolder(spy)
	identity := &runtimev1.LoadoutEffectiveInputIdentity{LoadoutId: "loadout-original", CapabilityContract: "text.generate", RecipeId: "llama.text-generate.gemma-4-e2b-it.v1", RecipeRevision: "1", Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "local.text.generate.llama-cpp", DriverId: "nimi.runtime.driver.llama-cpp", DriverDialect: "llama.cpp/text-generate/v1"}, ModelAxes: []*runtimev1.LoadoutEffectiveModelAxisIdentity{{SlotId: "main.gguf", ModelAssetId: "model-original", ContentId: "sha256:" + strings.Repeat("a", 64)}}}
	assembly := resolvedAssemblyForPersistenceTest(t, identity)
	makeJob := func(id string) *runtimev1.ScenarioJob {
		now := timestamppb.New(time.Now().UTC())
		return &runtimev1.ScenarioJob{JobId: id, Head: &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "user-local"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, CreatedAt: now, UpdatedAt: now, TraceId: "trace-" + id, EffectiveInputIdentity: identity}
	}
	if _, published, err := store.createOwnedAndBindAssemblyChecked(makeJob("review-one"), func() {}, nil, "same-idempotency", assembly); err != nil || !published {
		t.Fatalf("first create: published=%v err=%v", published, err)
	}
	if _, published, err := store.createOwnedAndBindAssemblyChecked(makeJob("review-two"), func() {}, nil, "same-idempotency", assembly); err != nil || published {
		t.Fatalf("duplicate create: published=%v err=%v", published, err)
	}
	if spy.active != 1 {
		t.Fatalf("unpublished duplicate leaked use pin: active=%d publishedJobs=%d", spy.active, len(store.jobs))
	}
	store.persistenceFailure = func(scenarioJobPersistenceAttempt) error { return errors.New("publication write failed") }
	if _, published, err := store.createOwnedAndBindAssemblyChecked(makeJob("review-failed"), func() {}, nil, "new-idempotency", assembly); err == nil || published {
		t.Fatalf("failed publication: published=%v err=%v", published, err)
	}
	if spy.active != 1 {
		t.Fatalf("failed publication leaked a pin: %d", spy.active)
	}
	store.persistenceFailure = nil
	if _, _, err := store.requestCancel("review-one", "test completed"); err != nil {
		t.Fatal(err)
	}
	if spy.active != 0 {
		t.Fatalf("terminal Job retained %d pins", spy.active)
	}
	releases := 0
	assembly.modelAssetUse = localexecution.NewModelAssetUse(func() {
		// Inventory callbacks may re-enter the Job owner; never call under mu.
		store.get("handoff")
		releases++
	})
	if _, published, err := store.createOwnedAndBindAssemblyChecked(makeJob("handoff"), func() {}, nil, "handoff", assembly); err != nil || !published {
		t.Fatalf("handoff publish: %v", err)
	}
	assembly.modelAssetUse.Release()
	if releases != 0 || spy.active != 0 {
		t.Fatal("handoff released or re-acquired inventory after admission")
	}
	if _, _, err := store.requestCancel("handoff", "done"); err != nil {
		t.Fatal(err)
	}
	if releases != 1 {
		t.Fatalf("handoff release count = %d", releases)
	}
}
