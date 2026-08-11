package localservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const localAssetManifestFileName = "asset.manifest.json"

type bundleDirectoryScan struct {
	files           []string
	entryCandidates []string
}

type bundleManifestIdentity struct {
	assetID        string
	logicalModelID string
	kind           runtimev1.LocalAssetKind
	engine         string
	entry          string
}

func validateImportSourceDirectory(rawPath string) (string, error) {
	sourcePath := filepath.Clean(strings.TrimSpace(rawPath))
	if sourcePath == "." || sourcePath == "" {
		return "", fmt.Errorf("directory path required")
	}
	metadata, err := os.Lstat(sourcePath)
	if err != nil {
		return "", fmt.Errorf("bundle directory does not exist: %w", err)
	}
	if metadata.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("symbolic links are not supported for bundle import")
	}
	if !metadata.IsDir() {
		return "", fmt.Errorf("path is not a directory")
	}
	canonicalPath, err := filepath.EvalSymlinks(sourcePath)
	if err != nil {
		return "", fmt.Errorf("canonicalize bundle directory: %w", err)
	}
	info, err := os.Stat(canonicalPath)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("path is not a directory")
	}
	return canonicalPath, nil
}

func scanBundleDirectory(root string) (bundleDirectoryScan, error) {
	scan := bundleDirectoryScan{
		files:           make([]string, 0),
		entryCandidates: make([]string, 0),
	}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return infoErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symbolic links are not supported for bundle import: %s", path)
		}
		if entry.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return relErr
		}
		normalized := filepath.ToSlash(rel)
		if strings.EqualFold(filepath.Base(normalized), localAssetManifestFileName) {
			return nil
		}
		scan.files = append(scan.files, normalized)
		if isKnownModelFile(normalized) && !strings.Contains(strings.ToLower(normalized), "mmproj") {
			scan.entryCandidates = append(scan.entryCandidates, normalized)
		}
		return nil
	})
	if err != nil {
		return bundleDirectoryScan{}, err
	}
	sort.Strings(scan.files)
	sort.Strings(scan.entryCandidates)
	return scan, nil
}

func requireSingleBundleEntry(scan bundleDirectoryScan) (string, error) {
	switch len(scan.entryCandidates) {
	case 0:
		return "", fmt.Errorf("no runnable model entry found in bundle directory; add asset.manifest.json to import this bundle explicitly")
	case 1:
		return scan.entryCandidates[0], nil
	default:
		return "", fmt.Errorf("multiple runnable model files found (%s); add asset.manifest.json to choose the bundle entry explicitly", strings.Join(scan.entryCandidates, ", "))
	}
}

func bundleScanContainsAll(scan bundleDirectoryScan, required []string) (bool, []string) {
	available := make(map[string]struct{}, len(scan.files))
	for _, file := range scan.files {
		available[filepath.ToSlash(strings.TrimSpace(file))] = struct{}{}
	}
	missing := make([]string, 0)
	for _, file := range required {
		normalized := filepath.ToSlash(strings.TrimSpace(file))
		if normalized == "" {
			continue
		}
		if _, ok := available[normalized]; !ok {
			missing = append(missing, normalized)
		}
	}
	return len(missing) == 0, missing
}

func bundleScanForDeclaredFiles(required []string) bundleDirectoryScan {
	files := make([]string, 0, len(required))
	entryCandidates := make([]string, 0, len(required))
	for _, file := range required {
		normalized := filepath.ToSlash(strings.TrimSpace(file))
		if normalized == "" {
			continue
		}
		files = append(files, normalized)
		if isKnownModelFile(normalized) && !strings.Contains(strings.ToLower(normalized), "mmproj") {
			entryCandidates = append(entryCandidates, normalized)
		}
	}
	sort.Strings(files)
	sort.Strings(entryCandidates)
	return bundleDirectoryScan{files: files, entryCandidates: entryCandidates}
}

func verifiedBundleRepoName(descriptor *runtimev1.LocalVerifiedAssetDescriptor) string {
	if descriptor == nil {
		return ""
	}
	repo := strings.Trim(strings.TrimSpace(descriptor.GetRepo()), "/\\")
	if repo == "" {
		return ""
	}
	return filepath.Base(filepath.FromSlash(repo))
}

func verifiedBundleSupportsCapabilities(descriptor *runtimev1.LocalVerifiedAssetDescriptor, capabilities []string) bool {
	if descriptor == nil {
		return false
	}
	for _, capability := range normalizeAssetCapabilities(capabilities) {
		if !localAssetHasCapability(descriptor.GetCapabilities(), capability) {
			return false
		}
	}
	return true
}

func verifiedSpeechBundleKindLabel(kind runtimev1.LocalAssetKind) string {
	switch kind {
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS:
		return "TTS"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT:
		return "ASR"
	default:
		return "speech"
	}
}

