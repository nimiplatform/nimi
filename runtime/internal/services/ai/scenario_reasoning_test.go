package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestLegacyLocalProviderDoesNotInferReasoningSupport(t *testing.T) {
	capability := reasoningCapabilityForRequest(
		"runtime-agent-live-e2e",
		nil,
		newStaticProvider(runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL),
	)
	if capability.SupportsModeToggle || capability.SupportsSeparateText || capability.SupportsStreaming || capability.SupportsBudget {
		t.Fatalf("legacy local provider inferred reasoning capability: %#v", capability)
	}
}
