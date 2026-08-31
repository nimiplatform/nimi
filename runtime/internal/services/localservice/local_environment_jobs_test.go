package localservice

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
)

// localEnvironmentDependencyJobSettledForTest reports whether a job has reached
// a state the background goroutine no longer advances. Async-job tests poll for
// this before asserting its final projection.
func localEnvironmentDependencyJobSettledForTest(state string) bool {
	return localEnvironmentDependencyJobTerminal(state)
}

// pollLocalEnvironmentDependencyJobToTerminal waits for the async background
// goroutine to drive the job to a settled state and returns the settled job.
// With async execution Start returns a non-terminal job immediately, so tests
// that assert a terminal outcome must observe it by polling.
func pollLocalEnvironmentDependencyJobToTerminal(t *testing.T, svc *Service, jobID string) localEnvironmentDependencyJobState {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		job, ok := svc.localEnvironmentDependencyJob(jobID)
		if !ok {
			t.Fatalf("local environment dependency job %s not found", jobID)
		}
		if localEnvironmentDependencyJobSettledForTest(job.State) {
			return job
		}
		if time.Now().After(deadline) {
			t.Fatalf("local environment dependency job %s did not settle (last=%q)", jobID, job.State)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestLocalEnvironmentDependencyJobDedupesActiveEnvironment(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	req := localEnvironmentJobRequestForTest(t, svc)

	first, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, nil)
	if err != nil {
		t.Fatalf("start first job: %v", err)
	}
	second, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, nil)
	if err != nil {
		t.Fatalf("start duplicate job: %v", err)
	}
	if first.JobID != second.JobID {
		t.Fatalf("expected duplicate request to return active job %s, got %s", first.JobID, second.JobID)
	}
}

func TestLocalEnvironmentDependencyJobSuccessPromotesSelectedSource(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	req := localEnvironmentJobRequestForTest(t, svc)

	started, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState, localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		return localEnvironmentDependencyJobResult{
			State:                 localEnvironmentStateReadyManaged,
			SourceKind:            localEnvironmentSourceManaged,
			CanonicalRoot:         localEnvironmentPortableFileForTest(t, svc),
			Version:               "1.0.0",
			CompatibilityEvidence: []string{"test compatibility"},
			VerifiedArtifacts:     []string{localEnvironmentPortableFileForTest(t, svc)},
			SelectedConsumers:     []string{"llama.cpp.cuda"},
			AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
		}, nil
	})
	if err != nil {
		t.Fatalf("start job: %v", err)
	}
	if localEnvironmentDependencyJobTerminal(started.State) {
		t.Fatalf("expected non-terminal job from async Start, got %q", started.State)
	}
	job := pollLocalEnvironmentDependencyJobToTerminal(t, svc, started.JobID)
	if job.State != localEnvironmentStateReadyManaged {
		t.Fatalf("expected ready_managed job, got %+v", job)
	}
	if job.SelectedSourceRecordID == "" {
		t.Fatalf("expected selected source promotion")
	}
	record, ok := svc.localEnvironmentSelectedSourceRecord(req.EnvironmentKey)
	if !ok {
		t.Fatalf("expected selected source record")
	}
	if record.RecordID != job.SelectedSourceRecordID {
		t.Fatalf("job selected source mismatch: %s vs %s", job.SelectedSourceRecordID, record.RecordID)
	}
}

func TestLocalEnvironmentSelectedSourceRecordIdentityIgnoresConsumerExpansion(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	environmentKey := localEnvironmentKey(
		localEnvironmentFamilyNativeLlama,
		"llama.cpp.package",
		"host_test",
		"darwin/arm64",
		t.TempDir(),
	)
	first := svc.upsertLocalEnvironmentSelectedSourceRecord(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyNativeLlama,
		DependencyID:      "llama.cpp.package",
		EnvironmentKey:    environmentKey,
		CanonicalRoot:     filepath.Join(t.TempDir(), "llama-server"),
		SelectedConsumers: []string{"llama.cpp.cpu"},
	}))
	second := svc.upsertLocalEnvironmentSelectedSourceRecord(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyNativeLlama,
		DependencyID:      "llama.cpp.package",
		EnvironmentKey:    environmentKey,
		CanonicalRoot:     first.CanonicalRoot,
		SelectedConsumers: []string{"llama.cpp.cuda"},
	}))

	if second.RecordID != first.RecordID {
		t.Fatalf("selected source record id changed after consumer expansion: first=%q second=%q", first.RecordID, second.RecordID)
	}
	if _, ok := svc.localEnvironmentSelectedSourceRecordForDependency(environmentKey, localEnvironmentFamilyNativeLlama, "llama.cpp.package", "llama.cpp.cpu"); !ok {
		t.Fatal("expanded selected source lost original cpu consumer")
	}
	if _, ok := svc.localEnvironmentSelectedSourceRecordForDependency(environmentKey, localEnvironmentFamilyNativeLlama, "llama.cpp.package", "llama.cpp.cuda"); !ok {
		t.Fatal("expanded selected source did not admit new cuda consumer")
	}
	if got := len(svc.localEnvironmentSelectedSources); got != 1 {
		t.Fatalf("selected source expansion created parallel source truth records, got %d", got)
	}
}

func TestLocalEnvironmentDependencyJobCancelDoesNotPromote(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	req := localEnvironmentJobRequestForTest(t, svc)

	job, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, nil)
	if err != nil {
		t.Fatalf("start job: %v", err)
	}
	cancelled, ok, _ := svc.cancelLocalEnvironmentDependencyJob(job.JobID)
	if !ok {
		t.Fatalf("cancel job failed")
	}
	if cancelled.State != localEnvironmentStateCancelled {
		t.Fatalf("expected cancelled, got %+v", cancelled)
	}
	if _, ok := svc.localEnvironmentSelectedSourceRecord(req.EnvironmentKey); ok {
		t.Fatalf("cancelled job must not promote selected source")
	}
}

func TestLocalEnvironmentDependencyJobFailureDoesNotPromote(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	req := localEnvironmentJobRequestForTest(t, svc)

	started, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState, localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		return localEnvironmentDependencyJobResult{}, errors.New("verify failed")
	})
	if err != nil {
		t.Fatalf("start job: %v", err)
	}
	job := pollLocalEnvironmentDependencyJobToTerminal(t, svc, started.JobID)
	if job.State != localEnvironmentStateFailed {
		t.Fatalf("expected failed state, got %+v", job)
	}
	if job.ReasonCode != "LOCAL_ENVIRONMENT_DEPENDENCY_JOB_FAILED" {
		t.Fatalf("failed job reason = %q", job.ReasonCode)
	}
	if job.Retryable {
		t.Fatal("deterministic verification failure must not be retryable")
	}
	if job.RecoveryDisposition != localEnvironmentJobRecoveryNotRetryable {
		t.Fatalf("failed job recovery = %q", job.RecoveryDisposition)
	}
	if _, ok := svc.localEnvironmentSelectedSourceRecord(req.EnvironmentKey); ok {
		t.Fatalf("failed job must not promote selected source")
	}
}

