package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestBuildLocalAppTextCandidateScenarioRequestCarriesRuntimeDerivedTarget(t *testing.T) {
	localTarget := &runtimev1.RuntimeDurableLocalTargetRef{
		Version: "v2",
		Ref: &runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef{
			ReadinessRef: "local_asset_readiness:v2:fixture",
		},
	}
	input := &runtimev1.GenerateLocalAppTextCandidateRequest{
		Temperature: 0.7,
		TopP:        0.95,
		MaxTokens:   512,
	}
	messages := []*runtimev1.ChatMessage{{Role: "user", Content: "Create a persona."}}

	request := buildLocalAppTextCandidateScenarioRequest(
		accountservice.LocalAppCallerDecision{AppID: "nimi.realm-persona-studio", AccountID: "account-1"},
		" nimi/alpha-model ",
		localTarget,
		"Return JSON.",
		messages,
		input,
	)

	head := request.GetHead()
	if head.GetAppId() != "nimi.realm-persona-studio" || head.GetSubjectUserId() != "account-1" {
		t.Fatalf("caller projection mismatch: %#v", head)
	}
	if head.GetModelId() != "nimi/alpha-model" || head.GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL ||
		head.GetFallback() != runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY {
		t.Fatalf("managed route projection mismatch: %#v", head)
	}
	if got := head.GetTargetRef().GetLocalRuntime(); got == nil || got.GetReadinessRef() != localTarget.GetReadinessRef() {
		t.Fatalf("Runtime-derived target missing from Scenario head: %#v", head.GetTargetRef())
	}
	if request.GetSpec().GetTextGenerate().GetInput()[0].GetContent() != "Create a persona." ||
		request.GetSpec().GetTextGenerate().GetSystemPrompt() != "Return JSON." {
		t.Fatalf("text candidate spec mismatch: %#v", request.GetSpec().GetTextGenerate())
	}
}
