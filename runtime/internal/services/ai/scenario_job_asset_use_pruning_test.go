package ai

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Isolated owner-lifetime probe, not a model inference or GUI test. The
// explicit future prune time represents terminal stream delivery outliving
// the configured retention period; it does not change the system clock.
func TestTerminalJobPruningWaitsForExecutorAndModelAssetRelease(t *testing.T) {
	store, err := newScenarioJobStoreForLocalStatePath(filepath.Join(t.TempDir(), "local-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	identity := &runtimev1.LoadoutEffectiveInputIdentity{LoadoutId: "loadout-original", CapabilityContract: "text.generate", RecipeId: "llama.text-generate.gemma-4-e2b-it.v1", RecipeRevision: "1", Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "local.text.generate.llama-cpp", DriverId: "nimi.runtime.driver.llama-cpp", DriverDialect: "llama.cpp/text-generate/v1"}, ModelAxes: []*runtimev1.LoadoutEffectiveModelAxisIdentity{{SlotId: "main.gguf", ModelAssetId: "model-original", ContentId: "sha256:" + strings.Repeat("a", 64)}}}
	assembly := resolvedAssemblyForPersistenceTest(t, identity)
	releases := 0
	admission := localexecution.NewModelAssetUse(func() { releases++ })
	assembly.modelAssetUse = admission
	now := timestamppb.Now()
	job := &runtimev1.ScenarioJob{JobId: "audit-consumers-terminal", Head: &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "user-local"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, CreatedAt: now, UpdatedAt: now, TraceId: "audit-consumers-trace", EffectiveInputIdentity: identity}
	if _, published, err := store.createOwnedAndBindAssemblyChecked(job, func() {}, nil, "", assembly); err != nil || !published {
		t.Fatalf("create: published=%v err=%v", published, err)
	}
	record := store.jobs[job.JobId]
	defer record.releaseModelAssetUses()
	defer admission.Release()
	if !store.startExecution(job.JobId) {
		t.Fatal("start failed")
	}
	for _, state := range []runtimev1.ScenarioJobStatus{runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED} {
		if _, changed, err := store.transition(job.JobId, state, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TYPE_UNSPECIFIED, nil); err != nil || !changed {
			t.Fatalf("transition %v: changed=%v err=%v", state, changed, err)
		}
	}
	if releases != 0 {
		t.Fatal("terminal status prematurely released the live executor")
	}
	store.mu.Lock()
	store.pruneJobsLocked(time.Now().Add(scenarioJobRetention + time.Second))
	_, retained := store.jobs[job.JobId]
	store.mu.Unlock()
	if !retained {
		t.Fatal("pruned a terminal Job before its executor returned captured uses")
	}
	// The existing deferred finish runs when terminal Send returns, followed
	// by the request scope's release in StreamScenario.
	if _, err := store.finishExecution(job.JobId); err != nil {
		t.Fatal(err)
	}
	admission.Release()
	if releases != 1 {
		t.Fatalf("executor and request exited but inventory release count=%d, want=1; pruned record still owns %d use callback(s)", releases, len(record.modelAssetUses))
	}

	store.mu.Lock()
	store.pruneJobsLocked(time.Now().Add(scenarioJobRetention + time.Second))
	_, retained = store.jobs[job.JobId]
	store.mu.Unlock()
	if retained {
		t.Fatal("finished Job was not eligible for ordinary retention pruning")
	}
}