func TestLocalEnvironmentDependencyJobClassifiesAutoRecoveryInRuntime(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	req := localEnvironmentJobRequestForTest(t, svc)

	started, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState, localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		return localEnvironmentDependencyJobResult{}, fmt.Errorf("download model file: %w", filedownload.ErrTransientAttemptsExhausted)
	})
	if err != nil {
		t.Fatalf("start job: %v", err)
	}
	job := pollLocalEnvironmentDependencyJobToTerminal(t, svc, started.JobID)
	if job.State != localEnvironmentStateFailed {
		t.Fatalf("expected failed state, got %+v", job)
	}
	if job.ReasonCode != "LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED" {
		t.Fatalf("reason = %q, want interrupted", job.ReasonCode)
	}
	if !job.Retryable {
		t.Fatal("interrupted initial materialization must remain retryable")
	}
	if job.RecoveryDisposition != localEnvironmentJobRecoveryAutoRetryTransient {
		t.Fatalf("recovery = %q, want auto transient retry", job.RecoveryDisposition)
	}
}

func TestLocalEnvironmentDependencyJobDiagnosticTextNeverGrantsRetry(t *testing.T) {
	tests := []struct {
		name   string
		phase  string
		detail string
	}{
		{name: "downloading eof", phase: localEnvironmentStateDownloading, detail: "download model file: unexpected EOF"},
		{name: "offline frozen sync timeout", phase: localEnvironmentStateInstalling, detail: "verify offline frozen sync: context deadline exceeded"},
		{name: "import reset", phase: localEnvironmentStateVerifying, detail: "verify import: connection reset by peer"},
		{name: "torch broken pipe", phase: localEnvironmentStateVerifying, detail: "verify Torch allocation: broken pipe"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newLocalEnvironmentJobTestService(t)
			defer func() { svc.Close() }()
			req := localEnvironmentJobRequestForTest(t, svc)

			started, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(_ context.Context, _ localEnvironmentDependencyJobState, report localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
				report.State(test.phase)
				return localEnvironmentDependencyJobResult{}, errors.New(test.detail)
			})
			if err != nil {
				t.Fatalf("start job: %v", err)
			}
			job := pollLocalEnvironmentDependencyJobToTerminal(t, svc, started.JobID)
			if job.Retryable || job.RecoveryDisposition != localEnvironmentJobRecoveryNotRetryable {
				t.Fatalf("diagnostic text granted retry: %+v", job)
			}
			if job.ReasonCode != "LOCAL_ENVIRONMENT_DEPENDENCY_JOB_FAILED" {
				t.Fatalf("reason = %q, want generic typed failure", job.ReasonCode)
			}
		})
	}
}

func TestImmutablePythonDependencyProfileContractFailuresAreNotRetryable(t *testing.T) {
	tests := []struct {
		name   string
		result localEnvironmentDependencyJobResult
		err    error
	}{
		{
			name: "lock identity mismatch",
			err:  errors.New("verify immutable dependency profile: exact lock digest mismatch"),
		},
		{
			name: "compatibility requires repair",
			result: localEnvironmentDependencyJobResult{
				State:           localEnvironmentStateRepairRequired,
				AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
				FailureDetail:   "dependency profile Python ABI/import compatibility mismatch",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newLocalEnvironmentJobTestService(t)
			defer func() { svc.Close() }()
			req := localEnvironmentJobRequestForTest(t, svc)
			req.DependencyFamily = localEnvironmentFamilyPythonPackageSet
			req.DependencyID = "python-profile.test-lock-digest"

			started, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState, localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
				return test.result, test.err
			})
			if err != nil {
				t.Fatalf("start job: %v", err)
			}
			job := pollLocalEnvironmentDependencyJobToTerminal(t, svc, started.JobID)
			if job.Retryable {
				t.Fatalf("immutable profile contract failure projected retryable: %+v", job)
			}
			if test.result.State == localEnvironmentStateRepairRequired {
				if job.State != localEnvironmentStateRepairRequired || job.RecoveryDisposition != localEnvironmentJobRecoveryRepairRequired {
					t.Fatalf("repair-required projection = %+v", job)
				}
				return
			}
			if job.State != localEnvironmentStateFailed || job.RecoveryDisposition != localEnvironmentJobRecoveryNotRetryable {
				t.Fatalf("failed profile projection = %+v", job)
			}
		})
	}
}

func TestLocalEnvironmentDependencyJobUnderspecifiedReadyResultDoesNotPromote(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	req := localEnvironmentJobRequestForTest(t, svc)

	started, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState, localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		return localEnvironmentDependencyJobResult{
			SourceKind:    localEnvironmentSourceManaged,
			CanonicalRoot: localEnvironmentPortableFileForTest(t, svc),
		}, nil
	})
	if err != nil {
		t.Fatalf("start job: %v", err)
	}
	job := pollLocalEnvironmentDependencyJobToTerminal(t, svc, started.JobID)
	if job.State != localEnvironmentStateFailed {
		t.Fatalf("expected failed state for underspecified ready result, got %+v", job)
	}
	if _, ok := svc.localEnvironmentSelectedSourceRecord(req.EnvironmentKey); ok {
		t.Fatalf("underspecified ready result must not promote selected source")
	}
}

func TestLocalEnvironmentDependencyJobRepairRequiredBlocksPlan(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	req := localEnvironmentJobRequestForTestWithRoot(t, svc, runtimeDataRoot)

	started, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState, localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		return localEnvironmentDependencyJobResult{
			State:                 localEnvironmentStateReadyManaged,
			SourceKind:            localEnvironmentSourceManaged,
			CanonicalRoot:         localEnvironmentPortableFileForTest(t, svc),
			Version:               "1.0.0",
			CompatibilityEvidence: []string{"test compatibility"},
			VerifiedArtifacts:     []string{localEnvironmentPortableFileForTest(t, svc)},
			SelectedConsumers:     []string{"llama.cpp.cuda"},
			AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
		}, nil
	})
	if err != nil {
		t.Fatalf("start job: %v", err)
	}
	if job := pollLocalEnvironmentDependencyJobToTerminal(t, svc, started.JobID); job.State != localEnvironmentStateReadyManaged {
		t.Fatalf("expected ready_managed job before repair, got %+v", job)
	}
	if _, ok, _ := svc.markLocalEnvironmentDependencyRepairRequired(req.EnvironmentKey, "hash_mismatch"); !ok {
		t.Fatalf("mark repair required failed")
	}
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-text",
		ConsumerScope:   "llama.cpp.cuda",
		HostProfile:     localEnvironmentNvidiaProfile(),
		RuntimeDataRoot: runtimeDataRoot,
	})
	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyNativeLlama)
	if dep.State != localEnvironmentStateRepairRequired {
		t.Fatalf("expected repair_required dependency, got %+v", dep)
	}
}

