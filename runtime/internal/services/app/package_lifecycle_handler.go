package app

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappinstall"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type ApprovedAppCatalogProvider interface {
	ListCurrentPlatformTargets(context.Context) ([]publicappregistry.ResolvedApprovedTarget, error)
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-013a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-018a
func (s *Service) ListApprovedAppCatalogTargets(
	ctx context.Context,
	req *runtimev1.ListApprovedAppCatalogTargetsRequest,
) (*runtimev1.ListApprovedAppCatalogTargetsResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s == nil || s.approvedAppCatalog == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_CATALOG_UNAVAILABLE)
	}
	targets, err := s.approvedAppCatalog.ListCurrentPlatformTargets(ctx)
	if err != nil {
		return nil, approvedAppCatalogError(err)
	}
	projected := make([]*runtimev1.ApprovedAppCatalogTarget, 0, len(targets))
	for _, target := range targets {
		value, projectErr := approvedAppCatalogTargetProjection(target)
		if projectErr != nil {
			return nil, approvedAppCatalogError(projectErr)
		}
		projected = append(projected, value)
	}
	return &runtimev1.ListApprovedAppCatalogTargetsResponse{
		Targets: projected, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

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

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040a
func (s *Service) StartAppPackageInstall(
	ctx context.Context,
	req *runtimev1.StartAppPackageInstallRequest,
) (*runtimev1.StartAppPackageInstallResponse, error) {
	if req == nil || len(req.GetApprovedTargetSelector()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	selector, err := publicappregistry.ParseApprovedTargetSelector(string(req.GetApprovedTargetSelector()))
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_INVALID, err, grpcerr.ReasonOptions{})
	}
	if s == nil || s.appInstallCoordinator == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE)
	}
	job, err := s.appInstallCoordinator.StartInstall(ctx, selector)
	if err != nil {
		return nil, appPackageInstallStartError(err)
	}
	projected, err := appPackageJobProjection(job)
	if err != nil {
		return nil, err
	}
	return &runtimev1.StartAppPackageInstallResponse{
		Job: projected, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
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
	if s == nil || s.appInstallCoordinator == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE)
	}
	store, err := s.packageLifecycleStore()
	if err != nil {
		return nil, err
	}
	job, err := store.GetJob(ctx, string(req.GetJobId()))
	if err == nil && job.Kind == localappkernel.PackageJobUninstall {
		job, err = s.appInstallCoordinator.CancelUninstall(ctx, job.JobID, expected, req.GetReasonCode())
		if err == nil {
			if owner, ok := protectedlocal.DesktopConnectionFromContext(ctx); ok {
				owner.UnbindRevocationHook(uninstallJobHook(job.JobID))
			}
		}
	} else if err == nil {
		job, err = s.appInstallCoordinator.CancelInstall(ctx, job.JobID, expected, req.GetReasonCode())
	}
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

func appPackageInstallStartError(err error) error {
	var blocked *publicappregistry.PolicyBlockedError
	switch {
	case errors.Is(err, context.Canceled):
		return status.Error(codes.Canceled, "public App install start canceled")
	case errors.Is(err, context.DeadlineExceeded):
		return status.Error(codes.DeadlineExceeded, "public App install start deadline exceeded")
	case errors.Is(err, publicappregistry.ErrInvalidSelector), errors.Is(err, nimiappinstall.ErrInstallTarget):
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_INVALID, err, grpcerr.ReasonOptions{})
	case errors.Is(err, publicappregistry.ErrStaleSelection):
		return grpcerr.WrapWithReasonCode(codes.Aborted, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_STALE, err, grpcerr.ReasonOptions{})
	case errors.As(err, &blocked):
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_POLICY_BLOCKED, err, grpcerr.ReasonOptions{Metadata: map[string]string{
			"policy_reason": blocked.Reason, "policy_revision": strconv.FormatUint(blocked.Revision, 10),
		}})
	case errors.Is(err, nimiappinstall.ErrAppAlreadyInstalled):
		return grpcerr.WrapWithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_APP_PACKAGE_ALREADY_INSTALLED, err, grpcerr.ReasonOptions{})
	case errors.Is(err, localappkernel.ErrPackageJobActive):
		return grpcerr.WrapWithReasonCode(codes.Aborted, runtimev1.ReasonCode_APP_PACKAGE_JOB_ACTIVE, err, grpcerr.ReasonOptions{})
	case errors.Is(err, nimiappinstall.ErrInvalidCoordinator), errors.Is(err, nimiappinstall.ErrUnsupportedInstallPlatform):
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE, err, grpcerr.ReasonOptions{})
	case errors.Is(err, publicappregistry.ErrRegistryUnavailable), errors.Is(err, publicappregistry.ErrInvalidRegistrySnapshot),
		errors.Is(err, nimiappinstall.ErrInstallPersistenceUnavailable):
		return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE, err, grpcerr.ReasonOptions{})
	default:
		return fmt.Errorf("start public App package install: %w", err)
	}
}

