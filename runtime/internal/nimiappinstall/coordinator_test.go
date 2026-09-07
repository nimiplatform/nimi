package nimiappinstall

import (
	"context"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

func TestInstallWorkerCancellationReasonIsFirstWriterWins(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	worker := &installWorker{cancel: cancel}
	worker.requestCancel("first-reason")
	worker.requestCancel("second-reason")
	if ctx.Err() != context.Canceled {
		t.Fatalf("worker context = %v", ctx.Err())
	}
	worker.mu.Lock()
	reason := worker.reason
	worker.mu.Unlock()
	if reason != "first-reason" {
		t.Fatalf("cancellation reason = %q", reason)
	}
}

func TestRegistryRecoveryPreservesLocalImportJobs(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	identity, err := localappkernel.ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatal(err)
	}
	databasePath, err := localappkernel.CanonicalRegistrationDatabasePath(root)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(ctx, databasePath, identity, localappkernel.Options{
		HostInstallID: "source-isolation-test", DataRoot: root,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = kernel.Close() }()
	job, err := kernel.PackageLifecycle().Begin(ctx, localappkernel.BeginPackageJobInput{
		AppID: "example.imported", SourceClass: localappkernel.SourceClassUserImported,
		Kind: localappkernel.PackageJobInstall, TargetRef: "local-package:example:1.0.0",
		ProgressBasis: localappkernel.PackageProgressIndeterminate, Cancelable: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	job, err = kernel.PackageLifecycle().Advance(ctx, job.JobID, job.Phase, localappkernel.PackageJobReadingLocal, localappkernel.PackageJobProgress{})
	if err != nil {
		t.Fatal(err)
	}
	if err := Recover(ctx, kernel); err != nil {
		t.Fatal(err)
	}
	current, err := kernel.PackageLifecycle().GetJob(ctx, job.JobID)
	if err != nil || current.Phase != localappkernel.PackageJobReadingLocal || current.SourceClass != localappkernel.SourceClassUserImported {
		t.Fatalf("Registry recovery changed local import: %+v, %v", current, err)
	}
}