func TestLocalEnvironmentDependencyJobsPersistAcrossRestart(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "local-state.json")
	runtimeDataRoot := filepath.Join(dir, "runtime-data")
	svc, err := NewWithProductControlDataRoot(slog.Default(), nil, statePath, 10, filepath.Join(runtimeDataRoot, "models"), runtimeDataRoot)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	req := localEnvironmentJobRequestForTestWithRoot(t, svc, runtimeDataRoot)
	binaryPath := filepath.Join(runtimeDataRoot, "environments", "llama", "1.0.0", "llama-server.exe")
	if err := os.MkdirAll(filepath.Dir(binaryPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(binaryPath, []byte("llama"), 0o700); err != nil {
		t.Fatal(err)
	}
	started, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState, localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		return localEnvironmentDependencyJobResult{
			State:                 localEnvironmentStateReadyManaged,
			SourceKind:            localEnvironmentSourceManaged,
			CanonicalRoot:         binaryPath,
			Version:               "1.0.0",
			CompatibilityEvidence: []string{"test compatibility"},
			VerifiedArtifacts:     []string{binaryPath},
			SelectedConsumers:     []string{"llama.cpp.cuda"},
			AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
		}, nil
	})
	if err != nil {
		t.Fatalf("start job: %v", err)
	}
	job := pollLocalEnvironmentDependencyJobToTerminal(t, svc, started.JobID)
	if job.State != localEnvironmentStateReadyManaged {
		t.Fatalf("expected ready_managed job before restart, got %+v", job)
	}
	svc.Close()

	restored, err := NewWithProductControlDataRoot(slog.Default(), nil, statePath, 10, filepath.Join(runtimeDataRoot, "models"), runtimeDataRoot)
	if err != nil {
		t.Fatalf("restore service: %v", err)
	}
	defer func() { restored.Close() }()
	restoredJob, ok := restored.localEnvironmentDependencyJobs[job.JobID]
	if !ok {
		t.Fatalf("expected restored job %s", job.JobID)
	}
	if restoredJob.SelectedSourceRecordID == "" {
		t.Fatalf("expected restored promoted selected source id")
	}
	restoredRecord, ok := restored.localEnvironmentSelectedSourceRecord(req.EnvironmentKey)
	if !ok {
		t.Fatalf("expected restored selected source record")
	}
	if restoredJob.State != localEnvironmentStateReadyManaged || restoredJob.SelectedSourceRecordID != restoredRecord.RecordID {
		t.Fatalf("restored ready job/source snapshot mismatch: job=%+v source=%+v", restoredJob, restoredRecord)
	}
}

func TestRestoreCanonicalizesPersistedPythonSelectedSourceOwnership(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "local-state.json")
	runtimeDataRoot := filepath.Join(dir, "runtime-data")
	legacy := localEnvironmentSelectedSourceRecordState{
		RecordID:           "src_legacy_python_profile",
		DependencyFamily:   localEnvironmentFamilyPythonPackageSet,
		DependencyID:       "python-profile.legacy",
		EnvironmentKey:     localEnvironmentPythonProfileKey(localEnvironmentFamilyPythonPackageSet, "python-profile.legacy", runtimeDataRoot),
		SourceKind:         localEnvironmentSourceManaged,
		CanonicalRoot:      filepath.Join(runtimeDataRoot, "environments", "python-profiles", "legacy"),
		SelectedConsumers:  []string{"speech.qwen3-tts.python"},
		ActivationEnvDelta: []string{"NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD=legacy-secret-bearing-command"}, // pragma: allowlist secret -- secret-removal fixture
	}
	if err := saveLocalStateSnapshot(statePath, localStateSnapshot{
		SchemaVersion:                   localStateSchemaVersion,
		SavedAt:                         nowISO(),
		LocalEnvironmentSelectedSources: []localEnvironmentSelectedSourceRecordState{legacy},
	}); err != nil {
		t.Fatalf("save legacy Python selected source: %v", err)
	}

	restored, err := New(slog.Default(), nil, statePath, 10, runtimeDataRoot)
	if err != nil {
		t.Fatalf("restore service: %v", err)
	}
	defer func() { restored.Close() }()
	restored.mu.RLock()
	restoredRecord := restored.localEnvironmentSelectedSources[localEnvironmentSelectedSourceRecordKey(legacy)]
	restored.mu.RUnlock()
	if len(restoredRecord.SelectedConsumers) != 0 || len(restoredRecord.ActivationEnvDelta) != 0 {
		t.Fatalf("restored canonical Python selected source retained consumer ownership: %+v", restoredRecord)
	}

	healed, err := loadLocalStateSnapshot(statePath)
	if err != nil {
		t.Fatalf("load healed state snapshot: %v", err)
	}
	if len(healed.LocalEnvironmentSelectedSources) != 1 {
		t.Fatalf("healed selected source count = %d, want 1", len(healed.LocalEnvironmentSelectedSources))
	}
	healedRecord := healed.LocalEnvironmentSelectedSources[0]
	if len(healedRecord.SelectedConsumers) != 0 || len(healedRecord.ActivationEnvDelta) != 0 {
		t.Fatalf("healed snapshot retained Python consumer ownership: %+v", healedRecord)
	}
}

func TestLocalEnvironmentSelectedSourceLockedMergeDoesNotPersistPartialPromotion(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	req := localEnvironmentJobRequestForTest(t, svc)
	job, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, nil)
	if err != nil {
		t.Fatalf("start job: %v", err)
	}

	svc.mu.Lock()
	svc.mergeLocalEnvironmentSelectedSourceRecordLocked(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  req.DependencyFamily,
		DependencyID:      req.DependencyID,
		EnvironmentKey:    req.EnvironmentKey,
		SelectedConsumers: []string{req.ConsumerScope},
	}))
	svc.mu.Unlock()

	snapshot, err := loadLocalStateSnapshot(svc.stateStorePath)
	if err != nil {
		t.Fatalf("load pre-promotion snapshot: %v", err)
	}
	if len(snapshot.LocalEnvironmentSelectedSources) != 0 {
		t.Fatalf("locked merge persisted a partial selected source: %+v", snapshot.LocalEnvironmentSelectedSources)
	}
	if len(snapshot.LocalEnvironmentDependencyJobs) != 1 || snapshot.LocalEnvironmentDependencyJobs[0].JobID != job.JobID || snapshot.LocalEnvironmentDependencyJobs[0].State != localEnvironmentStateQueued {
		t.Fatalf("pre-promotion snapshot job must remain queued: %+v", snapshot.LocalEnvironmentDependencyJobs)
	}
}

