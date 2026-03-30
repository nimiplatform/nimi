package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

const ggufMagicHeader = "GGUF"
const minManagedGGUFSizeBytes = 4 * 1024

type managedModelManifestCandidate struct {
	manifestPath   string
	sourceDir      string
	logicalModelID string
	modelID        string
	entry          string
	integrityMode  string
}

func shouldUseLogicalManagedBundlePath(model *runtimev1.LocalModelRecord) bool {
	if model == nil {
		return false
	}
	if strings.ToLower(filepath.Ext(strings.TrimSpace(model.GetEntry()))) != ".gguf" {
		return false
	}
	repo := strings.TrimSpace(model.GetSource().GetRepo())
	if strings.HasPrefix(repo, "file://") && strings.HasSuffix(strings.ToLower(repo), "/manifest.json") {
		return true
	}
	return strings.HasPrefix(strings.ToLower(repo), "local-import/")
}

func sanitizeManagedEntryPath(entry string) (string, error) {
	cleanEntry := filepath.Clean(strings.TrimSpace(entry))
	if cleanEntry == "." || cleanEntry == "" || filepath.IsAbs(cleanEntry) || cleanEntry == ".." ||
		strings.HasPrefix(cleanEntry, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("managed local model entry path is invalid")
	}
	return cleanEntry, nil
}

func resolveManagedModelEntryAbsolutePath(modelsRoot string, model *runtimev1.LocalModelRecord) (string, error) {
	if model == nil {
		return "", fmt.Errorf("managed local model is unavailable")
	}
	root := strings.TrimSpace(modelsRoot)
	if root == "" {
		return "", fmt.Errorf("runtime local models root is unavailable")
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("resolve runtime local models root: %w", err)
	}
	cleanEntry, err := sanitizeManagedEntryPath(model.GetEntry())
	if err != nil {
		return "", err
	}
	if logicalModelID := strings.Trim(strings.TrimSpace(model.GetLogicalModelId()), "/"); logicalModelID != "" && shouldUseLogicalManagedBundlePath(model) {
		entryPath := filepath.Join(rootAbs, "resolved", filepath.FromSlash(logicalModelID), cleanEntry)
		entryPath, err = filepath.Abs(entryPath)
		if err != nil {
			return "", fmt.Errorf("resolve managed local model entry path: %w", err)
		}
		if !strings.HasPrefix(entryPath, rootAbs+string(filepath.Separator)) && entryPath != rootAbs {
			return "", fmt.Errorf("managed local model entry escapes runtime models root")
		}
		return entryPath, nil
	}
	relativePath, err := resolveManagedEntryRelativePath(rootAbs, model.GetModelId(), model.GetSource().GetRepo(), cleanEntry)
	if err != nil {
		return "", err
	}
	entryPath := filepath.Join(rootAbs, filepath.FromSlash(relativePath))
	entryPath, err = filepath.Abs(entryPath)
	if err != nil {
		return "", fmt.Errorf("resolve managed local model entry path: %w", err)
	}
	return entryPath, nil
}

