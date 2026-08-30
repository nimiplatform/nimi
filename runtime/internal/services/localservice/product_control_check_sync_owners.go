package localservice

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.local-compute.r008
// @nimi-authority: rule.nimi.runtime.local-compute.r009
func (s *Service) reconcileProductControlCheckSyncModelAssets(ctx context.Context, input ProductControlCheckSyncInput) ProductControlCheckSyncOwnerResult {
	result := ProductControlCheckSyncOwnerResult{
		OwnerID: "model_assets_loadouts", State: "completed", Resources: []ProductControlCheckSyncResourceResult{},
	}
	if ctx.Err() != nil {
		return failedProductControlCheckSyncOwner(result.OwnerID, "RUN_INTERRUPTED")
	}
	rebasedAssets, rebasedCleanup, commitErr := s.commitProductControlCheckSyncModelAssetRebases()
	if commitErr != nil {
		return failedProductControlCheckSyncOwner(result.OwnerID, "MODEL_INVENTORY_REBASE_FAILED")
	}
	for id := range rebasedCleanup {
		reference := id
		rebased := "rebased"
		result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
			Kind: "model_asset_cleanup", Reference: &reference, Status: "unavailable", Change: &rebased,
			Reason: "MODEL_CLEANUP_FORMER_ROOT_DETACHED",
		})
	}
	modelsRoot := filepath.Join(input.DataRoot, "models")
	resolvedRoot := filepath.Join(modelsRoot, "resolved")
	entries, err := os.ReadDir(resolvedRoot)
	if errors.Is(err, os.ErrNotExist) {
		return s.projectMissingProductControlCheckSyncModelAssets(result, rebasedAssets)
	}
	if err != nil {
		return failedProductControlCheckSyncOwner(result.OwnerID, "MODEL_RESOLVED_ROOT_UNAVAILABLE")
	}
	ambiguousManifestIDs := ambiguousProductControlCheckSyncModelAssetIDs(entries, resolvedRoot)

	s.mu.RLock()
	assets := make(map[string]*runtimev1.ModelAssetRecord, len(s.modelAssets))
	directories := make(map[string]string, len(s.modelAssetDirectories))
	for id, asset := range s.modelAssets {
		assets[id] = cloneModelAsset(asset)
		directories[id] = s.modelAssetDirectories[id]
	}
	s.mu.RUnlock()
	seen := make(map[string]struct{})
	registeredDirectories := make(map[string]string)
	for id, directory := range directories {
		registeredDirectories[canonicalReportPath(directory)] = id
	}

	for _, entry := range entries {
		if ctx.Err() != nil {
			return failedProductControlCheckSyncOwner(result.OwnerID, "RUN_INTERRUPTED")
		}
		directory := filepath.Join(resolvedRoot, entry.Name())
		if !entry.IsDir() {
			locator := filepath.ToSlash(filepath.Join("models", "resolved", entry.Name()))
			result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
				Kind: "model_asset_content", Locator: &locator, Status: "unknown", Reason: "MODEL_RESOLVED_ENTRY_UNCLAIMED",
			})
			continue
		}
		manifestPath := filepath.Join(directory, localAssetManifestFileName)
		manifestPayload, readErr := os.ReadFile(manifestPath)
		if errors.Is(readErr, os.ErrNotExist) {
			locator := filepath.ToSlash(filepath.Join("models", "resolved", entry.Name()))
			result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
				Kind: "model_asset_content", Locator: &locator, Status: "unknown", Reason: "MODEL_MANIFEST_MISSING",
			})
			continue
		}
		if readErr != nil {
			locator := filepath.ToSlash(filepath.Join("models", "resolved", entry.Name()))
			result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
				Kind: "model_asset", Locator: &locator, Status: "failed", Reason: "MODEL_MANIFEST_UNREADABLE",
			})
			continue
		}
		var manifest modelAssetManifest
		if decodeStrictJSON(manifestPayload, &manifest) != nil {
			locator := filepath.ToSlash(filepath.Join("models", "resolved", entry.Name()))
			result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
				Kind: "model_asset", Locator: &locator, Status: "conflict", Reason: "MODEL_MANIFEST_INVALID",
			})
			continue
		}
		asset, convertErr := modelAssetRecordFromCanonicalManifest(manifest)
		if convertErr != nil {
			reference := strings.TrimSpace(manifest.ModelAssetID)
			result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
				Kind: "model_asset", Reference: optionalProductControlCheckSyncText(reference), Status: "conflict", Reason: "MODEL_MANIFEST_INVALID",
			})
			continue
		}
		id := asset.GetModelAssetId()
		seen[id] = struct{}{}
		reference := id
		if ambiguousManifestIDs[id] {
			result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
				Kind: "model_asset", Reference: &reference, Status: "conflict", Reason: "MODEL_MANIFEST_ID_AMBIGUOUS",
			})
			continue
		}
		if existing := assets[id]; existing != nil {
			if existing.GetContentId() != asset.GetContentId() {
				result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
					Kind: "model_asset", Reference: &reference, Status: "conflict", Reason: "MODEL_ID_CONTENT_CONFLICT",
				})
				continue
			}
			rowPayload, _ := protojson.Marshal(existing)
			row := &modelAssetStoreRecord{Asset: rowPayload, ManagedDirectory: directory}
			if validateStoredModelAssetRecord(modelsRoot, row) != nil {
				result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
					Kind: "model_asset", Reference: &reference, Status: "unavailable", Reason: "MODEL_PAYLOAD_OR_MANIFEST_UNAVAILABLE",
				})
				continue
			}
			change := (*string)(nil)
			reason := "MODEL_MANIFEST_REUSED"
			if _, rebasedByLoader := rebasedAssets[id]; rebasedByLoader {
				rebased := "rebased"
				change = &rebased
				reason = "MODEL_INVENTORY_REBASED"
			}
			if canonicalReportPath(directories[id]) != canonicalReportPath(directory) {
				if ctx.Err() != nil {
					return failedProductControlCheckSyncOwner(result.OwnerID, "RUN_INTERRUPTED")
				}
				if persistErr := s.rebaseProductControlCheckSyncModelAsset(id, directory); persistErr != nil {
					result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
						Kind: "model_asset", Reference: &reference, Status: "failed", Reason: "MODEL_INVENTORY_REBASE_FAILED",
					})
					continue
				}
				rebased := "rebased"
				change = &rebased
				reason = "MODEL_INVENTORY_REBASED"
			}
			result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
				Kind: "model_asset", Reference: &reference, Status: "available", Change: change, Reason: reason,
			})
			continue
		}

		if collisionID, collision := registeredDirectories[canonicalReportPath(directory)]; collision && collisionID != id {
			result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
				Kind: "model_asset", Reference: &reference, Status: "conflict", Reason: "MODEL_DIRECTORY_ID_CONFLICT",
			})
			continue
		}
		if verifyErr := s.verifyProductControlCheckSyncManifestPayload(ctx, directory, manifest); verifyErr != nil {
			result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
				Kind: "model_asset", Reference: &reference, Status: "conflict", Reason: "MODEL_MANIFEST_CONTENT_MISMATCH",
			})
			continue
		}
		if ctx.Err() != nil {
			return failedProductControlCheckSyncOwner(result.OwnerID, "RUN_INTERRUPTED")
		}
		if persistErr := s.adoptProductControlCheckSyncModelAsset(asset, directory); persistErr != nil {
			result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
				Kind: "model_asset", Reference: &reference, Status: "failed", Reason: "MODEL_INVENTORY_ADOPTION_FAILED",
			})
			continue
		}
		adopted := "adopted"
		result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
			Kind: "model_asset", Reference: &reference, Status: "available", Change: &adopted, Reason: "MODEL_MANIFEST_ADOPTED",
		})
	}

	for id := range assets {
		if _, ok := seen[id]; ok {
			continue
		}
		reference := id
		change := (*string)(nil)
		if _, rebasedByLoader := rebasedAssets[id]; rebasedByLoader {
			rebased := "rebased"
			change = &rebased
		}
		result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
			Kind: "model_asset", Reference: &reference, Status: "unavailable", Change: change, Reason: "MODEL_INVENTORY_CONTENT_MISSING",
		})
	}
	result.Resources = append(result.Resources, s.projectProductControlCheckSyncLoadouts(result.Resources)...)
	sortProductControlCheckSyncResources(result.Resources)
	return result
}

