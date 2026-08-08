package ai

import (
	"context"
	"encoding/json"
	"math"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
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
	host := &localTextHostStub{}
	svc.SetLocalTextExecutionHost(host)
	response, err := svc.GenerateLocalAppTextCandidate(localAppTextCandidateContext(), validLocalAppTextCandidateRequest())
	if err != nil {
		t.Fatalf("GenerateLocalAppTextCandidate: %v", err)
	}
	if response.GetText() != "captured response" || response.GetFinishReason() != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("response = %+v", response)
	}
	host.mu.Lock()
	body := append([]byte(nil), host.capturedBody...)
	host.mu.Unlock()
	var mapped map[string]any
	if err := json.Unmarshal(body, &mapped); err != nil {
		t.Fatalf("decode projected request: %v", err)
	}
	if mapped["top_k"] != float64(17) || mapped["presence_penalty"] != 0.5 || mapped["frequency_penalty"] != -0.25 ||
		mapped["seed"] != float64(-7) || len(mapped["stop"].([]any)) != 2 {
		t.Fatalf("extended LocalApp sampling fields were not projected: %s", body)
	}
}

func TestGenerateLocalAppTextCandidateCloudWithoutBindingIsSelectionRequiredAndDoesNotMutateRoute(t *testing.T) {
	svc := newTestService(nil)
	intent := grantlessCloudAIConfigIntent(t, "text.generate")
	config := appAIConfig("nimi.realm-persona-studio", intent)
	if err := svc.aiConfigStore.Overwrite(context.Background(), "account-1", config); err != nil {
		t.Fatalf("install Cloud App AIConfig: %v", err)
	}
	response, err := svc.GenerateLocalAppTextCandidate(localAppTextCandidateContext(), validLocalAppTextCandidateRequest())
	if response != nil {
		t.Fatalf("selection-required response = %+v, want nil", response)
	}
	assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_GRANT_SELECTION_REQUIRED)
	stored, found, readErr := svc.aiConfigStore.Get(context.Background(), "account-1", appAIConfigOwner("nimi.realm-persona-studio"))
	if readErr != nil || !found || stored.GetCapabilities()[0].GetCloud() == nil ||
		stored.GetCapabilities()[0].GetCloud().GetConnectorGrantId() != "" {
		t.Fatalf("selection failure changed committed route = (%+v, %v, %v)", stored, found, readErr)
	}
}

func TestGenerateLocalAppTextCandidateRejectsMalformedOwnerOutput(t *testing.T) {
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
	svc.SetLocalTextExecutionHost(&localTextHostStub{result: localexecution.TextResult{
		Text: "", FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
	}})
	response, err := svc.GenerateLocalAppTextCandidate(localAppTextCandidateContext(), validLocalAppTextCandidateRequest())
	if response != nil {
		t.Fatalf("malformed owner response = %+v, want nil", response)
	}
	assertLocalAppTextCandidateError(t, err, codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}

func TestGenerateLocalAppTextCandidatePreservesPermissionAndInputValidation(t *testing.T) {
	svc := &Service{}

	_, err := svc.GenerateLocalAppTextCandidate(context.Background(), validLocalAppTextCandidateRequest())
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)

	invalid := []struct {
		request *runtimev1.GenerateLocalAppTextCandidateRequest
		reason  runtimev1.ReasonCode
	}{
		{request: &runtimev1.GenerateLocalAppTextCandidateRequest{}, reason: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID},
		{request: &runtimev1.GenerateLocalAppTextCandidateRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "assistant", Text: "not admitted"}}, Temperature: testFloat32(0), TopP: testFloat32(1), MaxTokens: testInt32(1)}, reason: runtimev1.ReasonCode_AI_INPUT_INVALID},
		{request: &runtimev1.GenerateLocalAppTextCandidateRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "user"}, {Role: "system", Text: "late"}}, Temperature: testFloat32(0), TopP: testFloat32(1), MaxTokens: testInt32(1)}, reason: runtimev1.ReasonCode_AI_INPUT_INVALID},
		{request: &runtimev1.GenerateLocalAppTextCandidateRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: " user "}}, Temperature: testFloat32(0), TopP: testFloat32(1), MaxTokens: testInt32(1)}, reason: runtimev1.ReasonCode_AI_INPUT_INVALID},
		{request: &runtimev1.GenerateLocalAppTextCandidateRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "user"}}, Temperature: testFloat32(float32(math.NaN())), TopP: testFloat32(1), MaxTokens: testInt32(1)}, reason: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID},
		{request: &runtimev1.GenerateLocalAppTextCandidateRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "user"}}, Temperature: testFloat32(0), TopP: testFloat32(1), MaxTokens: testInt32(maxLocalAppTextCandidateTokens + 1)}, reason: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID},
		{request: &runtimev1.GenerateLocalAppTextCandidateRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "user"}}, TopK: testInt32(-1)}, reason: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID},
		{request: &runtimev1.GenerateLocalAppTextCandidateRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "user"}}, PresencePenalty: testFloat32(2.1)}, reason: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID},
		{request: &runtimev1.GenerateLocalAppTextCandidateRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "user"}}, Stop: []string{" "}}, reason: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID},
	}
	for _, test := range invalid {
		_, err = svc.GenerateLocalAppTextCandidate(localAppTextCandidateContext(), test.request)
		assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, test.reason)
	}
}

func localAppTextCandidateContext() context.Context {
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID:            "account-1",
		AppID:                "nimi.realm-persona-studio",
		RegisteredAppSubject: "principal-1",
		Operation:            accountservice.LocalAppOperationTextCandidateGenerate,
		AuthorityClass:       localappop.AuthorityClassAppAccess,
		OperationCapability:  localappop.AppOperationIDTextCandidateGenerate,
	})
}

func validLocalAppTextCandidateRequest() *runtimev1.GenerateLocalAppTextCandidateRequest {
	return &runtimev1.GenerateLocalAppTextCandidateRequest{
		Messages: []*runtimev1.LocalAppTextCandidateMessage{{
			Role: "user",
			Text: "Create a persona.",
		}},
		Temperature:      testFloat32(0.7),
		TopP:             testFloat32(0.95),
		MaxTokens:        testInt32(512),
		TopK:             testInt32(17),
		PresencePenalty:  testFloat32(0.5),
		FrequencyPenalty: testFloat32(-0.25),
		Stop:             []string{"END", "DONE"},
		Seed:             testInt64(-7),
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
