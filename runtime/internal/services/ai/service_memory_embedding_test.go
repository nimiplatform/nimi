package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

func TestEmbedTextsForMemoryUsesResolvedCloudBinding(t *testing.T) {
	var providerModel string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/embeddings" {
			http.NotFound(w, r)
			return
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
		_, _ = w.Write([]byte(`{"data":[{"embedding":[0.1,0.2,0.3]}],"usage":{"prompt_tokens":3,"total_tokens":3}}`))
	}))
	defer func() { server.Close() }()

	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	created, err := store.Create(connector.ConnectorRecord{
		ConnectorID: "connector-openai-memory",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM,
		OwnerID:     "machine",
		Provider:    "openai",
		Endpoint:    server.URL,
		Label:       "OpenAI Memory",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "test-key")
	if err != nil {
		t.Fatalf("create connector: %v", err)
	}

	svc, err := newFromProviderConfig(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		nil,
		nil,
		store,
		Config{
			CloudProviders:        map[string]nimillm.ProviderCredentials{"openai": {BaseURL: server.URL, APIKey: "unused"}},
			AllowLoopbackEndpoint: true,
		},
		8,
		2,
	)
	if err != nil {
		t.Fatalf("new ai service: %v", err)
	}

	vectors, err := svc.EmbedTextsForMemory(context.Background(), &runtimev1.MemoryEmbeddingProfile{
		Provider:  "openai",
		ModelId:   "stale-profile-model",
		Dimension: 3,
		Version:   "stale-connector-id",
		CloudBinding: &runtimev1.MemoryEmbeddingCloudBindingRef{
			ConnectorId:          created.ConnectorID,
			RemoteModelCatalogId: "remote-model-catalog-test",
			ProviderModelId:      "text-embedding-3-small",
			Provider:             "openai",
		},
	}, []string{"alpha"})
	if err != nil {
		t.Fatalf("EmbedTextsForMemory: %v", err)
	}
	if providerModel != "text-embedding-3-small" {
		t.Fatalf("provider request model = %q want cloud binding provider_model_id", providerModel)
	}
	if len(vectors) != 1 || len(vectors[0]) != 3 {
		t.Fatalf("unexpected vectors: %#v", vectors)
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
		ModelContextWindowTokens: 8192,
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

	vectors, err := service.EmbedTextsForMemory(context.Background(), &runtimev1.MemoryEmbeddingProfile{
		Provider:  "local",
		ModelId:   "catalog/local-memory-embedding",
		Dimension: 3,
		Version:   "model-embedding-memory",
	}, []string{" first ", "second"})
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
}
