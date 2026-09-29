package nimiappinstall

import (
	"context"
	"errors"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const packageAuditDomain = "runtime.app_package"

// packageResultEvent contains no source paths or credentials.
func packageResultEvent(job localappkernel.PackageJob, failure error) *runtimev1.AuditEventRecord {
	fields := map[string]any{
		"job_id":         job.JobID,
		"kind":           string(job.Kind),
		"source_class":   string(job.SourceClass),
		"target_version": job.TargetVersion,
	}
	reason := runtimev1.ReasonCode_ACTION_EXECUTED
	if failure != nil {
		reason = packageFailureReason(job, failure)
		if job.Kind == localappkernel.PackageJobUninstall {
			fields["failure_reason"] = "uninstall-failed"
		} else {
			fields["failure_reason"] = installFailureReason(failure)
		}
	}
	payload, err := structpb.NewStruct(fields)
	if err != nil {
		payload = nil
	}
	event := &runtimev1.AuditEventRecord{
		AppId:      job.AppID,
		Domain:     packageAuditDomain,
		Operation:  "app_package." + string(job.Kind),
		ReasonCode: reason,
		Timestamp:  timestamppb.New(time.Now().UTC()),
		Payload:    payload,
		CallerKind: runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		SurfaceId:  "runtime.app_package",
	}
	return event
}

// @nimi-authority: rule.nimi.runtime.rpc-foundations.r001
func (coordinator *Coordinator) commitRecordedPackage(job localappkernel.PackageJob, commit func() error) (bool, error) {
	if coordinator.audit == nil {
		return false, auditlog.ErrUnrecorded
	}
	return coordinator.audit.CommitRecorded(packageResultEvent(job, nil), commit)
}

func (coordinator *Coordinator) reportUnrecordedPackage(job localappkernel.PackageJob, err error) localappkernel.PackageJob {
	if err == nil {
		return job
	}
	job.ReasonCode = "AUDIT_RESULT_UNRECORDED"
	if recorded, writeErr := coordinator.lifecycle.RecordCommittedAuditFailure(context.Background(), job.JobID); writeErr == nil {
		job = recorded
	} else if coordinator.logger != nil {
		coordinator.logger.Error("App package audit diagnostic could not persist", "job_id", job.JobID, "error", writeErr)
	}
	if coordinator.logger != nil {
		coordinator.logger.Error("App package result was not recorded", "job_id", job.JobID, "audit_disposition", "unrecorded", "error", err)
	}
	return job
}

func (coordinator *Coordinator) recordPackageResult(job localappkernel.PackageJob, failure error) localappkernel.PackageJob {
	if coordinator == nil {
		return job
	}
	event := packageResultEvent(job, failure)
	var writeErr error
	if coordinator.audit == nil {
		writeErr = errors.New("runtime audit store is unavailable")
	} else {
		writeErr = coordinator.audit.AppendEventChecked(event)
	}
	if writeErr != nil && failure == nil {
		job = coordinator.reportUnrecordedPackage(job, writeErr)
	}
	if writeErr != nil && coordinator.logger != nil {
		coordinator.logger.Error("App package result was not recorded",
			"job_id", job.JobID, "app_id", job.AppID, "kind", job.Kind,
			"audit_disposition", "unrecorded", "error", writeErr)
	}
	return job
}

func packageFailureReason(job localappkernel.PackageJob, failure error) runtimev1.ReasonCode {
	switch {
	case job.Kind == localappkernel.PackageJobUninstall:
		return runtimev1.ReasonCode_APP_PACKAGE_UNINSTALL_FAILED
	case errors.Is(failure, publicappregistry.ErrPolicyBlocked):
		return runtimev1.ReasonCode_APP_PACKAGE_POLICY_BLOCKED
	case errors.Is(failure, publicappregistry.ErrStaleSelection), errors.Is(failure, ErrInstallTarget):
		return runtimev1.ReasonCode_APP_PACKAGE_SELECTION_STALE
	default:
		return runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE
	}
}
