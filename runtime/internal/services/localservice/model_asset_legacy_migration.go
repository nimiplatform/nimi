package localservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	LegacyAssetMigrationMerged          = "merged"
	LegacyAssetMigrationReforged        = "reforged"
	LegacyAssetMigrationLeftWithWarning = "left-with-warning"
)

type LegacyAssetMigrationResult struct {
	LocalAssetID string `json:"localAssetId"`
	ModelAssetID string `json:"modelAssetId,omitempty"`
	Directory    string `json:"directory,omitempty"`
	Disposition  string `json:"disposition"`
	Warning      string `json:"warning,omitempty"`
}

type LegacyAssetMigrationReport struct {
	Items                []LegacyAssetMigrationResult `json:"items"`
	MergedCount          int                          `json:"mergedCount"`
	ReforgedCount        int                          `json:"reforgedCount"`
	LeftWithWarningCount int                          `json:"leftWithWarningCount"`
}

// legacyLocalAssetState is tool-private input for the retired local-state.json
// assets section. Only identity and payload-location facts are interpreted;
// retired execution fields remain opaque in the raw row and are never revived.
type legacyLocalAssetState struct {
	LocalAssetID   string `json:"localAssetId"`
	AssetID        string `json:"assetId"`
	DisplayName    string `json:"displayName,omitempty"`
	Entry          string `json:"entry"`
	SourceRepo     string `json:"sourceRepo"`
	LogicalModelID string `json:"logicalModelId,omitempty"`
}

type pendingLegacyAssetMigration struct {
	rowIndex int
	result   LegacyAssetMigrationResult
}

func (report *LegacyAssetMigrationReport) append(result LegacyAssetMigrationResult) {
	report.Items = append(report.Items, result)
	switch result.Disposition {
	case LegacyAssetMigrationMerged:
		report.MergedCount++
	case LegacyAssetMigrationReforged:
		report.ReforgedCount++
	case LegacyAssetMigrationLeftWithWarning:
		report.LeftWithWarningCount++
	}
}

func (report *LegacyAssetMigrationReport) sort() {
	sort.SliceStable(report.Items, func(i, j int) bool {
		left := report.Items[i]
		right := report.Items[j]
		if left.LocalAssetID != right.LocalAssetID {
			return left.LocalAssetID < right.LocalAssetID
		}
		return left.Directory < right.Directory
	})
}

