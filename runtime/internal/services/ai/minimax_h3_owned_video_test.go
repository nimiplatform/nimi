package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestMiniMaxH3OwnedVideoPublicBoundaryCaptureAndRestoration(t *testing.T) {
	sent := make(chan map[string]any, 1)
	unblock := make(chan struct{})
	release := sync.OnceFunc(func() { close(unblock) })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/v2/video_generation" {
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
	f := newManagedCloudScenarioTestFixture(t, "minimax", "MiniMax-H3", server.URL, Config{AllowLoopbackEndpoint: true})
	target, _ := structpb.NewStruct(map[string]any{"provider": "minimax", "providerModelId": "MiniMax-H3", "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId()})
	intent := &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "video.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{ConnectorRef: f.connectorID, Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.video.generate.minimax", DriverId: "nimi.runtime.driver.minimax", DriverDialect: "provider/media-v1"}, ProviderModelTarget: target}}}
	if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.minimax-h3", intent)); err != nil {
		t.Fatal(err)
	}
	decision := func(op accountservice.LocalAppOperation, capability, subject string) context.Context {
		return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.minimax-h3", RegisteredAppSubject: subject, Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability})
	}
	upload := decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload, "h3-subject")
	submit := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit, "h3-subject")
	// Minimal container envelope for custody and exact byte projection;
	// the HTTP fixture fails intentionally and cannot certify video decoding.
	data := []byte("\x00\x00\x00\x10ftypisom0000\x00\x00\x00\x09moovx\x00\x00\x00\x09mdatx")

	foreign, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload, "foreign"), &runtimev1.UploadLocalAppArtifactRequest{Bytes: data, MimeType: "video/mp4"})
	if err != nil {
		t.Fatal(err)
	}
	request := func(id string) *runtimev1.SubmitLocalAppScenarioJobRequest {
		return &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VideoGenerate{VideoGenerate: &runtimev1.LocalAppVideoGenerateJobSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE, Prompt: "Animate this video.", Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: id}}}, Options: &runtimev1.LocalAppVideoGenerationOptions{}}}}
	}
	for _, id := range []string{"missing", foreign.ArtifactId} {
		_, err := f.service.SubmitLocalAppScenarioJob(submit, request(id))
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
			t.Fatalf("owner boundary=%v %v", reason, err)
		}
	}
	if len(f.service.scenarioJobs.jobs) != 0 {
		t.Fatal("foreign video published a Job")
	}
	owned, err := f.service.UploadLocalAppArtifact(upload, &runtimev1.UploadLocalAppArtifactRequest{Bytes: data, MimeType: "video/mp4"})
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
		if len(parts) != 2 || parts[0].(map[string]any)["text"] != "Animate this video." || parts[1].(map[string]any)["video_url"].(map[string]any)["url"] != "data:video/mp4;base64,"+base64.StdEncoding.EncodeToString(data) {
			t.Fatal("owned video bytes or prompt changed")
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
