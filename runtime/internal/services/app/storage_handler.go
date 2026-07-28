package app

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const defaultAppStoragePolicyRef = "nimi-data-app-roots"
const avatarAppID = "nimi.avatar"

// GetAppStorage returns only current app-private data/cache/tmp roots. It never
// reads an ordinary package release pointer or install evidence.
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
	if dataRootRef == "" {
		return &runtimev1.GetAppStorageResponse{Projection: appStorageUnavailable(
			appID,
			runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE,
			"app storage dataRootRef is not configured",
		)}, nil
	}

	roots, err := appstorage.ResolveAppRoots(dataRootRef, appID, defaultAppStoragePolicyRef)
	if err != nil {
		return &runtimev1.GetAppStorageResponse{Projection: appStorageUnavailable(
			appID,
			runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE,
			err.Error(),
		)}, nil
	}
	if err := appstorage.MaterializeAppRoots(roots); err != nil {
		return &runtimev1.GetAppStorageResponse{Projection: appStorageProjectionFromPlan(
			appID,
			roots,
			runtimev1.AppStorageState_APP_STORAGE_STATE_REPAIR_REQUIRED,
			runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE,
			err.Error(),
		)}, nil
	}

	return &runtimev1.GetAppStorageResponse{Projection: appStorageProjectionFromPlan(
		appID,
		roots,
		runtimev1.AppStorageState_APP_STORAGE_STATE_READY,
		runtimev1.ReasonCode_ACTION_EXECUTED,
		"",
	)}, nil
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
	reason runtimev1.ReasonCode,
	detail string,
) *runtimev1.AppStorageProjection {
	return &runtimev1.AppStorageProjection{
		AppId:            appID,
		State:            state,
		AppRoot:          plan.AppRoot,
		DurableDataRoot:  plan.DurableDataRoot,
		CacheRoot:        plan.CacheRoot,
		TempRoot:         plan.TempRoot,
		StoragePolicyRef: plan.StoragePolicyRef,
		ReasonCode:       reason,
		Detail:           detail,
	}
}
