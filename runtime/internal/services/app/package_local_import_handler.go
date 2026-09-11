package app

import (
	"context"
	"errors"
	"os"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappinstall"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappnative"
	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040e
func (s *Service) PrepareLocalAppPackage(ctx context.Context, req *runtimev1.PrepareLocalAppPackageRequest) (*runtimev1.PrepareLocalAppPackageResponse, error) {
	if err := s.requireLocalPackageOwner(ctx); err != nil {
		return nil, err
	}
	if req == nil || req.GetSourcePath() == "" || len(req.GetSourcePath()) > 32768 || !utf8.ValidString(req.GetSourcePath()) || strings.ContainsRune(req.GetSourcePath(), 0) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_INVALID)
	}
	selected, err := s.appInstallCoordinator.PrepareLocalPackage(ctx, req.GetSourcePath())
	if err != nil {
		return nil, localPackageError(err)
	}
	expected := selected.Metadata.Expected
	return &runtimev1.PrepareLocalAppPackageResponse{
		Preview: &runtimev1.LocalAppPackagePreview{
			Info:              appPackageInfoProjection(selected.Metadata.AppInfo),
			CandidateSelector: []byte(selected.Selector), AppId: expected.AppID, DisplayName: selected.Metadata.DisplayName,
			Version: expected.Version, Os: expected.OS, Arch: expected.Arch, AppAccess: append([]string(nil), expected.AppAccess...),
			WindowsCodeSigning: expected.NativeTrust.WindowsCodeSigning, ObservedSigningSubject: cloneStringPointer(expected.NativeTrust.ObservedSubject),
			MacosNotarization: expected.NativeTrust.MacOSNotarization, MacosDeveloperIdSubject: cloneStringPointer(expected.NativeTrust.MacOSDeveloperIDSubject),
			ExpiresAt: timestamppb.New(selected.ExpiresAt), Size: uint64(expected.ArchiveSize),
		}, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) DiscardLocalAppPackage(ctx context.Context, req *runtimev1.DiscardLocalAppPackageRequest) (*runtimev1.DiscardLocalAppPackageResponse, error) {
	if err := s.requireLocalPackageOwner(ctx); err != nil {
		return nil, err
	}
	if req == nil || !validLocalCandidateSelector(req.GetCandidateSelector()) {
		return nil, localPackageError(nimiappinstall.ErrLocalCandidate)
	}
	if err := s.appInstallCoordinator.DiscardLocalPackage(ctx, string(req.GetCandidateSelector())); err != nil {
		return nil, localPackageError(err)
	}
	return &runtimev1.DiscardLocalAppPackageResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) StartLocalAppPackageInstall(ctx context.Context, req *runtimev1.StartLocalAppPackageInstallRequest) (*runtimev1.StartLocalAppPackageInstallResponse, error) {
	if err := s.requireLocalPackageOwner(ctx); err != nil {
		return nil, err
	}
	if req == nil || !validLocalCandidateSelector(req.GetCandidateSelector()) {
		return nil, localPackageError(nimiappinstall.ErrLocalCandidate)
	}
	job, err := s.appInstallCoordinator.StartLocalPackage(ctx, string(req.GetCandidateSelector()), "", "", nil)
	if err != nil {
		return nil, localPackageError(err)
	}
	projected, err := appPackageJobProjection(job)
	if err != nil {
		return nil, err
	}
	return &runtimev1.StartLocalAppPackageInstallResponse{Job: projected, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) StartLocalAppPackageUpdate(ctx context.Context, req *runtimev1.StartLocalAppPackageUpdateRequest) (*runtimev1.StartLocalAppPackageUpdateResponse, error) {
	if err := s.requireLocalPackageOwner(ctx); err != nil {
		return nil, err
	}
	if req == nil || !validLocalCandidateSelector(req.GetCandidateSelector()) || len(req.GetLaunchSelector()) == 0 || len(req.GetLaunchSelector()) > 160 || !utf8.Valid(req.GetLaunchSelector()) || req.GetInstalledVersion() == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_INVALID)
	}
	job, err := s.appInstallCoordinator.StartLocalPackage(ctx, string(req.GetCandidateSelector()), string(req.GetLaunchSelector()), req.GetInstalledVersion(), s.requireInstalledAppStoppedForUpdate)
	if err != nil {
		return nil, localPackageError(err)
	}
	projected, err := appPackageJobProjection(job)
	if err != nil {
		return nil, err
	}
	return &runtimev1.StartLocalAppPackageUpdateResponse{Job: projected, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) requireLocalPackageOwner(ctx context.Context) error {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return err
	}
	if s == nil || s.appInstallCoordinator == nil {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE)
	}
	return nil
}

func validLocalCandidateSelector(value []byte) bool {
	if len(value) != 48 {
		return false
	}
	for _, b := range value {
		if !((b >= '0' && b <= '9') || (b >= 'a' && b <= 'f')) {
			return false
		}
	}
	return true
}

func localPackageError(err error) error {
	if errors.Is(err, nimiappinstall.ErrLocalCandidate) {
		return grpcerr.WrapWithReasonCode(codes.Aborted, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_STALE, err, grpcerr.ReasonOptions{})
	}
	if errors.Is(err, nimiappinstall.ErrAppAlreadyInstalled) {
		return appPackageInstallStartError(err)
	}
	reason := ""
	switch {
	case errors.Is(err, nimiapppackage.ErrUnsupportedTarget), errors.Is(err, nimiappinstall.ErrUnsupportedInstallPlatform):
		reason = "unsupported-target"
	case errors.Is(err, nimiappnative.ErrNativeVerification), errors.Is(err, nimiappnative.ErrNativePostureMismatch), errors.Is(err, nimiappnative.ErrInvalidExpectation):
		reason = "native-verification-failed"
	case errors.Is(err, nimiapppackage.ErrInvalidPackage), errors.Is(err, nimiapppackage.ErrPackageIntegrity):
		reason = "invalid-package"
	case errors.Is(err, os.ErrNotExist), errors.Is(err, os.ErrPermission):
		reason = "local-file-unavailable"
	}
	if reason != "" {
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_INVALID, err, grpcerr.ReasonOptions{Metadata: map[string]string{"local_import_reason": reason}})
	}
	return appPackageLifecycleError("local App package", err)
}
