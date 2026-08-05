package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
)

func TestExecuteScenarioTextEmbedRouteDescribeUsesCloudEmbeddingAdmission(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "text-embedding-3-small", "https://example.com", Config{})
	transport := &routeDescribeTransportStream{}
	ctx := withCloudScenarioTestIntent(fixture.context, "text.embed", fixture.targetRef)
	ctx = grpc.NewContextWithServerTransportStream(ctx, transport)
	response, err := fixture.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: textEmbedRouteDescribeExtensionNamespace,
			Payload: testProbePayload(t, map[string]any{
				"version": "v1", "resolvedBindingRef": "binding-embed-001",
			}),
		}},
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextEmbed{TextEmbed: &runtimev1.TextEmbedScenarioSpec{
			Inputs: []string{"describe embedding route"},
		}}},
	})
	if err != nil {
		t.Fatalf("ExecuteScenario(text.embed route describe): %v", err)
	}
	if response.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD || response.GetModelResolved() != "text-embedding-3-small" {
		t.Fatalf("route description diagnostics = route %v model %q", response.GetRouteDecision(), response.GetModelResolved())
	}
	payload := decodeRouteDescribeHeader(t, transport.header)
	if payload["capability"] != "text.embed" || payload["resolvedBindingRef"] != "binding-embed-001" {
		t.Fatalf("route description payload = %#v", payload)
	}
	metadataPayload, ok := payload["metadata"].(map[string]any)
	if !ok || metadataPayload["supportsBatch"] != true || metadataPayload["maxInputsPerRequest"] != float64(16) || metadataPayload["dimensions"] != float64(1536) {
		t.Fatalf("embedding route metadata = %#v", payload["metadata"])
	}
}
