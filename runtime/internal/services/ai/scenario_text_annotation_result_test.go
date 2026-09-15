package ai

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

func annotationJobFixture(t *testing.T) (*scenarioJobStore, *runtimev1.ScenarioJob, string) {
	t.Helper()
	root := t.TempDir()
	state := filepath.Join(root, "state.json")
	store, err := newScenarioJobStoreForLocalStatePath(state)
	if err != nil {
		t.Fatal(err)
	}
	requirements, _ := (capabilitydriver.SpacyDriver{}).ProjectRecipe("spacy-md-en", nil, nil)
	profile := strings.Repeat("a", 64)
	selected := &localexecution.SelectedLocalExecution{
		LoadoutID: "annotation-loadout", CapabilityContract: capabilitydriver.TextAnnotateContract, RecipeID: "spacy-md-en", RecipeRevision: "1",
		DriverIdentity:         &runtimev1.CapabilityImplementationIdentity{ImplementationId: capabilitydriver.SpacyImplementationID, DriverId: capabilitydriver.SpacyDriverID, DriverDialect: capabilitydriver.SpacyDriverDialect},
		Requirements:           requirements,
		ExactBindings:          []localexecution.ExactBinding{{RequirementID: capabilitydriver.SpacyModelSlot, RequirementRole: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, ModelAssetID: "annotation-model", AbsolutePath: filepath.Join(root, "config.cfg"), BundleDir: root, DeclaredFiles: []string{"config.cfg"}, VerifiedContentID: "sha256:" + strings.Repeat("b", 64), EntrySHA256: strings.Repeat("c", 64)}},
		ExactDependencySources: []localexecution.ExactDependencySource{{DependencyFamily: "python.package-set", DependencyID: "python-profile." + profile, ConsumerScope: capabilitydriver.SpacyConsumerID, SelectedSourceRecordID: "profile-record", CanonicalRoot: filepath.Join(root, profile), Version: profile, Hashes: map[string]string{"profile_digest": profile, "driver_bundle_sha256": strings.Repeat("d", 64)}}},
	}
	spec := &runtimev1.TextAnnotateScenarioSpec{Language: "en", Texts: []string{"Hi"}}
	plan, err := (capabilitydriver.SpacyDriver{}).PlanTextAnnotationInvocation(capabilitydriver.TextAnnotationInvocationInput{RecipeID: selected.RecipeID, Request: spec, Bindings: projectInvocationExactBindings(selected.ExactBindings), DependencySources: invocationExactDependencySources(selected.ExactDependencySources)})
	if err != nil {
		t.Fatal(err)
	}
	assembly, err := localResolvedAssemblyForAnnotation(selected, plan)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := projectResolvedAssemblyEffectiveInputIdentity(assembly)
	if err != nil {
		t.Fatal(err)
	}
	job := &runtimev1.ScenarioJob{JobId: "annotation-job", Head: &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_ANNOTATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, TraceId: "annotation-trace", EffectiveInputIdentity: identity}
	if _, _, err := store.createOwnedAndBindAssemblyChecked(job, nil, nil, "", assembly); err != nil {
		t.Fatal(err)
	}
	return store, job, state
}

func TestAnnotationJobPreservesCapturedContentFailure(t *testing.T) {
	store, job, _ := annotationJobFixture(t)
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.scenarioJobs = store
	// The real Host must reject the captured but absent model before starting Python.
	svc.localAnnotationHost = engine.NewTextAnnotationExecutionHost(&engine.Manager{})
	svc.runLocalAnnotationScenarioJob(context.Background(), job.JobId, svc.localAnnotationJobOrder.reserve())
	failed, _ := store.get(job.JobId)
	if failed.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || failed.GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CONTENT_MISMATCH {
		t.Fatalf("captured content failure became %s / %s", failed.GetStatus(), failed.GetReasonCode())
	}
	metadata := failed.GetReasonMetadata().AsMap()
	if metadata["action_hint"] != "reverify_or_rebind_local_model_content" || metadata["retryable"] != false {
		t.Fatalf("captured content failure metadata = %v", metadata)
	}
}

func TestAnnotationResultCommitIsAtomicAndRestoresAfterRestart(t *testing.T) {
	store, job, state := annotationJobFixture(t)
	if _, _, err := store.transition(job.JobId, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); err != nil {
		t.Fatal(err)
	}
	result := &runtimev1.TextAnnotationResult{Documents: []*runtimev1.TextAnnotationDocument{{Text: "Hi", Language: "en", Tokens: []*runtimev1.TextAnnotationToken{{Text: "Hi", End: 2, PartOfSpeech: "INTJ", Dependency: "ROOT"}}, Sentences: []*runtimev1.TextAnnotationSentence{{EndToken: 1}}}}}
	complete := func(job *runtimev1.ScenarioJob) { job.TextAnnotation = cloneTextAnnotationResult(result) }
	store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			return errors.New("disk unavailable")
		}
		return nil
	}
	if _, _, err := store.transition(job.JobId, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, complete); err == nil {
		t.Fatal("expected persistence failure")
	}
	failed, _ := store.get(job.JobId)
	if failed.TextAnnotation != nil || failed.Status != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING {
		t.Fatal("result published before durable completion")
	}
	store.persistenceFailure = nil
	if _, _, err := store.transition(job.JobId, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, complete); err != nil {
		t.Fatal(err)
	}
	restored, err := newScenarioJobStoreForLocalStatePath(state)
	if err != nil {
		t.Fatal(err)
	}
	read, ok := restored.get(job.JobId)
	if !ok || read.GetTextAnnotation().GetDocuments()[0].GetText() != "Hi" {
		t.Fatal("annotation result was not restored")
	}
	projected, err := projectLocalAppScenarioJob(read)
	if err != nil || projected.GetTextAnnotation() == nil {
		t.Fatalf("protected annotation projection: %v", err)
	}
}
