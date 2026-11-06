package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func TestStabilityNativeMusicPublishesMeasuredCanonicalAudioAndActualSeed(t *testing.T) {
	codec := os.Getenv("NIMI_TEST_FFMPEG_DIR")
	if codec == "" {
		t.Skip("exact engineering codec fixture not supplied")
	}
	ffmpeg, ffprobe := filepath.Join(codec, "ffmpeg"), filepath.Join(codec, "ffprobe")
	if runtime.GOOS == "windows" {
		ffmpeg += ".exe"
		ffprobe += ".exe"
	}
	for _, model := range []string{"stable-audio-2", "stable-audio-2.5", "stable-audio-3"} {
		t.Run(model, func(t *testing.T) {
			async := model == "stable-audio-3"
			format, mimeType := "mp3", "audio/mpeg"
			if async {
				format, mimeType = "wav", "audio/wav"
			}
			// File output gives WAV an exact RIFF size, matching a finite provider file.
			file := filepath.Join(t.TempDir(), "tone."+format)
			if raw, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "1", "-ac", "2", file).CombinedOutput(); err != nil {
				t.Fatalf("codec %v %s", err, raw)
			}
			audio, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			var creates, gets atomic.Int32
			id := strings.Repeat("c", 64)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer fixture" {
					t.Error("credential lost")
				}
				if r.Method == "POST" {
					creates.Add(1)
					if err := r.ParseMultipartForm(1 << 20); err != nil {
						t.Error(err)
						return
					}
					defer r.MultipartForm.RemoveAll()
					if r.FormValue("model") != model || r.FormValue("seed") == "" || r.FormValue("duration") != "30" {
						t.Errorf("request not captured: %v", r.MultipartForm.Value)
					}
					if async {
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(202)
						json.NewEncoder(w).Encode(map[string]string{"id": id})
						return
					}
				} else if r.Method == "GET" && r.URL.Path == "/v2beta/audio/results/"+id {
					gets.Add(1)
				} else {
					t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
					w.WriteHeader(400)
					return
				}
				w.Header().Set("Content-Type", mimeType)
				w.Header().Set("finish-reason", "SUCCESS")
				w.Header().Set("seed", "4294967294")
				w.Write(audio)
			}))
			defer server.Close()
			f := newManagedCloudScenarioTestFixture(t, "stability", model, server.URL, Config{AllowLoopbackEndpoint: true, CloudProviders: map[string]nimillm.ProviderCredentials{"stability": {APIKey: "fixture"}}})
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
			owner := scenarioJobUserContext("app-1", "user-001")
			submitted, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "music.generate", f.targetRef), &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app-1", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: &runtimev1.MusicGenerateScenarioSpec{Prompt: "tone", DurationSeconds: 30}}}})
			if err != nil {
				t.Fatal(err)
			}
			jobID := submitted.GetJob().GetJobId()
			if async {
				waitNativeReceiptHandoff(t, f.service, jobID)
			}
			var completed *runtimev1.ScenarioJob
			deadline := time.Now().Add(15 * time.Second)
			for time.Now().Before(deadline) {
				response, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: jobID})
				if err != nil {
					t.Fatal(err)
				}
				completed = response.GetJob()
				if isTerminalScenarioJobStatus(completed.GetStatus()) {
					break
				}
				time.Sleep(20 * time.Millisecond)
			}
			if completed.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
				t.Fatalf("native music job: %v", completed)
			}
			result := completed.GetMusicGeneration()
			if result.GetActualSeed() != 4294967294 || result.ActualSeed == nil || result.GetTermination() != runtimev1.MusicGenerationTermination_MUSIC_GENERATION_TERMINATION_UNKNOWN || result.GetAudioInfo().GetDurationMs() < 990 || result.GetAudioInfo().GetDurationMs() > 1100 {
				t.Fatalf("lost measured result: %+v", result)
			}
			if creates.Load() != 1 || async && gets.Load() != 2 {
				t.Fatalf("generation repeated: %d/%d", creates.Load(), gets.Load())
			}
			if len(completed.GetArtifacts()) != 1 || completed.GetArtifacts()[0].GetMimeType() != "audio/wav" || len(completed.GetArtifacts()[0].GetBytes()) != 0 {
				t.Fatal("noncanonical or inline output")
			}
			captured := store.originalNativeReceipt(jobID)
			if async && (captured == nil || captured.Model != model) {
				t.Fatal("native exact model not persisted")
			}
			if err := validateMusicGenerationResult(completed); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestStabilityMusicBudgetRejectsOversizedDecodedOutput(t *testing.T) {
	for _, tc := range []struct {
		budget int32
		ms     int64
		ok     bool
	}{{380, 380000, true}, {190, 1000, true}, {30, 30001, false}, {380, 380001, false}, {0, 1000, false}, {1, 0, false}} {
		if (validateCloudMusicMeasuredDuration(capabilitydriver.CloudMediaAdapterStabilityMusic, tc.budget, tc.ms) == nil) != tc.ok {
			t.Fatalf("budget %d actual %d", tc.budget, tc.ms)
		}
	}
}
