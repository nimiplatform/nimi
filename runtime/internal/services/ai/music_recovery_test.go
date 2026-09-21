package ai

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestMusicPreparationBudgetChargesActualCopiesAndReleasesOnce(t *testing.T) {
	store := newScenarioJobStore()
	bodyStore := runtimeartifact.NewMemoryStore()
	store.setMusicArtifactStore(bodyStore)
	if err := bodyStore.Put("retained-score", runtimeartifact.ArtifactRecord{Bytes: []byte("X:1\nK:C\nC|"), MimeType: "text/vnd.abc", MusicRecoveryUntil: time.Now().Add(time.Hour), Owner: &runtimeartifact.ArtifactOwner{SubjectUserID: "a", RegisteredAppSubject: "s", AppID: "p"}}); err != nil {
		t.Fatal(err)
	}
	releases := make([]func(), 0, 32)
	for i := 0; i < 31; i++ {
		release, err := store.beginMusicPreparation(fmt.Sprintf("prepare-%d", i))
		if err != nil {
			t.Fatal(err)
		}
		releases = append(releases, release)
	}
	if _, err := store.beginMusicPreparation("over-budget"); !errors.Is(err, errMusicRecoveryCapacity) {
		t.Fatalf("retained bytes were uncharged: %v", err)
	}
	releases[0]()
	releases[0]()
	release, err := store.beginMusicPreparation("next")
	if err != nil {
		t.Fatal(err)
	}
	release()
	for _, release := range releases {
		release()
	}
	if len(store.musicPreparations) != 0 {
		t.Fatal("preparation reservation leaked")
	}
	if _, ok := bodyStore.Get("retained-score"); !ok {
		t.Fatal("budget pressure evicted an unexpired body")
	}
}

func TestMusicStagingStartupCleanupIsBoundedToOwnedNames(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"music-staging/music-123.wav", "music-staging/music-notes.wav", "audio-preparation-staging/prepare-456/input-789", "audio-preparation-staging/prepare-456/canonical-audio-987.wav", "audio-preparation-staging/other/input-111"} {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("staging"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := cleanupMusicStagingAtStartup(root); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"music-staging/music-123.wav", "audio-preparation-staging/prepare-456"} {
		if _, err := os.Stat(filepath.Join(root, name)); !os.IsNotExist(err) {
			t.Fatal("interrupted staging remained")
		}
	}
	for _, name := range []string{"music-staging/music-notes.wav", "audio-preparation-staging/other/input-111"} {
		if _, err := os.Stat(filepath.Join(root, name)); err != nil {
			t.Fatal("unrelated staging file was removed")
		}
	}
}

func TestMusicRecoverySurvivesOtherJobPruningAndDoesNotRenew(t *testing.T) {
	store := newScenarioJobStore()
	now := time.Now().UTC()
	submission, _ := captureLocalAppMusicSubmission(musicSubmissionRequest())
	owner := &localAppJobOwner{AccountID: "a", RegisteredAppSubject: "s", ProducerAppID: "p"}
	terminal := now.Add(-time.Hour)
	music := &scenarioJobRecord{job: &runtimev1.ScenarioJob{JobId: "music", ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED, UpdatedAt: timestamppb.New(terminal)}, localAppOwner: owner, musicSubmission: submission, terminalAt: terminal}
	projectMusicRecoveryExpiry(music)
	store.jobs["music"] = music
	for i := 0; i < maxRetainedTerminalScenarioJobs+1; i++ {
		id := fmt.Sprintf("ordinary-%d", i)
		store.jobs[id] = &scenarioJobRecord{job: &runtimev1.ScenarioJob{JobId: id, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED}, terminalAt: now.Add(-time.Minute)}
	}
	store.mu.Lock()
	store.pruneJobsLocked(now)
	store.mu.Unlock()
	got, err := store.getMusicSubmission(owner, submission.ID, submission.RequestSHA256)
	if err != nil || got == nil || !got.GetRecoveryExpiresAt().AsTime().Equal(terminal.Add(musicRecoveryRetention)) {
		t.Fatalf("protected window was evicted or renewed: %v %v", got, err)
	}
	store.mu.Lock()
	store.pruneJobsLocked(terminal.Add(musicRecoveryRetention))
	store.mu.Unlock()
	if got, _ := store.getMusicSubmission(owner, submission.ID, ""); got != nil {
		t.Fatal("expired submission remained recoverable")
	}
}

func TestMusicRecoverySlotLimitRejectsNewWorkWithoutEviction(t *testing.T) {
	store := newScenarioJobStore()
	now := time.Now().UTC()
	for i := 0; i < maxMusicRecoveryJobs; i++ {
		id := fmt.Sprintf("music-%d", i)
		store.jobs[id] = &scenarioJobRecord{job: &runtimev1.ScenarioJob{JobId: id, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED}, musicSubmission: &localAppMusicSubmission{ID: id, ReservedBytes: maxMusicRecoveryOutputBytes}, terminalAt: now}
	}
	store.mu.Lock()
	err := store.admitMusicRecoveryLocked(maxMusicRecoveryOutputBytes, true)
	store.mu.Unlock()
	if !errors.Is(err, errMusicRecoveryCapacity) || len(store.jobs) != maxMusicRecoveryJobs {
		t.Fatalf("slot admission=%v records=%d", err, len(store.jobs))
	}
}

func TestMusicCancellationKeepsReservationUntilExecutorAndWritesExit(t *testing.T) {
	store := newScenarioJobStore()
	releases := make([]func(), 0, 31)
	for i := 0; i < 31; i++ {
		release, err := store.beginMusicPreparation(fmt.Sprintf("prep-%d", i))
		if err != nil {
			t.Fatal(err)
		}
		releases = append(releases, release)
	}
	defer func() {
		for _, release := range releases {
			release()
		}
	}()
	record := &scenarioJobRecord{job: &runtimev1.ScenarioJob{JobId: "canceled", Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED}, musicSubmission: &localAppMusicSubmission{ReservedBytes: maxMusicRecoveryOutputBytes}, terminalAt: time.Now(), executionStarted: true}
	store.jobs["canceled"] = record
	if _, err := store.beginMusicPreparation("too-early"); !errors.Is(err, errMusicRecoveryCapacity) {
		t.Fatal("terminal delivery released a still-executing reservation")
	}
	record.executionStarted = false
	record.musicOutputReservations = map[string]int64{"pending": 1024}
	if _, err := store.beginMusicPreparation("still-writing"); !errors.Is(err, errMusicRecoveryCapacity) {
		t.Fatal("late body commit lost its reservation")
	}
	delete(record.musicOutputReservations, "pending")
	release, err := store.beginMusicPreparation("after-exit")
	if err != nil {
		t.Fatal(err)
	}
	release()
}
