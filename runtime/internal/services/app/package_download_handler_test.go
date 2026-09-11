package app

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappinstall"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestAppPackageDownloadControlsRejectMissingInputAndOwner(t *testing.T) {
	service := New(nil)
	ctx := context.Background()
	tests := []struct {
		name string
		call func(bool) error
	}{
		{"pause", func(valid bool) error {
			request := &runtimev1.PauseAppPackageJobRequest{}
			if valid {
				request.JobId = []byte("apj_v1_example")
			}
			_, err := service.PauseAppPackageJob(ctx, request)
			return err
		}},
		{"resume", func(valid bool) error {
			request := &runtimev1.ResumeAppPackageJobRequest{}
			if valid {
				request.JobId = []byte("apj_v1_example")
			}
			_, err := service.ResumeAppPackageJob(ctx, request)
			return err
		}},
		{"reorder", func(valid bool) error {
			request := &runtimev1.ReorderAppPackageJobRequest{}
			if valid {
				request.JobId = []byte("apj_v1_example")
			}
			_, err := service.ReorderAppPackageJob(ctx, request)
			return err
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			invalid := test.call(false)
			reason, _ := grpcerr.ExtractReasonCode(invalid)
			if status.Code(invalid) != codes.InvalidArgument || reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
				t.Fatalf("missing job code=%s reason=%s err=%v", status.Code(invalid), reason, invalid)
			}
			unavailable := test.call(true)
			reason, _ = grpcerr.ExtractReasonCode(unavailable)
			if status.Code(unavailable) != codes.FailedPrecondition || reason != runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE {
				t.Fatalf("missing owner code=%s reason=%s err=%v", status.Code(unavailable), reason, unavailable)
			}
		})
	}
}

func TestAppPackageDownloadControlErrorsKeepOwnerReasons(t *testing.T) {
	policyReason := "release-paused"
	tests := []struct {
		name   string
		cause  error
		code   codes.Code
		reason runtimev1.ReasonCode
	}{
		{"phase", localappkernel.ErrPackageJobPhase, codes.Aborted, runtimev1.ReasonCode_APP_PACKAGE_JOB_PHASE_CONFLICT},
		{"missing", localappkernel.ErrPackageJobNotFound, codes.NotFound, runtimev1.ReasonCode_APP_PACKAGE_JOB_NOT_FOUND},
		{"terminal", localappkernel.ErrPackageJobTerminal, codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_JOB_NOT_CANCELABLE},
		{"quiescing", nimiappinstall.ErrInstallQuiescing, codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE},
		{"update unavailable", nimiappinstall.ErrUpdateUnavailable, codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_UPDATE_UNAVAILABLE},
		{"host running", nimiappinstall.ErrUpdateHostRunning, codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_HOST_RUNNING},
		{"stale", publicappregistry.ErrStaleSelection, codes.Aborted, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_STALE},
		{"policy", &publicappregistry.PolicyBlockedError{Reason: policyReason, Revision: 3}, codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_POLICY_BLOCKED},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := appPackageLifecycleError("resume App package job", test.cause)
			reason, _ := grpcerr.ExtractReasonCode(err)
			if status.Code(err) != test.code || reason != test.reason {
				t.Fatalf("code=%s reason=%s err=%v", status.Code(err), reason, err)
			}
		})
	}
}

func TestAppPackageJobProjectionPreservesPausedBytesAndSelectedTarget(t *testing.T) {
	now := time.Date(2026, 9, 10, 0, 0, 1, 0, time.UTC)
	observed := now.Add(-time.Second)
	total := uint64(1024)
	job := localappkernel.PackageJob{
		JobID: "apj_v1_example", AppID: "publisher.example", SourceClass: localappkernel.SourceClassVerified,
		Kind: localappkernel.PackageJobUpdate, TargetRef: "opaque-selected-target",
		Phase: localappkernel.PackageJobPaused, ProgressBasis: localappkernel.PackageProgressBytes,
		BytesCompleted: 512, BytesTotal: &total, StartedAt: observed, UpdatedAt: now,
		ProgressObservedAt: &observed, ReasonCode: "user-paused", Cancelable: true,
		DisplayName: "Example", TargetVersion: "2.0.0", PreviousVersion: "1.0.0",
		TargetOS: "windows", TargetArch: "x86_64",
	}
	projection, err := appPackageJobProjection(job)
	if err != nil {
		t.Fatal(err)
	}
	phase, ok := packageJobPhaseFromProto(projection.GetPhase())
	if !ok || phase != localappkernel.PackageJobPaused || projection.GetBytesCompleted() != 512 || projection.GetBytesTotal() != 1024 ||
		projection.GetReasonCode() != "user-paused" || projection.GetQueuePosition() != 0 || projection.GetSpeedBytesPerSec() != 0 || projection.GetEtaSeconds() != 0 ||
		!projection.GetUpdatedAt().AsTime().Equal(now) || !projection.GetProgressObservedAt().AsTime().Equal(observed) {
		t.Fatalf("paused projection=%+v", projection)
	}
	if projection.GetTargetRef() != job.TargetRef || projection.GetDisplayName() != "Example" || projection.GetTargetVersion() != "2.0.0" ||
		projection.GetPreviousVersion() != "1.0.0" || projection.GetTargetOs() != "windows" || projection.GetTargetArch() != "x86_64" || projection.CompletedAt != nil {
		t.Fatalf("selected target projection=%+v", projection)
	}
	job.Phase = localappkernel.PackageJobQueued
	job.QueuePosition = 3
	job.ReasonCode = ""
	projection, err = appPackageJobProjection(job)
	if err != nil || projection.GetQueuePosition() != 3 {
		t.Fatalf("queue projection=%+v err=%v", projection, err)
	}
}
