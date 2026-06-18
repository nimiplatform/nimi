package localservice

import (
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (s *Service) ensureManagedImageProfileMaterializationFromSelectedSources(localAssetID string, assetID string) bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.managedImageProfiles == nil {
		s.managedImageProfiles = make(map[string]managedImageProfileState)
	}
	asset := s.managedImageProfileMaterializationAssetLocked(localAssetID, assetID)
	if asset == nil {
		return false
	}
	id := strings.TrimSpace(asset.GetLocalAssetId())
	if existing, ok := s.managedImageProfiles[id]; ok && existing.MaterializationResolved && len(existing.MaterializationBindings) > 0 {
		return true
	}
	bindings, ok := s.managedImageProfileMaterializationBindingsFromSelectedSourcesLocked(asset)
	if !ok {
		return false
	}
	s.managedImageProfiles[id] = managedImageProfileState{
		Alias:                   "selected-source-" + shortHash(id+"|"+asset.GetAssetId()+"|"+managedImageMaterializationBindingDigest(bindings)),
		MaterializationResolved: true,
		MaterializationBindings: cloneManagedMediaProfileMaterializationBindings(bindings),
	}
	s.persistStateLocked()
	return true
}

func (s *Service) healManagedImageProfileMaterializationsFromSelectedSourcesLocked() int {
	if s == nil {
		return 0
	}
	if s.managedImageProfiles == nil {
		s.managedImageProfiles = make(map[string]managedImageProfileState)
	}
	localAssetIDs := make([]string, 0, len(s.assets))
	for localAssetID, asset := range s.assets {
		if !managedImageProfileMaterializationCandidate(asset) {
			continue
		}
		if existing, ok := s.managedImageProfiles[localAssetID]; ok && existing.MaterializationResolved && len(existing.MaterializationBindings) > 0 {
			continue
		}
		localAssetIDs = append(localAssetIDs, localAssetID)
	}
	sort.Strings(localAssetIDs)
	healed := 0
	for _, localAssetID := range localAssetIDs {
		asset := s.assets[localAssetID]
		bindings, ok := s.managedImageProfileMaterializationBindingsFromSelectedSourcesLocked(asset)
		if !ok {
			continue
		}
		s.managedImageProfiles[localAssetID] = managedImageProfileState{
			Alias:                   "selected-source-" + shortHash(localAssetID+"|"+asset.GetAssetId()+"|"+managedImageMaterializationBindingDigest(bindings)),
			MaterializationResolved: true,
			MaterializationBindings: cloneManagedMediaProfileMaterializationBindings(bindings),
		}
		healed++
	}
	return healed
}

func (s *Service) managedImageProfileMaterializationAssetLocked(localAssetID string, assetID string) *runtimev1.LocalAssetRecord {
	if s == nil {
		return nil
	}
	id := strings.TrimSpace(localAssetID)
	if id != "" {
		if asset := s.assets[id]; managedImageProfileMaterializationCandidate(asset) {
			return asset
		}
	}
	identity := strings.TrimSpace(assetID)
	if identity == "" {
		return nil
	}
	for _, asset := range s.assets {
		if localAssetRecordMatchesIdentity(asset, identity) && managedImageProfileMaterializationCandidate(asset) {
			return asset
		}
	}
	return nil
}

func managedImageProfileMaterializationCandidate(asset *runtimev1.LocalAssetRecord) bool {
	if !localStateAssetAdmitted(asset) {
		return false
	}
	if asset.GetKind() == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE {
		return true
	}
	return isCanonicalSupervisedImageAsset(asset.GetEngine(), asset.GetCapabilities(), asset.GetKind())
}

func (s *Service) managedImageProfileMaterializationBindingsFromSelectedSourcesLocked(asset *runtimev1.LocalAssetRecord) ([]managedMediaProfileMaterializationBinding, bool) {
	if asset == nil {
		return nil, false
	}
	localAssetID := strings.TrimSpace(asset.GetLocalAssetId())
	assetID := strings.TrimSpace(asset.GetAssetId())
	if localAssetID == "" || assetID == "" {
		return nil, false
	}
	if _, ok := s.readySelectedModelAssetSourceLocked(localAssetID, assetID); !ok {
		return nil, false
	}
	bindings := []managedMediaProfileMaterializationBinding{{
		AssetID:      assetID,
		LocalAssetID: localAssetID,
	}}
	companionRecords := s.readySelectedCompanionSourcesForParentLocked(assetID)
	if len(companionRecords) == 0 {
		return nil, false
	}
	usedSlots := map[string]struct{}{}
	for _, record := range companionRecords {
		companionAssetID, parentAssetID, ok := parseLocalEnvironmentCompanionDependencyID(record.DependencyID)
		if !ok || parentAssetID != assetID {
			return nil, false
		}
		companionAsset := s.localStateAssetByAssetIDLocked(companionAssetID)
		companionKind, engineSlot, ok := managedImageCompanionKindAndEngineSlot(companionAsset)
		if !ok {
			return nil, false
		}
		if _, exists := usedSlots[engineSlot]; exists {
			return nil, false
		}
		usedSlots[engineSlot] = struct{}{}
		bindings = append(bindings, managedMediaProfileMaterializationBinding{
			AssetID:          assetID,
			LocalAssetID:     localAssetID,
			CompanionKind:    companionKind,
			EngineSlot:       engineSlot,
			CompanionAssetID: companionAssetID,
			ParentAssetID:    assetID,
		})
	}
	return bindings, true
}

