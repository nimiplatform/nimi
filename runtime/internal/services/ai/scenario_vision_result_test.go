package ai

import (
	"bytes"
	"errors"
	"image"
	"image/png"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

func TestVisionJobTimeoutAdmission(t *testing.T) {
	for _, value := range []int32{0, 1000, 120000, 600000} {
		got, err := localVisionJobTimeoutDuration(value)
		want := time.Duration(value) * time.Millisecond
		if value == 0 {
			want = 120 * time.Second
		}
		if err != nil || got != want {
			t.Fatalf("timeout %d: got %s, %v; want %s", value, got, err, want)
		}
	}
	for _, value := range []int32{-1, 999, 600001} {
		_, err := localVisionJobTimeoutDuration(value)
		reason, _ := grpcerr.ExtractReasonCode(err)
		if reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("timeout %d: got %v", value, err)
		}
	}
}

func createVisionStoreJob(t *testing.T, store *scenarioJobStore, root, id string) *runtimev1.VisionLocateResult {
	t.Helper()
	requirements, _ := (capabilitydriver.LocateAnythingDriver{}).ProjectRecipe(capabilitydriver.LocateAnythingRecipeID, nil, nil)
	profile := strings.Repeat("a", 64)
	selected := &localexecution.SelectedLocalExecution{
		LoadoutID: "vision-loadout", CapabilityContract: capabilitydriver.VisionLocateContract, RecipeID: capabilitydriver.LocateAnythingRecipeID, RecipeRevision: "1",
		DriverIdentity:         &runtimev1.CapabilityImplementationIdentity{ImplementationId: capabilitydriver.LocateAnythingImplementationID, DriverId: capabilitydriver.LocateAnythingDriverID, DriverDialect: capabilitydriver.LocateAnythingDriverDialect},
		Requirements:           requirements,
		ExactBindings:          []localexecution.ExactBinding{{RequirementID: capabilitydriver.LocateAnythingModelSlot, RequirementRole: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, ModelAssetID: "vision-model", AbsolutePath: filepath.Join(root, "model.safetensors"), BundleDir: root, DeclaredFiles: []string{"model.safetensors"}, VerifiedContentID: "sha256:" + strings.Repeat("b", 64), EntrySHA256: strings.Repeat("c", 64)}},
		ExactDependencySources: []localexecution.ExactDependencySource{{DependencyFamily: "python.package-set", DependencyID: "python-profile." + profile, ConsumerScope: capabilitydriver.LocateAnythingConsumerID, SelectedSourceRecordID: "profile-record", CanonicalRoot: filepath.Join(root, profile), Version: profile, Hashes: map[string]string{"profile_digest": profile, "driver_bundle_sha256": strings.Repeat("d", 64)}}},
	}
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, image.NewRGBA(image.Rect(0, 0, 3, 2))); err != nil {
		t.Fatal(err)
	}
	spec := &runtimev1.VisionLocateScenarioSpec{ImageArtifactId: "input-image", Query: "the absent object", Geometry: runtimev1.VisionLocateGeometry_VISION_LOCATE_GEOMETRY_BOX}
	plan, err := (capabilitydriver.LocateAnythingDriver{}).PlanVisionLocateInvocation(capabilitydriver.VisionLocateInvocationInput{RecipeID: selected.RecipeID, PlatformTuple: "windows/amd64", Request: spec, ImageBytes: buffer.Bytes(), Width: 3, Height: 2, Bindings: projectInvocationExactBindings(selected.ExactBindings), DependencySources: invocationExactDependencySources(selected.ExactDependencySources)})
	if err != nil {
		t.Fatal(err)
	}
	assembly, err := localResolvedAssemblyForVision(selected, plan, "windows/amd64")
	if err != nil {
		t.Fatal(err)
	}
	identity, err := projectResolvedAssemblyEffectiveInputIdentity(assembly)
	if err != nil {
		t.Fatal(err)
	}
	job := &runtimev1.ScenarioJob{JobId: id, Head: &runtimev1.ScenarioRequestHead{AppId: "test-app", SubjectUserId: "test-user"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VISION_LOCATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, TraceId: id + "-trace", EffectiveInputIdentity: identity}
	if _, _, err := store.createOwnedAndBindAssemblyChecked(job, nil, nil, "", assembly); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.transition(id, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); err != nil {
		t.Fatal(err)
	}
	return &runtimev1.VisionLocateResult{ImageArtifactId: spec.ImageArtifactId, Width: 3, Height: 2}
}

func TestVisionResultCommitIsAtomicAndRestoresAfterRestart(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(root, "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(state)
	if err != nil {
		t.Fatal(err)
	}
	result := createVisionStoreJob(t, store, root, "completed-vision")
	store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			return errors.New("disk unavailable")
		}
		return nil
	}
	if _, _, err := store.transitionWithResults("completed-vision", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, nil, nil, result, nil); err == nil {
		t.Fatal("expected persistence failure")
	}
	if _, ok := store.completedVisionResult("completed-vision"); ok {
		t.Fatal("result published before durable completion")
	}
	job, _ := store.get("completed-vision")
	if job.Status != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING {
		t.Fatalf("state changed on failed result commit: %s", job.Status)
	}
	store.persistenceFailure = nil
	if _, _, err := store.transitionWithResults("completed-vision", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, nil, nil, result, nil); err != nil {
		t.Fatal(err)
	}
	createVisionStoreJob(t, store, root, "interrupted-vision")
	restarted, err := newScenarioJobStoreForLocalStatePath(state)
	if err != nil {
		t.Fatal(err)
	}
	restored, ok := restarted.completedVisionResult("completed-vision")
	if !ok || len(restored.Locations) != 0 || restored.ImageArtifactId != result.ImageArtifactId {
		t.Fatalf("negative result did not survive restart: %+v", restored)
	}
	interrupted, _ := restarted.get("interrupted-vision")
	if interrupted.ReasonCode != runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED || interrupted.GetInterruption().GetCause() != runtimev1.ExecutionInterruptionCause_EXECUTION_INTERRUPTION_CAUSE_RUNTIME_RESTART {
		t.Fatalf("in-flight restart was not interrupted: %+v", interrupted)
	}
}

func TestVisionResultRejectsMissingCrossImageAndLateCompletion(t *testing.T) {
	store := newScenarioJobStore()
	result := createVisionStoreJob(t, store, t.TempDir(), "vision")
	if _, _, err := store.transition("vision", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, nil); err == nil {
		t.Fatal("completed Locate without result accepted")
	}
	result.ImageArtifactId = "other-image"
	if _, _, err := store.transitionWithResults("vision", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, nil, nil, result, nil); err == nil {
		t.Fatal("cross-image result accepted")
	}
	if _, _, err := store.transition("vision", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED, nil); err != nil {
		t.Fatal(err)
	}
	result.ImageArtifactId = "input-image"
	if _, changed, err := store.transitionWithResults("vision", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, nil, nil, result, nil); err != nil || changed {
		t.Fatal("late completion changed canceled Job")
	}
}
