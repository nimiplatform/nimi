package ai

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

type scoreCommitFailureStore struct{ *runtimeartifact.MemoryStore }

func (s *scoreCommitFailureStore) PutStream(ctx context.Context, id string, record runtimeartifact.ArtifactRecord, body io.ReadCloser) error {
	if record.MimeType == "text/vnd.abc" {
		_ = body.Close()
		return errors.New("score disk write failed")
	}
	return s.MemoryStore.PutStream(ctx, id, record, body)
}

func TestMusicGenerationRollsBackMixWhenScoreCommitFails(t *testing.T) {
	svc := newTestService(nil)
	store := &scoreCommitFailureStore{runtimeartifact.NewMemoryStore()}
	svc.SetRuntimeArtifactStore(store)
	head := &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "account"}
	svc.scenarioJobs.create(&runtimev1.ScenarioJob{JobId: "music", Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING}, nil)
	directory := t.TempDir()
	wavPath, scorePath := filepath.Join(directory, "music.wav"), filepath.Join(directory, "score.abc")
	if err := writeCanonicalMusicTestWAV(wavPath, 48000, 2, 1); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(scorePath, []byte("X:1\nK:C\nC D|"), 0600); err != nil {
		t.Fatal(err)
	}
	wav, err := inspectMusicWAV(context.Background(), wavPath)
	if err != nil {
		t.Fatal(err)
	}
	err = svc.commitMusicGeneration(context.Background(), "music", head, musicGenerationPublication{WAV: wav, ScorePath: scorePath, RequireScore: true, Termination: runtimev1.MusicGenerationTermination_MUSIC_GENERATION_TERMINATION_MODEL_END})
	job, _ := svc.scenarioJobs.get("music")
	if err == nil || store.Len() != 0 || len(job.GetArtifacts()) != 0 || job.GetMusicGeneration() != nil {
		t.Fatalf("partial commit survived: err=%v bodies=%d job=%v", err, store.Len(), job)
	}
}

func TestMusicScoreCaptureUsesOwnedExpiringCustody(t *testing.T) {
	svc := newTestService(nil)
	data := []byte("X:1\nM:4/4\nL:1/4\nK:C\nC D E F|\n")
	upload, err := svc.UploadLocalAppArtifact(localAppArtifactUploadContext(), &runtimev1.UploadLocalAppArtifactRequest{MimeType: "text/vnd.abc", Bytes: data})
	if err != nil {
		t.Fatal(err)
	}
	if upload.GetExpiresAt() == nil || time.Until(upload.GetExpiresAt().AsTime()) < 23*time.Hour || upload.GetAudioInfo() != nil {
		t.Fatal("score lifetime or format missing")
	}
	spec := &runtimev1.MusicGenerateScenarioSpec{Score: &runtimev1.MusicScoreReference{ArtifactId: upload.GetArtifactId(), Format: runtimev1.MusicScoreFormat_MUSIC_SCORE_FORMAT_ABC}, ScoreConditioning: runtimev1.MusicScoreConditioning_MUSIC_SCORE_CONDITIONING_MELODY_ONLY}
	captured, err := svc.captureMusicScore(localAppArtifactUploadContext(), nil, spec)
	if err != nil || !bytes.Equal(captured, data) {
		t.Fatalf("score capture: %q, %v", captured, err)
	}
	foreign := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "account-1", AppID: "nimi.realm-persona-studio", RegisteredAppSubject: "another-app"})
	if _, err := svc.captureMusicScore(foreign, nil, spec); err == nil {
		t.Fatal("foreign registered App score admitted")
	}
	if _, err := svc.captureMusicScore(context.Background(), &runtimev1.ScenarioRequestHead{AppId: "nimi.realm-persona-studio", SubjectUserId: "account-1"}, spec); err == nil {
		t.Fatal("unprotected caller claimed protected score by AppID")
	}
	spec.Score.Format = runtimev1.MusicScoreFormat_MUSIC_SCORE_FORMAT_MIDI
	if _, err := svc.captureMusicScore(localAppArtifactUploadContext(), nil, spec); err == nil {
		t.Fatal("MIDI silently interpreted as ABC")
	}
	if _, err := svc.UploadLocalAppArtifact(localAppArtifactUploadContext(), &runtimev1.UploadLocalAppArtifactRequest{MimeType: "text/vnd.abc", Bytes: []byte("X:1\nI:include secret\nK:C\nC|")}); err == nil {
		t.Fatal("ABC include directive admitted")
	}
}

