package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestCatalogDimensionEnforcedBeforeEmbeddingJobSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/embeddings") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]any{{"embedding": []float64{0.1, 0.2}, "index": 0}}})
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "openai", "text-embedding-3-small", server.URL, Config{CloudProviders: map[string]nimillm.ProviderCredentials{}, AllowLoopbackEndpoint: true})
	catalog, err := aicatalog.NewResolver(aicatalog.ResolverConfig{CustomDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	f.service.speechCatalog = catalog
	f.connectorService.SetModelCatalogResolver(catalog)
	entry, err := catalog.ResolveModelEntryForSubject("user-001", "openai", "text-embedding-3-small")
	if err != nil || entry.Embedding == nil {
		t.Fatalf("catalog dimension prerequisite: %v", err)
	}
	target, _ := structpb.NewStruct(map[string]any{"provider": "openai", "providerModelId": f.descriptor.GetProviderModelId(), "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId()})
	cfg := appAIConfig("app.embed.audit", &runtimev1.AIConfigCapabilityIntent{CapabilityContract: capabilitydriver.TextEmbedCapabilityContract, Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{ConnectorRef: f.connectorID, Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.text.embed.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai/embeddings/v1"}, ProviderModelTarget: target}}})
	ctx := scenarioJobUserContext("app.embed.audit", "user-001")
	// Use the admitted App owner constructor shape rather than shared LocalAgent owner.
	if err := overwriteAIConfigStoreForTest(ctx, f.service.aiConfigStore, "user-001", cfg); err != nil {
		t.Fatal(err)
	}
	response, err := f.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app.embed.audit", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextEmbed{TextEmbed: &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"one request"}}}}})
	if err == nil {
		t.Fatalf("accepted output outside catalog contract: declared=%d returned=%d space=%q", entry.Embedding.Dimension, len(response.GetOutput().GetTextEmbed().GetVectors()[0].GetValues()), response.GetOutput().GetTextEmbed().GetSpaceId())
	}
	f.service.scenarioJobs.mu.RLock()
	defer f.service.scenarioJobs.mu.RUnlock()
	for _, record := range f.service.scenarioJobs.jobs {
		if record.job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			t.Fatal("invalid vectors reached COMPLETED")
		}
	}
}