// TestStartLocalEnvironmentDependencyJobRunsExecutorAsynchronously asserts the
// wave-4 contract: Start returns a non-terminal job immediately for a slow
// executor (the RPC no longer blocks for the materializer download), and the
// detached background goroutine drives the job to a terminal state observable
// by polling.
func TestStartLocalEnvironmentDependencyJobRunsExecutorAsynchronously(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	req := localEnvironmentJobRequestForTest(t, svc)

	release := make(chan struct{})
	executorEntered := make(chan struct{})
	job, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState, localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		close(executorEntered)
		<-release
		return localEnvironmentDependencyJobResult{
			State:                 localEnvironmentStateReadyManaged,
			SourceKind:            localEnvironmentSourceManaged,
			CanonicalRoot:         localEnvironmentPortableFileForTest(t, svc),
			Version:               "1.0.0",
			CompatibilityEvidence: []string{"test compatibility"},
			VerifiedArtifacts:     []string{localEnvironmentPortableFileForTest(t, svc)},
			SelectedConsumers:     []string{"llama.cpp.cuda"},
			AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
		}, nil
	})
	if err != nil {
		t.Fatalf("start job: %v", err)
	}
	// Start must have returned before the slow executor completes.
	if localEnvironmentDependencyJobTerminal(job.State) {
		t.Fatalf("Start returned terminal job %q; expected immediate non-terminal return", job.State)
	}
	select {
	case <-executorEntered:
	case <-time.After(5 * time.Second):
		t.Fatal("background executor goroutine did not start")
	}
	close(release)
	terminal := pollLocalEnvironmentDependencyJobToTerminal(t, svc, job.JobID)
	if terminal.State != localEnvironmentStateReadyManaged {
		t.Fatalf("async job terminal state = %q, want ready_managed", terminal.State)
	}
}

// TestCancelLocalEnvironmentDependencyJobAbortsRunningExecutor asserts Cancel
// aborts a job whose background executor is mid-flight: the executor's job ctx
// is cancelled and the job settles at cancelled.
func TestCancelLocalEnvironmentDependencyJobAbortsRunningExecutor(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	req := localEnvironmentJobRequestForTest(t, svc)

	executorEntered := make(chan struct{})
	ctxCancelled := make(chan struct{})
	job, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(ctx context.Context, _ localEnvironmentDependencyJobState, _ localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		close(executorEntered)
		<-ctx.Done()
		close(ctxCancelled)
		return localEnvironmentDependencyJobResult{}, ctx.Err()
	})
	if err != nil {
		t.Fatalf("start job: %v", err)
	}
	select {
	case <-executorEntered:
	case <-time.After(5 * time.Second):
		t.Fatal("background executor goroutine did not start")
	}
	cancelled, ok, _ := svc.cancelLocalEnvironmentDependencyJob(job.JobID)
	if !ok {
		t.Fatal("cancel running job failed")
	}
	if cancelled.State != localEnvironmentStateCancelled {
		t.Fatalf("cancelled job state = %q, want cancelled", cancelled.State)
	}
	select {
	case <-ctxCancelled:
	case <-time.After(5 * time.Second):
		t.Fatal("running executor job ctx was not cancelled by Cancel")
	}
	if _, ok := svc.localEnvironmentSelectedSourceRecord(req.EnvironmentKey); ok {
		t.Fatal("cancelled job must not promote a selected source record")
	}
}

// TestCancelLocalEnvironmentDependencyJobAfterExecutorSuccessLeavesNoRecord
// asserts the Finding-1 contract: when a Cancel lands in the window after the
// executor has fully succeeded but before the job is promoted, the success
// path must NOT leave an orphaned selected-source record behind. The executor
// returns a complete ready result, then the test cancels the job before the
// executor's goroutine reaches promoteLocalEnvironmentDependencyJobReady. The
// job must settle at cancelled and no selected-source record may exist for the
// environment key — a cancelled job must never report a satisfied prerequisite.
func TestCancelLocalEnvironmentDependencyJobAfterExecutorSuccessLeavesNoRecord(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	req := localEnvironmentJobRequestForTest(t, svc)

	executorProducedResult := make(chan struct{})
	releaseExecutorReturn := make(chan struct{})
	job, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState, localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		// The executor fully succeeds: a complete, valid ready result.
		result := localEnvironmentDependencyJobResult{
			State:                 localEnvironmentStateReadyManaged,
			SourceKind:            localEnvironmentSourceManaged,
			CanonicalRoot:         localEnvironmentPortableFileForTest(t, svc),
			Version:               "1.0.0",
			CompatibilityEvidence: []string{"test compatibility"},
			VerifiedArtifacts:     []string{localEnvironmentPortableFileForTest(t, svc)},
			SelectedConsumers:     []string{"llama.cpp.cuda"},
			AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
		}
		// Signal that the executor has produced a successful result, then block
		// returning it until the test has landed a Cancel. This holds the
		// goroutine in the exact gap between executor success and promotion.
		close(executorProducedResult)
		<-releaseExecutorReturn
		return result, nil
	})
	if err != nil {
		t.Fatalf("start job: %v", err)
	}
	select {
	case <-executorProducedResult:
	case <-time.After(5 * time.Second):
		t.Fatal("background executor goroutine did not produce a result")
	}
	// Cancel lands after executor success but before promotion runs.
	cancelled, ok, _ := svc.cancelLocalEnvironmentDependencyJob(job.JobID)
	if !ok {
		t.Fatal("cancel job failed")
	}
	if cancelled.State != localEnvironmentStateCancelled {
		t.Fatalf("cancelled job state = %q, want cancelled", cancelled.State)
	}
	// Release the executor so the success path runs promotion against the
	// already-cancelled job.
	close(releaseExecutorReturn)
	settled := pollLocalEnvironmentDependencyJobToTerminal(t, svc, job.JobID)
	if settled.State != localEnvironmentStateCancelled {
		t.Fatalf("job state after success-then-cancel = %q, want cancelled", settled.State)
	}
	if settled.SelectedSourceRecordID != "" {
		t.Fatalf("cancelled job must not carry a selected source record id, got %q", settled.SelectedSourceRecordID)
	}
	if record, ok := svc.localEnvironmentSelectedSourceRecord(req.EnvironmentKey); ok {
		t.Fatalf("success-then-cancel must leave no selected source record, got %+v", record)
	}
	if _, ok := svc.selectedSourceForFamilyAndConsumer(req.DependencyFamily, "llama.cpp.cuda"); ok {
		t.Fatal("success-then-cancel must not report a satisfied prerequisite to plan resolution")
	}
}

