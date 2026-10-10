package ai

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestCloudImageJobPersistsExactEffectiveInputsBeforeDispatch(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", "https://api.openai.com/v1", Config{})
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	fixture.service.scenarioJobs = store
	host := newControlledRemoteMediaHost(false)
	fixture.service.SetRemoteMediaExecutionHost(host)
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), "image.generate", fixture.targetRef)
	const prompt = "durably captured cloud image prompt"

	submitted, err := fixture.service.SubmitScenarioJob(ctx, cloudImageJobRequest(prompt))
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	select {
	case <-host.started:
	case <-time.After(2 * time.Second):
		t.Fatal("cloud image Host did not start")
	}
	// Finish the async worker before TempDir cleanup. Merely releasing the Host
	// in a defer lets the worker race the durable-store directory removal on
	// Windows when the full package runs under load.
	t.Cleanup(func() {
		close(host.release)
		waitScenarioJobTerminal(t, fixture.service, submitted.GetJob().GetJobId(), 3*time.Second)
		waitCompletedScenarioJobCleanup(t, fixture.service, submitted.GetJob().GetJobId())
	})
	raw, err := readScenarioJobDocument(store.durablePath)
	if err != nil {
		t.Fatalf("read durable ScenarioJob snapshot: %v", err)
	}
	for _, want := range []string{prompt, fixture.connectorID, "provider_model_target", "cloud_resolved_assembly"} {
		if !bytes.Contains(raw, []byte(want)) {
			t.Fatalf("durable ScenarioJob %s is missing exact Cloud input %q: %s", submitted.GetJob().GetJobId(), want, raw)
		}
	}
	if bytes.Contains(raw, []byte("test-key")) {
		t.Fatalf("durable Cloud ResolvedAssembly contains credential material: %s", raw)
	}
}

func TestCloudImageJobCapturesCurrentAccountConnector(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", "https://api.openai.com/v1", Config{})
	store, localStatePath := newDurableScenarioJobStoreForFailureTest(t)
	fixture.service.scenarioJobs = store
	audit := auditlog.New(64, 64)
	fixture.service.audit = audit
	host := newControlledRemoteMediaHost(false)
	fixture.service.SetRemoteMediaExecutionHost(host)
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), "image.generate", fixture.targetRef)
	req := cloudImageJobRequest("job captures connector")

	submitted, err := fixture.service.SubmitScenarioJob(ctx, req)
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	captured := <-host.started
	if captured.ConnectorID != fixture.connectorID || captured.OwnerID != "user-001" {
		t.Fatalf("captured Connector snapshot = %+v", captured)
	}
	if strings.Contains(strings.ToLower(strings.Join([]string{captured.ConnectorID, captured.OwnerID, captured.Provider}, " ")), "test-key") {
		t.Fatal("credential leaked into Connector snapshot")
	}
	close(host.release)
	job := waitScenarioJobTerminal(t, fixture.service, submitted.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("captured job status = %s reason=%s", job.GetStatus(), job.GetReasonCode())
	}
	queryCtx := scenarioJobUserContext("nimi.desktop", "user-001")
	queried, err := fixture.service.GetScenarioJob(queryCtx, &runtimev1.GetScenarioJobRequest{JobId: job.GetJobId()})
	if err != nil {
		t.Fatalf("query captured job: %v", err)
	}
	if queried.GetJob().GetUsage() != nil {
		t.Fatalf("unreported media usage was filled during publication: %v", queried.GetJob().GetUsage())
	}
	waitCompletedScenarioJobCleanup(t, fixture.service, job.GetJobId())
	reopened, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	retained, found := reopened.get(job.GetJobId())
	if !found || retained.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || retained.GetUsage() != nil {
		t.Fatalf("durable media result changed absent usage: found=%v job=%v", found, retained)
	}
	artifacts, err := fixture.service.GetScenarioArtifacts(queryCtx, &runtimev1.GetScenarioArtifactsRequest{JobId: job.GetJobId()})
	if err != nil || len(artifacts.GetArtifacts()) != 1 {
		t.Fatalf("captured artifacts = %+v, %v", artifacts, err)
	}
	assertScenarioJobAndAuditContainNoSecret(t, job, audit, "test-key")
}

