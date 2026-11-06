package connector

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"testing"
)

func TestBedrockInvocationBindingsAreExplicitOwnedAndCaptured(t *testing.T) {
	s, ctx := newTestService(t), userContext("user-1")
	created, err := s.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{Provider: "bedrock", Endpoint: "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1", ApiKey: "test-key"})
	if err != nil {
		t.Fatal(err)
	}
	id := created.Connector.ConnectorId
	if created.Connector.Endpoint != "https://bedrock-runtime.us-east-1.amazonaws.com" {
		t.Fatal(created.Connector.Endpoint)
	}
	const model = "anthropic.claude-sonnet-5-5"
	list := func() map[string]string {
		t.Helper()
		r, err := s.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{ConnectorId: id})
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]string{}
		for _, m := range r.Models {
			out[m.ProviderModelId] = m.RemoteModelCatalogId
		}
		return out
	}
	before := list()
	ref := RemoteModelCatalogRef{ConnectorID: id, Provider: "bedrock", ProviderModelID: model, RemoteModelCatalogID: before[model]}
	impl := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "bedrock", DriverId: "nimillm", DriverDialect: "bedrock"}
	if _, _, err := ValidateAIConfigCloudSelection(s.store, s.modelCatalogResolver(), "user-1", "text.generate", impl, ref); err == nil {
		t.Fatal("unconfigured target selected")
	}
	update := func(invocation string) (*runtimev1.UpdateConnectorResponse, error) {
		return s.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, BedrockInvocations: &runtimev1.ConnectorBedrockInvocations{Invocations: []*runtimev1.ConnectorBedrockInvocation{{ProviderModelId: model, InvocationModelId: invocation}}}})
	}
	for _, bad := range []string{"", "us.anthropic.claude-fable-5", "arn:aws:bedrock:us-east-1:123:inference-profile/example", "global." + model + " ", "xx." + model} {
		if _, err := update(bad); err == nil {
			t.Fatal("bad invocation admitted", bad)
		}
	}
	if _, err := update("us." + model); err != nil {
		t.Fatal(err)
	}
	after := list()
	if after[model] == before[model] || after["amazon.nova-micro-v1:0"] != before["amazon.nova-micro-v1:0"] {
		t.Fatal("wrong identity scope")
	}
	if _, _, err := ValidateAIConfigCloudSelection(s.store, s.modelCatalogResolver(), "user-1", "text.generate", impl, ref); err == nil {
		t.Fatal("stale selection admitted")
	}
	ref.RemoteModelCatalogID = after[model]
	if _, _, err := ValidateAIConfigCloudSelection(s.store, s.modelCatalogResolver(), "user-1", "text.generate", impl, ref); err != nil {
		t.Fatal(err)
	}
	captured, _, err := s.store.CaptureCredentialCustody(id, "bedrock-original")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := update("global." + model); err != nil {
		t.Fatal(err)
	}
	if BedrockInvocationForModel(captured.BedrockInvocations, model) != "us."+model {
		t.Fatal("captured work retargeted")
	}
	empty := &runtimev1.UpdateConnectorRequest{ConnectorId: id, BedrockInvocations: &runtimev1.ConnectorBedrockInvocations{}}
	if _, err := s.UpdateConnector(userContext("foreign"), empty); err == nil {
		t.Fatal("foreign owner changed binding")
	}
	cleared, err := s.UpdateConnector(ctx, empty)
	if err != nil || cleared.Connector.BedrockInvocations != nil {
		t.Fatal("explicit clear failed", err)
	}
}
