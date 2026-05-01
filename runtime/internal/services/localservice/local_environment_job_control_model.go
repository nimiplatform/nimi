package localservice

import (
	"context"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (s *Service) executeModelAssetEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState) (localEnvironmentDependencyJobResult, error) {
	model, entryPath, entryHash, sourceKind, err := s.verifyLocalEnvironmentModelAsset(ctx, job.DependencyID)
	if err != nil {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	if model == nil || strings.TrimSpace(entryPath) == "" || strings.TrimSpace(entryHash) == "" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	return localEnvironmentDependencyJobResult{
		State:         localEnvironmentStateReadyManaged,
		SourceKind:    sourceKind,
		CanonicalRoot: strings.TrimSpace(entryPath),
		Version:       strings.TrimSpace(model.GetUpdatedAt()),
		CompatibilityEvidence: normalizeStringSlice([]string{
			"asset_id=" + strings.TrimSpace(model.GetAssetId()),
			"local_asset_id=" + strings.TrimSpace(model.GetLocalAssetId()),
			"logical_model_id=" + strings.TrimSpace(model.GetLogicalModelId()),
			"capabilities=" + strings.Join(normalizeStringSlice(model.GetCapabilities()), ","),
			"source_repo=" + strings.TrimSpace(model.GetSource().GetRepo()),
			"source_revision=" + strings.TrimSpace(model.GetSource().GetRevision()),
		}),
		VerifiedArtifacts: normalizeStringSlice([]string{strings.TrimSpace(entryPath)}),
		Hashes: mergeStringMaps(cloneStringMap(model.GetHashes()), map[string]string{
			"entry_sha256":   strings.TrimSpace(entryHash),
			"asset_id":       strings.TrimSpace(model.GetAssetId()),
			"local_asset_id": strings.TrimSpace(model.GetLocalAssetId()),
		}),
		SelectedConsumers: modelAssetSelectedConsumers(job.EnvironmentKey),
		AuditReasonCode:   "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	}, nil
}

func (s *Service) executeModelCompanionEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState) (localEnvironmentDependencyJobResult, error) {
	parentAssetID := companionParentAssetIDFromDependencyID(job.DependencyID)
	parentRecord, ok := s.selectedModelAssetSourceForAssetID(parentAssetID)
	if !ok || strings.TrimSpace(parentRecord.RecordID) == "" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateFailed,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_PREREQUISITE_MISSING",
		}, nil
	}
	model, entryPath, entryHash, sourceKind, err := s.verifyLocalEnvironmentModelAsset(ctx, job.DependencyID)
	if err != nil {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	if model == nil || strings.TrimSpace(entryPath) == "" || strings.TrimSpace(entryHash) == "" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	if strings.TrimSpace(model.GetAssetId()) == parentAssetID {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateFailed,
			SourceKind:      sourceKind,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_PREREQUISITE_MISSING",
		}, nil
	}
	return localEnvironmentDependencyJobResult{
		State:         localEnvironmentStateReadyManaged,
		SourceKind:    sourceKind,
		CanonicalRoot: strings.TrimSpace(entryPath),
		Version:       strings.TrimSpace(model.GetUpdatedAt()),
		CompatibilityEvidence: normalizeStringSlice([]string{
			"companion_asset_id=" + strings.TrimSpace(model.GetAssetId()),
			"companion_local_asset_id=" + strings.TrimSpace(model.GetLocalAssetId()),
			"parent_model_asset_record=" + strings.TrimSpace(parentRecord.RecordID),
			"artifact_roles=" + strings.Join(normalizeStringSlice(model.GetArtifactRoles()), ","),
			"source_repo=" + strings.TrimSpace(model.GetSource().GetRepo()),
			"source_revision=" + strings.TrimSpace(model.GetSource().GetRevision()),
		}),
		VerifiedArtifacts: normalizeStringSlice([]string{strings.TrimSpace(entryPath)}),
		Hashes: mergeStringMaps(cloneStringMap(model.GetHashes()), map[string]string{
			"entry_sha256":              strings.TrimSpace(entryHash),
			"companion_asset_id":        strings.TrimSpace(model.GetAssetId()),
			"companion_local_asset_id":  strings.TrimSpace(model.GetLocalAssetId()),
			"parent_model_asset_record": strings.TrimSpace(parentRecord.RecordID),
		}),
		SelectedConsumers: modelAssetSelectedConsumers(job.EnvironmentKey),
		AuditReasonCode:   "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	}, nil
}

