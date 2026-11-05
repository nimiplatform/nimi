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

	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestCurrentCloudPublicOwnedFramesCaptureOrderAndRejectForeignOwners(t *testing.T) {
	for _, candidate := range []struct{ provider, model, path, auth string }{{"flux", "flux-3-video", "/v1/flux-3-video", "x-key"}, {"luma", "ray-3.2", "/v1/generations", "Authorization"}} {
		t.Run(candidate.model, func(t *testing.T) {
			mode := runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST
			var creates atomic.Int32
			expected := []string{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.URL.Path != candidate.path || r.Header.Get(candidate.auth) == "" {
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
				var input []any
				if candidate.provider == "luma" {
					frames := body["video"].(map[string]any)["keyframes"].([]any)
					for _, f := range frames {
						input = append(input, f.(map[string]any)["data"])
					}
				} else {
					input = body["keyframes"].([]any)
				}
				if len(input) != len(expected) {
					t.Errorf("input count=%d", len(input))
				} else {
					for i, want := range expected {
						if input[i] != want {
							t.Errorf("image %d changed bytes or order", i)
						}
					}
				}
				// Deliberately fail after capturing the real transport projection;
				// an HTTP fixture cannot establish generated-video acceptance.
				w.WriteHeader(http.StatusUnauthorized)

			}))
			defer server.Close()
			f := newManagedCloudScenarioTestFixture(t, candidate.provider, candidate.model, server.URL, Config{AllowLoopbackEndpoint: true})
			target, _ := structpb.NewStruct(map[string]any{"provider": candidate.provider, "providerModelId": candidate.model, "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId()})
			intent := &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "video.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{ConnectorRef: f.connectorID, Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.video.generate." + candidate.provider, DriverId: "nimi.runtime.driver." + candidate.provider, DriverDialect: "provider/media-v1"}, ProviderModelTarget: target}}}
			if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.frame-custody", intent)); err != nil {
				t.Fatal(err)
			}
			decision := func(operation accountservice.LocalAppOperation, capability, subject string) context.Context {
				return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.frame-custody", RegisteredAppSubject: subject, Operation: operation, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability})
			}
			submit := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit, "frame-subject")
			upload := decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload, "frame-subject")
			imageItem := func(id string, role runtimev1.VideoContentRole) *runtimev1.VideoContentItem {
				return &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: role, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: id}}
			}
			request := func(mode runtimev1.VideoMode, items []*runtimev1.VideoContentItem) *runtimev1.SubmitLocalAppScenarioJobRequest {
				return &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VideoGenerate{VideoGenerate: &runtimev1.LocalAppVideoGenerateJobSpec{Mode: mode, Prompt: "Animate the images.", Content: items, Options: &runtimev1.LocalAppVideoGenerationOptions{DurationSec: testInt32(5), Resolution: "720p"}}}}
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
			var content []*runtimev1.VideoContentItem
			for i := 0; i < count; i++ {
				picture := image.NewRGBA(image.Rect(0, 0, 400, 400))
				for y := 0; y < 400; y++ {
					for x := 0; x < 400; x++ {
						picture.Set(x, y, color.RGBA{R: uint8(i * 20), B: 200, A: 255})
					}
				}
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
			job, _ := f.service.scenarioJobs.get(id)
			for job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED && time.Now().Before(deadline) {
				time.Sleep(time.Millisecond)
				job, _ = f.service.scenarioJobs.get(id)
			}
			waitScenarioJobWorkExit(t, f.service.scenarioJobs, id)
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
				t.Fatalf("fixture must fail honestly: %v", job)
			}

			if creates.Load() != 1 {
				t.Fatal("creation replayed")
			}
		})
	}
}