func validateManagedModelEntryFile(path string) error {
	entryPath := strings.TrimSpace(path)
	if entryPath == "" {
		return fmt.Errorf("managed local model entry path is empty")
	}
	info, err := os.Stat(entryPath)
	if err != nil {
		return fmt.Errorf("managed local model entry missing: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("managed local model entry is not a regular file")
	}
	switch strings.ToLower(filepath.Ext(entryPath)) {
	case ".gguf":
		if info.Size() < minManagedGGUFSizeBytes {
			return fmt.Errorf("gguf payload too small")
		}
		file, err := os.Open(entryPath)
		if err != nil {
			return fmt.Errorf("open gguf entry: %w", err)
		}
		defer file.Close()
		header := make([]byte, len(ggufMagicHeader))
		if _, err := io.ReadFull(file, header); err != nil {
			return fmt.Errorf("read gguf header: %w", err)
		}
		if string(header) != ggufMagicHeader {
			return fmt.Errorf("gguf header invalid")
		}
	}
	return nil
}

func normalizeExpectedSHA256Hash(value string) string {
	trimmed := strings.TrimSpace(strings.ToLower(value))
	trimmed = strings.TrimPrefix(trimmed, "sha256:")
	if len(trimmed) != 64 {
		return ""
	}
	return trimmed
}

func expectedManagedModelEntryHash(model *runtimev1.LocalModelRecord) string {
	if model == nil || len(model.GetHashes()) == 0 {
		return ""
	}
	entry := strings.TrimSpace(model.GetEntry())
	if entry == "" {
		return ""
	}
	if hash := normalizeExpectedSHA256Hash(model.GetHashes()[entry]); hash != "" {
		return hash
	}
	base := filepath.Base(entry)
	if hash := normalizeExpectedSHA256Hash(model.GetHashes()[base]); hash != "" {
		return hash
	}
	if len(model.GetHashes()) == 1 {
		for _, value := range model.GetHashes() {
			if hash := normalizeExpectedSHA256Hash(value); hash != "" {
				return hash
			}
		}
	}
	return ""
}

func computeFileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func (s *Service) cachedFileSHA256(path string, info os.FileInfo) (string, error) {
	if info == nil {
		var err error
		info, err = os.Stat(path)
		if err != nil {
			return "", err
		}
	}
	cacheKey := filepath.Clean(strings.TrimSpace(path))
	modTimeUnixNano := info.ModTime().UnixNano()
	size := info.Size()
	s.mu.RLock()
	cached, ok := s.entryHashCache[cacheKey]
	s.mu.RUnlock()
	if ok && cached.size == size && cached.modTimeUnixNano == modTimeUnixNano && strings.TrimSpace(cached.sha256) != "" {
		return cached.sha256, nil
	}
	sum, err := computeFileSHA256(cacheKey)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	s.entryHashCache[cacheKey] = entryHashCacheState{
		size:            size,
		modTimeUnixNano: modTimeUnixNano,
		sha256:          sum,
	}
	s.mu.Unlock()
	return sum, nil
}

func (s *Service) validateManagedModelEntryForModel(path string, model *runtimev1.LocalModelRecord) error {
	if err := validateManagedModelEntryFile(path); err != nil {
		return err
	}
	expectedHash := expectedManagedModelEntryHash(model)
	if expectedHash == "" {
		return nil
	}
	info, err := os.Stat(strings.TrimSpace(path))
	if err != nil {
		return fmt.Errorf("stat managed local model entry: %w", err)
	}
	actualHash, err := s.cachedFileSHA256(path, info)
	if err != nil {
		return fmt.Errorf("compute managed local model entry hash: %w", err)
	}
	if !strings.EqualFold(actualHash, expectedHash) {
		return fmt.Errorf("managed local model entry hash mismatch")
	}
	return nil
}

func managedLocalModelBundleFailureDetail(err error) string {
	if err == nil {
		return "managed local model bundle invalid"
	}
	return "managed local model bundle invalid: " + strings.TrimSpace(err.Error())
}

func managedLocalModelRecordFailureDetail(err error) string {
	if err == nil {
		return "managed local model record unresolved"
	}
	return "managed local model record unresolved: " + strings.TrimSpace(err.Error())
}

func managedLocalModelRegistrationFailureDetail(problem string) string {
	trimmed := strings.TrimSpace(problem)
	if trimmed == "" {
		return "managed local model registration missing"
	}
	return "managed local model registration missing: " + trimmed
}

func managedLocalModelReadyDetail() string {
	return "managed local model ready"
}

func managedLocalModelReadyNotStartedDetail() string {
	return "managed local model ready (not started)"
}

func isManagedSupervisedLlamaModel(model *runtimev1.LocalModelRecord, mode runtimev1.LocalEngineRuntimeMode) bool {
	if model == nil {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(model.GetEngine()), "llama") {
		return false
	}
	if strings.ToLower(filepath.Ext(strings.TrimSpace(model.GetEntry()))) != ".gguf" {
		return false
	}
	if shouldHealManagedSupervisedLlamaRuntimeMode(model, mode) {
		return true
	}
	return normalizeRuntimeMode(mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED
}

func shouldHealManagedSupervisedLlamaRuntimeMode(model *runtimev1.LocalModelRecord, mode runtimev1.LocalEngineRuntimeMode) bool {
	if model == nil {
		return false
	}
	if normalizeRuntimeMode(mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(model.GetEngine()), "llama") {
		return false
	}
	if strings.ToLower(filepath.Ext(strings.TrimSpace(model.GetEntry()))) != ".gguf" {
		return false
	}
	repo := strings.ToLower(strings.TrimSpace(model.GetSource().GetRepo()))
	if strings.HasPrefix(repo, "file://") && strings.HasSuffix(repo, "/manifest.json") {
		return true
	}
	if strings.HasPrefix(repo, "local-import/") {
		return true
	}
	logicalModelID := strings.Trim(strings.TrimSpace(model.GetLogicalModelId()), "/")
	return strings.HasPrefix(strings.ToLower(logicalModelID), "nimi/")
}

func (s *Service) healManagedSupervisedLlamaRuntimeMode(localModelID string) (*runtimev1.LocalModelRecord, bool, error) {
	id := strings.TrimSpace(localModelID)
	if id == "" {
		return nil, false, nil
	}
	current := s.modelByID(id)
	if current == nil {
		return nil, false, nil
	}
	if !shouldHealManagedSupervisedLlamaRuntimeMode(current, s.modelRuntimeMode(id)) {
		return current, false, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record := s.models[id]
	if record == nil {
		return nil, false, nil
	}
	if !shouldHealManagedSupervisedLlamaRuntimeMode(record, s.modelRuntimeModes[id]) {
		return cloneLocalModel(record), false, nil
	}
	s.setModelRuntimeModeLocked(id, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED)
	cloned := cloneLocalModel(record)
	s.models[id] = cloned
	s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id:           "audit_" + ulid.Make().String(),
		EventType:    "runtime_model_runtime_mode_healed",
		OccurredAt:   nowISO(),
		Source:       "local",
		ModelId:      cloned.GetModelId(),
		LocalModelId: cloned.GetLocalModelId(),
		Detail:       "managed llama runtime mode healed to supervised",
	})
	s.persistStateLocked()
	return cloneLocalModel(cloned), true, nil
}

func isLegacyManagedLocalImportRecord(model *runtimev1.LocalModelRecord, mode runtimev1.LocalEngineRuntimeMode) bool {
	if !isManagedSupervisedLlamaModel(model, mode) {
		return false
	}
	repo := strings.ToLower(strings.TrimSpace(model.GetSource().GetRepo()))
	if strings.HasPrefix(repo, "local-import/") {
		return true
	}
	logicalModelID := strings.Trim(strings.TrimSpace(model.GetLogicalModelId()), "/")
	return logicalModelID != "" && !strings.HasPrefix(strings.ToLower(logicalModelID), "nimi/")
}

func loadManagedModelManifestCandidate(root string, manifestPath string) (managedModelManifestCandidate, error) {
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		return managedModelManifestCandidate{}, err
	}
	var manifest map[string]any
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return managedModelManifestCandidate{}, err
	}
	logicalModelID := strings.Trim(strings.TrimSpace(manifestStringDefault(manifest, "logical_model_id", "logicalModelId")), "/")
	if logicalModelID == "" {
		resolvedRoot := filepath.Join(strings.TrimSpace(root), "resolved")
		if rel, relErr := filepath.Rel(resolvedRoot, filepath.Dir(manifestPath)); relErr == nil && rel != "." && rel != "" &&
			rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			logicalModelID = filepath.ToSlash(rel)
		}
	}
	return managedModelManifestCandidate{
		manifestPath:   manifestPath,
		sourceDir:      filepath.Dir(manifestPath),
		logicalModelID: logicalModelID,
		modelID:        strings.TrimSpace(manifestStringDefault(manifest, "model_id", "modelId")),
		entry:          strings.TrimSpace(manifestStringDefault(manifest, "entry")),
		integrityMode:  strings.TrimSpace(manifestStringDefault(manifest, "integrity_mode", "integrityMode")),
	}, nil
}

