package grpcserver

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	connectorservice "github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/proto"
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
	snapshot := &cognitionmemory.MemoryEmbeddingTextEmbedIntentSnapshot{
		SourceKind: cognitionmemory.MemoryEmbeddingTextEmbedSourceKindCloud,
		CloudBinding: &cognitionmemory.MemoryEmbeddingCloudBindingRef{
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

	resolved := resolveCloudRuntimeMemoryEmbeddingProfile(context.Background(), &cognitionmemory.MemoryEmbeddingTextEmbedIntentSnapshot{
		SourceKind: cognitionmemory.MemoryEmbeddingTextEmbedSourceKindCloud,
		CloudBinding: &cognitionmemory.MemoryEmbeddingCloudBindingRef{
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

type memoryEmbeddingLocalResolverStub struct {
	selected *localexecution.SelectedLocalExecution
}

func (s memoryEmbeddingLocalResolverStub) ProjectSelectedLocalLoadout(string) (localexecution.LoadoutOption, bool, error) {
	if s.selected == nil {
		return localexecution.LoadoutOption{}, false, nil
	}
	return localexecution.LoadoutOption{
		LoadoutID: s.selected.LoadoutID, DisplayName: s.selected.DisplayName,
		CapabilityContract: s.selected.CapabilityContract, Implementation: s.selected.DriverIdentity,
		ValidationState: runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED,
	}, true, nil
}

func (s memoryEmbeddingLocalResolverStub) ResolveSelectedLocalExecution(string) (*localexecution.SelectedLocalExecution, error) {
	return localexecution.CloneSelectedLocalExecution(s.selected), nil
}

func (s memoryEmbeddingLocalResolverStub) ResolveLocalExecution(string, string) (*localexecution.SelectedLocalExecution, error) {
	return localexecution.CloneSelectedLocalExecution(s.selected), nil
}

func TestResolveRuntimeMemoryEmbeddingProfileUsesSelectedCatalogContent(t *testing.T) {
	resolver := newTestEmbeddingCatalogResolver(t)
	selected := &localexecution.SelectedLocalExecution{
		LoadoutID:          "loadout-embed",
		CapabilityContract: capabilitydriver.TextEmbedCapabilityContract,
		DriverIdentity: (&capabilitydriver.Identity{
			ImplementationID: capabilitydriver.LlamaEmbedImplementationID,
			DriverID:         capabilitydriver.LlamaDriverID,
			DriverDialect:    capabilitydriver.LlamaEmbedDriverDialect,
		}).Proto(),
		Requirements: []*runtimev1.LocalCapabilityRequirement{{RequirementId: capabilitydriver.EmbeddingGGUFRequirementID}},
		ExactBindings: []localexecution.ExactBinding{{
			RequirementID:     capabilitydriver.EmbeddingGGUFRequirementID,
			ModelAssetID:      "asset-nomic",
			VerifiedContentID: "sha256:d4e388894e09cf3816e8b0896d81d265b55e7a9fff9ab03fe8bf4ef5e11295ac",
		}},
		Configured: true,
	}
	resolved := resolveRuntimeMemoryEmbeddingProfile(context.Background(), &cognitionmemory.MemoryEmbeddingTextEmbedIntentSnapshot{
		SourceKind:   cognitionmemory.MemoryEmbeddingTextEmbedSourceKindLocal,
		LocalBinding: &cognitionmemory.MemoryEmbeddingLocalBindingRef{LoadoutRef: "loadout-embed"},
	}, nil, resolver, memoryEmbeddingLocalResolverStub{selected: selected})
	if resolved.ResolutionState != "resolved" || resolved.Profile == nil ||
		resolved.Profile.GetModelId() != "nomic-embed-text-local" || resolved.Profile.GetVersion() != "asset-nomic" || resolved.Profile.GetDimension() != 768 {
		t.Fatalf("resolved Local memory embedding profile = %+v", resolved)
	}
}

func TestResolveRuntimeMemoryEmbeddingProfileRequiresSelectedLoadoutResolver(t *testing.T) {
	snapshot := &cognitionmemory.MemoryEmbeddingTextEmbedIntentSnapshot{
		SourceKind:   cognitionmemory.MemoryEmbeddingTextEmbedSourceKindLocal,
		LocalBinding: &cognitionmemory.MemoryEmbeddingLocalBindingRef{LoadoutRef: "loadout-embed"},
	}
	resolved := resolveRuntimeMemoryEmbeddingProfile(context.Background(), snapshot, nil, nil, nil)
	if resolved.Profile != nil {
		t.Fatalf("local binding must not mint an embedding profile outside selected Loadout capture: %+v", resolved.Profile)
	}
	if resolved.ResolutionState != "unavailable" || resolved.BlockedReasonCode != runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE {
		t.Fatalf("local binding resolution = state %q reason %v", resolved.ResolutionState, resolved.BlockedReasonCode)
	}
}

func TestCognitionMemoryEmbeddingSpaceIdentityUsesExactBindingAndResolvedModel(t *testing.T) {
	profileA := &runtimev1.MemoryEmbeddingProfile{
		Provider: "local", ModelId: "embedding-model-a", Dimension: 768, Version: "asset-a",
		DistanceMetric: runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
	}
	localA := &cognitionmemory.MemoryEmbeddingTextEmbedIntentSnapshot{
		SourceKind: cognitionmemory.MemoryEmbeddingTextEmbedSourceKindLocal, ConfigRevision: 11,
		LocalBinding: &cognitionmemory.MemoryEmbeddingLocalBindingRef{LoadoutRef: "loadout-a"},
	}
	first, err := cognitionMemoryEmbeddingSpaceIdentity(localA, profileA)
	if err != nil {
		t.Fatal(err)
	}
	sameBindingNewOwnerRevision := *localA
	sameBindingNewOwnerRevision.ConfigRevision = 12
	same, err := cognitionMemoryEmbeddingSpaceIdentity(&sameBindingNewOwnerRevision, profileA)
	if err != nil || same != first {
		t.Fatalf("unrelated AIConfig revision changed embedding identity: first=%q same=%q err=%v", first, same, err)
	}
	differentLoadout := *localA
	differentLoadout.LocalBinding = &cognitionmemory.MemoryEmbeddingLocalBindingRef{LoadoutRef: "loadout-b"}
	if got, err := cognitionMemoryEmbeddingSpaceIdentity(&differentLoadout, profileA); err != nil || got == first {
		t.Fatalf("different Local Loadout reused embedding identity: got=%q first=%q err=%v", got, first, err)
	}
	profileB := proto.Clone(profileA).(*runtimev1.MemoryEmbeddingProfile)
	profileB.ModelId = "embedding-model-b"
	profileB.Version = "asset-b"
	if got, err := cognitionMemoryEmbeddingSpaceIdentity(localA, profileB); err != nil || got == first {
		t.Fatalf("different resolved model reused embedding identity: got=%q first=%q err=%v", got, first, err)
	}
	cloud := &cognitionmemory.MemoryEmbeddingTextEmbedIntentSnapshot{
		SourceKind: cognitionmemory.MemoryEmbeddingTextEmbedSourceKindCloud,
		CloudBinding: &cognitionmemory.MemoryEmbeddingCloudBindingRef{
			ConnectorID: "connector-a", RemoteModelCatalogID: "catalog-a", ProviderModelID: "embedding-model-a", Provider: "provider-a",
		},
	}
	cloudIdentity, err := cognitionMemoryEmbeddingSpaceIdentity(cloud, profileA)
	if err != nil || cloudIdentity == first {
		got := cloudIdentity
		t.Fatalf("Cloud target reused Local embedding identity: got=%q first=%q err=%v", got, first, err)
	}
	differentCloudTarget := *cloud
	differentCloudTarget.CloudBinding = &cognitionmemory.MemoryEmbeddingCloudBindingRef{
		ConnectorID: "connector-b", RemoteModelCatalogID: "catalog-a", ProviderModelID: "embedding-model-a", Provider: "provider-a",
	}
	if got, err := cognitionMemoryEmbeddingSpaceIdentity(&differentCloudTarget, profileA); err != nil || got == cloudIdentity {
		t.Fatalf("different Cloud target reused embedding identity: got=%q first=%q err=%v", got, cloudIdentity, err)
	}
}
