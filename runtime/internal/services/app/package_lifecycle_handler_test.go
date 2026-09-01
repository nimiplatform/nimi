package app

import (
	"bytes"
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestRuntimeAppPackageReadAndCancelUseCommittedStore(t *testing.T) {
	ctx := context.Background()
	identity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(501, 77)
	if err != nil {
		t.Fatal(err)
	}
	dataRoot := t.TempDir()
	databasePath, err := localappkernel.CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(ctx, databasePath, identity, localappkernel.Options{
		Random: bytes.NewReader(bytes.Repeat([]byte{0xd1}, 1024)), HostInstallID: "package-handler-host", DataRoot: dataRoot,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })
	job, err := kernel.PackageLifecycle().Begin(ctx, localappkernel.BeginPackageJobInput{
		AppID: "nimi.example", SourceClass: localappkernel.SourceClassVerified,
		Kind: localappkernel.PackageJobRepair, TargetRef: "descriptor:nimi.example:1.0.0",
		ProgressBasis: localappkernel.PackageProgressIndeterminate, Cancelable: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	service := New(nil, WithLocalAppKernel(kernel))

	releases, err := service.ListCommittedAppReleases(ctx, &runtimev1.ListCommittedAppReleasesRequest{})
	if err != nil || len(releases.GetReleases()) != 0 || releases.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("committed releases = %+v err=%v", releases, err)
	}
	jobs, err := service.ListAppPackageJobs(ctx, &runtimev1.ListAppPackageJobsRequest{})
	if err != nil || len(jobs.GetJobs()) != 1 || string(jobs.GetJobs()[0].GetJobId()) != job.JobID ||
		jobs.GetJobs()[0].GetSourceClass() != runtimev1.AppPackageSourceClass_APP_PACKAGE_SOURCE_CLASS_VERIFIED {
		t.Fatalf("package jobs = %+v err=%v", jobs, err)
	}
	loaded, err := service.GetAppPackageJob(ctx, &runtimev1.GetAppPackageJobRequest{JobId: []byte(job.JobID)})
	if err != nil || loaded.GetJob().GetPhase() != runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_QUEUED {
		t.Fatalf("loaded package job = %+v err=%v", loaded, err)
	}

	_, err = service.CancelAppPackageJob(ctx, &runtimev1.CancelAppPackageJobRequest{
		JobId: []byte(job.JobID), ExpectedPhase: runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_VERIFYING,
		ReasonCode: "user-canceled",
	})
	reason, _ := grpcerr.ExtractReasonCode(err)
	if status.Code(err) != codes.Aborted || reason != runtimev1.ReasonCode_APP_PACKAGE_JOB_PHASE_CONFLICT {
		t.Fatalf("stale cancel = code=%s reason=%s err=%v", status.Code(err), reason, err)
	}
	canceled, err := service.CancelAppPackageJob(ctx, &runtimev1.CancelAppPackageJobRequest{
		JobId: []byte(job.JobID), ExpectedPhase: runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_QUEUED,
		ReasonCode: "user-canceled",
	})
	if err != nil || canceled.GetJob().GetPhase() != runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_CANCELED ||
		canceled.GetJob().GetTerminalResult() != runtimev1.AppPackageTerminalResult_APP_PACKAGE_TERMINAL_RESULT_CANCELED {
		t.Fatalf("canceled package job = %+v err=%v", canceled, err)
	}
}
