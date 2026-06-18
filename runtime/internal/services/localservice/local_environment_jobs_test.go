package localservice

import (
	"context"
	"errors"
	"log/slog"
	"path/filepath"
	"testing"
	"time"
)

// localEnvironmentDependencyJobSettledForTest reports whether a job has reached
// a state the background goroutine no longer advances: a terminal state, or
// repair_required (a settled non-ready outcome the executor returns and does not
// itself retry). Async-job tests poll for this.
func localEnvironmentDependencyJobSettledForTest(state string) bool {
	return localEnvironmentDependencyJobTerminal(state) || state == localEnvironmentStateRepairRequired
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
			CanonicalRoot:         filepath.Join(t.TempDir(), "dependency-root"),
			Version:               "1.0.0",
			CompatibilityEvidence: []string{"test compatibility"},
			VerifiedArtifacts:     []string{"bin/tool"},
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

func TestLocalEnvironmentDependencyJobCancelDoesNotPromote(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	req := localEnvironmentJobRequestForTest(t, svc)

	job, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, nil)
	if err != nil {
		t.Fatalf("start job: %v", err)
	}
	cancelled, ok := svc.cancelLocalEnvironmentDependencyJob(job.JobID)
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
	if job.RecoveryDisposition != localEnvironmentJobRecoveryManualRetry {
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
		return localEnvironmentDependencyJobResult{}, errors.New("download model file: unexpected EOF")
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
	if job.RecoveryDisposition != localEnvironmentJobRecoveryAutoRetryTransient {
		t.Fatalf("recovery = %q, want auto transient retry", job.RecoveryDisposition)
	}
}

func TestLocalEnvironmentDependencyJobUnderspecifiedReadyResultDoesNotPromote(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer func() { svc.Close() }()
	req := localEnvironmentJobRequestForTest(t, svc)

	started, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState, localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		return localEnvironmentDependencyJobResult{
			SourceKind:    localEnvironmentSourceManaged,
			CanonicalRoot: filepath.Join(t.TempDir(), "dependency-root"),
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
			CanonicalRoot:         filepath.Join(t.TempDir(), "dependency-root"),
			Version:               "1.0.0",
			CompatibilityEvidence: []string{"test compatibility"},
			VerifiedArtifacts:     []string{"bin/tool"},
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
	if _, ok := svc.markLocalEnvironmentDependencyRepairRequired(req.EnvironmentKey, "hash_mismatch"); !ok {
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
	svc, err := New(slog.Default(), nil, statePath, 10, runtimeDataRoot)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	req := localEnvironmentJobRequestForTestWithRoot(t, svc, runtimeDataRoot)
	started, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState, localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		return localEnvironmentDependencyJobResult{
			State:                 localEnvironmentStateReadyManaged,
			SourceKind:            localEnvironmentSourceManaged,
			CanonicalRoot:         filepath.Join(runtimeDataRoot, "engines", "llama"),
			Version:               "1.0.0",
			CompatibilityEvidence: []string{"test compatibility"},
			VerifiedArtifacts:     []string{"bin/llama"},
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

	restored, err := New(slog.Default(), nil, statePath, 10, runtimeDataRoot)
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
	if _, ok := restored.localEnvironmentSelectedSourceRecord(req.EnvironmentKey); !ok {
		t.Fatalf("expected restored selected source record")
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
			CanonicalRoot:         filepath.Join(t.TempDir(), "dependency-root"),
			Version:               "1.0.0",
			CompatibilityEvidence: []string{"test compatibility"},
			VerifiedArtifacts:     []string{"bin/tool"},
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
	cancelled, ok := svc.cancelLocalEnvironmentDependencyJob(job.JobID)
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
			CanonicalRoot:         filepath.Join(t.TempDir(), "dependency-root"),
			Version:               "1.0.0",
			CompatibilityEvidence: []string{"test compatibility"},
			VerifiedArtifacts:     []string{"bin/tool"},
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
	cancelled, ok := svc.cancelLocalEnvironmentDependencyJob(job.JobID)
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
			CanonicalRoot:         filepath.Join(t.TempDir(), "dependency-root"),
			Version:               "1.0.0",
			CompatibilityEvidence: []string{"test compatibility"},
			VerifiedArtifacts:     []string{"bin/tool"},
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
			CanonicalRoot:         filepath.Join(t.TempDir(), "dependency-root"),
			Version:               "1.0.0",
			CompatibilityEvidence: []string{"test compatibility"},
			VerifiedArtifacts:     []string{"bin/tool"},
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
			CanonicalRoot:         filepath.Join(t.TempDir(), "dependency-root"),
			Version:               "1.0.0",
			CompatibilityEvidence: []string{"test compatibility"},
			VerifiedArtifacts:     []string{"bin/tool"},
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
	svc, err := New(slog.Default(), nil, filepath.Join(dir, "local-state.json"), 10, filepath.Join(dir, "models"))
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	return svc
}

func localEnvironmentJobRequestForTest(t *testing.T, svc *Service) localEnvironmentDependencyJobRequest {
	t.Helper()
	return localEnvironmentJobRequestForTestWithRoot(t, svc, filepath.Join(t.TempDir(), "runtime-data"))
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
