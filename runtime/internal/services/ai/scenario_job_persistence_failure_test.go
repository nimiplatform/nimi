package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type custodyTrackingSecretStore struct {
	mu     sync.Mutex
	values map[string]string
}

func (s *custodyTrackingSecretStore) WriteSecret(id string, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.values[id] = value
	return nil
}

func (s *custodyTrackingSecretStore) ReadSecret(id string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	value, ok := s.values[id]
	return value, ok, nil
}

func (s *custodyTrackingSecretStore) DeleteSecret(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.values, id)
	return nil
}

func installCustodyTrackingConnectorStore(t *testing.T, fixture *managedCloudScenarioTestFixture) *custodyTrackingSecretStore {
	t.Helper()
	record, found, err := fixture.service.connStore.Get(fixture.connectorID)
	if err != nil || !found {
		t.Fatalf("load fixture Connector: found=%v err=%v", found, err)
	}
	secrets := &custodyTrackingSecretStore{values: make(map[string]string)}
	store := connector.NewConnectorStoreWithSecretStore(t.TempDir(), secrets)
	if _, err := store.Create(record, "test-key"); err != nil {
		t.Fatalf("create tracked fixture Connector: %v", err)
	}
	fixture.service.connStore = store
	return secrets
}

func assertOnlyLiveConnectorCredential(t *testing.T, secrets *custodyTrackingSecretStore, connectorID string) {
	t.Helper()
	secrets.mu.Lock()
	defer secrets.mu.Unlock()
	if len(secrets.values) != 1 || secrets.values[connectorID] == "" {
		t.Fatalf("credential store after cleanup = %v; want only live Connector %q", secrets.values, connectorID)
	}
}

func newDurableScenarioJobStoreForFailureTest(t *testing.T) (*scenarioJobStore, string) {
	t.Helper()
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatalf("create durable scenario job store: %v", err)
	}
	return store, localStatePath
}

