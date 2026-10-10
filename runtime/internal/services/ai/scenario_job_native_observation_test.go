package ai

import (
	"context"
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

func TestNativeJobPersistsReceiptAndOnlyFreshGetQueriesOriginalTask(t *testing.T) {
	var creates, queries atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/contents/generations/tasks":
			creates.Add(1)
			_, _ = fmt.Fprint(w, `{"id":"original-task"}`)
		case r.Method == http.MethodGet && r.URL.Path == "/contents/generations/tasks/original-task":
			queries.Add(1)
			_, _ = fmt.Fprint(w, `{"id":"original-task","status":"running"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "volcengine", "doubao-seedance-2-0-260128", server.URL, Config{AllowLoopbackEndpoint: true})
	owner := scenarioJobUserContext("nimi.desktop", "user-001")
	submitCtx, detach := context.WithCancel(withCloudScenarioTestIntent(owner, "video.generate", f.targetRef))
	response, err := f.service.SubmitScenarioJob(submitCtx, &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: "one original action", Options: &runtimev1.VideoGenerationOptions{DurationSec: testInt32(4), Ratio: "16:9"}}}},
	})
	detach()
	if err != nil {
		t.Fatal(err)
	}
	id := response.GetJob().GetJobId()
	deadline := time.Now().Add(2 * time.Second)
	for f.service.scenarioJobs.originalNativeReceipt(id) == nil {
		if time.Now().After(deadline) {
			job, _ := f.service.scenarioJobs.get(id)
			t.Fatalf("receipt was not handed to owner: %v", job)
		}
		time.Sleep(time.Millisecond)
	}
	waitScenarioJobWorkExit(t, f.service.scenarioJobs, id)
	if creates.Load() != 1 || queries.Load() != 0 {
		t.Fatalf("create/poll counts without Get: %d/%d", creates.Load(), queries.Load())
	}
	// A callback after actual work exit cannot terminalize the retained Job,
	// even if it still holds the old execution context.
	stale := context.WithValue(context.Background(), nativeJobClaimKey{}, &nativeJobClaim{jobID: id, version: 0})
	_, changed, lateErr := f.service.transitionScenarioJob(id, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED, nil, stale)
	if changed || !errors.Is(lateErr, errNativeJobClaimLost) {
		t.Fatalf("late worker mutated Job: changed=%v err=%v", changed, lateErr)
	}
	assembly, _ := f.service.scenarioJobs.cloudResolvedAssembly(id)
	if assembly.CredentialCustodyRef == "" {
		t.Fatal("pending work exit lost Job-owned custody")
	}
	observed, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || observed.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || observed.GetJob().GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED {
		t.Fatalf("Get: %v %v", observed, err)
	}
	if creates.Load() != 1 || queries.Load() != 1 {
		t.Fatalf("one Get was not one original query: %d/%d", creates.Load(), queries.Load())
	}
	disabled := runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED
	if _, err := f.service.connStore.Update(f.connectorID, connector.ConnectorMutations{Status: &disabled}); err != nil {
		t.Fatal(err)
	}
	blocked, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || blocked.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || blocked.GetObservationIssue().GetReasonCode() != runtimev1.ReasonCode_AI_CONNECTOR_DISABLED {
		t.Fatalf("local admission denial terminalized native work: %v %v", blocked, err)
	}
	if creates.Load() != 1 || queries.Load() != 1 {
		t.Fatal("mutation allowed another outbound request")
	}
	if _, err := f.service.CancelScenarioJob(owner, &runtimev1.CancelScenarioJobRequest{JobId: id}); err != nil {
		t.Fatal(err)
	}
}

func TestNativeJobCanceledGetConfirmsStopWithoutRenewingTerminal(t *testing.T) {
	var creates, stops, queries atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/services/aigc/video-generation/video-synthesis":
			creates.Add(1)
			fmt.Fprint(w, `{"output":{"task_id":"original-stop-task","task_status":"PENDING"}}`)
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/tasks/original-stop-task/cancel":
			stops.Add(1)
			fmt.Fprint(w, `{"request_id":"stop-ack"}`)
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/tasks/original-stop-task":
			queries.Add(1)
			fmt.Fprint(w, `{"output":{"task_id":"original-stop-task","task_status":"CANCELED"}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "dashscope", "wan2.7-t2v", server.URL, Config{AllowLoopbackEndpoint: true})
	owner := scenarioJobUserContext("nimi.lab", "user-001")
	response, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "video.generate", f.targetRef), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.lab", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: "one task", Options: &runtimev1.VideoGenerationOptions{DurationSec: testInt32(2), Resolution: "720P"}}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	id := response.GetJob().GetJobId()
	deadline := time.Now().Add(2 * time.Second)
	for f.service.scenarioJobs.originalNativeReceipt(id) == nil {
		if time.Now().After(deadline) {
			job, _ := f.service.scenarioJobs.get(id)
			t.Fatalf("receipt unavailable: %v", job)
		}
		time.Sleep(time.Millisecond)
	}
	waitScenarioJobWorkExit(t, f.service.scenarioJobs, id)
	canceled, err := f.service.CancelScenarioJob(owner, &runtimev1.CancelScenarioJobRequest{JobId: id, Reason: "user finished"})
	if err != nil {
		t.Fatal(err)
	}
	if canceled.GetJob().GetStopOutcome() != runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_UNCONFIRMED {
		t.Fatalf("unproved stop: %v", canceled)
	}
	f.service.scenarioJobs.mu.RLock()
	terminalAt := f.service.scenarioJobs.jobs[id].terminalAt
	f.service.scenarioJobs.mu.RUnlock()
	confirmed, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || confirmed.GetJob().GetStopOutcome() != runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_CONFIRMED {
		t.Fatalf("confirmation: %v %v", confirmed, err)
	}
	if !confirmed.GetJob().GetUpdatedAt().AsTime().Equal(canceled.GetJob().GetUpdatedAt().AsTime()) || confirmed.GetJob().GetReasonDetail() != "user finished" {
		t.Fatal("stop observation replaced original terminal facts")
	}
	f.service.scenarioJobs.mu.RLock()
	terminalAfter := f.service.scenarioJobs.jobs[id].terminalAt
	f.service.scenarioJobs.mu.RUnlock()
	if !terminalAfter.Equal(terminalAt) {
		t.Fatal("stop observation renewed retention")
	}
	if _, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id}); err != nil {
		t.Fatal(err)
	}
	if creates.Load() != 1 || stops.Load() != 1 || queries.Load() != 1 {
		t.Fatalf("unexpected replay: create=%d stop=%d query=%d", creates.Load(), stops.Load(), queries.Load())
	}
	assembly, _ := f.service.scenarioJobs.cloudResolvedAssembly(id)
	if assembly != nil && assembly.CredentialCustodyRef != "" {
		t.Fatal("confirmed stop retained unused credential custody")
	}
}

