package localservice

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
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

func scaffoldBundleManifest(manifestPath string, modelName string, capabilities []string, engine string, endpoint string, sourceDir string, scan bundleDirectoryScan) (map[string]any, error) {
	entry, err := requireSingleBundleEntry(scan)
	if err != nil {
		return nil, err
	}
	normalizedCapabilities := normalizeAssetCapabilities(capabilities)
	if len(normalizedCapabilities) == 0 {
		normalizedCapabilities = []string{"chat"}
	}
	kind := kindFromBundleCapabilities(normalizedCapabilities)
	kindToken, err := localAssetKindToken(kind)
	if err != nil {
		return nil, err
	}
	assetID := "local-import/" + strings.TrimSpace(modelName)
	normalizedEngine := defaultLocalEngine(strings.TrimSpace(engine), normalizedCapabilities)
	hashes, err := bundleFileHashes(sourceDir, scan)
	if err != nil {
		return nil, err
	}
	manifest := map[string]any{
		"schema_version":   "1.0.0",
		"asset_id":         assetID,
		"kind":             kindToken,
		"logical_model_id": defaultLogicalModelID(assetID),
		"capabilities":     normalizedCapabilities,
		"engine":           normalizedEngine,
		"entry":            entry,
		"files":            append([]string(nil), scan.files...),
		"license":          "unknown",
		"source": map[string]any{
			"repo":     bundleManifestRepo(manifestPath),
			"revision": "local",
		},
		"integrity_mode": "local_unverified",
		"hashes":         hashes,
	}
	if strings.TrimSpace(endpoint) != "" {
		manifest["endpoint"] = strings.TrimSpace(endpoint)
	}
	return manifest, nil
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
		DirectoryPath: strings.TrimSpace(req.GetDirectoryPath()),
		ModelName:     strings.TrimSpace(req.GetModelName()),
		Capabilities:  append([]string(nil), req.GetCapabilities()...),
		Engine:        strings.TrimSpace(req.GetEngine()),
		Endpoint:      strings.TrimSpace(req.GetEndpoint()),
	}
	go s.runImportLocalAssetBundle(s.jobLifetimeCtx, transfer.GetInstallSessionId(), reqCopy)
	return &runtimev1.ImportLocalAssetBundleResponse{Transfer: transfer}, nil
}

func (s *Service) runImportLocalAssetBundle(ctx context.Context, transferID string, req *runtimev1.ImportLocalAssetBundleRequest) {
	asset, err := s.importLocalAssetBundleSync(ctx, transferID, req)
	if err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return
	}
	s.completeTransfer(transferID, "register", "bundle import completed", func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.AssetId = asset.GetAssetId()
		summary.LocalAssetId = asset.GetLocalAssetId()
	})
}

