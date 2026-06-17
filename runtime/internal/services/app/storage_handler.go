package app

import (
	"context"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appreleasecatalog"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const defaultAppStoragePolicyRef = "nimi-data-app-roots"
const avatarAppID = "nimi.avatar"

// GetAppStorage returns the Runtime-owned app-scoped storage projection.
// It is intentionally independent from install job state: runtime-registered
// developer apps can receive data/cache/tmp roots even before an install
// descriptor or active release exists, while ordinary installed apps still
// surface active release information from the Runtime install evidence path.
func (s *Service) GetAppStorage(ctx context.Context, req *runtimev1.GetAppStorageRequest) (*runtimev1.GetAppStorageResponse, error) {
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

	dataRootRef := strings.TrimSpace(s.appStorageDataRoot)
	if dataRootRef == "" && s.installRuntime != nil {
		dataRootRef = strings.TrimSpace(s.installRuntime.dataRootRef)
	}
	if dataRootRef == "" {
		return &runtimev1.GetAppStorageResponse{Projection: appStorageUnavailable(
			appID,
			runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION,
			"app storage dataRootRef is not configured",
		)}, nil
	}

	descriptor, descriptorFound := s.resolveStorageDescriptor(appID)
	storagePolicyRef := defaultAppStoragePolicyRef
	if descriptorFound {
		storagePolicyRef = strings.TrimSpace(descriptor.StoragePolicyRef)
	}
	roots, err := appstorage.ResolveAppRoots(dataRootRef, appID, storagePolicyRef)
	if err != nil {
		return &runtimev1.GetAppStorageResponse{Projection: appStorageUnavailable(
			appID,
			runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION,
			err.Error(),
		)}, nil
	}
	if err := appstorage.MaterializeAppRoots(roots); err != nil {
		return &runtimev1.GetAppStorageResponse{Projection: appStorageProjectionFromPlan(
			appID,
			roots,
			runtimev1.AppStorageState_APP_STORAGE_STATE_REPAIR_REQUIRED,
			"",
			runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION,
			err.Error(),
		)}, nil
	}

	active, activeErr := appstorage.ReadActiveRelease(roots)
	if activeErr == nil && strings.TrimSpace(active.ActiveVersion) != "" {
		activePlan, err := appstorage.Resolve(dataRootRef, appID, strings.TrimSpace(active.ActiveVersion), storagePolicyRef)
		if err != nil {
			return &runtimev1.GetAppStorageResponse{Projection: appStorageProjectionFromPlan(
				appID,
				roots,
				runtimev1.AppStorageState_APP_STORAGE_STATE_REPAIR_REQUIRED,
				"",
				runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION,
				err.Error(),
			)}, nil
		}
		return &runtimev1.GetAppStorageResponse{Projection: appStorageProjectionFromPlan(
			appID,
			activePlan,
			runtimev1.AppStorageState_APP_STORAGE_STATE_READY,
			strings.TrimSpace(active.ActiveVersion),
			runtimev1.ReasonCode_ACTION_EXECUTED,
			"",
		)}, nil
	}
	if activeErr != nil && !errors.Is(activeErr, appstorage.ErrActiveReleaseNotFound) {
		return &runtimev1.GetAppStorageResponse{Projection: appStorageProjectionFromPlan(
			appID,
			roots,
			runtimev1.AppStorageState_APP_STORAGE_STATE_REPAIR_REQUIRED,
			"",
			runtimev1.ReasonCode_APP_INSTALL_STORAGE_VIOLATION,
			activeErr.Error(),
		)}, nil
	}
	if isDesktopCoreAvatarStorageProjection(ctx, appID) {
		return &runtimev1.GetAppStorageResponse{Projection: appStorageProjectionFromPlan(
			appID,
			roots,
			runtimev1.AppStorageState_APP_STORAGE_STATE_READY,
			"",
			runtimev1.ReasonCode_ACTION_EXECUTED,
			"",
		)}, nil
	}

	state := runtimev1.AppStorageState_APP_STORAGE_STATE_READY
	reason := runtimev1.ReasonCode_ACTION_EXECUTED
	detail := ""
	if descriptorFound {
		state = runtimev1.AppStorageState_APP_STORAGE_STATE_INSTALL_REQUIRED
		reason = runtimev1.ReasonCode_APP_INSTALL_DESCRIPTOR_NOT_FOUND
		detail = "app has no active release; install is required before launch"
	}
	return &runtimev1.GetAppStorageResponse{Projection: appStorageProjectionFromPlan(
		appID,
		roots,
		state,
		"",
		reason,
		detail,
	)}, nil
}

func isDesktopCoreAvatarStorageProjection(ctx context.Context, appID string) bool {
	return strings.TrimSpace(appID) == avatarAppID && isDesktopCoreLifecycleController(ctx)
}

func (s *Service) resolveStorageDescriptor(appID string) (appreleasecatalog.Descriptor, bool) {
	if s.installRuntime == nil {
		return appreleasecatalog.Descriptor{}, false
	}
	_, descriptor, err := s.installRuntime.resolveDescriptor(appID)
	if err != nil {
		return appreleasecatalog.Descriptor{}, false
	}
	return descriptor, true
}

func appStorageUnavailable(appID string, reason runtimev1.ReasonCode, detail string) *runtimev1.AppStorageProjection {
	return &runtimev1.AppStorageProjection{
		AppId:      appID,
		State:      runtimev1.AppStorageState_APP_STORAGE_STATE_STORAGE_UNAVAILABLE,
		ReasonCode: reason,
		Detail:     detail,
	}
}

func appStorageProjectionFromPlan(
	appID string,
	plan appstorage.Plan,
	state runtimev1.AppStorageState,
	activeVersion string,
	reason runtimev1.ReasonCode,
	detail string,
) *runtimev1.AppStorageProjection {
	return &runtimev1.AppStorageProjection{
		AppId:             appID,
		State:             state,
		AppRoot:           plan.AppRoot,
		ActiveReleaseRoot: plan.ReleaseRoot,
		DurableDataRoot:   plan.DurableDataRoot,
		CacheRoot:         plan.CacheRoot,
		TempRoot:          plan.TempRoot,
		ActiveVersion:     activeVersion,
		StoragePolicyRef:  plan.StoragePolicyRef,
		ReasonCode:        reason,
		Detail:            detail,
	}
}
