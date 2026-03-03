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

func TestAuthorizeValidateRevokeAppAccessTokenGRPC(t *testing.T) {
	service := &testRuntimeGrantService{
		authorizeResponse: &runtimev1.AuthorizeExternalPrincipalResponse{
			TokenId:             "token-1",
			AppId:               "nimi.desktop",
			SubjectUserId:       "user-1",
			ExternalPrincipalId: "openclaw-agent",
			EffectiveScopes:     []string{"read:*", "write:*"},
			PolicyVersion:       "v1",
			ExpiresAt:           timestamppb.Now(),
			Secret:              "secret-1",
		},
		validateResponse: &runtimev1.ValidateAppAccessTokenResponse{
			Valid:           true,
			ReasonCode:      runtimev1.ReasonCode_ACTION_EXECUTED,
			EffectiveScopes: []string{"read:*"},
			PolicyVersion:   "v1",
		},
		revokeResponse: &runtimev1.Ack{
			Ok:         true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	addr, shutdown := startTestRuntimeGrantServer(t, service)
	defer shutdown()

	authorized, err := AuthorizeExternalPrincipalGRPC(addr, 3*time.Second, &runtimev1.AuthorizeExternalPrincipalRequest{
		AppId:                 "nimi.desktop",
		ExternalPrincipalId:   "openclaw-agent",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		SubjectUserId:         "user-1",
		PolicyMode:            runtimev1.PolicyMode_POLICY_MODE_PRESET,
		Preset:                runtimev1.AuthorizationPreset_AUTHORIZATION_PRESET_FULL,
		TtlSeconds:            3600,
	}, &ClientMetadata{
		CallerID: "svc:grant-authorize",
		TraceID:  "trace-grant-authorize",
	})
	if err != nil {
		t.Fatalf("AuthorizeExternalPrincipalGRPC: %v", err)
	}
	if authorized.GetTokenId() != "token-1" {
		t.Fatalf("token id mismatch: %s", authorized.GetTokenId())
	}

	validated, err := ValidateAppAccessTokenGRPC(addr, 3*time.Second, &runtimev1.ValidateAppAccessTokenRequest{
		AppId:           "nimi.desktop",
		TokenId:         "token-1",
		RequestedScopes: []string{"read:chat"},
	}, &ClientMetadata{
		CallerID: "svc:grant-validate",
	})
	if err != nil {
		t.Fatalf("ValidateAppAccessTokenGRPC: %v", err)
	}
	if !validated.GetValid() {
		t.Fatalf("expected valid token")
	}

	revoked, err := RevokeAppAccessTokenGRPC(addr, 3*time.Second, &runtimev1.RevokeAppAccessTokenRequest{
		AppId:   "nimi.desktop",
		TokenId: "token-1",
	}, &ClientMetadata{
		CallerID: "svc:grant-revoke",
	})
	if err != nil {
		t.Fatalf("RevokeAppAccessTokenGRPC: %v", err)
	}
	if !revoked.GetOk() {
		t.Fatalf("revoke response not ok")
	}

	md := service.lastAuthorizeMetadata()
	if got := firstMetadataValue(md, "x-nimi-caller-id"); got != "svc:grant-authorize" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
	if got := firstMetadataValue(md, "x-nimi-app-id"); got != "nimi.desktop" {
		t.Fatalf("app-id mismatch: %q", got)
	}
}

func TestIssueDelegatedAndListTokenChainGRPC(t *testing.T) {
	service := &testRuntimeGrantService{
		issueResponse: &runtimev1.IssueDelegatedAccessTokenResponse{
			TokenId:         "child-token-1",
			ParentTokenId:   "root-token-1",
			EffectiveScopes: []string{"read:chat"},
			ExpiresAt:       timestamppb.Now(),
			Secret:          "child-secret",
		},
		listResponse: &runtimev1.ListTokenChainResponse{
			Entries: []*runtimev1.TokenChainEntry{
				{
					TokenId:       "root-token-1",
					ParentTokenId: "",
					IssuedAt:      timestamppb.Now(),
					ExpiresAt:     timestamppb.Now(),
				},
				{
					TokenId:       "child-token-1",
					ParentTokenId: "root-token-1",
					IssuedAt:      timestamppb.Now(),
					ExpiresAt:     timestamppb.Now(),
				},
			},
		},
	}
	addr, shutdown := startTestRuntimeGrantServer(t, service)
	defer shutdown()

	issued, err := IssueDelegatedAccessTokenGRPC(addr, 3*time.Second, &runtimev1.IssueDelegatedAccessTokenRequest{
		AppId:         "nimi.desktop",
		ParentTokenId: "root-token-1",
		Scopes:        []string{"read:chat"},
		TtlSeconds:    1200,
	}, &ClientMetadata{
		CallerID: "svc:grant-delegate",
	})
	if err != nil {
		t.Fatalf("IssueDelegatedAccessTokenGRPC: %v", err)
	}
	if issued.GetTokenId() != "child-token-1" {
		t.Fatalf("child token id mismatch: %s", issued.GetTokenId())
	}

	chain, err := ListTokenChainGRPC(addr, 3*time.Second, &runtimev1.ListTokenChainRequest{
		AppId:       "nimi.desktop",
		RootTokenId: "root-token-1",
	}, &ClientMetadata{
		CallerID: "svc:grant-chain",
	})
	if err != nil {
		t.Fatalf("ListTokenChainGRPC: %v", err)
	}
	if len(chain.GetEntries()) != 2 {
		t.Fatalf("token chain size mismatch: %d", len(chain.GetEntries()))
	}
}

func startTestRuntimeGrantServer(t *testing.T, service runtimev1.RuntimeGrantServiceServer) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := grpc.NewServer()
	runtimev1.RegisterRuntimeGrantServiceServer(server, service)
	go func() {
		_ = server.Serve(listener)
	}()
	return listener.Addr().String(), func() {
		server.Stop()
		_ = listener.Close()
	}
}

type testRuntimeGrantService struct {
	runtimev1.UnimplementedRuntimeGrantServiceServer

	mu sync.Mutex

	authorizeMD metadata.MD

	authorizeResponse *runtimev1.AuthorizeExternalPrincipalResponse
	validateResponse  *runtimev1.ValidateAppAccessTokenResponse
	revokeResponse    *runtimev1.Ack
	issueResponse     *runtimev1.IssueDelegatedAccessTokenResponse
	listResponse      *runtimev1.ListTokenChainResponse
}

func (s *testRuntimeGrantService) AuthorizeExternalPrincipal(ctx context.Context, _ *runtimev1.AuthorizeExternalPrincipalRequest) (*runtimev1.AuthorizeExternalPrincipalResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.authorizeMD = cloneMetadata(ctx)
	if s.authorizeResponse != nil {
		return s.authorizeResponse, nil
	}
	return nil, errors.New("authorize response not configured")
}

func (s *testRuntimeGrantService) ValidateAppAccessToken(context.Context, *runtimev1.ValidateAppAccessTokenRequest) (*runtimev1.ValidateAppAccessTokenResponse, error) {
	if s.validateResponse != nil {
		return s.validateResponse, nil
	}
	return nil, errors.New("validate response not configured")
}

func (s *testRuntimeGrantService) RevokeAppAccessToken(context.Context, *runtimev1.RevokeAppAccessTokenRequest) (*runtimev1.Ack, error) {
	if s.revokeResponse != nil {
		return s.revokeResponse, nil
	}
	return nil, errors.New("revoke response not configured")
}

func (s *testRuntimeGrantService) IssueDelegatedAccessToken(context.Context, *runtimev1.IssueDelegatedAccessTokenRequest) (*runtimev1.IssueDelegatedAccessTokenResponse, error) {
	if s.issueResponse != nil {
		return s.issueResponse, nil
	}
	return nil, errors.New("issue response not configured")
}

func (s *testRuntimeGrantService) ListTokenChain(context.Context, *runtimev1.ListTokenChainRequest) (*runtimev1.ListTokenChainResponse, error) {
	if s.listResponse != nil {
		return s.listResponse, nil
	}
	return nil, errors.New("list response not configured")
}

func (s *testRuntimeGrantService) lastAuthorizeMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.authorizeMD.Copy()
}
