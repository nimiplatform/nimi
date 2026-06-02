package app

import (
	"context"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// UpdateApp resolves the admitted Nimi App registry row and its currently
// bound release descriptor, then drives the Runtime-owned atomic update
// pipeline. It returns the typed update job projection (kind=UPDATE).
//
// The update is atomic (K-APP-015 / P-NAPP-014): the new release is downloaded,
// sha256-verified, and materialized under
// <nimi_data>/apps/<app-id>/releases/<new-version> BEFORE the active release
// pointer is swapped. The swap is a single atomic rename. A failed update never
// corrupts the existing installed release — the old release stays usable until
// the swap commits — and the durable data root is never touched.
func (s *Service) UpdateApp(ctx context.Context, req *runtimev1.UpdateAppRequest) (*runtimev1.UpdateAppResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	appID := strings.TrimSpace(req.GetAppId())
	if appID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := s.requireAppLifecycleSession(ctx, appID); err != nil {
		return nil, err
	}
	if s.installRuntime == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_INSTALL_INTERNAL)
	}

	_, descriptor, err := s.installRuntime.resolveDescriptor(appID)
	if err != nil {
		return nil, installResolveError(err)
	}
	accountID, accountErr := s.resolveAuthenticatedAccountIDForAppLifecycle(ctx)
	if accountErr != nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	plan, planErr := s.installRuntime.plan(descriptor)
	if planErr != nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION)
	}

	// The app must already be installed: an active release pointer must exist.
	active, activeErr := s.installRuntime.activeRelease(plan)
	if activeErr != nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_UPDATE_NOT_INSTALLED)
	}
	if strings.TrimSpace(active.ActiveVersion) == strings.TrimSpace(descriptor.Version) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_UPDATE_NOT_AVAILABLE)
	}
	// Required (breaking) updates block until the user confirms the impact
	// preview. Non-breaking updates do not require confirmation.
	if isBreakingUpdate(active.ActiveVersion, descriptor.Version) && !req.GetConfirmed() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_UPDATE_CONFIRMATION_REQUIRED)
	}

	if existing := s.installJobs.activeJobForApp(appID); existing != nil {
		return &runtimev1.UpdateAppResponse{Job: existing}, nil
	}

	job := s.installJobs.createJob(jobSpec{
		appID:           appID,
		descriptorRef:   descriptor.DescriptorID,
		version:         descriptor.Version,
		previousVersion: active.ActiveVersion,
		kind:            runtimev1.AppLifecycleJobKind_APP_LIFECYCLE_JOB_KIND_UPDATE,
		sourceKind:      installSourceKind(descriptor),
		storage:         storageProjectionFromPlan(plan),
	})
	go s.runLifecycleJob(job.GetJobId(), descriptor, runtimev1.AppLifecycleJobKind_APP_LIFECYCLE_JOB_KIND_UPDATE, accountID)
	return &runtimev1.UpdateAppResponse{Job: job}, nil
}

// HealthRepairApp drives the four admitted health/repair actions (S-APP-002 /
// K-APP-016): cancel, retry, repair, reinstall. Each action returns a typed
// lifecycle job projection. A failed repair op is never projected as success.
func (s *Service) HealthRepairApp(ctx context.Context, req *runtimev1.HealthRepairAppRequest) (*runtimev1.HealthRepairAppResponse, error) {
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	appID := strings.TrimSpace(req.GetAppId())
	if appID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := s.requireAppLifecycleSession(ctx, appID); err != nil {
		return nil, err
	}
	if s.installRuntime == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_INSTALL_INTERNAL)
	}

	switch req.GetAction() {
	case runtimev1.AppHealthRepairAction_APP_HEALTH_REPAIR_ACTION_CANCEL:
		return s.healthRepairCancel(appID, strings.TrimSpace(req.GetJobId()))
	case runtimev1.AppHealthRepairAction_APP_HEALTH_REPAIR_ACTION_RETRY:
		return s.healthRepairRetry(ctx, appID, strings.TrimSpace(req.GetJobId()))
	case runtimev1.AppHealthRepairAction_APP_HEALTH_REPAIR_ACTION_REPAIR:
		return s.healthRepairRematerialize(ctx, appID, runtimev1.AppLifecycleJobKind_APP_LIFECYCLE_JOB_KIND_REPAIR, true)
	case runtimev1.AppHealthRepairAction_APP_HEALTH_REPAIR_ACTION_REINSTALL:
		return s.healthRepairRematerialize(ctx, appID, runtimev1.AppLifecycleJobKind_APP_LIFECYCLE_JOB_KIND_REPAIR, false)
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_REPAIR_ACTION_INVALID)
	}
}