func TestMusicGenerationPublishesCompleteSetAndRejectsMissingScore(t *testing.T) {
	for _, withScore := range []bool{true, false} {
		t.Run(map[bool]string{true: "complete", false: "missing-score"}[withScore], func(t *testing.T) {
			svc := newTestService(nil)
			head := &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "account"}
			svc.scenarioJobs.create(&runtimev1.ScenarioJob{JobId: "music", Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING}, nil)
			directory := t.TempDir()
			wavPath := filepath.Join(directory, "music.wav")
			if err := writeCanonicalMusicTestWAV(wavPath, 48000, 2, 1); err != nil {
				t.Fatal(err)
			}
			wav, err := inspectMusicWAV(context.Background(), wavPath)
			if err != nil {
				t.Fatal(err)
			}
			scorePath := ""
			if withScore {
				scorePath = filepath.Join(directory, "score.abc")
				if err := os.WriteFile(scorePath, []byte("X:1\nK:C\nC D E F|"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			err = svc.commitMusicGeneration(context.Background(), "music", head, musicGenerationPublication{WAV: wav, ScorePath: scorePath, RequireScore: true, Termination: runtimev1.MusicGenerationTermination_MUSIC_GENERATION_TERMINATION_BUDGET_LIMIT})
			job, _ := svc.scenarioJobs.get("music")
			if !withScore {
				if err == nil || len(job.GetArtifacts()) != 0 || job.GetMusicGeneration() != nil || job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
					t.Fatal("partial music result published")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := validateMusicGenerationResult(job); err != nil {
				t.Fatal(err)
			}
			if len(job.GetArtifacts()) != 2 {
				t.Fatal("score dropped")
			}
			for _, artifact := range job.GetArtifacts() {
				record, ok := svc.runtimeArtifacts.Get(artifact.GetArtifactId())
				if !ok || record.Owner == nil || record.Owner.SubjectUserID != "account" || record.Owner.AppID != "app" {
					t.Fatal("artifact body not committed with owner before success")
				}
				if artifact.GetMimeType() == "audio/wav" && (record.CanonicalAudio == nil || record.CanonicalAudio.FrameCount != 48000) {
					t.Fatal("mix is not editable canonical PCM")
				}
			}
		})
	}
}

func TestCapturedMusicAudioReferenceUsesCanonicalFrameCoordinates(t *testing.T) {
	svc := canonicalCopyTestService(t)
	source := canonicalUploadFixture(t)
	upload, err := svc.UploadLocalAppArtifact(localAppArtifactUploadContext(), &runtimev1.UploadLocalAppArtifactRequest{Bytes: source, MimeType: "audio/wav", AudioPreparation: &runtimev1.LocalAppCanonicalAudioPreparation{}})
	if err != nil {
		t.Fatal(err)
	}
	ref := &runtimev1.MusicAudioInput{ArtifactId: upload.GetArtifactId(), Range: &runtimev1.AudioFrameRange{StartFrame: 1, EndFrame: 2}}
	captured, err := svc.captureCloudMusicReference(localAppArtifactUploadContext(), nil, ref)
	if err != nil {
		t.Fatal(err)
	}
	if len(captured.Bytes) != 66 || !bytes.Equal(captured.Bytes[58:], source[len(source)-8:]) {
		t.Fatal("canonical selection changed the selected samples")
	}
	ref.Range.EndFrame = 3
	if _, err := svc.captureCloudMusicReference(localAppArtifactUploadContext(), nil, ref); err == nil {
		t.Fatal("out-of-range selection accepted")
	}
}
