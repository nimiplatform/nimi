package grpcserver

import (
	"context"
	"io"
	"log/slog"
	"net"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

func TestA0OrdinaryGRPCRejectsProtectedAndTombstoneMethodsBeforeHandler(t *testing.T) {
	interceptor := newUnaryPublicTransportInterceptor()
	tests := []struct {
		method string
		reason runtimev1.ReasonCode
	}{
		{method: "/nimi.runtime.v1.RuntimeAccountService/BeginLogin", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAccountService/InvokeRealmUnary", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAuthService/OpenDesktopSession", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeServiceControlService/RequestRuntimeRestart", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeLocalService/ApplyLocalEnvironmentPlan", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeLocalService/StartLocalEnvironmentDependencyJob", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeLocalService/CancelLocalEnvironmentDependencyJob", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeLocalService/RetryLocalEnvironmentDependencyJob", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeLocalService/RepairLocalEnvironmentDependency", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeLocalService/ListModelAssets", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeLocalService/GetMachineLoadouts", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeConnectorService/ListConnectors", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAppService/PrepareLocalAppLaunch", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAuthService/OpenLocalAppSession", reason: runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH},
		{method: "/nimi.runtime.v1.RuntimeAuthService/RenewLocalAppSession", reason: runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH},
		{method: "/nimi.runtime.v1.RuntimeAgentService/GetLocalAppAgentManagerSnapshot", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAiService/GetAppAIConfig", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAiService/OverwriteAppAIConfig", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAiService/CancelScenarioJob", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAiService/GetScenarioArtifacts", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAiService/GetVoiceAsset", reason: runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH},
		{method: "/nimi.runtime.v1.RuntimeArtifactService/ReadArtifactBytes", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAiRealtimeService/OpenRealtimeSession", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
	}
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-source-host", "desktop-renderer",
		"x-nimi-session-id", "binding-only-session",
		"x-nimi-session-token", "portable-binding-token",
		"x-nimi-caller-kind", "third-party-app",
	))

	for _, test := range tests {
		t.Run(test.method, func(t *testing.T) {
			handlerCalled := false
			resp, err := interceptor(ctx, struct{}{}, &grpc.UnaryServerInfo{FullMethod: test.method}, func(context.Context, any) (any, error) {
				handlerCalled = true
				return struct{}{}, nil
			})
			if resp != nil || handlerCalled {
				t.Fatalf("protected method reached handler: response=%+v called=%v", resp, handlerCalled)
			}
			if status.Code(err) != codes.PermissionDenied || status.Convert(err).Message() != test.reason.String() {
				t.Fatalf("unexpected denial: code=%v reason=%q err=%v", status.Code(err), status.Convert(err).Message(), err)
			}
		})
	}
}

func TestA0OrdinaryGRPCRejectsProtectedStreamsBeforeHandler(t *testing.T) {
	interceptor := newStreamPublicTransportInterceptor()
	for _, method := range []string{
		"/nimi.runtime.v1.RuntimeAccountService/SubscribeAccountSessionEvents",
		"/nimi.runtime.v1.RuntimeAiService/StreamScenario",
		"/nimi.runtime.v1.RuntimeAiService/UploadArtifact",
		"/nimi.runtime.v1.RuntimeAiRealtimeService/ReadRealtimeEvents",
		"/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents",
	} {
		handlerCalled := false
		stream := &authzTestStream{ctx: context.Background()}
		err := interceptor(nil, stream, &grpc.StreamServerInfo{FullMethod: method}, func(any, grpc.ServerStream) error {
			handlerCalled = true
			return nil
		})
		if handlerCalled || status.Code(err) != codes.PermissionDenied {
			t.Fatalf("protected stream %s was not denied before handler: called=%v err=%v", method, handlerCalled, err)
		}
	}
}

type a0PublicTransportAppService struct {
	runtimev1.UnimplementedRuntimeAppServiceServer
}

func TestA0PublicTransportHardcutOverRealGRPC(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	listener := bufconn.Listen(1024 * 1024)
	server := grpc.NewServer(grpc.UnaryInterceptor(newUnaryPublicTransportInterceptor()))
	runtimev1.RegisterRuntimeAuthServiceServer(server, authservice.New(logger))
	runtimev1.RegisterRuntimeAccountServiceServer(server, accountservice.New(logger))
	runtimev1.RegisterRuntimeAppServiceServer(server, &a0PublicTransportAppService{})
	go func() {
		_ = server.Serve(listener)
	}()
	t.Cleanup(func() {
		server.Stop()
		_ = listener.Close()
	})
	conn, err := grpc.DialContext(context.Background(), "bufnet",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) {
			return listener.Dial()
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial public Runtime harness: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	authClient := runtimev1.NewRuntimeAuthServiceClient(conn)
	bindingContext := context.Background()
	calls := []struct {
		name string
		call func() error
	}{
		{name: "OpenDesktopSession", call: func() error {
			_, callErr := authClient.OpenDesktopSession(bindingContext, &runtimev1.OpenDesktopSessionRequest{})
			return callErr
		}},
		{name: "OpenLocalAppSession", call: func() error {
			_, callErr := authClient.OpenLocalAppSession(bindingContext, &runtimev1.OpenLocalAppSessionRequest{})
			return callErr
		}},
		{name: "RenewLocalAppSession", call: func() error {
			_, callErr := authClient.RenewLocalAppSession(bindingContext, &runtimev1.RenewLocalAppSessionRequest{})
			return callErr
		}},
	}
	for _, call := range calls {
		t.Run(call.name, func(t *testing.T) {
			err := call.call()
			if status.Code(err) != codes.PermissionDenied {
				t.Fatalf("real gRPC call was not denied: code=%v want=%v err=%v", status.Code(err), codes.PermissionDenied, err)
			}
		})
	}
}
