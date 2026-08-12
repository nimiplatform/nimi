package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

type controlledRemoteMediaHost struct {
	started         chan connector.ConnectorGrantSnapshot
	release         chan struct{}
	cancel          bool
	cancelObserved  chan struct{}
	allowCancelExit chan struct{}
	once            sync.Once
	mu              sync.Mutex
	executions      int
}

func newControlledRemoteMediaHost(cancel bool) *controlledRemoteMediaHost {
	return &controlledRemoteMediaHost{
		started:         make(chan connector.ConnectorGrantSnapshot, 1),
		release:         make(chan struct{}),
		cancel:          cancel,
		cancelObserved:  make(chan struct{}),
		allowCancelExit: make(chan struct{}),
	}
}

func (h *controlledRemoteMediaHost) ExecuteMedia(
	ctx context.Context,
	grant connector.ConnectorGrantSnapshot,
	_ capabilitydriver.CloudMediaTarget,
	_ *capabilitydriver.CloudMediaMappedRequest,
	_ remoteexecution.MediaDispatchAudit,
) (capabilitydriver.CloudMediaTransportResponse, error) {
	h.once.Do(func() { h.started <- grant })
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

func (*controlledRemoteMediaHost) StreamSpeech(context.Context, connector.ConnectorGrantSnapshot, capabilitydriver.CloudMediaTarget, *capabilitydriver.CloudMediaMappedRequest, func(capabilitydriver.CloudMediaStreamChunk) error, remoteexecution.MediaDispatchAudit) (capabilitydriver.CloudMediaTransportResponse, error) {
	return capabilitydriver.CloudMediaTransportResponse{}, context.Canceled
}

func (*controlledRemoteMediaHost) ExecuteVoiceWorkflow(context.Context, connector.ConnectorGrantSnapshot, capabilitydriver.CloudMediaTarget, *capabilitydriver.CloudVoiceWorkflowMappedRequest, remoteexecution.MediaDispatchAudit) (capabilitydriver.CloudVoiceWorkflowTransportResponse, error) {
	return capabilitydriver.CloudVoiceWorkflowTransportResponse{}, context.Canceled
}

func (*controlledRemoteMediaHost) DeleteVoiceAsset(context.Context, connector.ConnectorGrantSnapshot, capabilitydriver.CloudMediaTarget, *capabilitydriver.CloudVoiceDeleteMappedRequest, remoteexecution.MediaDispatchAudit) error {
	return context.Canceled
}

func TestCloudMediaJobCapturesGrantAndSurvivesLaterRevocation(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", "https://api.openai.com/v1", Config{})
	host := newControlledRemoteMediaHost(false)
	fixture.service.SetRemoteMediaExecutionHost(host)
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), "image.generate", fixture.targetRef)
	request := &runtimev1.SubmitScenarioJobRequest{
		Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec:         &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "captured grant"}}},
	}
	submitted, err := fixture.service.SubmitScenarioJob(ctx, request)
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	captured := <-host.started
	if captured.Grant.GrantID != fixture.targetRef.Cloud.ConnectorGrantID || captured.Connector.ConnectorID != fixture.connectorID {
		t.Fatalf("captured grant=%+v", captured)
	}
	snapshotJSON, _ := json.Marshal(captured)
	if strings.Contains(strings.ToLower(string(snapshotJSON)), "test-key") {
		t.Fatal("credential leaked into immutable grant snapshot")
	}
	if _, err := fixture.service.connStore.RevokeGrant("user-001", captured.Grant.GrantID); err != nil {
		t.Fatalf("RevokeGrant: %v", err)
	}
	close(host.release)
	job := waitScenarioJobTerminal(t, fixture.service, submitted.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(job.GetArtifacts()) != 1 {
		t.Fatalf("captured job=%+v", job)
	}
	_, err = fixture.service.SubmitScenarioJob(ctx, request)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONNECTOR_GRANT_REVOKED {
		t.Fatalf("future job reason=%v present=%v err=%v", reason, ok, err)
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
	if job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || job.GetProviderJobId() != "" || job.GetNextPollAt() != nil {
		t.Fatalf("cancel intent response=%+v", job)
	}
	select {
	case <-host.cancelObserved:
	case <-time.After(2 * time.Second):
		t.Fatal("cloud media cancellation was not forwarded")
	}
	if current, _ := fixture.service.scenarioJobs.get(job.GetJobId()); current.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("cloud media published CANCELED before transport exit: %+v", current)
	}
	close(host.allowCancelExit)
	terminal := waitScenarioJobTerminal(t, fixture.service, job.GetJobId(), 3*time.Second)
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("cloud media cancel terminal=%+v", terminal)
	}
}

func TestCloudMediaJobCapturesRequestAndBindsRuntimeArtifactCustody(t *testing.T) {
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
				"data": []map[string]any{{"b64_json": base64.StdEncoding.EncodeToString([]byte("cloud-image"))}},
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
	if string(record.Bytes) != "cloud-image" {
		t.Fatalf("artifact bytes=%q", record.Bytes)
	}
}