// @nimi-authority: rule.nimi.runtime.local-compute.r008
// @nimi-authority: rule.nimi.runtime.local-compute.r009
// @nimi-authority: rule.nimi.runtime.local-compute.r014
// MigrateLegacyResolvedAssetsToModelAssetStore is an explicit, one-time
// recovery operation for LocalAsset rows that still point at payload under
// models/resolved. Daemon startup must never call it. It never copies legacy
// kind, engine, capability, or execution fields. Content is re-inventoried in
// place using the same bounded ModelAsset intake as ImportModelAsset; an
// existing content record is reconciled rather than duplicated. Every retired
// row is removed after its one migration attempt so the hard cut can terminate;
// payload that cannot be inventoried remains on disk and is reported for
// explicit recovery review.
func (s *Service) MigrateLegacyResolvedAssetsToModelAssetStore(ctx context.Context) (LegacyAssetMigrationReport, error) {
	report := LegacyAssetMigrationReport{Items: make([]LegacyAssetMigrationResult, 0)}
	if s == nil || !s.adoptResolvedModelImports || s.stateProcessLock == nil {
		return report, errors.New("legacy LocalAsset migration requires an exclusive recovery service")
	}
	document, rawRows, mode, err := readLegacyLocalAssetStateDocument(s.stateStorePath)
	if err != nil {
		return report, fmt.Errorf("read retired LocalAsset state: %w", err)
	}
	report.Items = make([]LegacyAssetMigrationResult, 0, len(rawRows))
	_, dropRetiredServices := document["services"]
	pending := make([]pendingLegacyAssetMigration, 0, len(rawRows))
	removeRows := make(map[int]struct{}, len(rawRows))
	for index, rawRow := range rawRows {
		removeRows[index] = struct{}{}
		var record legacyLocalAssetState
		if err := json.Unmarshal(rawRow, &record); err != nil {
			report.append(LegacyAssetMigrationResult{
				LocalAssetID: strings.TrimSpace(record.LocalAssetID),
				Disposition:  LegacyAssetMigrationLeftWithWarning,
				Warning:      "retired LocalAsset row is malformed: " + err.Error(),
			})
			continue
		}
		record.LocalAssetID = strings.TrimSpace(record.LocalAssetID)
		if record.LocalAssetID == "" {
			report.append(LegacyAssetMigrationResult{
				Disposition: LegacyAssetMigrationLeftWithWarning,
				Warning:     "retired LocalAsset row has no localAssetId",
			})
			continue
		}
		candidateDirectory, legacyCandidate := s.legacyResolvedModelAssetDirectoryCandidate(record)
		if !legacyCandidate {
			report.append(LegacyAssetMigrationResult{
				LocalAssetID: record.LocalAssetID,
				Disposition:  LegacyAssetMigrationLeftWithWarning,
				Warning:      "retired row has no managed resolved payload candidate; payload was not adopted",
			})
			continue
		}
		result := LegacyAssetMigrationResult{LocalAssetID: record.LocalAssetID, Directory: candidateDirectory}
		directory, ok := s.legacyResolvedModelAssetDirectory(record)
		if !ok {
			result.Disposition = LegacyAssetMigrationLeftWithWarning
			result.Warning = "resolved payload directory is unavailable or unsafe"
			report.append(result)
			s.logger.Warn("legacy resolved asset remains for explicit review",
				"local_asset_id", record.LocalAssetID,
				"managed_directory", candidateDirectory,
				"error", result.Warning)
			continue
		}
		files, hashes, _, _, _, err := s.hashResolvedPayloadDetailed(ctx, directory)
		if err != nil || len(files) == 0 {
			warning := "resolved payload contains no inventoryable files"
			if err != nil {
				warning = err.Error()
			}
			result.Disposition = LegacyAssetMigrationLeftWithWarning
			result.Warning = warning
			report.append(result)
			s.logger.Warn("legacy resolved asset remains for explicit review",
				"local_asset_id", record.LocalAssetID,
				"managed_directory", directory,
				"error", err)
			continue
		}
		contentID := modelAssetContentID(files)
		catalogMatched := s.modelAssetCatalogMatch(hashes)
		if existing := s.modelAssetWithContentID(contentID); existing != nil {
			result.ModelAssetID = existing.GetModelAssetId()
			if err := s.rederiveStoredModelAssetCatalogVerification(existing.GetModelAssetId(), catalogMatched); err != nil {
				result.Disposition = LegacyAssetMigrationLeftWithWarning
				result.Warning = err.Error()
				report.append(result)
				continue
			}
			result.Disposition = LegacyAssetMigrationMerged
			pending = append(pending, pendingLegacyAssetMigration{rowIndex: index, result: result})
			continue
		}
		displayName := strings.TrimSpace(record.DisplayName)
		if displayName == "" {
			displayName = strings.TrimSpace(record.AssetID)
		}
		if displayName == "" {
			displayName = filepath.Base(directory)
		}
		adopted, _, err := s.adoptResolvedModelAssetDirectoryWithOptions(ctx, directory, modelAssetAdoptionOptions{
			displayName:    displayName,
			preferredEntry: strings.TrimSpace(record.Entry),
			provenance: map[string]any{
				"source_kind":           "legacy_local_asset_migration",
				"source_name":           filepath.Base(directory),
				"legacy_local_asset_id": record.LocalAssetID,
				"distribution":          "directory",
			},
		})
		if err != nil {
			result.Disposition = LegacyAssetMigrationLeftWithWarning
			result.Warning = err.Error()
			report.append(result)
			s.logger.Warn("legacy resolved asset migration deferred",
				"local_asset_id", record.LocalAssetID,
				"managed_directory", directory,
				"error", err)
			continue
		}
		result.Disposition = LegacyAssetMigrationReforged
		result.ModelAssetID = adopted.GetModelAssetId()
		pending = append(pending, pendingLegacyAssetMigration{rowIndex: index, result: result})
	}

	if len(rawRows) == 0 && !dropRetiredServices {
		report.sort()
		return report, nil
	}
	if err := rewriteLegacyLocalAssetStateDocument(s.stateStorePath, document, rawRows, removeRows, dropRetiredServices, mode); err != nil {
		for _, item := range pending {
			item.result.Disposition = LegacyAssetMigrationLeftWithWarning
			item.result.Warning = "ModelAsset was inventoried, but the retired state row was not removed: " + err.Error()
			report.append(item.result)
		}
		report.sort()
		return report, fmt.Errorf("commit retired LocalAsset state removal: %w", err)
	}
	for _, item := range pending {
		report.append(item.result)
	}
	if dropRetiredServices {
		s.logger.Info("removed retired LocalService state during explicit local-model recovery")
	}
	report.sort()
	return report, nil
}

