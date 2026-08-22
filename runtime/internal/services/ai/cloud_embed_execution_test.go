package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestCloudEmbedExecutionUsesCapturedAIConfigConnectorWithoutFallback(t *testing.T) {
	var calls atomic.Int32
	var failAuth atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/embeddings" && r.URL.Path != "/v1/embeddings" {
			http.NotFound(w, r)
			return
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Fatalf("request-scoped credential header = %q", got)
		}
		if failAuth.Load() {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"invalid api key"}}`))
			return
		}
		var body struct {
			Model string   `json:"model"`
			Input []string `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode embedding request: %v", err)
		}
		if body.Model != "text-embedding-3-small" || len(body.Input) != 2 || body.Input[0] != "first" || body.Input[1] != "second" {
			t.Fatalf("mapped embedding request = %+v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"embedding":[0.1,0.2]},{"embedding":[0.3,0.4]}],"usage":{"prompt_tokens":3,"total_tokens":3}}`))
	}))
	defer server.Close()

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "text-embedding-3-small", server.URL, Config{
		CloudProviders:        map[string]nimillm.ProviderCredentials{},
		AllowLoopbackEndpoint: true,
	})
	target, err := structpb.NewStruct(map[string]any{
		"provider":             "openai",
		"providerModelId":      fixture.descriptor.GetProviderModelId(),
		"remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId(),
	})
	if err != nil {
		t.Fatal(err)
	}
	config := appAIConfig("app.embed", &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: "text.embed",
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			ConnectorRef: fixture.connectorID,
			Implementation: &runtimev1.CapabilityImplementationIdentity{
				ImplementationId: "cloud.text.embed.openai",
				DriverId:         "nimi.runtime.driver.openai",
				DriverDialect:    "openai/embeddings/v1",
			},
			ProviderModelTarget: target,
		}},
	})
	ctx := scenarioJobUserContext("app.embed", "user-001")
	if err := overwriteAIConfigStoreForTest(ctx, fixture.service.aiConfigStore, "user-001", config); err != nil {
		t.Fatalf("store AIConfig: %v", err)
	}
	request := &runtimev1.ExecuteScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "app.embed", SubjectUserId: "user-001", TimeoutMs: 10_000},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextEmbed{TextEmbed: &runtimev1.TextEmbedScenarioSpec{
			Inputs: []string{" first ", "second"},
		}}},
	}
	response, err := fixture.service.ExecuteScenario(ctx, request)
	if err != nil {
		t.Fatalf("ExecuteScenario(text.embed): %v", err)
	}
	vectors := response.GetOutput().GetTextEmbed().GetVectors()
	if len(vectors) != 2 || len(vectors[0].GetValues()) != 2 || vectors[1].GetValues()[1] != 0.4 {
		t.Fatalf("embedding vectors = %+v", vectors)
	}
	if response.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD || response.GetModelResolved() != "text-embedding-3-small" {
		t.Fatalf("embedding diagnostics = route %v model %q", response.GetRouteDecision(), response.GetModelResolved())
	}
	if response.GetUsage().GetInputTokens() != 3 {
		t.Fatalf("embedding usage = %+v", response.GetUsage())
	}

	failAuth.Store(true)
	_, err = fixture.service.ExecuteScenario(ctx, request)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatalf("embedding auth reason = %v present=%v err=%v", reason, ok, err)
	}
	failAuth.Store(false)
	if calls.Load() != 2 {
		t.Fatalf("provider calls = %d, want exactly two and no fallback dispatch", calls.Load())
	}
}

func TestTextEmbedLocalIntentExecutesSelectedLlamaDriver(t *testing.T) {
	service := newTestService(nil)
	digest := strings.Repeat("a", 64)
	service.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: &localexecution.SelectedLocalExecution{
		LoadoutID:                "local-embed-loadout",
		CapabilityContract:       capabilitydriver.TextEmbedCapabilityContract,
		DisplayName:              "Local embedding",
		RecipeID:                 capabilitydriver.LlamaEmbedGGUFRecipeID,
		RecipeRevision:           "1",
		DriverIdentity:           (&capabilitydriver.Identity{ImplementationID: capabilitydriver.LlamaEmbedImplementationID, DriverID: capabilitydriver.LlamaDriverID, DriverDialect: capabilitydriver.LlamaEmbedDriverDialect}).Proto(),
		ModelContextWindowTokens: 8192,
		Requirements: []*runtimev1.LocalCapabilityRequirement{{
			RequirementId: capabilitydriver.EmbeddingGGUFRequirementID,
		}},
		ExactBindings: []localexecution.ExactBinding{{
			RequirementID:     capabilitydriver.EmbeddingGGUFRequirementID,
			ModelAssetID:      "embedding/test",
			AbsolutePath:      filepath.Join(t.TempDir(), "embedding.gguf"),
			VerifiedContentID: "sha256:" + digest,
			EntrySHA256:       digest,
		}},
		Configured: true,
	}})
	host := &localTextHostStub{embedResult: localexecution.EmbedResult{
		Vectors: []*runtimev1.EmbeddingVector{
			{Values: []float64{0.1, 0.2}},
			{Values: []float64{0.3, 0.4}},
		},
		InputTokens: 3,
	}}
	service.SetLocalTextExecutionHost(host)
	ctx := withLocalScenarioTestIntent(scenarioJobUserContext("app.embed", "user-001"), "text.embed")
	response, err := service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "app.embed", SubjectUserId: "user-001"},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextEmbed{TextEmbed: &runtimev1.TextEmbedScenarioSpec{
			Inputs: []string{"first", "second"},
		}}},
	})
	if err != nil {
		t.Fatalf("ExecuteScenario(local text.embed): %v", err)
	}
	vectors := response.GetOutput().GetTextEmbed().GetVectors()
	if len(vectors) != 2 || vectors[1].GetValues()[1] != 0.4 ||
		response.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL ||
		response.GetModelResolved() != "Local embedding" || response.GetUsage().GetInputTokens() != 3 {
		t.Fatalf("local embedding response = %+v", response)
	}
	service.scenarioJobs.mu.RLock()
	if len(service.scenarioJobs.jobs) != 1 {
		service.scenarioJobs.mu.RUnlock()
		t.Fatalf("local sync embed persisted jobs = %d, want 1", len(service.scenarioJobs.jobs))
	}
	for _, record := range service.scenarioJobs.jobs {
		if record.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || record.resolvedAssembly == nil || record.resolvedAssembly.Request.Kind != "text.embed" {
			service.scenarioJobs.mu.RUnlock()
			t.Fatalf("local sync embed durable capture = %+v assembly=%+v", record.job, record.resolvedAssembly)
		}
	}
	service.scenarioJobs.mu.RUnlock()
	host.mu.Lock()
	plan := host.capturedEmbedPlan
	host.mu.Unlock()
	if plan == nil || plan.RequestPath() != "/v1/embeddings" || plan.ExpectedCount() != 2 {
		t.Fatalf("captured local embedding plan = %+v", plan)
	}
}