func (s *Service) resolveVerifiedSpeechBundleScaffold(
	kind runtimev1.LocalAssetKind,
	modelName string,
	capabilities []string,
	requestedEngine string,
	scan bundleDirectoryScan,
) (*runtimev1.LocalVerifiedAssetDescriptor, error) {
	kindLabel := verifiedSpeechBundleKindLabel(kind)
	s.mu.RLock()
	eligible := make([]*runtimev1.LocalVerifiedAssetDescriptor, 0)
	for _, descriptor := range s.verified {
		if descriptor == nil ||
			descriptor.GetKind() != kind ||
			!strings.EqualFold(strings.TrimSpace(descriptor.GetInstallKind()), "verified-hf-multi-file") ||
			!verifiedBundleSupportsCapabilities(descriptor, capabilities) {
			continue
		}
		if engine := strings.TrimSpace(requestedEngine); engine != "" &&
			!strings.EqualFold(engine, strings.TrimSpace(descriptor.GetEngine())) {
			continue
		}
		eligible = append(eligible, cloneVerifiedAsset(descriptor))
	}
	s.mu.RUnlock()

	var selected *runtimev1.LocalVerifiedAssetDescriptor
	for _, descriptor := range eligible {
		if strings.EqualFold(strings.TrimSpace(modelName), verifiedBundleRepoName(descriptor)) {
			if selected != nil {
				return nil, fmt.Errorf("multiple verified %s bundle layouts match model name %q", kindLabel, modelName)
			}
			selected = descriptor
		}
	}
	if selected == nil && kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS {
		if len(eligible) != 1 {
			return nil, fmt.Errorf("%s bundle does not resolve one verified multi-file layout", kindLabel)
		}
		selected = eligible[0]
	}
	if selected == nil {
		return nil, fmt.Errorf("%s bundle model name %q does not match a verified multi-file layout", kindLabel, modelName)
	}
	if ok, missing := bundleScanContainsAll(scan, selected.GetFiles()); !ok {
		return nil, fmt.Errorf("%s bundle is incomplete; missing required files: %s", kindLabel, strings.Join(missing, ", "))
	}
	entry := filepath.ToSlash(strings.TrimSpace(selected.GetEntry()))
	if entry == "" || !bundleStringSliceContains(scan.files, entry) {
		return nil, fmt.Errorf("%s bundle entry is missing: %s", kindLabel, entry)
	}
	return selected, nil
}

func (s *Service) speechAssetMatchesVerifiedBundle(asset *runtimev1.LocalAssetRecord) bool {
	if s == nil || asset == nil ||
		(asset.GetKind() != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS && asset.GetKind() != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT) {
		return false
	}
	assetID := strings.Trim(strings.TrimSpace(asset.GetAssetId()), "/\\")
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, descriptor := range s.verified {
		if descriptor == nil ||
			descriptor.GetKind() != asset.GetKind() ||
			!strings.EqualFold(strings.TrimSpace(descriptor.GetInstallKind()), "verified-hf-multi-file") ||
			!strings.EqualFold(strings.TrimSpace(descriptor.GetEngine()), strings.TrimSpace(asset.GetEngine())) ||
			!verifiedBundleSupportsCapabilities(descriptor, asset.GetCapabilities()) ||
			!strings.EqualFold(filepath.ToSlash(strings.TrimSpace(descriptor.GetEntry())), filepath.ToSlash(strings.TrimSpace(asset.GetEntry()))) ||
			!stringSlicesEqual(descriptor.GetFiles(), asset.GetFiles()) ||
			!stringSlicesEqual(descriptor.GetArtifactRoles(), asset.GetArtifactRoles()) {
			continue
		}
		descriptorAssetID := strings.Trim(strings.TrimSpace(descriptor.GetAssetId()), "/\\")
		importAssetID := "local-import/" + verifiedBundleRepoName(descriptor)
		if strings.EqualFold(assetID, descriptorAssetID) || strings.EqualFold(assetID, importAssetID) {
			return true
		}
	}
	return false
}

func validatePlainSynthesisTTSBundleConfig(sourceDir string) error {
	raw, err := os.ReadFile(filepath.Join(sourceDir, "config.json"))
	if err != nil {
		return fmt.Errorf("read TTS bundle config: %w", err)
	}
	var config struct {
		ModelType    string `json:"model_type"`
		TTSModelType string `json:"tts_model_type"`
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		return fmt.Errorf("parse TTS bundle config: %w", err)
	}
	if !strings.EqualFold(strings.TrimSpace(config.ModelType), "qwen3_tts") {
		return fmt.Errorf("TTS bundle model_type %q is not admitted by the qwen3_tts Driver", config.ModelType)
	}
	if !strings.EqualFold(strings.TrimSpace(config.TTSModelType), "custom_voice") {
		return fmt.Errorf("plain synthesis requires tts_model_type custom_voice, got %q", config.TTSModelType)
	}
	return nil
}

