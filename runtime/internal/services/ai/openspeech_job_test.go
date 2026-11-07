package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/proto"
)

func TestOpenSpeechProtectedFiniteSynthesisAndTranscription(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("real codec fixture requires ffmpeg")
	}
	audio := map[string][]byte{}
	for _, format := range []string{"mp3", "s16le", "ogg"} {
		args := []string{"-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3", "-ar", "24000", "-ac", "1"}
		if format == "ogg" {
			args = append(args, "-ar", "48000", "-c:a", "libopus")
		}
		data, err := exec.Command(ffmpeg, append(args, "-f", format, "pipe:1")...).Output()
		if err != nil {
			t.Fatal(err)
		}
		audio[format] = data
	}
	wav := mistralVoiceServiceWAV()
	cases := []struct {
		model, voice, format string
		silent               bool
	}{}
	for _, model := range []string{"seed-tts-1.0", "seed-tts-2.0"} {
		for _, voice := range capabilitydriver.OpenSpeechVoices(model) {
			cases = append(cases, struct {
				model, voice, format string
				silent               bool
			}{model, voice, "mp3", false})
		}
	}
	cases = append(cases, struct {
		model, voice, format string
		silent               bool
	}{"seed-tts-2.0", capabilitydriver.OpenSpeechVoices("seed-tts-2.0")[0], "pcm", false}, struct {
		model, voice, format string
		silent               bool
	}{"seed-tts-2.0", capabilitydriver.OpenSpeechVoices("seed-tts-2.0")[0], "ogg_opus", false}, struct {
		model, voice, format string
		silent               bool
	}{capabilitydriver.OpenSpeechFlashASR, "", "wav", false}, struct {
		model, voice, format string
		silent               bool
	}{capabilitydriver.OpenSpeechFlashASR, "", "mp3", false}, struct {
		model, voice, format string
		silent               bool
	}{capabilitydriver.OpenSpeechFlashASR, "", "wav", true})
	for _, tc := range cases {
		t.Run(fmt.Sprintf("%s/%s/%s/%v", tc.model, tc.voice, tc.format, tc.silent), func(t *testing.T) {
			tts := tc.voice != ""
			capability := "audio.transcribe"
			if tts {
				capability = "audio.synthesize"
			}
			var calls atomic.Int32
			rate := int32(24000)
			if tc.format == "ogg_opus" {
				rate = 48000
			}
			source := wav
			mime := "audio/wav"
			if !tts && tc.format == "mp3" {
				source = audio["mp3"]
				mime = "audio/mpeg"
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Header.Get("Authorization") != "" || r.Header.Get("X-Api-Key") != "test-key" || r.Header.Get("X-Api-App-Key") != "" || r.Header.Get("X-Api-Resource-Id") != tc.model || len(r.Header.Get("X-Api-Request-Id")) != 36 {
					t.Error("native headers")
				}
				var b map[string]any
				if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
					t.Error(err)
					return
				}
				if b["model"] != nil || b["extensions"] != nil || b["user"].(map[string]any)["uid"] != "nimi-runtime" {
					t.Error("invalid native envelope", b)
				}
				if tts {
					if r.URL.Path != "/proxy/api/v3/tts/unidirectional/sse" {
						t.Error(r.URL.Path)
					}
					p := b["req_params"].(map[string]any)
					if p["text"] != "A short sentence." || p["speaker"] != tc.voice || p["audio_params"].(map[string]any)["speech_rate"] != float64(50) || p["audio_params"].(map[string]any)["sample_rate"] != float64(rate) {
						t.Error("native TTS input", p)
					}
					data := audio[map[string]string{"mp3": "mp3", "pcm": "s16le", "ogg_opus": "ogg"}[tc.format]]
					w.Header().Set("Content-Type", "text/event-stream")
					mid := len(data) / 2
					for _, chunk := range [][]byte{data[:mid], data[mid:]} {
						fmt.Fprintf(w, "event: 352\ndata: {\"code\":0,\"data\":\"%s\"}\n\n", base64.StdEncoding.EncodeToString(chunk))
					}
					fmt.Fprint(w, "event: 152\ndata: {\"code\":20000000,\"data\":null,\"usage\":{\"text_words\":19}}\n\n")
					return
				}
				if r.URL.Path != "/proxy/api/v3/auc/bigmodel/recognize/flash" || r.Header.Get("X-Api-Sequence") != "-1" {
					t.Error("native ASR path")
				}
				a := b["audio"].(map[string]any)
				decoded, err := base64.StdEncoding.DecodeString(a["data"].(string))
				if err != nil || !bytes.Equal(decoded, source) || a["url"] != nil || a["language"] != "en-US" || a["format"] != tc.format || b["request"].(map[string]any)["show_utterances"] != true {
					t.Error("ASR source or options changed")
				}
				w.Header().Set("Content-Type", "application/json")
				if tc.silent {
					w.Header().Set("X-Api-Status-Code", "20000003")
					fmt.Fprint(w, `{}`)
					return
				}
				w.Header().Set("X-Api-Status-Code", "20000000")
				fmt.Fprint(w, `{"result":{"text":"Hello.","utterances":[{"words":[{"text":"Hello.","start_time":0,"end_time":10}]}]}}`)
			}))
			defer server.Close()
			f := newManagedCloudScenarioTestFixture(t, "volcengine_openspeech", tc.model, server.URL+"/proxy/api/v1", Config{AllowLoopbackEndpoint: true})
			f.service.jobWorkAuthorizer = newNativeMediaWorkAuthorizer("user-001", "app.openspeech", "openspeech-subject")
			f.service.requireJobWorkAuthority = true
			bodies, err := runtimeartifact.NewDiskStore(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			f.service.SetRuntimeArtifactStore(bodies)
			intent := cloudVoiceAIConfigIntent(t, f.connectorID, f.descriptor)
			intent.CapabilityContract = capability
			intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud." + capability + ".volcengine_openspeech", DriverId: "nimi.runtime.driver.volcengine_openspeech", DriverDialect: "provider/media-v1"}
			if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.openspeech", intent)); err != nil {
				t.Fatal(err)
			}
			decision := func(op accountservice.LocalAppOperation, cap string) context.Context {
				return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.openspeech", RegisteredAppSubject: "openspeech-subject", Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: cap})
			}
			request := &runtimev1.SubmitLocalAppScenarioJobRequest{}
			if tts {
				request.Spec = &runtimev1.SubmitLocalAppScenarioJobRequest_SpeechSynthesize{SpeechSynthesize: &runtimev1.LocalAppSpeechSynthesizeJobSpec{Text: "A short sentence.", AudioFormat: tc.format, SampleRateHz: proto.Int32(rate), Speed: proto.Float32(1.5), VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: tc.voice}}}}
			} else {
				request.Spec = &runtimev1.SubmitLocalAppScenarioJobRequest_SpeechTranscribe{SpeechTranscribe: &runtimev1.LocalAppSpeechTranscribeJobSpec{MimeType: mime, Language: "en-US", Timestamps: proto.Bool(true), AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: source}}}}
			}
			bad := proto.Clone(request).(*runtimev1.SubmitLocalAppScenarioJobRequest)
			if tts {
				bad.GetSpeechSynthesize().Volume = proto.Float32(1)
			} else {
				bad.GetSpeechTranscribe().Diarization = proto.Bool(true)
			}
			submit := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit)
			if _, err := f.service.SubmitLocalAppScenarioJob(submit, bad); err == nil || calls.Load() != 0 {
				t.Fatal("unsupported option dispatched", err)
			}
			response, err := f.service.SubmitLocalAppScenarioJob(submit, request)
			if err != nil {
				t.Fatal(err)
			}
			var job *runtimev1.LocalAppScenarioJob
			deadline := time.Now().Add(10 * time.Second)
			for time.Now().Before(deadline) {
				out, err := f.service.GetLocalAppScenarioJob(decision(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet), &runtimev1.GetLocalAppScenarioJobRequest{JobId: response.Job.JobId})
				if err != nil {
					t.Fatal(err)
				}
				job = out.Job
				if isTerminalScenarioJobStatus(job.Status) {
					break
				}
				time.Sleep(20 * time.Millisecond)
			}
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(job.Artifacts) != 1 || calls.Load() != 1 {
				t.Fatal(job, calls.Load())
			}
			if tts {
				if job.Artifacts[0].GetSizeBytes() <= 0 {
					t.Fatal("no owned audio")
				}
			} else {
				tr := job.GetTranscription()
				if tc.silent {
					if tr.GetStatus() != runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_NO_SPEECH || tr.GetText() != "" {
						t.Fatal(tr)
					}
				} else if tr.GetText() != "Hello." || len(tr.GetWords()) != 1 || tr.Words[0].GetEndSeconds() != .01 || tr.GetLanguage() != "" {
					t.Fatal("native transcript lost", tr)
				}
			}
		})
	}
}
