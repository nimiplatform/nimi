package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func pikaOwnedContext(op accountservice.LocalAppOperation, capability string) context.Context {
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.pika-owned", RegisteredAppSubject: "pika-owned-subject", Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability})
}

func TestPikaUnrecordedCleanupKeepsCustodyOnlyUntilFixedRetention(t *testing.T) {
	video := pikaTestVideo(t)
	var deletes, queries atomic.Int32
	var endpoint string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/result":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write(video)
		case r.Method == "POST" && r.URL.Path == "/v1/media/uploads":
			pikaTestUploadMint(t, w, r, endpoint)
		case r.Method == "PUT":
			w.WriteHeader(200)
		case r.Method == "DELETE":
			deletes.Add(1)
			w.WriteHeader(204)
		case r.Method == "GET":
			queries.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "original", "status": "completed", "output": map[string]any{"media_type": "video", "video": map[string]any{"url": endpoint + "/result"}}})
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "original", "status": "queued"})
		}
	}))
	defer server.Close()
	endpoint = server.URL
	f, request := pikaOwnedLifecycleFixture(t, endpoint)
	var failed atomic.Bool
	f.service.scenarioJobs.persistenceFailure = func(a scenarioJobPersistenceAttempt) error {
		if a.Operation == scenarioJobPersistTransition {
			if r := f.service.scenarioJobs.jobs[a.JobID]; r != nil && r.inputCleanup != nil && !failed.Swap(true) {
				return fmt.Errorf("cleanup journal refused")
			}
		}
		return nil
	}
	response, err := f.service.SubmitLocalAppScenarioJob(pikaOwnedContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit), request)
	if err != nil {
		t.Fatal(err)
	}
	id := response.Job.JobId
	get := pikaOwnedContext(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet)
	var job *runtimev1.LocalAppScenarioJob
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		r, err := f.service.GetLocalAppScenarioJob(get, &runtimev1.GetLocalAppScenarioJobRequest{JobId: id})
		if err != nil {
			t.Fatal(err)
		}
		job = r.Job
		if isTerminalScenarioJobStatus(job.GetStatus()) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	waitScenarioJobWorkExit(t, f.service.scenarioJobs, id)
	assembly, _ := f.service.scenarioJobs.cloudResolvedAssembly(id)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || assembly.CredentialCustodyRef == "" || f.service.scenarioJobs.currentInputCleanup(id) != nil || deletes.Load() != 1 {
		t.Fatal("unrecorded cleanup lost recovery custody", job, deletes.Load())
	}
	f.service.jobWorkAuthorizer.(*pikaTestWorkAuthorizer).revoke()
	var disposition atomic.Bool
	f.service.scenarioJobs.mu.Lock()
	r := f.service.scenarioJobs.jobs[id]
	expired := time.Now().UTC().Add(-scenarioJobRetention - time.Minute)
	r.createdAt, r.updatedAt, r.terminalAt = expired.Add(-time.Second), expired, expired
	r.job.CreatedAt = timestamppb.New(r.createdAt)
	r.job.UpdatedAt = timestamppb.New(expired)
	f.service.scenarioJobs.persistenceFailure = func(a scenarioJobPersistenceAttempt) error {
		if a.Operation == scenarioJobPersistCustodyRelease {
			if r := f.service.scenarioJobs.jobs[a.JobID]; r != nil && r.inputCleanup != nil && r.inputCleanup.State == "unconfirmed" {
				disposition.Store(true)
			}
		}
		return nil
	}
	f.service.scenarioJobs.mu.Unlock()
	f.service.reconcileExpiredScenarioResources()
	if !disposition.Load() || deletes.Load() != 1 || queries.Load() != 1 {
		t.Fatal("retention invented deletion or reused historical authority", disposition.Load(), deletes.Load(), queries.Load())
	}
	if assembly, ok := f.service.scenarioJobs.cloudResolvedAssembly(id); ok && assembly.CredentialCustodyRef != "" {
		t.Fatal("cleanup extended sealed credential retention")
	}
}
func pikaOwnedLifecycleFixture(t *testing.T, endpoint string) (managedCloudScenarioTestFixture, *runtimev1.SubmitLocalAppScenarioJobRequest) {
	t.Helper()
	model := "pika/pika-h3-flex/image-to-video"
	f := newManagedCloudScenarioTestFixture(t, "pika", model, endpoint, Config{AllowLoopbackEndpoint: true})
	f.service.jobWorkAuthorizer = &pikaTestWorkAuthorizer{}
	f.service.requireJobWorkAuthority = true
	store, err := newScenarioJobStoreForLocalStatePath(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	f.service.scenarioJobs = store
	intent := cloudVoiceAIConfigIntent(t, f.connectorID, f.descriptor)
	intent.CapabilityContract = "video.generate"
	intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.video.generate.pika", DriverId: "nimi.runtime.driver.pika", DriverDialect: "provider/media-v1"}
	if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.pika-owned", intent)); err != nil {
		t.Fatal(err)
	}
	var picture bytes.Buffer
	if err := png.Encode(&picture, image.NewRGBA(image.Rect(0, 0, 512, 512))); err != nil {
		t.Fatal(err)
	}
	asset, err := f.service.UploadLocalAppArtifact(pikaOwnedContext(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{Bytes: picture.Bytes(), MimeType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	request := &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VideoGenerate{VideoGenerate: &runtimev1.LocalAppVideoGenerateJobSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, Prompt: "A blue cup", Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: asset.ArtifactId}}}, Options: &runtimev1.LocalAppVideoGenerationOptions{DurationSec: proto.Int32(5), Resolution: "1080p"}}}}
	return f, request
}
func pikaTestUploadMint(t *testing.T, w http.ResponseWriter, r *http.Request, endpoint string) {
	t.Helper()
	var body struct {
		MIME string `json:"content_type"`
		Size int    `json:"size_bytes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		t.Error(err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"upload_url": endpoint + "/storage", "url": endpoint + "/input", "headers": map[string]string{"Content-Type": body.MIME, "Content-Length": strconv.Itoa(body.Size)}, "expires_in": 300, "max_bytes": 20_000_000})
}

func TestPikaUploadPersistenceFailureCannotDispatchGeneration(t *testing.T) {
	for _, afterPut := range []bool{false, true} {
		t.Run(fmt.Sprintf("after-put-%v", afterPut), func(t *testing.T) {
			var puts, creates, deletes atomic.Int32
			var endpoint string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.Method == "POST" && r.URL.Path == "/v1/media/uploads":
					pikaTestUploadMint(t, w, r, endpoint)
				case r.Method == "PUT":
					puts.Add(1)
					w.WriteHeader(200)
				case r.Method == "DELETE":
					deletes.Add(1)
					w.WriteHeader(204)
				default:
					creates.Add(1)
					w.WriteHeader(500)
				}
			}))
			defer server.Close()
			endpoint = server.URL
			f, request := pikaOwnedLifecycleFixture(t, endpoint)
			var rejected atomic.Bool
			f.service.scenarioJobs.persistenceFailure = func(a scenarioJobPersistenceAttempt) error {
				if a.Operation == scenarioJobPersistTransition {
					if r := f.service.scenarioJobs.jobs[a.JobID]; r != nil && len(r.pikaUploads) > 0 && r.pikaUploads[0].PutComplete == afterPut && !rejected.Swap(true) {
						return fmt.Errorf("injected upload journal failure")
					}
				}
				return nil
			}
			response, err := f.service.SubmitLocalAppScenarioJob(pikaOwnedContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit), request)
			if err != nil {
				t.Fatal(err)
			}
			job := waitForScenarioJobTerminalForLocalTextTest(t, f.service, response.Job.JobId)
			waitScenarioJobWorkExit(t, f.service.scenarioJobs, job.JobId)
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || job.GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_NOT_DISPATCHED || creates.Load() != 0 || !rejected.Load() {
				t.Fatal(job, creates.Load())
			}
			if afterPut {
				if puts.Load() != 1 || deletes.Load() != 1 || f.service.scenarioJobs.currentInputCleanup(job.JobId).State != "deleted" {
					t.Fatal("confirmed PUT was not disposed after failure", puts.Load(), deletes.Load())
				}
			} else if puts.Load() != 0 || deletes.Load() != 0 || len(f.service.scenarioJobs.currentPikaUploads(job.JobId)) != 0 {
				t.Fatal("failed custody write transmitted bytes")
			}
		})
	}
}

func TestPikaPendingCancelKeepsInputsAndTerminalCleanupDoesNotRewriteCancellation(t *testing.T) {
	for _, confirmed := range []bool{false, true} {
		t.Run(fmt.Sprintf("confirmed-%v", confirmed), func(t *testing.T) {
			var creates, deletes, queries atomic.Int32
			var upstreamTerminal atomic.Bool
			var endpoint string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch {
				case r.Method == "POST" && r.URL.Path == "/v1/media/uploads":
					pikaTestUploadMint(t, w, r, endpoint)
				case r.Method == "PUT":
					w.WriteHeader(200)
				case r.Method == "DELETE":
					if !confirmed && !upstreamTerminal.Load() {
						t.Error("pending task input was deleted")
					}
					deletes.Add(1)
					w.WriteHeader(204)
				case strings.HasSuffix(r.URL.Path, "/cancel"):
					if confirmed {
						_ = json.NewEncoder(w).Encode(map[string]any{"id": "original", "status": "cancelled", "cancellation_status": "cancelled"})
					} else if upstreamTerminal.Load() {
						w.WriteHeader(409)
					} else {
						w.WriteHeader(202)
						_ = json.NewEncoder(w).Encode(map[string]any{"id": "original", "status": "running", "cancellation_status": "pending"})
					}
				case r.Method == "GET":
					queries.Add(1)
					state := "running"
					if upstreamTerminal.Load() {
						state = "completed"
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"id": "original", "status": state})
				default:
					creates.Add(1)
					_ = json.NewEncoder(w).Encode(map[string]any{"id": "original", "status": "queued"})
				}
			}))
			defer server.Close()
			endpoint = server.URL
			f, request := pikaOwnedLifecycleFixture(t, endpoint)
			response, err := f.service.SubmitLocalAppScenarioJob(pikaOwnedContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit), request)
			if err != nil {
				t.Fatal(err)
			}
			id := response.Job.JobId
			waitNativeReceiptHandoff(t, f.service, id)
			waitScenarioJobWorkExit(t, f.service.scenarioJobs, id)
			canceled, err := f.service.CancelLocalAppScenarioJob(pikaOwnedContext(accountservice.LocalAppOperationScenarioJobCancel, localappop.AppOperationIDScenarioJobCancel), &runtimev1.CancelLocalAppScenarioJobRequest{JobId: id, Reason: "user finished"})
			if err != nil {
				t.Fatal(err)
			}
			get := pikaOwnedContext(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet)
			first, err := f.service.GetLocalAppScenarioJob(get, &runtimev1.GetLocalAppScenarioJobRequest{JobId: id})
			if err != nil {
				t.Fatal(err)
			}
			if !confirmed {
				if deletes.Load() != 0 || first.Job.GetStopOutcome() != runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_UNCONFIRMED || f.service.scenarioJobs.currentInputCleanup(id) != nil {
					t.Fatal("202 fabricated cancellation or released pending inputs", first.Job)
				}
				upstreamTerminal.Store(true)
			}
			last := first
			if !confirmed {
				last, err = f.service.GetLocalAppScenarioJob(get, &runtimev1.GetLocalAppScenarioJobRequest{JobId: id})
				if err != nil {
					t.Fatal(err)
				}
			}
			wantStop := runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_UNCONFIRMED
			if confirmed {
				wantStop = runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_CONFIRMED
			}
			if last.Job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || last.Job.GetStopOutcome() != wantStop || !proto.Equal(last.Job.GetUpdatedAt(), canceled.Job.GetUpdatedAt()) || len(last.Job.GetArtifacts()) != 0 || creates.Load() != 1 || deletes.Load() != 1 {
				t.Fatal("cleanup rewrote terminal identity or replayed generation", last.Job, creates.Load(), deletes.Load())
			}
			if confirmed && queries.Load() != 0 {
				t.Fatal("re-queried an already confirmed cancellation")
			}
		})
	}
}

func TestPikaUploadRecoveryRequiresFreshAuthorityAndNeverReplaysPUT(t *testing.T) {
	video := pikaTestVideo(t)
	var creates, puts, deletes, queries atomic.Int32
	var endpoint string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/result":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write(video)
		case r.Method == "POST" && r.URL.Path == "/v1/media/uploads":
			pikaTestUploadMint(t, w, r, endpoint)
		case r.Method == "PUT":
			puts.Add(1)
			w.WriteHeader(200)
		case r.Method == "DELETE":
			deletes.Add(1)
			w.WriteHeader(204)
		case r.Method == "GET":
			queries.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "original", "status": "completed", "output": map[string]any{"media_type": "video", "video": map[string]any{"url": endpoint + "/result"}}})
		default:
			creates.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "original", "status": "queued"})
		}
	}))
	defer server.Close()
	endpoint = server.URL
	f, request := pikaOwnedLifecycleFixture(t, endpoint)
	response, err := f.service.SubmitLocalAppScenarioJob(pikaOwnedContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit), request)
	if err != nil {
		t.Fatal(err)
	}
	id := response.Job.JobId
	waitNativeReceiptHandoff(t, f.service, id)
	waitScenarioJobWorkExit(t, f.service.scenarioJobs, id)
	raw, err := os.ReadFile(f.service.scenarioJobs.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("/storage")) || bytes.Contains(raw, []byte("test-key")) {
		t.Fatal("ephemeral storage capability or API credential persisted")
	}
	// Replay an immutable copy, never start a second writer against the old file.
	path := filepath.Join(t.TempDir(), "state.json")
	empty, err := newScenarioJobStoreForLocalStatePath(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(empty.durablePath), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(empty.durablePath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	reopened, err := newScenarioJobStoreForLocalStatePathBeforeStartupPrune(path)
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := newFromProviderConfig(f.service.logger, nil, f.service.connStore, Config{AllowLoopbackEndpoint: true, CloudProviders: map[string]nimillm.ProviderCredentials{"pika": {BaseURL: endpoint, APIKey: "test-key"}}}, 8, 2)
	if err != nil {
		t.Fatal(err)
	}
	restarted.scenarioJobs = reopened
	restarted.requireJobWorkAuthority = true
	restarted.jobWorkAuthorizer = &pikaTestWorkAuthorizer{revoked: true}
	if err := restarted.releaseRecoveredTerminalCloudCredentialCustody(); err != nil {
		t.Fatal(err)
	}
	get := pikaOwnedContext(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet)
	if _, err := restarted.GetLocalAppScenarioJob(get, &runtimev1.GetLocalAppScenarioJobRequest{JobId: id}); err == nil || queries.Load() != 0 || deletes.Load() != 0 {
		t.Fatal("historical permission opened provider IO", err)
	}
	restarted.jobWorkAuthorizer = &pikaTestWorkAuthorizer{}
	var job *runtimev1.LocalAppScenarioJob
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		r, err := restarted.GetLocalAppScenarioJob(get, &runtimev1.GetLocalAppScenarioJobRequest{JobId: id})
		if err != nil {
			t.Fatal(err)
		}
		job = r.Job
		if isTerminalScenarioJobStatus(job.GetStatus()) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || creates.Load() != 1 || puts.Load() != 1 || deletes.Load() != 1 {
		t.Fatal("recovery replayed upload/generation or lost cleanup", job, creates.Load(), puts.Load(), deletes.Load())
	}
}
