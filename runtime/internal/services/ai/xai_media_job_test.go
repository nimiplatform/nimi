package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/proto"
)

func TestXAIImageJobDoesNotPublishPartialBatchAndKeepsOriginalGeneration(t *testing.T) {
	var creates, queries, downloads atomic.Int32
	var partial atomic.Bool
	partial.Store(true)
	data := l1CarrierPNGBytes(t)
	var endpoint string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/one.png" || r.URL.Path == "/two.png" {
			downloads.Add(1)
			if r.Header.Get("Authorization") != "" {
				t.Error("credential sent to output URL")
			}
			w.Header().Set("Content-Type", "image/png")
			w.Write(data)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method == "POST" {
			creates.Add(1)
			json.NewEncoder(w).Encode(map[string]any{"request_id": "original_images"})
			return
		}
		queries.Add(1)
		outputs := []any{map[string]any{"url": endpoint + "/one.png"}}
		if !partial.Load() {
			outputs = append(outputs, map[string]any{"url": endpoint + "/two.png"})
		}
		json.NewEncoder(w).Encode(map[string]any{"request_id": "original_images", "status": "done", "data": outputs})
	}))
	defer server.Close()
	endpoint = server.URL
	f := newManagedCloudScenarioTestFixture(t, "xai", capabilitydriver.XAIImage2Model, server.URL+"/v1", Config{AllowLoopbackEndpoint: true})
	owner := scenarioJobUserContext("app-1", "user-001")
	request := &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app-1", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "a boat", N: proto.Int32(2)}}}}
	submitted, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "image.generate", f.targetRef), request)
	if err != nil {
		t.Fatal(err)
	}
	id := submitted.GetJob().GetJobId()
	waitNativeReceiptHandoff(t, f.service, id)
	_, _ = f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id})
	first, _ := f.service.scenarioJobs.get(id)
	if first.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(first.GetArtifacts()) != 0 || downloads.Load() != 0 {
		t.Fatal("partial image set was published")
	}
	partial.Store(false)
	deadline := time.Now().Add(8 * time.Second)
	var completed *runtimev1.ScenarioJob
	for time.Now().Before(deadline) {
		response, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id})
		if err != nil {
			t.Fatal(err)
		}
		completed = response.GetJob()
		if isTerminalScenarioJobStatus(completed.GetStatus()) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if completed.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(completed.GetArtifacts()) != 2 || creates.Load() != 1 || queries.Load() < 2 || downloads.Load() != 2 {
		t.Fatalf("original batch result %+v calls=%d/%d/%d", completed, creates.Load(), queries.Load(), downloads.Load())
	}
	for _, artifact := range completed.GetArtifacts() {
		if artifact.GetUri() != "" || artifact.GetMimeType() != "image/png" || artifact.GetWidth() <= 0 || artifact.GetHeight() <= 0 {
			t.Fatalf("public provider URL or wrong image type: %+v", artifact)
		}
	}
}

func TestXAIProtectedVideoCapturesFourteenOwnedReferencesAndRejectsForeignSubject(t *testing.T) {
	var creates atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == "POST" {
			creates.Add(1)
			var body map[string]any
			json.NewDecoder(r.Body).Decode(&body)
			if len(body["reference_images"].([]any)) != 14 || body["model"] != capabilitydriver.XAIVideo15Model {
				t.Error("reference set or model lost")
			}
			json.NewEncoder(w).Encode(map[string]any{"request_id": "video14"})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"status": "pending"})
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "xai", capabilitydriver.XAIVideo15Model, server.URL+"/v1", Config{AllowLoopbackEndpoint: true})
	intent := cloudVoiceAIConfigIntent(t, f.connectorID, f.descriptor)
	intent.CapabilityContract = "video.generate"
	intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.video.generate.xai", DriverId: "nimi.runtime.driver.xai", DriverDialect: "provider/media-v1"}
	if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.xai-video", intent)); err != nil {
		t.Fatal(err)
	}
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.xai-video", RegisteredAppSubject: "xai-subject", Operation: accountservice.LocalAppOperationScenarioJobSubmit, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: localappop.AppOperationIDScenarioJobSubmit})
	owner := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", AppID: "app.xai-video", RegisteredAppSubject: "xai-subject"}
	foreign := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", AppID: owner.AppID, RegisteredAppSubject: "another-subject"}
	bytes := l1CarrierPNGBytes(t)
	putImageArtifactRecordForTest(t, f.service, "source", owner, "image/png", bytes)
	putImageArtifactRecordForTest(t, f.service, "foreign", foreign, "image/png", bytes)
	request := func(id string) *runtimev1.SubmitLocalAppScenarioJobRequest {
		content := []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: "A boat in motion"}}
		for i := 0; i < 14; i++ {
			source := "source"
			if i == 13 {
				source = id
			}
			content = append(content, &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: source}})
		}
		return &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VideoGenerate{VideoGenerate: &runtimev1.LocalAppVideoGenerateJobSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE, Content: content, Options: &runtimev1.LocalAppVideoGenerationOptions{DurationSec: proto.Int32(8), Resolution: "720p"}}}}
	}
	if _, err := f.service.SubmitLocalAppScenarioJob(ctx, request("foreign")); err == nil {
		t.Fatal("foreign reference accepted")
	} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
		t.Fatal(err)
	}
	if creates.Load() != 0 {
		t.Fatal("foreign source dispatched")
	}
	submitted, err := f.service.SubmitLocalAppScenarioJob(ctx, request("source"))
	if err != nil {
		t.Fatal(err)
	}
	id := submitted.GetJob().GetJobId()
	waitNativeReceiptHandoff(t, f.service, id)
	assembly, ok := f.service.scenarioJobs.cloudResolvedAssembly(id)
	if !ok || len(assembly.VideoMediaReferences) != 14 || creates.Load() != 1 {
		t.Fatal("owned reference capture missing")
	}
	if err := f.service.runtimeArtifacts.Delete("source"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.cloudMediaEffectiveInputsFromResolvedAssembly(assembly); err != nil {
		t.Fatal("captured reference depended on original artifact", err)
	}
	if _, err := f.service.CancelScenarioJob(scenarioJobUserContext("app.xai-video", "user-001"), &runtimev1.CancelScenarioJobRequest{JobId: id}); err != nil {
		t.Fatal(err)
	}
}
