package ai

import (
	"bytes"
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
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestOpenRouterProtectedVideoOwnedFrames(t *testing.T) {
	for _, mode := range []runtimev1.VideoMode{runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST} {
		t.Run(mode.String(), func(t *testing.T) {
			var creates atomic.Int32
			picture := l1CarrierPNGBytes(t)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				creates.Add(1)
				var body struct {
					Frames []struct {
						Type  string `json:"frame_type"`
						Image struct {
							URL string `json:"url"`
						} `json:"image_url"`
					} `json:"frame_images"`
				}
				if r.Method != "POST" || r.URL.Path != "/api/v1/videos" || json.NewDecoder(r.Body).Decode(&body) != nil {
					t.Error("wrong native frame request")
				}
				want := []string{"first_frame"}
				if mode == runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST {
					want = append(want, "last_frame")
				}
				if len(body.Frames) != len(want) {
					t.Error("frame count", len(body.Frames))
				} else {
					for i, frame := range body.Frames {
						if frame.Type != want[i] || frame.Image.URL != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(picture) {
							t.Error("frame role or bytes changed")
						}
					}
				}
				// Transport projection only; this fixture is not model acceptance.
				w.WriteHeader(http.StatusUnauthorized)
			}))
			defer server.Close()
			f := newManagedCloudScenarioTestFixture(t, "openrouter", capabilitydriver.OpenRouterVideoModel, server.URL+"/api/v1", Config{AllowLoopbackEndpoint: true})
			target, _ := structpb.NewStruct(map[string]any{"provider": "openrouter", "providerModelId": capabilitydriver.OpenRouterVideoModel, "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId()})
			intent := &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "video.generate", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{ConnectorRef: f.connectorID, Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.video.generate.openrouter", DriverId: "nimi.runtime.driver.openrouter", DriverDialect: "provider/media-v1"}, ProviderModelTarget: target}}}
			if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.openrouter", intent)); err != nil {
				t.Fatal(err)
			}
			decision := func(op accountservice.LocalAppOperation, capability, subject string) context.Context {
				return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.openrouter", RegisteredAppSubject: subject, Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability})
			}
			submit := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit, "openrouter-subject")
			request := &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VideoGenerate{VideoGenerate: &runtimev1.LocalAppVideoGenerateJobSpec{Mode: mode, Prompt: "Animate the frames.", Options: &runtimev1.LocalAppVideoGenerationOptions{}}}}
			for _, role := range []runtimev1.VideoContentRole{runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME} {
				if role == runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME && mode != runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST {
					break
				}
				asset, err := f.service.UploadLocalAppArtifact(decision(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload, "openrouter-subject"), &runtimev1.UploadLocalAppArtifactRequest{Bytes: picture, MimeType: "image/png"})
				if err != nil {
					t.Fatal(err)
				}
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
				t.Fatal("unowned input dispatched")
			}
			response, err := f.service.SubmitLocalAppScenarioJob(submit, request)
			if err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(3 * time.Second)
			job, _ := f.service.scenarioJobs.get(response.GetJob().GetJobId())
			for !isTerminalScenarioJobStatus(job.GetStatus()) && time.Now().Before(deadline) {
				time.Sleep(time.Millisecond)
				job, _ = f.service.scenarioJobs.get(response.GetJob().GetJobId())
			}
			if creates.Load() != 1 || job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
				t.Fatal("owned frames did not reach native transport", job)
			}
		})
	}
}

