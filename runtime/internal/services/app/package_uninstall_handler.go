package app

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040b
func (s *Service) StartAppPackageUninstall(ctx context.Context, req *runtimev1.StartAppPackageUninstallRequest) (*runtimev1.StartAppPackageUninstallResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.appInstallCoordinator == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_UNINSTALL_UNAVAILABLE)
	}
	if req == nil || len(req.GetLaunchSelector()) == 0 || len(req.GetLaunchSelector()) > 160 || !utf8.Valid(req.GetLaunchSelector()) {
		return nil, installedLaunchMismatch()
	}
	handle := string(req.GetLaunchSelector())
	job, err := s.appInstallCoordinator.StartUninstall(ctx, handle)
	if err != nil {
		return nil, uninstallError(err)
	}
	owner, _ := protectedlocal.DesktopConnectionFromContext(ctx)
	hook := uninstallJobHook(job.JobID)
	if err := owner.BindRevocationHook(hook, func() {
		_, _ = s.appInstallCoordinator.CancelUninstall(context.Background(), job.JobID, localappkernel.PackageJobQueued, "desktop-disconnected")
	}); err != nil {
		_, _ = s.appInstallCoordinator.CancelUninstall(context.Background(), job.JobID, localappkernel.PackageJobQueued, "desktop-disconnected")
		return nil, installedLaunchMismatch()
	}
	// Queued reservation already rejects every new prepare/bind. Drop only
	// unredeemed leases; a running process stays Desktop-owned until Stop.
	s.installedLaunchMu.Lock()
	var pending []*installedAppLaunch
	for _, lease := range s.installedLaunches {
		if lease.policy.RegistrationHandle == handle {
			pending = append(pending, lease)
		}
	}
	s.installedLaunchMu.Unlock()
	for _, lease := range pending {
		lease.mu.Lock()
		unbound := !lease.bound
		lease.mu.Unlock()
		if unbound {
			s.revokeInstalledLaunch(lease.id)
		}
	}
	projected, err := appPackageJobProjection(job)
	if err != nil {
		return nil, err
	}
	return &runtimev1.StartAppPackageUninstallResponse{Job: projected, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

// Native/main-only completion, absent from the renderer product profile.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
func (s *Service) CompleteAppPackageUninstall(ctx context.Context, req *runtimev1.CompleteAppPackageUninstallRequest) (*runtimev1.CompleteAppPackageUninstallResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.appInstallCoordinator == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_UNINSTALL_UNAVAILABLE)
	}
	if req == nil || len(req.GetJobId()) == 0 || len(req.GetJobId()) > 160 || len(req.GetLaunchSelector()) == 0 || len(req.GetLaunchSelector()) > 160 || !utf8.Valid(req.GetLaunchSelector()) {
		return nil, installedLaunchMismatch()
	}
	handle := string(req.GetLaunchSelector())
	s.installedLaunchMu.Lock()
	var current []*installedAppLaunch
	for _, lease := range s.installedLaunches {
		if lease.policy.RegistrationHandle == handle {
			current = append(current, lease)
		}
	}
	s.installedLaunchMu.Unlock()
	for _, lease := range current {
		lease.mu.Lock()
		liveness := lease.liveness
		lease.mu.Unlock()
		if liveness != nil {
			select {
			case <-liveness.Revoked():
			default:
				return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_HOST_RUNNING)
			}
		}
	}
	job, err := s.appInstallCoordinator.CompleteUninstall(ctx, string(req.GetJobId()), handle)
	if err != nil {
		return nil, uninstallError(err)
	}
	owner, _ := protectedlocal.DesktopConnectionFromContext(ctx)
	owner.UnbindRevocationHook(uninstallJobHook(job.JobID))
	projected, err := appPackageJobProjection(job)
	if err != nil {
		return nil, err
	}
	return &runtimev1.CompleteAppPackageUninstallResponse{Job: projected, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func uninstallJobHook(jobID string) protectedlocal.Identifier {
	decoded, _ := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(jobID, "apj_v1_"))
	var id protectedlocal.Identifier
	copy(id[:], decoded)
	return id
}

func uninstallError(err error) error {
	if errors.Is(err, localappkernel.ErrPackageJobActive) {
		return grpcerr.WithReasonCode(codes.Aborted, runtimev1.ReasonCode_APP_PACKAGE_JOB_ACTIVE)
	}
	return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_UNINSTALL_FAILED)
}
