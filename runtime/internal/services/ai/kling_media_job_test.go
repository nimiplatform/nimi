package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
)

// Native HTTP/codec fixtures exercise the protected App journey, not live models.
func TestKlingProtectedMediaOriginalTasks(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("native video fixture requires ffmpeg")
	}
	video, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=1280x720:r=24:d=3", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000:duration=3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1").Output()
	if err != nil {
		t.Fatal(err)
	}
	var pixels bytes.Buffer
	if err := png.Encode(&pixels, image.NewRGBA(image.Rect(0, 0, 512, 512))); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		model        string
		mode         runtimev1.VideoMode
		edit, failed bool
	}{
		{"kling-4.0", runtimev1.VideoMode_VIDEO_MODE_T2V, false, false},
		{"kling-4.0", runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, false, false},
		{"kling-4.0", runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST, false, false},
		{"kling-4.0-flash", runtimev1.VideoMode_VIDEO_MODE_T2V, false, false},
		{"kling-4.0-flash", runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, false, false},
		{"kling-4.0", runtimev1.VideoMode_VIDEO_MODE_T2V, false, true},
		{"kling-v3", 0, false, false}, {"kling-v3", 0, true, false},
		{"kling-v3-omni", 0, false, false}, {"kling-v3-omni", 0, true, false},
	} {
		t.Run(tc.model+"/"+tc.mode.String()+map[bool]string{true: "/edit", false: ""}[tc.edit]+map[bool]string{true: "/failed", false: ""}[tc.failed], func(t *testing.T) {
			imageModel := capabilitydriver.IsKlingImageModel(tc.model)
			var creates, queries, downloads atomic.Int32
			var endpoint string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/result" {
					downloads.Add(1)
					if r.Header.Get("Authorization") != "" || r.Header.Get("x-api-key") != "" {
						t.Error("artifact credential leak")
					}
					if imageModel {
						w.Header().Set("Content-Type", "image/png")
						_, _ = w.Write(pixels.Bytes())
					} else {
						w.Header().Set("Content-Type", "video/mp4")
						_, _ = w.Write(video)
					}
					return
				}
				if r.Header.Get("Authorization") != "Bearer test-key" {
					t.Error("wrong captured credential")
				}
				w.Header().Set("Content-Type", "application/json")
				if r.Method == "POST" {
					creates.Add(1)
					var body map[string]any
					if json.NewDecoder(r.Body).Decode(&body) != nil {
						t.Error("invalid request")
						return
					}
					data := map[string]any{}
					if imageModel {
						path := "/proxy/anthropic/v1/images/generations"
						if tc.model == "kling-v3-omni" {
							path = "/proxy/anthropic/v1/images/omni-image"
							if body["result_type"] != "single" {
								t.Error("series selected")
							}
						}
						if r.URL.Path != path || body["model_name"] != tc.model || body["n"] != float64(2) || body["resolution"] != "1k" || body["aspect_ratio"] != "16:9" || body["seed"] != nil {
							t.Error("native image payload", r.URL.Path, body)
						}
						if tc.edit {
							want := base64.StdEncoding.EncodeToString(pixels.Bytes())
							if tc.model == "kling-v3" {
								if body["image"] != want {
									t.Error("owned source changed")
								}
							} else {
								list, ok := body["image_list"].([]any)
								if !ok || len(list) != 1 || list[0].(map[string]any)["image"] != want {
									t.Error("owned omni source changed")
								}
							}
						}
						data = map[string]any{"task_id": "original-image", "task_status": "submitted"}
					} else {
						path := "/proxy/anthropic/text-to-video/" + tc.model
						if tc.mode != runtimev1.VideoMode_VIDEO_MODE_T2V {
							path = "/proxy/anthropic/image-to-video/" + tc.model
						}
						settings, ok := body["settings"].(map[string]any)
						if !ok || r.URL.Path != path || settings["duration"] != float64(3) || settings["resolution"] != "720p" || body["model_name"] != nil || body["content"] != nil || body["negative_prompt"] != nil {
							t.Error("native video payload", r.URL.Path, body)
							return
						}
						if tc.mode == runtimev1.VideoMode_VIDEO_MODE_T2V {
							if body["prompt"] != "A blue cup" || settings["aspect_ratio"] != "16:9" {
								t.Error("text controls lost")
							}
						} else {
							parts, ok := body["contents"].([]any)
							count := 2
							if tc.mode == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST {
								count = 3
							}
							if !ok || len(parts) != count || settings["aspect_ratio"] != nil {
								t.Error("native frame count or unsupported ratio")
								return
							}
							for i, raw := range parts[1:] {
								p := raw.(map[string]any)
								role := "first_frame"
								if i == 1 {
									role = "last_frame"
								}
								if p["type"] != role || p["id"] != role || p["url"] != base64.StdEncoding.EncodeToString(pixels.Bytes()) {
									t.Error("frame role or original bytes lost")
								}
							}
						}
						data = map[string]any{"id": "original-video", "status": "submitted"}
						if tc.failed {
							data["status"] = "failed"
						}
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": data})
					return
				}
				queries.Add(1)
				if imageModel {
					path := "/proxy/anthropic/v1/images/generations/original-image"
					if tc.model == "kling-v3-omni" {
						path = "/proxy/anthropic/v1/images/omni-image/original-image"
					}
					if r.URL.Path != path {
						t.Error("wrong image task query", r.URL.Path)
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": map[string]any{"task_id": "original-image", "task_status": "succeed", "task_result": map[string]any{"images": []any{map[string]any{"url": endpoint + "/result"}, map[string]any{"url": endpoint + "/result"}}}}})
				} else {
					if r.URL.Path != "/proxy/anthropic/tasks" || r.URL.Query().Get("task_ids") != "original-video" {
						t.Error("wrong original video query", r.URL.String())
					}
					state := "succeeded"
					if tc.failed {
						state = "failed"
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": []any{map[string]any{"id": "original-video", "status": state, "outputs": []any{map[string]any{"type": "video", "url": endpoint + "/result"}}}}})
				}
			}))
			defer server.Close()
			endpoint = server.URL
			f := newManagedCloudScenarioTestFixture(t, "kling", tc.model, endpoint+"/proxy/anthropic/v1", Config{AllowLoopbackEndpoint: true})
			capability := "video.generate"
			if imageModel {
				capability = "image.generate"
			}
			intent := cloudVoiceAIConfigIntent(t, f.connectorID, f.descriptor)
			intent.CapabilityContract = capability
			intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud." + capability + ".kling", DriverId: "nimi.runtime.driver.kling", DriverDialect: "provider/media-v1"}
			if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.kling", intent)); err != nil {
				t.Fatal(err)
			}
			decision := func(op accountservice.LocalAppOperation, cap string) context.Context {
				return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.kling", RegisteredAppSubject: "kling-subject", Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: cap})
			}
			ctx := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit)
			request := &runtimev1.SubmitLocalAppScenarioJobRequest{}
			if imageModel {
				s := &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "A blue cup", N: proto.Int32(2)}
				if tc.edit {
					uploaded, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{MimeType: "image/png", Bytes: pixels.Bytes()})
					if err != nil {
						t.Fatal(err)
					}
					s.ReferenceImageArtifactId = uploaded.GetArtifactId()
				}
				request.Spec = &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{ImageGenerate: s}
			} else {
				s := &runtimev1.LocalAppVideoGenerateJobSpec{Mode: tc.mode, Prompt: "A blue cup", Options: &runtimev1.LocalAppVideoGenerationOptions{DurationSec: proto.Int32(3), Resolution: "720p"}}
				if tc.mode != runtimev1.VideoMode_VIDEO_MODE_T2V {
					uploaded, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{MimeType: "image/png", Bytes: pixels.Bytes()})
					if err != nil {
						t.Fatal(err)
					}
					roles := []runtimev1.VideoContentRole{runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME}
					if tc.mode == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST {
						roles = append([]runtimev1.VideoContentRole{runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME}, roles...)
					}
					for _, role := range roles {
						s.Content = append(s.Content, &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: role, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: uploaded.GetArtifactId()}})
					}
				}
				request.Spec = &runtimev1.SubmitLocalAppScenarioJobRequest_VideoGenerate{VideoGenerate: s}
			}
			bad := proto.Clone(request).(*runtimev1.SubmitLocalAppScenarioJobRequest)
			if imageModel {
				bad.GetImageGenerate().Seed = proto.Int64(123)
			} else {
				bad.GetVideoGenerate().Options.Seed = proto.Int64(123)
			}
			if _, err := f.service.SubmitLocalAppScenarioJob(ctx, bad); err == nil || creates.Load() != 0 {
				t.Fatal("unsupported seed dispatched", err)
			}
			submitted, err := f.service.SubmitLocalAppScenarioJob(ctx, request)
			if err != nil {
				t.Fatal(err)
			}
			var job *runtimev1.LocalAppScenarioJob
			get := decision(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet)
			deadline := time.Now().Add(10 * time.Second)
			for time.Now().Before(deadline) {
				response, err := f.service.GetLocalAppScenarioJob(get, &runtimev1.GetLocalAppScenarioJobRequest{JobId: submitted.GetJob().GetJobId()})
				if err != nil {
					t.Fatal(err)
				}
				job = response.Job
				if isTerminalScenarioJobStatus(job.GetStatus()) {
					break
				}
				time.Sleep(20 * time.Millisecond)
			}
			if tc.failed {
				if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || downloads.Load() != 0 {
					t.Fatal(job)
				}
				if receipt := f.service.scenarioJobs.originalNativeReceipt(job.GetJobId()); receipt == nil || receipt.TaskID != "original-video" {
					t.Fatal("failed original task lost")
				}
				return
			}
			want := 1
			if imageModel {
				want = 2
			}
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(job.GetArtifacts()) != want || creates.Load() != 1 || queries.Load() < 1 || downloads.Load() != int32(want) {
				t.Fatal(job, creates.Load(), queries.Load(), downloads.Load())
			}
			for _, a := range job.GetArtifacts() {
				if a.GetSizeBytes() <= 0 || a.GetSha256() == "" || !strings.HasPrefix(a.GetMimeType(), map[bool]string{true: "image/", false: "video/"}[imageModel]) {
					t.Fatal("unowned result", a)
				}
			}
		})
	}
}