func scanManagedModelManifestCandidates(root string) ([]managedModelManifestCandidate, error) {
	if strings.TrimSpace(root) == "" {
		return nil, nil
	}
	resolvedRoot := filepath.Join(root, "resolved")
	if _, err := os.Stat(resolvedRoot); err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	candidates := make([]managedModelManifestCandidate, 0)
	if err := filepath.WalkDir(resolvedRoot, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		if !strings.EqualFold(d.Name(), "manifest.json") {
			return nil
		}
		candidate, err := loadManagedModelManifestCandidate(root, path)
		if err != nil {
			return nil
		}
		if strings.TrimSpace(candidate.logicalModelID) == "" {
			return nil
		}
		candidates = append(candidates, candidate)
		return nil
	}); err != nil {
		return nil, err
	}
	return candidates, nil
}

func matchManagedModelManifestCandidate(model *runtimev1.LocalModelRecord, candidates []managedModelManifestCandidate) (managedModelManifestCandidate, bool) {
	if model == nil || len(candidates) == 0 {
		return managedModelManifestCandidate{}, false
	}
	type scoredCandidate struct {
		candidate managedModelManifestCandidate
		score     int
	}
	expectedModelID := strings.TrimSpace(model.GetModelId())
	expectedComparableModelID := normalizeLocalInventoryID(expectedModelID)
	expectedEntry := strings.TrimSpace(model.GetEntry())
	scored := make([]scoredCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		score := 0
		if expectedComparableModelID != "" && normalizeLocalInventoryID(candidate.modelID) == expectedComparableModelID {
			score += 8
		}
		if expectedEntry != "" && strings.EqualFold(candidate.entry, expectedEntry) {
			score += 4
		}
		if strings.EqualFold(candidate.integrityMode, "local_unverified") {
			score += 2
		}
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(candidate.logicalModelID)), "nimi/") {
			score++
		}
		if score == 0 {
			continue
		}
		scored = append(scored, scoredCandidate{candidate: candidate, score: score})
	}
	if len(scored) == 0 {
		return managedModelManifestCandidate{}, false
	}
	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		return scored[i].candidate.manifestPath < scored[j].candidate.manifestPath
	})
	return scored[0].candidate, true
}

