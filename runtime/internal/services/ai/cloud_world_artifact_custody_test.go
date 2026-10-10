package ai

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
)

func cloudWorldArtifactFixture(t *testing.T) (managedCloudScenarioTestFixture, context.Context) {
	t.Helper()
	f := newManagedCloudScenarioTestFixture(t, "worldlabs", "marble-1.1", "https://api.worldlabs.ai", Config{})
	intent := cloudVoiceAIConfigIntent(t, f.connectorID, f.descriptor)
	intent.CapabilityContract = "world.generate"
	intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{
		ImplementationId: "worldlabs", DriverId: "nimillm", DriverDialect: "worldlabs",
	}
	if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("nimi.realm-persona-studio", intent)); err != nil {
		t.Fatal(err)
	}
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID: "user-001", AppID: "nimi.realm-persona-studio", RegisteredAppSubject: "protected-app-principal",
		Operation:      accountservice.LocalAppOperationScenarioJobSubmit,
		AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: localappop.AppOperationIDScenarioJobSubmit,
	})
	return f, ctx
}

func TestWorldOwnedImageCaptureSurvivesOriginalRemovalAndStoreReopen(t *testing.T) {
	f, ctx := cloudWorldArtifactFixture(t)
	statePath := filepath.Join(t.TempDir(), "state.json")
	store, err := newScenarioJobStoreForLocalStatePath(statePath)
	if err != nil {
		t.Fatal(err)
	}
	f.service.scenarioJobs = store
	host := newControlledRemoteMediaHost(false)
	f.service.remoteMediaHost = host
	t.Cleanup(func() { closeOnce(host.release) })
	payload := l1CarrierPNGBytes(t)
	owner := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", RegisteredAppSubject: "protected-app-principal", AppID: "nimi.realm-persona-studio"}
	putImageArtifactRecordForTest(t, f.service, "owned-image", owner, "image/png", payload)
	response, err := f.service.SubmitLocalAppScenarioJob(ctx, &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_WorldGenerate{
		WorldGenerate: &runtimev1.LocalAppWorldGenerateJobSpec{Image: &runtimev1.WorldGenerateOwnedImageInput{ArtifactId: "owned-image", Projection: runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_ORDINARY}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	<-host.started
	assembly, ok := f.service.scenarioJobs.cloudResolvedAssembly(response.GetJob().GetJobId())
	if !ok || assembly == nil {
		t.Fatal("Job lacks durable Cloud capture")
	}
	if got := assembly.ImageReference; got == nil || got.ArtifactID != "owned-image" || string(got.Bytes) != string(payload) || got.MIMEType != "image/png" {
		t.Fatalf("image capture=%+v", got)
	}
	// The input custody store no longer has the original record. Rehydrating the
	// execution must use the durable snapshot, never look up mutable input truth.
	if err := f.service.runtimeArtifacts.Delete("owned-image"); err != nil {
		t.Fatal(err)
	}
	// Reopen an isolated durable snapshot while the controlled original Host
	// is held. Two active writer owners must never resize the same FS extent.
	recoveredState := filepath.Join(t.TempDir(), "state.json")
	recoveredDir := filepath.Join(filepath.Dir(recoveredState), scenarioJobDiskStoreDirName)
	if err := os.MkdirAll(recoveredDir, 0700); err != nil {
		t.Fatal(err)
	}
	snapshot, err := readScenarioJobDocument(store.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(recoveredDir, scenarioJobDiskStoreFileName), snapshot, 0600); err != nil {
		t.Fatal(err)
	}
	reopened, err := newScenarioJobStoreForLocalStatePath(recoveredState)
	if err != nil {
		t.Fatal(err)
	}
	retained, ok := reopened.cloudResolvedAssembly(response.GetJob().GetJobId())
	if !ok {
		t.Fatal("reopened Job missing")
	}
	effective, err := f.service.cloudMediaEffectiveInputsFromResolvedAssembly(retained)
	if err != nil {
		t.Fatal(err)
	}
	missing := *retained
	missing.ImageReference = nil
	if _, err := f.service.cloudMediaEffectiveInputsFromResolvedAssembly(&missing); err == nil {
		t.Fatal("missing durable World capture was admitted")
	}
	if string(effective.resolvedAssembly.ImageReference.Bytes) != string(payload) {
		t.Fatal("reopened content changed")
	}
	effective.resolvedAssembly.ImageReference.Bytes[0] ^= 0xff
	if string(retained.ImageReference.Bytes) != string(payload) {
		t.Fatal("restored content aliases stored capture")
	}
	closeOnce(host.release)
	terminal := waitForScenarioJobTerminalForLocalTextTest(t, f.service, response.GetJob().GetJobId())
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("terminal=%v", terminal)
	}
	waitScenarioJobWorkExit(t, store, response.GetJob().GetJobId())
	deadline := time.Now().Add(3 * time.Second)
	for {
		assembly, _ := store.cloudResolvedAssembly(response.GetJob().GetJobId())
		if assembly == nil || assembly.CredentialCustodyRef == "" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("original writer cleanup did not finish")
		}
		time.Sleep(time.Millisecond)
	}

}

func TestWorldOwnedImageRejectsForeignAndWrongMimeBeforeJob(t *testing.T) {
	f, ctx := cloudWorldArtifactFixture(t)
	owner := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", RegisteredAppSubject: "protected-app-principal", AppID: "nimi.realm-persona-studio"}
	foreign := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", RegisteredAppSubject: "another-app", AppID: owner.AppID}
	putImageArtifactRecordForTest(t, f.service, "foreign-image", foreign, "image/png", l1CarrierPNGBytes(t))
	putImageArtifactRecordForTest(t, f.service, "wrong-mime", owner, "image/jpeg", l1CarrierPNGBytes(t))
	putImageArtifactRecordForTest(t, f.service, "truncated-image", owner, "image/png", l1CarrierPNGBytes(t)[:33])
	for _, tc := range []struct {
		id     string
		code   codes.Code
		reason runtimev1.ReasonCode
	}{
		{"missing-image", codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN},
		{"foreign-image", codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN},
		{"wrong-mime", codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH},
		{"truncated-image", codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH},
	} {
		response, err := f.service.SubmitLocalAppScenarioJob(ctx, &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_WorldGenerate{
			WorldGenerate: &runtimev1.LocalAppWorldGenerateJobSpec{Image: &runtimev1.WorldGenerateOwnedImageInput{ArtifactId: tc.id, Projection: runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_ORDINARY}},
		}})
		if response != nil {
			t.Fatalf("rejected image returned Job: %v", response)
		}
		assertLocalAppTextCandidateError(t, err, tc.code, tc.reason)
	}
	if len(f.service.scenarioJobs.jobs) != 0 {
		t.Fatal("invalid image created Jobs")
	}
}

