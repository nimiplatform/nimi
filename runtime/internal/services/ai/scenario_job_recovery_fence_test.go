package ai

import (
	"bytes"
	"context"
	"encoding/json"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestIsolationFenceWriteFailureKeepsOriginalActiveDocument(t *testing.T) {
	store, id := admittedDispatchJob(t)
	path := store.durablePath
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString("broken acknowledged mutation\n"); err != nil {
		t.Fatal(err)
	}
	if err := file.Sync(); err != nil {
		t.Fatal(err)
	}
	file.Close()
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	blocked := newScenarioJobStore()
	blocked.durablePath = path
	blocked.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Operation == scenarioJobPersistLoad {
			return io.ErrShortWrite
		}
		return nil
	}
	if err := blocked.loadDurableJobs(true); err == nil {
		t.Fatal("fence write failure was ignored")
	}
	active, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(active, original) {
		t.Fatalf("isolation removed or changed the sole active state: %v", err)
	}
	diagnostics := blocked.IsolationDiagnostics()
	if len(diagnostics) != 1 {
		t.Fatalf("isolation evidence: %+v", diagnostics)
	}
	evidence, err := os.ReadFile(diagnostics[0].QuarantinePath)
	if err != nil || !bytes.Equal(evidence, original) {
		t.Fatalf("incomplete quarantine evidence: %v", err)
	}
	state := filepath.Join(filepath.Dir(filepath.Dir(path)), "state.json")
	reopened, err := newScenarioJobStoreForLocalStatePath(state)
	if err != nil {
		t.Fatal(err)
	}
	if _, found := reopened.get(id); found || !reopened.recoveryIncomplete || reopened.admitNewScenarioAction() == nil {
		t.Fatal("failed isolation became an empty admissible store on second open")
	}
}

func TestIsolationCopyFailureLeavesOriginalDocument(t *testing.T) {
	root := t.TempDir()
	store := newScenarioJobStore()
	store.durablePath = scenarioJobStorePathForLocalStatePath(filepath.Join(root, "state.json"))
	if err := os.MkdirAll(filepath.Dir(store.durablePath), 0700); err != nil {
		t.Fatal(err)
	}
	original := []byte("corrupt original action history\n")
	if err := os.WriteFile(store.durablePath, original, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(store.durablePath), scenarioJobIsolationQuarantineDirName), []byte("blocking file"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := store.loadDurableJobs(true); err == nil {
		t.Fatal("quarantine copy failure was ignored")
	}
	active, err := os.ReadFile(store.durablePath)
	if err != nil || !bytes.Equal(active, original) {
		t.Fatalf("copy failure changed active facts: %v", err)
	}
}

func TestRecoveryFenceSurvivesQuarantineExpiryAndAnotherRestart(t *testing.T) {
	state := filepath.Join(t.TempDir(), "state.json")
	path := scenarioJobStorePathForLocalStatePath(state)
	snapshot := healthyScenarioJobRawSnapshotForIsolationTest(t)
	snapshot.Records = append(snapshot.Records, json.RawMessage(`{"job":{"job_id":7}}`))
	payload, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, payload, 0600); err != nil {
		t.Fatal(err)
	}
	first, err := newScenarioJobStoreForLocalStatePath(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := first.sweepExpiredDurableCopies(time.Now().Add(scenarioJobIsolationRetention + time.Second)); err != nil {
		t.Fatal(err)
	}
	for _, diagnostic := range first.IsolationDiagnostics() {
		if diagnostic.QuarantinePath != "" {
			if _, err := os.Stat(diagnostic.QuarantinePath); !os.IsNotExist(err) {
				t.Fatal("copied isolated content survived expiry")
			}
		}
	}
	second, err := newScenarioJobStoreForLocalStatePath(state)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := second.get("job-healthy-a"); !ok {
		t.Fatal("healthy sibling was hidden")
	}
	if _, ok := second.getByIdempotency("scope-job-healthy-a"); !ok {
		t.Fatal("known action lookup was fenced")
	}
	if _, err := second.getMusicSubmission(&localAppJobOwner{AccountID: "account", RegisteredAppSubject: "subject", ProducerAppID: "app"}, "unknown-action", ""); err == nil {
		t.Fatal("unconfirmed action was reported absent")
	}
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); http.Error(w, "unexpected create", 500) }))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", server.URL, Config{AllowLoopbackEndpoint: true})
	f.service.scenarioJobs = second
	_, err = f.service.SubmitScenarioJob(withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), "image.generate", f.targetRef), &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "cup"}}}})
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_JOB_CAPACITY_EXCEEDED || calls.Load() != 0 {
		t.Fatalf("incomplete recovery allowed a new action: %v calls=%d", err, calls.Load())
	}
}

func TestExistingCandidateWithoutOriginalWriterIsNotAnUnpublishedCapture(t *testing.T) {
	state := filepath.Join(t.TempDir(), "state.json")
	jobs, err := newScenarioJobStoreForLocalStatePath(state)
	if err != nil {
		t.Fatal(err)
	}
	bodies, err := runtimeartifact.NewDiskStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := &runtimeartifact.ArtifactOwner{SubjectUserID: "account", AppID: "app"}
	if err := bodies.PrepareJobBodies("original-job", owner, []runtimeartifact.JobBodySlot{{ArtifactID: "candidate", MaxBytes: 4096}}); err != nil {
		t.Fatal(err)
	}
	if err := bodies.StageJobBody(context.Background(), "candidate", runtimeartifact.ArtifactRecord{ProducerJobID: "original-job", Owner: owner, MimeType: "application/octet-stream"}, io.NopCloser(bytes.NewBufferString("complete private body"))); err != nil {
		t.Fatal(err)
	}
	svc := newTestService(nil)
	svc.scenarioJobs = jobs
	svc.SetRuntimeArtifactStore(bodies)
	if err := svc.ReconcileNativeBodyPublications(); err != nil {
		t.Fatal(err)
	}
	reopened, err := newScenarioJobStoreForLocalStatePath(state)
	if err != nil {
		t.Fatal(err)
	}
	recovered := newTestService(nil)
	recovered.scenarioJobs = reopened
	recovered.SetRuntimeArtifactStore(bodies)
	if err := recovered.ReconcileNativeBodyPublications(); err != nil {
		t.Fatal(err)
	}
	if _, complete := bodies.JobBodyStat("original-job", "candidate"); !complete {
		t.Fatal("missing original writer became false negative ownership proof")
	}
	if err := reopened.admitNewScenarioAction(); err == nil {
		t.Fatal("unknown original ownership did not retain its recovery fence")
	}
}