// healthRepairCancel cancels an in-flight lifecycle job. The cancelled job is
// recoverable via retry and is never projected as success.
func (s *Service) healthRepairCancel(appID string, jobID string) (*runtimev1.HealthRepairAppResponse, error) {
	target := jobID
	if target == "" {
		recoverable := s.installJobs.recentRecoverableJobForApp(appID)
		if recoverable == nil {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_REPAIR_NO_RECOVERABLE_JOB)
		}
		target = recoverable.GetJobId()
	}
	job, ok := s.installJobs.getJob(target)
	if !ok || job.GetAppId() != appID {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_REPAIR_NO_RECOVERABLE_JOB)
	}
	if !s.installJobs.jobInFlight(target) {
		// Already terminal: nothing to cancel. A terminal job is not a
		// recoverable cancel target.
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_REPAIR_NO_RECOVERABLE_JOB)
	}
	s.installJobs.cancelJob(target)
	cancelled := s.installJobs.markCancelled(target)
	if s.logger != nil {
		s.logger.Info("app lifecycle job cancel requested", "job_id", target, "app_id", appID)
	}
	return &runtimev1.HealthRepairAppResponse{Job: orJob(cancelled, job)}, nil
}

// healthRepairRetry re-dispatches a failed or cancelled lifecycle job as a new
// job of the same kind.
func (s *Service) healthRepairRetry(ctx context.Context, appID string, jobID string) (*runtimev1.HealthRepairAppResponse, error) {
	prior := jobID
	var priorJob *runtimev1.AppInstallJob
	if prior == "" {
		priorJob = s.installJobs.recentRecoverableJobForApp(appID)
	} else {
		job, ok := s.installJobs.getJob(prior)
		if ok && job.GetAppId() == appID {
			priorJob = job
		}
	}
	if priorJob == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_REPAIR_NO_RECOVERABLE_JOB)
	}
	if !installJobTerminal(priorJob.GetState()) {
		// The job is still running; retry would race it. Return it as-is.
		return &runtimev1.HealthRepairAppResponse{Job: priorJob}, nil
	}
	if priorJob.GetState() == runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_INSTALLED {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_REPAIR_NO_RECOVERABLE_JOB)
	}
	if existing := s.installJobs.activeJobForApp(appID); existing != nil {
		return &runtimev1.HealthRepairAppResponse{Job: existing}, nil
	}

	_, descriptor, err := s.installRuntime.resolveDescriptor(appID)
	if err != nil {
		return nil, installResolveError(err)
	}
	accountID, accountErr := s.resolveAuthenticatedAccountIDForAppLifecycle(ctx)
	if accountErr != nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	plan, planErr := s.installRuntime.plan(descriptor)
	var storage *runtimev1.AppInstallStorageProjection
	if planErr == nil {
		storage = storageProjectionFromPlan(plan)
	}
	kind := priorJob.GetKind()
	if kind == runtimev1.AppLifecycleJobKind_APP_LIFECYCLE_JOB_KIND_UNSPECIFIED {
		kind = runtimev1.AppLifecycleJobKind_APP_LIFECYCLE_JOB_KIND_INSTALL
	}
	job := s.installJobs.createJob(jobSpec{
		appID:           appID,
		descriptorRef:   descriptor.DescriptorID,
		version:         descriptor.Version,
		previousVersion: priorJob.GetPreviousVersion(),
		kind:            kind,
		sourceKind:      installSourceKind(descriptor),
		storage:         storage,
	})
	if planErr != nil {
		failed := s.installJobs.markFailed(job.GetJobId(), runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION, planErr.Error())
		return &runtimev1.HealthRepairAppResponse{Job: orJob(failed, job)}, nil
	}
	go s.runLifecycleJob(job.GetJobId(), descriptor, kind, accountID)
	if s.logger != nil {
		s.logger.Info("app lifecycle job retried", "prior_job_id", priorJob.GetJobId(), "job_id", job.GetJobId(), "app_id", appID, "kind", kind.String())
	}
	return &runtimev1.HealthRepairAppResponse{Job: job}, nil
}