func TestWorldOwnedImageCancellationWaitsForTransportExitWithoutLateArtifacts(t *testing.T) {
	f, ctx := cloudWorldArtifactFixture(t)
	host := newControlledRemoteMediaHost(true)
	f.service.remoteMediaHost = host
	t.Cleanup(func() { closeOnce(host.allowCancelExit) })
	owner := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", RegisteredAppSubject: "protected-app-principal", AppID: "nimi.realm-persona-studio"}
	putImageArtifactRecordForTest(t, f.service, "owned-image", owner, "image/png", l1CarrierPNGBytes(t))
	submitted, err := f.service.SubmitLocalAppScenarioJob(ctx, &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_WorldGenerate{WorldGenerate: &runtimev1.LocalAppWorldGenerateJobSpec{Image: &runtimev1.WorldGenerateOwnedImageInput{ArtifactId: "owned-image", Projection: runtimev1.WorldImageProjection_WORLD_IMAGE_PROJECTION_ORDINARY}}}})
	if err != nil {
		t.Fatal(err)
	}
	<-host.started
	cancelCtx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: owner.AppID, RegisteredAppSubject: owner.RegisteredAppSubject, Operation: accountservice.LocalAppOperationScenarioJobCancel, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: localappop.AppOperationIDScenarioJobCancel})
	canceled, err := f.service.CancelLocalAppScenarioJob(cancelCtx, &runtimev1.CancelLocalAppScenarioJobRequest{JobId: submitted.GetJob().GetJobId(), Reason: "user canceled"})
	if err != nil {
		t.Fatal(err)
	}
	if canceled.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatal("cancel published without its local publication gate")
	}
	select {
	case <-host.cancelObserved:
	case <-time.After(2 * time.Second):
		t.Fatal("World cancellation not forwarded")
	}
	closeOnce(host.allowCancelExit)
	terminal := waitForScenarioJobTerminalForLocalTextTest(t, f.service, submitted.GetJob().GetJobId())
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || len(terminal.GetArtifacts()) != 0 {
		t.Fatal("World cancellation published late output")
	}
}
