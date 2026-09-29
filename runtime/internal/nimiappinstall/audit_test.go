package nimiappinstall

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

func packageAuditRecords(t *testing.T, store *auditlog.Store, operation string) []*runtimev1.AuditEventRecord {
	t.Helper()
	response, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: packageAuditDomain, PageSize: 100})
	if err != nil {
		t.Fatal(err)
	}
	var records []*runtimev1.AuditEventRecord
	for _, event := range response.GetEvents() {
		if event.GetOperation() == operation {
			records = append(records, event)
		}
	}
	return records
}

func TestPackageOwnerRecordsOneResultPerTerminalJob(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(server.Close)
	owner, registry, kernel := newQueueOwner(t, server, []byte("unused"), nil)
	audit := auditlog.New(100, 10)
	owner.audit = audit
	ctx := context.Background()

	// The owner's verification refusal is recorded once.
	_, failed, err := owner.beginInstallLocked(ctx, registry.targets["publisher.one@1.2.3"].Selector, "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = owner.failInstall(ctx, failed, filedownload.ErrHashMismatch, false)
	records := packageAuditRecords(t, audit, "app_package.install")
	if len(records) != 1 || records[0].GetReasonCode() != runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE ||
		records[0].GetAppId() != "publisher.one" || records[0].GetPayload().GetFields()["failure_reason"].GetStringValue() != "verification-failed" ||
		records[0].GetPayload().GetFields()["job_id"].GetStringValue() != failed.JobID {
		t.Fatalf("install refusal records = %v", records)
	}

	// A requester cancellation changes no installed state and is not an owner
	// result.
	_, canceledJob, err := owner.beginInstallLocked(ctx, registry.targets["publisher.two@1.2.3"].Selector, "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	canceledContext, cancel := context.WithCancel(ctx)
	cancel()
	_ = owner.failInstall(canceledContext, canceledJob, errors.New("requester stopped the install"), false)
	if job, err := kernel.PackageLifecycle().GetJob(ctx, canceledJob.JobID); err != nil || job.Phase != localappkernel.PackageJobCanceled {
		t.Fatalf("canceled job = %+v err=%v", job, err)
	}
	if records := packageAuditRecords(t, audit, "app_package.install"); len(records) != 1 {
		t.Fatalf("cancellation produced an owner record: %v", records)
	}

	// A committed uninstall is recorded once, after its registration commit.
	lifecycle := kernel.PackageLifecycle()
	releaseName := "audit-release"
	releaseRoot := filepath.Join(owner.packagesPath, packageReleaseDirectory, releaseName)
	if err := os.MkdirAll(releaseRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	install, err := lifecycle.Begin(ctx, localappkernel.BeginPackageJobInput{
		AppID: "publisher.audit", SourceClass: localappkernel.SourceClassVerified, Kind: localappkernel.PackageJobInstall,
		TargetRef: "audit-release-ref", ProgressBasis: localappkernel.PackageProgressIndeterminate,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, phase := range []localappkernel.PackageJobPhase{localappkernel.PackageJobVerifying, localappkernel.PackageJobStaging, localappkernel.PackageJobCommitting} {
		if install, err = lifecycle.Advance(ctx, install.JobID, install.Phase, phase, localappkernel.PackageJobProgress{}); err != nil {
			t.Fatal(err)
		}
	}
	committed, err := lifecycle.CommitPackageRelease(ctx, localappkernel.CommitPackageReleaseInput{
		JobID: install.JobID, Version: "1.0.0", AppInfoJSON: []byte(`{"snapshot":"audit"}`),
		Registration: localappkernel.RegisterInstalledInput{
			AppID: "publisher.audit", DisplayName: "Audit", SourceClass: localappkernel.SourceClassVerified,
			SourceRef: "public-registry-app:v1:publisher.audit", ProjectRoot: releaseRoot,
			ManifestPath: filepath.Join(releaseRoot, "nimi.app.yaml"), RawDeclaration: []string{"runtime.consume"},
			ImmutableLineageID: "audit-release-ref", ProvenanceAttestationRefs: []string{"attestation:audit"}, ProvenanceRevision: 1,
			ExecutionProfileRef: "execution:native", HostExecutableDigest: "host:audit", PayloadRootDigest: "payload:audit",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	handle := committed.Registration.RegistrationHandle
	uninstall, err := owner.StartUninstall(ctx, handle)
	if err != nil {
		t.Fatal(err)
	}
	if records := packageAuditRecords(t, audit, "app_package.uninstall"); len(records) != 0 {
		t.Fatalf("queued uninstall recorded a result: %v", records)
	}
	completed, err := owner.CompleteUninstall(ctx, uninstall.JobID, handle)
	if err != nil || completed.Phase != localappkernel.PackageJobCompleted {
		t.Fatalf("complete uninstall = %+v err=%v", completed, err)
	}
	records = packageAuditRecords(t, audit, "app_package.uninstall")
	if len(records) != 1 || records[0].GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED || records[0].GetAppId() != "publisher.audit" ||
		records[0].GetPayload().GetFields()["job_id"].GetStringValue() != uninstall.JobID {
		t.Fatalf("uninstall records = %v", records)
	}
}

type failingPackageAuditBackend struct {
	*runtimepersistence.Backend
	before, after bool
}

func (b *failingPackageAuditBackend) WriteTx(ctx context.Context, fn func(*sql.Tx) error) error {
	if b.before {
		return errors.New("audit unavailable")
	}
	return b.Backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if err := fn(tx); err != nil {
			return err
		}
		if b.after {
			return errors.New("audit commit failed")
		}
		return nil
	})
}

func TestPackageCommitAuditFailureRetainsTerminalJobAndDiagnostic(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	owner, _, kernel := newQueueOwner(t, server, []byte("unused"), nil)
	persistence, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "audit.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer persistence.Close()
	backend := &failingPackageAuditBackend{Backend: persistence}
	owner.audit, err = auditlog.Open(backend, nil, 100, 10)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	lifecycle := kernel.PackageLifecycle()
	job, err := lifecycle.Begin(ctx, localappkernel.BeginPackageJobInput{AppID: "publisher.audit", SourceClass: localappkernel.SourceClassVerified, Kind: localappkernel.PackageJobInstall, TargetRef: "audit-release-ref", ProgressBasis: localappkernel.PackageProgressIndeterminate})
	if err != nil {
		t.Fatal(err)
	}
	for _, phase := range []localappkernel.PackageJobPhase{localappkernel.PackageJobVerifying, localappkernel.PackageJobStaging, localappkernel.PackageJobCommitting} {
		job, err = lifecycle.Advance(ctx, job.JobID, job.Phase, phase, localappkernel.PackageJobProgress{})
		if err != nil {
			t.Fatal(err)
		}
	}
	root := filepath.Join(owner.packagesPath, packageReleaseDirectory, "audit-test")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	commit := func() error {
		result, err := lifecycle.CommitPackageRelease(ctx, localappkernel.CommitPackageReleaseInput{JobID: job.JobID, Version: "1.0.0", AppInfoJSON: []byte(`{"snapshot":"audit"}`), Registration: localappkernel.RegisterInstalledInput{
			AppID: job.AppID, DisplayName: "Audit", SourceClass: job.SourceClass, SourceRef: "public-registry-app:v1:publisher.audit", ProjectRoot: root, ManifestPath: filepath.Join(root, "nimi.app.yaml"), RawDeclaration: []string{"runtime.consume"}, ImmutableLineageID: "audit-release-ref", ProvenanceAttestationRefs: []string{"attestation:audit"}, ProvenanceRevision: 1, ExecutionProfileRef: "execution:native", HostExecutableDigest: "host:audit", PayloadRootDigest: "payload:audit",
		}})
		if err == nil {
			job = result.Job
		}
		return err
	}
	backend.before = true
	if committed, err := owner.commitRecordedPackage(job, commit); committed || err == nil {
		t.Fatal("unrecordable install committed")
	}
	before, err := lifecycle.GetJob(ctx, job.JobID)
	if err != nil || before.Phase != localappkernel.PackageJobCommitting {
		t.Fatal(before, err)
	}
	backend.before = false
	backend.after = true
	committed, err := owner.commitRecordedPackage(job, commit)
	if !committed || err == nil {
		t.Fatalf("missing audit commit failure: %v %v", committed, err)
	}
	reported := owner.reportUnrecordedPackage(job, err)
	if reported.Phase != localappkernel.PackageJobCompleted || reported.ReasonCode != "AUDIT_RESULT_UNRECORDED" {
		t.Fatal(reported)
	}
	queried, err := owner.GetJob(ctx, job.JobID)
	if err != nil || queried.Phase != localappkernel.PackageJobCompleted || queried.ReasonCode != "AUDIT_RESULT_UNRECORDED" {
		t.Fatal(queried, err)
	}
}