// TestLocalEnvironmentDependencyJobCrashRecoveryFailsOrphanClosed asserts the
// crash-recovery seam: a job persisted at a non-terminal state across a daemon
// restart (no goroutine driving it) is failed closed (retryable) on restore so
// it is never a permanently frozen in-progress job.
func TestLocalEnvironmentDependencyJobCrashRecoveryFailsOrphanClosed(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "local-state.json")
	runtimeDataRoot := filepath.Join(dir, "runtime-data")
	svc, err := New(slog.Default(), nil, statePath, 10, runtimeDataRoot)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	req := localEnvironmentJobRequestForTestWithRoot(t, svc, runtimeDataRoot)
	// A nil executor leaves the job at queued (non-terminal) and persisted.
	job, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, nil)
	if err != nil {
		t.Fatalf("start job: %v", err)
	}
	if localEnvironmentDependencyJobTerminal(job.State) {
		t.Fatalf("expected a non-terminal persisted job, got %q", job.State)
	}
	svc.Close()

	restored, err := New(slog.Default(), nil, statePath, 10, runtimeDataRoot)
	if err != nil {
		t.Fatalf("restore service: %v", err)
	}
	defer func() { restored.Close() }()
	restoredJob, ok := restored.localEnvironmentDependencyJob(job.JobID)
	if !ok {
		t.Fatalf("expected restored job %s", job.JobID)
	}
	if restoredJob.State != localEnvironmentStateFailed {
		t.Fatalf("orphaned job state = %q, want failed after crash recovery", restoredJob.State)
	}
	if !restoredJob.Retryable {
		t.Fatal("crash-recovered orphan job must remain retryable")
	}
	if restoredJob.FailureDetail != "LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED" {
		t.Fatalf("orphan failure detail = %q, want interrupted audit reason", restoredJob.FailureDetail)
	}
	if restoredJob.ReasonCode != "LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED" {
		t.Fatalf("orphan reason = %q, want interrupted audit reason", restoredJob.ReasonCode)
	}
	if restoredJob.RecoveryDisposition != localEnvironmentJobRecoveryAutoRetryTransient {
		t.Fatalf("orphan recovery = %q, want auto transient retry", restoredJob.RecoveryDisposition)
	}
}

func TestLocalEnvironmentDependencyJobRepairRequiredSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "local-state.json")
	runtimeDataRoot := filepath.Join(dir, "runtime-data")
	svc, err := New(slog.Default(), nil, statePath, 10, runtimeDataRoot)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	req := localEnvironmentJobRequestForTestWithRoot(t, svc, runtimeDataRoot)
	job, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState, localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			AuditReasonCode: "LOCAL_ENVIRONMENT_PROFILE_REPAIR_REQUIRED",
			FailureDetail:   "profile must be rebuilt",
		}, nil
	})
	if err != nil {
		t.Fatalf("start job: %v", err)
	}
	settled := pollLocalEnvironmentDependencyJobToTerminal(t, svc, job.JobID)
	if settled.State != localEnvironmentStateRepairRequired {
		t.Fatalf("settled state = %q, want repair_required", settled.State)
	}
	svc.Close()

	restored, err := New(slog.Default(), nil, statePath, 10, runtimeDataRoot)
	if err != nil {
		t.Fatalf("restore service: %v", err)
	}
	defer func() { restored.Close() }()
	restoredJob, ok := restored.localEnvironmentDependencyJob(job.JobID)
	if !ok {
		t.Fatalf("expected restored job %s", job.JobID)
	}
	if restoredJob.State != localEnvironmentStateRepairRequired {
		t.Fatalf("restored repair state = %q, want repair_required", restoredJob.State)
	}
	if restoredJob.Retryable || restoredJob.RecoveryDisposition != localEnvironmentJobRecoveryRepairRequired {
		t.Fatalf("restored repair disposition = %+v, want non-retryable repair_required", restoredJob)
	}
	cancelled, ok, _ := restored.cancelLocalEnvironmentDependencyJob(job.JobID)
	if !ok || cancelled.State != localEnvironmentStateRepairRequired {
		t.Fatalf("cancel rewrote settled repair job: ok=%v job=%+v", ok, cancelled)
	}
	restarted, err := restored.startLocalEnvironmentDependencyJob(context.Background(), req, nil)
	if err != nil {
		t.Fatalf("restart repair-required dependency: %v", err)
	}
	if restarted.JobID == job.JobID {
		t.Fatalf("repair-required job was incorrectly deduped: %q", restarted.JobID)
	}
	if _, ok, _ := restored.cancelLocalEnvironmentDependencyJob(restarted.JobID); !ok {
		t.Fatalf("cancel replacement job %s", restarted.JobID)
	}
}

// TestLocalEnvironmentDependencyJobCarriesDownloadProgress is the wave-5
// regression: while a job is downloading, the K-RPC-025 progress projection
// carries the bounded bytes / percent / speed / eta the executor publishes; on
// the terminal transition the progress is cleared so no stale %/rate/ETA is
// left on a ready job.
func TestLocalEnvironmentDependencyJobCarriesDownloadProgress(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	req := localEnvironmentJobRequestForTest(t, svc)

	released := make(chan struct{})
	published := make(chan struct{})
	started, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(_ context.Context, _ localEnvironmentDependencyJobState, report localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		reportLocalEnvironmentJobProgress(report, localEnvironmentStateDownloading)
		// Publish a mid-download byte-progress snapshot, then park so the test
		// can observe the job projection while it is still downloading.
		reportLocalEnvironmentJobDownloadProgress(report, localEnvironmentDependencyJobProgress{
			BytesReceived:    250,
			BytesTotal:       1000,
			SpeedBytesPerSec: 125,
			EtaSeconds:       6,
		})
		close(published)
		<-released
		return localEnvironmentDependencyJobResult{
			State:                 localEnvironmentStateReadyManaged,
			SourceKind:            localEnvironmentSourceManaged,
			CanonicalRoot:         localEnvironmentPortableFileForTest(t, svc),
			Version:               "1.0.0",
			CompatibilityEvidence: []string{"test compatibility"},
			VerifiedArtifacts:     []string{localEnvironmentPortableFileForTest(t, svc)},
			SelectedConsumers:     []string{"llama.cpp.cuda"},
			AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
		}, nil
	})
	if err != nil {
		t.Fatalf("start job: %v", err)
	}

	<-published
	// The executor parks after publishing; give the runner a brief window to
	// land the downloading transition + progress update, then observe.
	deadline := time.Now().Add(5 * time.Second)
	var downloading localEnvironmentDependencyJobState
	for {
		job, ok := svc.localEnvironmentDependencyJob(started.JobID)
		if !ok {
			t.Fatalf("job %s not found", started.JobID)
		}
		if job.State == localEnvironmentStateDownloading && job.BytesReceived > 0 {
			downloading = job
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("job did not reach downloading-with-progress (last=%q bytes=%d)", job.State, job.BytesReceived)
		}
		time.Sleep(5 * time.Millisecond)
	}
	if downloading.BytesReceived != 250 || downloading.BytesTotal != 1000 {
		t.Fatalf("downloading job bytes = %d/%d, want 250/1000", downloading.BytesReceived, downloading.BytesTotal)
	}
	if downloading.Percent != 25 {
		t.Fatalf("downloading job percent = %d, want 25", downloading.Percent)
	}
	if downloading.SpeedBytesPerSec != 125 || downloading.EtaSeconds != 6 {
		t.Fatalf("downloading job rate = %d B/s eta %ds, want 125 / 6", downloading.SpeedBytesPerSec, downloading.EtaSeconds)
	}
	proto := localEnvironmentDependencyJobToProto(downloading)
	if proto.GetBytesReceived() != 250 || proto.GetPercent() != 25 || proto.GetSpeedBytesPerSec() != 125 || proto.GetEtaSeconds() != 6 {
		t.Fatalf("proto projection dropped progress fields: %+v", proto)
	}

	close(released)
	terminal := pollLocalEnvironmentDependencyJobToTerminal(t, svc, started.JobID)
	if terminal.State != localEnvironmentStateReadyManaged {
		t.Fatalf("terminal state = %q, want ready_managed", terminal.State)
	}
	// The ready terminal state is not transferring — progress must be cleared,
	// never carried over as a frozen %/rate/ETA.
	if terminal.BytesReceived != 0 || terminal.BytesTotal != 0 || terminal.Percent != 0 ||
		terminal.SpeedBytesPerSec != 0 || terminal.EtaSeconds != 0 {
		t.Fatalf("ready job retained stale progress: %+v", terminal)
	}
}

