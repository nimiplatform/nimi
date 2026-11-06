package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestTogetherProtectedVideoOriginalJobAndCredentialFreeArtifact(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("native video fixture requires ffmpeg")
	}
	file := filepath.Join(t.TempDir(), "video.mp4")
	if out, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=1280x720:r=30:d=2", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000:duration=2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", file).CombinedOutput(); err != nil {
		t.Fatalf("codec fixture %v %s", err, out)
	}
	video, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		mode   runtimev1.VideoMode
		failed bool
	}{{runtimev1.VideoMode_VIDEO_MODE_T2V, false}, {runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, false}, {runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST, false}, {runtimev1.VideoMode_VIDEO_MODE_T2V, true}} {
		t.Run(tc.mode.String()+map[bool]string{true: "/upstream-failed", false: "/completed"}[tc.failed], func(t *testing.T) {
			model := "Wan-AI/wan2.7-t2v"
			if tc.mode != runtimev1.VideoMode_VIDEO_MODE_T2V {
				model = "Wan-AI/wan2.7-i2v"
			}
			var creates, downloads atomic.Int32
			picture := l1CarrierPNGBytes(t)
			var endpoint string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/result.mp4" {
					downloads.Add(1)
					if r.Header.Get("Authorization") != "" || r.Header.Get("x-api-key") != "" {
						t.Error("provider credential leaked to artifact URL")
					}
					w.Header().Set("Content-Type", "video/mp4")
					w.Write(video)
					return
				}
				if r.Header.Get("Authorization") != "Bearer test-key" {
					t.Error("original task credential missing")
				}
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/proxy/v2/videos":
					creates.Add(1)
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						return
					}
					if body["model"] != model || body["seconds"] != "2" || body["resolution"] != "720P" || body["fps"] != float64(30) || body["generate_audio"] != true {
						t.Error("native controls changed", body)
					}
					if tc.mode == runtimev1.VideoMode_VIDEO_MODE_T2V {
						if body["media"] != nil {
							t.Error("unexpected conditioning")
						}
					} else {
						frames := body["media"].(map[string]any)["frame_images"].([]any)
						want := 1
						if tc.mode == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST {
							want = 2
						}
						if len(frames) != want {
							t.Error("frame count", len(frames))
						}
						for i, raw := range frames {
							frame := raw.(map[string]any)
							role := "first"
							if i == 1 {
								role = "last"
							}
							if frame["frame"] != role || frame["input_image"] != base64.StdEncoding.EncodeToString(picture) {
								t.Error("owned frame bytes or role changed")
							}
						}
					}
					state := "in_progress"
					if tc.failed {
						state = "failed"
					}
					w.WriteHeader(202)
					_ = json.NewEncoder(w).Encode(map[string]any{"id": "original-task", "model": model, "status": state})
				case "/proxy/v2/videos/original-task":
					state := "completed"
					if tc.failed {
						state = "failed"
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"id": "original-task", "model": model, "status": state, "outputs": map[string]any{"video_url": endpoint + "/result.mp4", "cost": 1}})
				default:
					t.Error("unexpected task path", r.URL.Path)
					w.WriteHeader(404)
				}
			}))
			defer server.Close()
			endpoint = server.URL
			f := newManagedCloudScenarioTestFixture(t, "together", model, server.URL+"/proxy/v1", Config{AllowLoopbackEndpoint: true})
			target, _ := structpb.NewStruct(map[string]any{"provider": "together", "providerModelId": model, "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId()})
			intent := &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "video.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{ConnectorRef: f.connectorID, Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.video.generate.together", DriverId: "nimi.runtime.driver.together", DriverDialect: "provider/media-v1"}, ProviderModelTarget: target}}}
			if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.together", intent)); err != nil {
				t.Fatal(err)
			}
			decision := func(op accountservice.LocalAppOperation, capability, subject string) context.Context {
				return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.together", RegisteredAppSubject: subject, Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability})
			}
			submit := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit, "together-subject")
			get := decision(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet, "together-subject")
			request := &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VideoGenerate{VideoGenerate: &runtimev1.LocalAppVideoGenerateJobSpec{Mode: tc.mode, Prompt: "Animate the blue scene.", Options: &runtimev1.LocalAppVideoGenerationOptions{DurationSec: proto.Int32(2), Resolution: "720p"}}}}
			if tc.mode != runtimev1.VideoMode_VIDEO_MODE_T2V {
				asset, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload, "together-subject"), &runtimev1.UploadLocalAppArtifactRequest{Bytes: picture, MimeType: "image/png"})
				if err != nil {
					t.Fatal(err)
				}
				roles := []runtimev1.VideoContentRole{runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME}
				if tc.mode == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST {
					roles = append(roles, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME)
				}
				for _, role := range roles {
					request.GetVideoGenerate().Content = append(request.GetVideoGenerate().Content, &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: role, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: asset.ArtifactId}})
				}
				foreign := proto.Clone(request).(*runtimev1.SubmitLocalAppScenarioJobRequest)
				foreign.GetVideoGenerate().Content[0].ArtifactRef.ArtifactId = "artifact_missing"
				if _, err := f.service.SubmitLocalAppScenarioJob(submit, foreign); err == nil {
					t.Fatal("unowned frame accepted")
				} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
					t.Fatal(err)
				}
				if creates.Load() != 0 {
					t.Fatal("unowned frame dispatched")
				}
			}
			response, err := f.service.SubmitLocalAppScenarioJob(submit, request)
			if err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(10 * time.Second)
			var job *runtimev1.LocalAppScenarioJob
			for time.Now().Before(deadline) {
				r, err := f.service.GetLocalAppScenarioJob(get, &runtimev1.GetLocalAppScenarioJobRequest{JobId: response.GetJob().GetJobId()})
				if err != nil {
					t.Fatal(err)
				}
				job = r.Job
				if isTerminalScenarioJobStatus(job.GetStatus()) {
					break
				}
				time.Sleep(20 * time.Millisecond)
			}
			if creates.Load() != 1 {
				t.Fatal("original task replayed", creates.Load())
			}
			if tc.failed {
				if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || downloads.Load() != 0 {
					t.Fatal(job, downloads.Load())
				}
			} else if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(job.GetArtifacts()) != 1 || job.Artifacts[0].GetSizeBytes() != int64(len(video)) || downloads.Load() != 1 {
				t.Fatal(job, downloads.Load())
			}
		})
	}
}