func TestCloudVoiceRunningPersistenceFailureDoesNotCallProviderOrPublishAsset(t *testing.T) {
	var providerCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		providerCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"output":{"voice":"must-not-publish"}}`))
	}))
	defer server.Close()
	fixture := newManagedCloudScenarioTestFixture(t, "dashscope", "qwen3-tts-vd-2026-01-26", server.URL, Config{AllowLoopbackEndpoint: true})
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Operation == scenarioJobPersistTransition && attempt.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING {
			return errors.New("injected voice RUNNING persistence failure")
		}
		return nil
	}
	fixture.service.scenarioJobs = store
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), capabilitydriver.VoiceCreateContract, fixture.targetRef)
	response, err := fixture.service.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
			TargetModelId: "qwen3-tts-vd",
			Source:        &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{InstructionText: "warm narrator", PreviewText: "hello"}},
		}}},
	})
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	terminal := waitScenarioJobTerminal(t, fixture.service, response.GetJob().GetJobId(), 3*time.Second)
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || providerCalls.Load() != 0 {
		t.Fatalf("terminal=%s reason=%s providerCalls=%d", terminal.GetStatus(), terminal.GetReasonCode(), providerCalls.Load())
	}
	if asset, ok := fixture.service.voiceAssets.getAsset(response.GetJob().GetJobId()); ok || asset != nil {
		t.Fatalf("RUNNING persistence failure published VoiceAsset %#v", asset)
	}
	// A visible FAILED Job precedes deferred credential-custody persistence.
	// Let the worker finish before TempDir cleanup removes its durable store.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		store.mu.RLock()
		finished := !store.jobs[response.GetJob().GetJobId()].executionStarted
		store.mu.RUnlock()
		if finished {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("voice workflow did not finish durable cleanup")
}

func TestCloudVoiceTerminalPersistenceFailureRetainsCompleteResultForGet(t *testing.T) {
	var providerCalls, cleanupCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if input, ok := body["input"].(map[string]any); ok && input["action"] == "delete" {
			cleanupCalls.Add(1)
			_, _ = w.Write([]byte(`{"request_id":"cleanup-known","output":{"voice":"must-remain-private"}}`))
			return
		}
		providerCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"output": map[string]any{"voice": "must-remain-private", "preview_audio": map[string]any{"response_format": "wav", "sample_rate": 16000, "data": base64.StdEncoding.EncodeToString(mediaBudgetTestWAV())}}})
	}))
	defer server.Close()
	fixture := newManagedCloudScenarioTestFixture(t, "dashscope", "qwen3-tts-vd-2026-01-26", server.URL, Config{AllowLoopbackEndpoint: true})
	store, localStatePath := newDurableScenarioJobStoreForFailureTest(t)
	var terminalAttempts atomic.Int32
	store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Operation == scenarioJobPersistTransition && attempt.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			terminalAttempts.Add(1)
			return errors.New("injected voice COMPLETED persistence failure")
		}
		return nil
	}
	voiceAssets, err := newVoiceAssetStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	fixture.service.scenarioJobs = store
	fixture.service.voiceAssets = voiceAssets
	artifactRoot := t.TempDir()
	bodies, err := runtimeartifact.NewDiskStore(artifactRoot)
	if err != nil {
		t.Fatal(err)
	}
	fixture.service.SetRuntimeArtifactStore(bodies)
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), capabilitydriver.VoiceCreateContract, fixture.targetRef)
	response, err := fixture.service.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
			TargetModelId: "qwen3-tts-vd",
			Source:        &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{InstructionText: "warm narrator", PreviewText: "hello"}},
		}}},
	})
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	jobID := response.GetJob().GetJobId()
	deadline := time.Now().Add(5 * time.Second)
	for !store.hasResultCandidate(jobID) {
		if time.Now().After(deadline) {
			job, _ := store.get(jobID)
			t.Fatalf("candidate not retained: %v", job)
		}
		time.Sleep(time.Millisecond)
	}
	waitScenarioJobWorkExit(t, store, jobID)
	pending, _ := store.get(jobID)
	if pending.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || !store.hasResultCandidate(jobID) {
		t.Fatalf("complete private result was lost: %v", pending)
	}
	if providerCalls.Load() != 1 || cleanupCalls.Load() != 0 || terminalAttempts.Load() != maxScenarioJobTerminalPersistenceAttempts {
		t.Fatalf("create=%d delete=%d commit=%d", providerCalls.Load(), cleanupCalls.Load(), terminalAttempts.Load())
	}
	if asset, ok := fixture.service.voiceAssets.getAsset(jobID); ok || asset != nil {
		t.Fatalf("failed terminal commit published VoiceAsset %#v", asset)
	}
	assembly, ok := fixture.service.scenarioJobs.cloudResolvedAssembly(jobID)
	if !ok || assembly == nil || assembly.CredentialCustodyRef == "" {
		t.Fatalf("failed terminal commit lost credential custody reference: %+v visible=%v", assembly, ok)
	}
	if captured, err := fixture.service.connStore.LoadCredentialCustody(assembly.CredentialCustodyRef); err != nil || captured == "" {
		t.Fatalf("failed terminal commit credential custody = %q, err=%v; want retained for restart recovery", captured, err)
	}

	restarted := newTestService(nil)
	restarted.connStore = fixture.service.connStore
	restarted.scenarioJobs = cloneScenarioJobStoreForReopenTest(t, store)
	restarted.voiceAssets, err = newVoiceAssetStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.voiceAssets.reconcilePendingPublications(restarted.scenarioJobs); err != nil {
		t.Fatal(err)
	}
	bodies, err = runtimeartifact.NewDiskStore(artifactRoot)
	if err != nil {
		t.Fatal(err)
	}
	restarted.SetRuntimeArtifactStore(bodies)
	if err := restarted.ReconcileNativeBodyPublications(); err != nil {
		t.Fatal(err)
	}
	if _, visible := restarted.voiceAssets.getAsset(jobID); visible {
		t.Fatal("voice became public before primary commit")
	}
	completed, err := restarted.GetScenarioJob(scenarioJobUserContext("nimi.desktop", "user-001"), &runtimev1.GetScenarioJobRequest{JobId: jobID})
	if err != nil || completed.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || completed.GetAsset().GetProviderVoiceRef() != "must-remain-private" || completed.GetVoiceReference() == nil || len(completed.GetJob().GetArtifacts()) != 1 {
		t.Fatalf("recovery lost full voice result: %v %v", completed, err)
	}
	if _, visible := bodies.Stat(completed.GetJob().GetArtifacts()[0].GetArtifactId()); !visible {
		t.Fatal("preview was not published with voice result")
	}
	if _, visible := restarted.voiceAssets.getAsset(jobID); !visible {
		t.Fatal("voice library did not promote primary result")
	}
	if providerCalls.Load() != 1 || cleanupCalls.Load() != 0 {
		t.Fatal("recovery replayed provider side effect")
	}
	waitCompletedScenarioJobCleanup(t, restarted, jobID)
}

func assertNoSubmittedScenarioJobAfterRestart(t *testing.T, store *scenarioJobStore, localStatePath string) {
	t.Helper()
	store.mu.RLock()
	inMemoryJobs := len(store.jobs)
	inMemoryBindings := len(store.idempotency)
	store.mu.RUnlock()
	if inMemoryJobs != 0 || inMemoryBindings != 0 {
		t.Fatalf("failed submission retained in-memory state: jobs=%d bindings=%d", inMemoryJobs, inMemoryBindings)
	}

	reopened, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatalf("reopen durable scenario job store: %v", err)
	}
	reopened.mu.RLock()
	durableJobs := len(reopened.jobs)
	durableBindings := len(reopened.idempotency)
	reopened.mu.RUnlock()
	if durableJobs != 0 || durableBindings != 0 {
		t.Fatalf("failed submission retained durable state after restart: jobs=%d bindings=%d", durableJobs, durableBindings)
	}
}

func TestScenarioJobStoreCreateAndIdempotencyBindingFailureIsAtomic(t *testing.T) {
	store, localStatePath := newDurableScenarioJobStoreForFailureTest(t)
	var attempts atomic.Int32
	store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Operation == scenarioJobPersistCreateAndBind {
			attempts.Add(1)
			return errors.New("injected idempotency binding persistence failure")
		}
		return nil
	}
	now := timestamppb.New(time.Now().UTC())
	created, published, err := store.createOwnedAndBindChecked(&runtimev1.ScenarioJob{
		JobId: "job-atomic-idempotency", Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		CreatedAt: now, UpdatedAt: now,
	}, func() {}, nil, "scope-atomic-idempotency")
	if err == nil || created != nil || published {
		t.Fatalf("atomic create-and-bind = %#v, published=%v, err=%v", created, published, err)
	}
	if attempts.Load() != 1 {
		t.Fatalf("create-and-bind persistence attempts = %d, want 1", attempts.Load())
	}
	if _, ok := store.get("job-atomic-idempotency"); ok {
		t.Fatal("failed atomic create-and-bind left an in-memory Job")
	}
	if _, ok := store.getByIdempotency("scope-atomic-idempotency"); ok {
		t.Fatal("failed atomic create-and-bind left an in-memory binding")
	}
	assertNoSubmittedScenarioJobAfterRestart(t, store, localStatePath)
}

func TestLocalSpeechIdempotencyBindingPersistenceFailureLeavesNoOrphan(t *testing.T) {
	svc := newTestService(nil)
	store, localStatePath := newDurableScenarioJobStoreForFailureTest(t)
	store.persistenceFailure = failScenarioJobCreateAndBindForTest
	svc.scenarioJobs = store
	host := &localSpeechHostStub{calls: make(chan string, 1)}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedSpeechExecutionForTest(t, capabilitydriver.AudioSynthesizeContract, "speech-idempotency-persist-failure")})
	svc.SetLocalSpeechExecutionHost(host)
	ctx := withLocalScenarioTestIntent(scenarioJobUserContext("app.local", "anonymous"), capabilitydriver.AudioSynthesizeContract)
	response, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head:           &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"},
		ScenarioType:   runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode:  runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		IdempotencyKey: "speech-idempotency-persist-failure",
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
			SpeechSynthesize: localQwen3SpeechSpecForTest("must not execute"),
		}},
	})
	if response != nil || statusCode(err) != codes.Internal {
		t.Fatalf("local speech response=%+v error=%v code=%v", response, err, statusCode(err))
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("local speech reason=%v present=%v error=%v", reason, ok, err)
	}
	select {
	case call := <-host.calls:
		t.Fatalf("binding persistence failure reached local speech Host: %q", call)
	default:
	}
	assertNoSubmittedScenarioJobAfterRestart(t, store, localStatePath)
}

func TestCloudMediaIdempotencyBindingPersistenceFailureLeavesNoOrphan(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", "https://api.openai.com/v1", Config{})
	secrets := installCustodyTrackingConnectorStore(t, &fixture)
	store, localStatePath := newDurableScenarioJobStoreForFailureTest(t)
	store.persistenceFailure = failScenarioJobCreateAndBindForTest
	fixture.service.scenarioJobs = store
	host := newControlledRemoteMediaHost(false)
	fixture.service.SetRemoteMediaExecutionHost(host)
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), capabilitydriver.StableDiffusionCapabilityContract, fixture.targetRef)
	response, err := fixture.service.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head:           &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"},
		ScenarioType:   runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		ExecutionMode:  runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		IdempotencyKey: "cloud-media-idempotency-persist-failure",
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{
			ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "must not execute"},
		}},
	})
	if response != nil || statusCode(err) != codes.Internal {
		t.Fatalf("cloud media response=%+v error=%v code=%v", response, err, statusCode(err))
	}
	select {
	case <-host.started:
		t.Fatal("binding persistence failure reached cloud media provider")
	default:
	}
	assertNoSubmittedScenarioJobAfterRestart(t, store, localStatePath)
	assertOnlyLiveConnectorCredential(t, secrets, fixture.connectorID)
}

func failScenarioJobCreateAndBindForTest(attempt scenarioJobPersistenceAttempt) error {
	if attempt.Operation == scenarioJobPersistCreateAndBind {
		return errors.New("injected idempotency binding persistence failure")
	}
	return nil
}

func TestCloudMediaRunningPersistenceFailureStopsProviderAndTerminalizes(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", "https://api.openai.com/v1", Config{})
	store, localStatePath := newDurableScenarioJobStoreForFailureTest(t)
	store.persistenceFailure = failScenarioJobRunningTransitionForTest
	fixture.service.scenarioJobs = store
	host := newControlledRemoteMediaHost(false)
	fixture.service.SetRemoteMediaExecutionHost(host)
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), capabilitydriver.StableDiffusionCapabilityContract, fixture.targetRef)
	response, err := fixture.service.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{
			ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "must not execute"},
		}},
	})
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	terminal := waitScenarioJobTerminal(t, fixture.service, response.GetJob().GetJobId(), 3*time.Second)
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || terminal.GetReasonDetail() != scenarioJobRunningPersistenceFailedReason {
		t.Fatalf("cloud media persistence terminal=%+v", terminal)
	}
	select {
	case <-host.started:
		t.Fatal("RUNNING persistence failure reached cloud media provider")
	default:
	}
	waitCompletedScenarioJobCleanup(t, fixture.service, terminal.GetJobId())
	reopened, reopenErr := newScenarioJobStoreForLocalStatePath(localStatePath)
	if reopenErr != nil {
		t.Fatal(reopenErr)
	}
	if durable, ok := reopened.get(terminal.GetJobId()); !ok || durable.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
		t.Fatalf("reopened cloud media terminal=%+v visible=%v", durable, ok)
	}
}

func TestLocalSpeechRunningPersistenceFailureStopsModelAndTerminalizes(t *testing.T) {
	svc := newTestService(nil)
	store, localStatePath := newDurableScenarioJobStoreForFailureTest(t)
	store.persistenceFailure = failScenarioJobRunningTransitionForTest
	svc.scenarioJobs = store
	host := &localSpeechHostStub{calls: make(chan string, 1)}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedSpeechExecutionForTest(t, capabilitydriver.AudioSynthesizeContract, "speech-running-persist-failure")})
	svc.SetLocalSpeechExecutionHost(host)
	ctx := withLocalScenarioTestIntent(scenarioJobUserContext("app.local", "anonymous"), capabilitydriver.AudioSynthesizeContract)
	response, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
			SpeechSynthesize: localQwen3SpeechSpecForTest("must not execute"),
		}},
	})
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	terminal := waitLocalSpeechJobTerminal(t, svc, response.GetJob().GetJobId())
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || terminal.GetReasonDetail() != scenarioJobRunningPersistenceFailedReason {
		t.Fatalf("local speech persistence terminal=%+v", terminal)
	}
	select {
	case call := <-host.calls:
		t.Fatalf("RUNNING persistence failure reached local speech model: %q", call)
	default:
	}
	waitCompletedScenarioJobCleanup(t, svc, terminal.GetJobId())
	reopened, reopenErr := newScenarioJobStoreForLocalStatePath(localStatePath)
	if reopenErr != nil {
		t.Fatal(reopenErr)
	}
	if durable, ok := reopened.get(terminal.GetJobId()); !ok || durable.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
		t.Fatalf("reopened local speech terminal=%+v visible=%v", durable, ok)
	}
}

func failScenarioJobRunningTransitionForTest(attempt scenarioJobPersistenceAttempt) error {
	if attempt.Operation == scenarioJobPersistTransition && attempt.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING {
		return errors.New("injected RUNNING persistence failure")
	}
	return nil
}

func TestCloudMediaTerminalPersistenceRetriesThenCompletes(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", "https://api.openai.com/v1", Config{})
	store, localStatePath := newDurableScenarioJobStoreForFailureTest(t)
	var attempts atomic.Int32
	store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Operation == scenarioJobPersistTransition && attempt.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			if attempts.Add(1) < maxScenarioJobTerminalPersistenceAttempts {
				return errors.New("injected transient COMPLETED persistence failure")
			}
		}
		return nil
	}
	fixture.service.scenarioJobs = store
	host := newControlledRemoteMediaHost(false)
	fixture.service.SetRemoteMediaExecutionHost(host)
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), capabilitydriver.StableDiffusionCapabilityContract, fixture.targetRef)
	response, err := fixture.service.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{
			ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "retry terminal persistence"},
		}},
	})
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	select {
	case <-host.started:
	case <-time.After(2 * time.Second):
		t.Fatal("cloud media provider was not entered")
	}
	close(host.release)
	terminal := waitScenarioJobTerminal(t, fixture.service, response.GetJob().GetJobId(), 3*time.Second)
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || attempts.Load() != maxScenarioJobTerminalPersistenceAttempts {
		t.Fatalf("cloud media terminal=%+v persistence attempts=%d", terminal, attempts.Load())
	}
	waitCompletedScenarioJobCleanup(t, fixture.service, terminal.GetJobId())
	reopened, reopenErr := newScenarioJobStoreForLocalStatePath(localStatePath)
	if reopenErr != nil {
		t.Fatal(reopenErr)
	}
	if durable, ok := reopened.get(terminal.GetJobId()); !ok || durable.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("reopened cloud media terminal=%+v visible=%v", durable, ok)
	}
}

func TestLocalSpeechTerminalPersistenceExhaustionRetainsCompleteCandidate(t *testing.T) {
	svc := newTestService(nil)
	store, localStatePath := newDurableScenarioJobStoreForFailureTest(t)
	var attempts atomic.Int32
	store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Operation == scenarioJobPersistTransition && attempt.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			attempts.Add(1)
			return errors.New("injected permanent COMPLETED persistence failure")
		}
		return nil
	}
	svc.scenarioJobs = store
	host := &localSpeechHostStub{calls: make(chan string, 1)}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedSpeechExecutionForTest(t, capabilitydriver.AudioSynthesizeContract, "speech-terminal-persist-failure")})
	svc.SetLocalSpeechExecutionHost(host)
	ctx := withLocalScenarioTestIntent(scenarioJobUserContext("app.local", "anonymous"), capabilitydriver.AudioSynthesizeContract)
	response, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
			SpeechSynthesize: localQwen3SpeechSpecForTest("force terminal fallback"),
		}},
	})
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	id := response.GetJob().GetJobId()
	deadline := time.Now().Add(3 * time.Second)
	for !store.hasResultCandidate(id) {
		if time.Now().After(deadline) {
			t.Fatal("complete local result was not retained")
		}
		time.Sleep(time.Millisecond)
	}
	waitScenarioJobWorkExit(t, store, id)
	snapshot, _ := store.get(id)
	if snapshot.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || len(snapshot.GetArtifacts()) != 0 || store.currentObservationIssue(id) == nil {
		t.Fatalf("failed final commit published or lost the result: %v", snapshot)
	}
	if attempts.Load() != maxScenarioJobTerminalPersistenceAttempts {
		t.Fatalf("bounded terminal attempts=%d", attempts.Load())
	}
	select {
	case <-host.calls:
	default:
		t.Fatal("local speech model did not execute")
	}
	reopened, reopenErr := newScenarioJobStoreForLocalStatePath(localStatePath)
	if reopenErr != nil {
		t.Fatal(reopenErr)
	}
	recoveredSvc := newTestService(nil)
	recoveredSvc.scenarioJobs = reopened
	recoveredSvc.SetRuntimeArtifactStore(svc.runtimeArtifacts)
	completed, err := recoveredSvc.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || completed.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(completed.GetJob().GetArtifacts()) != 1 {
		t.Fatalf("local publication recovery: %v %v", completed, err)
	}
	select {
	case <-host.calls:
		t.Fatal("publication recovery reran speech inference")
	default:
	}
	waitCompletedScenarioJobCleanup(t, recoveredSvc, id)

}

func TestLocalImageFirstCandidateWriteFailureRecoversOnOriginalGet(t *testing.T) {
	svc := newTestService(nil)
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	svc.scenarioJobs = store
	svc.SetRuntimeArtifactStore(svc.runtimeArtifacts)
	host := &localImageHostStub{entered: make(chan struct{})}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedImageExecutionForTest(t, "image-first-candidate-write-failure")})
	svc.SetLocalImageExecutionHost(host)

	var fault, resultWritesStarted atomic.Bool
	var candidateWrites, failedWrites atomic.Int32
	fault.Store(true)
	store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Operation == scenarioJobPersistResultCandidate {
			candidateWrites.Add(1)
			resultWritesStarted.Store(true)
		}
		// Start at the first candidate write, then keep storage unavailable until
		// the producer exits. A retry may commit COMPLETED directly; do not require
		// a particular number or kind of internal persistence retries.
		if fault.Load() && resultWritesStarted.Load() {
			failedWrites.Add(1)
			return errors.New("temporary result writer outage")
		}
		return nil
	}
	ctx := localImageIntentContext(scenarioJobUserContext("app.local", "anonymous"), nil)
	submitted, err := svc.SubmitScenarioJob(ctx, localImageJobRequestForTest(2))
	if err != nil {
		t.Fatal(err)
	}
	id := submitted.GetJob().GetJobId()
	select {
	case <-host.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("Local image work did not start")
	}
	waitScenarioJobWorkExit(t, store, id)
	if candidateWrites.Load() == 0 || failedWrites.Load() == 0 {
		t.Fatal("first candidate persistence branch was not exercised")
	}
	t.Logf("fault window: candidate writes=%d failed writes=%d", candidateWrites.Load(), failedWrites.Load())
	snapshot, _ := store.get(id)
	if snapshot.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || len(snapshot.GetArtifacts()) != 0 {
		t.Fatalf("failed storage published an uncommitted result: %v", snapshot)
	}
	store.mu.RLock()
	ids := append([]string(nil), store.jobs[id].bodyArtifactIDs...)
	store.mu.RUnlock()
	if len(ids) != 2 {
		t.Fatalf("complete output set was lost: %v", ids)
	}
	for _, artifactID := range ids {
		if _, complete := svc.runtimeArtifacts.(runtimeartifact.JobBodyStore).JobBodyStat(id, artifactID); !complete {
			t.Fatalf("body %s is incomplete", artifactID)
		}
		if _, visible := svc.runtimeArtifacts.Stat(artifactID); visible {
			t.Fatalf("body %s was published before commit", artifactID)
		}
	}
	// Only a live association may survive this outage. A separate reopen of the
	// acknowledged disk snapshot must not claim that an unwritten result exists.
	reopened := cloneScenarioJobStoreForReopenTest(t, store)
	diskJob, found := reopened.get(id)
	if !found || diskJob.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || reopened.hasResultCandidate(id) {
		t.Fatalf("unwritten result was presented as durable: %v", diskJob)
	}
	fault.Store(false)
	if _, err := svc.GetScenarioJob(scenarioJobUserContext("foreign-app", "foreign-user"), &runtimev1.GetScenarioJobRequest{JobId: id}); err == nil {
		t.Fatal("foreign Get was allowed to publish the candidate")
	}
	for _, artifactID := range ids {
		if _, visible := svc.runtimeArtifacts.Stat(artifactID); visible {
			t.Fatal("unauthorized Get published a body")
		}
	}
	completed, err := svc.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || completed.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(completed.GetJob().GetArtifacts()) != 2 || completed.GetObservationIssue() != nil {
		t.Fatalf("original Get did not recover the complete Local result after writer recovery: response=%v err=%v", completed, err)
	}
	for index, artifact := range completed.GetJob().GetArtifacts() {
		if artifact.GetArtifactId() != ids[index] || artifact.GetSeed() != 101+int32(index) {
			t.Fatalf("recovery changed original output identity or content facts: %v", artifact)
		}
		source, ok := svc.runtimeArtifacts.Open(context.Background(), artifact.GetArtifactId())
		if !ok {
			t.Fatal("committed body is not readable")
		}
		body, readErr := io.ReadAll(source.Body)
		closeErr := source.Body.Close()
		if readErr != nil || closeErr != nil || !bytes.Equal(body, serviceTestPNGBytes()) {
			t.Fatalf("original PNG changed: read=%v close=%v", readErr, closeErr)
		}
	}
	host.mu.Lock()
	executions := len(host.plans)
	host.mu.Unlock()
	if executions != 1 {
		t.Fatalf("Get recovery re-executed inference: %d", executions)
	}
	durable := cloneScenarioJobStoreForReopenTest(t, store)
	durableJob, found := durable.get(id)
	if !found || durableJob.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(durableJob.GetArtifacts()) != 2 {
		t.Fatalf("successful publication was not durable: %v", durableJob)
	}
	waitCompletedScenarioJobCleanup(t, svc, id)
}