func TestLocalEnvironmentDependencyJobHeartbeatRefreshesInstallingState(t *testing.T) {
	previousInterval := localEnvironmentDependencyJobHeartbeatInterval
	localEnvironmentDependencyJobHeartbeatInterval = 10 * time.Millisecond
	defer func() {
		localEnvironmentDependencyJobHeartbeatInterval = previousInterval
	}()

	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	req := localEnvironmentJobRequestForTest(t, svc)

	release := make(chan struct{})
	defer close(release)
	started, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(_ context.Context, _ localEnvironmentDependencyJobState, report localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		reportLocalEnvironmentJobProgress(report, localEnvironmentStateInstalling)
		<-release
		return localEnvironmentDependencyJobResult{
			State:                 localEnvironmentStateReadyManaged,
			SourceKind:            localEnvironmentSourceManaged,
			CanonicalRoot:         localEnvironmentPortableFileForTest(t, svc),
			Version:               "1.0.0",
			CompatibilityEvidence: []string{"test compatibility"},
			VerifiedArtifacts:     []string{localEnvironmentPortableFileForTest(t, svc)},
			SelectedConsumers:     []string{"llama.cpp.cuda"},
			AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
		}, nil
	})
	if err != nil {
		t.Fatalf("start job: %v", err)
	}

	var installing localEnvironmentDependencyJobState
	deadline := time.Now().Add(5 * time.Second)
	for {
		job, ok := svc.localEnvironmentDependencyJob(started.JobID)
		if !ok {
			t.Fatalf("job %s not found", started.JobID)
		}
		if job.State == localEnvironmentStateInstalling {
			installing = job
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("job did not reach installing (last=%q)", job.State)
		}
		time.Sleep(5 * time.Millisecond)
	}

	for {
		job, ok := svc.localEnvironmentDependencyJob(started.JobID)
		if !ok {
			t.Fatalf("job %s not found", started.JobID)
		}
		if job.UpdatedAt != installing.UpdatedAt {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("installing job heartbeat did not refresh updatedAt from %q", installing.UpdatedAt)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestLocalEnvironmentDependencyJobHeartbeatDoesNotMaskDownloadingWithoutProgress(t *testing.T) {
	previousInterval := localEnvironmentDependencyJobHeartbeatInterval
	localEnvironmentDependencyJobHeartbeatInterval = 10 * time.Millisecond
	defer func() {
		localEnvironmentDependencyJobHeartbeatInterval = previousInterval
	}()

	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	req := localEnvironmentJobRequestForTest(t, svc)

	release := make(chan struct{})
	defer close(release)
	started, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(_ context.Context, _ localEnvironmentDependencyJobState, report localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		reportLocalEnvironmentJobProgress(report, localEnvironmentStateDownloading)
		<-release
		return localEnvironmentDependencyJobResult{
			State:                 localEnvironmentStateReadyManaged,
			SourceKind:            localEnvironmentSourceManaged,
			CanonicalRoot:         localEnvironmentPortableFileForTest(t, svc),
			Version:               "1.0.0",
			CompatibilityEvidence: []string{"test compatibility"},
			VerifiedArtifacts:     []string{localEnvironmentPortableFileForTest(t, svc)},
			SelectedConsumers:     []string{"llama.cpp.cuda"},
			AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
		}, nil
	})
	if err != nil {
		t.Fatalf("start job: %v", err)
	}

	deadline := time.Now().Add(5 * time.Second)
	var downloading localEnvironmentDependencyJobState
	for {
		job, ok := svc.localEnvironmentDependencyJob(started.JobID)
		if !ok {
			t.Fatalf("job %s not found", started.JobID)
		}
		if job.State == localEnvironmentStateDownloading {
			downloading = job
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("job did not reach downloading (last=%q)", job.State)
		}
		time.Sleep(5 * time.Millisecond)
	}

	time.Sleep(50 * time.Millisecond)
	after, ok := svc.localEnvironmentDependencyJob(started.JobID)
	if !ok {
		t.Fatalf("job %s not found", started.JobID)
	}
	if after.State != localEnvironmentStateDownloading {
		t.Fatalf("job state changed before release: %+v", after)
	}
	if after.UpdatedAt != downloading.UpdatedAt {
		t.Fatalf("downloading job updatedAt changed without byte progress: before=%q after=%q", downloading.UpdatedAt, after.UpdatedAt)
	}
}

// TestLocalEnvironmentDependencyJobPercentFailsClosedWithoutTotal asserts the
// percent projection never fabricates a value when the total is unknown.
func TestLocalEnvironmentDependencyJobPercentFailsClosedWithoutTotal(t *testing.T) {
	if got := localEnvironmentDependencyJobPercent(500, 0); got != 0 {
		t.Fatalf("percent with unknown total = %d, want 0 (indeterminate)", got)
	}
	if got := localEnvironmentDependencyJobPercent(0, 1000); got != 0 {
		t.Fatalf("percent with no bytes = %d, want 0", got)
	}
	if got := localEnvironmentDependencyJobPercent(1000, 1000); got != 100 {
		t.Fatalf("percent at completion = %d, want 100", got)
	}
	if got := localEnvironmentDependencyJobPercent(2000, 1000); got != 100 {
		t.Fatalf("percent over total clamps to %d, want 100", got)
	}
	if got := localEnvironmentDependencyJobPercent(333, 1000); got != 33 {
		t.Fatalf("percent = %d, want 33", got)
	}
}

// TestLocalEnvironmentDependencyJobProgressIgnoredOnTerminalJob asserts a late
// progress callback cannot resurrect a stale percentage on a settled job.
func TestLocalEnvironmentDependencyJobProgressIgnoredOnTerminalJob(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	req := localEnvironmentJobRequestForTest(t, svc)

	started, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState, localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateFailed,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_VERIFICATION_INCOMPLETE",
		}, nil
	})
	if err != nil {
		t.Fatalf("start job: %v", err)
	}
	terminal := pollLocalEnvironmentDependencyJobToTerminal(t, svc, started.JobID)
	if terminal.State != localEnvironmentStateFailed {
		t.Fatalf("terminal state = %q, want failed", terminal.State)
	}
	svc.updateLocalEnvironmentDependencyJobProgress(started.JobID, localEnvironmentDependencyJobProgress{
		BytesReceived: 999, BytesTotal: 1000, SpeedBytesPerSec: 100, EtaSeconds: 1,
	})
	after, _ := svc.localEnvironmentDependencyJob(started.JobID)
	if after.BytesReceived != 0 || after.Percent != 0 {
		t.Fatalf("late progress mutated a terminal job: %+v", after)
	}
}

