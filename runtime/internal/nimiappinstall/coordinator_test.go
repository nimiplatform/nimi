package nimiappinstall

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
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

func TestRecoveryFailsInterruptedLocalImportJobs(t *testing.T) {
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
	work := filepath.Join(root, "apps", "packages", "work", job.JobID)
	if err := os.MkdirAll(work, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(work, "package.nimiapp"), []byte("interrupted local copy"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Recover(ctx, kernel); err != nil {
		t.Fatal(err)
	}
	current, err := kernel.PackageLifecycle().GetJob(ctx, job.JobID)
	if err != nil || current.Phase != localappkernel.PackageJobFailed || current.ReasonCode != "runtime-interrupted" || current.SourceClass != localappkernel.SourceClassUserImported {
		t.Fatalf("local import was not recovered: %+v, %v", current, err)
	}
	if _, err := os.Stat(work); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("interrupted bytes remain: %v", err)
	}
}

func TestLocalPackageInvalidSelectionLeavesNoJobOrTemporaryBytes(t *testing.T) {
	if _, _, _, err := publicappregistry.CurrentPlatformTarget(); err != nil {
		t.Skip("local import requires an admitted platform")
	}
	ctx := context.Background()
	root := t.TempDir()
	identity, err := localappkernel.ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatal(err)
	}
	database, err := localappkernel.CanonicalRegistrationDatabasePath(root)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(ctx, database, identity, localappkernel.Options{HostInstallID: "local-selection-test", DataRoot: root})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = kernel.Close() }()
	owner, err := openPackageOwner(kernel)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = owner.Close() }()
	selected := filepath.Join(t.TempDir(), "invalid.nimiapp")
	if err := os.WriteFile(selected, []byte("not a package"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := owner.PrepareLocalPackage(ctx, selected); err == nil {
		t.Fatal("invalid bytes accepted")
	}
	if _, err := owner.StartLocalPackage(ctx, "unavailable", "", "", nil); !errors.Is(err, ErrLocalCandidate) {
		t.Fatalf("unknown candidate: %v", err)
	}
	jobs, err := owner.lifecycle.ListJobs(ctx)
	if err != nil || len(jobs) != 0 {
		t.Fatalf("invalid selection created jobs: %+v, %v", jobs, err)
	}
	files, err := os.ReadDir(filepath.Join(root, "apps", "packages", "work"))
	if err != nil || len(files) != 0 || len(owner.localCandidates) != 0 {
		t.Fatalf("invalid selection retained bytes: %v, %v", files, err)
	}
}
