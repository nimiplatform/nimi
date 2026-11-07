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
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/proto"
)

func TestMubertProtectedOriginalGenerationOwnsCanonicalMix(t *testing.T) {
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
	if raw, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "1", "-ac", "2", path).CombinedOutput(); err != nil {
		t.Fatalf("codec %v %s", err, raw)
	}
	audio, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var creates, queries, downloads, mode atomic.Int32
	var reveal atomic.Bool
	var endpoint string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/result.mp3" {
			downloads.Add(1)
			if r.Header.Get("customer-id") != "" || r.Header.Get("access-token") != "" || r.Header.Get("Authorization") != "" {
				t.Error("artifact credential leak")
			}
			w.Header().Set("Content-Type", "audio/mpeg")
			if mode.Load() == 1 {
				_, _ = w.Write([]byte("not an audio file"))
			} else {
				_, _ = w.Write(audio)
			}
			return
		}
		if r.Header.Get("customer-id") != "customer" || r.Header.Get("access-token") != "token" || r.Header.Get("Authorization") != "" {
			t.Error("native credentials")
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/proxy/api/v3/public/tracks" && r.Method == "POST" {
			id := creates.Add(1)
			var b map[string]any
			if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
				t.Error(err)
				return
			}
			if b["prompt"] != "A calm cue." || b["duration"] != float64(8) || b["mode"] != "track" || b["format"] != "mp3" || len(b) != 4 {
				t.Error("native input changed", b)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": fmt.Sprintf("track-%d", id), "generations": []any{map[string]any{"session_id": fmt.Sprintf("generation-%d", id), "format": "mp3", "status": "processing"}}}})
			return
		}
		if r.Method == "GET" && r.URL.Path == fmt.Sprintf("/proxy/api/v3/public/tracks/track-%d", creates.Load()) {
			queries.Add(1)
			generations := []any{map[string]any{"session_id": "other-generation", "format": "mp3", "status": "done", "url": endpoint + "/wrong.mp3"}}
			if reveal.Load() {
				generations = append(generations, map[string]any{"session_id": fmt.Sprintf("generation-%d", creates.Load()), "format": "mp3", "status": "done", "url": endpoint + "/result.mp3"})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": fmt.Sprintf("track-%d", creates.Load()), "duration": 99, "generations": generations}})
			return
		}
		t.Errorf("unexpected original-task request %s %s", r.Method, r.URL.Path)
		http.NotFound(w, r)
	}))
	defer server.Close()
	endpoint = server.URL
	f := newManagedCloudScenarioTestFixture(t, "mubert", capabilitydriver.MubertTrackModel, endpoint+"/proxy/api/v3", Config{AllowLoopbackEndpoint: true, CloudProviders: map[string]nimillm.ProviderCredentials{"mubert": {APIKey: "customer::token"}}})
	f.service.jobWorkAuthorizer = newNativeMediaWorkAuthorizer("user-001", "app.mubert", "mubert-subject")
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
	intent.GetCloud().Implementation = &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.music.generate.mubert", DriverId: "nimi.runtime.driver.mubert", DriverDialect: "provider/media-v1"}
	if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", appAIConfig("app.mubert", intent)); err != nil {
		t.Fatal(err)
	}
	decision := func(op accountservice.LocalAppOperation, cap string) context.Context {
		return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.mubert", RegisteredAppSubject: "mubert-subject", Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: cap})
	}
	submit := decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit)
	req := &runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_MusicGenerate{MusicGenerate: &runtimev1.LocalAppMusicGenerateJobSpec{Prompt: "A calm cue.", DurationSeconds: 8}}}
	bad := proto.Clone(req).(*runtimev1.SubmitLocalAppScenarioJobRequest)
	bad.GetMusicGenerate().Instrumental = true
	if _, err := f.service.SubmitLocalAppScenarioJob(submit, bad); err == nil || creates.Load() != 0 {
		t.Fatal("unmapped instrumental condition dispatched", err)
	}
	for _, fault := range []int32{0, 1} {
		mode.Store(fault)
		reveal.Store(false)
		req.ClientSubmissionId = fmt.Sprintf("mubert-native-%d", fault)
		response, err := f.service.SubmitLocalAppScenarioJob(submit, req)
		if err != nil {
			t.Fatal(err)
		}
		jobID := response.Job.JobId
		waitNativeReceiptHandoff(t, f.service, jobID)
		receipt := store.originalNativeReceipt(jobID)
		if receipt.Model != capabilitydriver.MubertTrackModel || receipt.MubertGenerationID != fmt.Sprintf("generation-%d", fault+1) {
			t.Fatal("original generation not captured", receipt)
		}
		mismatch := false
		var job *runtimev1.LocalAppScenarioJob
		deadline := time.Now().Add(15 * time.Second)
		for time.Now().Before(deadline) {
			got, err := f.service.GetLocalAppScenarioJob(decision(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet), &runtimev1.GetLocalAppScenarioJobRequest{JobId: jobID})
			if err != nil {
				t.Fatal(err)
			}
			job = got.Job
			if got.GetObservationIssue().GetReasonCode() == runtimev1.ReasonCode_AI_OUTPUT_INVALID && !reveal.Load() {
				if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || downloads.Load() != fault {
					t.Fatal("wrong generation consumed", job)
				}
				mismatch = true
				reveal.Store(true)
			}
			if isTerminalScenarioJobStatus(job.Status) {
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		if !mismatch {
			t.Fatal("original-generation mismatch was not exercised")
		}
		if fault == 1 {
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || job.GetReasonCode() != runtimev1.ReasonCode_AI_OUTPUT_INVALID || job.GetMusicGeneration() != nil {
				t.Fatal("immutable invalid native mix did not fail", job)
			}
			continue
		}
		result := job.GetMusicGeneration()
		if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || result.GetAudioInfo().GetDurationMs() < 900 || result.GetAudioInfo().GetDurationMs() > 1200 || result.ActualSeed != nil || result.GetTermination() != runtimev1.MusicGenerationTermination_MUSIC_GENERATION_TERMINATION_UNKNOWN || len(job.Artifacts) != 1 || job.Artifacts[0].MimeType != "audio/wav" {
			t.Fatal("canonical measured mix", job)
		}
		replay, err := f.service.SubmitLocalAppScenarioJob(submit, req)
		if err != nil || replay.Job.JobId != jobID || creates.Load() != 1 {
			t.Fatal("owner action replay created another track", err)
		}
	}
	if creates.Load() != 2 || downloads.Load() != 2 || queries.Load() < 4 {
		t.Fatal("original work repeated or body missing", creates.Load(), queries.Load(), downloads.Load())
	}
}
