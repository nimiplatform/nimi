package localservice

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
)

func TestLocalManagedMediaDiffusersBackendServiceListAndHealth(t *testing.T) {
	svc := newTestService(t)
	svc.SetManagedMediaDiffusersBackendConfig(true, "127.0.0.1:50052")

	listed, err := svc.ListLocalServices(context.Background(), &runtimev1.ListLocalServicesRequest{})
	if err != nil {
		t.Fatalf("list local services: %v", err)
	}
	if len(listed.GetServices()) != 1 {
		t.Fatalf("expected 1 synthetic service, got %d", len(listed.GetServices()))
	}
	service := listed.GetServices()[0]
	if service.GetServiceId() != managedMediaDiffusersBackendServiceID {
		t.Fatalf("unexpected service id: %q", service.GetServiceId())
	}
	if service.GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_INSTALLED {
		t.Fatalf("expected installed status, got %s", service.GetStatus())
	}
	if service.GetEndpoint() != "grpc://127.0.0.1:50052" {
		t.Fatalf("unexpected service endpoint: %q", service.GetEndpoint())
	}

	svc.SetManagedMediaDiffusersBackendHealth(true, "daemon-managed image backend active")
	healthy, err := svc.CheckLocalServiceHealth(context.Background(), &runtimev1.CheckLocalServiceHealthRequest{
		ServiceId: managedMediaDiffusersBackendServiceID,
	})
	if err != nil {
		t.Fatalf("check local service health(active): %v", err)
	}
	if len(healthy.GetServices()) != 1 {
		t.Fatalf("expected 1 service health row, got %d", len(healthy.GetServices()))
	}
	if healthy.GetServices()[0].GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE {
		t.Fatalf("expected active status, got %s", healthy.GetServices()[0].GetStatus())
	}

	svc.SetManagedMediaDiffusersBackendHealth(false, "tcp dial failed")
	unhealthy, err := svc.CheckLocalServiceHealth(context.Background(), &runtimev1.CheckLocalServiceHealthRequest{
		ServiceId: managedMediaDiffusersBackendServiceID,
	})
	if err != nil {
		t.Fatalf("check local service health(unhealthy): %v", err)
	}
	if unhealthy.GetServices()[0].GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY {
		t.Fatalf("expected unhealthy status, got %s", unhealthy.GetServices()[0].GetStatus())
	}
	if !strings.Contains(unhealthy.GetServices()[0].GetDetail(), "tcp dial failed") {
		t.Fatalf("expected unhealthy detail to include probe error, got %q", unhealthy.GetServices()[0].GetDetail())
	}
}

func TestLocalManagedMediaDiffusersBackendServiceRejectsMutations(t *testing.T) {
	svc := newTestService(t)
	svc.SetManagedMediaDiffusersBackendConfig(true, "127.0.0.1:50052")
	ctx := context.Background()

	_, err := svc.InstallLocalService(ctx, &runtimev1.InstallLocalServiceRequest{
		ServiceId: managedMediaDiffusersBackendServiceID,
	})
	assertGRPCCode(t, err, "InstallLocalService(managed_image_backend)", codes.FailedPrecondition)
	assertGRPCReasonCode(t, err, "InstallLocalService(managed_image_backend)", runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION)

	_, err = svc.StartLocalService(ctx, &runtimev1.StartLocalServiceRequest{
		ServiceId: managedMediaDiffusersBackendServiceID,
	})
	assertGRPCCode(t, err, "StartLocalService(managed_image_backend)", codes.FailedPrecondition)
	assertGRPCReasonCode(t, err, "StartLocalService(managed_image_backend)", runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION)

	_, err = svc.StopLocalService(ctx, &runtimev1.StopLocalServiceRequest{
		ServiceId: managedMediaDiffusersBackendServiceID,
	})
	assertGRPCCode(t, err, "StopLocalService(managed_image_backend)", codes.FailedPrecondition)
	assertGRPCReasonCode(t, err, "StopLocalService(managed_image_backend)", runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION)

	_, err = svc.RemoveLocalService(ctx, &runtimev1.RemoveLocalServiceRequest{
		ServiceId: managedMediaDiffusersBackendServiceID,
	})
	assertGRPCCode(t, err, "RemoveLocalService(managed_image_backend)", codes.FailedPrecondition)
	assertGRPCReasonCode(t, err, "RemoveLocalService(managed_image_backend)", runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION)
}
