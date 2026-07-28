package runtimeagent

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestDecodeCursorPreservesParseCauseWithoutLeakingToken(t *testing.T) {
	const token = "private-invalid-cursor"

	_, err := decodeCursor(token)
	if err == nil {
		t.Fatal("expected invalid cursor error")
	}
	var numErr *strconv.NumError
	if !errors.As(err, &numErr) {
		t.Fatalf("expected strconv.NumError cause, got %T", errors.Unwrap(err))
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("unexpected reason = %s, ok = %v", reason, ok)
	}
	if strings.Contains(status.Convert(err).Message(), token) {
		t.Fatalf("public status leaked cursor: %q", status.Convert(err).Message())
	}
}

func TestAuthorizeMemoryEmbeddingTargetPreservesAgentLookupCause(t *testing.T) {
	const localAgentRef = "private-missing-agent"
	svc := &Service{agents: map[string]*agentEntry{}}

	err := svc.AuthorizeMemoryEmbeddingTarget(
		context.Background(),
		&runtimev1.MemoryRequestContext{SubjectUserId: "owner-a"},
		&runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: localAgentRef},
			},
		},
	)
	if err == nil {
		t.Fatal("expected missing agent authorization error")
	}
	if got := status.Code(err); got != codes.PermissionDenied {
		t.Fatalf("outer code = %s, want PermissionDenied", got)
	}
	cause := errors.Unwrap(err)
	if cause == nil || status.Code(cause) != codes.NotFound {
		t.Fatalf("expected NotFound lookup cause, got %T: %v", cause, cause)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED {
		t.Fatalf("unexpected reason = %s, ok = %v", reason, ok)
	}
	if strings.Contains(status.Convert(err).Message(), localAgentRef) {
		t.Fatalf("public status leaked local agent ref: %q", status.Convert(err).Message())
	}
}