func (s *Service) verifyLocalEnvironmentModelAsset(ctx context.Context, dependencyID string) (*runtimev1.LocalAssetRecord, string, string, string, error) {
	model, err := s.localEnvironmentAssetByDependencyID(dependencyID)
	if err != nil {
		return nil, "", "", localEnvironmentSourceManaged, err
	}
	if model == nil {
		return nil, "", "", localEnvironmentSourceManaged, errors.New("model asset record missing")
	}
	if model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
		return nil, "", "", localEnvironmentSourceManaged, errors.New("model asset record removed")
	}
	entryPath, err := resolveManagedModelEntryAbsolutePath(s.resolvedLocalModelsPath(), model)
	if err != nil {
		return model, "", "", localEnvironmentSourceKindForAsset(model), err
	}
	if err := s.validateManagedModelEntryForModel(entryPath, model); err != nil {
		return model, entryPath, "", localEnvironmentSourceKindForAsset(model), err
	}
	if isManagedSupervisedSpeechModel(model, s.modelRuntimeMode(model.GetLocalAssetId())) {
		if err := validateManagedSpeechBundleFiles(s.resolvedLocalModelsPath(), model); err != nil {
			return model, entryPath, "", localEnvironmentSourceKindForAsset(model), err
		}
	}
	if isManagedSupervisedLlamaModel(model, s.modelRuntimeMode(model.GetLocalAssetId())) {
		if err := s.SyncManagedLlamaAssets(ctx); err != nil {
			return model, entryPath, "", localEnvironmentSourceKindForAsset(model), err
		}
	}
	hash, err := computeFileSHA256(entryPath)
	if err != nil {
		return model, entryPath, "", localEnvironmentSourceKindForAsset(model), err
	}
	return model, entryPath, hash, localEnvironmentSourceKindForAsset(model), nil
}

func (s *Service) localEnvironmentAssetByDependencyID(dependencyID string) (*runtimev1.LocalAssetRecord, error) {
	trimmed := strings.TrimSpace(dependencyID)
	switch {
	case strings.HasPrefix(trimmed, "asset:"):
		localAssetID := strings.TrimSpace(strings.TrimPrefix(trimmed, "asset:"))
		if localAssetID == "" {
			return nil, errors.New("model asset local asset id is required")
		}
		model := s.modelByID(localAssetID)
		if model == nil {
			return nil, errors.New("model asset record not found")
		}
		return model, nil
	case strings.HasPrefix(trimmed, "asset-id:"):
		assetID := strings.TrimSpace(strings.TrimPrefix(trimmed, "asset-id:"))
		if index := strings.Index(assetID, "|"); index >= 0 {
			assetID = strings.TrimSpace(assetID[:index])
		}
		if assetID == "" {
			return nil, errors.New("model asset id is required")
		}
		s.mu.RLock()
		defer s.mu.RUnlock()
		var matched *runtimev1.LocalAssetRecord
		for _, candidate := range s.assets {
			if candidate == nil || candidate.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
				continue
			}
			if strings.TrimSpace(candidate.GetAssetId()) != assetID {
				continue
			}
			if matched != nil {
				return nil, errors.New("model asset id is ambiguous; use local asset id")
			}
			matched = cloneLocalAsset(candidate)
		}
		if matched == nil {
			return nil, errors.New("model asset record not found")
		}
		return matched, nil
	default:
		return nil, errors.New("model asset dependency id must be asset-specific")
	}
}

func localEnvironmentSourceKindForAsset(model *runtimev1.LocalAssetRecord) string {
	repo := strings.ToLower(strings.TrimSpace(model.GetSource().GetRepo()))
	switch {
	case strings.HasPrefix(repo, "file://"), strings.HasPrefix(repo, "local-import/"):
		return localEnvironmentSourceImported
	default:
		return localEnvironmentSourceManaged
	}
}

func modelAssetSelectedConsumers(environmentKey string) []string {
	for _, consumer := range []string{
		"llama.cpp.cuda",
		"llama.cpp.vulkan",
		"llama.cpp.cpu",
		"stable-diffusion.cpp.cuda",
		"stable-diffusion.cpp.metal",
		"stable-diffusion.cpp.cpu",
		"media.diffusers.cuda",
		"media.diffusers.cpu",
		"media.video-python.cuda",
		"media.video-python.cpu",
		"speech.qwen3-asr.python",
		"speech.qwen3-tts.python",
	} {
		if strings.Contains(environmentKey, "|"+consumer) {
			return []string{consumer}
		}
	}
	return []string{"local.model"}
}

func companionParentAssetIDFromDependencyID(dependencyID string) string {
	parts := strings.Split(strings.TrimSpace(dependencyID), "|")
	for _, part := range parts {
		if strings.HasPrefix(strings.TrimSpace(part), "parent-asset-id:") {
			return strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(part), "parent-asset-id:"))
		}
	}
	return ""
}

func (s *Service) selectedModelAssetSourceForAssetID(assetID string) (localEnvironmentSelectedSourceRecordState, bool) {
	trimmedAssetID := strings.TrimSpace(assetID)
	if trimmedAssetID == "" {
		return localEnvironmentSelectedSourceRecordState{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, record := range s.localEnvironmentSelectedSources {
		if record.DependencyFamily != localEnvironmentFamilyModelAsset {
			continue
		}
		if strings.TrimSpace(record.DependencyID) == "asset-id:"+trimmedAssetID {
			return record, true
		}
	}
	return localEnvironmentSelectedSourceRecordState{}, false
}

func mergeStringMaps(base map[string]string, overlay map[string]string) map[string]string {
	out := make(map[string]string, len(base)+len(overlay))
	for key, value := range base {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(value) == "" {
			continue
		}
		out[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}
	for key, value := range overlay {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(value) == "" {
			continue
		}
		out[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}
	return out
}