func parseBundleManifestIdentity(path string) (bundleManifestIdentity, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return bundleManifestIdentity{}, fmt.Errorf("read asset manifest: %w", err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return bundleManifestIdentity{}, fmt.Errorf("parse asset manifest: %w", err)
	}
	assetID, ok := manifestString(manifest, "asset_id", "assetId")
	if !ok || strings.TrimSpace(assetID) == "" {
		return bundleManifestIdentity{}, fmt.Errorf("asset manifest asset_id is required")
	}
	kind, ok := manifestAssetKind(manifest, "kind")
	if !ok || kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
		return bundleManifestIdentity{}, fmt.Errorf("asset manifest kind is required")
	}
	entry, ok := manifestString(manifest, "entry")
	if !ok || strings.TrimSpace(entry) == "" {
		return bundleManifestIdentity{}, fmt.Errorf("asset manifest entry is required")
	}
	logicalModelID := manifestStringDefault(manifest, "logical_model_id", "logicalModelId")
	if logicalModelID == "" && isRunnableKind(kind) {
		logicalModelID = defaultLogicalModelID(assetID)
	}
	if isRunnableKind(kind) {
		if err := validateManagedLogicalModelID(logicalModelID); err != nil {
			return bundleManifestIdentity{}, err
		}
	}
	return bundleManifestIdentity{
		assetID:        assetID,
		logicalModelID: logicalModelID,
		kind:           kind,
		engine:         manifestStringDefault(manifest, "engine"),
		entry:          filepath.ToSlash(entry),
	}, nil
}

func defaultLogicalModelID(assetID string) string {
	return filepath.ToSlash(filepath.Join("nimi", slugifyLocalModelID(assetID)))
}

func bundleManifestRepo(manifestPath string) string {
	return "file://" + filepath.ToSlash(manifestPath)
}

func kindFromBundleCapabilities(capabilities []string) runtimev1.LocalAssetKind {
	normalized := normalizeAssetCapabilities(capabilities)
	if len(normalized) == 0 {
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT
	}
	return inferAssetKindFromCapabilities(normalized)
}

