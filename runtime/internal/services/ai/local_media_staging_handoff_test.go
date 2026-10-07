package ai

import (
	"context"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func TestLocalMediaStagingHandoffCleansEarlyExitAndKeepsActiveInput(t *testing.T) {
	for _, lane := range []string{"music", "speech"} {
		for _, failure := range []string{"canceled-before-start", "queued-write", "rebuild", "active-duplicate"} {
			t.Run(lane+"/"+failure, func(t *testing.T) {
				s := newTestService(nil)
				var assembly *localResolvedAssembly
				var paths []string
				var cleanup func()
				var run func()
				kind := runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE
				head := &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"}
				if lane == "music" {
					s.localMusicStagingRoot = t.TempDir()
					s.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedMusicExecutionForTest(t)})
					req := localMusicJobRequestForTest()
					effective, err := s.captureLocalMusicEffectiveInputs(localMusicIntentContext(context.Background()), head, req.GetSpec().GetMusicGenerate(), nil)
					if err != nil {
						t.Fatal(err)
					}
					assembly = effective.resolvedAssembly
					paths = []string{filepath.Join(effective.plan.StagingDirectory(), "source.wav")}
					if err := os.WriteFile(paths[0], []byte("captured source input"), 0600); err != nil {
						t.Fatal(err)
					}
					cleanup = func() { cleanupLocalMusicPlan(effective.plan) }
					run = func() {
						s.runLocalMusicScenarioJob(context.Background(), "staged-job", s.localMusicJobOrder.reserve(), cleanup)
					}
				} else {
					kind = runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_SEPARATE
					s.localSpeechStagingRoot = t.TempDir()
					s.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedSpeechExecutionForTest(t, capabilitydriver.AudioSeparateContract, "demucs-cpu")})
					payload := canonicalUploadFixture(t)
					binary.LittleEndian.PutUint32(payload[24:28], 44100)
					binary.LittleEndian.PutUint32(payload[28:32], 44100*8)
					if err := s.runtimeArtifacts.Put("source", runtimeartifact.ArtifactRecord{Bytes: payload, MimeType: "audio/wav", SizeBytes: int64(len(payload)), Owner: &runtimeartifact.ArtifactOwner{AppID: head.AppId, SubjectUserID: head.SubjectUserId}, CanonicalAudio: &runtimeartifact.CanonicalAudioInfo{SampleRateHz: 44100, Channels: 2, FrameCount: 2, DataOffset: 56}}); err != nil {
						t.Fatal(err)
					}
					ctx := executionintent.WithIntent(scenarioJobUserContext(head.AppId, head.SubjectUserId), executionintent.Intent{CapabilityContract: capabilitydriver.AudioSeparateContract, LocalLoadoutRef: "test-loadout:audio.separate", Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL})
					effective, err := s.captureLocalSpeechEffectiveInputs(ctx, head, &runtimev1.SubmitScenarioJobRequest{Head: head, ScenarioType: kind, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_AudioSeparate{AudioSeparate: &runtimev1.AudioSeparateScenarioSpec{MimeType: "audio/wav", SourceAudio: &runtimev1.MusicAudioInput{ArtifactId: "source"}}}}})
					if err != nil {
						t.Fatal(err)
					}
					assembly, paths = effective.resolvedAssembly, effective.stagingPaths
					cleanup = func() { cleanupLocalSpeechStagingPaths(effective.stagingPaths) }
					run = func() {
						s.runLocalSpeechScenarioJob(context.Background(), "staged-job", s.localSpeechJobOrder.reserve(), cleanup)
					}
				}
				defer cleanup()
				existingPaths := []string{}
				found := false
				for _, p := range paths {
					if _, err := os.Stat(p); err == nil {
						found = true
						existingPaths = append(existingPaths, p)
					}
				}
				if !found {
					t.Fatal("capture did not stage a real input file")
				}
				paths = existingPaths
				identity, err := projectResolvedAssemblyEffectiveInputIdentity(assembly)
				if err != nil {
					t.Fatal(err)
				}
				job := &runtimev1.ScenarioJob{JobId: "staged-job", Head: head, ScenarioType: kind, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, EffectiveInputIdentity: identity}
				if _, _, err := s.scenarioJobs.createOwnedAndBindAssemblyChecked(job, nil, nil, "", assembly); err != nil {
					t.Fatal(err)
				}
				switch failure {
				case "canceled-before-start":
					if _, ok, err := s.scenarioJobs.transition(job.JobId, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED, nil); err != nil || !ok {
						t.Fatalf("cancel=%v %v", ok, err)
					}
				case "queued-write":
					s.scenarioJobs.persistenceFailure = func(a scenarioJobPersistenceAttempt) error {
						if a.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED {
							return errors.New("queued write failed")
						}
						return nil
					}
				case "rebuild":
					s.scenarioJobs.jobs[job.JobId].resolvedAssembly.LoadPlan.Kind = "invalid-captured-plan"
				case "active-duplicate":
					if !s.scenarioJobs.startExecution(job.JobId) {
						t.Fatal("active executor was not claimed")
					}
				}
				run()
				for _, p := range paths {
					_, err := os.Stat(p)
					if failure == "active-duplicate" {
						if os.IsNotExist(err) {
							t.Fatalf("active input deleted: %s", p)
						}
					} else if !os.IsNotExist(err) {
						t.Errorf("early-exit staging leaked: %s (%v)", p, err)
					}
				}
			})
		}
	}
}
