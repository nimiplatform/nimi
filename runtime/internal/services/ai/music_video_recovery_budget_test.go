package ai

import (
	"context"
	"errors"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestMusicVideoRecoveryChargesCapturedCopyThroughTerminalReopen(t *testing.T) {
	for _, terminal := range []runtimev1.ScenarioJobStatus{runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED} {
		t.Run(terminal.String(), func(t *testing.T) {
			storePath := filepath.Join(t.TempDir(), "jobs.json")
			store, err := newScenarioJobStoreForLocalStatePath(storePath)
			if err != nil {
				t.Fatal(err)
			}
			job := completedScenarioJobForIsolationTest("music-video-budget")
			job.ScenarioType, job.Status, job.ModelResolved = runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, "music_v2"
			target, _ := structpb.NewStruct(map[string]any{"provider": "elevenlabs", "providerModelId": "music_v2", "remoteModelCatalogId": "catalog-music"})
			spec := &runtimev1.MusicGenerateScenarioSpec{Prompt: "scene", VideoReference: &runtimev1.MusicVideoReference{ArtifactId: "owned-video"}}
			request := &runtimev1.SubmitScenarioJobRequest{Head: job.Head, ScenarioType: job.ScenarioType, ExecutionMode: job.ExecutionMode, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: spec}}}
			assembly, err := newCloudResolvedAssembly(cloudResolvedRequestMedia, "music.generate", &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.music.generate.elevenlabs", DriverId: "nimi.runtime.driver.elevenlabs", DriverDialect: "provider/media-v1"}, target,
				connector.ConnectorRecord{ConnectorID: "connector", Provider: "elevenlabs", OwnerID: job.Head.SubjectUserId, OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED, Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, HasCredential: true}, nil, request, job.ExecutionMode, capabilitydriver.CloudMediaStreamNone, job.TraceId, job.Head.AppId, job.Head.SubjectUserId, nil)
			if err != nil {
				t.Fatal(err)
			}
			assembly.MusicVideoReference = &nimillm.MusicReferenceVideo{ArtifactID: "owned-video", MIMEType: "video/mp4", Bytes: make([]byte, 1<<20)}
			assembly.CredentialCustodyRef = cloudCredentialCustodyRefForTest(job.JobId)
			submission, err := captureLocalAppMusicSubmission(&runtimev1.SubmitLocalAppScenarioJobRequest{ClientSubmissionId: "video-music-action", Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_MusicGenerate{MusicGenerate: &runtimev1.LocalAppMusicGenerateJobSpec{Prompt: "scene", VideoReference: &runtimev1.MusicVideoReference{ArtifactId: "owned-video"}}}})
			if err != nil {
				t.Fatal(err)
			}
			owner := &localAppJobOwner{AccountID: job.Head.SubjectUserId, ProducerAppID: job.Head.AppId, RegisteredAppSubject: "music-owner"}
			captured := int64((len(assembly.MusicVideoReference.Bytes) + 2) / 3 * 4)
			if musicCapturedInputBytes(nil, assembly) != captured {
				t.Fatal("video capture is not charged at durable base64 size")
			}
			store.musicPreparations["other-work"] = maxMusicRecoveryBytes - maxMusicRecoveryOutputBytes - captured
			if _, _, err := store.createOwnedAndBindCapturedInputsChecked(job, nil, owner, "", nil, assembly, false, submission); err != nil {
				t.Fatal(err)
			}
			if err := store.admitMusicRecoveryLocked(0, false); err != nil {
				t.Fatal(err)
			}
			if err := store.admitMusicRecoveryLocked(1, false); !errors.Is(err, errMusicRecoveryCapacity) {
				t.Fatalf("active output reservation or captured copy missing: %v", err)
			}
			delete(store.musicPreparations, "other-work")
			var outputBytes int64
			if terminal == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
				bodyStore := runtimeartifact.NewMemoryStore()
				service := newTestService(nil)
				service.scenarioJobs = store
				service.SetRuntimeArtifactStore(bodyStore)
				wavPath := filepath.Join(t.TempDir(), "mix.wav")
				if err := writeCanonicalMusicTestWAV(wavPath, 48000, 2, 1); err != nil {
					t.Fatal(err)
				}
				wav, err := inspectMusicWAV(context.Background(), wavPath)
				if err != nil {
					t.Fatal(err)
				}
				outputBytes = wav.SizeBytes
				if err := service.commitMusicGeneration(context.Background(), job.JobId, job.Head, musicGenerationPublication{WAV: wav, Termination: runtimev1.MusicGenerationTermination_MUSIC_GENERATION_TERMINATION_MODEL_END}); err != nil {
					t.Fatal(err)
				}
			} else if _, ok, err := store.transition(job.JobId, terminal, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED, nil); err != nil || !ok {
				t.Fatalf("terminal=%v %v", ok, err)
			}
			if err := store.clearTerminalCloudCredentialCustody(job.JobId, assembly.CredentialCustodyRef); err != nil {
				t.Fatal(err)
			}
			reopened, err := newScenarioJobStoreForLocalStatePath(storePath)
			if err != nil {
				t.Fatal(err)
			}
			reopened.musicArtifacts = store.musicArtifacts
			record := reopened.jobs[job.JobId]
			if record == nil || musicCapturedInputBytes(nil, record.cloudAssembly) != captured {
				t.Fatal("reopened capture became uncharged")
			}
			reopened.musicPreparations["other-work"] = maxMusicRecoveryBytes - captured - outputBytes
			if err := reopened.admitMusicRecoveryLocked(0, false); err != nil {
				t.Fatal(err)
			}
			if err := reopened.admitMusicRecoveryLocked(1, false); !errors.Is(err, errMusicRecoveryCapacity) {
				t.Fatalf("terminal copy escaped recovery budget: %v", err)
			}
			record.terminalAt = time.Now().Add(-musicRecoveryRetention)
			reopened.musicPreparations["other-work"] = maxMusicRecoveryBytes - outputBytes - 1
			if err := reopened.admitMusicRecoveryLocked(1, false); err != nil {
				t.Fatal(err)
			}
			if reopened.jobs[job.JobId] != nil {
				t.Fatal("expired captured copy survived pruning")
			}
		})
	}
}