func normalizeExistingBundleManifest(sourceManifestPath string, managedManifestPath string, sourceDir string, scan bundleDirectoryScan, identity bundleManifestIdentity) (map[string]any, error) {
	raw, err := os.ReadFile(sourceManifestPath)
	if err != nil {
		return nil, fmt.Errorf("read asset manifest: %w", err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return nil, fmt.Errorf("parse asset manifest: %w", err)
	}
	if !bundleStringSliceContains(scan.files, identity.entry) {
		return nil, fmt.Errorf("bundle entry file is missing from disk: %s", identity.entry)
	}
	manifest["files"] = append([]string(nil), scan.files...)
	hashes, err := bundleFileHashes(sourceDir, scan)
	if err != nil {
		return nil, err
	}
	manifest["hashes"] = hashes
	manifest["source"] = map[string]any{
		"repo":     bundleManifestRepo(managedManifestPath),
		"revision": "local",
	}
	return manifest, nil
}

func (s *Service) scaffoldBundleManifest(manifestPath string, modelName string, capabilities []string, engine string, sourceDir string, scan bundleDirectoryScan) (map[string]any, bundleDirectoryScan, error) {
	normalizedCapabilities := normalizeAssetCapabilities(capabilities)
	if len(normalizedCapabilities) == 0 {
		normalizedCapabilities = []string{"chat"}
	}
	kind := kindFromBundleCapabilities(normalizedCapabilities)
	kindToken, err := localAssetKindToken(kind)
	if err != nil {
		return nil, bundleDirectoryScan{}, err
	}
	entry := ""
	normalizedEngine := strings.TrimSpace(engine)
	artifactRoles := []string(nil)
	admittedScan := scan
	requestedImportAssetID := "local-import/" + strings.TrimSpace(modelName)
	assetID := requestedImportAssetID
	if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS || kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT {
		descriptor, resolveErr := s.resolveVerifiedSpeechBundleScaffold(kind, modelName, normalizedCapabilities, normalizedEngine, scan)
		if resolveErr != nil {
			return nil, bundleDirectoryScan{}, resolveErr
		}
		if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS {
			if configErr := validatePlainSynthesisTTSBundleConfig(sourceDir); configErr != nil {
				return nil, bundleDirectoryScan{}, configErr
			}
		}
		entry = filepath.ToSlash(strings.TrimSpace(descriptor.GetEntry()))
		artifactRoles = normalizeStringSlice(descriptor.GetArtifactRoles())
		admittedScan = bundleScanForDeclaredFiles(descriptor.GetFiles())
		assetID = "local-import/" + verifiedBundleRepoName(descriptor)
		if normalizedEngine == "" {
			normalizedEngine = strings.TrimSpace(descriptor.GetEngine())
		}
	} else {
		entry, err = requireSingleBundleEntry(scan)
		if err != nil {
			return nil, bundleDirectoryScan{}, err
		}
	}
	if normalizedEngine == "" {
		normalizedEngine = defaultEngineForAssetKind(kind)
	}
	hashes, err := bundleFileHashes(sourceDir, admittedScan)
	if err != nil {
		return nil, bundleDirectoryScan{}, err
	}
	manifest := map[string]any{
		"schema_version":   "1.0.0",
		"asset_id":         assetID,
		"kind":             kindToken,
		"logical_model_id": defaultLogicalModelID(requestedImportAssetID),
		"capabilities":     normalizedCapabilities,
		"engine":           normalizedEngine,
		"entry":            entry,
		"files":            append([]string(nil), admittedScan.files...),
		"license":          "unknown",
		"source": map[string]any{
			"repo":     bundleManifestRepo(manifestPath),
			"revision": "local",
		},
		"integrity_mode": "local_unverified",
		"hashes":         hashes,
	}
	if len(artifactRoles) > 0 {
		manifest["artifact_roles"] = artifactRoles
	}
	return manifest, admittedScan, nil
}

func bundleFileHashes(sourceDir string, scan bundleDirectoryScan) (map[string]string, error) {
	hashes := make(map[string]string, len(scan.files))
	for _, file := range scan.files {
		normalized := filepath.ToSlash(strings.TrimSpace(file))
		if normalized == "" {
			continue
		}
		hash, err := computeImportFileSHA256(filepath.Join(sourceDir, filepath.FromSlash(normalized)))
		if err != nil {
			return nil, fmt.Errorf("hash bundle file %s: %w", normalized, err)
		}
		hashes[normalized] = "sha256:" + hash
	}
	return hashes, nil
}

func copyScannedBundleFiles(sourceDir string, destDir string, scan bundleDirectoryScan) error {
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return err
	}
	for _, file := range scan.files {
		normalized := filepath.ToSlash(strings.TrimSpace(file))
		if normalized == "" {
			continue
		}
		sourcePath := filepath.Join(sourceDir, filepath.FromSlash(normalized))
		destPath := filepath.Join(destDir, filepath.FromSlash(normalized))
		info, err := os.Stat(sourcePath)
		if err != nil {
			return fmt.Errorf("stat bundle file %s: %w", normalized, err)
		}
		if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
			return fmt.Errorf("create bundle directory for %s: %w", normalized, err)
		}
		if err := copyFile(sourcePath, destPath, info.Mode().Perm()); err != nil {
			return fmt.Errorf("copy bundle file %s: %w", normalized, err)
		}
	}
	return nil
}

func applyOrderedBundleEntriesToManifest(manifest map[string]any, requested []string) error {
	if manifest == nil {
		return fmt.Errorf("bundle manifest is required")
	}
	existing, err := orderedBundleEntryPathsFromManifest(manifest)
	if err != nil {
		return err
	}
	declared := make([]string, 0, len(requested))
	seen := make(map[string]struct{}, len(requested))
	for _, raw := range requested {
		relativePath, err := normalizeLocalBundleRelativePath(raw)
		if err != nil {
			return err
		}
		if _, exists := seen[relativePath]; exists {
			return fmt.Errorf("bundle entry path %q is duplicated", relativePath)
		}
		seen[relativePath] = struct{}{}
		declared = append(declared, relativePath)
	}
	if len(declared) > 0 && len(existing) > 0 && !stringSlicesEqual(declared, existing) {
		return fmt.Errorf("request bundle entry order conflicts with the manifest")
	}
	if len(declared) == 0 {
		declared = existing
	}
	if len(declared) == 0 {
		delete(manifest, "bundle_entries")
		return nil
	}
	if len(declared) < 2 {
		return fmt.Errorf("sharded bundle requires at least two ordered entries")
	}
	hashes, err := bundleManifestHashes(manifest)
	if err != nil {
		return err
	}
	files := valueAsStringSlice(manifest["files"])
	fileSet := make(map[string]struct{}, len(files))
	for _, file := range files {
		fileSet[filepath.ToSlash(strings.TrimSpace(file))] = struct{}{}
	}
	mainEntry := filepath.ToSlash(strings.TrimSpace(manifestStringDefault(manifest, "entry")))
	containsMain := false
	entries := make([]any, 0, len(declared))
	for index, relativePath := range declared {
		if _, exists := fileSet[relativePath]; !exists {
			return fmt.Errorf("bundle entry %q is not declared in files", relativePath)
		}
		digest := normalizeExactSHA256Hex(hashes[relativePath])
		if digest == "" {
			return fmt.Errorf("bundle entry %q has no canonical sha256", relativePath)
		}
		if relativePath == mainEntry {
			containsMain = true
		}
		entries = append(entries, map[string]any{
			"ordinal":       index + 1,
			"relative_path": relativePath,
			"sha256":        digest,
		})
	}
	if !containsMain {
		return fmt.Errorf("ordered bundle entries do not include the manifest entry")
	}
	manifest["bundle_entries"] = entries
	return nil
}