func TestCloudImageJobCancelStopsLocalWaitWithHonestTerminal(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", "https://api.openai.com/v1", Config{})
	host := newControlledRemoteMediaHost(true)
	fixture.service.SetRemoteMediaExecutionHost(host)
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), "image.generate", fixture.targetRef)
	submitted, err := fixture.service.SubmitScenarioJob(ctx, cloudImageJobRequest("cancel remote wait"))
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	captured := <-host.started
	if captured.ConnectorID != fixture.connectorID {
		t.Fatalf("captured Connector = %+v", captured)
	}
	assembly, ok := fixture.service.scenarioJobs.cloudResolvedAssembly(submitted.GetJob().GetJobId())
	if !ok || assembly == nil || assembly.CredentialCustodyRef == "" {
		t.Fatalf("submitted Job credential custody = %+v visible=%v", assembly, ok)
	}
	custodyRef := assembly.CredentialCustodyRef
	canceled, err := fixture.service.CancelScenarioJob(scenarioJobUserContext("nimi.desktop", "user-001"), &runtimev1.CancelScenarioJobRequest{
		JobId: submitted.GetJob().GetJobId(), Reason: "user requested cancellation",
	})
	if err != nil {
		t.Fatalf("CancelScenarioJob: %v", err)
	}
	if canceled.GetJob().GetReasonDetail() != "user requested cancellation" {
		t.Fatalf("cancel intent response = %+v", canceled.GetJob())
	}
	select {
	case <-host.cancelObserved:
	case <-time.After(2 * time.Second):
		t.Fatal("cloud image cancellation was not forwarded")
	}
	close(host.allowCancelExit)
	job := waitScenarioJobTerminal(t, fixture.service, submitted.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("terminal status after transport cancellation = %s", job.GetStatus())
	}
	if captured, err := fixture.service.connStore.LoadCredentialCustody(custodyRef); err != nil || captured == "" {
		t.Fatalf("uncertain stop lost original custody: empty=%v err=%v", captured == "", err)
	}
}

func TestCloudImageJobSchedulerLeaseCoversRemoteHostLifetime(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", "https://api.openai.com/v1", Config{})
	fixture.service.scheduler = scheduler.New(scheduler.Config{GlobalConcurrency: 1, PerAppConcurrency: 1})
	host := newControlledRemoteMediaHost(false)
	fixture.service.SetRemoteMediaExecutionHost(host)
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), "image.generate", fixture.targetRef)
	first, err := fixture.service.SubmitScenarioJob(ctx, cloudImageJobRequest("first scheduler-owned job"))
	if err != nil {
		t.Fatalf("SubmitScenarioJob(first): %v", err)
	}
	select {
	case <-host.started:
	case <-time.After(2 * time.Second):
		t.Fatal("first cloud image job did not enter Remote Host")
	}
	secondRequest := cloudImageJobRequest("second scheduler-owned job")
	secondRequest.Head.AppId = "other.app"
	secondCtx := withCloudScenarioTestIntent(scenarioJobUserContext("other.app", "user-001"), "image.generate", fixture.targetRef)
	second, err := fixture.service.SubmitScenarioJob(secondCtx, secondRequest)
	if err != nil {
		t.Fatalf("SubmitScenarioJob(second): %v", err)
	}
	waitForImageJobStatus(t, fixture.service, second.GetJob().GetJobId(), runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED)
	probeCtx, probeCancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer probeCancel()
	probeRelease, _, probeErr := fixture.service.scheduler.Acquire(probeCtx, "other.app")
	if probeErr == nil {
		probeRelease()
		t.Fatal("scheduler lease was released before the active Remote Host execution completed")
	}
	close(host.release)
	if job := waitScenarioJobTerminal(t, fixture.service, first.GetJob().GetJobId(), 3*time.Second); job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("first cloud image terminal = %+v", job)
	}
	waitForScenarioJobTerminalForLocalTextTest(t, fixture.service, second.GetJob().GetJobId())
	secondResult, getErr := fixture.service.GetScenarioJob(secondCtx, &runtimev1.GetScenarioJobRequest{JobId: second.GetJob().GetJobId()})
	if getErr != nil {
		t.Fatal(getErr)
	}
	if job := secondResult.GetJob(); job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("second cloud image terminal = %+v", job)
	}
}

func cloudImageJobRequest(prompt string) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
			Prompt: prompt,
		}}},
	}
}

func assertScenarioJobAndAuditContainNoSecret(t *testing.T, job *runtimev1.ScenarioJob, audit *auditlog.Store, secret string) {
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
