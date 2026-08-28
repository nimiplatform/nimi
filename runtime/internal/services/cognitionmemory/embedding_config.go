package cognitionmemory

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

// MemoryEmbeddingTextEmbedSourceKind identifies the account-scoped AIConfig
// source selected for Cognition Memory embedding execution.
type MemoryEmbeddingTextEmbedSourceKind string

const (
	MemoryEmbeddingTextEmbedSourceKindUnspecified MemoryEmbeddingTextEmbedSourceKind = ""
	MemoryEmbeddingTextEmbedSourceKindCloud       MemoryEmbeddingTextEmbedSourceKind = "cloud"
	MemoryEmbeddingTextEmbedSourceKindLocal       MemoryEmbeddingTextEmbedSourceKind = "local"
)

type MemoryEmbeddingCloudBindingRef struct {
	ConnectorID          string
	RemoteModelCatalogID string
	ProviderModelID      string
	Provider             string
}

// MemoryEmbeddingLocalBindingRef carries only the selected Loadout reference;
// the exact model binding is resolved from Runtime's local execution owner.
type MemoryEmbeddingLocalBindingRef struct {
	LoadoutRef string
}

type MemoryEmbeddingTextEmbedIntentSnapshot struct {
	SourceKind     MemoryEmbeddingTextEmbedSourceKind
	CloudBinding   *MemoryEmbeddingCloudBindingRef
	LocalBinding   *MemoryEmbeddingLocalBindingRef
	ConfigRevision uint64
}

type MemoryEmbeddingResolvedProfile struct {
	Profile           *runtimev1.MemoryEmbeddingProfile
	ResolutionState   string
	BlockedReasonCode runtimev1.ReasonCode
}
