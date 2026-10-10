package ai

import (
	"context"
	"google.golang.org/protobuf/proto"
	"os"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func assertScenarioJobWorkActive(t *testing.T, store *scenarioJobStore, id string) {
	t.Helper()
	store.mu.RLock()
	defer store.mu.RUnlock()
	if record := store.jobs[id]; record == nil || !record.executionStarted {
		t.Fatal("public Cancel released work before actual Host exit")
	}
}

func waitScenarioJobWorkExit(t *testing.T, store *scenarioJobStore, id string) {
	t.Helper()
	store.mu.RLock()
	record := store.jobs[id]
	var done <-chan struct{}
	if record != nil && record.executionStarted {
		done = record.executionDone
	}
	store.mu.RUnlock()
	if done == nil {
		return
	}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("actual Job work did not exit")
	}
}

func waitCompletedScenarioJobCleanup(t *testing.T, svc *Service, id string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		svc.scenarioJobs.mu.RLock()
		r := svc.scenarioJobs.jobs[id]
		done := r != nil && !r.executionStarted && len(r.bodyArtifactIDs) == 0 && (r.cloudAssembly == nil || r.cloudAssembly.CredentialCustodyRef == "")
		svc.scenarioJobs.mu.RUnlock()
		if done {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("completed Job cleanup did not finish")
		}
		time.Sleep(time.Millisecond)
	}
}

func cloneScenarioJobStoreForReopenTest(t *testing.T, store *scenarioJobStore) *scenarioJobStore {
	t.Helper()
	store.mu.RLock()
	raw, err := readScenarioJobDocument(store.durablePath)
	store.mu.RUnlock()
	if err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(t.TempDir(), "state.json")
	directory := filepath.Join(filepath.Dir(state), scenarioJobDiskStoreDirName)
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, scenarioJobDiskStoreFileName), raw, 0600); err != nil {
		t.Fatal(err)
	}
	reopened, err := newScenarioJobStoreForLocalStatePath(state)
	if err != nil {
		t.Fatal(err)
	}
	return reopened
}

func TestAsyncLegacyTimeoutFailsBeforeResourceResolution(t *testing.T) {
	kinds := []runtimev1.ScenarioType{runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE, runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE, runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE, runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_TRANSCRIBE, runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_VOICE_CONVERT, runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_SEPARATE, runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE, runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_FACE_SWAP, runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_FACE_SWAP, runtimev1.ScenarioType_SCENARIO_TYPE_VISION_LOCATE, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_ANNOTATE}
	// No configured resolver/custody/host exists: any accidental pre-check
	// resolution either panics or returns a different reason, rather than passing.
	svc := &Service{}
	for _, kind := range kinds {
		for _, value := range []int32{-1, 1, 480000, 2147483647} {
			r, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{TimeoutMs: value}, ScenarioType: kind, Spec: &runtimev1.ScenarioSpec{}})
			reason, ok := grpcerr.ExtractReasonCode(err)
			if r != nil || !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
				t.Fatalf("%s timeout=%d returned %#v / %v", kind, value, r, err)
			}
		}
	}
}

func TestScenarioJobStorageFailurePreventsAdmission(t *testing.T) {
	store, err := newScenarioJobStoreForLocalStatePath(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(store.durablePath, 0700); err != nil {
		t.Fatal(err)
	}
	job, assembly := localScenarioJobForPersistenceTest(t, "headroom-denied", "loadout", "recipe", "1")
	if _, created, err := store.createOwnedAndBindAssemblyChecked(job, nil, nil, "", assembly); err == nil || created {
		t.Fatalf("unavailable extent admitted a row: %v", err)
	}
	if _, exists := store.get(job.JobId); exists {
		t.Fatal("unreserved input became visible")
	}
}

func TestJobCancelPersistsBeforeActiveWorkExits(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store, err := newScenarioJobStoreForLocalStatePath(path)
	if err != nil {
		t.Fatal(err)
	}
	job := completedScenarioJobForIsolationTest("cancel-active")
	job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED
	assembly := cloudAssemblyForIsolationTest(t, job)
	beginCloudCredentialCustodyForTest(t, store, job.JobId)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if _, created, err := store.createOwnedAndBindCloudAssemblyChecked(job, cancel, nil, "", assembly); err != nil || !created {
		t.Fatalf("admit: %v", err)
	}
	if !store.startExecution(job.JobId) {
		t.Fatal("claim")
	}
	if _, changed, err := store.transition(job.JobId, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); err != nil || !changed {
		t.Fatalf("dispatch: %v", err)
	}
	if err := store.markScenarioDispatchPossible(context.Background(), job.JobId); err != nil {
		t.Fatal(err)
	}
	canceled, changed, err := store.requestCancel(job.JobId, "owner cancel")
	if err != nil || !changed || canceled.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || canceled.GetStopOutcome() != runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_UNCONFIRMED {
		t.Fatalf("cancel: %v %v", canceled, err)
	}
	if ctx.Err() != context.Canceled || !store.jobs[job.JobId].executionStarted {
		t.Fatal("cancel released active use before actual work exit")
	}
	reopened, err := newScenarioJobStoreForLocalStatePath(path)
	if err != nil {
		t.Fatal(err)
	}
	persisted, _ := reopened.get(job.JobId)
	if !proto.Equal(canceled, persisted) {
		t.Fatal("restart rewrote already canceled facts")
	}
	if got, changed, err := store.transition(job.JobId, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, nil); err != nil || changed || !proto.Equal(got, canceled) {
		t.Fatal("late result reopened publication")
	}
	if _, err := store.finishExecution(job.JobId); err != nil {
		t.Fatal(err)
	}
	final, _ := store.get(job.JobId)
	if !proto.Equal(final, canceled) {
		t.Fatal("work exit changed terminal facts")
	}
}

func TestJobOutcomeRejectsFalseStopAndAllowsUncertainResourceTimeout(t *testing.T) {
	r := &runtimev1.ScenarioJob{Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT, SubmissionOutcome: runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_UNKNOWN, ReasonCode: runtimev1.ReasonCode_AI_EXECUTION_RESOURCE_LIMIT_EXCEEDED}
	if err := validateScenarioJobOutcomes(r); err != nil {
		t.Fatal(err)
	}
	r.StopOutcome = runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_CONFIRMED
	if err := validateScenarioJobOutcomes(r); err == nil {
		t.Fatal("uncertain resource timeout claimed external stop")
	}
	r.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
	if err := validateScenarioJobOutcomes(r); err == nil {
		t.Fatal("unknown dispatch claimed confirmed stop")
	}
	r.SubmissionOutcome = runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED
	r.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_TASK_CANCELED
	if err := validateScenarioJobOutcomes(r); err != nil {
		t.Fatal(err)
	}
}

func installDiskCaptureOwnerForTest(t *testing.T, svc *Service) {
	t.Helper()
	store, err := runtimeartifact.NewDiskStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc.SetRuntimeArtifactStore(store)
}
func jobCaptureContextForTest(t *testing.T, svc *Service, ctx context.Context, id string, kind runtimev1.ScenarioType, head *runtimev1.ScenarioRequestHead) context.Context {
	t.Helper()
	now := timestamppb.Now()
	draft := &runtimev1.ScenarioJob{JobId: id, Head: cloneScenarioHead(head), ScenarioType: kind, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, SubmissionOutcome: runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_NOT_DISPATCHED, CreatedAt: now, UpdatedAt: now, TraceId: "trace-" + id, ProgressTotalSteps: 1}
	captured, release := svc.scenarioJobs.captureRowScope(ctx, draft)
	t.Cleanup(release)
	return captured
}
