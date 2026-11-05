package ai

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func TestOpenAIImage26PublicMarkupCustody(t *testing.T) {
	f, ctx := cloudImageArtifactProviderFixture(t, "openai", "gpt-image-2.6-flare", "https://api.openai.com")
	host := newControlledRemoteMediaHost(false)
	f.service.remoteMediaHost = host
	t.Cleanup(func() { closeOnce(host.release) })
	owner := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", RegisteredAppSubject: "protected-app-principal", AppID: "nimi.realm-persona-studio"}
	foreign := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", RegisteredAppSubject: "another-app", AppID: owner.AppID}
	encode := func(w, h int, opaque bool) []byte {
		picture := image.NewNRGBA(image.Rect(0, 0, w, h))
		if opaque {
			for y := 0; y < h; y++ {
				for x := 0; x < w; x++ {
					picture.SetNRGBA(x, y, color.NRGBA{A: 255})
				}
			}
		}
		var b bytes.Buffer
		if err := png.Encode(&b, picture); err != nil {
			t.Fatal(err)
		}
		return b.Bytes()
	}
	source, overlay := encode(8, 4, true), encode(8, 4, false)
	putImageArtifactRecordForTest(t, f.service, "source", owner, "image/png", source)
	putImageArtifactRecordForTest(t, f.service, "overlay", owner, "image/png", overlay)
	putImageArtifactRecordForTest(t, f.service, "foreign-overlay", foreign, "image/png", overlay)
	putImageArtifactRecordForTest(t, f.service, "wrong-size", owner, "image/png", encode(4, 4, false))
	putImageArtifactRecordForTest(t, f.service, "opaque", owner, "image/png", source)
	request := func(id string) *runtimev1.SubmitLocalAppScenarioJobRequest {
		return &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "edit annotated area", ReferenceImageArtifactId: "source", MarkupArtifactId: id, Complexity: "medium", OutputFormat: "webp"}}}
	}
	for id, reason := range map[string]runtimev1.ReasonCode{"foreign-overlay": runtimev1.ReasonCode_ARTIFACT_FORBIDDEN, "wrong-size": runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID, "opaque": runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID} {
		if _, err := f.service.SubmitLocalAppScenarioJob(ctx, request(id)); err == nil {
			t.Fatal("invalid markup admitted", id)
		} else if got, _ := grpcerr.ExtractReasonCode(err); got != reason {
			t.Fatal(id, got, err)
		}
		if len(f.service.scenarioJobs.jobs) != 0 {
			t.Fatal("invalid markup published a Job")
		}
	}
	response, err := f.service.SubmitLocalAppScenarioJob(ctx, request("overlay"))
	if err != nil {
		t.Fatal(err)
	}
	<-host.started
	id := response.GetJob().GetJobId()
	assembly, ok := f.service.scenarioJobs.cloudResolvedAssembly(id)
	if !ok || assembly.ImageMarkupReference == nil || !bytes.Equal(assembly.ImageMarkupReference.Bytes, overlay) {
		t.Fatal("lost captured overlay")
	}
	retained, err := cloneCloudResolvedAssembly(assembly)
	if err != nil {
		t.Fatal(err)
	}
	retained.ImageMarkupReference.Bytes[0] ^= 0xff
	if err := validateCloudResolvedAssembly(retained); err == nil {
		t.Fatal("tampered overlay admitted")
	}
	closeOnce(host.release)
	_ = waitForScenarioJobTerminalForLocalTextTest(t, f.service, id)
	waitCompletedScenarioJobCleanup(t, f.service, id)
}
