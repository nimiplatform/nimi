package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/proto"
)

func TestXAIProtectedFiniteSpeechAndTranscription(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("real codec fixture requires ffmpeg")
	}
	audio := map[string][]byte{}
	for _, encoding := range []string{"mp3", "wav", "pcm", "mulaw", "alaw"} {
		format, codec := encoding, "pcm_"+encoding
		switch encoding {
		case "mp3":
			codec = "libmp3lame"
		case "wav":
			codec = "pcm_s16le"
		case "pcm":
			format, codec = "s16le", "pcm_s16le"
		}
		file := filepath.Join(t.TempDir(), "audio")
		if out, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3", "-ar", "24000", "-ac", "1", "-c:a", codec, "-f", format, file).CombinedOutput(); err != nil {
			t.Fatalf("codec %v %s", err, out)
		}
		audio[encoding], err = os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
	}
	type sample struct {
		model, format           string
		timing, diarize, silent bool
	}
	cases := []sample{}
	for _, format := range []string{"mp3", "wav", "pcm", "mulaw", "alaw"} {
		cases = append(cases, sample{capabilitydriver.XAITTSOperation, format, false, false, false})
	}
	for _, format := range []string{"mp3", "wav"} {
		for _, timing := range []bool{false, true} {
			cases = append(cases, sample{capabilitydriver.XAITranscribeModel, format, timing, true, false})
		}
	}
	cases = append(cases, sample{capabilitydriver.XAITranscribeModel, "wav", true, true, true}, sample{capabilitydriver.XAITranscribeModel, "wav", true, false, false})
	for _, tc := range cases {
		t.Run(fmt.Sprintf("%s/%s/timing%v/diarize%v/silent%v", tc.model, tc.format, tc.timing, tc.diarize, tc.silent), func(t *testing.T) {
			tts := tc.model == capabilitydriver.XAITTSOperation
			capability := "audio.transcribe"
			if tts {
				capability = "audio.synthesize"
			}
			var calls atomic.Int32
			var fail atomic.Bool
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Method != "POST" || r.Header.Get("Authorization") != "Bearer test-key" {
					t.Error("native request auth")
				}
				if fail.Load() {
					w.WriteHeader(http.StatusUnauthorized)
					fmt.Fprint(w, `{"error":"invalid key"}`)
					return
				}
				if tts {
					var b map[string]any
					if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
						t.Error(err)
						return
					}
					if r.URL.Path != "/proxy/v1/tts" || b["model"] != nil || b["input"] != nil || b["text"] != "Hello. [pause] 你好。" || b["voice_id"] != "eve" || b["language"] != "auto" || b["speed"] != 1.25 || b["with_timestamps"] != false || b["text_normalization"] != false {
						t.Error("fixed operation body", b)
					}
					f := b["output_format"].(map[string]any)
					if f["codec"] != tc.format || f["sample_rate"] != float64(24000) || tc.format != "mp3" && f["bit_rate"] != nil {
						t.Error("native output format", f)
					}
					w.Header().Set("Content-Type", map[string]string{"mp3": "audio/mpeg", "wav": "audio/wav", "pcm": "audio/pcm", "mulaw": "audio/basic", "alaw": "audio/alaw"}[tc.format])
					_, _ = w.Write(audio[tc.format])
					return
				}
				if r.URL.Path != "/proxy/v1/stt" {
					t.Error("native ASR path")
				}
				reader, err := r.MultipartReader()
				if err != nil {
					t.Error(err)
					return
				}
				fields := map[string]string{}
				last := ""
				for {
					part, err := reader.NextPart()
					if err == io.EOF {
						break
					}
					if err != nil {
						t.Error(err)
						return
					}
					data, err := io.ReadAll(part)
					if err != nil {
						t.Error(err)
						return
					}
					if last == "file" {
						t.Error("file was not last")
					}
					last = part.FormName()
					if last == "file" {
						if !bytes.Equal(data, audio[tc.format]) || part.FileName() != "recording."+tc.format {
							t.Error("recording changed")
						}
					} else {
						fields[last] = string(data)
					}
				}
				if last != "file" || fields["model"] != capabilitydriver.XAITranscribeModel || fields["language"] != "zh" || fields["diarize"] != fmt.Sprint(tc.diarize) || fields["format"] != "false" || fields["multichannel"] != "false" || len(fields) != 5 {
					t.Error("native multipart fields", fields)
				}
				w.Header().Set("Content-Type", "application/json")
				if tc.silent {
					fmt.Fprint(w, `{"text":"","language":"en","duration":0.30,"words":[]}`)
					return
				}
				fmt.Fprint(w, `{"text":"Hello.","language":"en","duration":0.30,"words":[{"text":"Hello.","start":0.01,"end":0.2,"speaker":0}]}`)
			}))
			defer server.Close()
			f := newManagedCloudScenarioTestFixture(t, "xai", tc.model, server.URL+"/proxy/v1", Config{AllowLoopbackEndpoint: true})
			f.service.jobWorkAuthorizer = newNativeMediaWorkAuthorizer("user-001", "app.xai-audio", "xai-audio-subject")
			f.service.requireJobWorkAuthority = true
			bodies, err := runtimeartifact.NewDiskStore(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			f.service.SetRuntimeArtifactStore(bodies)
			intent := cloudVoiceAIConfigIntent(t, f.connectorID, f.descriptor)
			intent.CapabilityContract = capability
			intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud." + capability + ".xai", DriverId: "nimi.runtime.driver.xai", DriverDialect: "provider/media-v1"}
			if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.xai-audio", intent)); err != nil {
				t.Fatal(err)
			}
			decision := func(op accountservice.LocalAppOperation, cap string) context.Context {
				return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.xai-audio", RegisteredAppSubject: "xai-audio-subject", Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: cap})
			}
			req := &runtimev1.SubmitLocalAppScenarioJobRequest{}
			if tts {
				req.Spec = &runtimev1.SubmitLocalAppScenarioJobRequest_SpeechSynthesize{SpeechSynthesize: &runtimev1.LocalAppSpeechSynthesizeJobSpec{Text: "Hello. [pause] 你好。", AudioFormat: tc.format, Speed: proto.Float32(1.25), VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "eve"}}}}
			} else {
				req.Spec = &runtimev1.SubmitLocalAppScenarioJobRequest_SpeechTranscribe{SpeechTranscribe: &runtimev1.LocalAppSpeechTranscribeJobSpec{MimeType: map[string]string{"mp3": "audio/mpeg", "wav": "audio/wav"}[tc.format], Language: "zh", Timestamps: proto.Bool(tc.timing), Diarization: proto.Bool(tc.diarize), AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: audio[tc.format]}}}}
			}
			bad := proto.Clone(req).(*runtimev1.SubmitLocalAppScenarioJobRequest)
			if tts {
				bad.GetSpeechSynthesize().Volume = proto.Float32(1)
			} else {
				bad.GetSpeechTranscribe().Prompt = "Not a keyterm list"
			}
			submit := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit)
			if _, err := f.service.SubmitLocalAppScenarioJob(submit, bad); err == nil || calls.Load() != 0 {
				t.Fatal("unsupported control dispatched", err)
			}
			for _, failure := range []bool{false, true} {
				fail.Store(failure)
				res, err := f.service.SubmitLocalAppScenarioJob(submit, req)
				if err != nil {
					t.Fatal(err)
				}
				var job *runtimev1.LocalAppScenarioJob
				deadline := time.Now().Add(10 * time.Second)
				for time.Now().Before(deadline) {
					out, err := f.service.GetLocalAppScenarioJob(decision(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet), &runtimev1.GetLocalAppScenarioJobRequest{JobId: res.Job.JobId})
					if err != nil {
						t.Fatal(err)
					}
					job = out.Job
					if isTerminalScenarioJobStatus(job.Status) {
						break
					}
					time.Sleep(20 * time.Millisecond)
				}
				if failure {
					if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED || len(job.GetArtifacts()) != 0 {
						t.Fatal("failed auth published output", job)
					}
					continue
				}
				if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(job.GetArtifacts()) != 1 || job.Artifacts[0].GetSizeBytes() <= 0 {
					t.Fatal("missing owned output", job)
				}
				if !tts {
					tr := job.GetTranscription()
					if tc.silent {
						if tr.GetStatus() != runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_NO_SPEECH || tr.GetDiarization().GetStatus() != runtimev1.SpeechDiarizationStatus_SPEECH_DIARIZATION_STATUS_NO_SPEAKERS {
							t.Fatal(tr)
						}
					} else {
						if tr.GetText() != "Hello." || tr.GetLanguage() != "en" || tc.timing && len(tr.GetWords()) != 1 || !tc.timing && len(tr.GetWords()) != 0 || tc.diarize && (len(tr.GetDiarization().GetIntervals()) != 1 || tr.GetDiarization().Intervals[0].GetSpeakerId() != "0") || !tc.diarize && tr.GetDiarization() != nil {
							t.Fatal("native transcript lost", tr)
						}
					}
				}
			}
			if calls.Load() != 2 {
				t.Fatal("operation repeated", calls.Load())
			}
		})
	}
}
