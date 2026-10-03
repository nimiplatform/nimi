package ai

import (
	"context"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
)

func cloudImageArtifactFixture(t *testing.T) (managedCloudScenarioTestFixture, context.Context) {
	t.Helper()
	f := newManagedCloudScenarioTestFixture(t, "gemini", "gemini-3.1-flash-image", "https://generativelanguage.googleapis.com/v1beta", Config{})
	intent := cloudVoiceAIConfigIntent(t, f.connectorID, f.descriptor)
	intent.CapabilityContract = "image.generate"
	intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{
		ImplementationId: "cloud.image.generate.gemini", DriverId: "nimi.runtime.driver.gemini", DriverDialect: "provider/media-v1",
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

func TestCloudOwnedImageCaptureSurvivesOriginalRemovalAndStoreReopen(t *testing.T) {
	f, ctx := cloudImageArtifactFixture(t)
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
	response, err := f.service.SubmitLocalAppScenarioJob(ctx, &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{
		ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "make the bag green", ReferenceImageArtifactId: "owned-image"},
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
	f.service.runtimeArtifacts = runtimeartifact.NewMemoryStore()
	reopened, err := newScenarioJobStoreForLocalStatePath(statePath)
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
}

func TestCloudOwnedImageRejectsForeignAndWrongMimeBeforeJob(t *testing.T) {
	f, ctx := cloudImageArtifactFixture(t)
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
		response, err := f.service.SubmitLocalAppScenarioJob(ctx, &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{
			ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "edit", ReferenceImageArtifactId: tc.id},
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
