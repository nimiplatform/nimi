package ai

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/proto"
)

func TestTogetherFiniteMediaNativeContracts(t *testing.T) {
	var pixels bytes.Buffer
	if err := png.Encode(&pixels, image.NewRGBA(image.Rect(0, 0, 256, 256))); err != nil {
		t.Fatal(err)
	}
	wav := mistralVoiceServiceWAV()
	mp3, err := os.ReadFile("../../nimillm/testdata/tone-24k.mp3")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ model, format string }{
		{"black-forest-labs/FLUX.2-dev", ""}, {"black-forest-labs/FLUX.2-pro", ""},
		{capabilitydriver.TogetherSpeechModel, "wav"}, {capabilitydriver.TogetherSpeechModel, "mp3"}, {capabilitydriver.TogetherSpeechModel, "wav-8000"},
		{"openai/whisper-large-v3", ""}, {"nvidia/parakeet-tdt-0.6b-v3", ""}, {"nvidia/nemotron-3.5-asr-streaming-0.6b", ""},
	} {
		t.Run(tc.model+"/"+tc.format, func(t *testing.T) {
			encoding, rate, speechBytes := tc.format, int32(24000), wav
			if tc.format == "wav-8000" {
				encoding = "wav"
				rate = 8000
				speechBytes = bytes.Clone(wav)
				binary.LittleEndian.PutUint32(speechBytes[24:], 8000)
				binary.LittleEndian.PutUint32(speechBytes[28:], 16000)
			}
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Header.Get("Authorization") != "Bearer test-key" {
					t.Error("wrong captured credential")
				}
				if r.URL.Path == "/proxy/openai/v1/audio/transcriptions" {
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
					if err != nil || !bytes.Equal(data, wav) || header.Header.Get("Content-Type") != "audio/wav" {
						t.Error("native audio bytes or MIME changed")
					}
					if r.FormValue("model") != tc.model || r.FormValue("language") != "auto" {
						t.Error("model or native detection changed")
					}
					out := map[string]any{"text": "Native transcript."}
					if tc.model == "openai/whisper-large-v3" {
						if r.FormValue("prompt") != "  vocabulary\n" || r.FormValue("response_format") != "verbose_json" || r.FormValue("timestamp_granularities") != "word" {
							t.Error("Whisper controls dropped")
						}
						out["language"] = "english"
						out["words"] = []any{map[string]any{"word": "Native", "start": 0.01, "end": 0.04}, map[string]any{"word": "transcript.", "start": 0.04, "end": 0.09}}
					} else if r.FormValue("prompt") != "" || r.FormValue("response_format") != "json" || r.FormValue("timestamp_granularities") != "" {
						t.Error("unreviewed ASR controls forwarded")
					}
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(out)
					return
				}
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if body["model"] != tc.model {
					t.Error("model changed")
				}
				switch r.URL.Path {
				case "/proxy/openai/v1/images/generations":
					if body["width"] != float64(256) || body["height"] != float64(256) || body["n"] != float64(2) || body["response_format"] != "base64" || body["output_format"] != "png" || body["negative_prompt"] != nil {
						t.Error("image controls changed", body)
					}
					refs, ok := body["reference_images"].([]any)
					if !ok || len(refs) != 1 || refs[0] != "https://example.com/owned-reference.png" {
						t.Error("reference URL changed")
					}
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(map[string]any{"model": tc.model, "data": []any{map[string]any{"index": 1, "type": "b64_json", "b64_json": base64.StdEncoding.EncodeToString(pixels.Bytes())}, map[string]any{"index": 0, "type": "b64_json", "b64_json": base64.StdEncoding.EncodeToString(pixels.Bytes())}}})
				case "/proxy/openai/v1/audio/speech":
					if body["input"] != "  A short sentence.\n" || body["voice"] != "ryan" || body["sample_rate"] != float64(rate) || body["language"] != "en" || body["stream"] != false || body["alignment"] != "none" || body["response_format"] != encoding {
						t.Error("speech controls changed", body)
					}
					if tc.format == "mp3" {
						w.Header().Set("Content-Type", "audio/mpeg")
						w.Write(mp3)
					} else {
						w.Header().Set("Content-Type", "audio/wav")
						w.Write(speechBytes)
					}
				default:
					t.Error("unexpected native path", r.URL.Path)
					w.WriteHeader(404)
				}
			}))
			defer server.Close()
			f := newManagedCloudScenarioTestFixture(t, "together", tc.model, server.URL+"/proxy/openai/v1", Config{AllowLoopbackEndpoint: true})
			owner := scenarioJobUserContext("app-1", "user-001")
			request := &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app-1", SubjectUserId: "user-001"}}
			capability := "image.generate"
			wantArtifacts := 1
			switch {
			case capabilitydriver.IsTogetherImageModel(tc.model):
				wantArtifacts = 2
				request.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE
				request.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "A blue cup", Size: "256x256", N: proto.Int32(2), ReferenceImages: []string{"https://example.com/owned-reference.png"}}}}
			case tc.model == capabilitydriver.TogetherSpeechModel:
				capability = "audio.synthesize"
				request.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE
				request.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "  A short sentence.\n", AudioFormat: encoding, VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "ryan"}}}}}
				if rate == 8000 {
					request.GetSpec().GetSpeechSynthesize().SampleRateHz = proto.Int32(rate)
				}
			default:
				capability = "audio.transcribe"
				request.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE
				spec := &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/wav", AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: wav}}}
				if tc.model == "openai/whisper-large-v3" {
					spec.Prompt = "  vocabulary\n"
					spec.Timestamps = proto.Bool(true)
				}
				request.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: spec}}
			}
			invalid := proto.Clone(request).(*runtimev1.SubmitScenarioJobRequest)
			switch capability {
			case "image.generate":
				invalid.GetSpec().GetImageGenerate().NegativePrompt = "unsupported"
			case "audio.synthesize":
				invalid.GetSpec().GetSpeechSynthesize().Speed = proto.Float32(1)
			default:
				invalid.GetSpec().GetSpeechTranscribe().Diarization = proto.Bool(true)
			}
			if _, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, capability, f.targetRef), invalid); err == nil || calls.Load() != 0 {
				t.Fatal("unsupported controls dispatched", err)
			}
			submitted, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, capability, f.targetRef), request)
			if err != nil {
				t.Fatal(err)
			}
			job := waitOpenRouterJob(t, f.service, owner, submitted.GetJob().GetJobId())
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || calls.Load() != 1 || len(job.GetArtifacts()) != wantArtifacts {
				t.Fatal(job, calls.Load())
			}
			for _, a := range job.GetArtifacts() {
				if a.GetSizeBytes() <= 0 || a.GetSha256() == "" || a.GetUri() != "" {
					t.Fatal("unowned output", a)
				}
			}
			if capability == "audio.synthesize" && (job.Artifacts[0].GetSampleRateHz() != rate || job.Artifacts[0].GetDurationMs() <= 0) {
				t.Fatal("audio facts not decoded", job.Artifacts[0])
			}
		})
	}
}
