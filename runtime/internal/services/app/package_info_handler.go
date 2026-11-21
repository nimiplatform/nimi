package app

import (
	"context"
	"sort"
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
		SafetyDeclaration: appSafetyDeclarationProjection(info.SafetyProfile),
		Storefront:        appStorefrontProjection(info.Storefront),
	}
	for _, item := range info.StoragePolicy.OSStorageDisclosure {
		result.OsStorageDisclosure = append(result.OsStorageDisclosure, &runtimev1.ApprovedAppCatalogStorageDisclosure{PathPattern: item.PathPattern, Purpose: item.Purpose, ExpectedSizeBand: item.ExpectedSizeBand})
	}
	return result
}

func appStorefrontProjection(sf *nimiapppackage.AppInfoStorefront) *runtimev1.AppStorefrontInfo {
	if sf == nil {
		return nil
	}
	out := &runtimev1.AppStorefrontInfo{
		Category:      sf.Category,
		DefaultLocale: sf.DefaultLocale,
	}
	if len(sf.Locales) > 0 {
		keys := make([]string, 0, len(sf.Locales))
		for k := range sf.Locales {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out.Locales = make([]*runtimev1.AppStorefrontLocale, 0, len(keys))
		for _, locale := range keys {
			entry := sf.Locales[locale]
			highlights := make([]*runtimev1.AppStorefrontHighlight, 0, len(entry.Highlights))
			for _, h := range entry.Highlights {
				highlights = append(highlights, &runtimev1.AppStorefrontHighlight{
					Title:       h.Title,
					Description: h.Description,
				})
			}
			out.Locales = append(out.Locales, &runtimev1.AppStorefrontLocale{
				Locale:               locale,
				DisplayName:          entry.DisplayName,
				Summary:              entry.Summary,
				Tags:                 append([]string(nil), entry.Tags...),
				Highlights:           highlights,
				IntroductionMarkdown: entry.IntroductionMarkdown,
			})
		}
	}
	if sf.Media != nil {
		media := &runtimev1.AppStorefrontMedia{}
		if sf.Media.Cover != nil {
			media.Cover = &runtimev1.AppStorefrontCover{
				DefaultImage: appStorefrontImageRefProjection(sf.Media.Cover.Default),
				Locales:      appStorefrontLocalizedImagesProjection(sf.Media.Cover.Locales),
			}
		}
		if len(sf.Media.Gallery) > 0 {
			media.Gallery = make([]*runtimev1.AppStorefrontGalleryItem, 0, len(sf.Media.Gallery))
			for _, item := range sf.Media.Gallery {
				var caption map[string]string
				if len(item.Caption) > 0 {
					caption = make(map[string]string, len(item.Caption))
					for k, v := range item.Caption {
						caption[k] = v
					}
				}
				media.Gallery = append(media.Gallery, &runtimev1.AppStorefrontGalleryItem{
					Id:           item.ID,
					Kind:         item.Kind,
					DefaultImage: appStorefrontImageRefProjection(item.Default),
					Locales:      appStorefrontLocalizedImagesProjection(item.Locales),
					Caption:      caption,
				})
			}
		}
		out.Media = media
	}
	return out
}

func appStorefrontImageRefProjection(ref nimiapppackage.AppInfoStorefrontImageRef) *runtimev1.AppStorefrontImageRef {
	return &runtimev1.AppStorefrontImageRef{
		MediaType: ref.MediaType,
		Width:     ref.Width,
		Height:    ref.Height,
		Size:      ref.Size,
		Sha256:    ref.SHA256,
	}
}

func appStorefrontLocalizedImagesProjection(locales map[string]nimiapppackage.AppInfoStorefrontImageRef) []*runtimev1.AppStorefrontLocalizedImage {
	if len(locales) == 0 {
		return nil
	}
	keys := make([]string, 0, len(locales))
	for k := range locales {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]*runtimev1.AppStorefrontLocalizedImage, 0, len(keys))
	for _, locale := range keys {
		out = append(out, &runtimev1.AppStorefrontLocalizedImage{
			Locale: locale,
			Image:  appStorefrontImageRefProjection(locales[locale]),
		})
	}
	return out
}
