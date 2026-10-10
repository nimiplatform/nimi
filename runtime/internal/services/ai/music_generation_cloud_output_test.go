package ai

import (
	"errors"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestElevenLabsChecksMeasuredOutputAgainstCapturedBudget(t *testing.T) {
	adapter := capabilitydriver.CloudMediaAdapterElevenLabsMusic
	if err := validateCloudMusicMeasuredDuration(adapter, 600, 9930); err != nil {
		t.Fatal(err)
	}
	for _, duration := range []int64{0, 600001} {
		if err := validateCloudMusicMeasuredDuration(adapter, 600, duration); err == nil {
			t.Fatal("invalid measured output accepted")
		}
	}
}

func TestLyriaClipChecksMeasuredAudioAgainstCapturedBudget(t *testing.T) {
	adapter := capabilitydriver.CloudMediaAdapterGeminiLyriaClipGenerateContent
	if err := validateCloudMusicMeasuredDuration(adapter, 35, 30772); err != nil {
		t.Fatalf("measured real clip within captured budget: %v", err)
	}
	for _, tc := range []struct {
		budget   int32
		duration int64
	}{{budget: 30, duration: 30772}, {budget: 35, duration: 35001}, {budget: 35, duration: 0}} {
		err := validateCloudMusicMeasuredDuration(adapter, tc.budget, tc.duration)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
			t.Fatalf("budget=%d duration=%d reason=%v present=%v err=%v", tc.budget, tc.duration, reason, ok, err)
		}
	}
	if err := validateCloudMusicMeasuredDuration(capabilitydriver.CloudMediaAdapterStabilityMusic, 30, 35001); err != nil {
		t.Fatalf("unrelated provider inherited Lyria limit: %v", err)
	}
}

func TestLyria35ChecksMeasuredSongAgainstCapturedUpperBudget(t *testing.T) {
	adapter := capabilitydriver.CloudMediaAdapterGeminiLyria35GenerateContent
	if err := validateCloudMusicMeasuredDuration(adapter, 300, 125000); err != nil {
		t.Fatalf("two-minute song inside five-minute captured budget: %v", err)
	}
	if err := validateCloudMusicMeasuredDuration(adapter, 300, 300000); err != nil {
		t.Fatalf("song exactly at captured 300-second ceiling: %v", err)
	}
	for _, sample := range []struct {
		budget   int32
		duration int64
	}{{120, 120000}, {300, 300001}, {0, 1000}} {
		err := validateCloudMusicMeasuredDuration(adapter, sample.budget, sample.duration)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
			t.Fatalf("song budget=%d measured=%d reason=%v present=%v err=%v", sample.budget, sample.duration, reason, ok, err)
		}
	}
}

func TestNativeMusicOwnsRawAndCanonicalSetAndRecoversFinalCommit(t *testing.T) {
	codec := os.Getenv("NIMI_TEST_FFMPEG_DIR")
	if codec == "" {
		t.Skip("exact engineering codec fixture not supplied")
	}
	ffmpeg, ffprobe := filepath.Join(codec, "ffmpeg"), filepath.Join(codec, "ffprobe")
	mp3, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "1", "-ac", "2", "-f", "mp3", "pipe:1").Output()
	if err != nil {
		t.Fatal(err)
	}
	var creates, queries, downloads atomic.Int32
	var endpoint string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/public/tracks":
			creates.Add(1)
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"id":"track-original"}`)
		case "/public/tracks/track-original":
			queries.Add(1)
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"data":{"generations":[{"status":"done","url":"%s/audio.mp3"}]}}`, endpoint)
		case "/audio.mp3":
			downloads.Add(1)
			w.Header().Set("Content-Type", "audio/mpeg")
			w.Write(mp3)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	endpoint = server.URL
	f := newManagedCloudScenarioTestFixture(t, "mubert", "mubert-track-v3", endpoint, Config{AllowLoopbackEndpoint: true, CloudProviders: map[string]nimillm.ProviderCredentials{"mubert": {APIKey: "customer::token"}}})
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
	id := submitted.GetJob().GetJobId()
	waitNativeReceiptHandoff(t, f.service, id)
	store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			return errors.New("final commit unavailable")
		}
		return nil
	}
	pending, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || !store.hasResultCandidate(id) || pending.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING {
		t.Fatalf("canonical result not retained: %v %v", pending, err)
	}
	entries, err := os.ReadDir(f.service.localMusicStagingRoot)
	if err != nil || len(entries) != 0 {
		t.Fatalf("codec created unowned staging: %v %v", entries, err)
	}
	mixID := id + "-music-mix"
	if _, visible := bodies.Stat(mixID); visible {
		t.Fatal("canonical mix escaped before Job commit")
	}
	mix, complete := bodies.JobBodyStat(id, mixID)
	if !complete || mix.CanonicalAudio == nil {
		t.Fatal("canonical facts were not privately retained")
	}
	store.persistenceFailure = nil
	completed, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || completed.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || completed.GetJob().GetMusicGeneration().GetMixArtifactId() != mixID || creates.Load() != 1 || queries.Load() != 1 || downloads.Load() != 1 {
		t.Fatalf("recovery replayed provider or lost mix: %v %v (%d/%d/%d)", completed, err, creates.Load(), queries.Load(), downloads.Load())
	}
	waitCompletedScenarioJobCleanup(t, f.service, id)
	if _, complete := bodies.JobBodyStat(id, store.originalNativeReceipt(id).Artifact.GetArtifactId()); complete {
		t.Fatal("raw provider scratch survived completed cleanup")
	}
}
