package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
)

func TestPikaProtectedVideoExactOperations(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("native MP4 fixture requires ffmpeg")
	}
	video, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=1920x1080:r=24:d=5", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000:duration=5", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1").Output()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		model       string
		mode        runtimev1.VideoMode
		httpFailure int
	}{
		{"pika/pika-2.5/text-to-video", runtimev1.VideoMode_VIDEO_MODE_T2V, 0},
		{"pika/pika-2.5/image-to-video", runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, 0},
		{"pika/pika-h3-flex/text-to-video", runtimev1.VideoMode_VIDEO_MODE_T2V, 0},
		{"pika/pika-h3-flex/image-to-video", runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, 0},
		{"pika/pika-h3-flex/image-to-video", runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST, 0},
		{"pika/pika-h3-flex/reference-to-video", runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE, 0},
		{"pika/pika-h3-flex/text-to-video", runtimev1.VideoMode_VIDEO_MODE_T2V, 403},
		{"pika/pika-h3-flex/text-to-video", runtimev1.VideoMode_VIDEO_MODE_T2V, 429},
	} {
		t.Run(tc.model+"/"+tc.mode.String()+http.StatusText(tc.httpFailure), func(t *testing.T) {
			flex := strings.Contains(tc.model, "h3-flex")
			var creates, queries, downloads atomic.Int32
			var endpoint string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/video" {
					downloads.Add(1)
					if r.Header.Get("Authorization") != "" || r.Header.Get("x-api-key") != "" {
						t.Error("artifact credential leak")
					}
					w.Header().Set("Content-Type", "video/mp4")
					_, _ = w.Write(video)
					return
				}
				if r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("x-api-key") != "" {
					t.Error("captured credential changed")
				}
				w.Header().Set("Content-Type", "application/json")
				if r.Method == "POST" {
					creates.Add(1)
					var b map[string]any
					if json.NewDecoder(r.Body).Decode(&b) != nil {
						t.Error("invalid JSON")
						return
					}
					if r.URL.Path != "/proxy/anthropic/v1/media/"+tc.model || b["prompt"] != "A blue cup" || b["resolution"] != "1080p" || b["seed"] != float64(0) || b["model"] != nil || b["content"] != nil {
						t.Error("operation or canonical controls lost", r.URL.Path, b)
					}
					if flex {
						if b["duration"] != float64(5) || b["duration_s"] != nil || b["rewrite"] != false || b["output_mode"] != "video" {
							t.Error("Flex native controls", b)
						}
					} else if b["duration_s"] != float64(5) || b["duration"] != nil || b["rewrite"] != nil {
						t.Error("2.5 native controls", b)
					}
					switch tc.mode {
					case runtimev1.VideoMode_VIDEO_MODE_T2V:
						if b["image"] != nil || b["references"] != nil {
							t.Error("invented conditioning")
						}
					case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST:
						if b["image"] != "https://example.com/first.png" {
							t.Error("first frame lost")
						}
						if tc.mode == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST && b["last_frame_image"] != "https://example.com/last.png" {
							t.Error("last frame lost")
						}
						if !flex && b["aspect_ratio"] != nil {
							t.Error("2.5 I2V unsupported ratio")
						}
					case runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE:
						refs, ok := b["references"].([]any)
						if !ok || len(refs) != 3 {
							t.Error("reference count")
							return
						}
						for i, kind := range []string{"video", "image", "audio"} {
							if refs[i].(map[string]any)["type"] != kind {
								t.Error("reference order or type lost")
							}
						}
					}
					state := "queued"
					if tc.httpFailure != 0 {
						state = "failed"
						w.WriteHeader(tc.httpFailure)
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"id": "media_original", "status": state, "error": map[string]any{"code": "insufficient_balance"}})
					return
				}
				queries.Add(1)
				if r.URL.Path != "/proxy/anthropic/v1/media/jobs/media_original" {
					t.Error("wrong original job query")
				}
				state := "completed"
				if tc.httpFailure != 0 {
					state = "failed"
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"id": "media_original", "status": state, "error": map[string]any{"code": "insufficient_balance"}, "output": map[string]any{"media_type": "video", "video": map[string]any{"url": endpoint + "/video"}}, "usage": map[string]any{"output_seconds": 5, "video_output_tokens": 42}, "billing": map[string]any{"state": "settled", "charge_micro_usd": 0}})
			}))
			defer server.Close()
			endpoint = server.URL
			f := newManagedCloudScenarioTestFixture(t, "pika", tc.model, endpoint+"/proxy/anthropic/v1", Config{AllowLoopbackEndpoint: true})
			intent := cloudVoiceAIConfigIntent(t, f.connectorID, f.descriptor)
			intent.CapabilityContract = "video.generate"
			intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.video.generate.pika", DriverId: "nimi.runtime.driver.pika", DriverDialect: "provider/media-v1"}
			if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.pika", intent)); err != nil {
				t.Fatal(err)
			}
			decision := func(op accountservice.LocalAppOperation, cap string) context.Context {
				return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.pika", RegisteredAppSubject: "pika-subject", Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: cap})
			}
			s := &runtimev1.LocalAppVideoGenerateJobSpec{Mode: tc.mode, Prompt: "A blue cup", Options: &runtimev1.LocalAppVideoGenerationOptions{DurationSec: proto.Int32(5), Resolution: "1080p", Seed: proto.Int64(0)}}
			frame := func(role runtimev1.VideoContentRole, uri string) *runtimev1.VideoContentItem {
				return &runtimev1.VideoContentItem{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: role, ImageUrl: &runtimev1.VideoContentImageURL{Url: uri}}
			}
			if tc.mode == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME || tc.mode == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST {
				s.Content = append(s.Content, frame(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, "https://example.com/first.png"))
				if tc.mode == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST {
					s.Content = append(s.Content, frame(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME, "https://example.com/last.png"))
				}
			}
			if tc.mode == runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE {
				s.Content = []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_VIDEO_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_VIDEO, VideoUrl: &runtimev1.VideoContentVideoURL{Url: "https://example.com/reference.mp4"}}, frame(runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE, "https://example.com/reference.png"), {Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_AUDIO_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_AUDIO, AudioUrl: &runtimev1.VideoContentAudioURL{Url: "https://example.com/reference.mp3"}}}
			}
			request := &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VideoGenerate{VideoGenerate: s}}
			bad := proto.Clone(request).(*runtimev1.SubmitLocalAppScenarioJobRequest)
			bad.GetVideoGenerate().Options.Fps = proto.Int32(24)
			ctx := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit)
			if _, err := f.service.SubmitLocalAppScenarioJob(ctx, bad); err == nil || creates.Load() != 0 {
				t.Fatal("unsupported fps dispatched", err)
			}
			submitted, err := f.service.SubmitLocalAppScenarioJob(ctx, request)
			if err != nil {
				t.Fatal(err)
			}
			get := decision(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet)
			var job *runtimev1.LocalAppScenarioJob
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
			if creates.Load() != 1 || queries.Load() < 1 {
				t.Fatal("original task was not retained", creates.Load(), queries.Load(), job)
			}
			if tc.httpFailure != 0 {
				if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || downloads.Load() != 0 {
					t.Fatal(job)
				}
				receipt := f.service.scenarioJobs.originalNativeReceipt(job.GetJobId())
				if receipt == nil || receipt.TaskID != "media_original" {
					t.Fatal("non-2xx original Job lost")
				}
				return
			}
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(job.GetArtifacts()) != 1 || downloads.Load() != 1 || job.Artifacts[0].GetSizeBytes() != int64(len(video)) {
				t.Fatal(job, downloads.Load())
			}
			stored, _ := f.service.scenarioJobs.get(job.GetJobId())
			meta := stored.Artifacts[0].GetMetadata().GetFields()
			if meta["provider_charge_micro_usd"].GetStringValue() != "0" || meta["provider_output_seconds"].GetNumberValue() != 5 {
				t.Fatal("actual settled billing units lost", meta)
			}
		})
	}
}