func (s *Service) projectProductControlCheckSyncLoadouts(modelResults []ProductControlCheckSyncResourceResult) []ProductControlCheckSyncResourceResult {
	modelStatus := make(map[string]string)
	for _, resource := range modelResults {
		if resource.Kind == "model_asset" && resource.Reference != nil {
			current := modelStatus[*resource.Reference]
			if productControlCheckSyncStatusPriority(resource.Status) > productControlCheckSyncStatusPriority(current) {
				modelStatus[*resource.Reference] = resource.Status
			}
		}
	}
	s.mu.RLock()
	loadouts := make([]*runtimev1.Loadout, 0, len(s.loadouts))
	for _, loadout := range s.loadouts {
		loadouts = append(loadouts, cloneLoadout(loadout))
	}
	assets := make(map[string]*runtimev1.ModelAssetRecord, len(s.modelAssets))
	for id, asset := range s.modelAssets {
		assets[id] = cloneModelAsset(asset)
	}
	s.mu.RUnlock()
	results := make([]ProductControlCheckSyncResourceResult, 0, len(loadouts))
	for _, loadout := range loadouts {
		if loadout == nil {
			continue
		}
		status := "available"
		reason := "LOADOUT_INTENT_REUSED"
		for _, axis := range loadout.GetModelAxes() {
			asset := assets[axis.GetModelAssetId()]
			modelAssetStatus := modelStatus[axis.GetModelAssetId()]
			if asset == nil || modelAssetStatus == "" || modelAssetStatus == "unavailable" || modelAssetStatus == "unknown" {
				status = "unavailable"
				reason = "LOADOUT_MODEL_ASSET_UNAVAILABLE"
				break
			}
			if asset.GetContentId() != axis.GetExpectedContentId() || modelAssetStatus == "conflict" {
				status = "conflict"
				reason = "LOADOUT_MODEL_CONTENT_CONFLICT"
				break
			}
			if modelAssetStatus == "failed" {
				status = "failed"
				reason = "LOADOUT_MODEL_ASSET_RECONCILIATION_FAILED"
				break
			}
			if modelAssetStatus == "incompatible" {
				status = "incompatible"
				reason = "LOADOUT_MODEL_ASSET_INCOMPATIBLE"
				break
			}
			if modelAssetStatus != "available" {
				status = "unavailable"
				reason = "LOADOUT_MODEL_ASSET_UNAVAILABLE"
				break
			}
		}
		reference := loadout.GetLoadoutId()
		results = append(results, ProductControlCheckSyncResourceResult{
			Kind: "loadout", Reference: &reference, Status: status, Reason: reason,
		})
	}
	return results
}

