package localappkernel

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestVerifiedPolicyVerificationPersistsAcrossRestartAndClearsOnUpdateOrUninstall(t *testing.T) {
	ctx := context.Background()
	dataRoot := t.TempDir()
	dbPath, err := CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	identity := mustWindowsIdentity(t, "S-1-5-21-1000-1001-1002-1009")
	clock := time.Date(2026, 11, 27, 10, 0, 0, 0, time.UTC)
	openKernel := func() *Kernel {
		t.Helper()
		k, err := OpenSQLite(ctx, dbPath, identity, Options{
			HostInstallID: "host-policy-test",
			DataRoot:      dataRoot,
			Now:           func() time.Time { return clock },
		})
		if err != nil {
			t.Fatal(err)
		}
		return k
	}

	kernel := openKernel()
	store := kernel.PackageLifecycle()
	releaseRefV1 := "nats_v1_rel1"
	job, err := store.Begin(ctx, BeginPackageJobInput{
		AppID: "publisher.example", SourceClass: SourceClassVerified, Kind: PackageJobInstall,
		TargetRef: releaseRefV1, ProgressBasis: PackageProgressIndeterminate,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, next := range []PackageJobPhase{PackageJobDownloading, PackageJobVerifying, PackageJobStaging, PackageJobCommitting} {
		job, err = store.Advance(ctx, job.JobID, job.Phase, next, PackageJobProgress{})
		if err != nil {
			t.Fatal(err)
		}
	}
	appRootV1 := filepath.Join(dataRoot, "apps", "packages", "releases", job.JobID)
	committed, err := store.CommitPackageRelease(ctx, CommitPackageReleaseInput{
		JobID:            job.JobID,
		Version:          "1.0.0",
		AppInfoJSON:      []byte(`{"app":"example"}`),
		LaunchConfigJSON: []byte(`{"expected":"v1"}`),
		Registration: RegisterInstalledInput{
			AppID: "publisher.example", DisplayName: "Example", SourceClass: SourceClassVerified,
			SourceRef: "public-registry-app:v1:publisher.example", ProjectRoot: appRootV1,
			ManifestPath: filepath.Join(appRootV1, "nimi.app.yaml"), RawDeclaration: []string{"runtime.consume"},
			ImmutableLineageID: releaseRefV1, ProvenanceAttestationRefs: []string{"https://github.com/publisher/example/attestations/1"},
			ProvenanceRevision: 1, ExecutionProfileRef: "windows-user-mode-as-invoker-v1",
			HostExecutableDigest: "bii_v1_host1", PayloadRootDigest: "sha256:payload1",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Existing install without InitialPolicyVerification has no usable verification record.
	if _, err := store.GetVerifiedPolicy(ctx, "publisher.example", releaseRefV1, "publisher.example@1.0.0", "windows-x86_64"); !errors.Is(err, ErrVerifiedPolicyNotFound) {
		t.Fatalf("expected ErrVerifiedPolicyNotFound before first verification, got %v", err)
	}

	verifiedAt := clock
	effective, err := store.RecordVerifiedPolicy(ctx, VerifiedPolicyVerification{
		AppID:            "publisher.example",
		ReleaseRef:       releaseRefV1,
		DescriptorID:     "publisher.example@1.0.0",
		TargetID:         "windows-x86_64",
		Status:           VerifiedPolicyAllowed,
		PolicyRevision:   0,
		RegistryRevision: strings.Repeat("a", 40),
		VerifiedAt:       verifiedAt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if effective.Status != VerifiedPolicyAllowed || !effective.VerifiedAt.Equal(verifiedAt) || effective.RegistryRevision != strings.Repeat("a", 40) {
		t.Fatalf("unexpected effective initial allow: %+v", effective)
	}

	// Mismatched descriptor_id or target_id must never match.
	if _, err := store.GetVerifiedPolicy(ctx, "publisher.example", releaseRefV1, "publisher.example@1.0.1", "windows-x86_64"); !errors.Is(err, ErrVerifiedPolicyNotFound) {
		t.Fatalf("descriptor mismatch returned %v", err)
	}
	if _, err := store.GetVerifiedPolicy(ctx, "publisher.example", releaseRefV1, "publisher.example@1.0.0", "desktop-universal"); !errors.Is(err, ErrVerifiedPolicyNotFound) {
		t.Fatalf("target mismatch returned %v", err)
	}

	// Simulate Runtime restart and advance clock: persisted record and timestamp stay unchanged.
	if err := kernel.Close(); err != nil {
		t.Fatal(err)
	}
	clock = clock.Add(48 * time.Hour)
	kernel = openKernel()
	defer func() { _ = kernel.Close() }()
	store = kernel.PackageLifecycle()

	got, err := store.GetVerifiedPolicy(ctx, "publisher.example", releaseRefV1, "publisher.example@1.0.0", "windows-x86_64")
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != VerifiedPolicyAllowed || !got.VerifiedAt.Equal(verifiedAt) || got.RegistryRevision != strings.Repeat("a", 40) {
		t.Fatalf("unexpected persisted policy after restart: %+v", got)
	}

	// Newer deny overwrites old allow record.
	denyTime := clock
	effective, err = store.RecordVerifiedPolicy(ctx, VerifiedPolicyVerification{
		AppID:          "publisher.example",
		ReleaseRef:     releaseRefV1,
		DescriptorID:   "publisher.example@1.0.0",
		TargetID:       "windows-x86_64",
		Status:         VerifiedPolicyBlocked,
		PolicyReason:   "kill-switch-active",
		PolicyRevision: 7,
		VerifiedAt:     denyTime,
	})
	if err != nil {
		t.Fatal(err)
	}
	if effective.Status != VerifiedPolicyBlocked || effective.PolicyReason != "kill-switch-active" || effective.PolicyRevision != 7 || !effective.VerifiedAt.Equal(denyTime) {
		t.Fatalf("unexpected effective deny: %+v", effective)
	}
	got, err = store.GetVerifiedPolicy(ctx, "publisher.example", releaseRefV1, "publisher.example@1.0.0", "windows-x86_64")
	if err != nil || got.Status != VerifiedPolicyBlocked || got.PolicyReason != "kill-switch-active" || got.PolicyRevision != 7 || !got.VerifiedAt.Equal(denyTime) {
		t.Fatalf("deny did not overwrite allow: %+v err=%v", got, err)
	}

	// Update to v1.1.0 without InitialPolicyVerification clears the old v1.0.0 policy record.
	releaseRefV2 := "nats_v1_rel2"
	prevRelease := committed.Release
	updJob, err := store.Begin(ctx, BeginPackageJobInput{
		AppID: "publisher.example", SourceClass: SourceClassVerified, Kind: PackageJobUpdate,
		TargetRef: releaseRefV2, ProgressBasis: PackageProgressIndeterminate, PreviousRelease: &prevRelease,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, next := range []PackageJobPhase{PackageJobDownloading, PackageJobVerifying, PackageJobStaging, PackageJobCommitting} {
		updJob, err = store.Advance(ctx, updJob.JobID, updJob.Phase, next, PackageJobProgress{})
		if err != nil {
			t.Fatal(err)
		}
	}
	appRootV2 := filepath.Join(dataRoot, "apps", "packages", "releases", updJob.JobID)
	updated, err := store.CommitPackageRelease(ctx, CommitPackageReleaseInput{
		JobID:            updJob.JobID,
		Version:          "1.1.0",
		AppInfoJSON:      []byte(`{"app":"example","v":"1.1.0"}`),
		LaunchConfigJSON: []byte(`{"expected":"v2"}`),
		Registration: RegisterInstalledInput{
			ExistingRegistrationHandle: committed.Registration.RegistrationHandle,
			AppID:                      "publisher.example", DisplayName: "Example", SourceClass: SourceClassVerified,
			SourceRef: "public-registry-app:v1:publisher.example", ProjectRoot: appRootV2,
			ManifestPath: filepath.Join(appRootV2, "nimi.app.yaml"), RawDeclaration: []string{"runtime.consume"},
			ImmutableLineageID: releaseRefV2, ProvenanceAttestationRefs: []string{"https://github.com/publisher/example/attestations/2"},
			ProvenanceRevision: 2, ExecutionProfileRef: "windows-user-mode-as-invoker-v1",
			HostExecutableDigest: "bii_v1_host2", PayloadRootDigest: "sha256:payload2",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetVerifiedPolicy(ctx, "publisher.example", releaseRefV2, "publisher.example@1.1.0", "windows-x86_64"); !errors.Is(err, ErrVerifiedPolicyNotFound) {
		t.Fatalf("update inherited prior policy record: %v", err)
	}
	// Recording against old release_ref fails because committed release moved to v2.
	if _, err := store.RecordVerifiedPolicy(ctx, VerifiedPolicyVerification{
		AppID:            "publisher.example",
		ReleaseRef:       releaseRefV1,
		DescriptorID:     "publisher.example@1.0.0",
		TargetID:         "windows-x86_64",
		Status:           VerifiedPolicyAllowed,
		RegistryRevision: strings.Repeat("b", 40),
		VerifiedAt:       clock,
	}); !errors.Is(err, ErrCommittedReleaseNotFound) {
		t.Fatalf("stale release policy record accepted: %v", err)
	}

	// Record for v2, then verify uninstall cascades deletion.
	if effective, err := store.RecordVerifiedPolicy(ctx, VerifiedPolicyVerification{
		AppID:            "publisher.example",
		ReleaseRef:       releaseRefV2,
		DescriptorID:     "publisher.example@1.1.0",
		TargetID:         "windows-x86_64",
		Status:           VerifiedPolicyAllowed,
		RegistryRevision: strings.Repeat("b", 40),
		VerifiedAt:       clock,
	}); err != nil || effective.Status != VerifiedPolicyAllowed || effective.ReleaseRef != releaseRefV2 {
		t.Fatalf("record v2 policy = %+v err=%v", effective, err)
	}
	unJob, err := store.Begin(ctx, BeginPackageJobInput{
		AppID: "publisher.example", SourceClass: SourceClassVerified, Kind: PackageJobUninstall,
		TargetRef: releaseRefV2, ProgressBasis: PackageProgressIndeterminate,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, next := range []PackageJobPhase{PackageJobRemovingPackage, PackageJobUnregistering} {
		unJob, err = store.Advance(ctx, unJob.JobID, unJob.Phase, next, PackageJobProgress{})
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.CompleteUninstall(ctx, unJob.JobID, updated.Registration.RegistrationHandle, updated.Registration.SourceGeneration, updated.Registration.DeclarationGeneration); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetVerifiedPolicy(ctx, "publisher.example", releaseRefV2, "publisher.example@1.1.0", "windows-x86_64"); !errors.Is(err, ErrVerifiedPolicyNotFound) {
		t.Fatalf("uninstall retained policy record: %v", err)
	}
}

func TestRecordVerifiedPolicyEnforcesMonotonicDenyPrecedenceAndDelete(t *testing.T) {
	ctx := context.Background()
	dataRoot := t.TempDir()
	dbPath, err := CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	identity := mustWindowsIdentity(t, "S-1-5-21-1000-1001-1002-1011")
	t0 := time.Date(2026, 11, 27, 10, 0, 0, 0, time.UTC)
	kernel, err := OpenSQLite(ctx, dbPath, identity, Options{
		HostInstallID: "host-policy-precedence",
		DataRoot:      dataRoot,
		Now:           func() time.Time { return t0 },
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = kernel.Close() }()

	store := kernel.PackageLifecycle()
	releaseRef := "nats_v1_rel_prec"
	job, err := store.Begin(ctx, BeginPackageJobInput{
		AppID: "publisher.prec", SourceClass: SourceClassVerified, Kind: PackageJobInstall,
		TargetRef: releaseRef, ProgressBasis: PackageProgressIndeterminate,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, next := range []PackageJobPhase{PackageJobDownloading, PackageJobVerifying, PackageJobStaging, PackageJobCommitting} {
		job, err = store.Advance(ctx, job.JobID, job.Phase, next, PackageJobProgress{})
		if err != nil {
			t.Fatal(err)
		}
	}
	appRoot := filepath.Join(dataRoot, "apps", "packages", "releases", job.JobID)
	if _, err := store.CommitPackageRelease(ctx, CommitPackageReleaseInput{
		JobID: job.JobID, Version: "1.0.0", AppInfoJSON: []byte(`{"app":"prec"}`), LaunchConfigJSON: []byte(`{"v":1}`),
		Registration: RegisterInstalledInput{
			AppID: "publisher.prec", DisplayName: "Prec", SourceClass: SourceClassVerified,
			SourceRef: "public-registry-app:v1:publisher.prec", ProjectRoot: appRoot,
			ManifestPath: filepath.Join(appRoot, "nimi.app.yaml"), RawDeclaration: []string{"runtime.consume"},
			ImmutableLineageID: releaseRef, ProvenanceAttestationRefs: []string{"https://github.com/publisher/prec/attestations/1"},
			ProvenanceRevision: 1, ExecutionProfileRef: "windows-user-mode-as-invoker-v1",
			HostExecutableDigest: "bii_v1_host_prec", PayloadRootDigest: "sha256:payload_prec",
		},
	}); err != nil {
		t.Fatal(err)
	}

	mustGet := func() VerifiedPolicyVerification {
		t.Helper()
		got, getErr := store.GetVerifiedPolicy(ctx, "publisher.prec", releaseRef, "publisher.prec@1.0.0", "windows-x86_64")
		if getErr != nil {
			t.Fatalf("GetVerifiedPolicy: %v", getErr)
		}
		return got
	}

	// 1. Allowed -> allowed advances VerifiedAt only monotonically forward.
	effective, err := store.RecordVerifiedPolicy(ctx, VerifiedPolicyVerification{
		AppID: "publisher.prec", ReleaseRef: releaseRef, DescriptorID: "publisher.prec@1.0.0", TargetID: "windows-x86_64",
		Status: VerifiedPolicyAllowed, PolicyRevision: 0, RegistryRevision: strings.Repeat("a", 40), VerifiedAt: t0.Add(2 * time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if effective.Status != VerifiedPolicyAllowed || !effective.VerifiedAt.Equal(t0.Add(2*time.Minute)) || effective.RegistryRevision != strings.Repeat("a", 40) {
		t.Fatalf("unexpected effective initial allow: %+v", effective)
	}
	effective, err = store.RecordVerifiedPolicy(ctx, VerifiedPolicyVerification{
		AppID: "publisher.prec", ReleaseRef: releaseRef, DescriptorID: "publisher.prec@1.0.0", TargetID: "windows-x86_64",
		Status: VerifiedPolicyAllowed, PolicyRevision: 0, RegistryRevision: strings.Repeat("b", 40), VerifiedAt: t0.Add(1 * time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if effective.Status != VerifiedPolicyAllowed || !effective.VerifiedAt.Equal(t0.Add(2*time.Minute)) || effective.RegistryRevision != strings.Repeat("a", 40) {
		t.Fatalf("older allow did not return preserved monotonic allow: %+v", effective)
	}
	if got := mustGet(); !got.VerifiedAt.Equal(t0.Add(2 * time.Minute)) || got.RegistryRevision != strings.Repeat("a", 40) {
		t.Fatalf("older allow rolled VerifiedAt backward: %+v", got)
	}

	// 2. policy_blocked rev=5 supersedes allowed rev=0.
	blockTime := t0.Add(3 * time.Minute)
	effective, err = store.RecordVerifiedPolicy(ctx, VerifiedPolicyVerification{
		AppID: "publisher.prec", ReleaseRef: releaseRef, DescriptorID: "publisher.prec@1.0.0", TargetID: "windows-x86_64",
		Status: VerifiedPolicyBlocked, PolicyReason: "security-revoked", PolicyRevision: 5, VerifiedAt: blockTime,
	})
	if err != nil {
		t.Fatal(err)
	}
	if effective.Status != VerifiedPolicyBlocked || effective.PolicyRevision != 5 || effective.PolicyReason != "security-revoked" {
		t.Fatalf("expected effective policy_blocked rev=5, got %+v", effective)
	}
	if got := mustGet(); got.Status != VerifiedPolicyBlocked || got.PolicyRevision != 5 {
		t.Fatalf("expected policy_blocked rev=5, got %+v", got)
	}

	// 3. Stale allowed with lower rev (4) OR equal rev (5) MUST NOT overwrite policy_blocked rev=5
	// and MUST return the preserved policy_blocked rev=5 as the effective record.
	for _, rev := range []uint64{0, 4, 5} {
		effective, err = store.RecordVerifiedPolicy(ctx, VerifiedPolicyVerification{
			AppID: "publisher.prec", ReleaseRef: releaseRef, DescriptorID: "publisher.prec@1.0.0", TargetID: "windows-x86_64",
			Status: VerifiedPolicyAllowed, PolicyRevision: rev, RegistryRevision: strings.Repeat("c", 40),
			VerifiedAt: blockTime.Add(10 * time.Minute), ObservedAt: blockTime.Add(10 * time.Minute),
		})
		if err != nil {
			t.Fatal(err)
		}
		if effective.Status != VerifiedPolicyBlocked || effective.PolicyRevision != 5 || effective.PolicyReason != "security-revoked" {
			t.Fatalf("allowed rev=%d returned effective=%+v, want preserved policy_blocked rev=5", rev, effective)
		}
		if got := mustGet(); got.Status != VerifiedPolicyBlocked || got.PolicyRevision != 5 || got.PolicyReason != "security-revoked" {
			t.Fatalf("allowed rev=%d overwrote policy_blocked rev=5: %+v", rev, got)
		}
	}

	// 4. Strictly higher rev (6) cleanly lifts policy_blocked rev=5.
	liftTime := blockTime.Add(5 * time.Minute)
	effective, err = store.RecordVerifiedPolicy(ctx, VerifiedPolicyVerification{
		AppID: "publisher.prec", ReleaseRef: releaseRef, DescriptorID: "publisher.prec@1.0.0", TargetID: "windows-x86_64",
		Status: VerifiedPolicyAllowed, PolicyRevision: 6, RegistryRevision: strings.Repeat("d", 40),
		VerifiedAt: liftTime, ObservedAt: liftTime,
	})
	if err != nil {
		t.Fatal(err)
	}
	if effective.Status != VerifiedPolicyAllowed || effective.PolicyRevision != 6 || !effective.VerifiedAt.Equal(liftTime) {
		t.Fatalf("rev=6 lift returned unexpected effective=%+v", effective)
	}
	if got := mustGet(); got.Status != VerifiedPolicyAllowed || got.PolicyRevision != 6 || !got.VerifiedAt.Equal(liftTime) {
		t.Fatalf("rev=6 did not lift policy_blocked rev=5: %+v", got)
	}

	// 5. Stale policy_blocked with lower rev (5) MUST NOT overwrite lifted allowed rev=6
	// and MUST return the preserved allowed rev=6 as effective.
	effective, err = store.RecordVerifiedPolicy(ctx, VerifiedPolicyVerification{
		AppID: "publisher.prec", ReleaseRef: releaseRef, DescriptorID: "publisher.prec@1.0.0", TargetID: "windows-x86_64",
		Status: VerifiedPolicyBlocked, PolicyReason: "stale-ban", PolicyRevision: 5, VerifiedAt: liftTime.Add(time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if effective.Status != VerifiedPolicyAllowed || effective.PolicyRevision != 6 {
		t.Fatalf("stale policy_blocked rev=5 returned effective=%+v, want preserved allowed rev=6", effective)
	}
	if got := mustGet(); got.Status != VerifiedPolicyAllowed || got.PolicyRevision != 6 {
		t.Fatalf("stale policy_blocked rev=5 overwrote allowed rev=6: %+v", got)
	}

	// 6. row_absent with ObservedAt >= existing.VerifiedAt supersedes allowed even when allowed had PolicyRevision=6.
	absentTime := liftTime.Add(2 * time.Minute)
	effective, err = store.RecordVerifiedPolicy(ctx, VerifiedPolicyVerification{
		AppID: "publisher.prec", ReleaseRef: releaseRef, DescriptorID: "publisher.prec@1.0.0", TargetID: "windows-x86_64",
		Status: VerifiedPolicyRowAbsent, VerifiedAt: absentTime, ObservedAt: absentTime,
	})
	if err != nil {
		t.Fatal(err)
	}
	if effective.Status != VerifiedPolicyRowAbsent || !effective.VerifiedAt.Equal(absentTime) {
		t.Fatalf("row_absent returned unexpected effective=%+v", effective)
	}
	if got := mustGet(); got.Status != VerifiedPolicyRowAbsent || !got.VerifiedAt.Equal(absentTime) {
		t.Fatalf("row_absent did not supersede allowed: %+v", got)
	}

	// 7. Older or equal-timestamp allowed (even with higher PolicyRevision=6) MUST NOT overwrite row_absent
	// and MUST return the preserved row_absent as effective.
	for _, obsAt := range []time.Time{absentTime.Add(-time.Second), absentTime} {
		effective, err = store.RecordVerifiedPolicy(ctx, VerifiedPolicyVerification{
			AppID: "publisher.prec", ReleaseRef: releaseRef, DescriptorID: "publisher.prec@1.0.0", TargetID: "windows-x86_64",
			Status: VerifiedPolicyAllowed, PolicyRevision: 6, RegistryRevision: strings.Repeat("e", 40),
			VerifiedAt: absentTime.Add(time.Hour), ObservedAt: obsAt,
		})
		if err != nil {
			t.Fatal(err)
		}
		if effective.Status != VerifiedPolicyRowAbsent || !effective.VerifiedAt.Equal(absentTime) {
			t.Fatalf("allowed with ObservedAt=%v returned effective=%+v, want preserved row_absent at %v", obsAt, effective, absentTime)
		}
		if got := mustGet(); got.Status != VerifiedPolicyRowAbsent {
			t.Fatalf("allowed with ObservedAt=%v overwrote row_absent at %v: %+v", obsAt, absentTime, got)
		}
	}

	// 8. Strictly newer ObservedAt supersedes row_absent.
	restoreTime := absentTime.Add(time.Second)
	effective, err = store.RecordVerifiedPolicy(ctx, VerifiedPolicyVerification{
		AppID: "publisher.prec", ReleaseRef: releaseRef, DescriptorID: "publisher.prec@1.0.0", TargetID: "windows-x86_64",
		Status: VerifiedPolicyAllowed, PolicyRevision: 6, RegistryRevision: strings.Repeat("f", 40),
		VerifiedAt: restoreTime, ObservedAt: restoreTime,
	})
	if err != nil {
		t.Fatal(err)
	}
	if effective.Status != VerifiedPolicyAllowed || !effective.VerifiedAt.Equal(restoreTime) {
		t.Fatalf("strictly newer allowed returned unexpected effective=%+v", effective)
	}
	if got := mustGet(); got.Status != VerifiedPolicyAllowed || !got.VerifiedAt.Equal(restoreTime) {
		t.Fatalf("strictly newer allowed did not supersede row_absent: %+v", got)
	}

	// 9. DeleteVerifiedPolicy removes exact target record.
	if err := store.DeleteVerifiedPolicy(ctx, "publisher.prec", releaseRef, "publisher.prec@1.0.0", "windows-x86_64"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetVerifiedPolicy(ctx, "publisher.prec", releaseRef, "publisher.prec@1.0.0", "windows-x86_64"); !errors.Is(err, ErrVerifiedPolicyNotFound) {
		t.Fatalf("expected ErrVerifiedPolicyNotFound after DeleteVerifiedPolicy, got %v", err)
	}
}

func TestPublicCatalogBrowseSnapshotPersistsAcrossRestart(t *testing.T) {
	ctx := context.Background()
	dataRoot := t.TempDir()
	dbPath, err := CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	identity := mustWindowsIdentity(t, "S-1-5-21-1000-1001-1002-1010")
	kernel, err := OpenSQLite(ctx, dbPath, identity, Options{HostInstallID: "host-browse-test", DataRoot: dataRoot})
	if err != nil {
		t.Fatal(err)
	}
	store := kernel.PackageLifecycle()
	if _, err := store.ReadPublicCatalogBrowseSnapshot(ctx, "windows-x86_64", "windows", "x86_64"); !errors.Is(err, ErrBrowseSnapshotNotFound) {
		t.Fatalf("expected ErrBrowseSnapshotNotFound, got %v", err)
	}
	updatedAt := time.Date(2026, 11, 27, 12, 30, 0, 0, time.UTC)
	payload := []byte(`{"schema_version":1,"targets":[{"app_id":"publisher.example"}]}`)
	if err := store.SavePublicCatalogBrowseSnapshot(ctx, PublicCatalogBrowseSnapshot{
		TargetID:         "windows-x86_64",
		OS:               "windows",
		Arch:             "x86_64",
		RegistryRevision: strings.Repeat("c", 40),
		ProjectionJSON:   payload,
		UpdatedAt:        updatedAt,
	}); err != nil {
		t.Fatal(err)
	}
	if err := kernel.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenSQLite(ctx, dbPath, identity, Options{HostInstallID: "host-browse-test", DataRoot: dataRoot})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reopened.Close() }()
	got, err := reopened.PackageLifecycle().ReadPublicCatalogBrowseSnapshot(ctx, "windows-x86_64", "windows", "x86_64")
	if err != nil {
		t.Fatal(err)
	}
	if string(got.ProjectionJSON) != string(payload) || !got.UpdatedAt.Equal(updatedAt) || got.RegistryRevision != strings.Repeat("c", 40) {
		t.Fatalf("unexpected browse snapshot after restart: %+v", got)
	}
}
