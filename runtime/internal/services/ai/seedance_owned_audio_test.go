package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestSeedanceLastFrameObservationFitsTheJobOutputSlots(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/contents/generations/tasks/original" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(404)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "original", "model": capabilitydriver.Seedance20VideoModel, "status": "succeeded", "content": map[string]any{"video_url": "https://media.example.test/video.mp4", "last_frame_url": "https://media.example.test/frame.jpg"}})
	}))
	defer server.Close()
	receipt := &nimillm.NativeTaskReceipt{Version: 1, Adapter: nimillm.AdapterBytedanceARKTask, TaskID: "original", Model: capabilitydriver.Seedance20VideoModel, QueryPathTemplate: "/contents/generations/tasks/{task_id}", Artifact: &runtimev1.ScenarioArtifact{ArtifactId: "original-output", MimeType: "video/mp4"}}
	observed, done, err := nimillm.ObserveNativeTask(context.Background(), nimillm.MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}, receipt)
	if err != nil || !done || len(observed.GetArtifacts()) != 2 {
		t.Fatalf("observation=%v done=%v err=%v", observed, done, err)
	}
	record := &scenarioJobRecord{job: &runtimev1.ScenarioJob{JobId: "original-job"}, nativeReceipt: receipt, nativeResult: observed}
	if err := validateNativeResult(record); err != nil {
		t.Fatalf("native descriptors cannot enter existing Job custody: %v", err)
	}
	observed.Artifacts[1].ArtifactId = "unbound-last-frame"
	if validateNativeResult(record) == nil {
		t.Fatal("foreign output slot accepted")
	}
}

func TestSeedanceOwnedAudioPublicBoundaryCaptureAndRestoration(t *testing.T) {
	sent := make(chan map[string]any, 1)
	unblock := make(chan struct{})
	release := sync.OnceFunc(func() { close(unblock) })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/contents/generations/tasks" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(404)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		sent <- body
		<-unblock
		// Stop honestly at the tested transport boundary; no fixture video.
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()
	defer release()
	f := newManagedCloudScenarioTestFixture(t, "volcengine", capabilitydriver.Seedance25VideoModel, server.URL, Config{AllowLoopbackEndpoint: true})
	target, _ := structpb.NewStruct(map[string]any{"provider": "volcengine", "providerModelId": capabilitydriver.Seedance25VideoModel, "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId()})
	intent := &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "video.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{ConnectorRef: f.connectorID, Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.video.generate.volcengine", DriverId: "nimi.runtime.driver.volcengine", DriverDialect: "provider/media-v1"}, ProviderModelTarget: target}}}
	if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.seedance", intent)); err != nil {
		t.Fatal(err)
	}
	decision := func(op accountservice.LocalAppOperation, capability, subject string) context.Context {
		return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.seedance", RegisteredAppSubject: subject, Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability})
	}
	upload := decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload, "seedance-subject")
	submit := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit, "seedance-subject")
	file := filepath.Join(t.TempDir(), "voice.wav")
	if err := writeLocalMusicTestWAV(file, 16000, 1, 4); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload, "foreign"), &runtimev1.UploadLocalAppArtifactRequest{Bytes: data, MimeType: "audio/wav"})
	if err != nil {
		t.Fatal(err)
	}
	request := func(id string) *runtimev1.SubmitLocalAppScenarioJobRequest {
		return &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VideoGenerate{VideoGenerate: &runtimev1.LocalAppVideoGenerateJobSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE, Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: id}}}, Options: &runtimev1.LocalAppVideoGenerationOptions{DurationSec: testInt32(4), Resolution: "480p"}}}}
	}
	for _, id := range []string{"missing", foreign.ArtifactId} {
		_, err := f.service.SubmitLocalAppScenarioJob(submit, request(id))
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
			t.Fatalf("owner boundary=%v %v", reason, err)
		}
	}
	if len(f.service.scenarioJobs.jobs) != 0 {
		t.Fatal("foreign audio published a Job")
	}
	owned, err := f.service.UploadLocalAppArtifact(upload, &runtimev1.UploadLocalAppArtifactRequest{Bytes: data, MimeType: "audio/wav"})
	if err != nil {
		t.Fatal(err)
	}
	response, err := f.service.SubmitLocalAppScenarioJob(submit, request(owned.ArtifactId))
	if err != nil {
		t.Fatal(err)
	}
	id := response.GetJob().GetJobId()
	select {
	case body := <-sent:
		parts := body["content"].([]any)
		if len(parts) != 1 || parts[0].(map[string]any)["audio_url"].(map[string]any)["url"] != "data:audio/wav;base64,"+base64.StdEncoding.EncodeToString(data) {
			t.Fatal("owned audio bytes or prompt omission changed")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("native request not reached")
	}
	assembly, _ := f.service.scenarioJobs.cloudResolvedAssembly(id)
	cloned, err := cloneCloudResolvedAssembly(assembly)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.service.runtimeArtifacts.Delete(owned.ArtifactId); err != nil {
		t.Fatal(err)
	}
	captured, err := f.service.cloudMediaEffectiveInputsFromResolvedAssembly(cloned)
	if err != nil {
		t.Fatal("restore reread current artifact inventory", err)
	}
	captured.release()
	cloned.VideoMediaReferences[0].ContentIndex++
	if validateCloudResolvedAssembly(cloned) == nil {
		t.Fatal("changed content position survived restoration")
	}
	release()
	deadline := time.Now().Add(3 * time.Second)
	for {
		job, _ := f.service.scenarioJobs.get(id)
		if job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("native fixture failure not preserved")
		}
		time.Sleep(time.Millisecond)
	}
	waitScenarioJobWorkExit(t, f.service.scenarioJobs, id)
}