func (s *Service) projectMissingProductControlCheckSyncModelAssets(result ProductControlCheckSyncOwnerResult, rebasedAssets map[string]string) ProductControlCheckSyncOwnerResult {
	s.mu.RLock()
	for id := range s.modelAssets {
		reference := id
		change := (*string)(nil)
		if _, rebasedByLoader := rebasedAssets[id]; rebasedByLoader {
			rebased := "rebased"
			change = &rebased
		}
		result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
			Kind: "model_asset", Reference: &reference, Status: "unavailable", Change: change, Reason: "MODEL_INVENTORY_CONTENT_MISSING",
		})
	}
	s.mu.RUnlock()
	result.Resources = append(result.Resources, s.projectProductControlCheckSyncLoadouts(result.Resources)...)
	sortProductControlCheckSyncResources(result.Resources)
	return result
}

func (s *Service) commitProductControlCheckSyncModelAssetRebases() (map[string]string, map[string]modelAssetCleanupObligation, error) {
	s.modelAssetMutationMu.Lock()
	defer s.modelAssetMutationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	rebasedAssets := make(map[string]string, len(s.modelAssetPendingDirectoryRebases))
	previousDirectories := make(map[string]string, len(s.modelAssetPendingDirectoryRebases))
	for id, directory := range s.modelAssetPendingDirectoryRebases {
		rebasedAssets[id] = directory
		previousDirectories[id] = s.modelAssetDirectories[id]
		s.modelAssetDirectories[id] = directory
	}
	rebasedCleanup := make(map[string]modelAssetCleanupObligation, len(s.modelAssetPendingCleanupRebases))
	previousCleanup := make(map[string]modelAssetCleanupObligation, len(s.modelAssetPendingCleanupRebases))
	for id, obligation := range s.modelAssetPendingCleanupRebases {
		rebasedCleanup[id] = obligation
		previousCleanup[id] = s.modelAssetCleanupObligations[id]
		s.modelAssetCleanupObligations[id] = obligation
	}
	if len(rebasedAssets) == 0 && len(rebasedCleanup) == 0 {
		return rebasedAssets, rebasedCleanup, nil
	}
	s.modelAssetPendingDirectoryRebases = make(map[string]string)
	s.modelAssetPendingCleanupRebases = make(map[string]modelAssetCleanupObligation)
	if err := s.persistModelAssetStoreLocked(); err != nil {
		for id, directory := range previousDirectories {
			s.modelAssetDirectories[id] = directory
		}
		for id, obligation := range previousCleanup {
			s.modelAssetCleanupObligations[id] = obligation
		}
		s.modelAssetPendingDirectoryRebases = rebasedAssets
		s.modelAssetPendingCleanupRebases = rebasedCleanup
		return nil, nil, err
	}
	return rebasedAssets, rebasedCleanup, nil
}

func ambiguousProductControlCheckSyncModelAssetIDs(entries []os.DirEntry, resolvedRoot string) map[string]bool {
	claims := make(map[string]int)
	for _, entry := range entries {
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		payload, err := os.ReadFile(filepath.Join(resolvedRoot, entry.Name(), localAssetManifestFileName))
		if err != nil {
			continue
		}
		var manifest modelAssetManifest
		if decodeStrictJSON(payload, &manifest) != nil {
			continue
		}
		asset, err := modelAssetRecordFromCanonicalManifest(manifest)
		if err != nil {
			continue
		}
		claims[asset.GetModelAssetId()]++
	}
	ambiguous := make(map[string]bool)
	for id, count := range claims {
		if count > 1 {
			ambiguous[id] = true
		}
	}
	return ambiguous
}

func productControlCheckSyncStatusPriority(status string) int {
	switch status {
	case "failed":
		return 6
	case "conflict":
		return 5
	case "incompatible":
		return 4
	case "unavailable":
		return 3
	case "unknown":
		return 2
	case "available":
		return 1
	default:
		return 0
	}
}

func modelAssetRecordFromCanonicalManifest(manifest modelAssetManifest) (*runtimev1.ModelAssetRecord, error) {
	if manifest.SchemaVersion != modelAssetManifestSchemaVersion || strings.TrimSpace(manifest.ModelAssetID) == "" || strings.TrimSpace(manifest.ContentID) == "" || !manifest.ContentVerified || len(manifest.Files) == 0 {
		return nil, errors.New("canonical ModelAsset manifest identity is incomplete")
	}
	files := make([]*runtimev1.ModelAssetFile, 0, len(manifest.Files))
	for _, file := range manifest.Files {
		files = append(files, &runtimev1.ModelAssetFile{
			RelativePath: file.RelativePath, Sha256: file.SHA256, SizeBytes: file.SizeBytes,
			NonExecutableContent: file.NonExecutableContent,
		})
	}
	fingerprint, err := structpb.NewStruct(manifest.BoundedFingerprint)
	if err != nil {
		return nil, err
	}
	provenance, err := structpb.NewStruct(manifest.Provenance)
	if err != nil {
		return nil, err
	}
	catalogVerification := runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_NOT_MATCHED
	if manifest.CatalogVerified {
		catalogVerification = runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_MATCHED
	}
	return &runtimev1.ModelAssetRecord{
		ModelAssetId: manifest.ModelAssetID, ContentId: manifest.ContentID, DisplayName: manifest.DisplayName,
		Entry: manifest.Entry, Files: files, TotalSizeBytes: manifest.TotalSizeBytes,
		ContentVerified: manifest.ContentVerified, CatalogVerification: catalogVerification,
		BoundedFingerprint: fingerprint, Provenance: provenance,
		CreatedAt: manifest.CreatedAt, UpdatedAt: manifest.CreatedAt,
		LatestIntegrityCheckedAt:  manifest.CreatedAt,
		ContainsNonExecutableCode: manifest.ContainsNonExecutableCode,
	}, nil
}

