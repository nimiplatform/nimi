package ai

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestNativeCreateLostAcknowledgementStaysUnknownAndCancelable(t *testing.T) {
	for _, mode := range []string{"eof", "truncated", "rejected"} {
		t.Run(mode, func(t *testing.T) {
			var creates atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost {
					t.Error("no locator must not trigger a query")
					http.NotFound(w, r)
					return
				}
				_, _ = io.Copy(io.Discard, r.Body)
				creates.Add(1)
				if mode == "eof" {
					conn, _, err := w.(http.Hijacker).Hijack()
					if err != nil {
						t.Error(err)
						return
					}
					conn.Close()
					return
				}
				w.Header().Set("Content-Type", "application/json")
				if mode == "truncated" {
					w.Header().Set("Content-Length", "100")
					fmt.Fprint(w, `{"task_`)
					return
				}
				w.WriteHeader(http.StatusBadRequest)
				fmt.Fprint(w, `{"error":"invalid request"}`)
			}))
			defer server.Close()
			f := newManagedCloudScenarioTestFixture(t, "volcengine", "doubao-seedance-2-0-260128", server.URL, Config{AllowLoopbackEndpoint: true})
			store, _ := newDurableScenarioJobStoreForFailureTest(t)
			f.service.scenarioJobs = store
			owner := scenarioJobUserContext("nimi.desktop", "user-001")
			response, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "video.generate", f.targetRef), &runtimev1.SubmitScenarioJobRequest{
				Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
				Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: "one create", Options: &runtimev1.VideoGenerationOptions{DurationSec: testInt32(4), Ratio: "16:9"}}}},
			})
			if err != nil {
				t.Fatal(err)
			}
			id := response.GetJob().GetJobId()
			deadline := time.Now().Add(5 * time.Second)
			for {
				job, _ := store.get(id)
				if isTerminalScenarioJobStatus(job.GetStatus()) || store.currentObservationIssue(id) != nil {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("create did not settle its finite work")
				}
				time.Sleep(time.Millisecond)
			}
			waitScenarioJobWorkExit(t, store, id)
			get, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id})
			if err != nil || creates.Load() != 1 {
				t.Fatalf("create repeated or Get failed: %v calls=%d", err, creates.Load())
			}
			if mode == "rejected" {
				if get.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
					t.Fatal("explicit rejection was hidden as pending")
				}
				return
			}
			if get.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || get.GetJob().GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_UNKNOWN || get.GetObservationIssue() == nil {
				t.Fatalf("lost ack fabricated terminal/non-dispatch: %v", get)
			}
			store.mu.RLock()
			for _, e := range store.jobs[id].events {
				if e.GetEventType() == runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED {
					t.Error("lost ack published FAILED")
				}
			}
			store.mu.RUnlock()
			canceled, err := f.service.CancelScenarioJob(owner, &runtimev1.CancelScenarioJobRequest{JobId: id})
			if err != nil || canceled.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || canceled.GetJob().GetStopOutcome() != runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_UNCONFIRMED || creates.Load() != 1 {
				t.Fatalf("original unknown Job cannot be canceled: %v %v", canceled, err)
			}
		})
	}
}

func TestReceivedNativeReceiptSurvivesFailedWriteInLiveJobWithoutReplay(t *testing.T) {
	var creates, queries atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost && r.URL.Path == "/contents/generations/tasks" {
			creates.Add(1)
			fmt.Fprint(w, `{"id":"original-task"}`)
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == "/contents/generations/tasks/original-task" {
			queries.Add(1)
			fmt.Fprint(w, `{"id":"original-task","status":"running"}`)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "volcengine", "doubao-seedance-2-0-260128", server.URL, Config{AllowLoopbackEndpoint: true})
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	f.service.scenarioJobs = store
	var writable atomic.Bool
	store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if r := store.jobs[attempt.JobID]; r != nil && r.nativeReceipt != nil && !r.nativeReceiptPending && !writable.Load() {
			return errors.New("receipt storage unavailable")
		}
		return nil
	}
	owner := scenarioJobUserContext("nimi.desktop", "user-001")
	response, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "video.generate", f.targetRef), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: "one original task", Options: &runtimev1.VideoGenerationOptions{DurationSec: testInt32(4), Ratio: "16:9"}}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	id := response.GetJob().GetJobId()
	deadline := time.Now().Add(5 * time.Second)
	for !store.nativeReceiptNeedsPersistence(id) {
		if time.Now().After(deadline) {
			job, _ := store.get(id)
			t.Fatalf("received handle was discarded: %v", job)
		}
		time.Sleep(time.Millisecond)
	}
	waitScenarioJobWorkExit(t, store, id)
	get, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || get.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || get.GetJob().GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_UNKNOWN || get.GetObservationIssue() == nil || queries.Load() != 0 {
		t.Fatalf("failed receipt write invented a terminal/acceptance: %v %v", get, err)
	}
	reopened := cloneScenarioJobStoreForReopenTest(t, store)
	interrupted, _ := reopened.get(id)
	if reopened.originalNativeReceipt(id) != nil || interrupted.GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_UNKNOWN || interrupted.GetInterruption().GetResubmitDisposition() != runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_OUTCOME_UNCERTAIN {
		t.Fatalf("unpersisted receipt promised restart recovery/safe retry: %v", interrupted)
	}
	writable.Store(true)
	get, err = f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || get.GetJob().GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED || get.GetObservationIssue() != nil || creates.Load() != 1 || queries.Load() != 1 {
		t.Fatalf("same live Job failed to recover original receipt: %v %v creates=%d queries=%d", get, err, creates.Load(), queries.Load())
	}
	if _, err := f.service.CancelScenarioJob(owner, &runtimev1.CancelScenarioJobRequest{JobId: id}); err != nil {
		t.Fatal(err)
	}
}
