package app

import (
	"context"
	"errors"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappinstall"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040b
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
func (s *Service) StartAppPackageUpdate(ctx context.Context, req *runtimev1.StartAppPackageUpdateRequest) (*runtimev1.StartAppPackageUpdateResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if req == nil || len(req.GetApprovedTargetSelector()) == 0 || len(req.GetLaunchSelector()) == 0 || len(req.GetLaunchSelector()) > 160 || !utf8.Valid(req.GetLaunchSelector()) || req.GetInstalledVersion() == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	selector, err := publicappregistry.ParseApprovedTargetSelector(string(req.GetApprovedTargetSelector()))
	if err != nil {
		return nil, appPackageInstallStartError(err)
	}
	if s == nil || s.appInstallCoordinator == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_UPDATE_UNAVAILABLE)
	}
	job, err := s.appInstallCoordinator.StartUpdate(ctx, selector, string(req.GetLaunchSelector()), req.GetInstalledVersion(), s.requireInstalledAppStoppedForUpdate)
	if err != nil {
		switch {
		case errors.Is(err, nimiappinstall.ErrUpdateUnavailable):
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_UPDATE_UNAVAILABLE)
		case errors.Is(err, nimiappinstall.ErrUpdateHostRunning):
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_HOST_RUNNING)
		default:
			return nil, appPackageInstallStartError(err)
		}
	}
	projected, err := appPackageJobProjection(job)
	if err != nil {
		return nil, err
	}
	return &runtimev1.StartAppPackageUpdateResponse{Job: projected, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) requireInstalledAppStoppedForUpdate(handle string) error {
	// launchMu serializes this check with prepare/bind. Do not take lease.mu:
	// bind already takes that lock before entering the Coordinator.
	s.installedLaunchMu.Lock()
	defer s.installedLaunchMu.Unlock()
	for _, lease := range s.installedLaunches {
		if lease.policy.RegistrationHandle == handle {
			return nimiappinstall.ErrUpdateHostRunning
		}
	}
	return nil
}