func bundleManifestHashes(manifest map[string]any) (map[string]string, error) {
	if typed, ok := manifest["hashes"].(map[string]string); ok {
		return cloneStringMap(typed), nil
	}
	return manifestStringMap(manifest, "hashes")
}

func orderedBundleEntryPathsFromManifest(manifest map[string]any) ([]string, error) {
	raw, exists := manifest["bundle_entries"]
	if !exists {
		return nil, nil
	}
	items, ok := raw.([]any)
	if !ok || len(items) == 0 {
		return nil, fmt.Errorf("bundle_entries must be a non-empty array")
	}
	result := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for index, item := range items {
		entry, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("bundle entry %d must be an object", index)
		}
		for key := range entry {
			switch key {
			case "ordinal", "relative_path", "sha256":
			default:
				return nil, fmt.Errorf("bundle entry %d contains unknown field %q", index, key)
			}
		}
		ordinal, ok := entry["ordinal"].(float64)
		if !ok {
			if integer, integerOK := entry["ordinal"].(int); integerOK {
				ordinal = float64(integer)
				ok = true
			}
		}
		if !ok || ordinal != float64(index+1) {
			return nil, fmt.Errorf("bundle entry %d has a non-contiguous ordinal", index)
		}
		relativePath, ok := entry["relative_path"].(string)
		if !ok {
			return nil, fmt.Errorf("bundle entry %d relative_path is required", index)
		}
		relativePath, err := normalizeLocalBundleRelativePath(relativePath)
		if err != nil {
			return nil, err
		}
		if _, exists := seen[relativePath]; exists {
			return nil, fmt.Errorf("bundle entry path %q is duplicated", relativePath)
		}
		seen[relativePath] = struct{}{}
		digest, ok := entry["sha256"].(string)
		if !ok || normalizeExactSHA256Hex(digest) == "" || normalizeExactSHA256Hex(digest) != digest {
			return nil, fmt.Errorf("bundle entry %d sha256 must be lowercase hexadecimal without a prefix", index)
		}
		result = append(result, relativePath)
	}
	return result, nil
}

func localBundleEntriesFromManifest(manifest map[string]any, hashes map[string]string) ([]*runtimev1.LocalBundleEntryDigest, error) {
	paths, err := orderedBundleEntryPathsFromManifest(manifest)
	if err != nil || len(paths) == 0 {
		return nil, err
	}
	items := manifest["bundle_entries"].([]any)
	result := make([]*runtimev1.LocalBundleEntryDigest, 0, len(paths))
	for index, relativePath := range paths {
		entry := items[index].(map[string]any)
		digest := normalizeExactSHA256Hex(entry["sha256"].(string))
		if digest == "" || normalizeExactSHA256Hex(hashes[relativePath]) != digest {
			return nil, fmt.Errorf("bundle entry %q digest does not match hashes", relativePath)
		}
		result = append(result, &runtimev1.LocalBundleEntryDigest{
			Ordinal:      uint32(index + 1),
			RelativePath: relativePath,
			Sha256:       digest,
		})
	}
	if _, err := localCapabilityBundleEntryDescriptors(&runtimev1.LocalAssetRecord{
		Entry:         manifestStringDefault(manifest, "entry"),
		Hashes:        cloneStringMap(hashes),
		BundleEntries: cloneLocalBundleEntryDigests(result),
	}); err != nil {
		return nil, err
	}
	return result, nil
}

func writeBundleManifest(path string, manifest map[string]any) error {
	raw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("serialize asset manifest: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create asset manifest directory: %w", err)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		return fmt.Errorf("write asset manifest: %w", err)
	}
	return nil
}

func replaceBundleManifestWithRollback(path string, manifest map[string]any, apply func() error) error {
	previous, readErr := os.ReadFile(path)
	hadPrevious := readErr == nil
	if readErr != nil && !os.IsNotExist(readErr) {
		return fmt.Errorf("read previous asset manifest: %w", readErr)
	}
	if err := writeBundleManifest(path, manifest); err != nil {
		return err
	}
	if err := apply(); err != nil {
		if hadPrevious {
			_ = os.WriteFile(path, previous, 0o644)
		} else {
			_ = os.Remove(path)
		}
		return err
	}
	return nil
}

