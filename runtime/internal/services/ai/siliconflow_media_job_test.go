package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/proto"
)

// HTTP and codec fixtures exercise the Runtime job path, not live model quality.
func TestSiliconFlowFiniteMediaNativeJobs(t *testing.T) {
	var pixels bytes.Buffer
	if err := png.Encode(&pixels, image.NewRGBA(image.Rect(0, 0, 256, 256))); err != nil {
		t.Fatal(err)
	}
	wav := mistralVoiceServiceWAV()
	for _, tc := range []struct{ model, format string }{
		{"OpenMOSS-Team/MOSS-Image", ""}, {"Qwen/Qwen-Image", ""}, {capabilitydriver.SiliconFlowImageEditModel, ""},
		{"FunAudioLLM/CosyVoice2-0.5B", "wav"}, {"FunAudioLLM/CosyVoice2-0.5B", "mp3"},
		{"fnlp/MOSS-TTSD-v0.5", "wav"}, {"fnlp/MOSS-TTSD-v0.5", "mp3"},
		{"FunAudioLLM/SenseVoiceSmall", ""}, {"TeleAI/TeleSpeechASR", ""},
	} {
		t.Run(tc.model+"/"+tc.format, func(t *testing.T) {
			rate := int32(44100)
			speechBytes := bytes.Clone(wav)
			binary.LittleEndian.PutUint32(speechBytes[24:], uint32(rate))
			binary.LittleEndian.PutUint32(speechBytes[28:], uint32(rate*2))
			if tc.format == "mp3" {
				if tc.model == "fnlp/MOSS-TTSD-v0.5" {
					rate = 32000
				}
				ffmpeg, err := exec.LookPath("ffmpeg")
				if err != nil {
					t.Skip("native MP3 fixture requires ffmpeg")
				}
				speechBytes, err = exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.2", "-ar", map[int32]string{32000: "32000", 44100: "44100"}[rate], "-ac", "1", "-f", "mp3", "pipe:1").Output()
				if err != nil {
					t.Fatal(err)
				}
			}
			var calls, downloads atomic.Int32
			var endpoint string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/result.png" {
					downloads.Add(1)
					if r.Header.Get("Authorization") != "" || r.Header.Get("x-api-key") != "" {
						t.Error("artifact credential leak")
					}
					w.Header().Set("Content-Type", "image/jpeg") // actual bytes must win
					_, _ = w.Write(pixels.Bytes())
					return
				}
				calls.Add(1)
				if r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("X-Enable-Watermark") != "" {
					t.Error("credential or default watermark changed")
				}
				if r.URL.Path == "/proxy/anthropic/v1/audio/transcriptions" {
					if err := r.ParseMultipartForm(1 << 20); err != nil {
						t.Error(err)
						return
					}
					defer r.MultipartForm.RemoveAll()
					file, header, err := r.FormFile("file")
					if err != nil {
						t.Error(err)
						return
					}
					data, err := io.ReadAll(file)
					file.Close()
					if err != nil || !bytes.Equal(data, wav) || header.Header.Get("Content-Type") != "audio/wav" || len(r.MultipartForm.Value) != 1 || r.FormValue("model") != tc.model {
						t.Error("native ASR payload changed")
					}
					w.Header().Set("Content-Type", "application/json")
					_, _ = io.WriteString(w, `{"text":"真实内容 Native transcript."}`)
					return
				}
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if body["model"] != tc.model {
					t.Error("model identity changed")
				}
				switch r.URL.Path {
				case "/proxy/anthropic/v1/images/generations":
					if body["prompt"] != "A blue cup" || body["negative_prompt"] != "letters" || body["seed"] == nil || body["batch_size"] != nil || body["n"] != nil || body["response_format"] != nil {
						t.Error("native image payload", body)
					}
					if tc.model == capabilitydriver.SiliconFlowImageEditModel {
						if body["image_size"] != nil || body["image"] != "https://example.com/1.png" || body["image2"] != "https://example.com/2.png" || body["image3"] != "https://example.com/3.png" {
							t.Error("edit inputs", body)
						}
					} else if body["image_size"] != "256x256" || body["image"] != nil {
						t.Error("image dimensions", body)
					}
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(map[string]any{"images": []any{map[string]any{"url": endpoint + "/result.png"}}})
				case "/proxy/anthropic/v1/audio/speech":
					if body["input"] != "  A short sentence.\n" || body["voice"] != tc.model+":alex" || body["sample_rate"] != float64(rate) || body["stream"] != false || body["response_format"] != tc.format || body["speed"] != 1.25 || body["gain"] != nil || body["language"] != nil {
						t.Error("native speech payload", body)
					}
					_, _ = w.Write(speechBytes)
				default:
					t.Error("wrong path", r.URL.Path)
					w.WriteHeader(404)
				}
			}))
			defer server.Close()
			endpoint = server.URL
			f := newManagedCloudScenarioTestFixture(t, "siliconflow", tc.model, endpoint+"/proxy/anthropic/v1", Config{AllowLoopbackEndpoint: true})
			owner := scenarioJobUserContext("app-1", "user-001")
			request := &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app-1", SubjectUserId: "user-001"}}
			capability := "image.generate"
			switch {
			case capabilitydriver.IsSiliconFlowImageModel(tc.model):
				request.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE
				s := &runtimev1.ImageGenerateScenarioSpec{Prompt: "A blue cup", NegativePrompt: "letters", Size: "256x256", Seed: proto.Int64(123)}
				if tc.model == capabilitydriver.SiliconFlowImageEditModel {
					s.Size = ""
					s.ReferenceImages = []string{"https://example.com/1.png", "https://example.com/2.png", "https://example.com/3.png"}
				}
				request.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: s}}
			case capabilitydriver.IsSiliconFlowSpeechModel(tc.model):
				capability = "audio.synthesize"
				request.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE
				request.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "  A short sentence.\n", AudioFormat: tc.format, SampleRateHz: proto.Int32(rate), Speed: proto.Float32(1.25), VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: tc.model + ":alex"}}}}}
			default:
				capability = "audio.transcribe"
				request.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE
				request.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/wav", AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: wav}}}}}
			}
			bad := proto.Clone(request).(*runtimev1.SubmitScenarioJobRequest)
			switch capability {
			case "image.generate":
				bad.GetSpec().GetImageGenerate().N = proto.Int32(2)
			case "audio.synthesize":
				bad.GetSpec().GetSpeechSynthesize().Volume = proto.Float32(1)
			default:
				bad.GetSpec().GetSpeechTranscribe().Timestamps = proto.Bool(true)
			}
			ctx := withCloudScenarioTestIntent(owner, capability, f.targetRef)
			if _, err := f.service.SubmitScenarioJob(ctx, bad); err == nil || calls.Load() != 0 {
				t.Fatal("unsupported controls dispatched", err)
			}
			submitted, err := f.service.SubmitScenarioJob(ctx, request)
			if err != nil {
				t.Fatal(err)
			}
			job := waitOpenRouterJob(t, f.service, owner, submitted.GetJob().GetJobId())
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || calls.Load() != 1 || len(job.GetArtifacts()) != 1 {
				t.Fatal(job, calls.Load())
			}
			a := job.Artifacts[0]
			if a.GetSha256() == "" || a.GetSizeBytes() <= 0 || a.GetUri() != "" {
				t.Fatal("output not owned", a)
			}
			if capability == "image.generate" && (downloads.Load() != 1 || a.GetMimeType() != "image/png") {
				t.Fatal("incorrect image reception", a)
			}
			if capability == "audio.synthesize" && (a.GetSampleRateHz() != rate || a.GetDurationMs() <= 0) {
				t.Fatal("codec facts missing", a)
			}
		})
	}
}