func (s *Service) verifyProductControlCheckSyncManifestPayload(ctx context.Context, directory string, manifest modelAssetManifest) error {
	files, _, total, _, _, err := s.hashResolvedPayloadDetailed(ctx, directory)
	if err != nil {
		return err
	}
	asset, err := modelAssetRecordFromCanonicalManifest(manifest)
	if err != nil {
		return err
	}
	if total != asset.GetTotalSizeBytes() || modelAssetContentID(files) != asset.GetContentId() || len(files) != len(asset.GetFiles()) {
		return errors.New("ModelAsset manifest content identity differs from payload")
	}
	for index := range files {
		actual, expected := files[index], asset.GetFiles()[index]
		if actual.GetRelativePath() != expected.GetRelativePath() || actual.GetSha256() != expected.GetSha256() || actual.GetSizeBytes() != expected.GetSizeBytes() || actual.GetNonExecutableContent() != expected.GetNonExecutableContent() {
			return errors.New("ModelAsset manifest file inventory differs from payload")
		}
	}
	return nil
}

func (s *Service) adoptProductControlCheckSyncModelAsset(asset *runtimev1.ModelAssetRecord, directory string) error {
	s.modelAssetMutationMu.Lock()
	defer s.modelAssetMutationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	id := asset.GetModelAssetId()
	if existing := s.modelAssets[id]; existing != nil && existing.GetContentId() != asset.GetContentId() {
		return errors.New("ModelAsset identity already belongs to different content")
	}
	s.modelAssets[id] = cloneModelAsset(asset)
	s.modelAssetDirectories[id] = filepath.Clean(directory)
	return s.persistModelAssetStoreLocked()
}

func (s *Service) rebaseProductControlCheckSyncModelAsset(id string, directory string) error {
	s.modelAssetMutationMu.Lock()
	defer s.modelAssetMutationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.modelAssets[id] == nil {
		return errors.New("ModelAsset inventory record is unavailable")
	}
	s.modelAssetDirectories[id] = filepath.Clean(directory)
	return s.persistModelAssetStoreLocked()
}

