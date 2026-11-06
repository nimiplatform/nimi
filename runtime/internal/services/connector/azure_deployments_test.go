package connector

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestAzureDeploymentBindingsAreOwnedAtomicAndModelScoped(t *testing.T) {
	s := newTestService(t)
	ctx := userContext("user-1")
	created, err := s.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{Provider: "azure", Endpoint: "https://tenant.example", ApiKey: "original-key"})
	if err != nil {
		t.Fatal(err)
	}
	id := created.Connector.ConnectorId
	if created.Connector.Endpoint != "https://tenant.example/openai/v1" {
		t.Fatal("resource endpoint not normalized")
	}
	models := func() map[string]string {
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
	before := models()
	if before["gpt-6.1-sol"] == "" {
		t.Fatal("current Azure model absent")
	}
	impl := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "azure", DriverId: "nimillm", DriverDialect: "azure"}
	ref := RemoteModelCatalogRef{ConnectorID: id, Provider: "azure", ProviderModelID: "gpt-6.1-sol", RemoteModelCatalogID: before["gpt-6.1-sol"]}
	if _, _, err := ValidateAIConfigCloudSelection(s.store, s.modelCatalogResolver(), "user-1", "text.generate", impl, ref); err == nil {
		t.Fatal("unconfigured deployment selectable")
	}
	bind := func(model, name string) *runtimev1.ConnectorAzureDeployment {
		return &runtimev1.ConnectorAzureDeployment{ProviderModelId: model, DeploymentName: name}
	}
	update := func(entries ...*runtimev1.ConnectorAzureDeployment) (*runtimev1.UpdateConnectorResponse, error) {
		return s.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, AzureDeployments: &runtimev1.ConnectorAzureDeployments{Deployments: entries}})
	}
	for _, entries := range [][]*runtimev1.ConnectorAzureDeployment{
		{bind("unknown", "deployment")}, {bind("gpt-6.1-sol", "")}, {bind("gpt-6.1-sol", " x")}, {bind("gpt-6.1-sol", "x\n")}, {bind("gpt-6.1-sol", strings.Repeat("x", 257))},
		{bind("gpt-6.1-sol", "one"), bind("gpt-6.1-sol", "two")}, {bind("gpt-6.1-sol", "same"), bind("gpt-6.1-terra", "same")},
	} {
		if _, err := update(entries...); err == nil {
			t.Fatal("invalid binding accepted")
		}
	}
	first, err := update(bind("gpt-6.1-sol", "writing-prod"))
	if err != nil {
		t.Fatal(err)
	}
	if first.Connector.GetAzureDeployments().GetDeployments()[0].GetDeploymentName() != "writing-prod" {
		t.Fatal("binding not projected")
	}
	after := models()
	if after["gpt-6.1-sol"] == before["gpt-6.1-sol"] || after["gpt-6.1-terra"] != before["gpt-6.1-terra"] {
		t.Fatal("deployment change affected wrong catalog identities")
	}
	if _, _, err := ValidateAIConfigCloudSelection(s.store, s.modelCatalogResolver(), "user-1", "text.generate", impl, ref); err == nil {
		t.Fatal("old selection silently retargeted")
	}
	ref.RemoteModelCatalogID = after["gpt-6.1-sol"]
	if _, _, err := ValidateAIConfigCloudSelection(s.store, s.modelCatalogResolver(), "user-1", "text.generate", impl, ref); err != nil {
		t.Fatal(err)
	}
	captured, custody, err := s.store.CaptureCredentialCustody(id, "azure-original-job")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := update(bind("gpt-6.1-sol", "writing-prod"), bind("gpt-6.1-terra", "vision-prod")); err != nil {
		t.Fatal(err)
	}
	if models()["gpt-6.1-sol"] != after["gpt-6.1-sol"] {
		t.Fatal("unrelated binding invalidated selection")
	}
	if _, err := s.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, ApiKey: proto.String("replacement-key")}); err != nil {
		t.Fatal(err)
	}
	removed, err := update()
	if err != nil || removed.Connector.AzureDeployments != nil {
		t.Fatal(removed, err)
	}
	if AzureDeploymentForModel(captured.AzureDeployments, "gpt-6.1-sol") != "writing-prod" {
		t.Fatal("captured binding changed")
	}
	secret, err := s.store.LoadCredentialCustody(custody)
	if err != nil || ResolveCredential(captured, secret).APIKey != "original-key" {
		t.Fatal("captured credential changed")
	}
	if _, err := s.UpdateConnector(userContext("another-account"), &runtimev1.UpdateConnectorRequest{ConnectorId: id, AzureDeployments: &runtimev1.ConnectorAzureDeployments{}}); err == nil {
		t.Fatal("foreign mutation accepted")
	}
}
