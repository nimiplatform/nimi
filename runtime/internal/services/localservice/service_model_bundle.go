package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
	"github.com/oklog/ulid/v2"
)

const ggufMagicHeader = "GGUF"
const minManagedGGUFSizeBytes = 4 * 1024

func shouldUseLogicalManagedBundlePath(model *runtimev1.LocalAssetRecord) bool {
	if model == nil {
		return false
	}
	if strings.ToLower(filepath.Ext(strings.TrimSpace(model.GetEntry()))) != ".gguf" {
		return false
	}
	repo := strings.TrimSpace(model.GetSource().GetRepo())
	if strings.HasPrefix(repo, "file://") && strings.HasSuffix(strings.ToLower(repo), "/asset.manifest.json") {
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

func resolveManagedModelEntryAbsolutePath(modelsRoot string, model *runtimev1.LocalAssetRecord) (string, error) {
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
	relativePath, err := resolveManagedEntryRelativePath(rootAbs, model.GetAssetId(), model.GetSource().GetRepo(), cleanEntry)
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
		if placeholder, err := ggufLooksHeaderOnlyPlaceholder(file); err != nil {
			return fmt.Errorf("inspect gguf payload: %w", err)
		} else if placeholder {
			return fmt.Errorf("gguf payload placeholder or truncated")
		}
	}
	return nil
}

func validateManagedModelEntryStaticCompatibility(path string, kind runtimev1.LocalAssetKind, capabilities []string, engine string) error {
	entryPath := strings.TrimSpace(path)
	if entryPath == "" {
		return fmt.Errorf("managed local model entry path is empty")
	}
	if strings.ToLower(filepath.Ext(entryPath)) != ".gguf" {
		return nil
	}
	if !isCanonicalSupervisedImageAsset(engine, capabilities, kind) {
		return nil
	}
	summary, err := ggufmeta.InspectPath(entryPath)
	if err != nil {
		return fmt.Errorf("inspect image gguf metadata: %w", err)
	}
	if issue := ggufmeta.StableDiffusionMetadataIssue(summary); issue != "" {
		return fmt.Errorf("image gguf incompatible with runtime stablediffusion-ggml backend: %s", issue)
	}
	return nil
}

func ggufLooksHeaderOnlyPlaceholder(file *os.File) (bool, error) {
	const sampleSize = 256
	sample := make([]byte, sampleSize)
	n, err := file.ReadAt(sample, 0)
	if err != nil && err != io.EOF {
		return false, err
	}
	if n <= len(ggufMagicHeader) {
		return true, nil
	}
	sample = sample[:n]
	for _, value := range sample[len(ggufMagicHeader):] {
		if value != 0 {
			return false, nil
		}
	}
	return true, nil
}

func normalizeExpectedSHA256Hash(value string) string {
	trimmed := strings.TrimSpace(strings.ToLower(value))
	trimmed = strings.TrimPrefix(trimmed, "sha256:")
	if len(trimmed) != 64 {
		return ""
	}
	return trimmed
}

func expectedManagedModelEntryHash(model *runtimev1.LocalAssetRecord) string {
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

func (s *Service) validateManagedModelEntryForModel(path string, model *runtimev1.LocalAssetRecord) error {
	if err := validateManagedModelEntryFile(path); err != nil {
		return err
	}
	if err := validateManagedModelEntryStaticCompatibility(path, model.GetKind(), model.GetCapabilities(), model.GetEngine()); err != nil {
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

func managedLocalAssetRecordFailureDetail(err error) string {
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

func managedLocalImageReadyDetail() string {
	return "managed local image active; backend load verified"
}

func managedLocalImagePendingValidationDetail(reason string) string {
	base := "managed local image installed; backend validation pending"
	trimmed := strings.TrimSpace(reason)
	if trimmed == "" {
		return base
	}
	return base + ": " + trimmed
}

func managedLocalImageExecutionFailureDetail(detail string) string {
	trimmed := strings.TrimSpace(detail)
	if trimmed == "" {
		return "managed local image backend validation failed"
	}
	return "managed local image backend validation failed: " + trimmed
}

func isManagedSupervisedLlamaModel(model *runtimev1.LocalAssetRecord, mode runtimev1.LocalEngineRuntimeMode) bool {
	if model == nil {
		return false
	}
	if !strings.EqualFold(
		managedRuntimeEngineForModel(model),
		"llama",
	) {
		return false
	}
	if strings.ToLower(filepath.Ext(strings.TrimSpace(model.GetEntry()))) != ".gguf" {
		return false
	}
	if shouldHealManagedSupervisedRuntimeMode(model, mode) {
		return true
	}
	return normalizeRuntimeMode(mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED
}

func isManagedSupervisedImageModel(model *runtimev1.LocalAssetRecord, mode runtimev1.LocalEngineRuntimeMode) bool {
	if model == nil {
		return false
	}
	if !isCanonicalSupervisedImageAsset(
		model.GetEngine(),
		model.GetCapabilities(),
		model.GetKind(),
	) {
		return false
	}
	entry := strings.TrimSpace(model.GetEntry())
	ext := strings.ToLower(filepath.Ext(entry))
	if ext != ".gguf" && ext != ".safetensors" && !strings.EqualFold(filepath.Base(entry), "model_index.json") {
		return false
	}
	if shouldHealManagedSupervisedRuntimeMode(model, mode) {
		return true
	}
	return normalizeRuntimeMode(mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED
}

func shouldHealManagedSupervisedRuntimeMode(model *runtimev1.LocalAssetRecord, mode runtimev1.LocalEngineRuntimeMode) bool {
	if model == nil {
		return false
	}
	if strings.ToLower(filepath.Ext(strings.TrimSpace(model.GetEntry()))) != ".gguf" {
		return false
	}
	isManagedLlama := strings.EqualFold(managedRuntimeEngineForModel(model), "llama")
	isManagedImage := isCanonicalSupervisedImageAsset(model.GetEngine(), model.GetCapabilities(), model.GetKind())
	if !isManagedLlama && !isManagedImage {
		return false
	}
	expectedEndpoint := storedEndpointForAssetRuntimeMode(
		model.GetEngine(),
		model.GetCapabilities(),
		model.GetKind(),
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		"",
		"",
	)
	if normalizeRuntimeMode(mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		return strings.TrimSpace(expectedEndpoint) != "" && strings.TrimSpace(model.GetEndpoint()) != strings.TrimSpace(expectedEndpoint)
	}
	repo := strings.ToLower(strings.TrimSpace(model.GetSource().GetRepo()))
	if strings.HasPrefix(repo, "file://") && strings.HasSuffix(repo, "/asset.manifest.json") {
		return true
	}
	if strings.HasPrefix(repo, "local-import/") {
		return true
	}
	logicalModelID := strings.Trim(strings.TrimSpace(model.GetLogicalModelId()), "/")
	return strings.HasPrefix(strings.ToLower(logicalModelID), "nimi/")
}

func managedSupervisedRuntimeBindingHealDetail(model *runtimev1.LocalAssetRecord) string {
	if isCanonicalSupervisedImageAsset(model.GetEngine(), model.GetCapabilities(), model.GetKind()) {
		return "managed image runtime binding healed to supervised managed endpoint"
	}
	return "managed llama runtime binding healed to supervised managed endpoint"
}

func (s *Service) healManagedSupervisedRuntimeMode(localModelID string) (*runtimev1.LocalAssetRecord, bool, error) {
	id := strings.TrimSpace(localModelID)
	if id == "" {
		return nil, false, nil
	}
	current := s.modelByID(id)
	if current == nil {
		return nil, false, nil
	}
	if !shouldHealManagedSupervisedRuntimeMode(current, s.modelRuntimeMode(id)) {
		return current, false, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record := s.assets[id]
	if record == nil {
		return nil, false, nil
	}
	if !shouldHealManagedSupervisedRuntimeMode(record, s.assetRuntimeModes[id]) {
		return cloneLocalAsset(record), false, nil
	}
	s.setModelRuntimeModeLocked(id, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED)
	record.Endpoint = storedEndpointForAssetRuntimeMode(
		record.GetEngine(),
		record.GetCapabilities(),
		record.GetKind(),
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		"",
		s.managedEndpointForAssetLocked(record.GetEngine(), record.GetCapabilities(), record.GetKind()),
	)
	cloned := cloneLocalAsset(record)
	s.assets[id] = cloned
	s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id:           "audit_" + ulid.Make().String(),
		EventType:    "runtime_model_runtime_binding_healed",
		OccurredAt:   nowISO(),
		Source:       "local",
		ModelId:      cloned.GetAssetId(),
		LocalModelId: cloned.GetLocalAssetId(),
		Detail:       managedSupervisedRuntimeBindingHealDetail(cloned),
	})
	s.persistStateLocked()
	return cloneLocalAsset(cloned), true, nil
}

func isLegacyManagedLocalImportRecord(model *runtimev1.LocalAssetRecord, mode runtimev1.LocalEngineRuntimeMode) bool {
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

func validateManagedLocalAssetRecord(model *runtimev1.LocalAssetRecord, mode runtimev1.LocalEngineRuntimeMode) error {
	if model == nil {
		return fmt.Errorf("managed local model is unavailable")
	}
	if !isLegacyManagedLocalImportRecord(model, mode) {
		return nil
	}
	return fmt.Errorf("legacy local-import record is unsupported; re-import the managed asset manifest or clear stale runtime state")
}

func (s *Service) HasManagedSupervisedLlamaModels() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for localModelID, model := range s.assets {
		if model == nil || model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
			continue
		}
		if isManagedSupervisedLlamaModel(model, s.assetRuntimeModes[localModelID]) {
			return true
		}
	}
	return false
}

func (s *Service) HasManagedSupervisedImageModels() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for localModelID, model := range s.assets {
		if model == nil || model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
			continue
		}
		if isManagedSupervisedImageModel(model, s.assetRuntimeModes[localModelID]) {
			return true
		}
	}
	return false
}

func (s *Service) ensureManagedLocalModelBundleReady(ctx context.Context, model *runtimev1.LocalAssetRecord) (string, bool, error) {
	if model == nil {
		return "", false, fmt.Errorf("managed local model is unavailable")
	}
	localModelID := strings.TrimSpace(model.GetLocalAssetId())
	if localModelID == "" {
		return "", false, fmt.Errorf("managed local model is unavailable")
	}
	if healedModel, _, err := s.healManagedSupervisedRuntimeMode(localModelID); err != nil {
		return "", false, err
	} else if healedModel != nil {
		model = healedModel
	}
	if err := validateManagedLocalAssetRecord(model, s.modelRuntimeMode(localModelID)); err != nil {
		return "", false, err
	}
	if strings.ToLower(filepath.Ext(strings.TrimSpace(model.GetEntry()))) != ".gguf" {
		return "", false, nil
	}
	if normalizeRuntimeMode(s.modelRuntimeMode(model.GetLocalAssetId())) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
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

	// Hard-cut: no desktop-repair fallback. Fail-close if entry is missing.
	{
		entryPath, resolveErr := resolveManagedModelEntryAbsolutePath(modelsRoot, model)
		if resolveErr != nil {
			return "", false, fmt.Errorf("managed local model entry missing: %w", err)
		}
		if validateErr := s.validateManagedModelEntryForModel(entryPath, model); validateErr != nil {
			return "", true, fmt.Errorf("validate repaired managed local model entry: %w", validateErr)
		}
		if syncErr := s.SyncManagedLlamaAssets(ctx); syncErr != nil {
			return "", true, fmt.Errorf("sync managed llama assets: %w", syncErr)
		}
		return entryPath, true, nil
	}
}

func (s *Service) rewriteManagedLocalAssetSourceRepo(localModelID string, manifestPath string) {
	id := strings.TrimSpace(localModelID)
	manifest := strings.TrimSpace(manifestPath)
	if id == "" || manifest == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record := s.assets[id]
	if record == nil {
		return
	}
	cloned := cloneLocalAsset(record)
	if cloned.Source == nil {
		cloned.Source = &runtimev1.LocalAssetSource{}
	}
	cloned.Source.Repo = "file://" + filepath.ToSlash(manifest)
	if strings.TrimSpace(cloned.Source.GetRevision()) == "" {
		cloned.Source.Revision = "local"
	}
	cloned.UpdatedAt = nowISO()
	s.assets[id] = cloned
	s.persistStateLocked()
}