func newLocalEnvironmentJobTestService(t *testing.T) *Service {
	t.Helper()
	dir := t.TempDir()
	svc, err := NewWithProductControlDataRoot(slog.Default(), nil, filepath.Join(dir, "local-state.json"), 10, filepath.Join(dir, "models"), dir)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	return svc
}

func localEnvironmentPortableFileForTest(t *testing.T, svc *Service) string {
	t.Helper()
	path := filepath.Join(svc.runtimeDataRoot, "environments", "test-dependency", "tool.exe")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("test dependency"), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

func localEnvironmentJobRequestForTest(t *testing.T, svc *Service) localEnvironmentDependencyJobRequest {
	t.Helper()
	return localEnvironmentJobRequestForTestWithRoot(t, svc, svc.runtimeDataRoot)
}

func localEnvironmentJobRequestForTestWithRoot(t *testing.T, svc *Service, runtimeDataRoot string) localEnvironmentDependencyJobRequest {
	t.Helper()
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-text",
		ConsumerScope:   "llama.cpp.cuda",
		HostProfile:     localEnvironmentNvidiaProfile(),
		RuntimeDataRoot: runtimeDataRoot,
	})
	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyNativeLlama)
	return localEnvironmentDependencyJobRequest{
		EnvironmentKey:   dep.EnvironmentKey,
		DependencyFamily: dep.DependencyFamily,
		DependencyID:     dep.DependencyID,
		ConsumerScope:    dep.ConsumerScope,
		SourceKind:       localEnvironmentSourceManaged,
	}
}

func TestCopiedDataRootDerivesEnvironmentOwnerLocatorsAndDropsHostJobs(t *testing.T) {
	rootOne := filepath.Join(t.TempDir(), "environment-root-one")
	canonicalOne := filepath.Join(rootOne, "environments", "native", "engine-a")
	if err := os.MkdirAll(canonicalOne, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(canonicalOne, "llama-server"), []byte("engine"), 0o700); err != nil {
		t.Fatal(err)
	}
	stateOne := filepath.Join(rootOne, "accounts", "runtime", "local-state.json")
	first, err := NewWithProductControlDataRoot(slog.Default(), nil, stateOne, 10, filepath.Join(rootOne, "models"), rootOne)
	if err != nil {
		t.Fatal(err)
	}
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		RecordID: "source-portable", DependencyFamily: localEnvironmentFamilyNativeLlama,
		DependencyID: "llama.cpp.package", EnvironmentKey: localEnvironmentNativeLlamaKey("1.0.0", "windows/amd64"), Version: "1.0.0",
		CanonicalRoot: canonicalOne, VerifiedArtifacts: []string{filepath.Join(canonicalOne, "llama-server")},
	})
	jobRequest := localEnvironmentJobRequestForTestWithRoot(t, first, rootOne)
	portableJob, err := first.startLocalEnvironmentDependencyJob(context.Background(), jobRequest, nil)
	if err != nil {
		t.Fatal(err)
	}
	first.mu.Lock()
	record = first.mergeLocalEnvironmentSelectedSourceRecordLocked(record)
	hostProfile := localEnvironmentHostProfileFromDeviceProfile(localEnvironmentNvidiaProfile())
	first.localEnvironmentHostProfiles[hostProfile.HostProfileID] = hostProfile
	persistErr := first.persistStateLocked()
	first.mu.Unlock()
	if persistErr != nil {
		t.Fatalf("persist copied data-root fixture: %v", persistErr)
	}
	stored, err := os.ReadFile(stateOne)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(stored, []byte(rootOne)) || !bytes.Contains(stored, []byte(`"canonicalRoot": "environments/native/engine-a"`)) {
		t.Fatalf("selected-source storage did not use an owner-relative locator: %s", stored)
	}
	first.Close()

	rootTwo := filepath.Join(t.TempDir(), "environment-root-two")
	if err := os.CopyFS(rootTwo, os.DirFS(rootOne)); err != nil {
		t.Fatal(err)
	}
	second, err := NewWithProductControlDataRoot(slog.Default(), nil, filepath.Join(rootTwo, "accounts", "runtime", "local-state.json"), 10, filepath.Join(rootTwo, "models"), rootTwo)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	result := second.reconcileProductControlCheckSyncEnvironments(context.Background(), ProductControlCheckSyncInput{RootActivationID: "rootact_test", DataRoot: rootTwo})
	if result.State != "completed" {
		t.Fatalf("environment reconciliation = %+v", result)
	}
	foundRecord := false
	for _, resource := range result.Resources {
		foundRecord = foundRecord || resource.Reference != nil && *resource.Reference == record.RecordID &&
			resource.Status == "unavailable" && resource.Reason == "ENVIRONMENT_OWNER_MATERIAL_VERIFICATION_REQUIRED" && resource.Change == nil
	}
	if !foundRecord {
		t.Fatalf("environment owner reopen was not fail-closed pending owner verification: %+v", result.Resources)
	}
	second.mu.RLock()
	var reopened localEnvironmentSelectedSourceRecordState
	for _, current := range second.localEnvironmentSelectedSources {
		reopened = current
	}
	hostCount := len(second.localEnvironmentHostProfiles)
	reopenedJob := second.localEnvironmentDependencyJobs[portableJob.JobID]
	second.mu.RUnlock()
	if reopened.RecordID != record.RecordID || !productControlPathsEqual(reopened.CanonicalRoot, filepath.Join(rootTwo, "environments", "native", "engine-a")) || strings.Contains(reopened.EnvironmentKey, rootOne) {
		t.Fatalf("environment owner locator was not derived from the copied root: %+v", reopened)
	}
	if hostCount != 0 || reopenedJob.State != localEnvironmentStateFailed {
		t.Fatalf("host-specific environment state survived root reopen: hosts=%d job=%+v", hostCount, reopenedJob)
	}
}

