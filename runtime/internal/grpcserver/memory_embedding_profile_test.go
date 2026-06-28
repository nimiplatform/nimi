package grpcserver

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	connectorservice "github.com/nimiplatform/nimi/runtime/internal/services/connector"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

func newTestEmbeddingCatalogResolver(t *testing.T) *catalog.Resolver {
	t.Helper()
	resolver, err := catalog.NewResolver(catalog.ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}
	return resolver
}

// resolveCatalogEmbeddingDimension is the single dimension-authority helper
// (K-MEM-004 / K-AIEXEC-006). It must read the catalog `embedding.dimension`
// block, and fail-close (ok=false) for unknown models or models without an
// admitted dimension.
func TestResolveCatalogEmbeddingDimensionReadsCatalogAuthority(t *testing.T) {
	resolver := newTestEmbeddingCatalogResolver(t)

	cases := []struct {
		name     string
		provider string
		modelID  string
		want     int32
	}{
		{name: "openai-large", provider: "openai", modelID: "text-embedding-3-large", want: 3072},
		{name: "openai-small", provider: "openai", modelID: "text-embedding-3-small", want: 1536},
		{name: "hunyuan-fixed-1024", provider: "hunyuan", modelID: "hunyuan-embedding", want: 1024},
		{name: "qianfan-384", provider: "qianfan", modelID: "embedding-v1", want: 384},
		// Local row resolved through its catalog alias (logical model id form).
		{name: "local-nomic-alias", provider: "local", modelID: "local/nomic-embed-text", want: 768},
		{name: "local-nomic-canonical", provider: "local", modelID: "nomic-embed-text-local", want: 768},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := resolveCatalogEmbeddingDimension(resolver, tc.provider, tc.modelID)
			if !ok {
				t.Fatalf("expected catalog dimension for %s/%s, got fail-close", tc.provider, tc.modelID)
			}
			if got != tc.want {
				t.Fatalf("dimension mismatch for %s/%s: got %d want %d", tc.provider, tc.modelID, got, tc.want)
			}
		})
	}
}

// A text.embed model with no admitted catalog dimension (variable/preview) must
// fail-close, never fabricate a dimension. gemini-embedding-2-preview is a
// real catalog row intentionally left without an `embedding` block.
func TestResolveCatalogEmbeddingDimensionFailsClosedWithoutAdmittedDimension(t *testing.T) {
	resolver := newTestEmbeddingCatalogResolver(t)

	if _, ok := resolveCatalogEmbeddingDimension(resolver, "gemini", "gemini-embedding-2-preview"); ok {
		t.Fatal("expected fail-close for embedding model without admitted catalog dimension")
	}
	if _, ok := resolveCatalogEmbeddingDimension(resolver, "openai", "no-such-embedding-model"); ok {
		t.Fatal("expected fail-close for unknown model")
	}
	if _, ok := resolveCatalogEmbeddingDimension(nil, "openai", "text-embedding-3-large"); ok {
		t.Fatal("expected fail-close when catalog resolver is nil")
	}
}

// The cloud resolve path must source the resolved dimension from the catalog
// row rather than emitting a hardcoded constant.
func TestResolveCloudRuntimeMemoryEmbeddingProfileFailsClosedWithoutCatalog(t *testing.T) {
	snapshot := &memoryservice.MemoryEmbeddingBindingIntentSnapshot{
		SourceKind: memoryservice.MemoryEmbeddingBindingSourceKindCloud,
		CloudBinding: &memoryservice.MemoryEmbeddingCloudBindingRef{
			ConnectorID:          "conn-1",
			RemoteModelCatalogID: "remote-catalog:conn-1:text-embedding-3-large",
			ProviderModelID:      "text-embedding-3-large",
			Provider:             "openai",
		},
	}
	// connStore and modelCatalog nil -> unavailable fail-close, never a
	// hardcoded resolved profile.
	resolved := resolveCloudRuntimeMemoryEmbeddingProfile(context.Background(), snapshot, nil, nil)
	if resolved.Profile != nil {
		t.Fatalf("expected no resolved profile on missing catalog, got %+v", resolved.Profile)
	}
	if resolved.ResolutionState == "resolved" {
		t.Fatalf("expected fail-close resolution state, got %q", resolved.ResolutionState)
	}
}

