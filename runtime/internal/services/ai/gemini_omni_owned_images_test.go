package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
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
	"google.golang.org/protobuf/types/known/structpb"
)

func TestGeminiOmniPublicOwnedImagesCaptureOrderAndRejectForeignOwners(t *testing.T) {
	for _, mode := range []runtimev1.VideoMode{runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST, runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE} {
		t.Run(mode.String(), func(t *testing.T) {
			var creates atomic.Int32
			expected := []string{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodDelete {
					w.WriteHeader(200)
					return
				}
				if r.Method != "POST" || r.URL.Path != "/interactions" {
					t.Errorf("unexpected IO: %s %s", r.Method, r.URL.Path)
					w.WriteHeader(404)
					return
				}
				creates.Add(1)
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				input := body["input"].([]any)
				if len(input) != len(expected)+1 {
					t.Errorf("input count=%d", len(input))
				} else {
					for i, want := range expected {
						if input[i].(map[string]any)["data"] != want {
							t.Errorf("image %d changed bytes or order", i)
						}
					}
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"id": "v1_owned", "object": "interaction", "model": capabilitydriver.GeminiOmniVideoModel, "status": "completed",
					"steps": []any{map[string]any{"type": "model_output", "content": []any{map[string]any{"type": "video", "mime_type": "video/mp4", "uri": "https://generativelanguage.googleapis.com/v1beta/files/ownedvideo:download?alt=media"}}}}})
			}))
			defer server.Close()
			f := newManagedCloudScenarioTestFixture(t, "gemini", capabilitydriver.GeminiOmniVideoModel, server.URL, Config{AllowLoopbackEndpoint: true})
			target, _ := structpb.NewStruct(map[string]any{"provider": "gemini", "providerModelId": capabilitydriver.GeminiOmniVideoModel, "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId()})
			intent := &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "video.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{ConnectorRef: f.connectorID, Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.video.generate.gemini", DriverId: "nimi.runtime.driver.gemini", DriverDialect: "provider/media-v1"}, ProviderModelTarget: target}}}
			if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.omni", intent)); err != nil {
				t.Fatal(err)
			}
			decision := func(operation accountservice.LocalAppOperation, capability, subject string) context.Context {
				return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.omni", RegisteredAppSubject: subject, Operation: operation, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability})
			}
			submit := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit, "omni-subject")
			upload := decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload, "omni-subject")
			imageItem := func(id string, role runtimev1.VideoContentRole) *runtimev1.VideoContentItem {
				return &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: role, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: id}}
			}
			request := func(mode runtimev1.VideoMode, items []*runtimev1.VideoContentItem) *runtimev1.SubmitLocalAppScenarioJobRequest {
				return &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VideoGenerate{VideoGenerate: &runtimev1.LocalAppVideoGenerateJobSpec{Mode: mode, Prompt: "Animate the images.", Content: items, Options: &runtimev1.LocalAppVideoGenerationOptions{DurationSec: testInt32(3), Resolution: "720p"}}}}
			}
			foreign, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload, "foreign-subject"), &runtimev1.UploadLocalAppArtifactRequest{Bytes: l1CarrierPNGBytes(t), MimeType: "image/png"})
			if err != nil {
				t.Fatal(err)
			}
			for _, id := range []string{"artifact_missing", foreign.ArtifactId} {
				_, err := f.service.SubmitLocalAppScenarioJob(submit, request(runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, []*runtimev1.VideoContentItem{imageItem(id, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME)}))
				if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
					t.Fatalf("owner boundary reason=%v err=%v", reason, err)
				}
			}
			if creates.Load() != 0 || len(f.service.scenarioJobs.jobs) != 0 {
				t.Fatal("foreign image reached dispatch or Job publication")
			}
			count := 2
			if mode == runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE {
				count = 6
			}
			var content []*runtimev1.VideoContentItem
			for i := 0; i < count; i++ {
				picture := image.NewRGBA(image.Rect(0, 0, 2, 2))
				picture.Set(0, 0, color.RGBA{R: uint8(i * 30), B: 200, A: 255})
				var encoded bytes.Buffer
				if err := png.Encode(&encoded, picture); err != nil {
					t.Fatal(err)
				}
				asset, err := f.service.UploadLocalAppArtifact(upload, &runtimev1.UploadLocalAppArtifactRequest{Bytes: encoded.Bytes(), MimeType: "image/png"})
				if err != nil {
					t.Fatal(err)
				}
				expected = append(expected, base64.StdEncoding.EncodeToString(encoded.Bytes()))
				role := runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE
				if mode == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST {
					role = runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME
					if i == 1 {
						role = runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME
					}
				}
				content = append(content, imageItem(asset.ArtifactId, role))
			}
			if mode == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST {
				content[0], content[1] = content[1], content[0]
			}
			response, err := f.service.SubmitLocalAppScenarioJob(submit, request(mode, content))
			if err != nil {
				t.Fatal(err)
			}
			id := response.GetJob().GetJobId()
			deadline := time.Now().Add(3 * time.Second)
			for f.service.scenarioJobs.originalNativeReceipt(id) == nil {
				if time.Now().After(deadline) {
					job, _ := f.service.scenarioJobs.get(id)
					t.Fatalf("receipt missing: %v", job)
				}
				time.Sleep(time.Millisecond)
			}
			waitScenarioJobWorkExit(t, f.service.scenarioJobs, id)
			assembly, _ := f.service.scenarioJobs.cloudResolvedAssembly(id)
			cloned, err := cloneCloudResolvedAssembly(assembly)
			if err != nil {
				t.Fatal(err)
			}
			for _, ref := range cloned.VideoMediaReferences {
				if err := f.service.runtimeArtifacts.Delete(ref.Reference.ArtifactID); err != nil {
					t.Fatal(err)
				}
			}
			captured, err := f.service.cloudMediaEffectiveInputsFromResolvedAssembly(cloned)
			if err != nil {
				t.Fatal("captured images reread current inventory", err)
			}
			captured.release()
			cloned.VideoMediaReferences[0].ContentIndex++
			if err := validateCloudResolvedAssembly(cloned); err == nil {
				t.Fatal("changed captured image position accepted")
			}
			cancel := decision(accountservice.LocalAppOperationScenarioJobCancel, localappop.AppOperationIDScenarioJobCancel, "omni-subject")
			if _, err := f.service.CancelLocalAppScenarioJob(cancel, &runtimev1.CancelLocalAppScenarioJobRequest{JobId: id}); err != nil {
				t.Fatal(err)
			}
			if creates.Load() != 1 {
				t.Fatal("creation replayed")
			}
		})
	}
}
