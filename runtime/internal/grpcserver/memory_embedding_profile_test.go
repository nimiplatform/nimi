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
	snapshot := &memoryservice.MemoryEmbeddingTextEmbedIntentSnapshot{
		SourceKind: memoryservice.MemoryEmbeddingTextEmbedSourceKindCloud,
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
		if model.GetProviderModelId() == "text-embedding-3-small" {
			descriptor = model
			break
		}
	}
	if descriptor == nil {
		t.Fatal("text-embedding-3-small descriptor not found")
	}

	resolved := resolveCloudRuntimeMemoryEmbeddingProfile(context.Background(), &memoryservice.MemoryEmbeddingTextEmbedIntentSnapshot{
		SourceKind: memoryservice.MemoryEmbeddingTextEmbedSourceKindCloud,
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
	snapshot := &memoryservice.MemoryEmbeddingTextEmbedIntentSnapshot{
		SourceKind: memoryservice.MemoryEmbeddingTextEmbedSourceKindLocal,
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

func TestRuntimeMemoryEmbeddingDurableLocalTargetPreservesOpaqueV2Binding(t *testing.T) {
	profileTarget := runtimeMemoryEmbeddingDurableLocalTarget(&memoryservice.MemoryEmbeddingLocalBindingRef{
		ProfileBindingID: "opaque-profile-binding",
	})
	if profileTarget.GetVersion() != "v2" ||
		profileTarget.GetProfileBindingId() != "opaque-profile-binding" ||
		profileTarget.GetReadinessRef() != "" {
		t.Fatalf("profile target = %+v", profileTarget)
	}

	readinessTarget := runtimeMemoryEmbeddingDurableLocalTarget(&memoryservice.MemoryEmbeddingLocalBindingRef{
		ReadinessRef: "opaque-readiness-ref",
	})
	if readinessTarget.GetVersion() != "v2" ||
		readinessTarget.GetReadinessRef() != "opaque-readiness-ref" ||
		readinessTarget.GetProfileBindingId() != "" {
		t.Fatalf("readiness target = %+v", readinessTarget)
	}

	if got := runtimeMemoryEmbeddingDurableLocalTarget(&memoryservice.MemoryEmbeddingLocalBindingRef{}); got != nil {
		t.Fatalf("empty binding target = %+v", got)
	}
	if got := runtimeMemoryEmbeddingDurableLocalTarget(&memoryservice.MemoryEmbeddingLocalBindingRef{
		ProfileBindingID: "profile",
		ReadinessRef:     "readiness",
	}); got != nil {
		t.Fatalf("ambiguous binding target = %+v", got)
	}
}
