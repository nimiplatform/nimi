package localservice

import (
	"context"
	"errors"
	"log/slog"
	"path/filepath"
	"testing"
)

func TestLocalEnvironmentDependencyJobDedupesActiveEnvironment(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer svc.Close()
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
	defer svc.Close()
	req := localEnvironmentJobRequestForTest(t, svc)

	job, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState) (localEnvironmentDependencyJobResult, error) {
		return localEnvironmentDependencyJobResult{
			SourceKind:        localEnvironmentSourceManaged,
			CanonicalRoot:     filepath.Join(t.TempDir(), "dependency-root"),
			Version:           "1.0.0",
			VerifiedArtifacts: []string{"bin/tool"},
			AuditReasonCode:   "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
		}, nil
	})
	if err != nil {
		t.Fatalf("run job: %v", err)
	}
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
	defer svc.Close()
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
	defer svc.Close()
	req := localEnvironmentJobRequestForTest(t, svc)

	job, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState) (localEnvironmentDependencyJobResult, error) {
		return localEnvironmentDependencyJobResult{}, errors.New("verify failed")
	})
	if err == nil {
		t.Fatalf("expected job failure")
	}
	if job.State != localEnvironmentStateFailed {
		t.Fatalf("expected failed state, got %+v", job)
	}
	if _, ok := svc.localEnvironmentSelectedSourceRecord(req.EnvironmentKey); ok {
		t.Fatalf("failed job must not promote selected source")
	}
}

func TestLocalEnvironmentDependencyJobRepairRequiredBlocksPlan(t *testing.T) {
	svc := newLocalEnvironmentJobTestService(t)
	defer svc.Close()
	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	req := localEnvironmentJobRequestForTestWithRoot(t, svc, runtimeDataRoot)

	_, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState) (localEnvironmentDependencyJobResult, error) {
		return localEnvironmentDependencyJobResult{
			SourceKind:    localEnvironmentSourceManaged,
			CanonicalRoot: filepath.Join(t.TempDir(), "dependency-root"),
		}, nil
	})
	if err != nil {
		t.Fatalf("run job: %v", err)
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
	job, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState) (localEnvironmentDependencyJobResult, error) {
		return localEnvironmentDependencyJobResult{
			SourceKind:    localEnvironmentSourceManaged,
			CanonicalRoot: filepath.Join(runtimeDataRoot, "engines", "llama"),
		}, nil
	})
	if err != nil {
		t.Fatalf("run job: %v", err)
	}
	svc.Close()

	restored, err := New(slog.Default(), nil, statePath, 10, runtimeDataRoot)
	if err != nil {
		t.Fatalf("restore service: %v", err)
	}
	defer restored.Close()
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
		SourceKind:       localEnvironmentSourceManaged,
	}
}
