package main

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestRunRuntimeAppAuthAuthorizeJSON(t *testing.T) {
	service := &cmdTestRuntimeAppAuthService{
		authorizeResponse: &runtimev1.AuthorizeExternalPrincipalResponse{
			TokenId:                   "token-1",
			AppId:                     "nimi.desktop",
			SubjectUserId:             "user-1",
			ExternalPrincipalId:       "openclaw-agent",
			EffectiveScopes:           []string{"read:*", "write:*"},
			PolicyVersion:             "v1",
			IssuedScopeCatalogVersion: "sdk-v1",
			CanDelegate:               true,
			ExpiresAt:                 timestamppb.Now(),
			Secret:                    "secret-1",
		},
	}
	addr, shutdown := startCmdTestRuntimeAppAuthServer(t, service)
	defer shutdown()

	selectorsFile := writeResourceSelectorsFile(t, `{
	  "conversationIds": ["c1"],
	  "messageIds": ["m1"],
	  "documentIds": ["d1"],
	  "labels": {"env": "test"}
	}`)

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeAppAuth([]string{
			"authorize",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--external-principal-id", "openclaw-agent",
			"--external-type", "agent",
			"--subject-user-id", "user-1",
			"--policy-mode", "preset",
			"--preset", "full",
			"--scope", "read:chat",
			"--resource-selectors-file", selectorsFile,
			"--can-delegate",
			"--max-delegation-depth", "1",
			"--json",
			"--caller-id", "cli:app-auth-authorize",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAppAuth authorize: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal authorize output: %v output=%q", unmarshalErr, output)
	}
	if asString(payload["token_id"]) != "token-1" {
		t.Fatalf("token id mismatch: %v", payload["token_id"])
	}
	req := service.lastAuthorizeRequest()
	if got := req.GetDomain(); got != "app-auth" {
		t.Fatalf("domain mismatch: %q", got)
	}
	if req.GetExternalPrincipalType() != runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT {
		t.Fatalf("external type mismatch: %v", req.GetExternalPrincipalType())
	}
	if req.GetResourceSelectors().GetLabels()["env"] != "test" {
		t.Fatalf("resource selectors label mismatch")
	}
	md := service.lastAuthorizeMetadata()
	if got := firstMD(md, "x-nimi-caller-id"); got != "cli:app-auth-authorize" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
}

func TestRunRuntimeAppAuthValidateJSON(t *testing.T) {
	service := &cmdTestRuntimeAppAuthService{
		validateResponse: &runtimev1.ValidateAppAccessTokenResponse{
			Valid:                     true,
			ReasonCode:                runtimev1.ReasonCode_ACTION_EXECUTED,
			EffectiveScopes:           []string{"read:chat"},
			PolicyVersion:             "v1",
			IssuedScopeCatalogVersion: "sdk-v1",
		},
	}
	addr, shutdown := startCmdTestRuntimeAppAuthServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeAppAuth([]string{
			"validate",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--token-id", "token-1",
			"--requested-scope", "read:chat",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAppAuth validate: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal validate output: %v output=%q", unmarshalErr, output)
	}
	if !payload["valid"].(bool) {
		t.Fatalf("validate result mismatch: %#v", payload["valid"])
	}
}

func TestRunRuntimeAppAuthRevokeJSON(t *testing.T) {
	service := &cmdTestRuntimeAppAuthService{
		revokeResponse: &runtimev1.Ack{
			Ok:         true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	addr, shutdown := startCmdTestRuntimeAppAuthServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeAppAuth([]string{
			"revoke",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--token-id", "token-1",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAppAuth revoke: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal revoke output: %v output=%q", unmarshalErr, output)
	}
	if !payload["ok"].(bool) {
		t.Fatalf("revoke ok mismatch: %#v", payload["ok"])
	}
}

func TestRunRuntimeAppAuthDelegateAndChainJSON(t *testing.T) {
	service := &cmdTestRuntimeAppAuthService{
		delegateResponse: &runtimev1.IssueDelegatedAccessTokenResponse{
			TokenId:         "child-token-1",
			ParentTokenId:   "root-token-1",
			EffectiveScopes: []string{"read:chat"},
			ExpiresAt:       timestamppb.Now(),
			Secret:          "secret-child",
		},
		chainResponse: &runtimev1.ListTokenChainResponse{
			Nodes: []*runtimev1.TokenChainNode{
				{
					TokenId:                   "root-token-1",
					PolicyVersion:             "v1",
					IssuedScopeCatalogVersion: "sdk-v1",
					IssuedAt:                  timestamppb.Now(),
					ExpiresAt:                 timestamppb.Now(),
				},
				{
					TokenId:                   "child-token-1",
					ParentTokenId:             "root-token-1",
					PolicyVersion:             "v1",
					IssuedScopeCatalogVersion: "sdk-v1",
					IssuedAt:                  timestamppb.Now(),
					ExpiresAt:                 timestamppb.Now(),
				},
			},
		},
	}
	addr, shutdown := startCmdTestRuntimeAppAuthServer(t, service)
	defer shutdown()

	delegateOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeAppAuth([]string{
			"delegate",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--parent-token-id", "root-token-1",
			"--scope", "read:chat",
			"--ttl-seconds", "1200",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAppAuth delegate: %v", err)
	}
	var delegatePayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(delegateOutput), &delegatePayload); unmarshalErr != nil {
		t.Fatalf("unmarshal delegate output: %v output=%q", unmarshalErr, delegateOutput)
	}
	if asString(delegatePayload["token_id"]) != "child-token-1" {
		t.Fatalf("delegate token id mismatch: %v", delegatePayload["token_id"])
	}

	chainOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeAppAuth([]string{
			"chain",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--root-token-id", "root-token-1",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAppAuth chain: %v", err)
	}
	var chainPayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(chainOutput), &chainPayload); unmarshalErr != nil {
		t.Fatalf("unmarshal chain output: %v output=%q", unmarshalErr, chainOutput)
	}
	nodes, ok := chainPayload["nodes"].([]any)
	if !ok || len(nodes) != 2 {
		t.Fatalf("chain nodes mismatch: %#v", chainPayload["nodes"])
	}
}

func startCmdTestRuntimeAppAuthServer(t *testing.T, service runtimev1.RuntimeGrantServiceServer) (string, func()) {
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

type cmdTestRuntimeAppAuthService struct {
	runtimev1.UnimplementedRuntimeGrantServiceServer

	mu sync.Mutex

	authorizeMD  metadata.MD
	authorizeReq *runtimev1.AuthorizeExternalPrincipalRequest

	authorizeResponse *runtimev1.AuthorizeExternalPrincipalResponse
	validateResponse  *runtimev1.ValidateAppAccessTokenResponse
	revokeResponse    *runtimev1.Ack
	delegateResponse  *runtimev1.IssueDelegatedAccessTokenResponse
	chainResponse     *runtimev1.ListTokenChainResponse
}

func (s *cmdTestRuntimeAppAuthService) AuthorizeExternalPrincipal(ctx context.Context, req *runtimev1.AuthorizeExternalPrincipalRequest) (*runtimev1.AuthorizeExternalPrincipalResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.authorizeMD = cloneIncomingMetadata(ctx)
	s.authorizeReq = req
	if s.authorizeResponse != nil {
		return s.authorizeResponse, nil
	}
	return nil, errors.New("authorize response not configured")
}

func (s *cmdTestRuntimeAppAuthService) ValidateAppAccessToken(context.Context, *runtimev1.ValidateAppAccessTokenRequest) (*runtimev1.ValidateAppAccessTokenResponse, error) {
	if s.validateResponse != nil {
		return s.validateResponse, nil
	}
	return nil, errors.New("validate response not configured")
}

func (s *cmdTestRuntimeAppAuthService) RevokeAppAccessToken(context.Context, *runtimev1.RevokeAppAccessTokenRequest) (*runtimev1.Ack, error) {
	if s.revokeResponse != nil {
		return s.revokeResponse, nil
	}
	return nil, errors.New("revoke response not configured")
}

func (s *cmdTestRuntimeAppAuthService) IssueDelegatedAccessToken(context.Context, *runtimev1.IssueDelegatedAccessTokenRequest) (*runtimev1.IssueDelegatedAccessTokenResponse, error) {
	if s.delegateResponse != nil {
		return s.delegateResponse, nil
	}
	return nil, errors.New("delegate response not configured")
}

func (s *cmdTestRuntimeAppAuthService) ListTokenChain(context.Context, *runtimev1.ListTokenChainRequest) (*runtimev1.ListTokenChainResponse, error) {
	if s.chainResponse != nil {
		return s.chainResponse, nil
	}
	return nil, errors.New("chain response not configured")
}

func (s *cmdTestRuntimeAppAuthService) lastAuthorizeMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.authorizeMD.Copy()
}

func (s *cmdTestRuntimeAppAuthService) lastAuthorizeRequest() *runtimev1.AuthorizeExternalPrincipalRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.authorizeReq == nil {
		return &runtimev1.AuthorizeExternalPrincipalRequest{}
	}
	return s.authorizeReq
}

func writeResourceSelectorsFile(t *testing.T, content string) string {
	t.Helper()
	file, err := os.CreateTemp(t.TempDir(), "resource-selectors-*.json")
	if err != nil {
		t.Fatalf("create resource selectors file: %v", err)
	}
	if _, err := file.WriteString(content); err != nil {
		t.Fatalf("write resource selectors file: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close resource selectors file: %v", err)
	}
	return file.Name()
}
