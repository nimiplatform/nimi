package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestEmbedTextsForMemoryUsesResolvedCloudBinding(t *testing.T) {
	var providerModel string
	var durableStore *scenarioJobStore
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/models" || r.URL.Path == "/models" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"id":"text-embedding-3-small"}]}`))
			return
		}
		if r.URL.Path != "/v1/embeddings" {
			http.NotFound(w, r)
			return
		}
		if durableStore == nil {
			t.Error("provider Host started before test durable store was installed")
		} else {
			durableStore.mu.RLock()
			captured := false
			for _, record := range durableStore.jobs {
				if record != nil && record.job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING &&
					record.cloudAssembly != nil && record.cloudAssembly.RequestKind == cloudResolvedRequestEmbed {
					captured = true
				}
			}
			durableStore.mu.RUnlock()
			if !captured {
				t.Error("provider Host started before RUNNING memory embed Job and Cloud assembly were durable")
			}
			raw, readErr := os.ReadFile(durableStore.durablePath)
			if readErr != nil || !bytes.Contains(raw, []byte("alpha")) || bytes.Contains(raw, []byte("test-key")) {
				t.Errorf("provider Host durable snapshot = %s readErr=%v", raw, readErr)
			}
		}
		var body struct {
			Model string   `json:"model"`
			Input []string `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		providerModel = body.Model
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"embedding": make([]float64, 1536), "index": 0}}})
	}))
	defer func() { server.Close() }()

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "text-embedding-3-small", server.URL, Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{}, AllowLoopbackEndpoint: true,
	})
	durableStore, _ = newDurableScenarioJobStoreForFailureTest(t)
	fixture.service.scenarioJobs = durableStore
	target, err := structpb.NewStruct(map[string]any{
		"provider": "openai", "providerModelId": fixture.descriptor.GetProviderModelId(),
		"remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := overwriteAIConfigStoreForTest(fixture.context, fixture.service.aiConfigStore, "user-001", &runtimev1.AIConfig{
		Owner: aiconfig.LocalAgentSubsystemOwner(),
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{{
			CapabilityContract: capabilitydriver.TextEmbedCapabilityContract,
			Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
				ConnectorRef: fixture.connectorID,
				Implementation: &runtimev1.CapabilityImplementationIdentity{
					ImplementationId: "cloud.text.embed.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai/embeddings/v1",
				},
				ProviderModelTarget: target,
			}},
		}},
	}); err != nil {
		t.Fatalf("store shared LocalAgent AIConfig: %v", err)
	}

	description, err := fixture.service.DescribeMemoryEmbedding(fixture.context)
	if err != nil {
		t.Fatal(err)
	}
	_, capture, err := fixture.service.CaptureMemoryEmbedding(fixture.context, []string{"alpha"}, description.SpaceID, EmbeddingOwner{Kind: "memory", AgentRef: "agent-a", OperationID: "operation-a", BankRef: "bank-a", LifecycleRef: "life-a"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := fixture.service.DiscardMemoryEmbedding(context.WithoutCancel(fixture.context), capture); err != nil {
			t.Errorf("discard cloud embedding capture: %v", err)
		}
	})
	result, err := fixture.service.ExecuteMemoryEmbedding(fixture.context, capture)
	vectors := result.Vectors
	if err != nil {
		t.Fatalf("EmbedTextsForMemory: %v", err)
	}
	if providerModel != "text-embedding-3-small" {
		t.Fatalf("provider request model = %q want cloud binding provider_model_id", providerModel)
	}
	if len(vectors) != 1 || len(vectors[0]) != 1536 {
		t.Fatalf("unexpected vectors: %#v", vectors)
	}
	fixture.service.scenarioJobs.mu.RLock()
	defer fixture.service.scenarioJobs.mu.RUnlock()
	if len(fixture.service.scenarioJobs.jobs) != 1 {
		t.Fatalf("memory Cloud embed durable jobs = %d, want 1", len(fixture.service.scenarioJobs.jobs))
	}
	for _, record := range fixture.service.scenarioJobs.jobs {
		if record.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED ||
			record.cloudAssembly != nil || record.payload == nil || record.payload.State != "disposed" {
			t.Fatalf("memory Cloud durable capture = job %+v assembly %+v", record.job, record.cloudAssembly)
		}
	}
}

func TestEmbedTextsForMemoryUsesSelectedLocalLlamaBinding(t *testing.T) {
	service := newTestService(nil)
	digest := strings.Repeat("b", 64)
	bundleDir := t.TempDir()
	service.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: &localexecution.SelectedLocalExecution{
		LoadoutID:                "local-memory-embed-loadout",
		CapabilityContract:       capabilitydriver.TextEmbedCapabilityContract,
		DisplayName:              "Local memory embedding",
		RecipeID:                 capabilitydriver.LlamaEmbedGGUFRecipeID,
		RecipeRevision:           "1",
		DriverIdentity:           (&capabilitydriver.Identity{ImplementationID: capabilitydriver.LlamaEmbedImplementationID, DriverID: capabilitydriver.LlamaDriverID, DriverDialect: capabilitydriver.LlamaEmbedDriverDialect}).Proto(),
		ModelContextWindowTokens: 8192, EmbeddingDimension: 3,
		Requirements: []*runtimev1.LocalCapabilityRequirement{{
			RequirementId: capabilitydriver.EmbeddingGGUFRequirementID,
		}},
		ExactBindings: []localexecution.ExactBinding{{
			RequirementID:     capabilitydriver.EmbeddingGGUFRequirementID,
			ModelAssetID:      "model-embedding-memory",
			AbsolutePath:      filepath.Join(bundleDir, "embedding.gguf"),
			BundleDir:         bundleDir,
			DeclaredFiles:     []string{"embedding.gguf", "tokenizer.json"},
			VerifiedContentID: "sha256:" + digest,
			EntrySHA256:       digest,
		}},
		Configured: true,
	}})
	host := &localTextHostStub{embedResult: localexecution.EmbedResult{
		Vectors: []*runtimev1.EmbeddingVector{
			{Values: []float64{0.1, 0.2, 0.3}},
			{Values: []float64{0.4, 0.5, 0.6}},
		},
	}}
	service.SetLocalTextExecutionHost(host)
	ctx := scenarioJobUserContext("nimi.runtime.memory", "user-001")
	if err := overwriteAIConfigStoreForTest(ctx, service.aiConfigStore, "user-001", &runtimev1.AIConfig{
		Owner: aiconfig.LocalAgentSubsystemOwner(),
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{{
			CapabilityContract: capabilitydriver.TextEmbedCapabilityContract,
			Route:              &runtimev1.AIConfigCapabilityIntent_Local{Local: &runtimev1.AIConfigLocalIntent{}},
		}},
	}); err != nil {
		t.Fatalf("store shared LocalAgent AIConfig: %v", err)
	}

	description, err := service.DescribeMemoryEmbedding(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, capture, err := service.CaptureMemoryEmbedding(ctx, []string{" first ", "second"}, description.SpaceID, EmbeddingOwner{Kind: "memory", AgentRef: "agent-a", OperationID: "operation-a", BankRef: "bank-a", LifecycleRef: "life-a"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := service.DiscardMemoryEmbedding(context.WithoutCancel(ctx), capture); err != nil {
			t.Errorf("discard local embedding capture: %v", err)
		}
	})
	result, err := service.ExecuteMemoryEmbedding(ctx, capture)
	vectors := result.Vectors
	if err != nil {
		t.Fatalf("EmbedTextsForMemory(local): %v", err)
	}
	if len(vectors) != 2 || vectors[1][2] != 0.6 {
		t.Fatalf("local memory vectors = %#v", vectors)
	}
	host.mu.Lock()
	plan := host.capturedEmbedPlan
	host.mu.Unlock()
	if plan == nil || plan.RequestPath() != "/v1/embeddings" || plan.ExpectedCount() != 2 {
		t.Fatalf("captured local memory embedding plan = %+v", plan)
	}
	files := plan.ModelFiles()
	if len(files) != 1 || files[0].ModelAssetID != "model-embedding-memory" ||
		files[0].BundleDir != bundleDir || len(files[0].DeclaredFiles) != 2 || files[0].DeclaredFiles[1] != "tokenizer.json" {
		t.Fatalf("captured embedding bundle identity = %+v", files)
	}
	service.scenarioJobs.mu.RLock()
	defer service.scenarioJobs.mu.RUnlock()
	if len(service.scenarioJobs.jobs) != 1 {
		t.Fatalf("memory Local embed durable jobs = %d, want 1", len(service.scenarioJobs.jobs))
	}
	for _, record := range service.scenarioJobs.jobs {
		if record.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED ||
			record.resolvedAssembly != nil || record.payload == nil || record.payload.State != "disposed" {
			t.Fatalf("memory Local durable capture = job %+v assembly %+v", record.job, record.resolvedAssembly)
		}
	}
}
