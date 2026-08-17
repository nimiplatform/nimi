package ai

import (
	"fmt"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestScenarioJobStoreIdempotencyIndex(t *testing.T) {
	store := newScenarioJobStore()
	job := &runtimev1.ScenarioJob{
		JobId:        "idem-job-1",
		Head:         &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		TraceId:      "trace-idem",
	}
	if snapshot := store.create(job, nil); snapshot == nil {
		t.Fatalf("expected create snapshot")
	}

	if err := store.bindIdempotency("scope-1", "idem-job-1"); err != nil {
		t.Fatalf("bind idempotency: %v", err)
	}
	found, ok := store.getByIdempotency("scope-1")
	if !ok || found.GetJobId() != "idem-job-1" {
		t.Fatalf("expected idempotency lookup hit, ok=%v job=%v", ok, found)
	}

	if _, ok := store.getByIdempotency("missing"); ok {
		t.Fatalf("unexpected idempotency lookup hit for missing scope")
	}

	// Invalid inputs should be no-op and should not panic.
	if err := store.bindIdempotency("", "idem-job-1"); err != nil {
		t.Fatalf("empty scope idempotency no-op: %v", err)
	}
	if err := store.bindIdempotency("scope-2", ""); err != nil {
		t.Fatalf("empty job idempotency no-op: %v", err)
	}
}

func TestScenarioJobStoreConcurrentIdempotentCreateReturnsOneCanonicalJob(t *testing.T) {
	store, localStatePath := newDurableScenarioJobStoreForFailureTest(t)
	start := make(chan struct{})
	results := make([]*runtimev1.ScenarioJob, 2)
	created := make([]bool, 2)
	errs := make([]error, 2)
	var wait sync.WaitGroup
	for index := range results {
		index := index
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			now := timestamppb.New(time.Now().UTC())
			results[index], created[index], errs[index] = store.createOwnedAndBindChecked(&runtimev1.ScenarioJob{
				JobId:     fmt.Sprintf("job-concurrent-%d", index),
				Status:    runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
				CreatedAt: now,
				UpdatedAt: now,
			}, func() {}, nil, "scope-concurrent")
		}()
	}
	close(start)
	wait.Wait()

	for index, err := range errs {
		if err != nil {
			t.Fatalf("concurrent create %d: %v", index, err)
		}
	}
	if results[0].GetJobId() == "" || results[0].GetJobId() != results[1].GetJobId() {
		t.Fatalf("concurrent creates returned non-canonical Jobs: %q and %q", results[0].GetJobId(), results[1].GetJobId())
	}
	if created[0] == created[1] {
		t.Fatalf("create-if-absent ownership = %v, want exactly one creator", created)
	}
	store.mu.RLock()
	jobCount := len(store.jobs)
	bindingCount := len(store.idempotency)
	binding := store.idempotency["scope-concurrent"]
	store.mu.RUnlock()
	if jobCount != 1 || bindingCount != 1 || binding.jobID != results[0].GetJobId() {
		t.Fatalf("in-memory create-if-absent state: jobs=%d bindings=%d binding=%q canonical=%q", jobCount, bindingCount, binding.jobID, results[0].GetJobId())
	}

	reopened, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatalf("reopen durable ScenarioJob store: %v", err)
	}
	reopened.mu.RLock()
	durableJobCount := len(reopened.jobs)
	durableBindingCount := len(reopened.idempotency)
	durableBinding := reopened.idempotency["scope-concurrent"]
	reopened.mu.RUnlock()
	if durableJobCount != 1 || durableBindingCount != 1 || durableBinding.jobID != results[0].GetJobId() {
		t.Fatalf("durable create-if-absent state: jobs=%d bindings=%d binding=%q canonical=%q", durableJobCount, durableBindingCount, durableBinding.jobID, results[0].GetJobId())
	}
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
	if _, ok, err := store.transition(
		"job-old",
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		nil,
	); err != nil || !ok {
		t.Fatalf("expected old job terminal transition: %v", err)
	}
	if err := store.bindIdempotency("scope-old", "job-old"); err != nil {
		t.Fatalf("bind old idempotency: %v", err)
	}
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

func TestScenarioJobStoreTerminalTransitionIsLocked(t *testing.T) {
	store := newScenarioJobStore()
	job := &runtimev1.ScenarioJob{
		JobId:        "job-terminal-lock",
		Head:         &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		TraceId:      "trace-terminal-lock",
	}
	if snapshot := store.create(job, nil); snapshot == nil {
		t.Fatalf("expected create snapshot")
	}
	if canceled, ok, err := store.transition(
		"job-terminal-lock",
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED,
		nil,
	); err != nil || !ok || canceled.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("expected canceled terminal transition, ok=%v job=%+v err=%v", ok, canceled, err)
	}
	completed, ok, err := store.transition(
		"job-terminal-lock",
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		func(job *runtimev1.ScenarioJob) {
			job.Artifacts = []*runtimev1.ScenarioArtifact{{ArtifactId: "artifact-after-cancel"}}
		},
	)
	if err != nil {
		t.Fatalf("rejected terminal transition returned persistence error: %v", err)
	}
	if ok {
		t.Fatalf("terminal job must reject later completion transition, got job=%+v", completed)
	}
	if completed.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("terminal job status changed after rejected transition: %+v", completed)
	}
	if len(completed.GetArtifacts()) != 0 {
		t.Fatalf("rejected terminal transition must not run mutation, got artifacts=%+v", completed.GetArtifacts())
	}
}

func TestScenarioJobStoreFindArtifactUsesJobArtifactIndex(t *testing.T) {
	store := newScenarioJobStore()
	job := &runtimev1.ScenarioJob{
		JobId:        "job-indexed",
		Head:         &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
		TraceId:      "trace-indexed",
	}
	if snapshot := store.create(job, nil); snapshot == nil {
		t.Fatalf("expected create snapshot")
	}
	if _, ok, err := store.transition(
		"job-indexed",
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		func(job *runtimev1.ScenarioJob) {
			job.Artifacts = []*runtimev1.ScenarioArtifact{{
				ArtifactId: "artifact-indexed",
				MimeType:   "image/png",
			}}
		},
	); err != nil || !ok {
		t.Fatalf("expected completed transition: %v", err)
	}

	artifact, traceID, ok := store.findArtifact("app", "user", "artifact-indexed")
	if !ok || artifact == nil {
		t.Fatalf("expected indexed artifact lookup hit")
	}
	if traceID != "trace-indexed" {
		t.Fatalf("unexpected trace id: %q", traceID)
	}
	if artifact.GetMimeType() != "image/png" {
		t.Fatalf("unexpected artifact mime type: %q", artifact.GetMimeType())
	}
}