// @nimi-authority: rule.nimi.runtime.local-compute.r077
func (s *Service) reconcileProductControlCheckSyncEnvironments(ctx context.Context, input ProductControlCheckSyncInput) ProductControlCheckSyncOwnerResult {
	result := ProductControlCheckSyncOwnerResult{
		OwnerID: "dependencies_environments", State: "completed", Resources: []ProductControlCheckSyncResourceResult{},
	}
	if ctx.Err() != nil {
		return failedProductControlCheckSyncOwner(result.OwnerID, "RUN_INTERRUPTED")
	}
	s.mu.RLock()
	manager := s.engineMgr
	s.mu.RUnlock()
	ownerMaterial := []engine.ManagedEnvironmentCheckResult{}
	checkOwner, ownerAvailable := manager.(interface {
		CheckSyncManagedEnvironment(context.Context, string) []engine.ManagedEnvironmentCheckResult
	})
	if ownerAvailable {
		ownerMaterial = checkOwner.CheckSyncManagedEnvironment(ctx, input.DataRoot)
	}
	if ctx.Err() != nil {
		return failedProductControlCheckSyncOwner(result.OwnerID, "RUN_INTERRUPTED")
	}

	s.mu.Lock()
	previousSources := cloneLocalEnvironmentSelectedSourceRecords(s.localEnvironmentSelectedSources)
	previousContracts := cloneLocalEnvironmentPlanDependencyContracts(s.localEnvironmentPlanDependencyContracts)
	previousProfiles := cloneLocalEnvironmentHostProfiles(s.localEnvironmentHostProfiles)
	changed := false
	type selectedSourceCandidate struct {
		originalMapKey string
		original       localEnvironmentSelectedSourceRecordState
		record         localEnvironmentSelectedSourceRecordState
		proposedMapKey string
		rebased        bool
		detached       bool
		invalid        bool
		keyUnverified  bool
	}
	candidates := make([]selectedSourceCandidate, 0, len(s.localEnvironmentSelectedSources))
	proposedCounts := make(map[string]int)
	for mapKey, original := range s.localEnvironmentSelectedSources {
		record := original
		record.CompatibilityEvidence = append([]string(nil), original.CompatibilityEvidence...)
		record.VerifiedArtifacts = append([]string(nil), original.VerifiedArtifacts...)
		candidate := selectedSourceCandidate{originalMapKey: mapKey, original: original, record: record}
		if record.SourceKind == localEnvironmentSourceSystem {
			detachLocalEnvironmentSelectedSourceRecord(&candidate.record)
			candidate.detached = true
		} else {
			root, rootState := rebaseProductControlCheckSyncOwnerPath(record.CanonicalRoot, input.DataRoot)
			switch rootState {
			case productControlOwnerPathRebased:
				candidate.record.CanonicalRoot, candidate.rebased = root, true
			case productControlOwnerPathDetached:
				detachLocalEnvironmentSelectedSourceRecord(&candidate.record)
				candidate.detached = true
			case productControlOwnerPathInvalid:
				candidate.invalid = true
			}
			if !candidate.detached && !candidate.invalid {
				for index, artifact := range candidate.record.VerifiedArtifacts {
					if !filepath.IsAbs(strings.TrimSpace(artifact)) && !localEnvironmentManagedOwnerLocator(artifact) {
						cleaned := filepath.Clean(filepath.FromSlash(strings.TrimSpace(artifact)))
						if cleaned == "." || cleaned == ".." || filepath.IsAbs(cleaned) || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
							candidate.invalid = true
						}
						continue
					}
					value, artifactState := rebaseProductControlCheckSyncOwnerPath(artifact, input.DataRoot)
					switch artifactState {
					case productControlOwnerPathRebased:
						candidate.record.VerifiedArtifacts[index], candidate.rebased = value, true
					case productControlOwnerPathDetached:
						detachLocalEnvironmentSelectedSourceRecord(&candidate.record)
						candidate.detached = true
					case productControlOwnerPathInvalid:
						candidate.invalid = true
					}
					if candidate.detached || candidate.invalid {
						break
					}
				}
			}
		}
		if candidate.invalid {
			detachLocalEnvironmentSelectedSourceRecord(&candidate.record)
		}
		if portableKey, proven := localEnvironmentPortableKey(candidate.record); proven {
			if portableKey != candidate.record.EnvironmentKey {
				candidate.record.EnvironmentKey = portableKey
				candidate.rebased = true
			}
		} else {
			candidate.record.RepairState = localEnvironmentRepairRequired
			candidate.keyUnverified = true
		}
		candidate.proposedMapKey = localEnvironmentSelectedSourceRecordKey(candidate.record)
		if candidate.proposedMapKey == "" {
			candidate.invalid = true
		} else {
			proposedCounts[candidate.proposedMapKey]++
		}
		candidates = append(candidates, candidate)
	}

	reconciledRecords := make(map[string]localEnvironmentSelectedSourceRecordState, len(candidates))
	for _, candidate := range candidates {
		record := candidate.record
		collision := candidate.proposedMapKey != "" && proposedCounts[candidate.proposedMapKey] > 1
		mapKey := candidate.proposedMapKey
		if collision {
			// A portable-key collision cannot select a winner. Preserve both
			// canonical intents under their original identities and fail closed.
			record.EnvironmentKey = candidate.original.EnvironmentKey
			record.RepairState = localEnvironmentRepairRequired
			mapKey = candidate.originalMapKey
		}
		if mapKey == "" {
			mapKey = candidate.originalMapKey
		}
		if record.RepairState == localEnvironmentRepairRequired && record.AuditReasonCode == "CHECK_SYNC_OWNER_MATERIAL_VERIFICATION_REQUIRED" {
			record.RepairState = localEnvironmentRepairNone
			record.LastVerifiedAt = nowISO()
		}

		status, reason := "available", "ENVIRONMENT_OWNER_RECORD_REUSED"
		var change *string
		switch {
		case collision:
			status, reason = "conflict", "ENVIRONMENT_KEY_REWRITE_CONFLICT"
		case candidate.invalid:
			status, reason = "conflict", "ENVIRONMENT_OWNER_LOCATOR_INVALID"
		case candidate.original.SourceKind == localEnvironmentSourceSystem:
			status, reason = "unavailable", "SYSTEM_SOURCE_REDISCOVERY_REQUIRED"
		case candidate.detached:
			status, reason = "unavailable", "ENVIRONMENT_OWNER_REOPEN_EVIDENCE_REQUIRED"
		case candidate.keyUnverified:
			status, reason = "unavailable", "ENVIRONMENT_KEY_REOPEN_EVIDENCE_REQUIRED"
		case validateLocalEnvironmentSelectedSourceRecord(record) != nil:
			markLocalEnvironmentCheckSyncRepair(&record, "CHECK_SYNC_OWNER_EVIDENCE_INCOMPLETE")
			status, reason = "unavailable", "ENVIRONMENT_OWNER_EVIDENCE_INCOMPLETE"
		case validateLocalEnvironmentSelectedSourceLocalArtifacts(record) != nil:
			markLocalEnvironmentCheckSyncRepair(&record, "CHECK_SYNC_OWNER_ARTIFACT_UNAVAILABLE")
			status, reason = "unavailable", "ENVIRONMENT_OWNER_ARTIFACT_UNAVAILABLE"
		case !productControlCheckSyncEnvironmentMaterialSupportsRecord(record, ownerMaterial, input.DataRoot):
			markLocalEnvironmentCheckSyncRepair(&record, "CHECK_SYNC_OWNER_MATERIAL_VERIFICATION_REQUIRED")
			status, reason = "unavailable", "ENVIRONMENT_OWNER_MATERIAL_VERIFICATION_REQUIRED"
		case candidate.rebased:
			value := "rebased"
			change = &value
			reason = "ENVIRONMENT_OWNER_RECORD_REBASED"
		}
		reconciledRecords[mapKey] = record
		if !localEnvironmentSelectedSourceRecordsEqual(candidate.original, record) || mapKey != candidate.originalMapKey {
			changed = true
		}
		result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
			Kind: record.DependencyFamily, Reference: optionalProductControlCheckSyncText(record.RecordID), Status: status, Change: change, Reason: reason,
		})
	}
	s.localEnvironmentSelectedSources = reconciledRecords

	reconciledContracts, contractConflicts, contractsChanged := reconcileLocalEnvironmentPortableContracts(s.localEnvironmentPlanDependencyContracts)
	s.localEnvironmentPlanDependencyContracts = reconciledContracts
	changed = changed || contractsChanged
	for _, reference := range contractConflicts {
		result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
			Kind: "environment_contract", Reference: optionalProductControlCheckSyncText(reference), Status: "conflict", Reason: "ENVIRONMENT_KEY_REWRITE_CONFLICT",
		})
	}
	s.localEnvironmentHostProfiles = make(map[string]localEnvironmentHostProfileState)
	changed = changed || len(previousProfiles) > 0
	jobs := make([]localEnvironmentDependencyJobState, 0, len(s.localEnvironmentDependencyJobs))
	for _, job := range s.localEnvironmentDependencyJobs {
		jobs = append(jobs, job)
	}
	if ctx.Err() != nil {
		s.localEnvironmentSelectedSources = previousSources
		s.localEnvironmentPlanDependencyContracts = previousContracts
		s.localEnvironmentHostProfiles = previousProfiles
		s.mu.Unlock()
		return failedProductControlCheckSyncOwner(result.OwnerID, "RUN_INTERRUPTED")
	}
	if changed {
		if err := s.persistStateLocked(); err != nil {
			s.localEnvironmentSelectedSources = previousSources
			s.localEnvironmentPlanDependencyContracts = previousContracts
			s.localEnvironmentHostProfiles = previousProfiles
			s.mu.Unlock()
			result.State = "failed"
			result.Resources = []ProductControlCheckSyncResourceResult{{
				Kind: "environment_owner", Status: "failed", Reason: "ENVIRONMENT_STATE_PERSIST_FAILED",
			}}
			return result
		}
	}
	s.mu.Unlock()
	for _, job := range jobs {
		if !localEnvironmentDependencyJobTerminal(job.State) {
			continue
		}
		reference := job.JobID
		status := "unavailable"
		reason := "ENVIRONMENT_JOB_NOT_PORTABLE"
		if job.State == localEnvironmentStateFailed || job.State == localEnvironmentStateRepairRequired {
			status = "failed"
			reason = "ENVIRONMENT_JOB_TERMINAL_AFTER_REOPEN"
		}
		result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
			Kind: "environment_job", Reference: optionalProductControlCheckSyncText(reference), Status: status, Reason: reason,
		})
	}
	if !ownerAvailable {
		result.Resources = append(result.Resources, ProductControlCheckSyncResourceResult{
			Kind: "environment_owner", Status: "unavailable", Reason: "ENVIRONMENT_MANAGER_UNAVAILABLE",
		})
	} else {
		for _, ownerResult := range ownerMaterial {
			resource := ProductControlCheckSyncResourceResult{
				Kind: ownerResult.Kind, Reference: optionalProductControlCheckSyncText(ownerResult.Reference),
				Locator: optionalProductControlCheckSyncText(ownerResult.Locator), Status: ownerResult.Status,
				Change: optionalProductControlCheckSyncText(ownerResult.Change), Reason: ownerResult.Reason,
				NextAction: optionalProductControlCheckSyncText(ownerResult.NextAction),
			}
			result.Resources = append(result.Resources, resource)
		}
	}
	sortProductControlCheckSyncResources(result.Resources)
	return result
}