func approvedAppCatalogError(err error) error {
	switch {
	case errors.Is(err, context.Canceled):
		return status.Error(codes.Canceled, "public App Catalog read canceled")
	case errors.Is(err, context.DeadlineExceeded):
		return status.Error(codes.DeadlineExceeded, "public App Catalog read deadline exceeded")
	case errors.Is(err, publicappregistry.ErrCatalogTargetNotFound):
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_CATALOG_UNAVAILABLE, err, grpcerr.ReasonOptions{})
	case errors.Is(err, publicappregistry.ErrRegistryUnavailable), errors.Is(err, publicappregistry.ErrInvalidRegistrySnapshot):
		return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_APP_CATALOG_UNAVAILABLE, err, grpcerr.ReasonOptions{})
	default:
		return fmt.Errorf("list approved public App Catalog targets: %w", err)
	}
}

func (s *Service) packageLifecycleStore() (*localappkernel.PackageLifecycleStore, error) {
	if s == nil || s.localAppKernel == nil || s.localAppKernel.PackageLifecycle() == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	return s.localAppKernel.PackageLifecycle(), nil
}

func appPackageLifecycleError(operation string, err error) error {
	switch {
	case errors.Is(err, context.Canceled):
		return status.Error(codes.Canceled, operation+" canceled")
	case errors.Is(err, context.DeadlineExceeded):
		return status.Error(codes.DeadlineExceeded, operation+" deadline exceeded")
	case errors.Is(err, nimiappinstall.ErrInvalidCoordinator):
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE, err, grpcerr.ReasonOptions{})
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

func approvedAppCatalogTargetProjection(target publicappregistry.ResolvedApprovedTarget) (*runtimev1.ApprovedAppCatalogTarget, error) {
	selector, err := target.Selector.Encode()
	if err != nil || target.DescriptorID != target.Selector.DescriptorID() ||
		target.Target.TargetID != target.Selector.TargetID() ||
		target.RegistryRevision != target.Selector.ObservedRegistryCommit() {
		return nil, fmt.Errorf("project approved App Catalog target: inconsistent selector: %w", publicappregistry.ErrInvalidRegistrySnapshot)
	}
	storage := make([]*runtimev1.ApprovedAppCatalogStorageDisclosure, 0, len(target.StoragePolicy.OSStorageDisclosure))
	for _, disclosure := range target.StoragePolicy.OSStorageDisclosure {
		storage = append(storage, &runtimev1.ApprovedAppCatalogStorageDisclosure{
			PathPattern: disclosure.PathPattern,
			Purpose:     disclosure.Purpose,
			Retention:   disclosure.Retention,
			Removal:     disclosure.Removal,
		})
	}
	return &runtimev1.ApprovedAppCatalogTarget{
		ApprovedTargetSelector:          []byte(selector),
		ObservedRegistryRevision:        target.RegistryRevision,
		DescriptorId:                    target.DescriptorID,
		AppId:                           target.AppID,
		DisplayName:                     target.DisplayName,
		Version:                         target.Version,
		PublisherGithubNamespace:        target.Publisher.GitHubNamespace,
		SourceRepository:                target.Source.Repository,
		SourceLicenseSpdxExpression:     target.Source.License.SPDXExpression,
		AppAccess:                       append([]string(nil), target.AppAccess...),
		CapabilityContractRefs:          append([]string(nil), target.CapabilityContractRefs...),
		RequiredStandardizedFeatureRefs: append([]string(nil), target.RequiredStandardizedFeatureRefs...),
		StoragePolicyKind:               target.StoragePolicy.Kind,
		OsStorageDisclosures:            storage,
		TargetId:                        target.Target.TargetID,
		Os:                              target.Target.OS,
		Arch:                            target.Target.Arch,
		AssetName:                       target.Target.AssetName,
		AssetSize:                       target.Target.Size,
		ExecutionProfileRef:             target.Target.ExecutionProfileRef,
		WindowsCodeSigning:              target.Target.NativeTrust.WindowsCodeSigning,
		ObservedSigningSubject:          cloneStringPointer(target.Target.NativeTrust.ObservedSubject),
		PolicyBlocked:                   target.KillSwitch.Active,
		PolicyReason:                    cloneStringPointer(target.KillSwitch.Reason),
		PolicyRevision:                  target.KillSwitch.Revision,
	}, nil
}

func cloneStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
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
