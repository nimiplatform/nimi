package ai

import (
	"context"
	"encoding/json"
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

// Real codecs exercise custody and measured output; HTTP fixtures are not live
// Loudly model inference or a music-quality acceptance claim.
func TestLoudlyProtectedMusicOwnsMeasuredMixAndRejectsInvalidOutput(t *testing.T) {
	codec := os.Getenv("NIMI_TEST_FFMPEG_DIR")
	if codec == "" {
		t.Skip("exact engineering codec fixture not supplied")
	}
	ffmpeg, ffprobe := filepath.Join(codec, "ffmpeg"), filepath.Join(codec, "ffprobe")
	if runtime.GOOS == "windows" {
		ffmpeg += ".exe"
		ffprobe += ".exe"
	}
	audio := make([][]byte, 2)
	for i, duration := range []string{"1", "31"} {
		path := filepath.Join(t.TempDir(), "tone.mp3")
		if raw, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", duration, "-ac", "2", path).CombinedOutput(); err != nil {
			t.Fatalf("codec %v %s", err, raw)
		}
		var err error
		audio[i], err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
	}
	var mode, creates, downloads atomic.Int32
	var codecAvailable atomic.Bool
	codecAvailable.Store(true)
	var endpoint string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/proxy/v1/api/ai/prompt/songs":
			if creates.Add(1) == 1 {
				codecAvailable.Store(false)
			}
			if r.Method != "POST" || r.Header.Get("API-KEY") != "test-key" || r.Header.Get("Authorization") != "" || r.Header.Get("X-Api-Key") != "" {
				t.Error("native auth")
			}
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
				return
			}
			defer r.MultipartForm.RemoveAll()
			if r.FormValue("model") != "VEGA_2" || r.FormValue("prompt") != "A calm instrumental cue." || r.FormValue("duration") != "30" || r.FormValue("test") != "" || len(r.MultipartForm.Value) != 3 {
				t.Error("native mapping or dummy mode", r.MultipartForm.Value)
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "original-song", "model": "VEGA_2", "duration": 99000, "music_file_path_mp3": endpoint + "/result.mp3"})
		case "/result.mp3":
			downloads.Add(1)
			if r.Header.Get("API-KEY") != "" || r.Header.Get("Authorization") != "" || r.Header.Get("X-Api-Key") != "" {
				t.Error("asset credential leak")
			}
			w.Header().Set("Content-Type", "audio/mpeg")
			switch mode.Load() {
			case 1:
				_, _ = w.Write([]byte("<html>not audio</html>"))
			case 2:
				_, _ = w.Write(audio[1])
			default:
				_, _ = w.Write(audio[0])
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	endpoint = server.URL
	f := newManagedCloudScenarioTestFixture(t, "loudly", "VEGA_2", endpoint+"/proxy/v1", Config{AllowLoopbackEndpoint: true})
	f.service.jobWorkAuthorizer = newNativeMediaWorkAuthorizer("user-001", "app.loudly", "loudly-subject")
	f.service.requireJobWorkAuthority = true
	var err error
	if _, err = audiomedia.New(ffmpeg, ffprobe); err != nil {
		t.Fatal(err)
	}
	f.service.canonicalAudio = audiomedia.NewManaged(func(context.Context) (string, string, error) {
		if !codecAvailable.Load() {
			return "", "", audiomedia.ErrCodecUnavailable
		}
		return ffmpeg, ffprobe, nil
	})
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
	intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.music.generate.loudly", DriverId: "nimi.runtime.driver.loudly", DriverDialect: "provider/media-v1"}
	if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.loudly", intent)); err != nil {
		t.Fatal(err)
	}
	decision := func(op accountservice.LocalAppOperation, cap string) context.Context {
		return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.loudly", RegisteredAppSubject: "loudly-subject", Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: cap})
	}
	req := &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_MusicGenerate{MusicGenerate: &runtimev1.LocalAppMusicGenerateJobSpec{Prompt: "A calm instrumental cue.", Instrumental: true}}}
	submit := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit)
	bad := proto.Clone(req).(*runtimev1.SubmitLocalAppScenarioJobRequest)
	bad.GetMusicGenerate().Seed = proto.Uint32(0)
	if _, err := f.service.SubmitLocalAppScenarioJob(submit, bad); err == nil || creates.Load() != 0 {
		t.Fatal("unsupported seed dispatched", err)
	}
	for _, outputMode := range []int32{0, 1, 2} {
		mode.Store(outputMode)
		res, err := f.service.SubmitLocalAppScenarioJob(submit, req)
		if err != nil {
			t.Fatal(err)
		}
		var job *runtimev1.LocalAppScenarioJob
		observedUnavailable := false
		deadline := time.Now().Add(20 * time.Second)
		for time.Now().Before(deadline) {
			got, err := f.service.GetLocalAppScenarioJob(decision(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet), &runtimev1.GetLocalAppScenarioJobRequest{JobId: res.Job.JobId})
			if err != nil {
				t.Fatal(err)
			}
			job = got.Job
			if outputMode == 0 && got.GetObservationIssue().GetReasonCode() == runtimev1.ReasonCode_AI_MEDIA_CODEC_UNAVAILABLE {
				if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || job.GetMusicGeneration() != nil {
					t.Fatal("codec absence destroyed original candidate", job)
				}
				observedUnavailable = true
				codecAvailable.Store(true)
			}
			if isTerminalScenarioJobStatus(job.Status) {
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		if outputMode != 0 {
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || job.GetReasonCode() != runtimev1.ReasonCode_AI_OUTPUT_INVALID || job.GetMusicGeneration() != nil || len(job.GetArtifacts()) != 0 {
				t.Fatal("invalid audio or over-budget mix published", job)
			}
			continue
		}
		if !observedUnavailable {
			t.Fatal("codec availability recovery was not exercised")
		}
		generation := job.GetMusicGeneration()
		if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || generation.GetAudioInfo().GetDurationMs() < 900 || generation.GetAudioInfo().GetDurationMs() > 1200 || generation.ActualSeed != nil || generation.GetTermination() != runtimev1.MusicGenerationTermination_MUSIC_GENERATION_TERMINATION_UNKNOWN {
			t.Fatal("missing measured output", job)
		}
		if len(job.Artifacts) != 1 || job.Artifacts[0].MimeType != "audio/wav" || generation.GetMixArtifactId() != job.Artifacts[0].ArtifactId || req.GetMusicGenerate().GetDurationSeconds() != 0 {
			t.Fatal("canonical custody or immutable input", job)
		}
		if _, ok := bodies.Stat(generation.GetMixArtifactId()); !ok {
			t.Fatal("mix not committed")
		}
	}
	if creates.Load() != 3 || downloads.Load() != 3 {
		t.Fatal("generation replay or missing original body", creates.Load(), downloads.Load())
	}
}

func TestLoudlyMeasuredDurationBudget(t *testing.T) {
	if err := validateCloudMusicMeasuredDuration(capabilitydriver.CloudMediaAdapterLoudlyMusic, 30, 1000); err != nil {
		t.Fatal(err)
	}
	for _, tc := range [][2]int64{{29, 1000}, {421, 1000}, {30, 0}, {30, 30001}} {
		if err := validateCloudMusicMeasuredDuration(capabilitydriver.CloudMediaAdapterLoudlyMusic, int32(tc[0]), tc[1]); err == nil {
			t.Fatal("invalid measured budget accepted", tc)
		}
	}
}
