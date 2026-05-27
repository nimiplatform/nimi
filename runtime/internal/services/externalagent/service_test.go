package externalagent

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func newTestService() *Service {
	return New(slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func TestGatewayStatusFailsClosedUntilRuntimeActionRegistryExists(t *testing.T) {
	resp, err := newTestService().GetExternalAgentGatewayStatus(context.Background(), &runtimev1.ExternalAgentGatewayStatusRequest{})
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if resp.GetEnabled() {
		t.Fatalf("expected disabled gateway")
	}
	if resp.GetActionCount() != 0 {
		t.Fatalf("expected zero action count, got %d", resp.GetActionCount())
	}
	if resp.GetBindAddress() != "" {
		t.Fatalf("disabled gateway must not project a bind address, got %q", resp.GetBindAddress())
	}
	if resp.GetIssuer() != defaultIssuer {
		t.Fatalf("issuer mismatch: %q", resp.GetIssuer())
	}
	if resp.GetReasonCode() != disabledStatusReason {
		t.Fatalf("reason mismatch: %q", resp.GetReasonCode())
	}
}

func TestIssueTokenRejectsWhileActionRegistryEmpty(t *testing.T) {
	_, err := newTestService().IssueExternalAgentToken(context.Background(), &runtimev1.ExternalAgentIssueTokenRequest{
		PrincipalId:      "openclaw.local",
		Mode:             "delegated",
		SubjectAccountId: "account-1",
		Actions:          []string{"runtime.agent.turn.write"},
		TtlSeconds:       3600,
	})
	if err == nil {
		t.Fatal("expected issue to fail closed")
	}
	st, ok := status.FromError(err)
	if !ok || st.Code() != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition, got %v", err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_APP_GRANT_INVALID {
		t.Fatalf("reason mismatch: %v ok=%v", reason, ok)
	}
	metadata, ok := grpcerr.ExtractReasonMetadata(err)
	if !ok || metadata["action_hint"] != disabledStatusReason {
		t.Fatalf("metadata mismatch: %#v", metadata)
	}
}

func TestIssueTokenValidatesRequiredFields(t *testing.T) {
	_, err := newTestService().IssueExternalAgentToken(context.Background(), &runtimev1.ExternalAgentIssueTokenRequest{
		PrincipalId:      "openclaw.local",
		Mode:             "delegated",
		SubjectAccountId: "account-1",
		TtlSeconds:       3600,
	})
	if err == nil {
		t.Fatal("expected missing action scope to fail")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN {
		t.Fatalf("reason mismatch: %v ok=%v", reason, ok)
	}
}

func TestListAndRevokeUseRuntimeOwnedEmptyLedger(t *testing.T) {
	svc := newTestService()
	list, err := svc.ListExternalAgentTokens(context.Background(), &runtimev1.ExternalAgentListTokensRequest{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list.GetTokens()) != 0 {
		t.Fatalf("expected empty token ledger, got %#v", list.GetTokens())
	}

	missing, err := svc.RevokeExternalAgentToken(context.Background(), &runtimev1.ExternalAgentRevokeTokenRequest{})
	if err == nil {
		t.Fatal("expected missing token revoke to fail")
	}
	if missing != nil {
		t.Fatalf("expected no ack for missing token, got %#v", missing)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("missing revoke reason mismatch: %v ok=%v", reason, ok)
	}

	_, err = svc.RevokeExternalAgentToken(context.Background(), &runtimev1.ExternalAgentRevokeTokenRequest{TokenId: "token-1"})
	if err == nil {
		t.Fatal("expected revoke to fail closed while registry is empty")
	}
	st, ok := status.FromError(err)
	if !ok || st.Code() != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition, got %v", err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_APP_GRANT_INVALID {
		t.Fatalf("revoke reason mismatch: %v ok=%v", reason, ok)
	}
}
