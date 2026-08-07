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
	svc := newTestService(nil)
	response, err := svc.GenerateLocalAppTextCandidate(
		localAppTextCandidateContext(),
		validLocalAppTextCandidateRequest(),
	)
	if response != nil {
		t.Fatalf("response = %+v, want nil", response)
	}
	assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)
}

func TestGenerateLocalAppTextCandidateUsesAppIntentAndMachineSelection(t *testing.T) {
	svc := newTestService(nil)
	if err := svc.aiConfigStore.Overwrite(context.Background(), "account-1", &runtimev1.AIConfig{
		Owner: derivedAppAIConfigOwner("nimi.realm-persona-studio"),
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{{
			CapabilityContract: "text.generate",
			Route:              &runtimev1.AIConfigCapabilityIntent_Local{Local: &runtimev1.AIConfigLocalIntent{}},
		}},
	}); err != nil {
		t.Fatalf("install App AIConfig: %v", err)
	}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "config-app", "app.gguf")})
	svc.SetLocalTextExecutionHost(&localTextHostStub{})
	response, err := svc.GenerateLocalAppTextCandidate(localAppTextCandidateContext(), validLocalAppTextCandidateRequest())
	if err != nil {
		t.Fatalf("GenerateLocalAppTextCandidate: %v", err)
	}
	if response.GetText() != "captured response" || response.GetFinishReason() != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("response = %+v", response)
	}
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
		AccountID:            "account-1",
		AppID:                "nimi.realm-persona-studio",
		RegisteredAppSubject: "principal-1",
		Operation:            accountservice.LocalAppOperationTextCandidateGenerate,
		AuthorityClass:       localappop.AuthorityClassAppAccess,
		OperationCapability:  "ai.text.generate",
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
