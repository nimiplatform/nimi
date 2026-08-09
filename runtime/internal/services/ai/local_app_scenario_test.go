package ai

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

func localAppScenarioDecisionContext(operation accountservice.LocalAppOperation, capability string) context.Context {
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID:            "account-1",
		AppID:                "nimi.realm-persona-studio",
		RegisteredAppSubject: "principal-1",
		Operation:            operation,
		AuthorityClass:       localappop.AuthorityClassAppAccess,
		OperationCapability:  capability,
	})
}

func localAppScenarioExecuteContext() context.Context {
	return localAppScenarioDecisionContext(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute)
}

func validLocalAppEmbedExecuteRequest() *runtimev1.ExecuteLocalAppScenarioRequest {
	return &runtimev1.ExecuteLocalAppScenarioRequest{
		Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextEmbed{
			TextEmbed: &runtimev1.LocalAppTextEmbedScenarioSpec{Inputs: []string{"embed this"}},
		},
	}
}

func TestValidateLocalAppImageGenerateSpecPreservesBoundedParameters(t *testing.T) {
	got, err := validateLocalAppImageGenerateSpec(&runtimev1.LocalAppImageGenerateScenarioSpec{
		Prompt: "image", N: testInt32(0), Seed: testInt64(0),
		ReferenceImages: []string{"https://example.com/reference.png"},
		Mask:            "https://example.com/mask.png", ResponseFormat: "url",
	})
	if err != nil {
		t.Fatalf("validateLocalAppImageGenerateSpec: %v", err)
	}
	if got.N == nil || got.Seed == nil || len(got.GetReferenceImages()) != 1 ||
		got.GetMask() != "https://example.com/mask.png" || got.GetResponseFormat() != "url" {
		t.Fatalf("projected image spec = %+v", got)
	}
	if _, err := validateLocalAppImageGenerateSpec(&runtimev1.LocalAppImageGenerateScenarioSpec{
		Prompt: "image", ReferenceImages: []string{"http://insecure.example/reference.png"},
	}); err == nil {
		t.Fatal("insecure reference image was accepted")
	}
}

func TestExecuteLocalAppScenarioRequiresExactDecision(t *testing.T) {
	svc := &Service{}
	_, err := svc.ExecuteLocalAppScenario(context.Background(), validLocalAppEmbedExecuteRequest())
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)

	wrongOperation := localAppScenarioDecisionContext(accountservice.LocalAppOperationTextCandidateGenerate, localappop.AppOperationIDTextCandidateGenerate)
	_, err = svc.ExecuteLocalAppScenario(wrongOperation, validLocalAppEmbedExecuteRequest())
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
}

func TestExecuteLocalAppScenarioRejectsInvalidInput(t *testing.T) {
	svc := &Service{}
	invalid := []*runtimev1.ExecuteLocalAppScenarioRequest{
		{},
		{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextEmbed{TextEmbed: &runtimev1.LocalAppTextEmbedScenarioSpec{}}},
		{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextEmbed{TextEmbed: &runtimev1.LocalAppTextEmbedScenarioSpec{Inputs: []string{" padded "}}}},
		{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextEmbed{TextEmbed: &runtimev1.LocalAppTextEmbedScenarioSpec{Inputs: []string{strings.Repeat("x", maxLocalAppScenarioEmbedInputBytes+1)}}}},
		{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_ImageGenerate{ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{}}},
		{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_ImageGenerate{ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "image", N: testInt32(5)}}},
		{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_ImageGenerate{ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "image", Size: strings.Repeat("s", maxLocalAppScenarioOptionTextBytes+1)}}},
	}
	for index, request := range invalid {
		_, err := svc.ExecuteLocalAppScenario(localAppScenarioExecuteContext(), request)
		if err == nil {
			t.Fatalf("invalid request %d was accepted", index)
		}
	}
}

func TestExecuteLocalAppScenarioFailsClosedWithoutAIConfig(t *testing.T) {
	svc := newTestService(nil)
	response, err := svc.ExecuteLocalAppScenario(localAppScenarioExecuteContext(), validLocalAppEmbedExecuteRequest())
	if response != nil {
		t.Fatalf("response = %+v, want nil", response)
	}
	assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)
}

func TestExecuteLocalAppScenarioLocalEmbedFailsClosed(t *testing.T) {
	svc := newTestService(nil)
	if err := svc.aiConfigStore.Overwrite(context.Background(), "account-1", &runtimev1.AIConfig{
		Owner:        derivedAppAIConfigOwner("nimi.realm-persona-studio"),
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{localAppAIConfigIntent("text.embed")},
	}); err != nil {
		t.Fatalf("install App AIConfig: %v", err)
	}
	_, err := svc.ExecuteLocalAppScenario(localAppScenarioExecuteContext(), validLocalAppEmbedExecuteRequest())
	assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
}

func TestExecuteLocalAppScenarioCloudEmbedFailsClosedWithoutBinding(t *testing.T) {
	svc := newTestService(nil)
	if err := svc.aiConfigStore.Overwrite(context.Background(), "account-1",
		appAIConfig("nimi.realm-persona-studio", grantlessCloudAIConfigIntent(t, "text.embed"))); err != nil {
		t.Fatalf("install Cloud App AIConfig: %v", err)
	}
	// The request passes admission and clamps and enters owner AIConfig
	// composition; without a resolvable Cloud binding it fails closed.
	_, err := svc.ExecuteLocalAppScenario(localAppScenarioExecuteContext(), validLocalAppEmbedExecuteRequest())
	assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
}

func TestProjectLocalAppScenarioArtifactTrimsOwnerFields(t *testing.T) {
	projected, err := projectLocalAppScenarioArtifact(&runtimev1.ScenarioArtifact{
		ArtifactId: "artifact-1",
		MimeType:   "image/png",
		Bytes:      []byte("payload"),
		SizeBytes:  7,
		Sha256:     "sha256:abc",
		Uri:        "file:///runtime/private/path.png",
		Metadata:   nil,
	})
	if err != nil {
		t.Fatalf("project artifact: %v", err)
	}
	if projected.GetArtifactId() != "artifact-1" || projected.GetMimeType() != "image/png" ||
		len(projected.GetBytes()) != 0 || projected.GetSizeBytes() != 7 || projected.GetSha256() != "sha256:abc" {
		t.Fatalf("projected artifact = %+v", projected)
	}

	large, err := projectLocalAppScenarioArtifact(&runtimev1.ScenarioArtifact{
		ArtifactId: "artifact-1", MimeType: "image/png", Bytes: make([]byte, maxLocalAppInlineArtifactBytes+1),
		SizeBytes: maxLocalAppInlineArtifactBytes + 1,
	})
	if err != nil || large.GetSizeBytes() != maxLocalAppInlineArtifactBytes+1 || len(large.GetBytes()) != 0 {
		t.Fatalf("large metadata projection = %+v, error=%v", large, err)
	}
	if _, err := projectLocalAppScenarioArtifact(&runtimev1.ScenarioArtifact{MimeType: "image/png"}); err == nil {
		t.Fatal("artifact without id or bytes passed projection")
	}
	if _, err := projectLocalAppScenarioArtifact(&runtimev1.ScenarioArtifact{ArtifactId: " padded ", MimeType: "image/png"}); err == nil {
		t.Fatal("padded artifact id passed projection")
	}
}