func (s *Service) healLegacyManagedLocalImportRecord(localModelID string) (*runtimev1.LocalModelRecord, bool, error) {
	current := s.modelByID(localModelID)
	if current == nil {
		return nil, false, fmt.Errorf("managed local model is unavailable")
	}
	if !isLegacyManagedLocalImportRecord(current, s.modelRuntimeMode(localModelID)) {
		return current, false, nil
	}

	runtimeModelsRoot := s.resolvedLocalModelsPath()
	runtimeCandidates, err := scanManagedModelManifestCandidates(runtimeModelsRoot)
	if err != nil {
		return current, false, fmt.Errorf("scan runtime managed manifests: %w", err)
	}
	candidate, ok := matchManagedModelManifestCandidate(current, runtimeCandidates)
	if !ok {
		desktopModelsRoot := resolveDesktopLocalRuntimeModelsPath()
		desktopCandidates, desktopErr := scanManagedModelManifestCandidates(desktopModelsRoot)
		if desktopErr != nil {
			return current, false, fmt.Errorf("scan desktop managed manifests: %w", desktopErr)
		}
		desktopCandidate, desktopOK := matchManagedModelManifestCandidate(current, desktopCandidates)
		if !desktopOK {
			return current, false, fmt.Errorf("no managed bundle manifest matched model_id=%q entry=%q", current.GetModelId(), current.GetEntry())
		}
		destDir := runtimeManagedResolvedModelDir(runtimeModelsRoot, desktopCandidate.logicalModelID)
		stageDir, err := prepareManagedModelBundleStageDir(destDir, "heal")
		if err != nil {
			return current, false, err
		}
		if err := copyDirRecursive(desktopCandidate.sourceDir, stageDir); err != nil {
			_, _ = s.quarantineManagedModelBundle(runtimeModelsRoot, desktopCandidate.logicalModelID, stageDir, "managed_model_heal", fmt.Sprintf("copy desktop candidate: %v", err), desktopCandidate.modelID, localModelID)
			return current, false, fmt.Errorf("copy desktop managed bundle into runtime root: %w", err)
		}
		activation, err := activateManagedModelBundle(destDir, stageDir)
		if err != nil {
			_, _ = s.quarantineManagedModelBundle(runtimeModelsRoot, desktopCandidate.logicalModelID, stageDir, "managed_model_heal", fmt.Sprintf("activate desktop candidate: %v", err), desktopCandidate.modelID, localModelID)
			return current, false, fmt.Errorf("activate healed managed bundle: %w", err)
		}
		if commitErr := activation.Commit(); commitErr != nil {
			s.logger.Warn("cleanup managed bundle backup failed after heal", "logical_model_id", desktopCandidate.logicalModelID, "error", commitErr)
		}
		candidate = managedModelManifestCandidate{
			manifestPath:   filepath.Join(destDir, "manifest.json"),
			sourceDir:      destDir,
			logicalModelID: desktopCandidate.logicalModelID,
			modelID:        desktopCandidate.modelID,
			entry:          desktopCandidate.entry,
			integrityMode:  desktopCandidate.integrityMode,
		}
	}

	if strings.TrimSpace(candidate.logicalModelID) == "" || strings.TrimSpace(candidate.manifestPath) == "" {
		return current, false, fmt.Errorf("matched managed bundle manifest is incomplete")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	record := s.models[strings.TrimSpace(localModelID)]
	if record == nil {
		return nil, false, fmt.Errorf("managed local model is unavailable")
	}
	cloned := cloneLocalModel(record)
	if cloned.Source == nil {
		cloned.Source = &runtimev1.LocalModelSource{}
	}
	changed := false
	if strings.Trim(strings.TrimSpace(cloned.GetLogicalModelId()), "/") != strings.Trim(candidate.logicalModelID, "/") {
		cloned.LogicalModelId = strings.Trim(candidate.logicalModelID, "/")
		changed = true
	}
	manifestRepo := "file://" + filepath.ToSlash(candidate.manifestPath)
	if strings.TrimSpace(cloned.GetSource().GetRepo()) != manifestRepo {
		cloned.Source.Repo = manifestRepo
		changed = true
	}
	if strings.TrimSpace(cloned.GetSource().GetRevision()) == "" {
		cloned.Source.Revision = "local"
		changed = true
	}
	if !changed {
		return cloned, false, nil
	}
	cloned.UpdatedAt = nowISO()
	s.models[strings.TrimSpace(localModelID)] = cloned
	s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id:           "audit_" + ulid.Make().String(),
		EventType:    "runtime_model_record_healed_from_legacy_local_import",
		OccurredAt:   nowISO(),
		Source:       "local",
		ModelId:      cloned.GetModelId(),
		LocalModelId: cloned.GetLocalModelId(),
		Detail:       "legacy local-import runtime record healed to runtime managed manifest",
		Payload: toStruct(map[string]any{
			"logicalModelId": cloned.GetLogicalModelId(),
			"manifestPath":   candidate.manifestPath,
		}),
	})
	return cloneLocalModel(cloned), true, nil
}