// healthRepairRematerialize drives a repair / reinstall job. Both drop the
// (possibly damaged) release payload and re-materialize it from the bound
// descriptor while preserving durable data. requireInstalled is true for
// repair (which repairs an existing active release) and false for reinstall
// (a clean (re)install that does not require a prior active release).
func (s *Service) healthRepairRematerialize(ctx context.Context, appID string, kind runtimev1.AppLifecycleJobKind, requireInstalled bool) (*runtimev1.HealthRepairAppResponse, error) {
	_, descriptor, err := s.installRuntime.resolveDescriptor(appID)
	if err != nil {
		return nil, installResolveError(err)
	}
	accountID, accountErr := s.resolveAuthenticatedAccountIDForAppLifecycle(ctx)
	if accountErr != nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	plan, planErr := s.installRuntime.plan(descriptor)
	if planErr != nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION)
	}

	previousVersion := ""
	if active, activeErr := s.installRuntime.activeRelease(plan); activeErr == nil {
		previousVersion = active.ActiveVersion
	} else if requireInstalled {
		// repair targets an existing installed release.
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_REPAIR_NOT_REPAIRABLE)
	}

	if existing := s.installJobs.activeJobForApp(appID); existing != nil {
		return &runtimev1.HealthRepairAppResponse{Job: existing}, nil
	}

	job := s.installJobs.createJob(jobSpec{
		appID:           appID,
		descriptorRef:   descriptor.DescriptorID,
		version:         descriptor.Version,
		previousVersion: previousVersion,
		kind:            kind,
		sourceKind:      installSourceKind(descriptor),
		storage:         storageProjectionFromPlan(plan),
	})
	go s.runLifecycleJob(job.GetJobId(), descriptor, kind, accountID)
	if s.logger != nil {
		s.logger.Info("app lifecycle repair job started", "job_id", job.GetJobId(), "app_id", appID, "kind", kind.String())
	}
	return &runtimev1.HealthRepairAppResponse{Job: job}, nil
}

// isBreakingUpdate reports whether moving from one version to another is a
// required (breaking) update. A major-version bump is treated as breaking; a
// minor/patch bump is non-breaking. A version that does not parse as a
// dotted-numeric semver core is treated conservatively as breaking so the
// update requires explicit confirmation.
func isBreakingUpdate(from string, to string) bool {
	fromMajor, fromOK := semverMajor(from)
	toMajor, toOK := semverMajor(to)
	if !fromOK || !toOK {
		return true
	}
	return toMajor != fromMajor
}

func semverMajor(version string) (int, bool) {
	trimmed := strings.TrimPrefix(strings.TrimSpace(version), "v")
	if trimmed == "" {
		return 0, false
	}
	// Strip any pre-release / build metadata after the numeric core.
	if idx := strings.IndexAny(trimmed, "-+"); idx >= 0 {
		trimmed = trimmed[:idx]
	}
	head := trimmed
	if idx := strings.Index(trimmed, "."); idx >= 0 {
		head = trimmed[:idx]
	}
	major, err := strconv.Atoi(head)
	if err != nil || major < 0 {
		return 0, false
	}
	return major, true
}
