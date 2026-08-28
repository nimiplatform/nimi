package grpcserver

import (
	"context"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	connectorservice "github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

type runtimeMemoryEmbeddingSubjectContextKey struct{}

func withRuntimeMemoryEmbeddingSubject(ctx context.Context, accountID string) context.Context {
	return context.WithValue(ctx, runtimeMemoryEmbeddingSubjectContextKey{}, strings.TrimSpace(accountID))
}

// @nimi-authority: rule.nimi.runtime.security-core.r064
func resolveRuntimeMemoryEmbeddingProfile(
	ctx context.Context,
	snapshot *cognitionmemory.MemoryEmbeddingTextEmbedIntentSnapshot,
	connStore *connectorservice.ConnectorStore,
	modelCatalog *catalog.Resolver,
	localResolver localexecution.Resolver,
) cognitionmemory.MemoryEmbeddingResolvedProfile {
	normalized := normalizeMemoryEmbeddingTextEmbedIntentSnapshot(snapshot)
	if !memoryEmbeddingTextEmbedIntentPresent(normalized) {
		return cognitionmemory.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "missing",
			BlockedReasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
		}
	}
	switch normalized.SourceKind {
	case cognitionmemory.MemoryEmbeddingTextEmbedSourceKindLocal:
		return resolveLocalRuntimeMemoryEmbeddingProfile(localResolver, modelCatalog, normalized.LocalBinding.LoadoutRef)
	case cognitionmemory.MemoryEmbeddingTextEmbedSourceKindCloud:
		return resolveCloudRuntimeMemoryEmbeddingProfile(ctx, normalized, connStore, modelCatalog)
	default:
		return cognitionmemory.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "missing",
			BlockedReasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
		}
	}
}

func normalizeMemoryEmbeddingTextEmbedIntentSnapshot(input *cognitionmemory.MemoryEmbeddingTextEmbedIntentSnapshot) *cognitionmemory.MemoryEmbeddingTextEmbedIntentSnapshot {
	if input == nil {
		return nil
	}
	out := &cognitionmemory.MemoryEmbeddingTextEmbedIntentSnapshot{
		SourceKind:     cognitionmemory.MemoryEmbeddingTextEmbedSourceKind(strings.ToLower(strings.TrimSpace(string(input.SourceKind)))),
		ConfigRevision: input.ConfigRevision,
		RevisionToken:  strings.TrimSpace(input.RevisionToken),
	}
	if input.CloudBinding != nil {
		out.CloudBinding = &cognitionmemory.MemoryEmbeddingCloudBindingRef{
			ConnectorID:          strings.TrimSpace(input.CloudBinding.ConnectorID),
			RemoteModelCatalogID: strings.TrimSpace(input.CloudBinding.RemoteModelCatalogID),
			ProviderModelID:      strings.TrimSpace(input.CloudBinding.ProviderModelID),
			Provider:             strings.TrimSpace(input.CloudBinding.Provider),
		}
		if out.CloudBinding.ConnectorID == "" && out.CloudBinding.RemoteModelCatalogID == "" && out.CloudBinding.ProviderModelID == "" && out.CloudBinding.Provider == "" {
			out.CloudBinding = nil
		}
	}
	if input.LocalBinding != nil {
		out.LocalBinding = &cognitionmemory.MemoryEmbeddingLocalBindingRef{
			LoadoutRef: strings.TrimSpace(input.LocalBinding.LoadoutRef),
		}
	}
	return out
}

func memoryEmbeddingTextEmbedIntentPresent(snapshot *cognitionmemory.MemoryEmbeddingTextEmbedIntentSnapshot) bool {
	if snapshot == nil {
		return false
	}
	switch snapshot.SourceKind {
	case cognitionmemory.MemoryEmbeddingTextEmbedSourceKindCloud:
		return snapshot.CloudBinding != nil
	case cognitionmemory.MemoryEmbeddingTextEmbedSourceKindLocal:
		return snapshot.LocalBinding != nil
	default:
		return false
	}
}

func resolveLocalRuntimeMemoryEmbeddingProfile(
	localResolver localexecution.Resolver,
	modelCatalog *catalog.Resolver,
	loadoutRef string,
) cognitionmemory.MemoryEmbeddingResolvedProfile {
	if localResolver == nil || modelCatalog == nil {
		return cognitionmemory.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unavailable",
			BlockedReasonCode: runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
		}
	}
	selected, err := localResolver.ResolveLocalExecution(capabilitydriver.TextEmbedCapabilityContract, loadoutRef)
	if err != nil || selected == nil || !selected.Configured ||
		selected.CapabilityContract != capabilitydriver.TextEmbedCapabilityContract ||
		len(selected.Requirements) != 1 || len(selected.ExactBindings) != 1 ||
		selected.DriverIdentity == nil {
		return cognitionmemory.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND,
		}
	}
	binding := selected.ExactBindings[0]
	modelID, dimension, ok := modelCatalog.ResolveLocalEmbeddingProfileForContent(binding.VerifiedContentID)
	if !ok || strings.TrimSpace(binding.ModelAssetID) == "" {
		return cognitionmemory.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_CAPABILITY_CATALOG_MISMATCH,
		}
	}
	return cognitionmemory.MemoryEmbeddingResolvedProfile{
		Profile: &runtimev1.MemoryEmbeddingProfile{
			Provider:        "local",
			ModelId:         modelID,
			Dimension:       dimension,
			DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
			Version:         strings.TrimSpace(binding.ModelAssetID),
			MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
		},
		ResolutionState:   "resolved",
		BlockedReasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
	}
}

