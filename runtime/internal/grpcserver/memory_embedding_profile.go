package grpcserver

import (
	"context"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
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
		return resolveLocalRuntimeMemoryEmbeddingProfile(ctx, normalized, localSvc)
	case memoryservice.MemoryEmbeddingBindingSourceKindCloud:
		return resolveCloudRuntimeMemoryEmbeddingProfile(normalized, connStore, modelCatalog)
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
			ConnectorID: strings.TrimSpace(input.CloudBinding.ConnectorID),
			ModelID:     strings.TrimSpace(input.CloudBinding.ModelID),
		}
		if out.CloudBinding.ConnectorID == "" && out.CloudBinding.ModelID == "" {
			out.CloudBinding = nil
		}
	}
	if input.LocalBinding != nil {
		out.LocalBinding = &memoryservice.MemoryEmbeddingLocalBindingRef{
			LocalModelID: strings.TrimSpace(input.LocalBinding.LocalModelID),
		}
		if out.LocalBinding.LocalModelID == "" {
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
	targetID := strings.TrimSpace(snapshot.LocalBinding.LocalModelID)
	for _, asset := range resp.GetAssets() {
		if asset == nil {
			continue
		}
		if !memoryEmbeddingLocalTargetMatches(asset, targetID) {
			continue
		}
		return memoryservice.MemoryEmbeddingResolvedProfile{
			Profile: &runtimev1.MemoryEmbeddingProfile{
				Provider:       "local",
				ModelId:        strings.TrimSpace(asset.GetAssetId()),
				Dimension:      256,
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
	modelID := strings.TrimSpace(snapshot.CloudBinding.ModelID)
	record, found, err := connStore.Get(connectorID)
	if err != nil {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unavailable",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	if !found ||
		record.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED ||
		record.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE ||
		!record.HasCredential {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	providerID := strings.TrimSpace(record.Provider)
	if providerID == "" || modelID == "" {
		return memoryservice.MemoryEmbeddingResolvedProfile{
			ResolutionState:   "unresolved",
			BlockedReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		}
	}
	supported, supportErr := modelCatalog.SupportsCapabilityForSubject("", providerID, modelID, "text.embed")
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
	return memoryservice.MemoryEmbeddingResolvedProfile{
		Profile: &runtimev1.MemoryEmbeddingProfile{
			Provider:        providerID,
			ModelId:         modelID,
			Dimension:       256,
			DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
			Version:         connectorID,
			MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
		},
		ResolutionState:   "resolved",
		BlockedReasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
	}
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
