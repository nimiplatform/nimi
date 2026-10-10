package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/proto"
)

type controlledRemoteMediaHost struct {
	started         chan connector.ConnectorRecord
	release         chan struct{}
	cancel          bool
	cancelObserved  chan struct{}
	allowCancelExit chan struct{}
	once            sync.Once
	mu              sync.Mutex
	executions      int
}

func TestOpenAITranscriptionLanguageSurvivesProtectedJobReopen(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/transcriptions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":"Bonjour.","languages":[{"code":"fr"}]}`))
	}))
	defer server.Close()
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-transcribe", server.URL, Config{AllowLoopbackEndpoint: true})
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(statePath)
	if err != nil {
		t.Fatal(err)
	}
	fixture.service.scenarioJobs = store
	intent := cloudVoiceAIConfigIntent(t, fixture.connectorID, fixture.descriptor)
	intent.CapabilityContract = "audio.transcribe"
	intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{
		ImplementationId: "cloud.audio.transcribe.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "provider/media-v1",
	}
	if err := overwriteAIConfigStoreForTest(context.Background(), fixture.service.aiConfigStore, "user-001", appAIConfig("nimi.realm-persona-studio", intent)); err != nil {
		t.Fatal(err)
	}
	caller := func(operation accountservice.LocalAppOperation, capability string) context.Context {
		return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
			AccountID: "user-001", AppID: "nimi.realm-persona-studio", RegisteredAppSubject: "protected-app-principal",
			Operation: operation, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability,
		})
	}
	submitted, err := fixture.service.SubmitLocalAppScenarioJob(caller(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit), &runtimev1.SubmitLocalAppScenarioJobRequest{
		Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_SpeechTranscribe{SpeechTranscribe: &runtimev1.LocalAppSpeechTranscribeJobSpec{
			AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: []byte("recording")}}, MimeType: "audio/wav", Language: "en",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	terminal := waitLocalSpeechJobTerminal(t, fixture.service, submitted.GetJob().GetJobId())
	expected := &runtimev1.SpeechTranscript{Status: runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_TRANSCRIBED, Text: "Bonjour.", Language: "fr"}
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || !proto.Equal(terminal.GetTranscription(), expected) {
		t.Fatalf("terminal=%v", terminal)
	}
	waitScenarioJobWorkExit(t, store, terminal.GetJobId())
	deadline := time.Now().Add(3 * time.Second)
	for {
		assembly, _ := store.cloudResolvedAssembly(terminal.GetJobId())
		if assembly == nil || assembly.CredentialCustodyRef == "" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("executor cleanup did not release original custody before reopening writer")
		}
		time.Sleep(time.Millisecond)
	}
	reopened, err := newScenarioJobStoreForLocalStatePath(statePath)
	if err != nil {
		t.Fatal(err)
	}
	fixture.service.scenarioJobs = reopened
	response, err := fixture.service.GetLocalAppScenarioJob(caller(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet), &runtimev1.GetLocalAppScenarioJobRequest{JobId: terminal.GetJobId()})
	if err != nil || !proto.Equal(response.GetJob().GetTranscription(), expected) || response.GetJob().GetTranscriptionText() != expected.GetText() {
		t.Fatalf("reopened GetLocalAppScenarioJob=%v err=%v", response, err)
	}
}

func newControlledRemoteMediaHost(cancel bool) *controlledRemoteMediaHost {
	return &controlledRemoteMediaHost{
		started:         make(chan connector.ConnectorRecord, 1),
		release:         make(chan struct{}),
		cancel:          cancel,
		cancelObserved:  make(chan struct{}),
		allowCancelExit: make(chan struct{}),
	}
}

