package ai

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestRuntimeShutdownFencesQueuedJobBeforeDispatch(t *testing.T) {
	var dispatched atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		dispatched.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer upstream.Close()

	f := newManagedCloudScenarioTestFixture(t, "minimax", "image-01", upstream.URL, Config{AllowLoopbackEndpoint: true})
	path := filepath.Join(t.TempDir(), "state.json")
	jobs, err := newScenarioJobStoreForLocalStatePath(path)
	if err != nil {
		t.Fatal(err)
	}
	f.service.scenarioJobs = jobs
	const appID = "nimi.desktop"
	var leases []func()
	for i := 0; i < 2; i++ {
		release, _, err := f.service.scheduler.Acquire(t.Context(), appID)
		if err != nil {
			t.Fatal(err)
		}
		leases = append(leases, release)
		t.Cleanup(release)
	}
	owner := scenarioJobUserContext(appID, "user-001")
	submitted, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "image.generate", f.targetRef), &runtimev1.SubmitScenarioJobRequest{
		Head:         &runtimev1.ScenarioRequestHead{AppId: appID, SubjectUserId: "user-001"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec:         &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "queue me"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	id := submitted.GetJob().GetJobId()
	deadline := time.Now().Add(3 * time.Second)
	for {
		job, _ := jobs.get(id)
		if job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Job did not enter the queue: %v", job)
		}
		time.Sleep(time.Millisecond)
	}

	f.service.BeginRuntimeShutdown()
	for _, release := range leases {
		release()
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	if err := f.service.DrainRuntimeJobs(ctx); err != nil {
		t.Fatal(err)
	}
	if got := dispatched.Load(); got != 0 {
		t.Fatalf("queued Job dispatched %d times after the shutdown fence", got)
	}
	reopened, err := newScenarioJobStoreForLocalStatePath(path)
	if err != nil {
		t.Fatal(err)
	}
	job, _ := reopened.get(id)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED ||
		job.GetReasonCode() != runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED ||
		job.GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_NOT_DISPATCHED ||
		job.GetInterruption().GetResubmitDisposition() != runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_CALLER_MAY_RESUBMIT {
		t.Fatalf("recovery did not retain the known non-dispatch: %v", job)
	}
}

func TestRuntimeShutdownRetainsNativeReceiptWithoutReplay(t *testing.T) {
	var creates, queries atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			creates.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprint(w, `{"output":{"task_id":"retained","task_status":"PENDING"}}`)
			return
		}
		queries.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer upstream.Close()

	f := newManagedCloudScenarioTestFixture(t, "dashscope", "wan2.6-t2i", upstream.URL, Config{AllowLoopbackEndpoint: true})
	path := filepath.Join(t.TempDir(), "state.json")
	jobs, err := newScenarioJobStoreForLocalStatePath(path)
	if err != nil {
		t.Fatal(err)
	}
	f.service.scenarioJobs = jobs
	owner := scenarioJobUserContext("nimi.desktop", "user-001")
	submitted, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "image.generate", f.targetRef), &runtimev1.SubmitScenarioJobRequest{
		Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec:         &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "one image"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	id := submitted.GetJob().GetJobId()
	waitNativeReceiptHandoff(t, f.service, id)
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	if err := f.service.DrainRuntimeJobs(ctx); err != nil {
		t.Fatal(err)
	}
	reopened, err := newScenarioJobStoreForLocalStatePath(path)
	if err != nil {
		t.Fatal(err)
	}
	job, _ := reopened.get(id)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || reopened.originalNativeReceipt(id) == nil {
		t.Fatalf("reopen lost the original task custody: %v", job)
	}
	if creates.Load() != 1 || queries.Load() != 0 {
		t.Fatalf("stop or reopen contacted the provider again: creates=%d queries=%d", creates.Load(), queries.Load())
	}
}
