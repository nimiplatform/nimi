package ai

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func TestFiniteURLsRemainOwnedAcrossPartialDownloadAndReopen(t *testing.T) {
	var creates, firstBodies, secondBodies atomic.Int32
	var secondReady atomic.Bool
	image := l1CarrierPNGBytes(t)
	var endpoint string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/image_generation":
			creates.Add(1)
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"id":"trace-only","data":{"image_urls":["%s/first","%s/second"]},"base_resp":{"status_code":0}}`, endpoint, endpoint)
		case r.Method == http.MethodGet && (r.URL.Path == "/first" || r.URL.Path == "/second"):
			if r.Header.Get("Authorization") != "" {
				t.Error("result URL received provider credential")
			}
			if r.URL.Path == "/first" {
				firstBodies.Add(1)
			} else {
				secondBodies.Add(1)
				if !secondReady.Load() {
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
			}
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(image)
		default:
			t.Errorf("unexpected finite protocol IO: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	endpoint = server.URL
	f := newManagedCloudScenarioTestFixture(t, "minimax", "image-01", endpoint, Config{AllowLoopbackEndpoint: true})
	store, err := newScenarioJobStoreForLocalStatePath(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	f.service.scenarioJobs = store
	root := t.TempDir()
	artifacts, err := runtimeartifact.NewDiskStore(root)
	if err != nil {
		t.Fatal(err)
	}
	f.service.SetRuntimeArtifactStore(artifacts)
	owner := scenarioJobUserContext("nimi.desktop", "user-001")
	submitted, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "image.generate", f.targetRef), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "two images", N: testInt32(2), ResponseFormat: "url"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	id := submitted.GetJob().GetJobId()
	deadline := time.Now().Add(30 * time.Second)
	for secondBodies.Load() == 0 {
		if time.Now().After(deadline) {
			job, _ := store.get(id)
			t.Fatalf("finite work did not autonomously acquire bodies: %v", job)
		}
		time.Sleep(time.Millisecond)
	}
	waitScenarioJobWorkExit(t, store, id)
	job, _ := store.get(id)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || job.GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED || len(job.GetArtifacts()) != 0 || store.originalNativeReceipt(id) != nil {
		t.Fatalf("finite acquisition failure changed execution facts: %v", job)
	}
	if _, public := artifacts.Stat(id + "-result-1"); public {
		t.Fatal("partial set was publicly visible")
	}
	if _, complete := artifacts.JobBodyStat(id, id+"-result-1"); !complete {
		t.Fatal("first complete body was not retained")
	}
	recovered := newTestService(nil)
	recovered.connStore = f.service.connStore
	recovered.remoteMediaHost = f.service.remoteMediaHost
	recovered.scenarioJobs = cloneScenarioJobStoreForReopenTest(t, store)
	f.service = recovered
	artifacts, err = runtimeartifact.NewDiskStore(root)
	if err != nil {
		t.Fatal(err)
	}
	f.service.SetRuntimeArtifactStore(artifacts)
	if err := f.service.ReconcileNativeBodyPublications(); err != nil {
		t.Fatal(err)
	}
	secondReady.Store(true)
	f.service.scenarioJobs.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			return errors.New("final result commit temporarily unavailable")
		}
		return nil
	}
	ready, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || ready.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || !f.service.scenarioJobs.hasResultCandidate(id) {
		t.Fatalf("finite result did not survive body recovery/commit failure: %v %v", ready, err)
	}
	f.service.scenarioJobs.persistenceFailure = nil
	disabled := runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED
	if _, err := f.service.connStore.Update(f.connectorID, connector.ConnectorMutations{Status: &disabled}); err != nil {
		t.Fatal(err)
	}
	done, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || done.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(done.GetJob().GetArtifacts()) != 2 {
		t.Fatalf("complete result needed new provider IO: %v %v", done, err)
	}
	if creates.Load() != 1 || firstBodies.Load() != 1 || secondBodies.Load() != 2 {
		t.Fatalf("original generation/body reuse counts=%d/%d/%d", creates.Load(), firstBodies.Load(), secondBodies.Load())
	}
	waitCompletedScenarioJobCleanup(t, f.service, id)
}
