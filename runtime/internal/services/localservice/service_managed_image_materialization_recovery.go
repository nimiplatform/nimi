package localservice

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// managedImageProfileEntriesFromRuntimeMaterialization projects an exact,
// descriptor-prepared materialization into the existing internal slot resolver
// shape. The projection remains Runtime-private and never becomes scenario
// extension input.
func (s *Service) managedImageProfileEntriesFromRuntimeMaterialization(
	model *runtimev1.LocalAssetRecord,
) ([]*runtimev1.LocalProfileEntryDescriptor, map[string]string, string, bool) {
	if s == nil || model == nil {
		return nil, nil, "", false
	}
	localAssetID := strings.TrimSpace(model.GetLocalAssetId())
	assetID := strings.TrimSpace(model.GetAssetId())
	if localAssetID == "" || assetID == "" {
		return nil, nil, "", false
	}
	cached, ok := s.cachedManagedMediaImageProfile(localAssetID)
	if !ok ||
		!cached.MaterializationResolved ||
		!strings.HasPrefix(strings.TrimSpace(cached.Alias), profileRuntimeMaterializationKeyPrefix) ||
		len(cached.MaterializationBindings) == 0 {
		return nil, nil, "", false
	}

	entries := make([]*runtimev1.LocalProfileEntryDescriptor, 0, len(cached.MaterializationBindings))
	overrides := make(map[string]string, len(cached.MaterializationBindings))
	mainCount := 0

	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, binding := range cached.MaterializationBindings {
		companionAssetID := strings.TrimSpace(binding.CompanionAssetID)
		if companionAssetID == "" {
			if strings.TrimSpace(binding.AssetID) != assetID ||
				strings.TrimSpace(binding.LocalAssetID) != localAssetID ||
				strings.TrimSpace(binding.CompanionKind) != "" ||
				strings.TrimSpace(binding.EngineSlot) != "" ||
				strings.TrimSpace(binding.CompanionLocalAssetID) != "" ||
				strings.TrimSpace(binding.ParentAssetID) != "" {
				return nil, nil, "", false
			}
			mainCount++
			if mainCount != 1 {
				return nil, nil, "", false
			}
			const entryID = "runtime-materialization:main"
			entries = append(entries, &runtimev1.LocalProfileEntryDescriptor{
				EntryId:    entryID,
				Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
				Capability: "image.generate",
				AssetId:    assetID,
				AssetKind:  effectiveAssetKind(model.GetKind(), model.GetCapabilities()),
				Engine:     strings.TrimSpace(model.GetEngine()),
			})
			overrides[entryID] = localAssetID
			continue
		}

		engineSlot := strings.TrimSpace(binding.EngineSlot)
		companionLocalAssetID := strings.TrimSpace(binding.CompanionLocalAssetID)
		if strings.TrimSpace(binding.AssetID) != assetID ||
			strings.TrimSpace(binding.LocalAssetID) != localAssetID ||
			strings.TrimSpace(binding.ParentAssetID) != assetID ||
			strings.TrimSpace(binding.CompanionKind) == "" ||
			engineSlot == "" ||
			companionLocalAssetID == "" {
			return nil, nil, "", false
		}
		companion := s.assets[companionLocalAssetID]
		if !profileEntryInstalledAssetUsable(companion) ||
			strings.TrimSpace(companion.GetLocalAssetId()) != companionLocalAssetID ||
			strings.TrimSpace(companion.GetAssetId()) != companionAssetID {
			return nil, nil, "", false
		}
		companionKind, ok := parseLocalAssetKindToken(binding.CompanionKind)
		if !ok || effectiveAssetKind(companion.GetKind(), companion.GetCapabilities()) != companionKind {
			return nil, nil, "", false
		}
		entryID := "runtime-materialization:" + engineSlot
		if _, exists := overrides[entryID]; exists {
			return nil, nil, "", false
		}
		entries = append(entries, &runtimev1.LocalProfileEntryDescriptor{
			EntryId:    entryID,
			Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
			Capability: "image.generate",
			AssetId:    companionAssetID,
			AssetKind:  companionKind,
			EngineSlot: engineSlot,
			Engine:     strings.TrimSpace(companion.GetEngine()),
		})
		overrides[entryID] = companionLocalAssetID
	}
	if mainCount != 1 {
		return nil, nil, "", false
	}
	return entries, overrides, strings.TrimSpace(cached.Alias), true
}