func TestOpenRouterFiniteMediaJobsUseNativeEndpointsAndOwnedResults(t *testing.T) {
	mp3, err := os.ReadFile("../../nimillm/testdata/tone-24k.mp3")
	if err != nil {
		t.Fatal(err)
	}
	for _, model := range []string{"openai/gpt-image-2.6-flare", "openai/gpt-image-2.6-sunburst", "google/gemini-nano-banana-2.1", capabilitydriver.OpenRouterSpeechModel, "openai/gpt-transcribe", "mistralai/voxtral-mini-transcribe-3-0"} {
		t.Run(model, func(t *testing.T) {
			var calls atomic.Int32
			png := l1CarrierPNGBytes(t)
			wav := mistralVoiceServiceWAV()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				var b map[string]any
				if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
					t.Error(err)
					return
				}
				if b["model"] != model || r.Header.Get("Authorization") != "Bearer test-key" {
					t.Error("wrong captured model or credential")
				}
				switch r.URL.Path {
				case "/prefix/openai/v1/images":
					w.Header().Set("Content-Type", "application/json")
					if err := json.NewEncoder(w).Encode(map[string]any{"created": 1, "data": []any{map[string]any{"b64_json": base64.StdEncoding.EncodeToString(png), "media_type": "image/png"}}, "usage": map[string]any{"prompt_tokens": 3, "completion_tokens": 7, "total_tokens": 10}}); err != nil {
						t.Error(err)
						return
					}
				case "/prefix/openai/v1/audio/speech":
					if b["response_format"] != "mp3" || b["input"] != "  A short sentence.\n" || b["voice"] != "voice_478" {
						t.Error("speech controls changed")
					}
					w.Header().Set("Content-Type", "audio/mpeg")
					_, _ = w.Write(mp3)
				case "/prefix/openai/v1/audio/transcriptions":
					audio := b["input_audio"].(map[string]any)
					if audio["data"] != base64.StdEncoding.EncodeToString(wav) || audio["format"] != "wav" || b["prompt"] != nil {
						t.Error("recording or unsupported prompt changed")
					}
					w.Header().Set("Content-Type", "application/json")
					out := map[string]any{"text": "Native transcript.", "usage": map[string]any{"input_tokens": 3, "output_tokens": 7, "total_tokens": 10}}
					if b["response_format"] != "json" || b["timestamp_granularities"] != nil {
						t.Error("unsupported gateway timestamp request")
					}
					if err := json.NewEncoder(w).Encode(out); err != nil {
						t.Error(err)
						return
					}
				default:
					t.Errorf("wrong endpoint %s", r.URL.Path)
					w.WriteHeader(404)
				}
			}))
			defer server.Close()
			f := newManagedCloudScenarioTestFixture(t, "openrouter", model, server.URL+"/prefix/openai/v1", Config{AllowLoopbackEndpoint: true})
			owner := scenarioJobUserContext("app-1", "user-001")
			request := &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app-1", SubjectUserId: "user-001"}}
			capability := "image.generate"
			switch {
			case capabilitydriver.IsOpenRouterImageModel(model):
				request.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE
				request.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "A red square", N: proto.Int32(1)}}}
			case model == capabilitydriver.OpenRouterSpeechModel:
				capability = "audio.synthesize"
				request.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE
				request.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "  A short sentence.\n", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "voice_478"}}}}}
			default:
				capability = "audio.transcribe"
				request.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE
				request.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/wav", AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: wav}}}}}
			}
			if capability == "audio.transcribe" {
				unsupported := proto.Clone(request).(*runtimev1.SubmitScenarioJobRequest)
				unsupported.GetSpec().GetSpeechTranscribe().Timestamps = proto.Bool(true)
				if _, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, capability, f.targetRef), unsupported); err == nil || calls.Load() != 0 {
					t.Fatal("gateway timestamp request was not rejected before dispatch", err)
				}
			}
			submitted, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, capability, f.targetRef), request)
			if err != nil {
				t.Fatal(err)
			}
			job := waitOpenRouterJob(t, f.service, owner, submitted.Job.JobId)
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(job.Artifacts) != 1 || calls.Load() != 1 {
				t.Fatalf("native job %v calls=%d", job, calls.Load())
			}
			a := job.Artifacts[0]
			if a.GetUri() != "" || a.GetSizeBytes() <= 0 || a.GetSha256() == "" {
				t.Fatal("result is not owned", a)
			}
			if capability == "audio.synthesize" && (a.GetSampleRateHz() != 24000 || a.GetDurationMs() <= 0) {
				t.Fatal("audio facts missing", a)
			}
		})
	}
}

func TestOpenRouterVideoJobReceivesAuthenticatedOriginalContent(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("native MP4 fixture requires ffmpeg")
	}
	file := filepath.Join(t.TempDir(), "video.mp4")
	if output, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=1280x720:r=24:d=3", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000:duration=3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "-shortest", file).CombinedOutput(); err != nil {
		t.Fatalf("real codec fixture %v %s", err, output)
	}
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var creates, downloads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("content credential missing")
		}
		switch r.URL.Path {
		case "/api/v1/videos":
			creates.Add(1)
			var b map[string]any
			if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
				t.Error(err)
				return
			}
			if b["duration"] != float64(3) || b["generate_audio"] != true || b["model"] != capabilitydriver.OpenRouterVideoModel {
				t.Error(b)
			}
			if err := json.NewEncoder(w).Encode(map[string]any{"id": "original-video", "status": "pending", "polling_url": "https://untrusted.invalid/never"}); err != nil {
				t.Error(err)
				return
			}
		case "/api/v1/videos/original-video":
			if err := json.NewEncoder(w).Encode(map[string]any{"id": "original-video", "status": "completed", "unsigned_urls": []string{"https://untrusted.invalid/never"}, "usage": map[string]any{"cost": 0.2}}); err != nil {
				t.Error(err)
				return
			}
		case "/api/v1/videos/original-video/content":
			downloads.Add(1)
			if r.URL.Query().Get("index") != "0" {
				t.Error("wrong output slot")
			}
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write(data)
		default:
			t.Error(r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "openrouter", capabilitydriver.OpenRouterVideoModel, server.URL+"/api/v1", Config{AllowLoopbackEndpoint: true})
	owner := scenarioJobUserContext("app-1", "user-001")
	req := &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app-1", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: "A red square", Options: &runtimev1.VideoGenerationOptions{}}}}}
	submitted, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "video.generate", f.targetRef), req)
	if err != nil {
		t.Fatal(err)
	}
	job := waitOpenRouterJob(t, f.service, owner, submitted.Job.JobId)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || creates.Load() != 1 || downloads.Load() != 1 || len(job.Artifacts) != 1 {
		t.Fatal(job, creates.Load(), downloads.Load())
	}
	if job.Artifacts[0].GetUri() != "" || job.Artifacts[0].GetSizeBytes() != int64(len(data)) {
		t.Fatal(job.Artifacts)
	}
	if !bytes.Contains(data, []byte("ftyp")) {
		t.Fatal("codec did not produce MP4")
	}
}

func waitOpenRouterJob(t *testing.T, s *Service, ctx context.Context, id string) *runtimev1.ScenarioJob {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		r, err := s.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: id})
		if err != nil {
			t.Fatal(err)
		}
		if isTerminalScenarioJobStatus(r.GetJob().GetStatus()) {
			return r.GetJob()
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("job timeout")
	return nil
}
