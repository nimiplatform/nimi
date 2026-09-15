package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/types/known/structpb"
)

// Independent audit: catalog row names are distinct from executable API IDs.
// Both rows describe different fixed-width API models, not contradictory aliases.
func TestCloudEmbeddingDimensionUsesExactAdmittedCatalogRow(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Model != "audit-api" {
			t.Errorf("dispatch model = %q", body.Model)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]any{{"embedding": []float64{0.1, 0.2}, "index": 0}}})
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "openai", "text-embedding-3-small", server.URL, Config{AllowLoopbackEndpoint: true})
	catalog, err := aicatalog.NewResolver(aicatalog.ResolverConfig{CustomDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	f.service.speechCatalog = catalog
	f.connectorService.SetModelCatalogResolver(catalog)
	_, err = f.connectorService.UpsertModelCatalogProvider(f.context, &runtimev1.UpsertModelCatalogProviderRequest{Provider: "openai", Yaml: `version: 1
provider: openai
catalog_version: audit-api-identity
models:
  - provider: openai
    model_id: audit-label
    api_model_id: audit-api
    model_type: embedding
    updated_at: "2026-09-15"
    capabilities: [text.embed]
    embedding: {dimension: 2}
    pricing: {unit: token, input: "unknown", output: "unknown", currency: USD, as_of: "2026-09-15", notes: audit}
    source_ref: {url: "https://example.com/audit-api", retrieved_at: "2026-09-15", note: audit}
  - provider: openai
    model_id: audit-api
    api_model_id: another-api
    model_type: embedding
    updated_at: "2026-09-15"
    capabilities: [text.embed]
    embedding: {dimension: 3}
    pricing: {unit: token, input: "unknown", output: "unknown", currency: USD, as_of: "2026-09-15", notes: audit}
    source_ref: {url: "https://example.com/another-api", retrieved_at: "2026-09-15", note: audit}
voices: []
`})
	if err != nil {
		t.Fatalf("admit catalog: %v", err)
	}
	descriptor := connectorModelDescriptorForAITest(t, f.connectorService, f.context, f.connectorID, "audit-api")
	if descriptor.GetModelLabel() != "audit-label" {
		t.Fatalf("wrong fixture row: %+v", descriptor)
	}
	target, _ := structpb.NewStruct(map[string]any{"provider": "openai", "providerModelId": descriptor.GetProviderModelId(), "remoteModelCatalogId": descriptor.GetRemoteModelCatalogId()})
	implementation := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.text.embed.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai/embeddings/v1"}
	config := appAIConfig("app.audit", &runtimev1.AIConfigCapabilityIntent{CapabilityContract: capabilitydriver.TextEmbedCapabilityContract, Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{ConnectorRef: f.connectorID, Implementation: implementation, ProviderModelTarget: target}}})
	ctx := scenarioJobUserContext("app.audit", "user-001")
	if err := overwriteAIConfigStoreForTest(ctx, f.service.aiConfigStore, "user-001", config); err != nil {
		t.Fatal(err)
	}
	req := &runtimev1.ExecuteScenarioRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app.audit", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextEmbed{TextEmbed: &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"audit input"}}}}}
	intentCtx := executionintent.WithIntent(ctx, executionintent.Intent{CapabilityContract: capabilitydriver.TextEmbedCapabilityContract, Route: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, ConnectorRef: f.connectorID, CloudImplementation: implementation, ProviderModelTarget: target})
	_, exact, err := connector.ResolveExactAccountConnectorBinding(f.service.connStore, catalog, "user-001", connector.RemoteModelCatalogRef{ConnectorID: f.connectorID, RemoteModelCatalogID: descriptor.GetRemoteModelCatalogId(), ProviderModelID: "audit-api", Provider: "openai"})
	if err != nil || exact == nil {
		t.Fatalf("exact catalog binding failed: %+v %v", exact, err)
	}
	effective, err := f.service.captureCloudEmbedEffectiveInputs(intentCtx, req.Head, req)
	if err != nil {
		t.Fatalf("capture rejected valid exact catalog row: %v", err)
	}
	t.Logf("catalog selected model_label=%s api_model_id=%s declares dimension=2; captured dimension=%d", descriptor.GetModelLabel(), descriptor.GetProviderModelId(), effective.dimension)
	response, err := f.service.ExecuteScenario(ctx, req)
	if err != nil || len(response.GetOutput().GetTextEmbed().GetVectors()) != 1 || len(response.GetOutput().GetTextEmbed().GetVectors()[0].GetValues()) != 2 {
		t.Fatalf("exact admitted 2-dimensional response rejected: calls=%d capture=%d response=%+v err=%v", calls.Load(), effective.dimension, response, err)
	}
}
