package ai

import (
	"errors"
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
}

func TestCloudVoiceTerminalPersistenceFailureDoesNotPublishAsset(t *testing.T) {
	var providerCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		providerCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"output":{"voice":"must-remain-private"}}`))
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
	terminal := waitScenarioJobTerminal(t, fixture.service, jobID, 3*time.Second)
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || terminal.GetReasonDetail() != scenarioJobTerminalPersistenceFailedReason {
		t.Fatalf("terminal=%s reason=%s detail=%q", terminal.GetStatus(), terminal.GetReasonCode(), terminal.GetReasonDetail())
	}
	if providerCalls.Load() != 1 || terminalAttempts.Load() != maxScenarioJobTerminalPersistenceAttempts {
		t.Fatalf("provider calls=%d terminal persistence attempts=%d", providerCalls.Load(), terminalAttempts.Load())
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

	restarted := restartProtectedAIServiceForVoicePublicationTest(t, localStatePath)
	if asset, ok := restarted.voiceAssets.getAsset(jobID); ok || asset != nil {
		t.Fatalf("failed terminal commit recovered a public VoiceAsset %#v", asset)
	}
	restarted.voiceAssets.mu.RLock()
	assetCount, pendingCount := len(restarted.voiceAssets.assets), len(restarted.voiceAssets.pending)
	restarted.voiceAssets.mu.RUnlock()
	if assetCount != 0 || pendingCount != 0 {
		t.Fatalf("failed terminal commit retained voice publication state: assets=%d pending=%d", assetCount, pendingCount)
	}
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
			SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "must not execute"},
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
			SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "must not execute"},
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
	reopened, reopenErr := newScenarioJobStoreForLocalStatePath(localStatePath)
	if reopenErr != nil {
		t.Fatal(reopenErr)
	}
	if durable, ok := reopened.get(terminal.GetJobId()); !ok || durable.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("reopened cloud media terminal=%+v visible=%v", durable, ok)
	}
}

func TestLocalSpeechTerminalPersistenceExhaustionForcesObservableFailure(t *testing.T) {
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
			SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "force terminal fallback"},
		}},
	})
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	terminal := waitLocalSpeechJobTerminal(t, svc, response.GetJob().GetJobId())
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || terminal.GetReasonDetail() != scenarioJobTerminalPersistenceFailedReason {
		t.Fatalf("local speech forced terminal=%+v", terminal)
	}
	if attempts.Load() != maxScenarioJobTerminalPersistenceAttempts {
		t.Fatalf("terminal persistence attempts=%d, want %d", attempts.Load(), maxScenarioJobTerminalPersistenceAttempts)
	}
	store.mu.RLock()
	done := store.jobs[terminal.GetJobId()].done
	store.mu.RUnlock()
	select {
	case <-done:
	default:
		t.Fatal("forced in-memory terminal did not close done")
	}
	select {
	case <-host.calls:
	default:
		t.Fatal("local speech model did not run before terminal persistence failure")
	}
	reopened, reopenErr := newScenarioJobStoreForLocalStatePath(localStatePath)
	if reopenErr != nil {
		t.Fatal(reopenErr)
	}
	if durable, ok := reopened.get(terminal.GetJobId()); !ok || durable.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
		t.Fatalf("restart recovery terminal=%+v visible=%v", durable, ok)
	}
}