func (h *controlledRemoteMediaHost) ExecuteMedia(
	ctx context.Context,
	connectorRecord connector.ConnectorRecord,
	_ capabilitydriver.CloudMediaTarget,
	_ *capabilitydriver.CloudMediaMappedRequest,
	_ remoteexecution.MediaDispatchAudit,
) (capabilitydriver.CloudMediaTransportResponse, error) {
	h.once.Do(func() { h.started <- connectorRecord })
	if h.cancel {
		<-ctx.Done()
		closeOnce(h.cancelObserved)
		<-h.allowCancelExit
		return capabilitydriver.CloudMediaTransportResponse{}, ctx.Err()
	}
	select {
	case <-ctx.Done():
		return capabilitydriver.CloudMediaTransportResponse{}, ctx.Err()
	case <-h.release:
		body, err := capabilitydriver.NewBoundedArtifactBody([]byte("captured"))
		if err != nil {
			return capabilitydriver.CloudMediaTransportResponse{}, err
		}
		h.mu.Lock()
		h.executions++
		artifactID := fmt.Sprintf("captured-media-%d", h.executions)
		h.mu.Unlock()
		return capabilitydriver.CloudMediaTransportResponse{
			Artifacts:      []*runtimev1.ScenarioArtifact{{ArtifactId: artifactID, MimeType: "image/png", SizeBytes: int64(len("captured"))}},
			ArtifactBodies: map[string]*capabilitydriver.ArtifactBody{artifactID: body},
			FinishReason:   runtimev1.FinishReason_FINISH_REASON_STOP,
		}, nil
	}
}

func (*controlledRemoteMediaHost) StreamSpeech(context.Context, connector.ConnectorRecord, capabilitydriver.CloudMediaTarget, *capabilitydriver.CloudMediaMappedRequest, func(capabilitydriver.CloudMediaStreamChunk) error, remoteexecution.MediaDispatchAudit) (capabilitydriver.CloudMediaTransportResponse, error) {
	return capabilitydriver.CloudMediaTransportResponse{}, context.Canceled
}

func (*controlledRemoteMediaHost) ExecuteVoiceWorkflow(context.Context, connector.ConnectorRecord, capabilitydriver.CloudMediaTarget, *capabilitydriver.CloudVoiceWorkflowMappedRequest, remoteexecution.MediaDispatchAudit) (capabilitydriver.CloudVoiceWorkflowTransportResponse, error) {
	return capabilitydriver.CloudVoiceWorkflowTransportResponse{}, context.Canceled
}

func (*controlledRemoteMediaHost) DeleteVoiceAsset(context.Context, connector.ConnectorRecord, capabilitydriver.CloudMediaTarget, *capabilitydriver.CloudVoiceDeleteMappedRequest, remoteexecution.MediaDispatchAudit) error {
	return context.Canceled
}

func (*controlledRemoteMediaHost) InspectVoiceAsset(context.Context, connector.ConnectorRecord, capabilitydriver.CloudMediaTarget, *capabilitydriver.CloudVoiceInspectionMappedRequest, remoteexecution.MediaDispatchAudit) (capabilitydriver.CloudVoiceWorkflowTransportResponse, bool, error) {
	return capabilitydriver.CloudVoiceWorkflowTransportResponse{}, false, context.Canceled
}

func TestCloudMediaJobCapturesCurrentAccountConnector(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", "https://api.openai.com/v1", Config{})
	host := newControlledRemoteMediaHost(false)
	fixture.service.SetRemoteMediaExecutionHost(host)
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), "image.generate", fixture.targetRef)
	request := &runtimev1.SubmitScenarioJobRequest{
		Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec:         &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "captured connector"}}},
	}
	submitted, err := fixture.service.SubmitScenarioJob(ctx, request)
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	captured := <-host.started
	if captured.ConnectorID != fixture.connectorID || captured.OwnerID != "user-001" {
		t.Fatalf("captured Connector=%+v", captured)
	}
	snapshotJSON, _ := json.Marshal(captured)
	if strings.Contains(strings.ToLower(string(snapshotJSON)), "test-key") {
		t.Fatal("credential leaked into immutable Connector snapshot")
	}
	close(host.release)
	job := waitScenarioJobTerminal(t, fixture.service, submitted.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(job.GetArtifacts()) != 1 {
		t.Fatalf("captured job=%+v", job)
	}
}

