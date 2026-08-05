package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
