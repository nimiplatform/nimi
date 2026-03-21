package ai

import (
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestScenarioJobStoreIdempotencyIndex(t *testing.T) {
	store := newScenarioJobStore()
	job := &runtimev1.ScenarioJob{
		JobId:        "idem-job-1",
		Head:         &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user", ModelId: "local/qwen", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		TraceId:      "trace-idem",
	}
	if snapshot := store.create(job, nil); snapshot == nil {
		t.Fatalf("expected create snapshot")
	}

	store.bindIdempotency("scope-1", "idem-job-1")
	found, ok := store.getByIdempotency("scope-1")
	if !ok || found.GetJobId() != "idem-job-1" {
		t.Fatalf("expected idempotency lookup hit, ok=%v job=%v", ok, found)
	}

	if _, ok := store.getByIdempotency("missing"); ok {
		t.Fatalf("unexpected idempotency lookup hit for missing scope")
	}

	// Invalid inputs should be no-op and should not panic.
	store.bindIdempotency("", "idem-job-1")
	store.bindIdempotency("scope-2", "")
}

func TestScenarioJobStorePrunesExpiredTerminalState(t *testing.T) {
	store := newScenarioJobStore()
	oldJob := &runtimev1.ScenarioJob{
		JobId:        "job-old",
		Head:         &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		TraceId:      "trace-old",
	}
	if snapshot := store.create(oldJob, nil); snapshot == nil {
		t.Fatalf("expected old job snapshot")
	}
	if _, ok := store.transition(
		"job-old",
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		nil,
	); !ok {
		t.Fatalf("expected old job terminal transition")
	}
	store.bindIdempotency("scope-old", "job-old")
	if stored := store.storeUploadedArtifact("app", "user", "trace-old", &runtimev1.ScenarioArtifact{ArtifactId: "artifact-old"}); stored == nil {
		t.Fatalf("expected stored artifact")
	}

	store.mu.Lock()
	record := store.jobs["job-old"]
	record.terminalAt = time.Now().UTC().Add(-scenarioJobRetention - time.Minute)
	binding := store.idempotency["scope-old"]
	binding.boundAt = time.Now().UTC().Add(-scenarioIdempotencyRetention - time.Minute)
	store.idempotency["scope-old"] = binding
	store.uploads["artifact-old"].storedAt = time.Now().UTC().Add(-scenarioUploadedArtifactRetention - time.Minute)
	store.mu.Unlock()

	freshJob := &runtimev1.ScenarioJob{
		JobId:        "job-fresh",
		Head:         &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		TraceId:      "trace-fresh",
	}
	if snapshot := store.create(freshJob, nil); snapshot == nil {
		t.Fatalf("expected fresh job snapshot")
	}

	if _, ok := store.get("job-old"); ok {
		t.Fatalf("expected expired terminal job to be pruned")
	}
	if _, ok := store.getByIdempotency("scope-old"); ok {
		t.Fatalf("expected expired idempotency binding to be pruned")
	}
	if _, _, ok := store.findArtifact("app", "user", "artifact-old"); ok {
		t.Fatalf("expected expired uploaded artifact to be pruned")
	}
	if _, ok := store.get("job-fresh"); !ok {
		t.Fatalf("expected fresh job to remain")
	}
}
