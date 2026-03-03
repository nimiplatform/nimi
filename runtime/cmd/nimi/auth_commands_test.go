package main

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestRunRuntimeAuthRegisterAppJSON(t *testing.T) {
	service := &cmdTestRuntimeAuthService{
		registerAppResponse: &runtimev1.RegisterAppResponse{
			AppInstanceId: "instance-1",
			Accepted:      true,
			ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	addr, shutdown := startCmdTestRuntimeAuthServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeAuth([]string{
			"register-app",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--app-instance-id", "instance-1",
			"--capability", "ai.generate",
			"--capability", "workflow.submit",
			"--json",
			"--caller-id", "cli:auth-register",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAuth register-app: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal register-app output: %v output=%q", unmarshalErr, output)
	}
	if asString(payload["app_instance_id"]) != "instance-1" {
		t.Fatalf("app instance mismatch: %v", payload["app_instance_id"])
	}
	req := service.lastRegisterAppRequest()
	if len(req.GetCapabilities()) != 2 {
		t.Fatalf("capabilities mismatch: %v", req.GetCapabilities())
	}
	md := service.lastRegisterAppMetadata()
	if got := firstMD(md, "x-nimi-caller-id"); got != "cli:auth-register" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
}

func TestRunRuntimeAuthOpenAndRefreshSessionJSON(t *testing.T) {
	service := &cmdTestRuntimeAuthService{
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
	}
	addr, shutdown := startCmdTestRuntimeAuthServer(t, service)
	defer shutdown()

	openOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeAuth([]string{
			"open-session",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--app-instance-id", "instance-1",
			"--subject-user-id", "user-1",
			"--ttl-seconds", "1800",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAuth open-session: %v", err)
	}
	var openPayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(openOutput), &openPayload); unmarshalErr != nil {
		t.Fatalf("unmarshal open-session output: %v output=%q", unmarshalErr, openOutput)
	}
	if asString(openPayload["session_id"]) != "session-1" {
		t.Fatalf("session id mismatch: %v", openPayload["session_id"])
	}

	refreshOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeAuth([]string{
			"refresh-session",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--session-id", "session-1",
			"--ttl-seconds", "1200",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAuth refresh-session: %v", err)
	}
	var refreshPayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(refreshOutput), &refreshPayload); unmarshalErr != nil {
		t.Fatalf("unmarshal refresh-session output: %v output=%q", unmarshalErr, refreshOutput)
	}
	if asString(refreshPayload["session_token"]) != "token-2" {
		t.Fatalf("session token mismatch: %v", refreshPayload["session_token"])
	}
}

func TestRunRuntimeAuthRevokeSessionJSON(t *testing.T) {
	service := &cmdTestRuntimeAuthService{
		revokeSessionResponse: &runtimev1.Ack{
			Ok:         true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	addr, shutdown := startCmdTestRuntimeAuthServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeAuth([]string{
			"revoke-session",
			"--grpc-addr", addr,
			"--session-id", "session-1",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAuth revoke-session: %v", err)
	}
	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal revoke-session output: %v output=%q", unmarshalErr, output)
	}
	if !payload["ok"].(bool) {
		t.Fatalf("revoke ok mismatch: %#v", payload["ok"])
	}
}

func TestRunRuntimeAuthExternalSessionJSON(t *testing.T) {
	service := &cmdTestRuntimeAuthService{
		registerExternalResponse: &runtimev1.RegisterExternalPrincipalResponse{
			Accepted:   true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		openExternalResponse: &runtimev1.OpenExternalPrincipalSessionResponse{
			ExternalSessionId: "external-session-1",
			ExpiresAt:         timestamppb.Now(),
			SessionToken:      "external-token-1",
			ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		revokeExternalResponse: &runtimev1.Ack{
			Ok:         true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	addr, shutdown := startCmdTestRuntimeAuthServer(t, service)
	defer shutdown()

	registerOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeAuth([]string{
			"register-external",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--external-principal-id", "openclaw-agent",
			"--external-type", "agent",
			"--issuer", "local",
			"--client-id", "openclaw",
			"--signature-key-id", "key-1",
			"--proof-type", "jwt",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAuth register-external: %v", err)
	}
	var registerPayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(registerOutput), &registerPayload); unmarshalErr != nil {
		t.Fatalf("unmarshal register-external output: %v output=%q", unmarshalErr, registerOutput)
	}
	if !registerPayload["accepted"].(bool) {
		t.Fatalf("register accepted mismatch: %#v", registerPayload["accepted"])
	}

	openOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeAuth([]string{
			"open-external-session",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--external-principal-id", "openclaw-agent",
			"--proof", "proof-1",
			"--ttl-seconds", "1200",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAuth open-external-session: %v", err)
	}
	var openPayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(openOutput), &openPayload); unmarshalErr != nil {
		t.Fatalf("unmarshal open-external-session output: %v output=%q", unmarshalErr, openOutput)
	}
	if asString(openPayload["external_session_id"]) != "external-session-1" {
		t.Fatalf("external session id mismatch: %v", openPayload["external_session_id"])
	}

	revokeOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeAuth([]string{
			"revoke-external-session",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--external-session-id", "external-session-1",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAuth revoke-external-session: %v", err)
	}
	var revokePayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(revokeOutput), &revokePayload); unmarshalErr != nil {
		t.Fatalf("unmarshal revoke-external-session output: %v output=%q", unmarshalErr, revokeOutput)
	}
	if !revokePayload["ok"].(bool) {
		t.Fatalf("revoke external ok mismatch: %#v", revokePayload["ok"])
	}
}

func startCmdTestRuntimeAuthServer(t *testing.T, service runtimev1.RuntimeAuthServiceServer) (string, func()) {
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

type cmdTestRuntimeAuthService struct {
	runtimev1.UnimplementedRuntimeAuthServiceServer

	mu sync.Mutex

	registerAppMD  metadata.MD
	registerAppReq *runtimev1.RegisterAppRequest

	registerAppResponse      *runtimev1.RegisterAppResponse
	openSessionResponse      *runtimev1.OpenSessionResponse
	refreshSessionResponse   *runtimev1.RefreshSessionResponse
	revokeSessionResponse    *runtimev1.Ack
	registerExternalResponse *runtimev1.RegisterExternalPrincipalResponse
	openExternalResponse     *runtimev1.OpenExternalPrincipalSessionResponse
	revokeExternalResponse   *runtimev1.Ack
}

func (s *cmdTestRuntimeAuthService) RegisterApp(ctx context.Context, req *runtimev1.RegisterAppRequest) (*runtimev1.RegisterAppResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.registerAppMD = cloneIncomingMetadata(ctx)
	s.registerAppReq = req
	if s.registerAppResponse != nil {
		return s.registerAppResponse, nil
	}
	return nil, errors.New("register app response not configured")
}

func (s *cmdTestRuntimeAuthService) OpenSession(context.Context, *runtimev1.OpenSessionRequest) (*runtimev1.OpenSessionResponse, error) {
	if s.openSessionResponse != nil {
		return s.openSessionResponse, nil
	}
	return nil, errors.New("open session response not configured")
}

func (s *cmdTestRuntimeAuthService) RefreshSession(context.Context, *runtimev1.RefreshSessionRequest) (*runtimev1.RefreshSessionResponse, error) {
	if s.refreshSessionResponse != nil {
		return s.refreshSessionResponse, nil
	}
	return nil, errors.New("refresh session response not configured")
}

func (s *cmdTestRuntimeAuthService) RevokeSession(context.Context, *runtimev1.RevokeSessionRequest) (*runtimev1.Ack, error) {
	if s.revokeSessionResponse != nil {
		return s.revokeSessionResponse, nil
	}
	return nil, errors.New("revoke session response not configured")
}

func (s *cmdTestRuntimeAuthService) RegisterExternalPrincipal(context.Context, *runtimev1.RegisterExternalPrincipalRequest) (*runtimev1.RegisterExternalPrincipalResponse, error) {
	if s.registerExternalResponse != nil {
		return s.registerExternalResponse, nil
	}
	return nil, errors.New("register external response not configured")
}

func (s *cmdTestRuntimeAuthService) OpenExternalPrincipalSession(context.Context, *runtimev1.OpenExternalPrincipalSessionRequest) (*runtimev1.OpenExternalPrincipalSessionResponse, error) {
	if s.openExternalResponse != nil {
		return s.openExternalResponse, nil
	}
	return nil, errors.New("open external response not configured")
}

func (s *cmdTestRuntimeAuthService) RevokeExternalPrincipalSession(context.Context, *runtimev1.RevokeExternalPrincipalSessionRequest) (*runtimev1.Ack, error) {
	if s.revokeExternalResponse != nil {
		return s.revokeExternalResponse, nil
	}
	return nil, errors.New("revoke external response not configured")
}

func (s *cmdTestRuntimeAuthService) lastRegisterAppRequest() *runtimev1.RegisterAppRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.registerAppReq == nil {
		return &runtimev1.RegisterAppRequest{}
	}
	return s.registerAppReq
}

func (s *cmdTestRuntimeAuthService) lastRegisterAppMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.registerAppMD.Copy()
}
