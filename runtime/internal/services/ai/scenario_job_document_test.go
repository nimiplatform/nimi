package ai

import (
	"bytes"
	"context"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"os"
	"path/filepath"
	"testing"
)

func admittedDispatchJob(t *testing.T) (*scenarioJobStore, string) {
	t.Helper()
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	job := completedScenarioJobForIsolationTest("carrier-job")
	job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED
	assembly := cloudAssemblyForIsolationTest(t, job)
	beginCloudCredentialCustodyForTest(t, store, job.JobId)
	if _, created, err := store.createOwnedAndBindCloudAssemblyChecked(job, nil, nil, "carrier-action", assembly); err != nil || !created {
		t.Fatalf("admit actual Job: %v", err)
	}
	if !store.startExecution(job.JobId) {
		t.Fatal("start admitted work")
	}
	if _, _, err := store.transition(job.JobId, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); err != nil {
		t.Fatal(err)
	}
	if err := store.markScenarioDispatchPossible(context.Background(), job.JobId); err != nil {
		t.Fatal(err)
	}
	return store, job.JobId
}

func TestJobCountAdmissionDoesNotBlockExistingCancel(t *testing.T) {
	store, id := admittedDispatchJob(t)
	for i := 1; i < scenarioJobOwnerMaximumNonterminal; i++ {
		job := completedScenarioJobForIsolationTest(fmt.Sprintf("count-%d", i))
		job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED
		beginCloudCredentialCustodyForTest(t, store, job.JobId)
		if _, created, err := store.createOwnedAndBindCloudAssemblyChecked(job, nil, nil, "", cloudAssemblyForIsolationTest(t, job)); err != nil || !created {
			t.Fatalf("small current record %d rejected: %v", i, err)
		}
	}
	job := completedScenarioJobForIsolationTest("count-rejected")
	job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED
	beginCloudCredentialCustodyForTest(t, store, job.JobId)
	if _, created, err := store.createOwnedAndBindCloudAssemblyChecked(job, nil, nil, "", cloudAssemblyForIsolationTest(t, job)); err == nil || created {
		t.Fatal("new Job exceeded count bound")
	}
	canceled, changed, err := store.requestCancel(id, "owner cancel at full task count")
	if err != nil || !changed || canceled.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("existing control acquired a new Job slot: %v", err)
	}
	if err := store.rewriteDurableStoreLocked(); err != nil {
		t.Fatal(err)
	}
	reopened := cloneScenarioJobStoreForReopenTest(t, store)
	actual, ok := reopened.get(id)
	if !ok || actual.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || actual.GetSubmissionOutcome() == runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_NOT_DISPATCHED {
		t.Fatalf("reopen lost cancellation/dispatch: %v", actual)
	}
}

func TestWriterTornUnacknowledgedDataKeepsPriorDispatch(t *testing.T) {
	store, id := admittedDispatchJob(t)
	file, err := os.OpenFile(store.durablePath, os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString("{\"records\":[broken"); err != nil {
		t.Fatal(err)
	}
	if err := file.Sync(); err != nil {
		t.Fatal(err)
	}
	file.Close()
	reopened, err := newScenarioJobStoreForLocalStatePath(filepath.Join(filepath.Dir(filepath.Dir(store.durablePath)), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	job, ok := reopened.get(id)
	if !ok || job.GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_UNKNOWN || job.GetInterruption().GetResubmitDisposition() != runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_OUTCOME_UNCERTAIN {
		t.Fatalf("torn unacknowledged data invented non-dispatch: %v", job)
	}
}

func TestWriterCorruptAcknowledgedCancelCannotBecomeSafeRetry(t *testing.T) {
	store, id := admittedDispatchJob(t)
	if _, _, err := store.requestCancel(id, "acknowledged cancellation"); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(store.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	raw[len(raw)-2] = '!'
	if err := os.WriteFile(store.durablePath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	reopened, err := newScenarioJobStoreForLocalStatePath(filepath.Join(filepath.Dir(filepath.Dir(store.durablePath)), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if job, found := reopened.get(id); found || !reopened.recoveryIncomplete {
		t.Fatalf("corrupt acknowledged facts were served or treated as absence: %v", job)
	}
}

func TestWriterActualSyncFailureRetainsUncertainDispatch(t *testing.T) {
	store, id := admittedDispatchJob(t)
	store.durable.fileIO = &scenarioJobFileIO{sync: func(file *os.File) error { _ = file.Close(); return file.Sync() }}
	if _, _, err := store.requestCancel(id, "unacknowledged cancellation"); err == nil {
		t.Fatal("actual fsync failure reported durable Cancel")
	}
	current, _ := store.get(id)
	if current.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || store.cancellationRequested(id) {
		t.Fatalf("failed Cancel changed original work: %v", current)
	}
	reopened, err := newScenarioJobStoreForLocalStatePath(filepath.Join(filepath.Dir(filepath.Dir(store.durablePath)), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	job, found := reopened.get(id)
	if !found || job.GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_UNKNOWN || job.GetInterruption().GetResubmitDisposition() != runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_OUTCOME_UNCERTAIN {
		t.Fatalf("failed write invented safe replay: %v", job)
	}
}

func TestExperimentalJobCarrierIsRejectedWithoutDataChanges(t *testing.T) {
	for _, name := range []string{scenarioJobDiskStoreFileName, ".scenario-jobs.capacity"} {
		t.Run(name, func(t *testing.T) {
			state := filepath.Join(t.TempDir(), "state.json")
			root := filepath.Dir(scenarioJobStorePathForLocalStatePath(state))
			if err := os.MkdirAll(root, 0700); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(root, name)
			original := []byte("NIMIJS01unknown original Job facts")
			if err := os.WriteFile(path, original, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := newScenarioJobStoreForLocalStatePath(state); err == nil {
				t.Fatal("experimental layout was silently adopted")
			}
			actual, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(actual, original) {
				t.Fatal("source convergence changed experimental data")
			}
		})
	}
}
