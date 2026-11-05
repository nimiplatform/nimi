package ai

import (
	"bytes"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestIdeogram45PublicMaskCustodyAndRestoration(t *testing.T) {
	f, ctx := cloudImageArtifactProviderFixture(t, "ideogram", "ideogram-4-5", "https://api.ideogram.ai")
	host := newControlledRemoteMediaHost(false)
	f.service.remoteMediaHost = host
	t.Cleanup(func() { closeOnce(host.release) })
	owner := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", RegisteredAppSubject: "protected-app-principal", AppID: "nimi.realm-persona-studio"}
	foreign := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", RegisteredAppSubject: "another-app", AppID: owner.AppID}
	picture := image.NewGray(image.Rect(0, 0, 2, 1))
	picture.SetGray(0, 0, color.Gray{Y: 255})
	var b bytes.Buffer
	if err := png.Encode(&b, picture); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"source", "mask"} {
		putImageArtifactRecordForTest(t, f.service, id, owner, "image/png", b.Bytes())
	}
	putImageArtifactRecordForTest(t, f.service, "foreign-mask", foreign, "image/png", b.Bytes())
	request := func(mask string) *runtimev1.SubmitLocalAppScenarioJobRequest {
		return &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "change white area", ReferenceImageArtifactId: "source", MaskArtifactId: mask}}}
	}
	if _, err := f.service.SubmitLocalAppScenarioJob(ctx, request("foreign-mask")); err == nil {
		t.Fatal("foreign mask admitted")
	} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
		t.Fatal(reason, err)
	}
	if len(f.service.scenarioJobs.jobs) != 0 {
		t.Fatal("foreign mask published Job")
	}
	response, err := f.service.SubmitLocalAppScenarioJob(ctx, request("mask"))
	if err != nil {
		t.Fatal(err)
	}
	<-host.started
	id := response.GetJob().GetJobId()
	assembly, ok := f.service.scenarioJobs.cloudResolvedAssembly(id)
	if !ok || assembly.ImageMaskReference == nil {
		t.Fatal("mask not captured")
	}
	if !bytes.Equal(assembly.ImageMaskReference.Bytes, b.Bytes()) {
		t.Fatal("canonical mask changed in custody")
	}
	for _, id := range []string{"source", "mask"} {
		if err := f.service.runtimeArtifacts.Delete(id); err != nil {
			t.Fatal(err)
		}
	}
	retained, err := cloneCloudResolvedAssembly(assembly)
	if err != nil {
		t.Fatal(err)
	}
	effective, err := f.service.cloudMediaEffectiveInputsFromResolvedAssembly(retained)
	if err != nil {
		t.Fatal("restoration reread inventory", err)
	}
	effective.release()
	retained.ImageMaskReference.Bytes[0] ^= 0xff
	if err := validateCloudResolvedAssembly(retained); err == nil {
		t.Fatal("tampered mask accepted")
	}
	closeOnce(host.release)
	_ = waitForScenarioJobTerminalForLocalTextTest(t, f.service, id)
	waitCompletedScenarioJobCleanup(t, f.service, id)
}
