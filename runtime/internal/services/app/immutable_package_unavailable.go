package app

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const immutableProfileUnavailableDetail = "immutable_profile_unavailable"

// immutablePackageUnavailable is the only 0K result for immutable package
// lifecycle methods. 0P/P must independently admit package materialization
// before any of these frozen wire seams can acquire positive behavior.
func immutablePackageUnavailable() error {
	return grpcerr.WithReasonCode(codes.Unimplemented, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
}

func (s *Service) PrepareAppLifecycleIntent(context.Context, *runtimev1.PrepareAppLifecycleIntentRequest) (*runtimev1.PrepareAppLifecycleIntentResponse, error) {
	return nil, immutablePackageUnavailable()
}

func (s *Service) GetAppLifecycleIntentStatus(context.Context, *runtimev1.GetAppLifecycleIntentStatusRequest) (*runtimev1.GetAppLifecycleIntentStatusResponse, error) {
	return nil, immutablePackageUnavailable()
}

func (s *Service) InstallApp(context.Context, *runtimev1.InstallAppRequest) (*runtimev1.InstallAppResponse, error) {
	return nil, immutablePackageUnavailable()
}

func (s *Service) UninstallApp(context.Context, *runtimev1.UninstallAppRequest) (*runtimev1.UninstallAppResponse, error) {
	return nil, immutablePackageUnavailable()
}

func (s *Service) GetAppInstallJob(context.Context, *runtimev1.GetAppInstallJobRequest) (*runtimev1.GetAppInstallJobResponse, error) {
	return nil, immutablePackageUnavailable()
}

func (s *Service) ListAppInstallJobs(context.Context, *runtimev1.ListAppInstallJobsRequest) (*runtimev1.ListAppInstallJobsResponse, error) {
	return nil, immutablePackageUnavailable()
}

func (s *Service) WatchAppInstallJobEvents(*runtimev1.WatchAppInstallJobEventsRequest, runtimev1.RuntimeAppService_WatchAppInstallJobEventsServer) error {
	return immutablePackageUnavailable()
}

func (s *Service) UpdateApp(context.Context, *runtimev1.UpdateAppRequest) (*runtimev1.UpdateAppResponse, error) {
	return nil, immutablePackageUnavailable()
}

func (s *Service) HealthRepairApp(context.Context, *runtimev1.HealthRepairAppRequest) (*runtimev1.HealthRepairAppResponse, error) {
	return nil, immutablePackageUnavailable()
}
