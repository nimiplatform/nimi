package grpcserver

import (
	"context"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
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
	"gopkg.in/yaml.v3"
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
		{method: "/nimi.runtime.v1.RuntimeLocalService/StartLocalEnvironmentDependencyJob", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeLocalService/CancelLocalEnvironmentDependencyJob", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeLocalService/RetryLocalEnvironmentDependencyJob", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeLocalService/RepairLocalEnvironmentDependency", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAppService/PrepareAppLifecycleIntent", reason: runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE},
		{method: "/nimi.runtime.v1.RuntimeAppService/GetAppLifecycleIntentStatus", reason: runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE},
		{method: "/nimi.runtime.v1.RuntimeAppService/InstallApp", reason: runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE},
		{method: "/nimi.runtime.v1.RuntimeAppService/UninstallApp", reason: runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE},
		{method: "/nimi.runtime.v1.RuntimeAppService/GetAppInstallJob", reason: runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE},
		{method: "/nimi.runtime.v1.RuntimeAppService/ListAppInstallJobs", reason: runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE},
		{method: "/nimi.runtime.v1.RuntimeAppService/UpdateApp", reason: runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE},
		{method: "/nimi.runtime.v1.RuntimeAppService/HealthRepairApp", reason: runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE},
		{method: "/nimi.runtime.v1.RuntimeAppService/PrepareLocalAppLaunch", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAuthService/OpenLocalAppSession", reason: runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH},
		{method: "/nimi.runtime.v1.RuntimeAuthService/RenewLocalAppSession", reason: runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH},
		{method: "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAiService/CancelScenarioJob", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAiService/GetScenarioArtifacts", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAiService/GetVoiceAsset", reason: runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH},
		{method: "/nimi.runtime.v1.RuntimeArtifactService/ReadArtifactBytes", reason: runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED},
		{method: "/nimi.runtime.v1.RuntimeAiRealtimeService/OpenRealtimeSession", reason: runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH},
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
			wantCode := codes.PermissionDenied
			if test.reason == runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
				wantCode = codes.Unimplemented
			}
			if status.Code(err) != wantCode || status.Convert(err).Message() != test.reason.String() {
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
		"/nimi.runtime.v1.RuntimeAppService/WatchAppInstallJobEvents",
	} {
		handlerCalled := false
		stream := &authzTestStream{ctx: context.Background()}
		err := interceptor(nil, stream, &grpc.StreamServerInfo{FullMethod: method}, func(any, grpc.ServerStream) error {
			handlerCalled = true
			return nil
		})
		wantCode := codes.PermissionDenied
		if method == "/nimi.runtime.v1.RuntimeAppService/WatchAppInstallJobEvents" {
			wantCode = codes.Unimplemented
		}
		if handlerCalled || status.Code(err) != wantCode {
			t.Fatalf("protected stream %s was not denied before handler: called=%v err=%v", method, handlerCalled, err)
		}
	}
}

func TestA0PublicTransportGateCoversCanonicalProtectedMatrix(t *testing.T) {
	type matrixRow struct {
		MethodID                string   `yaml:"method_id"`
		AllowedTransportClasses []string `yaml:"allowed_transport_classes"`
		PublicTCPDisposition    string   `yaml:"public_tcp_disposition"`
	}
	var matrix struct {
		Methods []matrixRow `yaml:"methods"`
	}
	raw, err := os.ReadFile(findRepoFile(t, filepath.FromSlash("config/spec-frozen/runtime/tables/protected-local-rpc-transport-matrix.yaml")))
	if err != nil {
		t.Fatalf("read protected-local matrix: %v", err)
	}
	if err := yaml.Unmarshal(raw, &matrix); err != nil {
		t.Fatalf("parse protected-local matrix: %v", err)
	}
	for _, row := range matrix.Methods {
		reason, blocked := publicTransportDenial(row.MethodID)
		switch row.PublicTCPDisposition {
		case "deny":
			if !blocked {
				t.Fatalf("canonical public deny is not enforced: %s", row.MethodID)
			}
			want := runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED
			if containsTransportClass(row.AllowedTransportClasses, "local_app_bootstrap") || containsTransportClass(row.AllowedTransportClasses, "local_app_host") {
				want = runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH
			}
			if reason != want {
				t.Fatalf("canonical public denial reason mismatch for %s: got=%v want=%v", row.MethodID, reason, want)
			}
		case "binding_only":
			if blocked {
				t.Fatalf("binding-only bootstrap was blocked: %s reason=%v", row.MethodID, reason)
			}
		}
	}
}

