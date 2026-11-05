package ai

import (
	"bytes"
	"image"
	"image/png"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func TestLumaUniImagePublicCaptureAndRestoration(t *testing.T) {
	f, ctx := cloudImageArtifactProviderFixture(t, "luma", "uni-1-max", "https://agents.lumalabs.ai/v1")
	host := newControlledRemoteMediaHost(false)
	f.service.remoteMediaHost = host
	t.Cleanup(func() { closeOnce(host.release) })
	owner := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", RegisteredAppSubject: "protected-app-principal", AppID: "nimi.realm-persona-studio"}
	foreign := &runtimeartifact.ArtifactOwner{SubjectUserID: owner.SubjectUserID, RegisteredAppSubject: "foreign", AppID: owner.AppID}
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewNRGBA(image.Rect(0, 0, 8, 4))); err != nil {
		t.Fatal(err)
	}
	putImageArtifactRecordForTest(t, f.service, "source", owner, "image/png", b.Bytes())
	putImageArtifactRecordForTest(t, f.service, "foreign", foreign, "image/png", b.Bytes())
	request := func(id string) *runtimev1.SubmitLocalAppScenarioJobRequest {
		return &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "edit cup", ReferenceImageArtifactId: id, OutputFormat: "jpeg"}}}
	}
	if _, err := f.service.SubmitLocalAppScenarioJob(ctx, request("foreign")); err == nil {
		t.Fatal("foreign source accepted")
	} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
		t.Fatal(err)
	}
	if len(f.service.scenarioJobs.jobs) != 0 {
		t.Fatal("foreign input created a job")
	}
	response, err := f.service.SubmitLocalAppScenarioJob(ctx, request("source"))
	if err != nil {
		t.Fatal(err)
	}
	<-host.started
	id := response.GetJob().GetJobId()
	assembly, ok := f.service.scenarioJobs.cloudResolvedAssembly(id)
	if !ok || assembly.ImageReference == nil || !bytes.Equal(assembly.ImageReference.Bytes, b.Bytes()) {
		t.Fatal("source not captured")
	}
	if err = validateCloudResolvedAssembly(assembly); err != nil {
		t.Fatal(err)
	}
	changed, err := cloneCloudResolvedAssembly(assembly)
	if err != nil {
		t.Fatal(err)
	}
	changed.ImageReference.Bytes[0] ^= 255
	if err = validateCloudResolvedAssembly(changed); err == nil {
		t.Fatal("altered capture restored")
	}
	closeOnce(host.release)
	_ = waitForScenarioJobTerminalForLocalTextTest(t, f.service, id)
	waitCompletedScenarioJobCleanup(t, f.service, id)
}