func sameCanonicalDirectory(left string, right string) bool {
	leftCanonical, leftErr := filepath.EvalSymlinks(filepath.Clean(left))
	rightCanonical, rightErr := filepath.EvalSymlinks(filepath.Clean(right))
	return leftErr == nil && rightErr == nil && leftCanonical == rightCanonical
}

func bundleStringSliceContains(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func (s *Service) ImportLocalAssetBundle(_ context.Context, req *runtimev1.ImportLocalAssetBundleRequest) (*runtimev1.ImportLocalAssetBundleResponse, error) {
	modelName := strings.TrimSpace(req.GetModelName())
	if modelName == "" {
		modelName = strings.TrimSuffix(filepath.Base(strings.TrimSpace(req.GetDirectoryPath())), filepath.Ext(strings.TrimSpace(req.GetDirectoryPath())))
	}
	if strings.TrimSpace(modelName) == "" {
		modelName = "bundle-import"
	}
	modelID := "bundle:" + modelName
	transfer := s.newLocalTransfer(localTransferKindImport, localTransferMutation{
		ModelID:      modelID,
		LocalModelID: "pending:" + slugifyLocalModelID(modelID),
		Phase:        "queued",
		State:        localTransferStateRunning,
		Message:      "queued bundle import",
		Retryable:    false,
	})
	reqCopy := &runtimev1.ImportLocalAssetBundleRequest{
		DirectoryPath:        strings.TrimSpace(req.GetDirectoryPath()),
		ModelName:            strings.TrimSpace(req.GetModelName()),
		Capabilities:         append([]string(nil), req.GetCapabilities()...),
		Engine:               strings.TrimSpace(req.GetEngine()),
		OrderedBundleEntries: append([]string(nil), req.GetOrderedBundleEntries()...),
	}
	go s.runImportLocalAssetBundle(s.jobLifetimeCtx, transfer.GetInstallSessionId(), reqCopy)
	return &runtimev1.ImportLocalAssetBundleResponse{Transfer: transfer}, nil
}

func (s *Service) runImportLocalAssetBundle(ctx context.Context, transferID string, req *runtimev1.ImportLocalAssetBundleRequest) {
	asset, err := s.importLocalAssetBundleSync(ctx, transferID, req)
	if err != nil {
		if errors.Is(err, errLocalTransferCancelled) || errors.Is(err, context.Canceled) {
			s.cancelTransfer(transferID, "transfer cancelled")
			return
		}
		s.failTransfer(transferID, err.Error(), false)
		return
	}
	s.completeTransfer(transferID, "register", "bundle import completed", func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.AssetId = asset.GetAssetId()
		summary.LocalAssetId = asset.GetLocalAssetId()
	})
}