func containsTransportClass(classes []string, required string) bool {
	for _, class := range classes {
		if class == required {
			return true
		}
	}
	return false
}

func findRepoFile(t *testing.T, relative string) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("working directory: %v", err)
	}
	for {
		candidate := filepath.Join(dir, relative)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("repo file not found: %s", relative)
		}
		dir = parent
	}
}

func TestA0OrdinaryGRPCLeavesBindingOnlyBootstrapReachable(t *testing.T) {
	interceptor := newUnaryPublicTransportInterceptor()
	for _, method := range []string{
		"/nimi.runtime.v1.RuntimeAuthService/RegisterApp",
		"/nimi.runtime.v1.RuntimeAuthService/OpenSession",
	} {
		handlerCalled := false
		resp, err := interceptor(context.Background(), struct{}{}, &grpc.UnaryServerInfo{FullMethod: method}, func(context.Context, any) (any, error) {
			handlerCalled = true
			return "binding-only", nil
		})
		if err != nil || !handlerCalled || resp != "binding-only" {
			t.Fatalf("binding-only bootstrap %s was not forwarded: response=%+v called=%v err=%v", method, resp, handlerCalled, err)
		}
	}
}

func TestA0BindingOnlySessionCannotExecuteAIWithPortableMetadata(t *testing.T) {
	interceptor := newUnaryAuthzInterceptor(protectedCarrierOnlyCapabilityAuthorizer{})
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-app-id", "community.example.binding-only",
		"x-nimi-session-id", "binding-only-session",
		"x-nimi-session-token", "binding-only-token",
		"x-nimi-access-token-id", "forged-portable-grant",
		"x-nimi-access-token-secret", "forged-portable-secret",
	))
	handlerCalled := false
	resp, err := interceptor(ctx, &runtimev1.ExecuteScenarioRequest{}, &grpc.UnaryServerInfo{
		FullMethod: "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
	}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return &runtimev1.ExecuteScenarioResponse{}, nil
	})
	if resp != nil || handlerCalled || status.Code(err) != codes.PermissionDenied {
		t.Fatalf("binding-only AI execution was not rejected before handler: response=%+v called=%v err=%v", resp, handlerCalled, err)
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
	registered, err := authClient.RegisterApp(context.Background(), &runtimev1.RegisterAppRequest{
		AppId:         "community.example.binding-only",
		AppInstanceId: "binding-instance",
		DeviceId:      "device-1",
		Capabilities:  []string{"account.raw-token", "ai.spend.meter"},
		ModeManifest: &runtimev1.AppModeManifest{
			AppMode:         runtimev1.AppMode_APP_MODE_FULL,
			RuntimeRequired: true,
			RealmRequired:   true,
		},
	})
	if err != nil || !registered.GetAccepted() {
		t.Fatalf("binding-only RegisterApp: response=%+v err=%v", registered, err)
	}
	opened, err := authClient.OpenSession(context.Background(), &runtimev1.OpenSessionRequest{
		AppId:         "community.example.binding-only",
		AppInstanceId: registered.GetAppInstanceId(),
		DeviceId:      "device-1",
	})
	if err != nil || opened.GetSessionId() == "" || opened.GetSessionToken() == "" {
		t.Fatalf("binding-only OpenSession: response=%+v err=%v", opened, err)
	}

	bindingContext := metadata.NewOutgoingContext(context.Background(), metadata.Pairs(
		"x-nimi-app-id", "community.example.binding-only",
		"x-nimi-session-id", opened.GetSessionId(),
		"x-nimi-session-token", opened.GetSessionToken(),
		"x-nimi-source-host", "desktop-renderer",
	))
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
		{name: "InstallApp", call: func() error {
			_, callErr := runtimev1.NewRuntimeAppServiceClient(conn).InstallApp(bindingContext, &runtimev1.InstallAppRequest{AppId: "community.target"})
			return callErr
		}},
	}
	for _, call := range calls {
		t.Run(call.name, func(t *testing.T) {
			err := call.call()
			wantCode := codes.PermissionDenied
			if call.name == "InstallApp" {
				wantCode = codes.Unimplemented
			}
			if status.Code(err) != wantCode {
				t.Fatalf("real gRPC call was not denied: code=%v want=%v err=%v", status.Code(err), wantCode, err)
			}
		})
	}
}
