package ai

import (
	"bytes"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/proto"
	"image"
	"image/png"
	"testing"
)

func TestStabilityProtectedImageCapturesOwnedSourceAndStrength(t *testing.T) {
	for _, model := range []string{"stable-image-ultra", "stable-diffusion-3.5-large", "stable-diffusion-3.5-large-turbo", "stable-diffusion-3.5-medium"} {
		t.Run(model, func(t *testing.T) {
			f, ctx := cloudImageArtifactProviderFixture(t, "stability", model, "https://api.stability.ai")
			host := newControlledRemoteMediaHost(false)
			f.service.remoteMediaHost = host
			t.Cleanup(func() { closeOnce(host.release) })
			var encoded bytes.Buffer
			if err := png.Encode(&encoded, image.NewNRGBA(image.Rect(0, 0, 64, 64))); err != nil {
				t.Fatal(err)
			}
			owner := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", RegisteredAppSubject: "protected-app-principal", AppID: "nimi.realm-persona-studio"}
			foreign := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", RegisteredAppSubject: "another-app", AppID: owner.AppID}
			putImageArtifactRecordForTest(t, f.service, "source", owner, "image/png", encoded.Bytes())
			putImageArtifactRecordForTest(t, f.service, "foreign", foreign, "image/png", encoded.Bytes())
			request := func(id string) *runtimev1.SubmitLocalAppScenarioJobRequest {
				return &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "a lighthouse", ReferenceImageArtifactId: id, Strength: proto.Float32(.65), OutputFormat: "png"}}}
			}
			if _, err := f.service.SubmitLocalAppScenarioJob(ctx, request("foreign")); err == nil {
				t.Fatal("foreign image accepted")
			} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
				t.Fatal(err)
			}
			if len(f.service.scenarioJobs.jobs) != 0 {
				t.Fatal("foreign source published Job")
			}
			response, err := f.service.SubmitLocalAppScenarioJob(ctx, request("source"))
			if err != nil {
				t.Fatal(err)
			}
			<-host.started
			jobID := response.GetJob().GetJobId()
			assembly, ok := f.service.scenarioJobs.cloudResolvedAssembly(jobID)
			if !ok || assembly.ImageReference == nil || !bytes.Equal(assembly.ImageReference.Bytes, encoded.Bytes()) {
				t.Fatal("source not captured")
			}
			if err := f.service.runtimeArtifacts.Delete("source"); err != nil {
				t.Fatal(err)
			}
			effective, err := f.service.cloudMediaEffectiveInputsFromResolvedAssembly(assembly)
			if err != nil {
				t.Fatal(err)
			}
			spec := effective.request.GetSpec().GetImageGenerate()
			if spec.GetStrength() != .65 || spec.GetOutputFormat() != "png" || spec.GetSeed() <= 0 {
				t.Fatalf("capture lost selected controls: %+v", spec)
			}
			closeOnce(host.release)
			_ = waitForScenarioJobTerminalForLocalTextTest(t, f.service, jobID)
		})
	}
}