func TestResolveCloudRuntimeMemoryEmbeddingProfileProjectsCloudBinding(t *testing.T) {
	resolver := newTestEmbeddingCatalogResolver(t)
	store := connectorservice.NewConnectorStoreWithMemorySecrets(t.TempDir())
	created, err := store.Create(connectorservice.ConnectorRecord{
		ConnectorID: "connector-openai-memory",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM,
		OwnerID:     "machine",
		Provider:    "openai",
		Endpoint:    "https://api.openai.com/v1",
		Label:       "OpenAI Memory",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "test-key")
	if err != nil {
		t.Fatalf("create connector: %v", err)
	}
	connectorSvc := connectorservice.New(slog.New(slog.NewTextHandler(io.Discard, nil)), store, nil)
	models, err := connectorSvc.ListConnectorModels(context.Background(), &runtimev1.ListConnectorModelsRequest{
		ConnectorId: created.ConnectorID,
		PageSize:    200,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels: %v", err)
	}
	var descriptor *runtimev1.ConnectorModelDescriptor
	for _, model := range models.GetModels() {
		if model.GetModelId() == "text-embedding-3-small" {
			descriptor = model
			break
		}
	}
	if descriptor == nil {
		t.Fatal("text-embedding-3-small descriptor not found")
	}

	resolved := resolveCloudRuntimeMemoryEmbeddingProfile(context.Background(), &memoryservice.MemoryEmbeddingBindingIntentSnapshot{
		SourceKind: memoryservice.MemoryEmbeddingBindingSourceKindCloud,
		CloudBinding: &memoryservice.MemoryEmbeddingCloudBindingRef{
			ConnectorID:          created.ConnectorID,
			RemoteModelCatalogID: descriptor.GetRemoteModelCatalogId(),
			ProviderModelID:      descriptor.GetProviderModelId(),
			Provider:             descriptor.GetProvider(),
		},
	}, store, resolver)
	if resolved.Profile == nil {
		t.Fatalf("expected resolved profile, got state=%s reason=%s", resolved.ResolutionState, resolved.BlockedReasonCode)
	}
	cloud := resolved.Profile.GetCloudBinding()
	if cloud == nil {
		t.Fatal("expected resolved cloud binding on memory embedding profile")
	}
	if cloud.GetConnectorId() != created.ConnectorID {
		t.Fatalf("cloud connector_id = %q want %q", cloud.GetConnectorId(), created.ConnectorID)
	}
	if cloud.GetRemoteModelCatalogId() != descriptor.GetRemoteModelCatalogId() {
		t.Fatalf("remote_model_catalog_id = %q want %q", cloud.GetRemoteModelCatalogId(), descriptor.GetRemoteModelCatalogId())
	}
	if cloud.GetProviderModelId() != descriptor.GetProviderModelId() {
		t.Fatalf("provider_model_id = %q want %q", cloud.GetProviderModelId(), descriptor.GetProviderModelId())
	}
	if cloud.GetProvider() != descriptor.GetProvider() {
		t.Fatalf("provider = %q want %q", cloud.GetProvider(), descriptor.GetProvider())
	}
}

// The local resolve path must fail-close when the catalog authority is absent
// rather than minting a profile from the local asset record alone.
func TestResolveLocalRuntimeMemoryEmbeddingProfileFailsClosedWithoutCatalog(t *testing.T) {
	snapshot := &memoryservice.MemoryEmbeddingBindingIntentSnapshot{
		SourceKind: memoryservice.MemoryEmbeddingBindingSourceKindLocal,
		LocalBinding: &memoryservice.MemoryEmbeddingLocalBindingRef{
			ProfileBindingID: "nomic-embed-text-local",
		},
	}
	// localSvc nil already fails closed; assert that a nil catalog also yields a
	// non-resolved outcome (no fabricated dimension path).
	resolved := resolveLocalRuntimeMemoryEmbeddingProfile(context.Background(), snapshot, nil, nil)
	if resolved.Profile != nil {
		t.Fatalf("expected no resolved profile without local service/catalog, got %+v", resolved.Profile)
	}
	if resolved.ResolutionState == "resolved" {
		t.Fatalf("expected fail-close resolution state, got %q", resolved.ResolutionState)
	}
}

// memoryEmbeddingLocalCatalogModelRef prefers the logical model id (catalog
// facing identity) and falls back to the variant-level asset id.
func TestMemoryEmbeddingLocalCatalogModelRefPrefersLogicalID(t *testing.T) {
	withLogical := &runtimev1.LocalAssetRecord{
		AssetId:        "local.embed.nomic.gguf",
		LogicalModelId: "local/nomic-embed-text",
	}
	if got := memoryEmbeddingLocalCatalogModelRef(withLogical); got != "local/nomic-embed-text" {
		t.Fatalf("expected logical model id, got %q", got)
	}
	assetOnly := &runtimev1.LocalAssetRecord{AssetId: "local.embed.nomic.gguf"}
	if got := memoryEmbeddingLocalCatalogModelRef(assetOnly); got != "local.embed.nomic.gguf" {
		t.Fatalf("expected asset id fallback, got %q", got)
	}
	if got := memoryEmbeddingLocalCatalogModelRef(nil); got != "" {
		t.Fatalf("expected empty ref for nil asset, got %q", got)
	}
}

func TestMemoryEmbeddingLocalTargetMatchesPrefixedRuntimeRef(t *testing.T) {
	asset := &runtimev1.LocalAssetRecord{
		LocalAssetId: "01KLOCALNOMIC",
		AssetId:      "local.embed.nomic.gguf",
	}
	if !memoryEmbeddingLocalTargetMatches(asset, "local-runtime:01KLOCALNOMIC") {
		t.Fatalf("expected prefixed local-runtime profile binding id to match local asset id")
	}
	if !memoryEmbeddingLocalTargetMatches(asset, "01KLOCALNOMIC") {
		t.Fatalf("expected bare local asset id to remain accepted inside resolver")
	}
	if memoryEmbeddingLocalTargetMatches(asset, "local-runtime:local.embed.nomic.gguf") {
		t.Fatalf("prefixed runtime ref must resolve to local asset id only, not catalog asset id")
	}
}
