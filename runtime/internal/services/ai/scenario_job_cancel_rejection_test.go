package ai

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

func TestRejectedCancelLeavesOriginalExecutionAbleToComplete(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	image := l1CarrierPNGBytes(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		closeOnce(started)
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"data":[{"b64_json":"%s"}]}`, base64.StdEncoding.EncodeToString(image))
	}))
	defer server.Close()
	defer closeOnce(release)
	f := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", server.URL, Config{AllowLoopbackEndpoint: true})
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	f.service.scenarioJobs = store
	store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Operation == scenarioJobPersistCancellation {
			return errors.New("Cancel gate cannot be persisted")
		}
		return nil
	}
	owner := scenarioJobUserContext("nimi.desktop", "user-001")
	response, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "image.generate", f.targetRef), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "one original image", N: testInt32(1), ResponseFormat: "base64"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	id := response.GetJob().GetJobId()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("original execution did not start")
	}
	if canceled, err := f.service.CancelScenarioJob(owner, &runtimev1.CancelScenarioJobRequest{JobId: id}); err == nil || canceled != nil {
		t.Fatal("unsaved Cancel was accepted")
	}
	observed, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || observed.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || store.cancellationRequested(id) {
		t.Fatalf("rejected Cancel changed original work: %v %v", observed, err)
	}
	store.mu.RLock()
	for _, event := range store.jobs[id].events {
		if event.GetEventType() == runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED || event.GetEventType() == runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED {
			t.Error("failed Cancel emitted a terminal event")
		}
	}
	store.mu.RUnlock()
	closeOnce(release)
	completed := waitScenarioJobTerminal(t, f.service, id, 5*time.Second)
	if completed.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || calls.Load() != 1 {
		t.Fatalf("rejected Cancel prevented original completion or replayed create: %v calls=%d", completed, calls.Load())
	}
	waitCompletedScenarioJobCleanup(t, f.service, id)
}

func TestAuthorityWithdrawalStillStopsWorkWhenTerminalWriteFails(t *testing.T) {
	store, id := admittedDispatchJob(t)
	work, cancel := context.WithCancel(context.Background())
	defer cancel()
	denied := grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	store.mu.Lock()
	r := store.jobs[id]
	r.cancel = cancel
	r.localAppOwner = &localAppJobOwner{AccountID: r.job.GetHead().GetSubjectUserId(), ProducerAppID: r.job.GetHead().GetAppId(), RegisteredAppSubject: r.job.GetHead().GetAppId(), workPermit: &jobWorkPermit{jobID: id, authority: accountservice.JobWorkAuthority{WithCurrent: func(context.Context, func() error) error { return denied }, Release: func() {}}}}
	store.mu.Unlock()
	store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
			return errors.New("terminal storage unavailable")
		}
		return nil
	}
	store.failJobWorkAuthority(id, denied)
	if work.Err() != context.Canceled {
		t.Fatal("true withdrawal inherited rejected-Cancel continuation")
	}
	job, _ := store.get(id)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING {
		t.Fatal("unsaved withdrawal fabricated a public terminal")
	}
	actions := 0
	if err := store.withJobWorkAuthority(id, func() error { actions++; return nil }); err == nil || actions != 0 {
		t.Fatal("withdrawn authority allowed another action")
	}
	store.persistenceFailure = nil
	if _, err := store.finishExecution(id); err != nil {
		t.Fatal(err)
	}
	if err := store.retryPendingTerminal(id); err != nil {
		t.Fatal(err)
	}
	job, _ = store.get(id)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || job.GetReasonCode() != runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN {
		t.Fatalf("retry lost true terminal cause: %v", job)
	}
}