func (s *Service) importLocalAssetBundleSync(ctx context.Context, transferID string, req *runtimev1.ImportLocalAssetBundleRequest) (*runtimev1.LocalAssetRecord, error) {
	control := s.transferControl(transferID)
	// checkActive honors CancelLocalTransfer at phase boundaries so a bundle
	// import never runs to completion after being cancelled.
	checkActive := func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if control != nil {
			if err := control.wait(ctx); err != nil {
				return err
			}
		}
		return nil
	}
	if err := checkActive(); err != nil {
		return nil, err
	}
	sourceDir, err := validateImportSourceDirectory(req.GetDirectoryPath())
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "bundle source directory is invalid"},
		)
	}
	scan, err := scanBundleDirectory(sourceDir)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "bundle directory could not be scanned"},
		)
	}
	modelsRoot := resolveLocalModelsPath(s.localModelsPath)
	sourceManifestPath := filepath.Join(sourceDir, localAssetManifestFileName)
	sourceHasManifest := fileExists(sourceManifestPath)
	var destDir string
	var manifestPath string
	var manifest map[string]any
	var logicalModelID string
	copyScan := scan
	if sourceHasManifest {
		identity, err := parseBundleManifestIdentity(sourceManifestPath)
		if err != nil {
			return nil, grpcerr.WrapWithReasonCode(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
				err,
				grpcerr.ReasonOptions{Message: "bundle manifest identity is invalid"},
			)
		}
		if isRunnableKind(identity.kind) {
			logicalModelID = identity.logicalModelID
			destDir, err = resolveRuntimeManagedImportedBundleDir(modelsRoot, identity.assetID, identity.kind)
			if err != nil {
				return nil, grpcerr.WrapWithReasonCode(
					codes.InvalidArgument,
					runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
					err,
					grpcerr.ReasonOptions{Message: "bundle storage identity is invalid"},
				)
			}
		} else {
			destDir, err = resolveRuntimeManagedImportedBundleDir(modelsRoot, identity.assetID, identity.kind)
			if err != nil {
				return nil, grpcerr.WrapWithReasonCode(
					codes.InvalidArgument,
					runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
					err,
					grpcerr.ReasonOptions{Message: "bundle storage identity is invalid"},
				)
			}
		}
		manifestPath = filepath.Join(destDir, localAssetManifestFileName)
		manifest, err = normalizeExistingBundleManifest(sourceManifestPath, manifestPath, sourceDir, scan, identity)
		if err != nil {
			return nil, grpcerr.WrapWithReasonCode(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
				err,
				grpcerr.ReasonOptions{Message: "bundle manifest is invalid"},
			)
		}
	} else {
		modelName := strings.TrimSpace(req.GetModelName())
		if modelName == "" {
			modelName = strings.TrimSpace(filepath.Base(sourceDir))
		}
		if modelName == "" {
			return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{Message: "modelName is required for scaffolded bundle import"})
		}
		assetID := "local-import/" + modelName
		logicalModelID = defaultLogicalModelID(assetID)
		destDir, err = resolveRuntimeManagedModelBundleDir(modelsRoot, logicalModelID)
		if err != nil {
			return nil, grpcerr.WrapWithReasonCode(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
				err,
				grpcerr.ReasonOptions{Message: "bundle storage identity is invalid"},
			)
		}
		manifestPath = filepath.Join(destDir, localAssetManifestFileName)
		manifest, copyScan, err = s.scaffoldBundleManifest(manifestPath, modelName, req.GetCapabilities(), req.GetEngine(), sourceDir, scan)
		if err != nil {
			return nil, grpcerr.WrapWithReasonCode(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
				err,
				grpcerr.ReasonOptions{Message: "bundle manifest could not be prepared"},
			)
		}
	}
	if err := applyOrderedBundleEntriesToManifest(manifest, req.GetOrderedBundleEntries()); err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "bundle content entry declaration is invalid"},
		)
	}

	s.updateTransferProgress(transferID, "copy", 0, 1, "staging bundle directory")
	if sameCanonicalDirectory(sourceDir, destDir) {
		var imported *runtimev1.ImportLocalAssetResponse
		err := replaceBundleManifestWithRollback(manifestPath, manifest, func() error {
			var importErr error
			imported, importErr = s.ImportLocalAsset(ctx, &runtimev1.ImportLocalAssetRequest{ManifestPath: manifestPath})
			return importErr
		})
		if err != nil {
			return nil, err
		}
		return imported.GetAsset(), nil
	}

	stageDir, err := prepareManagedModelBundleStageDir(destDir, "bundle-import")
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			err,
			grpcerr.ReasonOptions{Message: "bundle staging directory could not be prepared"},
		)
	}
	if err := checkActive(); err != nil {
		_ = os.RemoveAll(stageDir)
		return nil, err
	}
	if err := copyScannedBundleFiles(sourceDir, stageDir, copyScan); err != nil {
		_ = os.RemoveAll(stageDir)
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			err,
			grpcerr.ReasonOptions{Message: "bundle files could not be staged"},
		)
	}
	if err := checkActive(); err != nil {
		_ = os.RemoveAll(stageDir)
		return nil, err
	}
	if err := writeBundleManifest(filepath.Join(stageDir, localAssetManifestFileName), manifest); err != nil {
		_ = os.RemoveAll(stageDir)
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			err,
			grpcerr.ReasonOptions{Message: "bundle manifest could not be written"},
		)
	}
	s.updateTransferProgress(transferID, "copy", 1, 1, "bundle staged")
	activation, err := activateManagedModelBundle(destDir, stageDir)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			err,
			grpcerr.ReasonOptions{Message: "bundle could not be activated"},
		)
	}
	s.updateTransferProgress(transferID, "register", 1, 1, "registering bundle")
	imported, err := s.ImportLocalAsset(ctx, &runtimev1.ImportLocalAssetRequest{ManifestPath: manifestPath})
	if err != nil {
		if quarantinePath, rollbackErr := activation.Rollback(s, modelsRoot, logicalModelID, "bundle_import", err.Error(), "", ""); rollbackErr != nil {
			return nil, fmt.Errorf("%s; rollback=%v", err.Error(), rollbackErr)
		} else if strings.TrimSpace(quarantinePath) != "" {
			return nil, fmt.Errorf("%s; quarantine=%s", err.Error(), quarantinePath)
		}
		return nil, err
	}
	if commitErr := activation.Commit(); commitErr != nil {
		s.logger.Warn("cleanup managed bundle backup failed after bundle import", "error", commitErr)
	}
	return imported.GetAsset(), nil
}

