package ai

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/proto"
)

func TestMiniMaxProtectedNativeFiniteSpeechAndMusic(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("real codec fixture requires ffmpeg")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("real codec fixture requires ffprobe")
	}
	audio := map[string][]byte{}
	for _, encoding := range []string{"mp3", "wav", "pcm", "mulaw", "wav_mulaw", "music"} {
		format, codec, rate, channels := "mp3", "libmp3lame", "32000", "1"
		switch encoding {
		case "wav":
			format, codec = "wav", "pcm_s16le"
		case "pcm":
			format, codec = "s16le", "pcm_s16le"
		case "mulaw":
			format, codec, rate = "mulaw", "pcm_mulaw", "8000"
		case "wav_mulaw":
			format, codec, rate = "wav", "pcm_mulaw", "8000"
		case "music":
			rate, channels = "44100", "2"
		}
		file := filepath.Join(t.TempDir(), "audio")
		if out, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3", "-ar", rate, "-ac", channels, "-c:a", codec, "-f", format, file).CombinedOutput(); err != nil {
			t.Fatalf("codec %v %s", err, out)
		}
		audio[encoding], err = os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
	}
	type sample struct {
		model, format string
		instrumental  bool
	}
	cases := []sample{}
	for _, model := range capabilitydriver.MiniMaxSpeechModels() {
		cases = append(cases, sample{model, "mp3", false})
	}
	for _, format := range []string{"wav", "pcm", "mulaw", "wav_mulaw"} {
		cases = append(cases, sample{"speech-2.8-hd", format, false})
	}
	for _, model := range []string{"music-3.0", "music-2.6"} {
		cases = append(cases, sample{model, "music", false}, sample{model, "music", true})
	}
	for _, tc := range cases {
		t.Run(fmt.Sprintf("%s/%s/%v", tc.model, tc.format, tc.instrumental), func(t *testing.T) {
			music := tc.format == "music"
			capability := "audio.synthesize"
			if music {
				capability = "music.generate"
			}
			rate := int32(32000)
			if tc.format == "mulaw" || tc.format == "wav_mulaw" {
				rate = 8000
			}
			var calls atomic.Int32
			var fail atomic.Bool
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("X-Api-Key") != "" || r.Header.Get("Anthropic-Version") != "" {
					t.Error("native audio auth")
				}
				var b map[string]any
				if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
					t.Error(err)
					return
				}
				if b["model"] != tc.model || b["stream"] != false || b["output_format"] != "hex" || b["input"] != nil || b["duration"] != nil || b["extensions"] != nil {
					t.Error("native mapping", b)
				}
				if music {
					if r.URL.Path != "/proxy/anthropic/v1/music_generation" || b["prompt"] != "A calm original song." || b["is_instrumental"] != tc.instrumental || b["lyrics_optimizer"] != false || b["audio_setting"].(map[string]any)["sample_rate"] != float64(44100) {
						t.Error("music mapping", b)
					}
					if !tc.instrumental && b["lyrics"] != "[Verse]\nThe morning light is here." {
						t.Error("lyrics changed")
					}
				} else {
					if r.URL.Path != "/proxy/anthropic/v1/t2a_v2" || b["text"] != "Hello from Nimi." {
						t.Error("TTS mapping")
					}
					v := b["voice_setting"].(map[string]any)
					if v["voice_id"] != "Cantonese_GentleLady" || v["vol"] != float64(1) || v["pitch"] != float64(0) || v["speed"] != float64(1.25) || b["language_boost"] != "Chinese,Yue" || v["voice"] != nil || v["volume"] != nil {
						t.Error("native voice fields", b)
					}
				}
				w.Header().Set("Content-Type", "application/json")
				if fail.Load() {
					_, _ = fmt.Fprint(w, `{"base_resp":{"status_code":1004},"data":null}`)
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"base_resp": map[string]any{"status_code": 0}, "data": map[string]any{"status": 2, "audio": hex.EncodeToString(audio[tc.format])}, "extra_info": map[string]any{"usage_characters": 19}})
			}))
			defer server.Close()
			f := newManagedCloudScenarioTestFixture(t, "minimax", tc.model, server.URL+"/proxy/anthropic/v1", Config{AllowLoopbackEndpoint: true})
			f.service.jobWorkAuthorizer = newNativeMediaWorkAuthorizer("user-001", "app.minimax-audio", "minimax-audio-subject")
			f.service.requireJobWorkAuthority = true
			bodies, err := runtimeartifact.NewDiskStore(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			f.service.SetRuntimeArtifactStore(bodies)
			if music {
				f.service.canonicalAudio, err = audiomedia.New(ffmpeg, ffprobe)
				if err != nil {
					t.Fatal(err)
				}
				f.service.localMusicStagingRoot = t.TempDir()
			}
			intent := cloudVoiceAIConfigIntent(t, f.connectorID, f.descriptor)
			intent.CapabilityContract = capability
			intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud." + capability + ".minimax", DriverId: "nimi.runtime.driver.minimax", DriverDialect: "provider/media-v1"}
			if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.minimax-audio", intent)); err != nil {
				t.Fatal(err)
			}
			decision := func(op accountservice.LocalAppOperation, cap string) context.Context {
				return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.minimax-audio", RegisteredAppSubject: "minimax-audio-subject", Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: cap})
			}
			req := &runtimev1.SubmitLocalAppScenarioJobRequest{}
			if music {
				s := &runtimev1.LocalAppMusicGenerateJobSpec{Prompt: "A calm original song.", Instrumental: tc.instrumental}
				if !tc.instrumental {
					s.Lyrics = "[Verse]\nThe morning light is here."
				}
				req.Spec = &runtimev1.SubmitLocalAppScenarioJobRequest_MusicGenerate{MusicGenerate: s}
			} else {
				req.Spec = &runtimev1.SubmitLocalAppScenarioJobRequest_SpeechSynthesize{SpeechSynthesize: &runtimev1.LocalAppSpeechSynthesizeJobSpec{Text: "Hello from Nimi.", AudioFormat: tc.format, SampleRateHz: proto.Int32(rate), Speed: proto.Float32(1.25), Pitch: proto.Float32(0), Volume: proto.Float32(1), VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "Cantonese_GentleLady"}}}}
			}
			submit := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit)
			bad := proto.Clone(req).(*runtimev1.SubmitLocalAppScenarioJobRequest)
			if music {
				bad.GetMusicGenerate().DurationSeconds = 10
			} else {
				bad.GetSpeechSynthesize().Pitch = proto.Float32(.5)
			}
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
				deadline := time.Now().Add(12 * time.Second)
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
					if job.Status != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || job.ReasonCode != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED || len(job.Artifacts) != 0 {
						t.Fatal("HTTP200 business error became success", job)
					}
					continue
				}
				if job.Status != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(job.Artifacts) != 1 || job.Artifacts[0].GetSizeBytes() == 0 {
					t.Fatal("missing owned output", job)
				}
				if music {
					m := job.GetMusicGeneration()
					if m.GetAudioInfo().GetDurationMs() < 250 || m.GetAudioInfo().GetDurationMs() > 450 || m.ActualSeed != nil || m.GetTermination() != runtimev1.MusicGenerationTermination_MUSIC_GENERATION_TERMINATION_UNKNOWN || job.Artifacts[0].MimeType != "audio/wav" || req.GetMusicGenerate().GetDurationSeconds() != 0 {
						t.Fatal("measured mix or immutable budget", job)
					}
				}
			}
			if calls.Load() != 2 {
				t.Fatal("native operation repeated", calls.Load())
			}
		})
	}
}