func (s *Service) importLocalAssetBundleSync(ctx context.Context, transferID string, req *runtimev1.ImportLocalAssetBundleRequest) (*runtimev1.LocalAssetRecord, error) {
	sourceDir, err := validateImportSourceDirectory(req.GetDirectoryPath())
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{Message: err.Error()})
	}
	scan, err := scanBundleDirectory(sourceDir)
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{Message: err.Error()})
	}
	modelsRoot := resolveLocalModelsPath(s.localModelsPath)
	sourceManifestPath := filepath.Join(sourceDir, localAssetManifestFileName)
	sourceHasManifest := fileExists(sourceManifestPath)
	endpoint := strings.TrimSpace(req.GetEndpoint())

	var destDir string
	var manifestPath string
	var manifest map[string]any
	var logicalModelID string
	if sourceHasManifest {
		identity, err := parseBundleManifestIdentity(sourceManifestPath)
		if err != nil {
			return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{Message: err.Error()})
		}
		if isRunnableKind(identity.kind) {
			logicalModelID = identity.logicalModelID
			destDir = runtimeManagedResolvedModelDir(modelsRoot, logicalModelID)
		} else {
			destDir = runtimeManagedPassiveAssetDir(modelsRoot, identity.assetID)
		}
		manifestPath = filepath.Join(destDir, localAssetManifestFileName)
		manifest, err = normalizeExistingBundleManifest(sourceManifestPath, manifestPath, sourceDir, scan, identity)
		if err != nil {
			return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{Message: err.Error()})
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
		destDir = runtimeManagedResolvedModelDir(modelsRoot, logicalModelID)
		manifestPath = filepath.Join(destDir, localAssetManifestFileName)
		manifest, err = scaffoldBundleManifest(manifestPath, modelName, req.GetCapabilities(), req.GetEngine(), endpoint, sourceDir, scan)
		if err != nil {
			return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{Message: err.Error()})
		}
	}

	s.updateTransferProgress(transferID, "copy", 0, 1, "staging bundle directory")
	if sameCanonicalDirectory(sourceDir, destDir) {
		var imported *runtimev1.ImportLocalAssetResponse
		err := replaceBundleManifestWithRollback(manifestPath, manifest, func() error {
			var importErr error
			imported, importErr = s.ImportLocalAsset(ctx, &runtimev1.ImportLocalAssetRequest{ManifestPath: manifestPath, Endpoint: endpoint})
			return importErr
		})
		if err != nil {
			return nil, err
		}
		return imported.GetAsset(), nil
	}

	stageDir, err := prepareManagedModelBundleStageDir(destDir, "bundle-import")
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{Message: err.Error()})
	}
	if err := copyDirRecursive(sourceDir, stageDir); err != nil {
		_ = os.RemoveAll(stageDir)
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{Message: fmt.Sprintf("copy bundle directory: %v", err)})
	}
	if err := writeBundleManifest(filepath.Join(stageDir, localAssetManifestFileName), manifest); err != nil {
		_ = os.RemoveAll(stageDir)
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{Message: err.Error()})
	}
	s.updateTransferProgress(transferID, "copy", 1, 1, "bundle staged")
	activation, err := activateManagedModelBundle(destDir, stageDir)
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{Message: err.Error()})
	}
	s.updateTransferProgress(transferID, "register", 1, 1, "registering bundle")
	imported, err := s.ImportLocalAsset(ctx, &runtimev1.ImportLocalAssetRequest{ManifestPath: manifestPath, Endpoint: endpoint})
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
	bundleDir := runtimeManagedBundleDir(modelsRoot, asset)
	if info, err := os.Stat(bundleDir); err != nil || !info.IsDir() {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{Message: fmt.Sprintf("managed bundle directory missing: %s", bundleDir)})
	}
	manifestPath := filepath.Join(bundleDir, localAssetManifestFileName)
	scan, err := scanBundleDirectory(bundleDir)
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{Message: err.Error()})
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
		manifest, err = scaffoldBundleManifest(manifestPath, asset.GetAssetId(), asset.GetCapabilities(), asset.GetEngine(), asset.GetEndpoint(), bundleDir, scan)
	}
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{Message: err.Error()})
	}
	s.updateTransferProgress(transferID, "manifest", 1, 1, "refreshing bundle manifest")
	var imported *runtimev1.ImportLocalAssetResponse
	err = replaceBundleManifestWithRollback(manifestPath, manifest, func() error {
		var importErr error
		imported, importErr = s.importLocalAsset(ctx, &runtimev1.ImportLocalAssetRequest{ManifestPath: manifestPath, Endpoint: asset.GetEndpoint()}, localAssetExistingPolicyRebind)
		return importErr
	})
	if err != nil {
		return nil, err
	}
	return imported.GetAsset(), nil
}

func runtimeManagedBundleDir(modelsRoot string, asset *runtimev1.LocalAssetRecord) string {
	if asset == nil {
		return ""
	}
	if isRunnableKind(asset.GetKind()) {
		logicalModelID := strings.TrimSpace(asset.GetLogicalModelId())
		if logicalModelID == "" {
			logicalModelID = defaultLogicalModelID(asset.GetAssetId())
		}
		return runtimeManagedResolvedModelDir(modelsRoot, logicalModelID)
	}
	return runtimeManagedPassiveAssetDir(modelsRoot, asset.GetAssetId())
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