func (s *Service) RescanLocalAssetBundle(_ context.Context, req *runtimev1.RescanLocalAssetBundleRequest) (*runtimev1.RescanLocalAssetBundleResponse, error) {
	localAssetID := strings.TrimSpace(req.GetLocalAssetId())
	if localAssetID == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{Message: "localAssetId required"})
	}
	transfer := s.newLocalTransfer(localTransferKindImport, localTransferMutation{
		ModelID:      "rescan:" + localAssetID,
		LocalModelID: localAssetID,
		Phase:        "queued",
		State:        localTransferStateRunning,
		Message:      "queued bundle rescan",
		Retryable:    false,
	})
	reqCopy := &runtimev1.RescanLocalAssetBundleRequest{LocalAssetId: localAssetID}
	go s.runRescanLocalAssetBundle(s.jobLifetimeCtx, transfer.GetInstallSessionId(), reqCopy)
	return &runtimev1.RescanLocalAssetBundleResponse{Transfer: transfer}, nil
}

func (s *Service) runRescanLocalAssetBundle(ctx context.Context, transferID string, req *runtimev1.RescanLocalAssetBundleRequest) {
	asset, err := s.rescanLocalAssetBundleSync(ctx, transferID, req)
	if err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return
	}
	s.completeTransfer(transferID, "register", "bundle rescan completed", func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.AssetId = asset.GetAssetId()
		summary.LocalAssetId = asset.GetLocalAssetId()
	})
}

func (s *Service) rescanLocalAssetBundleSync(ctx context.Context, transferID string, req *runtimev1.RescanLocalAssetBundleRequest) (*runtimev1.LocalAssetRecord, error) {
	localAssetID := strings.TrimSpace(req.GetLocalAssetId())
	s.mu.RLock()
	asset := cloneLocalAsset(s.assets[localAssetID])
	s.mu.RUnlock()
	if asset == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{Message: "local asset not found"})
	}
	modelsRoot := resolveLocalModelsPath(s.localModelsPath)
	bundleDir, err := resolveRuntimeManagedBundleDir(modelsRoot, asset)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "managed bundle path is invalid"},
		)
	}
	if info, err := os.Stat(bundleDir); err != nil || !info.IsDir() {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{Message: fmt.Sprintf("managed bundle directory missing: %s", bundleDir)})
	}
	manifestPath := filepath.Join(bundleDir, localAssetManifestFileName)
	scan, err := scanBundleDirectory(bundleDir)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "managed bundle directory could not be scanned"},
		)
	}
	identity := bundleManifestIdentity{
		assetID:        asset.GetAssetId(),
		logicalModelID: asset.GetLogicalModelId(),
		kind:           asset.GetKind(),
		engine:         asset.GetEngine(),
		entry:          asset.GetEntry(),
	}
	var manifest map[string]any
	if fileExists(manifestPath) {
		manifest, err = normalizeExistingBundleManifest(manifestPath, manifestPath, bundleDir, scan, identity)
	} else {
		manifest, _, err = s.scaffoldBundleManifest(manifestPath, asset.GetAssetId(), asset.GetCapabilities(), asset.GetEngine(), bundleDir, scan)
	}
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "managed bundle manifest could not be refreshed"},
		)
	}
	if err := applyOrderedBundleEntriesToManifest(manifest, nil); err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "managed bundle content entry declaration is invalid"},
		)
	}
	s.updateTransferProgress(transferID, "manifest", 1, 1, "refreshing bundle manifest")
	var imported *runtimev1.ImportLocalAssetResponse
	err = replaceBundleManifestWithRollback(manifestPath, manifest, func() error {
		var importErr error
		imported, importErr = s.importLocalAsset(ctx, &runtimev1.ImportLocalAssetRequest{ManifestPath: manifestPath}, localAssetExistingPolicyRebind, localAssetID)
		return importErr
	})
	if err != nil {
		return nil, err
	}
	return imported.GetAsset(), nil
}

func resolveRuntimeManagedBundleDir(modelsRoot string, asset *runtimev1.LocalAssetRecord) (string, error) {
	if asset == nil {
		return "", fmt.Errorf("local asset is required")
	}
	repo := strings.TrimSpace(asset.GetSource().GetRepo())
	if strings.HasPrefix(strings.ToLower(repo), "file://") {
		return resolveManagedManifestBundleDir(modelsRoot, repo)
	}
	if isRunnableKind(asset.GetKind()) {
		logicalModelID := strings.TrimSpace(asset.GetLogicalModelId())
		if logicalModelID == "" {
			logicalModelID = defaultLogicalModelID(asset.GetAssetId())
		}
		return resolveRuntimeManagedModelBundleDir(modelsRoot, logicalModelID)
	}
	return resolveRuntimeManagedImportedBundleDir(modelsRoot, asset.GetAssetId(), asset.GetKind())
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
