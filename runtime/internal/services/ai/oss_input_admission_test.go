package ai

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/ossmedia"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestWanOwnedAudioRequiresCapturedOSSAndCleanupJournalSurvivesRestart(t *testing.T) {
	f := newManagedCloudScenarioTestFixture(t, "dashscope", "wan3.0-video", "https://dashscope.aliyuncs.com", Config{})
	path := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(path)
	if err != nil {
		t.Fatal(err)
	}
	f.service.scenarioJobs = store
	target, _ := structpb.NewStruct(map[string]any{"provider": "dashscope", "providerModelId": "wan3.0-video", "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId()})
	intent := &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "video.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{ConnectorRef: f.connectorID, Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.video.generate.dashscope", DriverId: "nimi.runtime.driver.dashscope", DriverDialect: "provider/media-v1"}, ProviderModelTarget: target}}}
	if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.oss", intent)); err != nil {
		t.Fatal(err)
	}
	decision := func(operation accountservice.LocalAppOperation, capability, subject string) context.Context {
		return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.oss", RegisteredAppSubject: subject, Operation: operation, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability})
	}
	upload := decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload, "oss-subject")
	submit := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit, "oss-subject")
	wav := mediaBudgetTestWAV()
	audio, err := f.service.UploadLocalAppArtifact(upload, &runtimev1.UploadLocalAppArtifactRequest{Bytes: wav, MimeType: "audio/wav"})
	if err != nil {
		t.Fatal(err)
	}
	picture := image.NewRGBA(image.Rect(0, 0, 400, 400))
	for y := 0; y < 400; y++ {
		for x := 0; x < 400; x++ {
			picture.SetRGBA(x, y, color.RGBA{B: 200, A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, picture); err != nil {
		t.Fatal(err)
	}
	frame, err := f.service.UploadLocalAppArtifact(upload, &runtimev1.UploadLocalAppArtifactRequest{Bytes: encoded.Bytes(), MimeType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	request := &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VideoGenerate{VideoGenerate: &runtimev1.LocalAppVideoGenerateJobSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE, Prompt: "Animate the image to this voice", Content: []*runtimev1.VideoContentItem{
		{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: frame.ArtifactId}},
		{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: audio.ArtifactId}},
	}, Options: &runtimev1.LocalAppVideoGenerationOptions{DurationSec: testInt32(3), Resolution: "720p"}}}}
	if _, err := f.service.SubmitLocalAppScenarioJob(submit, request); err == nil {
		t.Fatal("missing storage admitted")
	} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_MEDIA_STORAGE_NOT_CONFIGURED {
		t.Fatal(reason, err)
	}
	if len(store.jobs) != 0 {
		t.Fatal("missing storage published a Job")
	}
	credential := &ossmedia.Credentials{Config: ossmedia.Config{Region: "cn-beijing", Bucket: "test-bucket", KeyPrefix: "nimi-input/"}, AccessKeyID: "fixture-oss-id", AccessKeySecret: "fixture-oss-secret"}
	if _, err := f.service.connStore.Update(f.connectorID, connector.ConnectorMutations{ReplaceMediaStorage: true, MediaStorage: credential}); err != nil {
		t.Fatal(err)
	}
	host := newControlledRemoteMediaHost(false)
	f.service.remoteMediaHost = host
	t.Cleanup(func() { closeOnce(host.release) })
	response, err := f.service.SubmitLocalAppScenarioJob(submit, request)
	if err != nil {
		t.Fatal(err)
	}
	<-host.started
	id := response.Job.JobId
	assembly, ok := store.cloudResolvedAssembly(id)
	if !ok || assembly.Connector.MediaStorage == nil || len(assembly.VideoMediaReferences) != 2 || !bytes.Equal(assembly.VideoMediaReferences[1].Reference.Bytes, wav) {
		t.Fatal("lost frozen storage or audio custody")
	}
	result := nimillm.InputCleanupResult{State: "failed", Failed: 1, ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED}
	if err := store.recordInputCleanup(id, result); err != nil {
		t.Fatal(err)
	}
	if err := store.recordInputCleanup(id, nimillm.InputCleanupResult{State: "deleted", Deleted: 1, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}); err != nil {
		t.Fatal(err)
	}
	if store.currentInputCleanup(id).State != "failed" {
		t.Fatal("overwrote original cleanup disposition")
	}
	closeOnce(host.release)
	_ = waitForScenarioJobTerminalForLocalTextTest(t, f.service, id)
	waitCompletedScenarioJobCleanup(t, f.service, id)
	reopened, err := newScenarioJobStoreForLocalStatePathBeforeStartupPrune(path)
	if err != nil {
		t.Fatal(err)
	}
	if restored := reopened.currentInputCleanup(id); restored == nil || restored.State != "failed" {
		t.Fatal("cleanup disposition lost after restart", restored)
	}
	job, ok := reopened.get(id)
	if !ok || job.GetReasonMetadata().GetFields()["oss_input_cleanup"].GetStringValue() != "failed" {
		t.Fatal("cleanup failure hidden from Job read")
	}
}