func markLocalEnvironmentCheckSyncRepair(record *localEnvironmentSelectedSourceRecordState, reason string) {
	if record == nil {
		return
	}
	record.RepairState = localEnvironmentRepairRequired
	record.LastVerifiedAt = ""
	record.AuditReasonCode = strings.TrimSpace(reason)
}

func cloneLocalEnvironmentSelectedSourceRecords(input map[string]localEnvironmentSelectedSourceRecordState) map[string]localEnvironmentSelectedSourceRecordState {
	output := make(map[string]localEnvironmentSelectedSourceRecordState, len(input))
	for key, record := range input {
		record.CompatibilityEvidence = append([]string(nil), record.CompatibilityEvidence...)
		record.VerifiedArtifacts = append([]string(nil), record.VerifiedArtifacts...)
		record.SelectedConsumers = append([]string(nil), record.SelectedConsumers...)
		record.ActivationEnvDelta = append([]string(nil), record.ActivationEnvDelta...)
		record.Hashes = cloneStringMap(record.Hashes)
		output[key] = record
	}
	return output
}

func cloneLocalEnvironmentPlanDependencyContracts(input map[string]localEnvironmentPlanDependencyContractState) map[string]localEnvironmentPlanDependencyContractState {
	output := make(map[string]localEnvironmentPlanDependencyContractState, len(input))
	for key, contract := range input {
		output[key] = contract
	}
	return output
}

func cloneLocalEnvironmentHostProfiles(input map[string]localEnvironmentHostProfileState) map[string]localEnvironmentHostProfileState {
	output := make(map[string]localEnvironmentHostProfileState, len(input))
	for key, profile := range input {
		output[key] = profile
	}
	return output
}

type productControlOwnerPathState int

const (
	productControlOwnerPathCurrent productControlOwnerPathState = iota
	productControlOwnerPathRebased
	productControlOwnerPathDetached
	productControlOwnerPathInvalid
)

func rebaseProductControlCheckSyncOwnerPath(value string, dataRoot string) (string, productControlOwnerPathState) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", productControlOwnerPathDetached
	}
	cleaned := filepath.Clean(value)
	if cleaned == "." {
		return "", productControlOwnerPathInvalid
	}
	if filepath.IsAbs(cleaned) {
		if locator, within := localEnvironmentOwnerRelativeLocator(dataRoot, cleaned); within && localEnvironmentManagedOwnerLocator(locator) {
			return cleaned, productControlOwnerPathCurrent
		}
		return "", productControlOwnerPathDetached
	}
	if !localEnvironmentManagedOwnerLocator(value) {
		return "", productControlOwnerPathInvalid
	}
	derived, ok := localEnvironmentOwnerPathFromLocator(dataRoot, value)
	if !ok {
		return "", productControlOwnerPathInvalid
	}
	return derived, productControlOwnerPathRebased
}