func TestSelectedSourceRestoreKeepsRootRelativeArtifactsRelative(t *testing.T) {
	dataRoot := filepath.Join(t.TempDir(), "nimi-data")
	stored := localEnvironmentSelectedSourceRecordState{
		DependencyFamily: localEnvironmentFamilyCUDA,
		CanonicalRoot:    "dependencies/accelerator-dependencies/nvidia-cuda-user-space-runtime",
		VerifiedArtifacts: []string{
			"cudart64_12.dll",
			"cublas64_12.dll",
		},
	}
	restored := localEnvironmentSelectedSourceRecordFromStorage(stored, dataRoot)
	wantRoot := filepath.Join(dataRoot, "dependencies", "accelerator-dependencies", "nvidia-cuda-user-space-runtime")
	if !productControlPathsEqual(restored.CanonicalRoot, wantRoot) {
		t.Fatalf("restored CUDA root = %q, want %q", restored.CanonicalRoot, wantRoot)
	}
	if !reflect.DeepEqual(restored.VerifiedArtifacts, stored.VerifiedArtifacts) {
		t.Fatalf("root-relative CUDA artifacts = %v, want %v", restored.VerifiedArtifacts, stored.VerifiedArtifacts)
	}
	checks := localEnvironmentSelectedSourceLocalArtifactChecks(restored)
	if len(checks) != 3 || !productControlPathsEqual(checks[1].Path, filepath.Join(wantRoot, "cudart64_12.dll")) {
		t.Fatalf("restored CUDA artifact checks = %+v", checks)
	}
}

func TestSelectedSourceRestoreRehydratesOwnerArtifactLocators(t *testing.T) {
	dataRoot := filepath.Join(t.TempDir(), "nimi-data")
	storedRoot := "environments/llama/b8645/llama-server.exe"
	stored := localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyNativeLlama,
		CanonicalRoot:     storedRoot,
		VerifiedArtifacts: []string{storedRoot},
	}
	restored := localEnvironmentSelectedSourceRecordFromStorage(stored, dataRoot)
	want := filepath.Join(dataRoot, "environments", "llama", "b8645", "llama-server.exe")
	if !productControlPathsEqual(restored.CanonicalRoot, want) || len(restored.VerifiedArtifacts) != 1 || !productControlPathsEqual(restored.VerifiedArtifacts[0], want) {
		t.Fatalf("restored owner locator = %+v, want %q", restored, want)
	}
}

func TestReadyEnvironmentPromotionRollsBackAndPropagatesPersistenceFailure(t *testing.T) {
	service := newTestService(t)
	job := localEnvironmentDependencyJobState{
		JobID: "job-persist-failure", EnvironmentKey: "native-engine-package.llama|llama.cpp.package|windows/amd64",
		DependencyFamily: localEnvironmentFamilyNativeLlama, DependencyID: "llama.cpp.package", ConsumerScope: "llama.cpp.cuda",
		State: localEnvironmentStateVerifying, SourceKind: localEnvironmentSourceManaged, CreatedAt: nowISO(), UpdatedAt: nowISO(),
	}
	service.mu.Lock()
	service.localEnvironmentDependencyJobs[job.JobID] = job
	service.mu.Unlock()
	badTarget := filepath.Join(t.TempDir(), "state-is-directory")
	if err := os.MkdirAll(badTarget, 0o700); err != nil {
		t.Fatal(err)
	}
	service.stateStorePath = badTarget
	pending := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: job.DependencyFamily, DependencyID: job.DependencyID, EnvironmentKey: job.EnvironmentKey,
		CanonicalRoot: filepath.Join(t.TempDir(), "llama-server"), SelectedConsumers: []string{job.ConsumerScope},
	})
	promoted, ok, err := service.promoteLocalEnvironmentDependencyJobReady(job.JobID, localEnvironmentStateReadyManaged, localEnvironmentSourceManaged, pending.CanonicalRoot, pending)
	if !ok || err == nil || promoted.State != job.State {
		t.Fatalf("failed durable promotion = promoted:%+v ok:%t err:%v", promoted, ok, err)
	}
	service.mu.RLock()
	preservedJob := service.localEnvironmentDependencyJobs[job.JobID]
	selectedCount := len(service.localEnvironmentSelectedSources)
	service.mu.RUnlock()
	if preservedJob.State != job.State || selectedCount != 0 {
		t.Fatalf("persistence failure left pseudo-ready owner state: job=%+v selected=%d", preservedJob, selectedCount)
	}
	transitioned, ok, transitionErr := service.transitionLocalEnvironmentDependencyJob(job.JobID, localEnvironmentStateFailed, "failed", false)
	if !ok || transitionErr == nil || transitioned.State != job.State {
		t.Fatalf("failed durable transition = job:%+v ok:%t err:%v", transitioned, ok, transitionErr)
	}
}

func TestPortableSelectedSourceStorageRehydratesOnlyExactOwnerLocators(t *testing.T) {
	rootOne := t.TempDir()
	rootTwo := t.TempDir()
	interpreter := filepath.Join(rootOne, "environments", "python", engine.ManagedPythonVersion, "python.exe")
	uvExecutable := filepath.Join(rootOne, "dependencies", "uv", "uv.exe")
	record := localEnvironmentSelectedSourceRecordState{
		SourceKind: localEnvironmentSourceManaged, CanonicalRoot: interpreter,
		VerifiedArtifacts: []string{interpreter, uvExecutable, "python312.dll"},
	}
	stored := localEnvironmentSelectedSourceRecordForStorage(record, rootOne)
	if filepath.IsAbs(stored.CanonicalRoot) || filepath.IsAbs(stored.VerifiedArtifacts[0]) || filepath.IsAbs(stored.VerifiedArtifacts[1]) {
		t.Fatalf("portable selected-source retained absolute owner paths: %+v", stored)
	}
	reopened := localEnvironmentSelectedSourceRecordFromStorage(stored, rootTwo)
	if reopened.CanonicalRoot != filepath.Join(rootTwo, filepath.FromSlash(stored.CanonicalRoot)) ||
		reopened.VerifiedArtifacts[1] != filepath.Join(rootTwo, filepath.FromSlash(stored.VerifiedArtifacts[1])) || reopened.VerifiedArtifacts[2] != "python312.dll" {
		t.Fatalf("portable selected-source locator derivation = %+v", reopened)
	}
	foreign := record
	foreign.CanonicalRoot = filepath.Join(t.TempDir(), "environments", "python", "python.exe")
	blocked := localEnvironmentSelectedSourceRecordForStorage(foreign, rootOne)
	if blocked.CanonicalRoot != "" || blocked.RepairState != localEnvironmentRepairRequired {
		t.Fatalf("foreign absolute selected-source was persisted: %+v", blocked)
	}
}
