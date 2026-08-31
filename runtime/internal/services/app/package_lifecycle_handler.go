package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040b
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
func (s *Service) ListCommittedAppReleases(
	ctx context.Context,
	req *runtimev1.ListCommittedAppReleasesRequest,
) (*runtimev1.ListCommittedAppReleasesResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	store, err := s.packageLifecycleStore()
	if err != nil {
		return nil, err
	}
	releases, err := store.ListCommittedReleases(ctx)
	if err != nil {
		return nil, fmt.Errorf("list committed App releases: %w", err)
	}
	projected := make([]*runtimev1.CommittedAppRelease, 0, len(releases))
	for _, release := range releases {
		value, projectErr := committedAppReleaseProjection(release)
		if projectErr != nil {
			return nil, projectErr
		}
		projected = append(projected, value)
	}
	return &runtimev1.ListCommittedAppReleasesResponse{
		Releases:   projected,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) ListAppPackageJobs(
	ctx context.Context,
	req *runtimev1.ListAppPackageJobsRequest,
) (*runtimev1.ListAppPackageJobsResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	store, err := s.packageLifecycleStore()
	if err != nil {
		return nil, err
	}
	jobs, err := store.ListJobs(ctx)
	if err != nil {
		return nil, fmt.Errorf("list App package jobs: %w", err)
	}
	projected := make([]*runtimev1.AppPackageJob, 0, len(jobs))
	for _, job := range jobs {
		value, projectErr := appPackageJobProjection(job)
		if projectErr != nil {
			return nil, projectErr
		}
		projected = append(projected, value)
	}
	return &runtimev1.ListAppPackageJobsResponse{
		Jobs:       projected,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) GetAppPackageJob(
	ctx context.Context,
	req *runtimev1.GetAppPackageJobRequest,
) (*runtimev1.GetAppPackageJobResponse, error) {
	if req == nil || len(req.GetJobId()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	store, err := s.packageLifecycleStore()
	if err != nil {
		return nil, err
	}
	job, err := store.GetJob(ctx, string(req.GetJobId()))
	if err != nil {
		return nil, appPackageLifecycleError("get App package job", err)
	}
	projected, err := appPackageJobProjection(job)
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetAppPackageJobResponse{
		Job:        projected,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) CancelAppPackageJob(
	ctx context.Context,
	req *runtimev1.CancelAppPackageJobRequest,
) (*runtimev1.CancelAppPackageJobResponse, error) {
	if req == nil || len(req.GetJobId()) == 0 || strings.TrimSpace(req.GetReasonCode()) == "" || strings.TrimSpace(req.GetReasonCode()) != req.GetReasonCode() {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	expected, ok := packageJobPhaseFromProto(req.GetExpectedPhase())
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	store, err := s.packageLifecycleStore()
	if err != nil {
		return nil, err
	}
	job, err := store.Cancel(ctx, string(req.GetJobId()), expected, req.GetReasonCode())
	if err != nil {
		return nil, appPackageLifecycleError("cancel App package job", err)
	}
	projected, err := appPackageJobProjection(job)
	if err != nil {
		return nil, err
	}
	return &runtimev1.CancelAppPackageJobResponse{
		Job:        projected,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) packageLifecycleStore() (*localappkernel.PackageLifecycleStore, error) {
	if s == nil || s.localAppKernel == nil || s.localAppKernel.PackageLifecycle() == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	return s.localAppKernel.PackageLifecycle(), nil
}

func appPackageLifecycleError(operation string, err error) error {
	switch {
	case errors.Is(err, localappkernel.ErrInvalidArgument):
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, err, grpcerr.ReasonOptions{})
	case errors.Is(err, localappkernel.ErrPackageJobNotFound):
		return grpcerr.WrapWithReasonCode(codes.NotFound, runtimev1.ReasonCode_APP_PACKAGE_JOB_NOT_FOUND, err, grpcerr.ReasonOptions{})
	case errors.Is(err, localappkernel.ErrPackageJobPhase):
		return grpcerr.WrapWithReasonCode(codes.Aborted, runtimev1.ReasonCode_APP_PACKAGE_JOB_PHASE_CONFLICT, err, grpcerr.ReasonOptions{})
	case errors.Is(err, localappkernel.ErrPackageJobNotCancelable), errors.Is(err, localappkernel.ErrPackageJobTerminal):
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_JOB_NOT_CANCELABLE, err, grpcerr.ReasonOptions{})
	default:
		return fmt.Errorf("%s: %w", operation, err)
	}
}

func committedAppReleaseProjection(release localappkernel.CommittedRelease) (*runtimev1.CommittedAppRelease, error) {
	sourceClass, ok := packageSourceClassToProto(release.SourceClass)
	if !ok {
		return nil, fmt.Errorf("project committed App release: unsupported source class %q", release.SourceClass)
	}
	return &runtimev1.CommittedAppRelease{
		AppId:          release.AppID,
		SourceClass:    sourceClass,
		Version:        release.Version,
		ReleaseRef:     release.ReleaseRef,
		LaunchSelector: []byte(release.RegistrationHandle),
		CommittedAt:    timestamppb.New(release.CommittedAt),
	}, nil
}

func appPackageJobProjection(job localappkernel.PackageJob) (*runtimev1.AppPackageJob, error) {
	sourceClass, sourceOK := packageSourceClassToProto(job.SourceClass)
	kind, kindOK := packageJobKindToProto(job.Kind)
	phase, phaseOK := packageJobPhaseToProto(job.Phase)
	basis, basisOK := packageProgressBasisToProto(job.ProgressBasis)
	terminal, terminalOK := packageTerminalResultToProto(job.TerminalResult)
	if !sourceOK || !kindOK || !phaseOK || !basisOK || !terminalOK {
		return nil, fmt.Errorf("project App package job: unsupported stored enum")
	}
	projection := &runtimev1.AppPackageJob{
		JobId:          []byte(job.JobID),
		AppId:          job.AppID,
		SourceClass:    sourceClass,
		Kind:           kind,
		TargetRef:      job.TargetRef,
		Phase:          phase,
		ProgressBasis:  basis,
		BytesCompleted: job.BytesCompleted,
		BytesTotal:     cloneUint64(job.BytesTotal),
		StepsCompleted: job.StepsCompleted,
		StepsTotal:     cloneUint64(job.StepsTotal),
		StartedAt:      timestamppb.New(job.StartedAt),
		TerminalResult: terminal,
		ReasonCode:     job.ReasonCode,
		Cancelable:     job.Cancelable,
	}
	if job.CompletedAt != nil {
		projection.CompletedAt = timestamppb.New(*job.CompletedAt)
	}
	return projection, nil
}

func packageSourceClassToProto(value localappkernel.SourceClass) (runtimev1.AppPackageSourceClass, bool) {
	switch value {
	case localappkernel.SourceClassVerified:
		return runtimev1.AppPackageSourceClass_APP_PACKAGE_SOURCE_CLASS_VERIFIED, true
	case localappkernel.SourceClassUserImported:
		return runtimev1.AppPackageSourceClass_APP_PACKAGE_SOURCE_CLASS_USER_IMPORTED, true
	default:
		return runtimev1.AppPackageSourceClass_APP_PACKAGE_SOURCE_CLASS_UNSPECIFIED, false
	}
}

func packageJobKindToProto(value localappkernel.PackageJobKind) (runtimev1.AppPackageJobKind, bool) {
	switch value {
	case localappkernel.PackageJobInstall:
		return runtimev1.AppPackageJobKind_APP_PACKAGE_JOB_KIND_INSTALL, true
	case localappkernel.PackageJobUpdate:
		return runtimev1.AppPackageJobKind_APP_PACKAGE_JOB_KIND_UPDATE, true
	case localappkernel.PackageJobRepair:
		return runtimev1.AppPackageJobKind_APP_PACKAGE_JOB_KIND_REPAIR, true
	case localappkernel.PackageJobUninstall:
		return runtimev1.AppPackageJobKind_APP_PACKAGE_JOB_KIND_UNINSTALL, true
	default:
		return runtimev1.AppPackageJobKind_APP_PACKAGE_JOB_KIND_UNSPECIFIED, false
	}
}

func packageJobPhaseToProto(value localappkernel.PackageJobPhase) (runtimev1.AppPackageJobPhase, bool) {
	values := map[localappkernel.PackageJobPhase]runtimev1.AppPackageJobPhase{
		localappkernel.PackageJobQueued:             runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_QUEUED,
		localappkernel.PackageJobDownloading:        runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_DOWNLOADING,
		localappkernel.PackageJobReadingLocal:       runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_READING_LOCAL,
		localappkernel.PackageJobVerifying:          runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_VERIFYING,
		localappkernel.PackageJobVerifyingInstalled: runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_VERIFYING_INSTALLED,
		localappkernel.PackageJobAcquiringMissing:   runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_ACQUIRING_MISSING,
		localappkernel.PackageJobStaging:            runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_STAGING,
		localappkernel.PackageJobCommitting:         runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_COMMITTING,
		localappkernel.PackageJobRemovingPackage:    runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_REMOVING_PACKAGE,
		localappkernel.PackageJobUnregistering:      runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_UNREGISTERING,
		localappkernel.PackageJobCompleted:          runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_COMPLETED,
		localappkernel.PackageJobFailed:             runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_FAILED,
		localappkernel.PackageJobCanceled:           runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_CANCELED,
	}
	result, ok := values[value]
	return result, ok
}

func packageJobPhaseFromProto(value runtimev1.AppPackageJobPhase) (localappkernel.PackageJobPhase, bool) {
	values := map[runtimev1.AppPackageJobPhase]localappkernel.PackageJobPhase{
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_QUEUED:              localappkernel.PackageJobQueued,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_DOWNLOADING:         localappkernel.PackageJobDownloading,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_READING_LOCAL:       localappkernel.PackageJobReadingLocal,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_VERIFYING:           localappkernel.PackageJobVerifying,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_VERIFYING_INSTALLED: localappkernel.PackageJobVerifyingInstalled,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_ACQUIRING_MISSING:   localappkernel.PackageJobAcquiringMissing,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_STAGING:             localappkernel.PackageJobStaging,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_COMMITTING:          localappkernel.PackageJobCommitting,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_REMOVING_PACKAGE:    localappkernel.PackageJobRemovingPackage,
		runtimev1.AppPackageJobPhase_APP_PACKAGE_JOB_PHASE_UNREGISTERING:       localappkernel.PackageJobUnregistering,
	}
	result, ok := values[value]
	return result, ok
}

func packageProgressBasisToProto(value localappkernel.PackageProgressBasis) (runtimev1.AppPackageProgressBasis, bool) {
	switch value {
	case localappkernel.PackageProgressBytes:
		return runtimev1.AppPackageProgressBasis_APP_PACKAGE_PROGRESS_BASIS_BYTES, true
	case localappkernel.PackageProgressSteps:
		return runtimev1.AppPackageProgressBasis_APP_PACKAGE_PROGRESS_BASIS_STEPS, true
	case localappkernel.PackageProgressIndeterminate:
		return runtimev1.AppPackageProgressBasis_APP_PACKAGE_PROGRESS_BASIS_INDETERMINATE, true
	default:
		return runtimev1.AppPackageProgressBasis_APP_PACKAGE_PROGRESS_BASIS_UNSPECIFIED, false
	}
}

func packageTerminalResultToProto(value string) (runtimev1.AppPackageTerminalResult, bool) {
	switch value {
	case "":
		return runtimev1.AppPackageTerminalResult_APP_PACKAGE_TERMINAL_RESULT_UNSPECIFIED, true
	case "completed":
		return runtimev1.AppPackageTerminalResult_APP_PACKAGE_TERMINAL_RESULT_COMPLETED, true
	case "failed":
		return runtimev1.AppPackageTerminalResult_APP_PACKAGE_TERMINAL_RESULT_FAILED, true
	case "canceled":
		return runtimev1.AppPackageTerminalResult_APP_PACKAGE_TERMINAL_RESULT_CANCELED, true
	default:
		return runtimev1.AppPackageTerminalResult_APP_PACKAGE_TERMINAL_RESULT_UNSPECIFIED, false
	}
}

func cloneUint64(value *uint64) *uint64 {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