func detachLocalEnvironmentSelectedSourceRecord(record *localEnvironmentSelectedSourceRecordState) {
	if record == nil {
		return
	}
	record.CanonicalRoot = ""
	record.VerifiedArtifacts = nil
	record.CompatibilityEvidence = nil
	record.LastVerifiedAt = ""
	record.RepairState = localEnvironmentRepairRequired
}

func localEnvironmentSelectedSourceRecordsEqual(left, right localEnvironmentSelectedSourceRecordState) bool {
	return reflect.DeepEqual(left, right)
}

// localEnvironmentPortableKey rewrites only exact historical key shapes
// emitted by this owner. Unknown strings are retained; absolute fragments are
// never stripped heuristically.
func localEnvironmentPortableKey(record localEnvironmentSelectedSourceRecordState) (string, bool) {
	parts := strings.Split(strings.TrimSpace(record.EnvironmentKey), "|")
	family := strings.TrimSpace(record.DependencyFamily)
	dependencyID := strings.TrimSpace(record.DependencyID)
	if len(parts) == 0 || family == "" || dependencyID == "" {
		return record.EnvironmentKey, false
	}
	for index := range parts {
		parts[index] = strings.TrimSpace(parts[index])
	}
	switch family {
	case localEnvironmentFamilyNativeLlama:
		expectedVersionPart := "version=" + strings.TrimSpace(record.Version)
		if strings.TrimSpace(record.Version) != "" && len(parts) == 4 && parts[0] == family && parts[1] == dependencyID && parts[2] == expectedVersionPart && localEnvironmentPlatformKeyPart(parts[3]) {
			return strings.Join(parts, "|"), true
		}
		if len(parts) == 5 && parts[0] == family && parts[1] == dependencyID && localEnvironmentPlatformKeyPart(parts[3]) && localEnvironmentLegacyAbsoluteKeyPart(parts[4]) && strings.TrimSpace(record.Version) != "" {
			return localEnvironmentNativeLlamaKey(record.Version, parts[3]), true
		}
	case localEnvironmentFamilyPythonUV:
		if len(parts) == 3 && parts[0] == family && parts[1] == engine.ManagedUVVersion && localEnvironmentPlatformKeyPart(parts[2]) {
			return strings.Join(parts, "|"), true
		}
		if len(parts) == 4 && parts[0] == family && parts[1] == engine.ManagedUVVersion && localEnvironmentPlatformKeyPart(parts[2]) && localEnvironmentLegacyAbsoluteKeyPart(parts[3]) {
			return strings.Join(parts[:3], "|"), true
		}
	case localEnvironmentFamilyPythonRuntime:
		if len(parts) == 4 && parts[0] == family && parts[1] == engine.ManagedPythonVersion && parts[2] == engine.ManagedPythonABI && localEnvironmentPlatformKeyPart(parts[3]) {
			return strings.Join(parts, "|"), true
		}
		if len(parts) == 5 && parts[0] == family && parts[1] == engine.ManagedPythonVersion && parts[2] == engine.ManagedPythonABI && localEnvironmentPlatformKeyPart(parts[3]) && localEnvironmentLegacyAbsoluteKeyPart(parts[4]) {
			return strings.Join(parts[:4], "|"), true
		}
	case localEnvironmentFamilyPythonVenv, localEnvironmentFamilyPythonPackageSet:
		if len(parts) == 2 && parts[0] == family && parts[1] == dependencyID {
			return strings.Join(parts, "|"), true
		}
		if len(parts) == 3 && parts[0] == family && parts[1] == dependencyID && localEnvironmentLegacyAbsoluteKeyPart(parts[2]) {
			return strings.Join(parts[:2], "|"), true
		}
	case localEnvironmentFamilyPythonTorchWheel:
		if len(parts) == 8 && parts[0] == family && localEnvironmentPlatformKeyPart(parts[7]) {
			return strings.Join(parts, "|"), true
		}
		if len(parts) == 9 && parts[0] == family && localEnvironmentPlatformKeyPart(parts[7]) && localEnvironmentLegacyAbsoluteKeyPart(parts[8]) {
			return strings.Join(parts[:8], "|"), true
		}
	default:
		if len(parts) == 3 && parts[0] == family && parts[1] == dependencyID && localEnvironmentPlatformKeyPart(parts[2]) {
			return strings.Join(parts, "|"), true
		}
		if len(parts) == 5 && parts[0] == family && parts[1] == dependencyID && localEnvironmentPlatformKeyPart(parts[3]) && localEnvironmentLegacyAbsoluteKeyPart(parts[4]) {
			return strings.Join([]string{parts[0], parts[1], parts[3]}, "|"), true
		}
	}
	return record.EnvironmentKey, false
}

func localEnvironmentPlatformKeyPart(value string) bool {
	parts := strings.Split(strings.TrimSpace(value), "/")
	return len(parts) == 2 && parts[0] != "" && parts[1] != ""
}

func localEnvironmentLegacyAbsoluteKeyPart(value string) bool {
	trimmed := strings.TrimSpace(value)
	windowsAbsolute := len(trimmed) >= 3 && ((trimmed[0] >= 'A' && trimmed[0] <= 'Z') || (trimmed[0] >= 'a' && trimmed[0] <= 'z')) && trimmed[1] == ':' && (trimmed[2] == '\\' || trimmed[2] == '/')
	return filepath.IsAbs(trimmed) || windowsAbsolute || strings.HasPrefix(trimmed, `\\`)
}

