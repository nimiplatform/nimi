package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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

func TestSoundverseProtectedOriginalSongAndInstrumentalMix(t *testing.T) {
	codec := os.Getenv("NIMI_TEST_FFMPEG_DIR")
	if codec == "" {
		t.Skip("exact engineering codec fixture not supplied")
	}
	ffmpeg, ffprobe := filepath.Join(codec, "ffmpeg"), filepath.Join(codec, "ffprobe")
	if runtime.GOOS == "windows" {
		ffmpeg += ".exe"
		ffprobe += ".exe"
	}
	path := filepath.Join(t.TempDir(), "tone.mp3")
	if output, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "1", "-ac", "2", path).CombinedOutput(); err != nil {
		t.Fatalf("codec %v %s", err, output)
	}
	audio, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, model := range []string{"v6", "v7"} {
		for _, instrumental := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/%v", model, instrumental), func(t *testing.T) {
				var creates, queries, mints, downloads atomic.Int32
				var permitFile, brokenAudio atomic.Bool
				var endpoint string
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/signed.mp3" {
						downloads.Add(1)
						if r.Header.Get("Authorization") != "" || r.Header.Get("Idempotency-Key") != "" || r.Header.Get("x-api-key") != "" {
							t.Error("credential leaked to file")
						}
						w.Header().Set("Content-Type", "application/octet-stream")
						if brokenAudio.Load() {
							_, _ = fmt.Fprint(w, "<html>invalid audio</html>")
						} else {
							_, _ = w.Write(audio)
						}
						return
					}
					if r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("x-api-key") != "" {
						t.Error("wrong current platform credential")
					}
					w.Header().Set("Content-Type", "application/json")
					operation := "song"
					if instrumental {
						operation = "music"
					}
					switch r.URL.Path {
					case "/proxy/" + model + "/generate/" + operation:
						creates.Add(1)
						var b map[string]any
						if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
							t.Error(err)
							return
						}
						if r.Method != "POST" || r.Header.Get("Idempotency-Key") == "" || b["prompt"] != "A calm cue." || b["parameters"].(map[string]any)["versions"] != float64(1) || b["duration"] != nil || b["model"] != nil || b["license"] != nil {
							t.Error("original generation mapping", b)
						}
						if !instrumental && b["lyrics"] != "  风轻轻吹\n" {
							t.Error("lyrics changed")
						}
						w.WriteHeader(201)
						_, _ = fmt.Fprint(w, `{"job_id":"original-job","status":"queued"}`)
					case "/proxy/" + model + "/status":
						queries.Add(1)
						if r.URL.Query().Get("job_id") != "original-job" {
							t.Error("wrong original job")
						}
						_, _ = fmt.Fprint(w, `{"job_id":"original-job","status":"completed","output":{"assets":[{"file_id":"original-file","blob_hash":"not-a-sha256","url":"https://private.invalid/do-not-fetch"}]}}`)
					case "/proxy/v1/files/original-file/url":
						mints.Add(1)
						fileID := "wrong-file"
						if permitFile.Load() {
							fileID = "original-file"
						}
						_ = json.NewEncoder(w).Encode(map[string]any{"file_id": fileID, "mime_type": "audio/mpeg", "url": endpoint + "/signed.mp3", "expires_at": time.Now().Add(time.Minute).UTC().Format(time.RFC3339)})
					default:
						t.Errorf("unexpected provider IO %s %s", r.Method, r.URL.Path)
						http.NotFound(w, r)
					}
				}))
				defer server.Close()
				endpoint = server.URL
				f := newManagedCloudScenarioTestFixture(t, "soundverse", model, endpoint+"/proxy", Config{AllowLoopbackEndpoint: true})
				f.service.jobWorkAuthorizer = newNativeMediaWorkAuthorizer("user-001", "app.soundverse", "soundverse-subject")
				f.service.requireJobWorkAuthority = true
				f.service.canonicalAudio, err = audiomedia.New(ffmpeg, ffprobe)
				if err != nil {
					t.Fatal(err)
				}
				f.service.localMusicStagingRoot = t.TempDir()
				store, _ := newDurableScenarioJobStoreForFailureTest(t)
				f.service.scenarioJobs = store
				bodies, err := runtimeartifact.NewDiskStore(t.TempDir())
				if err != nil {
					t.Fatal(err)
				}
				f.service.SetRuntimeArtifactStore(bodies)
				intent := cloudVoiceAIConfigIntent(t, f.connectorID, f.descriptor)
				intent.CapabilityContract = "music.generate"
				intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.music.generate.soundverse", DriverId: "nimi.runtime.driver.soundverse", DriverDialect: "provider/media-v1"}
				if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.soundverse", intent)); err != nil {
					t.Fatal(err)
				}
				decision := func(op accountservice.LocalAppOperation, cap string) context.Context {
					return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.soundverse", RegisteredAppSubject: "soundverse-subject", Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: cap})
				}
				request := &runtimev1.SubmitLocalAppScenarioJobRequest{ClientSubmissionId: "soundverse-original", Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_MusicGenerate{MusicGenerate: &runtimev1.LocalAppMusicGenerateJobSpec{Prompt: "A calm cue.", Instrumental: instrumental}}}
				if !instrumental {
					request.GetMusicGenerate().Lyrics = "  风轻轻吹\n"
				}
				submit := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit)
				bad := proto.Clone(request).(*runtimev1.SubmitLocalAppScenarioJobRequest)
				bad.GetMusicGenerate().DurationSeconds = 30
				if _, err := f.service.SubmitLocalAppScenarioJob(submit, bad); err == nil || creates.Load() != 0 {
					t.Fatal("unavailable exact duration dispatched", err)
				}
				for _, broken := range []bool{false, true} {
					brokenAudio.Store(broken)
					permitFile.Store(false)
					request.ClientSubmissionId = fmt.Sprintf("soundverse-%v", broken)
					response, err := f.service.SubmitLocalAppScenarioJob(submit, request)
					if err != nil {
						t.Fatal(err)
					}
					id := response.Job.JobId
					waitNativeReceiptHandoff(t, f.service, id)
					if receipt := store.originalNativeReceipt(id); receipt.Model != model || receipt.TaskID != "original-job" {
						t.Fatal("original identity not durable", receipt)
					}
					expectedDownloads := downloads.Load()
					observedMismatch := false
					var job *runtimev1.LocalAppScenarioJob
					deadline := time.Now().Add(15 * time.Second)
					for time.Now().Before(deadline) {
						got, err := f.service.GetLocalAppScenarioJob(decision(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet), &runtimev1.GetLocalAppScenarioJobRequest{JobId: id})
						if err != nil {
							t.Fatal(err)
						}
						job = got.Job
						if got.GetObservationIssue().GetReasonCode() == runtimev1.ReasonCode_AI_OUTPUT_INVALID && !permitFile.Load() {
							if downloads.Load() != expectedDownloads || job.Status != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING {
								t.Fatal("wrong file consumed", job)
							}
							observedMismatch = true
							permitFile.Store(true)
						}
						if isTerminalScenarioJobStatus(job.Status) {
							break
						}
						time.Sleep(20 * time.Millisecond)
					}
					if !observedMismatch {
						t.Fatal("file identity failure not exercised")
					}
					if broken {
						if job.Status != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || job.ReasonCode != runtimev1.ReasonCode_AI_OUTPUT_INVALID || job.GetMusicGeneration() != nil {
							t.Fatal("invalid complete mix did not fail", job)
						}
						continue
					}
					result := job.GetMusicGeneration()
					if job.Status != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || result.GetAudioInfo().GetDurationMs() < 900 || result.GetAudioInfo().GetDurationMs() > 1200 || result.ActualSeed != nil || result.GetTermination() != runtimev1.MusicGenerationTermination_MUSIC_GENERATION_TERMINATION_UNKNOWN || len(job.Artifacts) != 1 || job.Artifacts[0].MimeType != "audio/wav" {
						t.Fatal("canonical measured mix", job)
					}
					if request.GetMusicGenerate().DurationSeconds != 0 {
						t.Fatal("input mutated")
					}
					replay, err := f.service.SubmitLocalAppScenarioJob(submit, request)
					if err != nil || replay.Job.JobId != id || creates.Load() != 1 {
						t.Fatal("submission replay regenerated", err)
					}
				}
				if creates.Load() != 2 || downloads.Load() != 2 || queries.Load() != 2 || mints.Load() < 4 {
					t.Fatal("missing original work", creates.Load(), queries.Load(), mints.Load(), downloads.Load())
				}
			})
		}
	}
}

func TestSoundverseMeasuredOutputUsesOnlyFixedUpperBudget(t *testing.T) {
	if err := validateCloudMusicMeasuredDuration(capabilitydriver.CloudMediaAdapterSoundverseMusic, 600, 1000); err != nil {
		t.Fatal(err)
	}
	for _, tc := range [][2]int64{{30, 1000}, {600, 0}, {600, 600001}} {
		if err := validateCloudMusicMeasuredDuration(capabilitydriver.CloudMediaAdapterSoundverseMusic, int32(tc[0]), tc[1]); err == nil {
			t.Fatal("invalid measured budget", tc)
		}
	}
}