func resolveCloudRuntimeMemoryEmbeddingProfile(
	ctx context.Context,
	snapshot *cognitionmemory.MemoryEmbeddingTextEmbedIntentSnapshot,
	connStore *connectorservice.ConnectorStore,
	modelCatalog *catalog.Resolver,
) cognitionmemory.MemoryEmbeddingResolvedProfile {
	if snapshot == nil || snapshot.CloudBinding == nil {
		return cognitionmemory.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	if connStore == nil || modelCatalog == nil {
		return cognitionmemory.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unavailable",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	connectorID := strings.TrimSpace(snapshot.CloudBinding.ConnectorID)
	remoteModelCatalogID := strings.TrimSpace(snapshot.CloudBinding.RemoteModelCatalogID)
	providerModelID := strings.TrimSpace(snapshot.CloudBinding.ProviderModelID)
	record, found, err := connStore.Get(connectorID)
	if err != nil {
		return cognitionmemory.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unavailable",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	if !found ||
		!memoryEmbeddingConnectorVisibleToCaller(ctx, record) ||
		record.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED ||
		record.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE ||
		!record.HasCredential {
		return cognitionmemory.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	providerID := strings.TrimSpace(record.Provider)
	if providerID == "" || providerModelID == "" || remoteModelCatalogID == "" {
		return cognitionmemory.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_AI_MEMORY_EMBEDDING_TARGET_REF_INVALID,
		}
	}
	subjectUserID := memoryEmbeddingSubjectUserID(ctx)
	binding, bindingErr := connectorservice.ResolveRemoteModelCatalogBinding(modelCatalog, subjectUserID, record, connectorservice.RemoteModelCatalogRef{
		ConnectorID:          connectorID,
		RemoteModelCatalogID: remoteModelCatalogID,
		ProviderModelID:      providerModelID,
		Provider:             strings.TrimSpace(snapshot.CloudBinding.Provider),
	})
	if bindingErr != nil {
		return cognitionmemory.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: memoryEmbeddingReasonCodeFromError(bindingErr, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE),
		}
	}
	modelID := strings.TrimSpace(binding.ProviderModelID)
	supported, supportErr := modelCatalog.SupportsCapabilityForSubject(subjectUserID, providerID, modelID, "text.embed")
	if supportErr != nil && !errors.Is(supportErr, catalog.ErrModelNotFound) {
		return cognitionmemory.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unavailable",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	if !supported {
		return cognitionmemory.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	// K-MEM-004 / K-AIEXEC-006: embedding dimension is profile identity sourced
	// from the catalog row, never hardcoded. A text.embed model with no admitted
	// catalog dimension (e.g. preview/variable-dimension models) must fail-close
	// rather than fabricate a dimension or silently retarget.
	dimension, ok := resolveCatalogEmbeddingDimension(modelCatalog, providerID, modelID)
	if !ok {
		return cognitionmemory.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_CAPABILITY_CATALOG_MISMATCH,
		}
	}
	return cognitionmemory.MemoryEmbeddingResolvedProfile{
		Profile: &runtimev1.MemoryEmbeddingProfile{
			Provider:  providerID,
			ModelId:   modelID,
			Dimension: dimension,
			// DistanceMetric / MigrationPolicy are runtime memory-bank policy,
			// not model-catalog facts; they remain runtime-owned constants.
			DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
			Version:         connectorID,
			MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
			CloudBinding: &runtimev1.MemoryEmbeddingCloudBindingRef{
				ConnectorId:          binding.ConnectorID,
				RemoteModelCatalogId: binding.RemoteModelCatalogID,
				ProviderModelId:      binding.ProviderModelID,
				Provider:             binding.Provider,
			},
		},
		ResolutionState:   "resolved",
		BlockedReasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
	}
}

func memoryEmbeddingConnectorVisibleToCaller(ctx context.Context, record connectorservice.ConnectorRecord) bool {
	if record.AuthKind == runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED &&
		record.OwnerType != runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER {
		return false
	}
	if record.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM {
		return true
	}
	if record.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED {
		return true
	}
	subjectUserID := memoryEmbeddingSubjectUserID(ctx)
	return subjectUserID != "" && subjectUserID == strings.TrimSpace(record.OwnerID)
}

func memoryEmbeddingReasonCodeFromError(err error, fallback runtimev1.ReasonCode) runtimev1.ReasonCode {
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		return reason
	}
	if fallback != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return fallback
	}
	return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
}

func memoryEmbeddingSubjectUserID(ctx context.Context) string {
	if subject, ok := ctx.Value(runtimeMemoryEmbeddingSubjectContextKey{}).(string); ok && strings.TrimSpace(subject) == subject && subject != "" {
		return subject
	}
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		return strings.TrimSpace(identity.SubjectUserID)
	}
	return ""
}

// resolveCatalogEmbeddingDimension returns the catalog-authoritative output
// dimension for a `text.embed` model (K-MEM-004 / K-AIEXEC-006). It is the
// single source of embedding-profile dimension truth: the resolver is the model
// catalog, never the local asset record and never a hardcoded constant. It
// returns ok=false (caller fails-close) when the model is unknown, has no
// admitted `embedding` block, or carries a non-positive dimension.
func resolveCatalogEmbeddingDimension(modelCatalog *catalog.Resolver, provider string, modelID string) (int32, bool) {
	if modelCatalog == nil {
		return 0, false
	}
	if strings.TrimSpace(provider) == "" || strings.TrimSpace(modelID) == "" {
		return 0, false
	}
	entry, err := modelCatalog.ResolveModelEntry(provider, modelID)
	if err != nil {
		return 0, false
	}
	if entry.Embedding == nil || entry.Embedding.Dimension <= 0 {
		return 0, false
	}
	return entry.Embedding.Dimension, true
}
