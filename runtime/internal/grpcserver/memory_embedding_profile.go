package grpcserver

import (
	"context"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	connectorservice "github.com/nimiplatform/nimi/runtime/internal/services/connector"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

func resolveRuntimeMemoryEmbeddingProfile(
	ctx context.Context,
	snapshot *memoryservice.MemoryEmbeddingBindingIntentSnapshot,
	localSvc *localservice.Service,
	connStore *connectorservice.ConnectorStore,
	modelCatalog *catalog.Resolver,
) memoryservice.MemoryEmbeddingResolvedProfile {
	normalized := normalizeMemoryEmbeddingBindingIntentSnapshot(snapshot)
	if !memoryEmbeddingBindingIntentPresent(normalized) {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "missing",
			BlockedReasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
		}
	}
	switch normalized.SourceKind {
	case memoryservice.MemoryEmbeddingBindingSourceKindLocal:
		return resolveLocalRuntimeMemoryEmbeddingProfile(ctx, normalized, localSvc, modelCatalog)
	case memoryservice.MemoryEmbeddingBindingSourceKindCloud:
		return resolveCloudRuntimeMemoryEmbeddingProfile(ctx, normalized, connStore, modelCatalog)
	default:
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "missing",
			BlockedReasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
		}
	}
}

func normalizeMemoryEmbeddingBindingIntentSnapshot(input *memoryservice.MemoryEmbeddingBindingIntentSnapshot) *memoryservice.MemoryEmbeddingBindingIntentSnapshot {
	if input == nil {
		return nil
	}
	out := &memoryservice.MemoryEmbeddingBindingIntentSnapshot{
		SourceKind:    memoryservice.MemoryEmbeddingBindingSourceKind(strings.ToLower(strings.TrimSpace(string(input.SourceKind)))),
		RevisionToken: strings.TrimSpace(input.RevisionToken),
	}
	if input.CloudBinding != nil {
		out.CloudBinding = &memoryservice.MemoryEmbeddingCloudBindingRef{
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
		out.LocalBinding = &memoryservice.MemoryEmbeddingLocalBindingRef{
			ProfileBindingID: strings.TrimSpace(input.LocalBinding.ProfileBindingID),
			ReadinessRef:     strings.TrimSpace(input.LocalBinding.ReadinessRef),
		}
		if out.LocalBinding.ProfileBindingID == "" && out.LocalBinding.ReadinessRef == "" {
			out.LocalBinding = nil
		}
	}
	return out
}

func memoryEmbeddingBindingIntentPresent(snapshot *memoryservice.MemoryEmbeddingBindingIntentSnapshot) bool {
	if snapshot == nil {
		return false
	}
	switch snapshot.SourceKind {
	case memoryservice.MemoryEmbeddingBindingSourceKindCloud:
		return snapshot.CloudBinding != nil
	case memoryservice.MemoryEmbeddingBindingSourceKindLocal:
		return snapshot.LocalBinding != nil
	default:
		return false
	}
}

func resolveLocalRuntimeMemoryEmbeddingProfile(
	ctx context.Context,
	snapshot *memoryservice.MemoryEmbeddingBindingIntentSnapshot,
	localSvc *localservice.Service,
	modelCatalog *catalog.Resolver,
) memoryservice.MemoryEmbeddingResolvedProfile {
	if snapshot == nil || snapshot.LocalBinding == nil {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
		}
	}
	if localSvc == nil {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unavailable",
			BlockedReasonCode: runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
		}
	}
	// K-MEM-004 / K-AIEXEC-006: embedding dimension is part of the embedding
	// profile identity and its authority is the runtime model catalog, not the
	// local asset record. Without the catalog we cannot mint an admitted profile.
	if modelCatalog == nil {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unavailable",
			BlockedReasonCode: runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
		}
	}
	resp, err := localSvc.ListLocalAssets(ctx, &runtimev1.ListLocalAssetsRequest{
		StatusFilter: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		KindFilter:   runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING,
	})
	if err != nil {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unavailable",
			BlockedReasonCode: runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
		}
	}
	targetID := strings.TrimSpace(snapshot.LocalBinding.ProfileBindingID)
	if targetID == "" {
		targetID = strings.TrimSpace(snapshot.LocalBinding.ReadinessRef)
	}
	for _, asset := range resp.GetAssets() {
		if asset == nil {
			continue
		}
		if !memoryEmbeddingLocalTargetMatches(asset, targetID) {
			continue
		}
		// The local asset is install/inventory evidence only. Resolve the
		// catalog-authoritative dimension by mapping the asset back to its
		// `local` catalog row (logical model id, falling back to asset id).
		// A local embedding asset with no admitted catalog dimension must
		// fail-close rather than fabricate a dimension.
		dimension, ok := resolveCatalogEmbeddingDimension(
			modelCatalog,
			"local",
			memoryEmbeddingLocalCatalogModelRef(asset),
		)
		if !ok {
			return memoryservice.MemoryEmbeddingResolvedProfile{
				ResolutionState:   "unresolved",
				BlockedReasonCode: runtimev1.ReasonCode_AI_LOCAL_MODEL_PROFILE_MISSING,
			}
		}
		return memoryservice.MemoryEmbeddingResolvedProfile{
			Profile: &runtimev1.MemoryEmbeddingProfile{
				Provider:  "local",
				ModelId:   strings.TrimSpace(asset.GetAssetId()),
				Dimension: dimension,
				// DistanceMetric / MigrationPolicy are runtime memory-bank policy,
				// not model-catalog facts; they remain runtime-owned constants.
				DistanceMetric: runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
				Version: func() string {
					if value := strings.TrimSpace(asset.GetLocalAssetId()); value != "" {
						return value
					}
					return strings.TrimSpace(asset.GetAssetId())
				}(),
				MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
			},
			ResolutionState:   "resolved",
			BlockedReasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
		}
	}
	return memoryservice.MemoryEmbeddingResolvedProfile{
		ResolutionState:   "unresolved",
		BlockedReasonCode: runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
	}
}

