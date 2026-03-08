package ai

import (
	"testing"

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