func (s *Service) healLegacyManagedLocalImportRecords() bool {
	s.mu.RLock()
	localModelIDs := make([]string, 0, len(s.models))
	for localModelID := range s.models {
		localModelIDs = append(localModelIDs, localModelID)
	}
	s.mu.RUnlock()
	sort.Strings(localModelIDs)
	changed := false
	for _, localModelID := range localModelIDs {
		if _, healed, err := s.healManagedSupervisedLlamaRuntimeMode(localModelID); err == nil && healed {
			changed = true
		} else if err != nil {
			s.logger.Warn("heal managed llama runtime mode failed", "local_model_id", localModelID, "error", err)
		}
		if _, healed, err := s.healLegacyManagedLocalImportRecord(localModelID); err == nil && healed {
			changed = true
		} else if err != nil {
			s.logger.Warn("heal legacy local-import runtime record failed", "local_model_id", localModelID, "error", err)
		}
	}
	return changed
}

func (s *Service) HasManagedSupervisedLlamaModels() bool {
	s.healLegacyManagedLocalImportRecords()
	s.mu.RLock()
	defer s.mu.RUnlock()
	for localModelID, model := range s.models {
		if model == nil || model.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
			continue
		}
		if isManagedSupervisedLlamaModel(model, s.modelRuntimeModes[localModelID]) {
			return true
		}
	}
	return false
}

