package ai

import (
	"context"
	"errors"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestRunningJobRestartUsesDurableDispatchEvidence(t *testing.T) {
	for _, mode := range []string{"before-handoff", "possible-handoff", "historical-absence"} {
		possible := mode != "before-handoff"
		t.Run(mode, func(t *testing.T) {
			store, _ := newDurableScenarioJobStoreForFailureTest(t)
			job := completedScenarioJobForIsolationTest("dispatch-evidence")
			job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED
			assembly := cloudAssemblyForIsolationTest(t, job)
			beginCloudCredentialCustodyForTest(t, store, job.JobId)
			if _, created, err := store.createOwnedAndBindCloudAssemblyChecked(job, nil, nil, "", assembly); err != nil || !created {
				t.Fatal(err)
			}
			if _, changed, err := store.transition(job.JobId, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); err != nil || !changed {
				t.Fatal(err)
			}
			if mode == "possible-handoff" {
				if err := store.markScenarioDispatchPossible(context.Background(), job.JobId); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "historical-absence" {
				store.mu.Lock()
				store.jobs[job.JobId].dispatchPossible = nil
				err := store.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistMaintenance, JobID: job.JobId, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING})
				store.mu.Unlock()
				if err != nil {
					t.Fatal(err)
				}
			}
			restored := cloneScenarioJobStoreForReopenTest(t, store)
			actual, _ := restored.get(job.JobId)
			outcome := runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_NOT_DISPATCHED
			resubmit := runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_CALLER_MAY_RESUBMIT
			if possible {
				outcome = runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_UNKNOWN
				resubmit = runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_OUTCOME_UNCERTAIN
			}
			if actual.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || actual.GetSubmissionOutcome() != outcome || actual.GetInterruption().GetResubmitDisposition() != resubmit {
				t.Fatalf("restart inferred dispatch from RUNNING: %v", actual)
			}
		})
	}
}

func TestDispatchIntentWriteFailurePreventsActualProviderIO(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); http.Error(w, "unexpected create", 500) }))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", server.URL, Config{AllowLoopbackEndpoint: true})
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	f.service.scenarioJobs = store
	store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Operation == scenarioJobPersistDispatchIntent {
			return errors.New("dispatch intent cannot be persisted")
		}
		return nil
	}
	owner := scenarioJobUserContext("nimi.desktop", "user-001")
	response, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "image.generate", f.targetRef), &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "cup"}}}})
	if err != nil {
		t.Fatal(err)
	}
	id := response.GetJob().GetJobId()
	terminal := waitScenarioJobTerminal(t, f.service, id, 5*time.Second)
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || terminal.GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_NOT_DISPATCHED || calls.Load() != 0 {
		t.Fatalf("failed intent allowed external IO or lost proof: %v calls=%d", terminal, calls.Load())
	}
	if _, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: id}); err != nil || calls.Load() != 0 {
		t.Fatalf("terminal Get replayed create: %v calls=%d", err, calls.Load())
	}
	waitCompletedScenarioJobCleanup(t, f.service, id)
}

func TestWithdrawnAuthorityKeepsLateReceiptPrivate(t *testing.T) {
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	job := completedScenarioJobForIsolationTest("late-native-receipt")
	job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED
	assembly := cloudAssemblyForIsolationTest(t, job)
	beginCloudCredentialCustodyForTest(t, store, job.JobId)
	var withdrawn atomic.Bool
	permit := &jobWorkPermit{jobID: job.JobId, authority: accountservice.JobWorkAuthority{Invalidated: make(chan struct{}), WithCurrent: func(_ context.Context, commit func() error) error {
		if withdrawn.Load() {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
		}
		return commit()
	}, Release: func() {}}}
	owner := &localAppJobOwner{AccountID: job.Head.SubjectUserId, ProducerAppID: job.Head.AppId, RegisteredAppSubject: job.Head.AppId, workPermit: permit}
	if _, created, err := store.createOwnedAndBindCloudAssemblyChecked(job, nil, owner, "", assembly); err != nil || !created {
		t.Fatal(err)
	}
	if _, changed, err := store.transition(job.JobId, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); err != nil || !changed {
		t.Fatal(err)
	}
	if err := store.markScenarioDispatchPossible(context.Background(), job.JobId); err != nil {
		t.Fatal(err)
	}
	withdrawn.Store(true)
	receipt := &nimillm.NativeTaskReceipt{Version: 1, Adapter: nimillm.AdapterAlibabaNative, TaskID: "original-task", QueryPathTemplate: "/api/v1/tasks/{task_id}", Artifact: &runtimev1.ScenarioArtifact{ArtifactId: "original-result", MimeType: "image/png"}}
	svc := &Service{scenarioJobs: store}
	if err := svc.publishScenarioNativeReceipt(job.JobId, receipt); err != nil {
		t.Fatal(err)
	}
	result, _ := store.get(job.JobId)
	if result.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || result.GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_UNKNOWN || result.GetReasonCode() != runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN || store.originalNativeReceipt(job.JobId) == nil {
		t.Fatalf("revoked late receipt changed public acceptance or lost custody: %v", result)
	}
	reopened := cloneScenarioJobStoreForReopenTest(t, store)
	restored, _ := reopened.get(job.JobId)
	if !proto.Equal(result, restored) || reopened.originalNativeReceipt(job.JobId) == nil {
		t.Fatal("reopen lost late private receipt or rewrote terminal facts")
	}
}
