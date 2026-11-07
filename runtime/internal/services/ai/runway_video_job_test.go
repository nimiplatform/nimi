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
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
)

func TestRunwayProtectedVideoExactModesAndOwnedFrames(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("native MP4 fixture requires ffmpeg")
	}
	video, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=1280x720:r=24:d=2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-an", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1").Output()
	if err != nil {
		t.Fatal(err)
	}
	var picture bytes.Buffer
	if err := png.Encode(&picture, image.NewRGBA(image.Rect(0, 0, 512, 512))); err != nil {
		t.Fatal(err)
	}
	var large bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.NoCompression}
	if err := encoder.Encode(&large, image.NewNRGBA(image.Rect(0, 0, 1024, 1024))); err != nil {
		t.Fatal(err)
	}
	if base64.StdEncoding.EncodedLen(large.Len())+len("data:image/png;base64,") <= 5<<20 {
		t.Fatal("fixture must cross the native encoded bound")
	}
	const taskID = "17f20503-6c24-4c16-946b-35dbbce2af2f"
	for _, tc := range []struct {
		model                   string
		image, url, emptyPrompt bool
	}{
		{"gen4.5", false, false, false}, {"gen4.5", true, false, false}, {"gen4.5", true, true, false}, {"gen4_turbo", true, false, true},
	} {
		t.Run(tc.model+map[bool]string{true: "/i2v", false: "/t2v"}[tc.image]+map[bool]string{true: "/url", false: "/owned"}[tc.url], func(t *testing.T) {
			var creates, queries, downloads atomic.Int32
			var endpoint string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/video" {
					downloads.Add(1)
					if r.Header.Get("Authorization") != "" || r.Header.Get("X-Runway-Version") != "" {
						t.Error("API headers leaked to artifact")
					}
					w.Header().Set("Content-Type", "video/mp4")
					_, _ = w.Write(video)
					return
				}
				if r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("X-Runway-Version") != "2024-11-06" {
					t.Error("captured credential or version changed")
				}
				w.Header().Set("Content-Type", "application/json")
				if r.Method == "POST" {
					creates.Add(1)
					path := "/proxy/openai/v1/text_to_video"
					if tc.image {
						path = "/proxy/openai/v1/image_to_video"
					}
					var b map[string]any
					if json.NewDecoder(r.Body).Decode(&b) != nil {
						t.Error("invalid body")
						return
					}
					if r.URL.Path != path || b["model"] != tc.model || !tc.emptyPrompt && b["duration"] != float64(2) || tc.emptyPrompt && b["duration"] != nil || b["ratio"] != "1280:720" || b["seed"] != float64(0) || b["watermark"] != nil || b["audio"] != nil || b["negative_prompt"] != nil {
						t.Error("native mode/controls lost", r.URL.Path, b)
					}
					if tc.emptyPrompt {
						if b["promptText"] != nil {
							t.Error("optional empty prompt was sent")
						}
					} else if b["promptText"] != "A blue cup rotates." {
						t.Error("prompt changed")
					}
					if tc.model == "gen4.5" {
						if b["outputFormat"] != "mp4" {
							t.Error("unrequested delivery format")
						}
					} else if b["outputFormat"] != nil {
						t.Error("Turbo received unknown format control")
					}
					if tc.image {
						frames, ok := b["promptImage"].([]any)
						if !ok || len(frames) != 1 {
							t.Error("missing native first frame")
							return
						}
						frame := frames[0].(map[string]any)
						want := "data:image/png;base64," + base64.StdEncoding.EncodeToString(picture.Bytes())
						if tc.url {
							want = "https://example.com/frame.png"
						}
						if frame["uri"] != want || frame["position"] != "first" {
							t.Error("image carrier or role changed")
						}
					} else if b["promptImage"] != nil {
						t.Error("text mode gained image")
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"id": taskID})
					return
				}
				if r.Method != "GET" || r.URL.Path != "/proxy/openai/v1/tasks/"+taskID {
					t.Error("wrong original task query")
				}
				q := queries.Add(1)
				if q == 1 {
					_ = json.NewEncoder(w).Encode(map[string]any{"id": taskID, "status": "THROTTLED", "estimatedCost": map[string]any{"credits": 999}})
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"id": taskID, "status": "SUCCEEDED", "output": []string{endpoint + "/video"}, "cost": map[string]any{"credits": 24}})
			}))
			defer server.Close()
			endpoint = server.URL
			f := newManagedCloudScenarioTestFixture(t, "runway", tc.model, endpoint+"/proxy/openai/v1", Config{AllowLoopbackEndpoint: true})
			f.service.jobWorkAuthorizer = newNativeMediaWorkAuthorizer("user-001", "app.runway", "runway-subject")
			f.service.requireJobWorkAuthority = true
			intent := cloudVoiceAIConfigIntent(t, f.connectorID, f.descriptor)
			intent.CapabilityContract = "video.generate"
			intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.video.generate.runway", DriverId: "nimi.runtime.driver.runway", DriverDialect: "provider/media-v1"}
			if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.runway", intent)); err != nil {
				t.Fatal(err)
			}
			decision := func(op accountservice.LocalAppOperation, cap string) context.Context {
				return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.runway", RegisteredAppSubject: "runway-subject", Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: cap})
			}
			s := &runtimev1.LocalAppVideoGenerateJobSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: "A blue cup rotates.", Options: &runtimev1.LocalAppVideoGenerationOptions{DurationSec: proto.Int32(2), Ratio: "1280:720", Seed: proto.Int64(0)}}
			if tc.emptyPrompt {
				s.Prompt = ""
				s.Options.DurationSec = nil
			}
			if tc.image {
				s.Mode = runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME
				if tc.url {
					s.Content = []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, ImageUrl: &runtimev1.VideoContentImageURL{Url: "https://example.com/frame.png"}}}
				} else {
					asset, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{Bytes: picture.Bytes(), MimeType: "image/png"})
					if err != nil {
						t.Fatal(err)
					}
					s.Content = []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: asset.ArtifactId}}}
				}
			}
			request := &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VideoGenerate{VideoGenerate: s}}
			submit := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit)
			bad := proto.Clone(request).(*runtimev1.SubmitLocalAppScenarioJobRequest)
			bad.GetVideoGenerate().Options.GenerateAudio = proto.Bool(false)
			if _, err := f.service.SubmitLocalAppScenarioJob(submit, bad); err == nil || creates.Load() != 0 {
				t.Fatal("unreviewed audio control dispatched", err)
			}
			bad = proto.Clone(request).(*runtimev1.SubmitLocalAppScenarioJobRequest)
			bad.GetVideoGenerate().Options.Ratio = "not-a-ratio"
			if _, err := f.service.SubmitLocalAppScenarioJob(submit, bad); err == nil || creates.Load() != 0 {
				t.Fatal("model matrix accepted an unknown ratio", err)
			}
			if tc.image && !tc.url {
				oversized, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload), &runtimev1.UploadLocalAppArtifactRequest{Bytes: large.Bytes(), MimeType: "image/png"})
				if err != nil {
					t.Fatal(err)
				}
				bad = proto.Clone(request).(*runtimev1.SubmitLocalAppScenarioJobRequest)
				bad.GetVideoGenerate().Content[0].ArtifactRef.ArtifactId = oversized.ArtifactId
				if _, err := f.service.SubmitLocalAppScenarioJob(submit, bad); err == nil {
					t.Fatal("oversized encoded carrier admitted")
				} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_TOO_LARGE {
					t.Fatal(err)
				}
				if creates.Load() != 0 {
					t.Fatal("oversized input reached provider")
				}
			}
			response, err := f.service.SubmitLocalAppScenarioJob(submit, request)
			if err != nil {
				t.Fatal(err)
			}
			var job *runtimev1.LocalAppScenarioJob
			deadline := time.Now().Add(10 * time.Second)
			for time.Now().Before(deadline) {
				r, err := f.service.GetLocalAppScenarioJob(decision(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet), &runtimev1.GetLocalAppScenarioJobRequest{JobId: response.Job.JobId})
				if err != nil {
					t.Fatal(err)
				}
				job = r.Job
				if isTerminalScenarioJobStatus(job.GetStatus()) {
					break
				}
				time.Sleep(20 * time.Millisecond)
			}
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || creates.Load() != 1 || queries.Load() != 2 || downloads.Load() != 1 || len(job.GetArtifacts()) != 1 || job.Artifacts[0].GetSizeBytes() != int64(len(video)) {
				t.Fatal(job, creates.Load(), queries.Load(), downloads.Load())
			}
			stored, _ := f.service.scenarioJobs.get(job.JobId)
			if stored.Artifacts[0].GetMetadata().GetFields()["provider_cost_credits"].GetStringValue() != "24" || stored.Artifacts[0].GetDurationMs() != 0 {
				t.Fatal("final credits lost or request duration fabricated as output fact", stored.Artifacts[0])
			}
		})
	}
}