func (s *Service) readySelectedModelAssetSourceLocked(localAssetID string, assetID string) (localEnvironmentSelectedSourceRecordState, bool) {
	semanticAssetID := strings.TrimSpace(assetID)
	if semanticAssetID == "" || strings.TrimSpace(localAssetID) == "" {
		return localEnvironmentSelectedSourceRecordState{}, false
	}
	for _, record := range s.localEnvironmentSelectedSources {
		if strings.TrimSpace(record.DependencyFamily) != localEnvironmentFamilyModelAsset {
			continue
		}
		dependencyID := strings.TrimSpace(record.DependencyID)
		if dependencyID != semanticAssetID {
			continue
		}
		if !localEnvironmentSelectedSourceRecordAdmitsStableDiffusionConsumer(record) {
			continue
		}
		if !localEnvironmentSelectedSourceRecordReady(record) {
			continue
		}
		return record, true
	}
	return localEnvironmentSelectedSourceRecordState{}, false
}

func (s *Service) readySelectedCompanionSourcesForParentLocked(parentAssetID string) []localEnvironmentSelectedSourceRecordState {
	parent := strings.TrimSpace(parentAssetID)
	if parent == "" {
		return nil
	}
	records := make([]localEnvironmentSelectedSourceRecordState, 0)
	for _, record := range s.localEnvironmentSelectedSources {
		if strings.TrimSpace(record.DependencyFamily) != localEnvironmentFamilyModelCompanion {
			continue
		}
		_, recordParent, ok := parseLocalEnvironmentCompanionDependencyID(record.DependencyID)
		if !ok || recordParent != parent {
			continue
		}
		if !localEnvironmentSelectedSourceRecordAdmitsStableDiffusionConsumer(record) {
			continue
		}
		if !localEnvironmentSelectedSourceRecordReady(record) {
			continue
		}
		records = append(records, record)
	}
	sort.SliceStable(records, func(i, j int) bool {
		return strings.TrimSpace(records[i].DependencyID) < strings.TrimSpace(records[j].DependencyID)
	})
	return records
}

func parseLocalEnvironmentCompanionDependencyID(dependencyID string) (string, string, bool) {
	parts := strings.Split(strings.TrimSpace(dependencyID), "|")
	if len(parts) != 2 {
		return "", "", false
	}
	companionAssetID := strings.TrimPrefix(strings.TrimSpace(parts[0]), "asset_id=")
	parentAssetID := strings.TrimPrefix(strings.TrimSpace(parts[1]), "parent_asset_id=")
	if companionAssetID == strings.TrimSpace(parts[0]) || parentAssetID == strings.TrimSpace(parts[1]) {
		return "", "", false
	}
	companionAssetID = strings.TrimSpace(companionAssetID)
	parentAssetID = strings.TrimSpace(parentAssetID)
	if companionAssetID == "" || parentAssetID == "" {
		return "", "", false
	}
	return companionAssetID, parentAssetID, true
}

func localEnvironmentSelectedSourceRecordReady(record localEnvironmentSelectedSourceRecordState) bool {
	if err := validateLocalEnvironmentSelectedSourceRecord(record); err != nil {
		return false
	}
	if err := validateLocalEnvironmentSelectedSourceLocalArtifacts(record); err != nil {
		return false
	}
	return true
}

func localEnvironmentSelectedSourceRecordAdmitsStableDiffusionConsumer(record localEnvironmentSelectedSourceRecordState) bool {
	for _, consumer := range normalizeStringSlice(record.SelectedConsumers) {
		switch strings.TrimSpace(consumer) {
		case "stable-diffusion.cpp.cpu", "stable-diffusion.cpp.metal", stableDiffusionCUDAConsumerID:
			return true
		}
	}
	return false
}

func (s *Service) localStateAssetByAssetIDLocked(assetID string) *runtimev1.LocalAssetRecord {
	identity := strings.TrimSpace(assetID)
	if identity == "" {
		return nil
	}
	for _, asset := range s.assets {
		if strings.TrimSpace(asset.GetAssetId()) == identity && localStateAssetAdmitted(asset) {
			return asset
		}
	}
	return nil
}

func managedImageCompanionKindAndEngineSlot(asset *runtimev1.LocalAssetRecord) (string, string, bool) {
	if !localStateAssetAdmitted(asset) {
		return "", "", false
	}
	kind := effectiveAssetKind(asset.GetKind(), asset.GetCapabilities())
	companionKind, err := localAssetKindToken(kind)
	if err != nil {
		return "", "", false
	}
	switch kind {
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE:
		return companionKind, "vae_path", true
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CLIP,
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY:
		return companionKind, "llm_path", true
	default:
		return "", "", false
	}
}

func managedImageMaterializationBindingDigest(bindings []managedMediaProfileMaterializationBinding) string {
	parts := make([]string, 0, len(bindings))
	for _, binding := range bindings {
		parts = append(parts, strings.Join([]string{
			strings.TrimSpace(binding.AssetID),
			strings.TrimSpace(binding.LocalAssetID),
			strings.TrimSpace(binding.CompanionKind),
			strings.TrimSpace(binding.EngineSlot),
			strings.TrimSpace(binding.CompanionAssetID),
			strings.TrimSpace(binding.ParentAssetID),
		}, "|"))
	}
	return strings.Join(parts, "\n")
}
