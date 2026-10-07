package ai

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

func retainedVoiceBudgetCapture(t *testing.T, job *runtimev1.ScenarioJob) (*cloudResolvedAssembly, *localAppMusicSubmission) {
	t.Helper()
	assembly := cloudVoiceAssemblyForIsolationTest(t, job)
	reference := &runtimev1.VoiceV2VInput{ReferenceAudioBytes: make([]byte, 1<<20), ReferenceAudioMime: "audio/wav"}
	request := &runtimev1.SubmitScenarioJobRequest{Head: job.Head, ScenarioType: job.ScenarioType, ExecutionMode: job.ExecutionMode,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
			Source: &runtimev1.VoiceCreateScenarioSpec_ReferenceAudio{ReferenceAudio: reference}, TargetModelId: "voice-model",
		}}}}
	var err error
	assembly.Request, err = (protojson.MarshalOptions{UseProtoNames: true}).Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	assembly.VoiceWorkflow.WorkflowType = "reference_audio"
	submission, err := captureLocalAppMusicSubmission(&runtimev1.SubmitLocalAppScenarioJobRequest{ClientSubmissionId: "retained-voice",
		Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VoiceCreate{VoiceCreate: &runtimev1.LocalAppVoiceCreateJobSpec{
			Source: &runtimev1.LocalAppVoiceCreateJobSpec_ReferenceAudio{ReferenceAudio: reference},
		}}})
	if err != nil {
		t.Fatal(err)
	}
	return assembly, submission
}

func TestVoiceRecoveryCaptureBudgetSurvivesTerminalReopenAndExpiry(t *testing.T) {
	for _, terminal := range []runtimev1.ScenarioJobStatus{
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
	} {
		t.Run(terminal.String(), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "jobs.json")
			store, err := newScenarioJobStoreForLocalStatePath(path)
			if err != nil {
				t.Fatal(err)
			}
			job := submittedVoiceScenarioJobForIsolationTest("voice-budget")
			assembly, submission := retainedVoiceBudgetCapture(t, job)
			owner := &localAppJobOwner{AccountID: job.Head.SubjectUserId, ProducerAppID: job.Head.AppId, RegisteredAppSubject: "voice-owner"}
			store.musicPreparations["other-work"] = maxMusicRecoveryBytes - voiceCreationRecoveryBytes
			if _, _, err := store.createOwnedAndBindCapturedInputsChecked(job, nil, owner, "", nil, assembly, false, submission); err != nil {
				t.Fatal(err)
			}
			captured := int64(len(assembly.Request))
			if got := musicCapturedInputBytes(nil, assembly); got != captured || got <= 1<<20 {
				t.Fatalf("encoded capture=%d want=%d", got, captured)
			}
			// Clone/persistence may compact JSON whitespace; budget the retained representation.
			captured = int64(len(store.jobs[job.JobId].cloudAssembly.Request))
			// The 64 MiB active reservation already covers the encoded reference.
			store.musicPreparations["other-work"] = maxMusicRecoveryBytes - voiceCreationRecoveryBytes
			if err := store.admitMusicRecoveryLocked(0, false); err != nil {
				t.Fatalf("active input was charged twice: %v", err)
			}
			if err := store.admitMusicRecoveryLocked(1, false); !errors.Is(err, errMusicRecoveryCapacity) {
				t.Fatalf("active capacity boundary=%v", err)
			}
			delete(store.musicPreparations, "other-work")
			if _, _, err := store.musicArtifactAdmission(job.JobId, "too-large-preview", voiceCreationRecoveryBytes-captured+1); !errors.Is(err, errMusicRecoveryCapacity) {
				t.Fatalf("captured input was excluded from output reservation: %v", err)
			}
			_, release, err := store.musicArtifactAdmission(job.JobId, "bounded-preview", voiceCreationRecoveryBytes-captured)
			if err != nil {
				t.Fatal(err)
			}
			release()
			var transitioned bool
			if terminal == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
				asset := &runtimev1.VoiceAsset{VoiceAssetId: job.JobId, AppId: job.Head.AppId, SubjectUserId: job.Head.SubjectUserId,
					Provider: "voice-provider", ModelId: "voice-model", ProviderVoiceRef: "retained-test-reference",
					Persistence: runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT,
					Status:      runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE, CreatedAt: job.CreatedAt, UpdatedAt: job.UpdatedAt}
				_, transitioned, err = store.transitionVoiceCompleted(job.JobId, asset, voiceAssetReference(job.JobId), nil)
			} else {
				_, transitioned, err = store.transition(job.JobId, terminal, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED, nil)
			}
			if err != nil || !transitioned {
				t.Fatalf("terminal persistence=%v %v", transitioned, err)
			}
			if err := store.clearTerminalCloudCredentialCustody(job.JobId, assembly.CredentialCustodyRef); err != nil {
				t.Fatal(err)
			}
			reopened, err := newScenarioJobStoreForLocalStatePath(path)
			if err != nil {
				t.Fatal(err)
			}
			record := reopened.jobs[job.JobId]
			if record == nil || record.cloudAssembly == nil {
				t.Fatal("retained voice capture lost on reopen")
			}
			captured = int64(len(record.cloudAssembly.Request))
			if musicCapturedInputBytes(nil, record.cloudAssembly) != captured || captured <= 1<<20 {
				t.Fatal("reopened encoded input is uncharged")
			}
			reopened.musicPreparations["other-work"] = maxMusicRecoveryBytes - captured
			if err := reopened.admitMusicRecoveryLocked(0, false); err != nil {
				t.Fatal(err)
			}
			if err := reopened.admitMusicRecoveryLocked(1, false); !errors.Is(err, errMusicRecoveryCapacity) {
				t.Fatalf("terminal encoded input escaped shared budget: %v", err)
			}
			if got, err := reopened.getMusicSubmission(owner, submission.ID, submission.RequestSHA256); err != nil || got == nil || got.GetStatus() != terminal {
				t.Fatalf("recovery identity/status=%v %v", got, err)
			}
			record.terminalAt = time.Now().Add(-musicRecoveryRetention)
			reopened.musicPreparations["other-work"] = maxMusicRecoveryBytes - 1
			if err := reopened.admitMusicRecoveryLocked(1, false); err != nil {
				t.Fatalf("expired capture remained charged: %v", err)
			}
			if reopened.jobs[job.JobId] != nil {
				t.Fatal("expired voice Job survived prune")
			}
		})
	}
}
