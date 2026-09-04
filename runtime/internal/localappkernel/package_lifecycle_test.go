package localappkernel

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
)

func TestPackageJobLifecycleIsExclusiveMonotonicAndTerminal(t *testing.T) {
	ctx := context.Background()
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"),
		mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "install-one", 0xb1)
	defer func() { _ = kernel.Close() }()
	jobs := kernel.PackageLifecycle()
	total := uint64(100)
	job, err := jobs.Begin(ctx, BeginPackageJobInput{
		AppID: "nimi.example", SourceClass: SourceClassVerified, Kind: PackageJobInstall,
		TargetRef: "descriptor:nimi.example:1.0.0", ProgressBasis: PackageProgressBytes,
		BytesTotal: &total, Cancelable: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if job.Phase != PackageJobQueued || job.BytesCompleted != 0 || job.CompletedAt != nil {
		t.Fatalf("initial job = %+v", job)
	}
	if _, err := jobs.Begin(ctx, BeginPackageJobInput{
		AppID: job.AppID, SourceClass: job.SourceClass, Kind: PackageJobRepair,
		TargetRef: job.TargetRef, ProgressBasis: PackageProgressIndeterminate,
	}); !errors.Is(err, ErrPackageJobActive) {
		t.Fatalf("concurrent job error = %v", err)
	}
	job, err = jobs.Advance(ctx, job.JobID, PackageJobQueued, PackageJobDownloading, PackageJobProgress{BytesCompleted: 10})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := jobs.Advance(ctx, job.JobID, PackageJobDownloading, PackageJobVerifying, PackageJobProgress{BytesCompleted: 9}); !errors.Is(err, ErrPackageJobProgress) {
		t.Fatalf("regressed progress error = %v", err)
	}
	job, err = jobs.Fail(ctx, job.JobID, PackageJobDownloading, "network-unavailable")
	if err != nil {
		t.Fatal(err)
	}
	if job.Phase != PackageJobFailed || job.CompletedAt == nil || job.TerminalResult != "failed" {
		t.Fatalf("failed job = %+v", job)
	}
	if _, err := jobs.Advance(ctx, job.JobID, PackageJobFailed, PackageJobVerifying, PackageJobProgress{BytesCompleted: 10}); !errors.Is(err, ErrPackageJobTerminal) {
		t.Fatalf("terminal advance error = %v", err)
	}
	cancelable, err := jobs.Begin(ctx, BeginPackageJobInput{
		AppID: job.AppID, SourceClass: job.SourceClass, Kind: PackageJobRepair,
		TargetRef: job.TargetRef, ProgressBasis: PackageProgressIndeterminate, Cancelable: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	canceled, err := jobs.Cancel(ctx, cancelable.JobID, PackageJobQueued, "user-canceled")
	if err != nil || canceled.Phase != PackageJobCanceled || canceled.CompletedAt == nil {
		t.Fatalf("canceled job = %+v err=%v", canceled, err)
	}
	if _, err := jobs.Begin(ctx, BeginPackageJobInput{
		AppID: "nimi.local", SourceClass: SourceClassLocalDevelopment, Kind: PackageJobInstall,
		TargetRef: "local", ProgressBasis: PackageProgressIndeterminate,
	}); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("local development package job error = %v", err)
	}
	listed, err := jobs.ListJobs(ctx)
	if err != nil || len(listed) != 2 || listed[0].JobID != job.JobID || listed[1].JobID != canceled.JobID {
		t.Fatalf("listed package jobs = %+v err=%v", listed, err)
	}
	for _, listedJob := range listed {
		if listedJob.SourceClass == SourceClassLocalDevelopment {
			t.Fatalf("local development escaped package job list: %+v", listedJob)
		}
	}
}

func TestPackageLifecycleCommitAndUninstallBoundariesRejectCancel(t *testing.T) {
	ctx := context.Background()
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"),
		mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "install-one", 0xb2)
	defer func() { _ = kernel.Close() }()
	store := kernel.PackageLifecycle()

	install := beginCommittingJob(t, ctx, store, PackageJobInstall, "descriptor:nimi.example:1.0.0")
	committed, err := store.CommitPackageRelease(ctx, CommitPackageReleaseInput{
		JobID: install.JobID, Version: "1.0.0", Registration: verifiedRegistrationInput("lineage:1", 1),
	})
	if err != nil {
		t.Fatal(err)
	}

	uninstall, err := store.Begin(ctx, BeginPackageJobInput{
		AppID: "nimi.example", SourceClass: SourceClassVerified, Kind: PackageJobUninstall,
		TargetRef: "descriptor:nimi.example:1.0.0", ProgressBasis: PackageProgressIndeterminate, Cancelable: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	uninstall = advanceJob(t, ctx, store, uninstall, PackageJobRemovingPackage, PackageJobProgress{})
	if uninstall.Cancelable {
		t.Fatal("removing-package job remained cancelable")
	}
	uninstall = advanceJob(t, ctx, store, uninstall, PackageJobUnregistering, PackageJobProgress{})
	if uninstall.Cancelable {
		t.Fatal("unregistering job remained cancelable")
	}
	if _, err := store.Cancel(ctx, uninstall.JobID, PackageJobUnregistering, "too-late"); !errors.Is(err, ErrPackageJobNotCancelable) {
		t.Fatalf("cancel after uninstall boundary error = %v", err)
	}
	completed, err := store.CompleteUninstall(ctx, uninstall.JobID)
	if err != nil || completed.Phase != PackageJobCompleted {
		t.Fatalf("complete uninstall = %+v err=%v", completed, err)
	}
	if _, err := store.GetCommittedRelease(ctx, "nimi.example", SourceClassVerified); !errors.Is(err, ErrCommittedReleaseNotFound) {
		t.Fatalf("removed committed release = %v", err)
	}
	if _, err := kernel.Registrations().GetActiveByHandle(ctx, committed.Registration.RegistrationHandle); !errors.Is(err, ErrRegistrationTombstoned) {
		t.Fatalf("tombstoned registration = %v", err)
	}
	var canonicalCount, bindingCount int
	if err := kernel.db.QueryRowContext(ctx, `SELECT count(*) FROM canonical_registration WHERE registration_handle = ?`, committed.Registration.RegistrationHandle).Scan(&canonicalCount); err != nil || canonicalCount != 1 {
		t.Fatalf("durable registration count = %d err=%v", canonicalCount, err)
	}
	if err := kernel.db.QueryRowContext(ctx, `SELECT count(*) FROM current_host_binding WHERE registration_handle = ?`, committed.Registration.RegistrationHandle).Scan(&bindingCount); err != nil || bindingCount != 1 {
		t.Fatalf("durable binding count = %d err=%v", bindingCount, err)
	}
}

func TestCommitVerifiedReleaseIsAtomicAndFailedUpdatePreservesActive(t *testing.T) {
	ctx := context.Background()
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"),
		mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "install-one", 0xc1)
	defer func() { _ = kernel.Close() }()
	store := kernel.PackageLifecycle()

	installJob := beginCommittingJob(t, ctx, store, PackageJobInstall, "descriptor:nimi.example:1.0.0")
	first, err := store.CommitPackageRelease(ctx, CommitPackageReleaseInput{
		JobID:        installJob.JobID,
		Version:      "1.0.0",
		Registration: verifiedRegistrationInput("lineage:1", 1),
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.Job.Phase != PackageJobCompleted || first.Release.Version != "1.0.0" || first.Registration.SourceGeneration != 1 {
		t.Fatalf("first commit = %+v", first)
	}

	updateJob, err := store.Begin(ctx, BeginPackageJobInput{
		AppID: "nimi.example", SourceClass: SourceClassVerified, Kind: PackageJobUpdate,
		TargetRef: "descriptor:nimi.example:1.1.0", ProgressBasis: PackageProgressSteps,
		StepsTotal: uint64Pointer(4), Cancelable: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	updateJob = advanceJob(t, ctx, store, updateJob, PackageJobVerifying, PackageJobProgress{StepsCompleted: 1})
	updateJob = advanceJob(t, ctx, store, updateJob, PackageJobStaging, PackageJobProgress{StepsCompleted: 3})
	active, err := store.GetCommittedRelease(ctx, "nimi.example", SourceClassVerified)
	if err != nil || active.Version != "1.0.0" {
		t.Fatalf("staging changed active release = %+v err=%v", active, err)
	}
	updateJob = advanceJob(t, ctx, store, updateJob, PackageJobCommitting, PackageJobProgress{StepsCompleted: 4})
	if updateJob.Cancelable {
		t.Fatal("committing job remained cancelable")
	}
	if _, err := store.Cancel(ctx, updateJob.JobID, PackageJobCommitting, "too-late"); !errors.Is(err, ErrPackageJobNotCancelable) {
		t.Fatalf("cancel after commit boundary error = %v", err)
	}
	registration := verifiedRegistrationInput("lineage:2", 2)
	registration.ExistingRegistrationHandle = first.Registration.RegistrationHandle
	second, err := store.CommitPackageRelease(ctx, CommitPackageReleaseInput{
		JobID: updateJob.JobID, Version: "1.1.0", Registration: registration,
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.Release.Version != "1.1.0" || second.Registration.RegistrationHandle != first.Registration.RegistrationHandle || second.Registration.SourceGeneration != 2 {
		t.Fatalf("updated commit = %+v", second)
	}

	failedJob, err := store.Begin(ctx, BeginPackageJobInput{
		AppID: "nimi.example", SourceClass: SourceClassVerified, Kind: PackageJobUpdate,
		TargetRef: "descriptor:nimi.example:1.2.0", ProgressBasis: PackageProgressIndeterminate,
	})
	if err != nil {
		t.Fatal(err)
	}
	failedJob = advanceJob(t, ctx, store, failedJob, PackageJobVerifying, PackageJobProgress{})
	failedJob = advanceJob(t, ctx, store, failedJob, PackageJobStaging, PackageJobProgress{})
	failedJob, err = store.Fail(ctx, failedJob.JobID, PackageJobStaging, "verification-failed")
	if err != nil || failedJob.Phase != PackageJobFailed {
		t.Fatalf("failed update = %+v err=%v", failedJob, err)
	}
	active, err = store.GetCommittedRelease(ctx, "nimi.example", SourceClassVerified)
	if err != nil || active.Version != "1.1.0" {
		t.Fatalf("failed update replaced active release = %+v err=%v", active, err)
	}
	releases, err := store.ListCommittedReleases(ctx)
	if err != nil || len(releases) != 1 || releases[0].Version != "1.1.0" || releases[0].SourceClass != SourceClassVerified {
		t.Fatalf("listed committed releases = %+v err=%v", releases, err)
	}
}

func TestRepairCannotChangeCommittedReleaseIdentityOrImmutableSeam(t *testing.T) {
	ctx := context.Background()
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"),
		mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "repair-one", 0xc2)
	defer func() { _ = kernel.Close() }()
	store := kernel.PackageLifecycle()
	install := beginCommittingJob(t, ctx, store, PackageJobInstall, "descriptor:nimi.example:1.0.0")
	first, err := store.CommitPackageRelease(ctx, CommitPackageReleaseInput{
		JobID: install.JobID, Version: "1.0.0", Registration: verifiedRegistrationInput("lineage:1", 1),
	})
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name      string
		targetRef string
		version   string
		mutate    func(*RegisterInstalledInput)
	}{
		{name: "version", targetRef: first.Release.ReleaseRef, version: "1.0.1"},
		{name: "release ref", targetRef: "descriptor:nimi.example:1.0.1", version: first.Release.Version},
		{name: "immutable seam", targetRef: first.Release.ReleaseRef, version: first.Release.Version, mutate: func(input *RegisterInstalledInput) {
			input.ImmutableLineageID = "lineage:other"
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repair := beginCommittingJob(t, ctx, store, PackageJobRepair, tc.targetRef)
			registration := verifiedRegistrationInput("lineage:1", 1)
			registration.ExistingRegistrationHandle = first.Registration.RegistrationHandle
			if tc.mutate != nil {
				tc.mutate(&registration)
			}
			if _, err := store.CommitPackageRelease(ctx, CommitPackageReleaseInput{
				JobID: repair.JobID, Version: tc.version, Registration: registration,
			}); !errors.Is(err, ErrStateConflict) {
				t.Fatalf("repair changed committed release: %v", err)
			}
			if _, err := store.Fail(ctx, repair.JobID, PackageJobCommitting, "repair-input-conflict"); err != nil {
				t.Fatal(err)
			}
		})
	}
	active, err := store.GetCommittedRelease(ctx, first.Release.AppID, first.Release.SourceClass)
	if err != nil || active.Version != first.Release.Version || active.ReleaseRef != first.Release.ReleaseRef ||
		active.ImmutableLineageID != first.Release.ImmutableLineageID {
		t.Fatalf("failed repair changed active release = %+v err=%v", active, err)
	}
}

func beginCommittingJob(t *testing.T, ctx context.Context, store *PackageLifecycleStore, kind PackageJobKind, targetRef string) PackageJob {
	t.Helper()
	job, err := store.Begin(ctx, BeginPackageJobInput{
		AppID: "nimi.example", SourceClass: SourceClassVerified, Kind: kind,
		TargetRef: targetRef, ProgressBasis: PackageProgressIndeterminate,
	})
	if err != nil {
		t.Fatal(err)
	}
	job = advanceJob(t, ctx, store, job, PackageJobVerifying, PackageJobProgress{})
	job = advanceJob(t, ctx, store, job, PackageJobStaging, PackageJobProgress{})
	return advanceJob(t, ctx, store, job, PackageJobCommitting, PackageJobProgress{})
}

func advanceJob(t *testing.T, ctx context.Context, store *PackageLifecycleStore, job PackageJob, phase PackageJobPhase, progress PackageJobProgress) PackageJob {
	t.Helper()
	advanced, err := store.Advance(ctx, job.JobID, job.Phase, phase, progress)
	if err != nil {
		t.Fatal(err)
	}
	return advanced
}

func verifiedRegistrationInput(lineage string, provenanceRevision uint64) RegisterInstalledInput {
	return RegisterInstalledInput{
		AppID: "nimi.example", DisplayName: "Example", SourceClass: SourceClassVerified,
		SourceRef: "platform-app:nimi.example", ProjectRoot: "C:/Program Files/Nimi Apps/Example",
		ManifestPath: "C:/Program Files/Nimi Apps/Example/nimi.app.yaml", ShellKind: 1,
		RawDeclaration: []string{"runtime.consume"}, ImmutableLineageID: lineage,
		ProvenanceAttestationRefs: []string{"attestation:" + lineage}, ProvenanceRevision: provenanceRevision,
		ExecutionProfileRef: "execution:electron", HostExecutableDigest: "host:" + lineage,
		PayloadRootDigest: "payload:" + lineage,
	}
}

func TestVerifiedRegistrationRequiresProvenanceAttestation(t *testing.T) {
	input := verifiedRegistrationInput("lineage:1", 1)
	input.ProvenanceAttestationRefs = nil
	if err := validateInstalledInput(input); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("verified empty provenance error = %v", err)
	}
	input.SourceClass = SourceClass("user_imported")
	if err := validateInstalledInput(input); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("retired user-imported source error = %v", err)
	}
}

func uint64Pointer(value uint64) *uint64 { return &value }