func resolveCloudRuntimeMemoryEmbeddingProfile(
	ctx context.Context,
	snapshot *memoryservice.MemoryEmbeddingBindingIntentSnapshot,
	connStore *connectorservice.ConnectorStore,
	modelCatalog *catalog.Resolver,
) memoryservice.MemoryEmbeddingResolvedProfile {
	if snapshot == nil || snapshot.CloudBinding == nil {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	if connStore == nil || modelCatalog == nil {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unavailable",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	connectorID := strings.TrimSpace(snapshot.CloudBinding.ConnectorID)
	remoteModelCatalogID := strings.TrimSpace(snapshot.CloudBinding.RemoteModelCatalogID)
	providerModelID := strings.TrimSpace(snapshot.CloudBinding.ProviderModelID)
	record, found, err := connStore.Get(connectorID)
	if err != nil {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unavailable",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	if !found ||
		!memoryEmbeddingConnectorVisibleToCaller(ctx, record) ||
		record.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED ||
		record.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE ||
		!record.HasCredential {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	providerID := strings.TrimSpace(record.Provider)
	if providerID == "" || providerModelID == "" || remoteModelCatalogID == "" {
		return memoryservice.MemoryEmbeddingResolvedProfile{
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
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: memoryEmbeddingReasonCodeFromError(bindingErr, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE),
		}
	}
	modelID := strings.TrimSpace(binding.ProviderModelID)
	supported, supportErr := modelCatalog.SupportsCapabilityForSubject(subjectUserID, providerID, modelID, "text.embed")
	if supportErr != nil && !errors.Is(supportErr, catalog.ErrModelNotFound) {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unavailable",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	if !supported {
		return memoryservice.MemoryEmbeddingResolvedProfile{
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
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_CAPABILITY_CATALOG_MISMATCH,
		}
	}
	return memoryservice.MemoryEmbeddingResolvedProfile{
		Profile: &runtimev1.MemoryEmbeddingProfile{
			Provider:  providerID,
			ModelId:   modelID,
			Dimension: dimension,
			// DistanceMetric / MigrationPolicy are runtime memory-bank policy,
			// not model-catalog facts; they remain runtime-owned constants.
			DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
			Version:         connectorID,
			MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
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
	identity := authn.IdentityFromContext(ctx)
	if identity == nil {
		return false
	}
	return strings.TrimSpace(identity.SubjectUserID) != "" && strings.TrimSpace(identity.SubjectUserID) == strings.TrimSpace(record.OwnerID)
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

// memoryEmbeddingLocalCatalogModelRef chooses the model reference used to look
// up a local embedding asset's catalog row. The logical model id (e.g.
// `local/nomic-embed-text`) is the catalog-facing identity; the variant-level
// asset id is the fallback when no logical id is recorded.
func memoryEmbeddingLocalCatalogModelRef(asset *runtimev1.LocalAssetRecord) string {
	if asset == nil {
		return ""
	}
	if logical := strings.TrimSpace(asset.GetLogicalModelId()); logical != "" {
		return logical
	}
	return strings.TrimSpace(asset.GetAssetId())
}

func memoryEmbeddingLocalTargetMatches(asset *runtimev1.LocalAssetRecord, targetID string) bool {
	if asset == nil {
		return false
	}
	normalized := strings.TrimSpace(targetID)
	if normalized == "" {
		return false
	}
	return normalized == strings.TrimSpace(asset.GetAssetId()) || normalized == strings.TrimSpace(asset.GetLocalAssetId())
}
