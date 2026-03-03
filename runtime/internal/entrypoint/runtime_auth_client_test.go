package entrypoint

import (
	"context"
	"errors"
	"net"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestRegisterAppGRPC_MetadataOverride(t *testing.T) {
	service := &testRuntimeAuthService{
		registerAppResponse: &runtimev1.RegisterAppResponse{
			AppInstanceId: "instance-1",
			Accepted:      true,
			ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	addr, shutdown := startTestRuntimeAuthServer(t, service)
	defer shutdown()

	resp, err := RegisterAppGRPC(addr, 3*time.Second, &runtimev1.RegisterAppRequest{
		AppId:         "nimi.desktop",
		AppInstanceId: "instance-1",
		DeviceId:      "device-1",
		AppVersion:    "0.1.0",
		Capabilities:  []string{"ai.generate"},
	}, &ClientMetadata{
		CallerKind: "third-party-service",
		CallerID:   "svc:auth",
		SurfaceID:  "runtime-cli",
		TraceID:    "trace-auth-register",
	})
	if err != nil {
		t.Fatalf("RegisterAppGRPC: %v", err)
	}
	if !resp.GetAccepted() {
		t.Fatalf("register app not accepted")
	}

	md := service.lastRegisterAppMetadata()
	if got := firstMetadataValue(md, "x-nimi-caller-id"); got != "svc:auth" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
	if got := firstMetadataValue(md, "x-nimi-app-id"); got != "nimi.desktop" {
		t.Fatalf("app-id mismatch: %q", got)
	}
}

func TestOpenRefreshRevokeSessionGRPC(t *testing.T) {
	service := &testRuntimeAuthService{
		openSessionResponse: &runtimev1.OpenSessionResponse{
			SessionId:    "session-1",
			IssuedAt:     timestamppb.Now(),
			ExpiresAt:    timestamppb.Now(),
			SessionToken: "token-1",
			ReasonCode:   runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		refreshSessionResponse: &runtimev1.RefreshSessionResponse{
			SessionId:    "session-1",
			ExpiresAt:    timestamppb.Now(),
			SessionToken: "token-2",
			ReasonCode:   runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		revokeSessionResponse: &runtimev1.Ack{
			Ok:         true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	addr, shutdown := startTestRuntimeAuthServer(t, service)
	defer shutdown()

	opened, err := OpenSessionGRPC(addr, 3*time.Second, &runtimev1.OpenSessionRequest{
		AppId:         "nimi.desktop",
		AppInstanceId: "instance-1",
		DeviceId:      "device-1",
		SubjectUserId: "user-1",
		TtlSeconds:    3600,
	}, &ClientMetadata{
		CallerKind: "third-party-service",
		CallerID:   "svc:session",
		SurfaceID:  "runtime-cli",
		TraceID:    "trace-open-session",
	})
	if err != nil {
		t.Fatalf("OpenSessionGRPC: %v", err)
	}
	if opened.GetSessionId() != "session-1" {
		t.Fatalf("session id mismatch: %s", opened.GetSessionId())
	}

	refreshed, err := RefreshSessionGRPC(addr, 3*time.Second, &runtimev1.RefreshSessionRequest{
		SessionId:  "session-1",
		TtlSeconds: 1800,
	}, "nimi.desktop", &ClientMetadata{
		CallerID: "svc:session-refresh",
	})
	if err != nil {
		t.Fatalf("RefreshSessionGRPC: %v", err)
	}
	if refreshed.GetSessionToken() != "token-2" {
		t.Fatalf("session token mismatch: %s", refreshed.GetSessionToken())
	}

	revoked, err := RevokeSessionGRPC(addr, 3*time.Second, &runtimev1.RevokeSessionRequest{
		SessionId: "session-1",
	}, "nimi.desktop", &ClientMetadata{
		CallerID: "svc:session-revoke",
	})
	if err != nil {
		t.Fatalf("RevokeSessionGRPC: %v", err)
	}
	if !revoked.GetOk() {
		t.Fatalf("revoke session not ok")
	}
}

func TestExternalPrincipalSessionGRPC(t *testing.T) {
	service := &testRuntimeAuthService{
		registerExternalResponse: &runtimev1.RegisterExternalPrincipalResponse{
			Accepted:   true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		openExternalResponse: &runtimev1.OpenExternalPrincipalSessionResponse{
			ExternalSessionId: "ext-session-1",
			ExpiresAt:         timestamppb.Now(),
			SessionToken:      "ext-token-1",
			ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		revokeExternalResponse: &runtimev1.Ack{
			Ok:         true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	addr, shutdown := startTestRuntimeAuthServer(t, service)
	defer shutdown()

	registered, err := RegisterExternalPrincipalGRPC(addr, 3*time.Second, &runtimev1.RegisterExternalPrincipalRequest{
		AppId:                 "nimi.desktop",
		ExternalPrincipalId:   "openclaw-agent",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		Issuer:                "local",
		ClientId:              "openclaw",
		SignatureKeyId:        "key-1",
		ProofType:             runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_JWT,
	}, &ClientMetadata{
		CallerID: "svc:external-register",
	})
	if err != nil {
		t.Fatalf("RegisterExternalPrincipalGRPC: %v", err)
	}
	if !registered.GetAccepted() {
		t.Fatalf("register external principal not accepted")
	}

	opened, err := OpenExternalPrincipalSessionGRPC(addr, 3*time.Second, &runtimev1.OpenExternalPrincipalSessionRequest{
		AppId:               "nimi.desktop",
		ExternalPrincipalId: "openclaw-agent",
		Proof:               "proof-1",
		TtlSeconds:          1800,
	}, &ClientMetadata{
		CallerID: "svc:external-open",
	})
	if err != nil {
		t.Fatalf("OpenExternalPrincipalSessionGRPC: %v", err)
	}
	if opened.GetExternalSessionId() != "ext-session-1" {
		t.Fatalf("external session id mismatch: %s", opened.GetExternalSessionId())
	}

	revoked, err := RevokeExternalPrincipalSessionGRPC(addr, 3*time.Second, &runtimev1.RevokeExternalPrincipalSessionRequest{
		ExternalSessionId: "ext-session-1",
	}, "nimi.desktop", &ClientMetadata{
		CallerID: "svc:external-revoke",
	})
	if err != nil {
		t.Fatalf("RevokeExternalPrincipalSessionGRPC: %v", err)
	}
	if !revoked.GetOk() {
		t.Fatalf("revoke external session not ok")
	}
}

func startTestRuntimeAuthServer(t *testing.T, service runtimev1.RuntimeAuthServiceServer) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := grpc.NewServer()
	runtimev1.RegisterRuntimeAuthServiceServer(server, service)
	go func() {
		_ = server.Serve(listener)
	}()
	return listener.Addr().String(), func() {
		server.Stop()
		_ = listener.Close()
	}
}

type testRuntimeAuthService struct {
	runtimev1.UnimplementedRuntimeAuthServiceServer

	mu sync.Mutex

	registerAppMD metadata.MD

	registerAppResponse      *runtimev1.RegisterAppResponse
	openSessionResponse      *runtimev1.OpenSessionResponse
	refreshSessionResponse   *runtimev1.RefreshSessionResponse
	revokeSessionResponse    *runtimev1.Ack
	registerExternalResponse *runtimev1.RegisterExternalPrincipalResponse
	openExternalResponse     *runtimev1.OpenExternalPrincipalSessionResponse
	revokeExternalResponse   *runtimev1.Ack
}

func (s *testRuntimeAuthService) RegisterApp(ctx context.Context, _ *runtimev1.RegisterAppRequest) (*runtimev1.RegisterAppResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.registerAppMD = cloneMetadata(ctx)
	if s.registerAppResponse != nil {
		return s.registerAppResponse, nil
	}
	return nil, errors.New("register app response not configured")
}

func (s *testRuntimeAuthService) OpenSession(context.Context, *runtimev1.OpenSessionRequest) (*runtimev1.OpenSessionResponse, error) {
	if s.openSessionResponse != nil {
		return s.openSessionResponse, nil
	}
	return nil, errors.New("open session response not configured")
}

func (s *testRuntimeAuthService) RefreshSession(context.Context, *runtimev1.RefreshSessionRequest) (*runtimev1.RefreshSessionResponse, error) {
	if s.refreshSessionResponse != nil {
		return s.refreshSessionResponse, nil
	}
	return nil, errors.New("refresh session response not configured")
}

func (s *testRuntimeAuthService) RevokeSession(context.Context, *runtimev1.RevokeSessionRequest) (*runtimev1.Ack, error) {
	if s.revokeSessionResponse != nil {
		return s.revokeSessionResponse, nil
	}
	return nil, errors.New("revoke session response not configured")
}

func (s *testRuntimeAuthService) RegisterExternalPrincipal(context.Context, *runtimev1.RegisterExternalPrincipalRequest) (*runtimev1.RegisterExternalPrincipalResponse, error) {
	if s.registerExternalResponse != nil {
		return s.registerExternalResponse, nil
	}
	return nil, errors.New("register external response not configured")
}

func (s *testRuntimeAuthService) OpenExternalPrincipalSession(context.Context, *runtimev1.OpenExternalPrincipalSessionRequest) (*runtimev1.OpenExternalPrincipalSessionResponse, error) {
	if s.openExternalResponse != nil {
		return s.openExternalResponse, nil
	}
	return nil, errors.New("open external response not configured")
}

func (s *testRuntimeAuthService) RevokeExternalPrincipalSession(context.Context, *runtimev1.RevokeExternalPrincipalSessionRequest) (*runtimev1.Ack, error) {
	if s.revokeExternalResponse != nil {
		return s.revokeExternalResponse, nil
	}
	return nil, errors.New("revoke external response not configured")
}

func (s *testRuntimeAuthService) lastRegisterAppMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.registerAppMD.Copy()
}