func TestNativeJobReusesCompleteBodiesAndPublishesOnlyAfterWholeResultCommit(t *testing.T) {
	var creates, queries, firstBodies, secondBodies atomic.Int32
	var allowSecond atomic.Bool
	image := l1CarrierPNGBytes(t)
	var endpoint string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost:
			creates.Add(1)
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"output":{"task_id":"pair","task_status":"PENDING"}}`)
		case r.URL.Path == "/api/v1/tasks/pair":
			queryNumber := queries.Add(1)
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"output":{"task_id":"pair","task_status":"SUCCEEDED","results":[{"url":"%s/first"},{"url":"%s/second?generation=%d"}]}}`, endpoint, endpoint, queryNumber)
		case r.URL.Path == "/first":
			firstBodies.Add(1)
			w.Header().Set("Content-Type", "image/png")
			w.Write(image)
		case r.URL.Path == "/second":
			secondBodies.Add(1)
			if !allowSecond.Load() || r.URL.Query().Get("generation") != "2" {
				w.WriteHeader(503)
				return
			}
			w.Header().Set("Content-Type", "image/png")
			w.Write(image)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	endpoint = server.URL
	f := newManagedCloudScenarioTestFixture(t, "dashscope", "wan2.6-t2i", endpoint, Config{AllowLoopbackEndpoint: true})
	owner := scenarioJobUserContext("nimi.desktop", "user-001")
	response, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "image.generate", f.targetRef), &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "two views", N: testInt32(2)}}}})
	if err != nil {
		t.Fatal(err)
	}
	id := response.GetJob().GetJobId()
	waitNativeReceiptHandoff(t, f.service, id)
	first, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || first.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || first.GetObservationIssue() == nil || len(first.GetJob().GetArtifacts()) != 0 {
		t.Fatalf("partial body publication: %v %v", first, err)
	}
	plan := f.service.scenarioJobs.currentNativeResult(id)
	if plan == nil || len(plan.Artifacts) != 2 {
		t.Fatal("required set was not retained")
	}
	firstID := plan.Artifacts[0].GetArtifactId()
	if _, visible := f.service.runtimeArtifacts.Stat(firstID); visible {
		t.Fatal("private complete body was publicly readable")
	}
	allowSecond.Store(true)
	f.service.scenarioJobs.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			return errors.New("injected Job writer failure")
		}
		return nil
	}
	second, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || second.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || second.GetObservationIssue() == nil {
		t.Fatalf("failed metadata commit destroyed candidate: %v %v", second, err)
	}
	if _, visible := f.service.runtimeArtifacts.Stat(firstID); visible {
		t.Fatal("failed metadata commit published body")
	}
	f.service.scenarioJobs.persistenceFailure = nil
	disabled := runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED
	if _, err := f.service.connStore.Update(f.connectorID, connector.ConnectorMutations{Status: &disabled}); err != nil {
		t.Fatal(err)
	}
	completed, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || completed.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || completed.GetObservationIssue() != nil || len(completed.GetJob().GetArtifacts()) != 2 {
		t.Fatalf("complete retained bodies could not commit after Connector mutation: %v %v", completed, err)
	}
	if creates.Load() != 1 || queries.Load() != 2 || firstBodies.Load() != 1 || secondBodies.Load() != 2 {
		t.Fatalf("unexpected create/refresh/complete body: %d/%d/%d/%d", creates.Load(), queries.Load(), firstBodies.Load(), secondBodies.Load())
	}
	for _, artifact := range completed.GetJob().GetArtifacts() {
		if _, visible := f.service.runtimeArtifacts.Stat(artifact.GetArtifactId()); !visible {
			t.Fatal("full Job result lacked a published body")
		}
	}
}

