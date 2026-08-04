package ai

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestGenerateLocalAppTextCandidateFailsClosedWithoutAmbientExecution(t *testing.T) {
	svc := &Service{}
	response, err := svc.GenerateLocalAppTextCandidate(
		localAppTextCandidateContext(),
		validLocalAppTextCandidateRequest(),
	)
	if response != nil {
		t.Fatalf("response = %+v, want nil", response)
	}
	assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
}

func TestGenerateLocalAppTextCandidatePreservesPermissionAndInputValidation(t *testing.T) {
	svc := &Service{}

	_, err := svc.GenerateLocalAppTextCandidate(context.Background(), validLocalAppTextCandidateRequest())
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)

	_, err = svc.GenerateLocalAppTextCandidate(localAppTextCandidateContext(), &runtimev1.GenerateLocalAppTextCandidateRequest{})
	assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
}

func localAppTextCandidateContext() context.Context {
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID:           "account-1",
		AppID:               "nimi.realm-persona-studio",
		LocalAppPrincipalID: "principal-1",
		LocalAppRecordID:    "record-1",
		Operation:           accountservice.LocalAppOperationTextCandidateGenerate,
		AuthorityClass:      localappop.AuthorityClassUserPermission,
		OperationCapability: "ai.text.generate",
	})
}

func validLocalAppTextCandidateRequest() *runtimev1.GenerateLocalAppTextCandidateRequest {
	return &runtimev1.GenerateLocalAppTextCandidateRequest{
		Messages: []*runtimev1.LocalAppTextCandidateMessage{{
			Role: "user",
			Text: "Create a persona.",
		}},
		Temperature: 0.7,
		TopP:        0.95,
		MaxTokens:   512,
	}
}

func assertLocalAppTextCandidateError(t *testing.T, err error, code codes.Code, reason runtimev1.ReasonCode) {
	t.Helper()
	if status.Code(err) != code {
		t.Fatalf("error code = %s, want %s: %v", status.Code(err), code, err)
	}
	got, ok := grpcerr.ExtractReasonCode(err)
	if !ok || got != reason {
		t.Fatalf("error reason = %s, %v; want %s: %v", got, ok, reason, err)
	}
}
