package app

import (
	"context"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042c
func (s *Service) GetAppPackageInfo(ctx context.Context, req *runtimev1.GetAppPackageInfoRequest) (*runtimev1.GetAppPackageInfoResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	approved := len(req.GetApprovedTargetSelector()) > 0
	installed := len(req.GetLaunchSelector()) > 0
	if approved == installed || (approved && req.GetInstalledReleaseRef() != "") || (installed && (req.GetInstalledReleaseRef() == "" || len(req.GetLaunchSelector()) > 160 || !utf8.Valid(req.GetLaunchSelector()))) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_INVALID)
	}
	var info nimiapppackage.AppInfo
	var err error
	if approved {
		selector, parseErr := publicappregistry.ParseApprovedTargetSelector(string(req.GetApprovedTargetSelector()))
		if parseErr != nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_PACKAGE_SELECTION_INVALID)
		}
		if s.appInstallCoordinator == nil {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_INFO_UNAVAILABLE)
		}
		info, err = s.appInstallCoordinator.ReadApprovedAppInfo(ctx, selector)
	} else {
		store, storeErr := s.packageLifecycleStore()
		if storeErr != nil {
			return nil, storeErr
		}
		var raw []byte
		raw, err = store.ReadAppInfo(ctx, string(req.GetLaunchSelector()), req.GetInstalledReleaseRef())
		if err == nil {
			info, err = nimiapppackage.ParseAppInfo(raw)
		}
	}
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_PACKAGE_INFO_UNAVAILABLE, err, grpcerr.ReasonOptions{})
	}
	return &runtimev1.GetAppPackageInfoResponse{Info: appPackageInfoProjection(info), ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func appPackageInfoProjection(info nimiapppackage.AppInfo) *runtimev1.AppPackageInfo {
	result := &runtimev1.AppPackageInfo{
		AppId: info.AppID, Version: info.Version, TargetId: info.TargetID, DisplayName: info.DisplayName, Summary: info.Summary,
		IconPngBase64: info.Icon.DataBase64, ReadmeMarkdown: info.ReadmeMarkdown, ReleaseNotesMarkdown: info.ReleaseNotesMarkdown,
		LicenseIdentifier: info.License.Identifier, LicenseText: info.License.Text, Author: info.Author, HomepageUrl: info.HomepageURL, SupportUrl: info.SupportURL,
		AppAccess: append([]string{}, info.AppAccess...), CapabilityContractRefs: append([]string{}, info.CapabilityContractRefs...), RequiredStandardizedFeatureRefs: append([]string{}, info.RequiredStandardizedFeatureRefs...), StoragePolicyKind: info.StoragePolicy.Kind,
	}
	for _, item := range info.StoragePolicy.OSStorageDisclosure {
		result.OsStorageDisclosure = append(result.OsStorageDisclosure, &runtimev1.ApprovedAppCatalogStorageDisclosure{PathPattern: item.PathPattern, Purpose: item.Purpose, ExpectedSizeBand: item.ExpectedSizeBand})
	}
	return result
}
