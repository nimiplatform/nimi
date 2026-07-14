package app

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// GetAppPackageReadiness is an opaque 0K seam. It deliberately ignores every
// package selector and never reads a catalog, active release pointer, install
// evidence, package path, digest, update candidate, or repair state.
func (s *Service) GetAppPackageReadiness(context.Context, *runtimev1.GetAppPackageReadinessRequest) (*runtimev1.GetAppPackageReadinessResponse, error) {
	return &runtimev1.GetAppPackageReadinessResponse{
		Projection: &runtimev1.AppPackageReadinessProjection{
			State:      runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_BLOCKED,
			ReasonCode: runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE,
			Detail:     immutableProfileUnavailableDetail,
		},
	}, nil
}