func reconcileLocalEnvironmentPortableContracts(input map[string]localEnvironmentPlanDependencyContractState) (map[string]localEnvironmentPlanDependencyContractState, []string, bool) {
	type candidate struct {
		originalKey string
		original    localEnvironmentPlanDependencyContractState
		contract    localEnvironmentPlanDependencyContractState
		proposedKey string
	}
	candidates := make([]candidate, 0, len(input))
	counts := make(map[string]int)
	for key, contract := range input {
		original := contract
		portable, proven := localEnvironmentPortableKey(localEnvironmentSelectedSourceRecordState{
			DependencyFamily: contract.DependencyFamily, DependencyID: contract.DependencyID, EnvironmentKey: contract.EnvironmentKey,
		})
		if proven {
			contract.EnvironmentKey = portable
		}
		proposed := localEnvironmentPlanDependencyContractKey(contract.EnvironmentKey, contract.DependencyFamily, contract.DependencyID, contract.ConsumerScope)
		if proposed != "" {
			counts[proposed]++
		}
		candidates = append(candidates, candidate{originalKey: key, original: original, contract: contract, proposedKey: proposed})
	}
	output := make(map[string]localEnvironmentPlanDependencyContractState, len(input))
	conflicts := make([]string, 0)
	changed := false
	for _, candidate := range candidates {
		contract, key := candidate.contract, candidate.proposedKey
		if key != "" && counts[key] > 1 {
			contract, key = candidate.original, candidate.originalKey
			conflicts = append(conflicts, candidate.original.EnvironmentKey+"|"+candidate.original.ConsumerScope)
		}
		if key == "" {
			key = candidate.originalKey
		}
		output[key] = contract
		changed = changed || key != candidate.originalKey || !reflect.DeepEqual(contract, candidate.original)
	}
	sort.Strings(conflicts)
	return output, conflicts, changed
}

func productControlCheckSyncEnvironmentMaterialSupportsRecord(record localEnvironmentSelectedSourceRecordState, ownerMaterial []engine.ManagedEnvironmentCheckResult, dataRoot string) bool {
	match := func(kind, reference, locator, reason string, requireAvailable bool) bool {
		matched := 0
		for _, resource := range ownerMaterial {
			if resource.Kind != kind || strings.TrimSpace(resource.Reference) != strings.TrimSpace(reference) {
				continue
			}
			matched++
			if strings.TrimSpace(resource.Locator) != strings.TrimSpace(locator) {
				return false
			}
			if requireAvailable {
				if resource.Status != "available" {
					return false
				}
				continue
			}
			if resource.Status != "unavailable" || resource.Reason != reason {
				return false
			}
		}
		return matched == 1
	}
	switch record.DependencyFamily {
	case localEnvironmentFamilyNativeLlama:
		version := strings.TrimSpace(record.Version)
		locator, ok := localEnvironmentOwnerRelativeLocator(dataRoot, record.CanonicalRoot)
		return ok && match("engine_package", string(engine.EngineLlama)+"/"+version, locator, "", true)
	case localEnvironmentFamilyNativeAudioCPP:
		binaryPath := filepath.Join(record.CanonicalRoot, engine.AudioCppCLIExecutableName)
		if !stringSliceContains(record.VerifiedArtifacts, binaryPath) {
			return false
		}
		locator, ok := localEnvironmentOwnerRelativeLocator(dataRoot, binaryPath)
		return ok && match("engine_package", string(engine.EngineAudioCPP)+"/"+engine.AudioCppPackageVersion, locator, "", true)
	case localEnvironmentFamilyPythonUV:
		locator, ok := localEnvironmentOwnerRelativeLocator(dataRoot, record.CanonicalRoot)
		return ok && match("uv_tool", engine.ManagedUVVersion, locator, "UV_TOOL_OWNER_MATERIAL_VERIFIED_SELECTION_REQUIRED", false)
	case localEnvironmentFamilyPythonRuntime:
		locator, ok := localEnvironmentOwnerRelativeLocator(dataRoot, record.CanonicalRoot)
		return ok && match("python_runtime", engine.ManagedPythonVersion, locator, "PYTHON_RUNTIME_OWNER_MATERIAL_VERIFIED_SELECTION_REQUIRED", false)
	case localEnvironmentFamilyPythonVenv, localEnvironmentFamilyPythonPackageSet:
		digest := strings.TrimSpace(record.Hashes["profile_digest"])
		locator, ok := localEnvironmentOwnerRelativeLocator(dataRoot, record.CanonicalRoot)
		expected := filepath.ToSlash(filepath.Join("environments", "python-profiles", digest))
		return ok && locator == expected && match("python_profile", digest, expected, "PYTHON_PROFILE_OWNER_MATERIAL_VERIFIED_SELECTION_REQUIRED", false)
	case localEnvironmentFamilyPythonTorchWheel:
		return false
	default:
		// Other fixed owners retain their intent, but this pass has no direct
		// owner verifier capable of atomically adopting them. Existence alone
		// never promotes a selected source.
		return false
	}
}

func optionalProductControlCheckSyncText(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func sortProductControlCheckSyncResources(resources []ProductControlCheckSyncResourceResult) {
	sort.Slice(resources, func(i, j int) bool {
		left, right := resources[i], resources[j]
		leftKey := left.Kind + "|" + stringValue(left.Reference) + "|" + stringValue(left.Locator)
		rightKey := right.Kind + "|" + stringValue(right.Reference) + "|" + stringValue(right.Locator)
		return leftKey < rightKey
	})
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