func TestFiniteResultCandidateSurvivesWriterAndArtifactReopenWithoutRepeatingProvider(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"text":"Bonjour.","languages":[{"code":"fr"}]}`)
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "openai", "gpt-transcribe", server.URL, Config{AllowLoopbackEndpoint: true})
	store, err := newScenarioJobStoreForLocalStatePath(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	f.service.scenarioJobs = store
	artifactRoot := t.TempDir()
	artifacts, err := runtimeartifact.NewDiskStore(artifactRoot)
	if err != nil {
		t.Fatal(err)
	}
	f.service.SetRuntimeArtifactStore(artifacts)
	store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			return errors.New("final metadata commit unavailable")
		}
		return nil
	}
	owner := scenarioJobUserContext("nimi.desktop", "user-001")
	response, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "audio.transcribe", f.targetRef), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: []byte("recording")}}, MimeType: "audio/wav"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	id := response.GetJob().GetJobId()
	deadline := time.Now().Add(5 * time.Second)
	for !store.hasResultCandidate(id) {
		if time.Now().After(deadline) {
			job, _ := store.get(id)
			t.Fatalf("full result facts were not retained: %v", job)
		}
		time.Sleep(time.Millisecond)
	}
	waitScenarioJobWorkExit(t, store, id)
	if _, visible := artifacts.Stat(id + "-result-1"); visible {
		t.Fatal("unpublished result body escaped before restart")
	}
	recoveredSvc := newTestService(nil)
	recoveredSvc.connStore = f.service.connStore
	recoveredSvc.scenarioJobs = cloneScenarioJobStoreForReopenTest(t, store)
	artifacts, err = runtimeartifact.NewDiskStore(artifactRoot)
	if err != nil {
		t.Fatal(err)
	}
	recoveredSvc.SetRuntimeArtifactStore(artifacts)
	if err := recoveredSvc.ReconcileNativeBodyPublications(); err != nil {
		t.Fatal(err)
	}
	disabled := runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED
	if _, err := f.service.connStore.Update(f.connectorID, connector.ConnectorMutations{Status: &disabled}); err != nil {
		t.Fatal(err)
	}
	completed, err := recoveredSvc.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || completed.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || completed.GetJob().GetTranscription().GetLanguage() != "fr" || completed.GetJob().GetTranscriptionText() != "Bonjour." || calls.Load() != 1 {
		t.Fatalf("ready-result recovery repeated execution or lost typed facts: %v %v calls=%d", completed, err, calls.Load())
	}
	if _, visible := artifacts.Stat(id + "-result-1"); !visible {
		t.Fatal("recovered complete result lacks its physical body")
	}
	waitCompletedScenarioJobCleanup(t, recoveredSvc, id)
}