func (s *Service) ensureManagedLocalModelBundleReady(ctx context.Context, model *runtimev1.LocalModelRecord) (string, bool, error) {
	if model == nil {
		return "", false, fmt.Errorf("managed local model is unavailable")
	}
	localModelID := strings.TrimSpace(model.GetLocalModelId())
	if localModelID == "" {
		return "", false, fmt.Errorf("managed local model is unavailable")
	}
	if healedModel, _, err := s.healManagedSupervisedLlamaRuntimeMode(localModelID); err != nil {
		return "", false, err
	} else if healedModel != nil {
		model = healedModel
	}
	if healedModel, _, err := s.healLegacyManagedLocalImportRecord(localModelID); err != nil {
		return "", false, err
	} else if healedModel != nil {
		model = healedModel
	}
	if !strings.EqualFold(strings.TrimSpace(model.GetEngine()), "llama") {
		return "", false, nil
	}
	if strings.ToLower(filepath.Ext(strings.TrimSpace(model.GetEntry()))) != ".gguf" {
		return "", false, nil
	}
	if normalizeRuntimeMode(s.modelRuntimeMode(model.GetLocalModelId())) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		return "", false, nil
	}

	modelsRoot := s.resolvedLocalModelsPath()
	entryPath, err := resolveManagedModelEntryAbsolutePath(modelsRoot, model)
	if err == nil {
		if validateErr := s.validateManagedModelEntryForModel(entryPath, model); validateErr == nil {
			if syncErr := s.SyncManagedLlamaAssets(ctx); syncErr != nil {
				return "", false, fmt.Errorf("sync managed llama assets: %w", syncErr)
			}
			return entryPath, false, nil
		} else {
			err = validateErr
		}
	}

	if repaired, repairErr := s.repairManagedLocalModelBundleFromDesktop(model); repairErr == nil && repaired {
		refreshed := s.modelByID(model.GetLocalModelId())
		if refreshed != nil {
			model = refreshed
		}
		entryPath, resolveErr := resolveManagedModelEntryAbsolutePath(modelsRoot, model)
		if resolveErr != nil {
			return "", true, fmt.Errorf("resolve repaired managed local model entry: %w", resolveErr)
		}
		if validateErr := s.validateManagedModelEntryForModel(entryPath, model); validateErr != nil {
			return "", true, fmt.Errorf("validate repaired managed local model entry: %w", validateErr)
		}
		if syncErr := s.SyncManagedLlamaAssets(ctx); syncErr != nil {
			return "", true, fmt.Errorf("sync managed llama assets: %w", syncErr)
		}
		return entryPath, true, nil
	}

	return "", false, err
}