func TestSiliconFlowProtectedOwnedImageNativeRequest(t *testing.T) {
	picture := l1CarrierPNGBytes(t)
	var calls atomic.Int32
	var endpoint string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/result" {
			_, _ = w.Write(picture)
			return
		}
		calls.Add(1)
		var body map[string]any
		if json.NewDecoder(r.Body).Decode(&body) != nil || body["image"] != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(picture) || body["image_size"] != nil {
			t.Error("owned edit request changed", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"images": []any{map[string]any{"url": endpoint + "/result"}}})
	}))
	defer server.Close()
	endpoint = server.URL
	f := newManagedCloudScenarioTestFixture(t, "siliconflow", capabilitydriver.SiliconFlowImageEditModel, endpoint+"/v1", Config{AllowLoopbackEndpoint: true})
	intent := cloudVoiceAIConfigIntent(t, f.connectorID, f.descriptor)
	intent.CapabilityContract = "image.generate"
	intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.image.generate.siliconflow", DriverId: "nimi.runtime.driver.siliconflow", DriverDialect: "provider/media-v1"}
	if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("nimi.realm-persona-studio", intent)); err != nil {
		t.Fatal(err)
	}
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "nimi.realm-persona-studio", RegisteredAppSubject: "protected-app-principal", Operation: accountservice.LocalAppOperationScenarioJobSubmit, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: localappop.AppOperationIDScenarioJobSubmit})
	owner := &runtimeartifact.ArtifactOwner{SubjectUserID: "user-001", RegisteredAppSubject: "protected-app-principal", AppID: "nimi.realm-persona-studio"}
	putImageArtifactRecordForTest(t, f.service, "source", owner, "image/png", picture)
	foreign := *owner
	foreign.RegisteredAppSubject = "other-app"
	putImageArtifactRecordForTest(t, f.service, "foreign", &foreign, "image/png", picture)
	request := func(id string) *runtimev1.SubmitLocalAppScenarioJobRequest {
		return &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "a blue cup", ReferenceImageArtifactId: id}}}
	}
	if _, err := f.service.SubmitLocalAppScenarioJob(ctx, request("foreign")); err == nil {
		t.Fatal("foreign image admitted")
	} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
		t.Fatal(err)
	}
	if calls.Load() != 0 {
		t.Fatal("foreign image dispatched")
	}
	response, err := f.service.SubmitLocalAppScenarioJob(ctx, request("source"))
	if err != nil {
		t.Fatal(err)
	}
	job := waitForScenarioJobTerminalForLocalTextTest(t, f.service, response.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || calls.Load() != 1 {
		t.Fatal(job, calls.Load())
	}
}
