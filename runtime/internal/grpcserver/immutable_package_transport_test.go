package grpcserver

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestImmutablePackageUnaryRPCsAreDenyAllOnEveryRuntimeTransport(t *testing.T) {
	methods := []string{
		"/nimi.runtime.v1.RuntimeAppService/PrepareAppLifecycleIntent",
		"/nimi.runtime.v1.RuntimeAppService/GetAppLifecycleIntentStatus",
		"/nimi.runtime.v1.RuntimeAppService/InstallApp",
		"/nimi.runtime.v1.RuntimeAppService/UninstallApp",
		"/nimi.runtime.v1.RuntimeAppService/GetAppInstallJob",
		"/nimi.runtime.v1.RuntimeAppService/ListAppInstallJobs",
		"/nimi.runtime.v1.RuntimeAppService/UpdateApp",
		"/nimi.runtime.v1.RuntimeAppService/HealthRepairApp",
	}
	transports := []struct {
		name        string
		interceptor grpc.UnaryServerInterceptor
	}{
		{name: "public", interceptor: newUnaryPublicTransportInterceptor()},
		{name: "desktop_control", interceptor: newUnaryProtectedDesktopTransportInterceptor(nil)},
		{name: "local_app", interceptor: newUnaryProtectedLocalAppTransportInterceptor()},
	}
	for _, transport := range transports {
		for _, method := range methods {
			t.Run(transport.name+method, func(t *testing.T) {
				handlerCalled := false
				response, err := transport.interceptor(context.Background(), struct{}{}, &grpc.UnaryServerInfo{FullMethod: method}, func(context.Context, any) (any, error) {
					handlerCalled = true
					return struct{}{}, nil
				})
				if response != nil || handlerCalled {
					t.Fatalf("deny-all method reached handler: response=%+v called=%v", response, handlerCalled)
				}
				assertImmutablePackageTransportUnavailable(t, err)
			})
		}
	}
}

func TestImmutablePackageJobStreamIsDenyAllOnEveryRuntimeTransport(t *testing.T) {
	method := "/nimi.runtime.v1.RuntimeAppService/WatchAppInstallJobEvents"
	transports := []struct {
		name        string
		interceptor grpc.StreamServerInterceptor
	}{
		{name: "public", interceptor: newStreamPublicTransportInterceptor()},
		{name: "desktop_control", interceptor: newStreamProtectedDesktopTransportInterceptor(nil)},
		{name: "local_app", interceptor: newStreamProtectedLocalAppTransportInterceptor()},
	}
	for _, transport := range transports {
		t.Run(transport.name, func(t *testing.T) {
			handlerCalled := false
			err := transport.interceptor(nil, &authzTestStream{ctx: context.Background()}, &grpc.StreamServerInfo{FullMethod: method}, func(any, grpc.ServerStream) error {
				handlerCalled = true
				return nil
			})
			if handlerCalled {
				t.Fatal("deny-all install job stream reached handler")
			}
			assertImmutablePackageTransportUnavailable(t, err)
		})
	}
}

func TestImmutablePackageDenyAllSetMatchesFrozenWireSeams(t *testing.T) {
	if len(immutablePackageDenyAllMethods) != 9 {
		t.Fatalf("immutable package deny-all method count = %d, want 9", len(immutablePackageDenyAllMethods))
	}
	if immutablePackageTransportDenied("/nimi.runtime.v1.RuntimeAppService/GetAppPackageReadiness") {
		t.Fatal("typed readiness projection must remain callable after ordinary authentication")
	}
	if immutablePackageTransportDenied("/nimi.runtime.v1.RuntimeAppService/PrepareLocalAppLaunch") {
		t.Fatal("active local-development launch path was conflated with immutable package lifecycle")
	}
}

func assertImmutablePackageTransportUnavailable(t *testing.T, err error) {
	t.Helper()
	if status.Code(err) != codes.Unimplemented {
		t.Fatalf("deny-all code = %v, want Unimplemented: %v", status.Code(err), err)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("deny-all reason = %v present=%v, want LOCAL_APP_OPERATION_UNAVAILABLE: %v", reason, ok, err)
	}
}