func (s *Service) repairManagedLocalModelBundleFromDesktop(model *runtimev1.LocalModelRecord) (bool, error) {
	if model == nil {
		return false, fmt.Errorf("managed local model is unavailable")
	}
	logicalModelID := strings.Trim(strings.TrimSpace(model.GetLogicalModelId()), "/")
	if logicalModelID == "" {
		return false, fmt.Errorf("managed local model logical id is unavailable")
	}
	cleanEntry, err := sanitizeManagedEntryPath(model.GetEntry())
	if err != nil {
		return false, err
	}

	desktopModelsRoot := resolveDesktopLocalRuntimeModelsPath()
	if strings.TrimSpace(desktopModelsRoot) == "" {
		return false, fmt.Errorf("desktop local models root is unavailable")
	}
	srcDir := filepath.Join(desktopModelsRoot, "resolved", filepath.FromSlash(logicalModelID))
	srcManifestPath := filepath.Join(srcDir, "manifest.json")
	if _, err := os.Stat(srcManifestPath); err != nil {
		return false, fmt.Errorf("legacy desktop managed bundle missing: %w", err)
	}
	srcEntryPath := filepath.Join(srcDir, cleanEntry)
	if err := s.validateManagedModelEntryForModel(srcEntryPath, model); err != nil {
		return false, fmt.Errorf("legacy desktop managed bundle invalid: %w", err)
	}

	modelsRoot := s.resolvedLocalModelsPath()
	destDir := filepath.Join(modelsRoot, "resolved", filepath.FromSlash(logicalModelID))
	stageDir, err := prepareManagedModelBundleStageDir(destDir, "repair")
	if err != nil {
		return false, err
	}
	if err := copyDirRecursive(srcDir, stageDir); err != nil {
		_, _ = s.quarantineManagedModelBundle(modelsRoot, logicalModelID, stageDir, "managed_model_repair", fmt.Sprintf("copy desktop bundle: %v", err), model.GetModelId(), model.GetLocalModelId())
		return false, fmt.Errorf("repair runtime managed bundle from desktop: %w", err)
	}
	activation, err := activateManagedModelBundle(destDir, stageDir)
	if err != nil {
		_, _ = s.quarantineManagedModelBundle(modelsRoot, logicalModelID, stageDir, "managed_model_repair", fmt.Sprintf("activate repaired bundle: %v", err), model.GetModelId(), model.GetLocalModelId())
		return false, fmt.Errorf("activate repaired runtime managed bundle: %w", err)
	}
	if commitErr := activation.Commit(); commitErr != nil {
		s.logger.Warn("cleanup managed bundle backup failed after repair", "logical_model_id", logicalModelID, "error", commitErr)
	}
	destManifestPath := filepath.Join(destDir, "manifest.json")
	s.rewriteManagedLocalModelSourceRepo(model.GetLocalModelId(), destManifestPath)
	return true, nil
}

func (s *Service) rewriteManagedLocalModelSourceRepo(localModelID string, manifestPath string) {
	id := strings.TrimSpace(localModelID)
	manifest := strings.TrimSpace(manifestPath)
	if id == "" || manifest == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record := s.models[id]
	if record == nil {
		return
	}
	cloned := cloneLocalModel(record)
	if cloned.Source == nil {
		cloned.Source = &runtimev1.LocalModelSource{}
	}
	cloned.Source.Repo = "file://" + filepath.ToSlash(manifest)
	if strings.TrimSpace(cloned.Source.GetRevision()) == "" {
		cloned.Source.Revision = "local"
	}
	cloned.UpdatedAt = nowISO()
	s.models[id] = cloned
	s.persistStateLocked()
}