func readLegacyLocalAssetStateDocument(path string) (map[string]json.RawMessage, []json.RawMessage, os.FileMode, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, nil, 0, errors.New("Runtime local state path is required")
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil, 0o600, nil
		}
		return nil, nil, 0, err
	}
	var document map[string]json.RawMessage
	if len(payload) == 0 {
		return nil, nil, 0, errors.New("local-state.json is empty")
	}
	if err := json.Unmarshal(payload, &document); err != nil {
		return nil, nil, 0, err
	}
	if document == nil {
		return nil, nil, 0, errors.New("local-state.json must be a JSON object")
	}
	var schemaVersion int
	if rawVersion, ok := document["schemaVersion"]; !ok {
		return nil, nil, 0, errors.New("local-state.json schemaVersion is required")
	} else if err := json.Unmarshal(rawVersion, &schemaVersion); err != nil {
		return nil, nil, 0, fmt.Errorf("decode local-state.json schemaVersion: %w", err)
	}
	if schemaVersion != localStateSchemaVersion {
		return nil, nil, 0, fmt.Errorf("unsupported schemaVersion=%d (expected %d)", schemaVersion, localStateSchemaVersion)
	}
	rows := make([]json.RawMessage, 0)
	if rawAssets, ok := document["assets"]; ok && len(rawAssets) > 0 && string(rawAssets) != "null" {
		if err := json.Unmarshal(rawAssets, &rows); err != nil {
			return nil, nil, 0, fmt.Errorf("decode retired assets rows: %w", err)
		}
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, nil, 0, err
	}
	mode := info.Mode().Perm()
	return document, rows, mode, nil
}

func rewriteLegacyLocalAssetStateDocument(path string, document map[string]json.RawMessage, rows []json.RawMessage, removeRows map[int]struct{}, dropRetiredServices bool, mode os.FileMode) error {
	retained := make([]json.RawMessage, 0, len(rows)-len(removeRows))
	for index, row := range rows {
		if _, remove := removeRows[index]; remove {
			continue
		}
		retained = append(retained, append(json.RawMessage(nil), row...))
	}
	if len(retained) == 0 {
		delete(document, "assets")
	} else {
		payload, err := json.Marshal(retained)
		if err != nil {
			return err
		}
		document["assets"] = payload
	}
	if dropRetiredServices {
		delete(document, "services")
	}
	payload, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	return writeFileAtomically(path, payload, mode)
}

func (s *Service) legacyResolvedModelAssetDirectoryCandidate(record legacyLocalAssetState) (string, bool) {
	if strings.TrimSpace(record.LocalAssetID) == "" {
		return "", false
	}
	modelsRoot := s.resolvedLocalModelsPath()
	if repo := strings.TrimSpace(record.SourceRepo); strings.HasPrefix(strings.ToLower(repo), "file://") && strings.HasSuffix(strings.ToLower(repo), "/asset.manifest.json") {
		manifestPath, err := resolveManagedFileRepoPath(repo)
		if err == nil {
			root, rootErr := filepath.Abs(filepath.Clean(modelsRoot))
			manifest, manifestErr := filepath.Abs(filepath.Clean(manifestPath))
			if rootErr == nil && manifestErr == nil && strings.EqualFold(filepath.Base(manifest), localAssetManifestFileName) {
				resolvedRoot := filepath.Join(root, "resolved")
				if pathWithinBase(resolvedRoot, manifest, false) && filepath.Dir(manifest) != resolvedRoot {
					return filepath.Dir(manifest), true
				}
			}
		}
	}
	if logicalModelID := strings.TrimSpace(record.LogicalModelID); logicalModelID != "" {
		if directory, err := resolveRuntimeManagedModelBundleDir(modelsRoot, logicalModelID); err == nil {
			if info, statErr := os.Lstat(directory); statErr == nil && info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
				return filepath.Clean(directory), true
			}
		}
	}
	return "", false
}

func (s *Service) legacyResolvedModelAssetDirectory(record legacyLocalAssetState) (string, bool) {
	directory, ok := s.legacyResolvedModelAssetDirectoryCandidate(record)
	if !ok {
		return "", false
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", false
	}
	modelsRoot, err := filepath.EvalSymlinks(s.resolvedLocalModelsPath())
	if err != nil {
		return "", false
	}
	resolvedDirectory, err := filepath.EvalSymlinks(directory)
	if err != nil || !pathWithinBase(filepath.Join(modelsRoot, "resolved"), resolvedDirectory, false) {
		return "", false
	}
	return filepath.Clean(directory), true
}

func (s *Service) modelAssetWithContentID(contentID string) *runtimev1.ModelAssetRecord {
	normalized := strings.TrimSpace(contentID)
	if normalized == "" {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, asset := range s.modelAssets {
		if asset != nil && asset.GetContentId() == normalized {
			return cloneModelAsset(asset)
		}
	}
	return nil
}

func (s *Service) rederiveStoredModelAssetCatalogVerification(modelAssetID string, matched bool) error {
	want := runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_NOT_MATCHED
	if matched {
		want = runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_MATCHED
	}
	s.modelAssetMutationMu.Lock()
	defer s.modelAssetMutationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	current := s.modelAssets[strings.TrimSpace(modelAssetID)]
	if current == nil || current.GetCatalogVerification() == want {
		return nil
	}
	before := cloneModelAsset(current)
	updated := cloneModelAsset(current)
	updated.CatalogVerification = want
	updated.UpdatedAt = nowISO()
	s.modelAssets[updated.GetModelAssetId()] = updated
	if err := s.persistModelAssetStoreLocked(); err != nil {
		s.modelAssets[before.GetModelAssetId()] = before
		return err
	}
	return nil
}
