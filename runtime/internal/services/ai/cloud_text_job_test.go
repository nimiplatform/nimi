package ai

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/encoding/protojson"
)

type controlledRemoteTextHost struct {
	started chan connector.ConnectorGrantSnapshot
	release chan struct{}
	cancel  bool
	once    sync.Once
}

func newControlledRemoteTextHost(cancel bool) *controlledRemoteTextHost {
	return &controlledRemoteTextHost{
		started: make(chan connector.ConnectorGrantSnapshot, 1),
		release: make(chan struct{}),
		cancel:  cancel,
	}
}

func (h *controlledRemoteTextHost) ExecuteText(
	ctx context.Context,
	grant connector.ConnectorGrantSnapshot,
	_ capabilitydriver.CloudTextTarget,
	_ *capabilitydriver.CloudTextMappedRequest,
	_ remoteexecution.TextDispatchAudit,
) (capabilitydriver.CloudTextTransportResponse, error) {
	h.once.Do(func() { h.started <- grant })
	if h.cancel {
		<-ctx.Done()
		return capabilitydriver.CloudTextTransportResponse{}, ctx.Err()
	}
	select {
	case <-ctx.Done():
		return capabilitydriver.CloudTextTransportResponse{}, ctx.Err()
	case <-h.release:
		return capabilitydriver.CloudTextTransportResponse{
			Text:         "captured job completed",
			FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
		}, nil
	}
}

func (h *controlledRemoteTextHost) StreamText(
	context.Context,
	connector.ConnectorGrantSnapshot,
	capabilitydriver.CloudTextTarget,
	*capabilitydriver.CloudTextMappedRequest,
	func(string) error,
	remoteexecution.TextDispatchAudit,
) (capabilitydriver.CloudTextTransportResponse, error) {
	return capabilitydriver.CloudTextTransportResponse{}, context.Canceled
}

func TestCloudTextJobCapturesGrantAndSurvivesLaterRevocation(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-4o-mini", "https://api.openai.com/v1", Config{})
	audit := auditlog.New(64, 64)
	fixture.service.audit = audit
	host := newControlledRemoteTextHost(false)
	fixture.service.SetRemoteTextExecutionHost(host)
	ctx := cloudTextJobContext(fixture.targetRef)
	req := cloudTextJobRequest("job survives grant revocation")

	submitted, err := fixture.service.SubmitScenarioJob(ctx, req)
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	captured := <-host.started
	if captured.Grant.GrantID != fixture.targetRef.Cloud.ConnectorGrantID || captured.Connector.ConnectorID != fixture.connectorID {
		t.Fatalf("captured grant snapshot = %+v", captured)
	}
	if strings.Contains(strings.ToLower(strings.Join([]string{captured.Grant.GrantID, captured.Grant.AccountID, captured.Connector.Provider}, " ")), "test-key") {
		t.Fatal("credential leaked into grant snapshot")
	}
	if _, err := fixture.service.connStore.RevokeGrant("user-001", captured.Grant.GrantID); err != nil {
		t.Fatalf("RevokeGrant after submit: %v", err)
	}
	close(host.release)
	job := waitCloudTextJob(t, fixture.service, submitted.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("captured job status = %s reason=%s", job.GetStatus(), job.GetReasonCode())
	}
	queryCtx := scenarioJobUserContext("nimi.desktop", "user-001")
	if _, err := fixture.service.GetScenarioJob(queryCtx, &runtimev1.GetScenarioJobRequest{JobId: job.GetJobId()}); err != nil {
		t.Fatalf("query captured job after revoke: %v", err)
	}
	artifacts, err := fixture.service.GetScenarioArtifacts(queryCtx, &runtimev1.GetScenarioArtifactsRequest{JobId: job.GetJobId()})
	if err != nil || len(artifacts.GetArtifacts()) != 1 || outputText(artifacts.GetOutput()) != "captured job completed" {
		t.Fatalf("captured artifacts after revoke = %+v, %v", artifacts, err)
	}

	_, err = fixture.service.SubmitScenarioJob(ctx, cloudTextJobRequest("future job must fail"))
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONNECTOR_GRANT_REVOKED {
		t.Fatalf("future job reason = %v present=%v err=%v", reason, ok, err)
	}
	assertCloudJobAndAuditContainNoSecret(t, job, audit, "test-key")
}

func TestCloudTextJobCancelStopsLocalWaitWithHonestTerminal(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-4o-mini", "https://api.openai.com/v1", Config{})
	host := newControlledRemoteTextHost(true)
	fixture.service.SetRemoteTextExecutionHost(host)
	ctx := cloudTextJobContext(fixture.targetRef)
	submitted, err := fixture.service.SubmitScenarioJob(ctx, cloudTextJobRequest("cancel remote wait"))
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	captured := <-host.started
	if _, err := fixture.service.connStore.RevokeGrant("user-001", captured.Grant.GrantID); err != nil {
		t.Fatalf("RevokeGrant after submit: %v", err)
	}
	canceled, err := fixture.service.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{
		JobId: submitted.GetJob().GetJobId(), Reason: "user requested cancellation",
	})
	if err != nil {
		t.Fatalf("CancelScenarioJob: %v", err)
	}
	if canceled.GetJob().GetReasonDetail() != "user requested cancellation" {
		t.Fatalf("cancel intent response = %+v", canceled.GetJob())
	}
	job := waitCloudTextJob(t, fixture.service, submitted.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("terminal status after transport cancellation = %s", job.GetStatus())
	}
}

func cloudTextJobContext(target *runtimeidentity.Target) context.Context {
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "nimi.desktop"))
	ctx = authn.WithIdentity(ctx, &authn.Identity{SubjectUserID: "user-001"})
	return withCloudScenarioTestIntent(ctx, "text.generate", &runtimeidentity.Target{Cloud: target.GetCloud().Clone()})
}

func cloudTextJobRequest(prompt string) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "ignored", TimeoutMs: 30_000},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
			Input: []*runtimev1.ChatMessage{{Role: "user", Content: prompt}},
		}}},
	}
}

func waitCloudTextJob(t *testing.T, svc *Service, jobID string) *runtimev1.ScenarioJob {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		job, ok := svc.scenarioJobs.get(jobID)
		if ok && isTerminalScenarioJobStatus(job.GetStatus()) {
			return job
		}
		time.Sleep(5 * time.Millisecond)
	}
	job, _ := svc.scenarioJobs.get(jobID)
	t.Fatalf("cloud text job did not terminate: %+v", job)
	return nil
}

func assertCloudJobAndAuditContainNoSecret(t *testing.T, job *runtimev1.ScenarioJob, audit *auditlog.Store, secret string) {
	t.Helper()
	jobJSON, err := protojson.Marshal(job)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(jobJSON), secret) {
		t.Fatalf("job snapshot contains credential: %s", jobJSON)
	}
	events, err := audit.ListEvents(&runtimev1.ListAuditEventsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events.GetEvents() {
		raw, marshalErr := protojson.Marshal(event)
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		if strings.Contains(string(raw), secret) {
			t.Fatalf("audit contains credential: %s", raw)
		}
	}
}