func TestCloudMediaJobCancellationStopsLocalWaitAndPublishesNoProviderState(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", "https://api.openai.com/v1", Config{})
	host := newControlledRemoteMediaHost(true)
	fixture.service.SetRemoteMediaExecutionHost(host)
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), "image.generate", fixture.targetRef)
	submitted, err := fixture.service.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec:         &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "cancel wait"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	<-host.started
	canceled, err := fixture.service.CancelScenarioJob(scenarioJobUserContext("nimi.desktop", "user-001"), &runtimev1.CancelScenarioJobRequest{JobId: submitted.GetJob().GetJobId(), Reason: "user canceled"})
	if err != nil {
		t.Fatalf("CancelScenarioJob: %v", err)
	}
	job := canceled.GetJob()
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || job.GetProviderJobId() != "" || job.GetNextPollAt() != nil {
		t.Fatalf("cancel intent response=%+v", job)
	}
	select {
	case <-host.cancelObserved:
	case <-time.After(2 * time.Second):
		t.Fatal("cloud media cancellation was not forwarded")
	}
	if current, _ := fixture.service.scenarioJobs.get(job.GetJobId()); current.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("cloud media published CANCELED without its local publication gate: %+v", current)
	}
	close(host.allowCancelExit)
	terminal := waitScenarioJobTerminal(t, fixture.service, job.GetJobId(), 3*time.Second)
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("cloud media cancel terminal=%+v", terminal)
	}
}

func TestCloudMediaJobCapturesRequestAndBindsRuntimeArtifactCustody(t *testing.T) {
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewNRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	imageBytes := encoded.Bytes()
	var authorization string
	var providerPrompt string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/images/generations":
			authorization = r.Header.Get("Authorization")
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Errorf("decode provider request: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			providerPrompt, _ = payload["prompt"].(string)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{{"b64_json": base64.StdEncoding.EncodeToString(imageBytes)}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", server.URL, Config{AllowLoopbackEndpoint: true})
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), "image.generate", fixture.targetRef)
	request := &runtimev1.SubmitScenarioJobRequest{
		Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
			Prompt: "captured prompt", N: testInt32(1), Size: "1024x1024", ResponseFormat: "base64",
		}}},
	}
	submitted, err := fixture.service.SubmitScenarioJob(ctx, request)
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	request.GetSpec().GetImageGenerate().Prompt = "mutated after submission"

	job := waitScenarioJobTerminal(t, fixture.service, submitted.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("job status=%s reason=%s detail=%s", job.GetStatus(), job.GetReasonCode(), job.GetReasonDetail())
	}
	if providerPrompt != "captured prompt" {
		t.Fatalf("provider prompt=%q, want immutable captured prompt", providerPrompt)
	}
	if authorization != "Bearer test-key" {
		t.Fatalf("provider authorization=%q", authorization)
	}
	if strings.TrimSpace(job.GetProviderJobId()) != "" || job.GetNextPollAt() != nil {
		t.Fatalf("provider-private polling state escaped: provider_job_id=%q next_poll_at=%v", job.GetProviderJobId(), job.GetNextPollAt())
	}
	if len(job.GetArtifacts()) != 1 {
		t.Fatalf("artifacts=%d, want 1", len(job.GetArtifacts()))
	}
	artifact := job.GetArtifacts()[0]
	if got := artifact.GetMetadata().GetFields()["producer_job_id"].GetStringValue(); got != job.GetJobId() {
		t.Fatalf("producer_job_id=%q, want %q", got, job.GetJobId())
	}
	if got := artifact.GetMetadata().GetFields()["artifact_custody"].GetStringValue(); got != "runtime" {
		t.Fatalf("artifact_custody=%q", got)
	}
	record, ok := fixture.service.runtimeArtifacts.Get(artifact.GetArtifactId())
	if !ok {
		t.Fatal("artifact bytes were not placed in Runtime custody")
	}
	if record.ProducerJobID != job.GetJobId() || record.Owner == nil || record.Owner.SubjectUserID != "user-001" || record.Owner.AppID != "nimi.desktop" {
		t.Fatalf("artifact custody record=%+v", record)
	}
	if !bytes.Equal(record.Bytes, imageBytes) {
		t.Fatalf("artifact bytes=%q", record.Bytes)
	}
}
