package ai

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func TestAzureImageProtectedAppCapturesOwnedMaskAndDeployment(t *testing.T) {
	const model = "gpt-image-2.5-flare"
	f, ctx := cloudImageArtifactProviderFixture(t, "azure", model, "https://azure.example/openai/v1")
	f.connectorService = connector.New(f.service.logger, f.service.connStore, auditlog.New(128, 128))
	bind := func(deployment string) {
		t.Helper()
		if _, err := f.connectorService.UpdateConnector(f.context, &runtimev1.UpdateConnectorRequest{ConnectorId: f.connectorID, AzureDeployments: &runtimev1.ConnectorAzureDeployments{Deployments: []*runtimev1.ConnectorAzureDeployment{{ProviderModelId: model, DeploymentName: deployment}}}}); err != nil {
			t.Fatal(err)
		}
	}
	bind("original-image-deployment")
	f.descriptor = connectorModelDescriptorForAITest(t, f.connectorService, f.context, f.connectorID, model)
	intent := cloudVoiceAIConfigIntent(t, f.connectorID, f.descriptor)
	intent.CapabilityContract = "image.generate"
	intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.image.generate.azure", DriverId: "nimi.runtime.driver.azure", DriverDialect: "provider/media-v1"}
	if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("nimi.realm-persona-studio", intent)); err != nil {
		t.Fatal(err)
	}
	host := newControlledRemoteMediaHost(false)
	f.service.remoteMediaHost = host
	t.Cleanup(func() { closeOnce(host.release) })
	owner := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", RegisteredAppSubject: "protected-app-principal", AppID: "nimi.realm-persona-studio"}
	foreign := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", RegisteredAppSubject: "another-app", AppID: owner.AppID}
	source := l1CarrierPNGBytes(t)
	info, err := png.DecodeConfig(bytes.NewReader(source))
	if err != nil {
		t.Fatal(err)
	}
	maskImage := image.NewGray(image.Rect(0, 0, info.Width, info.Height))
	maskImage.SetGray(0, 0, color.Gray{Y: 255})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, maskImage); err != nil {
		t.Fatal(err)
	}
	putImageArtifactRecordForTest(t, f.service, "source", owner, "image/png", source)
	putImageArtifactRecordForTest(t, f.service, "mask", owner, "image/png", encoded.Bytes())
	putImageArtifactRecordForTest(t, f.service, "foreign-mask", foreign, "image/png", encoded.Bytes())
	request := func(mask string) *runtimev1.SubmitLocalAppScenarioJobRequest {
		return &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "edit white region", ReferenceImageArtifactId: "source", MaskArtifactId: mask, OutputFormat: "png"}}}
	}
	if _, err := f.service.SubmitLocalAppScenarioJob(ctx, request("foreign-mask")); err == nil {
		t.Fatal("foreign mask admitted")
	} else if got, _ := grpcerr.ExtractReasonCode(err); got != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
		t.Fatal(err)
	}
	if len(f.service.scenarioJobs.jobs) != 0 {
		t.Fatal("foreign mask published a Job")
	}
	response, err := f.service.SubmitLocalAppScenarioJob(ctx, request("mask"))
	if err != nil {
		t.Fatal(err)
	}
	<-host.started
	jobID := response.GetJob().GetJobId()
	assembly, ok := f.service.scenarioJobs.cloudResolvedAssembly(jobID)
	if !ok || connector.AzureDeploymentForModel(assembly.Connector.AzureDeployments, model) != "original-image-deployment" || assembly.ImageMaskReference == nil || !bytes.Equal(assembly.ImageMaskReference.Bytes, encoded.Bytes()) {
		t.Fatal("image inputs or deployment not captured")
	}
	bind("replacement-image-deployment")
	if err := f.service.runtimeArtifacts.Delete("mask"); err != nil {
		t.Fatal(err)
	}
	effective, err := f.service.cloudMediaEffectiveInputsFromResolvedAssembly(assembly)
	if err != nil || connector.AzureDeploymentForModel(effective.resolvedAssembly.Connector.AzureDeployments, model) != "original-image-deployment" || !bytes.Equal(effective.resolvedAssembly.ImageMaskReference.Bytes, encoded.Bytes()) {
		t.Fatal("captured media retargeted or lost", err)
	}
	if _, err := f.service.SubmitLocalAppScenarioJob(ctx, request("mask")); err == nil {
		t.Fatal("stale deployment selection was admitted")
	}
	closeOnce(host.release)
	_ = waitForScenarioJobTerminalForLocalTextTest(t, f.service, jobID)
	waitCompletedScenarioJobCleanup(t, f.service, jobID)
}
