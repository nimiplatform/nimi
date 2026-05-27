package daemon

import (
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func selectManagedEmbeddingProfile(assets []*runtimev1.LocalAssetRecord) *runtimev1.MemoryEmbeddingProfile {
	if len(assets) == 0 {
		return nil
	}
	filtered := make([]*runtimev1.LocalAssetRecord, 0, len(assets))
	for _, asset := range assets {
		if asset == nil || asset.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
			continue
		}
		filtered = append(filtered, asset)
	}
	if len(filtered) == 0 {
		return nil
	}
	sort.Slice(filtered, func(i, j int) bool {
		assetIDI := strings.TrimSpace(filtered[i].GetAssetId())
		assetIDJ := strings.TrimSpace(filtered[j].GetAssetId())
		if assetIDI != assetIDJ {
			return assetIDI < assetIDJ
		}
		return strings.TrimSpace(filtered[i].GetLocalAssetId()) < strings.TrimSpace(filtered[j].GetLocalAssetId())
	})
	selected := filtered[0]
	modelID := strings.TrimSpace(selected.GetAssetId())
	if modelID == "" {
		modelID = strings.TrimSpace(selected.GetLocalAssetId())
	}
	if modelID == "" {
		return nil
	}
	version := modelID
	timestamp := strings.TrimSpace(selected.GetUpdatedAt())
	if timestamp == "" {
		timestamp = strings.TrimSpace(selected.GetInstalledAt())
	}
	if timestamp != "" {
		version = modelID + "@" + timestamp
	}
	return &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         modelID,
		Dimension:       256,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         version,
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	}
}
