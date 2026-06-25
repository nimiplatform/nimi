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
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
)

var knownModelExtensions = map[string]struct{}{
	".gguf":        {},
	".safetensors": {},
	".bin":         {},
	".pt":          {},
	".onnx":        {},
	".pth":         {},
}

func newLocalImportInstanceID() string {
	return strings.ToLower(ulid.Make().String())
}

func localImportAssetID(displayName string, importInstanceID string) string {
	name := strings.TrimSpace(displayName)
	if name == "" {
		name = "asset"
	}
	name = strings.TrimSpace(strings.NewReplacer("/", "-", "\\", "-").Replace(name))
	if name == "" {
		name = "asset"
	}
	instanceID := strings.TrimSpace(importInstanceID)
	if instanceID == "" {
		instanceID = newLocalImportInstanceID()
	}
	return filepath.ToSlash(filepath.Join("local-import", name, instanceID))
}

func prepareImportSourcePath(rawPath string) (string, fs.FileInfo, error) {
	sourcePath := filepath.Clean(strings.TrimSpace(rawPath))
	if sourcePath == "." || sourcePath == "" {
		return "", nil, fmt.Errorf("path required")
	}
	metadata, err := os.Lstat(sourcePath)
	if err != nil {
		return "", nil, err
	}
	if metadata.Mode()&os.ModeSymlink != 0 {
		return "", nil, fmt.Errorf("symbolic links are not supported for import")
	}
	if !metadata.Mode().IsRegular() {
		return "", nil, fmt.Errorf("path is not a regular file")
	}
	canonicalPath, err := filepath.EvalSymlinks(sourcePath)
	if err != nil {
		return "", nil, err
	}
	info, err := os.Stat(canonicalPath)
	if err != nil {
		return "", nil, err
	}
	if !info.Mode().IsRegular() {
		return "", nil, fmt.Errorf("path is not a regular file")
	}
	return canonicalPath, info, nil
}

func computeImportFileSHA256(path string) (string, error) {
	file, err := os.Open(strings.TrimSpace(path))
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

func runtimeManagedResolvedModelDir(modelsRoot string, logicalModelID string) string {
	return filepath.Join(modelsRoot, "resolved", filepath.FromSlash(strings.Trim(strings.TrimSpace(logicalModelID), "/")))
}

func runtimeManagedAssetManifestPath(modelsRoot string, logicalModelID string) string {
	return filepath.Join(runtimeManagedResolvedModelDir(modelsRoot, logicalModelID), "asset.manifest.json")
}

func runtimeManagedPassiveAssetDir(modelsRoot string, assetID string) string {
	return filepath.Join(modelsRoot, "resolved", slugifyLocalModelID(assetID))
}

func runtimeManagedPassiveAssetManifestPath(modelsRoot string, assetID string) string {
	return filepath.Join(runtimeManagedPassiveAssetDir(modelsRoot, assetID), "asset.manifest.json")
}

func maybeMoveOrCopyFile(sourcePath string, destPath string, removeSource bool) error {
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return err
	}
	if removeSource {
		if err := os.Rename(sourcePath, destPath); err == nil {
			return nil
		}
	}
	info, err := os.Stat(sourcePath)
	if err != nil {
		return err
	}
	if err := copyFile(sourcePath, destPath, info.Mode().Perm()); err != nil {
		return err
	}
	if removeSource {
		if err := os.Remove(sourcePath); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func copyFile(src, dst string, perm os.FileMode) error {
	source, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open source file: %w", err)
	}
	defer source.Close()
	target, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, perm)
	if err != nil {
		return fmt.Errorf("open destination file: %w", err)
	}
	_, copyErr := io.Copy(target, source)
	closeErr := target.Close()
	if copyErr != nil {
		return fmt.Errorf("copy source file: %w", copyErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close destination file: %w", closeErr)
	}
	return nil
}

func copyDirRecursive(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relPath, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		dstPath := filepath.Join(dst, relPath)
		if d.IsDir() {
			return os.MkdirAll(dstPath, 0o755)
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		return copyFile(path, dstPath, info.Mode().Perm())
	})
}

func normalizeAssetKindForPath(path string) runtimev1.LocalAssetKind {
	lowerPath := strings.ToLower(strings.TrimSpace(path))
	extension := strings.ToLower(filepath.Ext(strings.TrimSpace(path)))
	if extension == ".gguf" && hasRuntimeSupportedDiffusionGGUFIdentity(path) {
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE
	}
	if strings.Contains(lowerPath, "embedding") || strings.Contains(lowerPath, "embed") {
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING
	}
	switch extension {
	case ".gguf":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT
	default:
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT
	}
}

func hasRuntimeSupportedDiffusionGGUFIdentity(path string) bool {
	summary, err := ggufmeta.InspectPath(path)
	if err != nil {
		return false
	}
	return ggufmeta.StableDiffusionMetadataIssue(summary) == ""
}

func defaultEngineForAssetKind(kind runtimev1.LocalAssetKind) string {
	switch kind {
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO:
		return "media"
	case runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT:
		return "speech"
	default:
		return "llama"
	}
}

func isKnownModelFile(path string) bool {
	_, ok := knownModelExtensions[strings.ToLower(filepath.Ext(strings.TrimSpace(path)))]
	return ok
}

func (s *Service) ImportLocalAssetFile(ctx context.Context, req *runtimev1.ImportLocalAssetFileRequest) (*runtimev1.ImportLocalAssetFileResponse, error) {
	kind := req.GetKind()
	if kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED && !isRunnableKind(kind) {
		return s.importLocalPassiveAssetFile(ctx, req, false)
	}
	return s.importLocalModelFile(ctx, req, false)
}

func (s *Service) ScaffoldOrphanAsset(ctx context.Context, req *runtimev1.ScaffoldOrphanAssetRequest) (*runtimev1.ScaffoldOrphanAssetResponse, error) {
	kind := req.GetKind()
	if kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED && !isRunnableKind(kind) {
		resp, err := s.importLocalPassiveAssetFile(ctx, &runtimev1.ImportLocalAssetFileRequest{
			FilePath: req.GetPath(),
			Kind:     req.GetKind(),
			Engine:   req.GetEngine(),
		}, true)
		if err != nil {
			return nil, err
		}
		return &runtimev1.ScaffoldOrphanAssetResponse{Asset: resp.GetAsset()}, nil
	}
	resp, err := s.importLocalModelFile(ctx, &runtimev1.ImportLocalAssetFileRequest{
		FilePath:     req.GetPath(),
		Kind:         req.GetKind(),
		Capabilities: append([]string(nil), req.GetCapabilities()...),
		Engine:       req.GetEngine(),
		Endpoint:     req.GetEndpoint(),
	}, true)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ScaffoldOrphanAssetResponse{Asset: resp.GetAsset()}, nil
}

func (s *Service) importLocalModelFile(
	ctx context.Context,
	req *runtimev1.ImportLocalAssetFileRequest,
	removeSource bool,
) (*runtimev1.ImportLocalAssetFileResponse, error) {
	sourcePath, _, err := prepareImportSourcePath(req.GetFilePath())
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{
			Message: err.Error(),
		})
	}
	capabilities := normalizeAssetCapabilities(req.GetCapabilities())
	if len(capabilities) == 0 {
		kind := req.GetKind()
		if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
			kind = normalizeAssetKindForPath(sourcePath)
		}
		capabilities = defaultCapabilitiesForAssetKind(kind)
	}
	if len(capabilities) == 0 {
		capabilities = []string{"chat"}
	}
	engine := defaultLocalEngine(strings.TrimSpace(req.GetEngine()), capabilities)
	modelName := strings.TrimSpace(req.GetAssetName())
	if modelName == "" {
		modelName = strings.TrimSuffix(filepath.Base(sourcePath), filepath.Ext(sourcePath))
	}
	importInstanceID := newLocalImportInstanceID()
	modelID := localImportAssetID(modelName, importInstanceID)
	transferPhase := "copy"
	if removeSource {
		transferPhase = "move"
	}
	transfer := s.newLocalTransfer(localTransferKindImport, localTransferMutation{
		ModelID:   modelID,
		Phase:     transferPhase,
		State:     localTransferStateRunning,
		Message:   "staging local model file",
		Retryable: false,
	})
	transferID := transfer.GetInstallSessionId()
	logicalModelID := filepath.ToSlash(filepath.Join("nimi", slugifyLocalModelID(modelID)))
	modelsRoot := resolveLocalModelsPath(s.localModelsPath)
	destDir := runtimeManagedResolvedModelDir(modelsRoot, logicalModelID)
	binding := resolveInstallRuntimeBinding(
		engine,
		capabilities,
		inferAssetKindFromCapabilities(capabilities),
		strings.TrimSpace(req.GetEndpoint()),
		collectDeviceProfile(),
	)
	binding = normalizeLocalImportRuntimeBinding(
		engine,
		capabilities,
		inferAssetKindFromCapabilities(capabilities),
		binding,
	)
	if normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT && strings.TrimSpace(binding.endpoint) == "" {
		err := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED)
		if detail := attachedEndpointRequiredDetailForAsset(engine, capabilities, inferAssetKindFromCapabilities(capabilities), collectDeviceProfile()); detail != "" {
			err = grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED, grpcerr.ReasonOptions{
				Message:    detail,
				ActionHint: "set_local_provider_endpoint",
			})
		}
		s.failTransfer(transferID, err.Error(), false)
		return nil, err
	}
	stageDir, err := prepareManagedModelBundleStageDir(destDir, "import")
	if err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: err.Error(),
		})
	}
	destFileName := filepath.Base(sourcePath)
	stageFilePath := filepath.Join(stageDir, destFileName)
	if err := maybeMoveOrCopyFile(sourcePath, stageFilePath, removeSource); err != nil {
		s.failTransfer(transferID, fmt.Sprintf("stage managed model file: %v", err), false)
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: fmt.Sprintf("stage managed model file: %v", err),
		})
	}
	stageFileHash, err := computeImportFileSHA256(stageFilePath)
	if err != nil {
		s.failTransfer(transferID, fmt.Sprintf("hash staged managed model file: %v", err), false)
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: fmt.Sprintf("hash staged managed model file: %v", err),
		})
	}
	s.updateTransferProgress(transferID, transferPhase, 1, 1, "local model staged")
	manifestPath := filepath.Join(stageDir, "asset.manifest.json")
	kind := inferAssetKindFromCapabilities(capabilities)
	kindToken, err := localAssetKindToken(kind)
	if err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID, grpcerr.ReasonOptions{
			Message: err.Error(),
		})
	}
	manifest := map[string]any{
		"schema_version":     "1.0.0",
		"asset_id":           modelID,
		"display_name":       modelName,
		"source_file_name":   destFileName,
		"import_instance_id": importInstanceID,
		"kind":               kindToken,
		"logical_model_id":   logicalModelID,
		"capabilities":       capabilities,
		"engine":             engine,
		"entry":              destFileName,
		"files":              []string{destFileName},
		"license":            "unknown",
		"source": map[string]any{
			"repo":     "file://" + filepath.ToSlash(manifestPath),
			"revision": "local",
		},
		"integrity_mode": "local_unverified",
		"hashes":         map[string]string{destFileName: "sha256:" + stageFileHash},
	}
	if strings.TrimSpace(binding.endpoint) != "" {
		manifest["endpoint"] = binding.endpoint
	}
	s.updateTransferProgress(transferID, "manifest", 1, 1, "writing runtime manifest")
	payload, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		if _, rollbackErr := s.rollbackManagedModelStageBeforeActivation(modelsRoot, logicalModelID, sourcePath, stageFilePath, stageDir, removeSource, "local_model_import", fmt.Sprintf("serialize manifest: %v", err), modelID); rollbackErr != nil {
			s.failTransfer(transferID, fmt.Sprintf("serialize runtime managed model manifest: %v; rollback=%v", err, rollbackErr), false)
			return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
				Message: fmt.Sprintf("serialize runtime managed model manifest: %v", err),
			})
		}
		s.failTransfer(transferID, fmt.Sprintf("serialize runtime managed model manifest: %v", err), false)
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: fmt.Sprintf("serialize runtime managed model manifest: %v", err),
		})
	}
	if err := os.WriteFile(manifestPath, payload, 0o644); err != nil {
		if _, rollbackErr := s.rollbackManagedModelStageBeforeActivation(modelsRoot, logicalModelID, sourcePath, stageFilePath, stageDir, removeSource, "local_model_import", fmt.Sprintf("write manifest: %v", err), modelID); rollbackErr != nil {
			s.failTransfer(transferID, fmt.Sprintf("write runtime managed model manifest: %v; rollback=%v", err, rollbackErr), false)
			return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
				Message: fmt.Sprintf("write runtime managed model manifest: %v", err),
			})
		}
		s.failTransfer(transferID, fmt.Sprintf("write runtime managed model manifest: %v", err), false)
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: fmt.Sprintf("write runtime managed model manifest: %v", err),
		})
	}
	activation, err := activateManagedModelBundle(destDir, stageDir)
	if err != nil {
		if _, rollbackErr := s.rollbackManagedModelStageBeforeActivation(modelsRoot, logicalModelID, sourcePath, stageFilePath, stageDir, removeSource, "local_model_import", fmt.Sprintf("activate bundle: %v", err), modelID); rollbackErr != nil {
			s.failTransfer(transferID, fmt.Sprintf("activate managed model bundle: %v; rollback=%v", err, rollbackErr), false)
			return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
				Message: fmt.Sprintf("activate managed model bundle: %v", err),
			})
		}
		s.failTransfer(transferID, fmt.Sprintf("activate managed model bundle: %v", err), false)
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: fmt.Sprintf("activate managed model bundle: %v", err),
		})
	}
	manifestPath = runtimeManagedAssetManifestPath(modelsRoot, logicalModelID)
	s.updateTransferProgress(transferID, "register", 1, 1, "registering local model")
	imported, err := s.ImportLocalAsset(ctx, &runtimev1.ImportLocalAssetRequest{
		ManifestPath: manifestPath,
		Endpoint:     binding.endpoint,
	})
	if err != nil {
		restoreErr := error(nil)
		if removeSource {
			restorePath := filepath.Join(destDir, destFileName)
			if _, statErr := os.Stat(restorePath); statErr == nil {
				restoreErr = maybeMoveOrCopyFile(restorePath, sourcePath, false)
			} else if statErr != nil && !os.IsNotExist(statErr) {
				restoreErr = statErr
			}
		}
		if quarantinePath, rollbackErr := activation.Rollback(s, modelsRoot, logicalModelID, "local_model_import", err.Error(), modelID, ""); rollbackErr != nil {
			s.failTransfer(transferID, fmt.Sprintf("%s; restore_source=%v; rollback=%v", err.Error(), restoreErr, rollbackErr), false)
			return nil, err
		} else if strings.TrimSpace(quarantinePath) != "" {
			if restoreErr != nil {
				s.failTransfer(transferID, fmt.Sprintf("%s; restore_source=%v; quarantine=%s", err.Error(), restoreErr, quarantinePath), false)
				return nil, err
			}
			s.failTransfer(transferID, fmt.Sprintf("%s; quarantine=%s", err.Error(), quarantinePath), false)
			return nil, err
		}
		if restoreErr != nil {
			s.failTransfer(transferID, fmt.Sprintf("%s; restore_source=%v", err.Error(), restoreErr), false)
			return nil, err
		}
		s.failTransfer(transferID, err.Error(), false)
		return nil, err
	}
	if commitErr := activation.Commit(); commitErr != nil {
		s.logger.Warn("cleanup managed bundle backup failed after import", "logical_model_id", logicalModelID, "error", commitErr)
	}
	s.completeTransfer(transferID, "register", "local model imported", func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.LocalAssetId = imported.GetAsset().GetLocalAssetId()
		summary.AssetId = imported.GetAsset().GetAssetId()
	})
	return &runtimev1.ImportLocalAssetFileResponse{Asset: imported.GetAsset()}, nil
}

func (s *Service) importLocalPassiveAssetFile(
	ctx context.Context,
	req *runtimev1.ImportLocalAssetFileRequest,
	removeSource bool,
) (*runtimev1.ImportLocalAssetFileResponse, error) {
	sourcePath, _, err := prepareImportSourcePath(req.GetFilePath())
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{
			Message: err.Error(),
		})
	}
	kind := req.GetKind()
	if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	engine := strings.TrimSpace(req.GetEngine())
	if engine == "" && kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY {
		engine = defaultLocalEngine("", nil)
	}
	artifactName := strings.TrimSuffix(filepath.Base(sourcePath), filepath.Ext(sourcePath))
	importInstanceID := newLocalImportInstanceID()
	artifactID := localImportAssetID(artifactName, importInstanceID)
	transferPhase := "copy"
	if removeSource {
		transferPhase = "move"
	}
	transfer := s.newLocalTransfer(localTransferKindImport, localTransferMutation{
		ModelID:    artifactID,
		ArtifactID: artifactID,
		Phase:      transferPhase,
		State:      localTransferStateRunning,
		Message:    "staging local artifact file",
		Retryable:  false,
	})
	transferID := transfer.GetInstallSessionId()
	modelsRoot := resolveLocalModelsPath(s.localModelsPath)
	destDir := runtimeManagedPassiveAssetDir(modelsRoot, artifactID)
	destFileName := filepath.Base(sourcePath)
	destFilePath := filepath.Join(destDir, destFileName)
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		s.failTransfer(transferID, fmt.Sprintf("create runtime managed artifact directory: %v", err), false)
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: fmt.Sprintf("create runtime managed artifact directory: %v", err),
		})
	}
	if err := maybeMoveOrCopyFile(sourcePath, destFilePath, removeSource); err != nil {
		s.failTransfer(transferID, fmt.Sprintf("stage managed artifact file: %v", err), false)
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: fmt.Sprintf("stage managed artifact file: %v", err),
		})
	}
	destFileHash, err := computeImportFileSHA256(destFilePath)
	if err != nil {
		s.failTransfer(transferID, fmt.Sprintf("hash staged managed artifact file: %v", err), false)
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: fmt.Sprintf("hash staged managed artifact file: %v", err),
		})
	}
	s.updateTransferProgress(transferID, transferPhase, 1, 1, "local artifact staged")
	manifestPath := runtimeManagedPassiveAssetManifestPath(modelsRoot, artifactID)
	kindToken, err := localAssetKindToken(kind)
	if err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID, grpcerr.ReasonOptions{
			Message: err.Error(),
		})
	}
	manifest := map[string]any{
		"schema_version":     "1.0.0",
		"asset_id":           artifactID,
		"display_name":       artifactName,
		"source_file_name":   destFileName,
		"import_instance_id": importInstanceID,
		"kind":               kindToken,
		"engine":             engine,
		"entry":              destFileName,
		"files":              []string{destFileName},
		"license":            "unknown",
		"source": map[string]any{
			"repo":     "file://" + filepath.ToSlash(manifestPath),
			"revision": "local",
		},
		"integrity_mode": "local_unverified",
		"hashes":         map[string]string{destFileName: "sha256:" + destFileHash},
	}
	if projection, ok := managedImagePassiveProjectionForAsset(kind, destFilePath); ok {
		if strings.TrimSpace(projection.Family) != "" {
			manifest["family"] = projection.Family
		}
		if len(projection.ArtifactRoles) > 0 {
			manifest["artifact_roles"] = append([]string(nil), projection.ArtifactRoles...)
		}
	}
	if engine != "" {
		manifest["preferred_engine"] = engine
	}
	s.updateTransferProgress(transferID, "manifest", 1, 1, "writing artifact manifest")
	payload, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		s.failTransfer(transferID, fmt.Sprintf("serialize runtime managed artifact manifest: %v", err), false)
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: fmt.Sprintf("serialize runtime managed artifact manifest: %v", err),
		})
	}
	if err := os.WriteFile(manifestPath, payload, 0o644); err != nil {
		s.failTransfer(transferID, fmt.Sprintf("write runtime managed artifact manifest: %v", err), false)
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: fmt.Sprintf("write runtime managed artifact manifest: %v", err),
		})
	}
	s.updateTransferProgress(transferID, "register", 1, 1, "registering local artifact")
	imported, err := s.ImportLocalAsset(ctx, &runtimev1.ImportLocalAssetRequest{ManifestPath: manifestPath})
	if err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, err
	}
	s.completeTransfer(transferID, "register", "local artifact imported", func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.AssetId = imported.GetAsset().GetAssetId()
		summary.LocalAssetId = imported.GetAsset().GetLocalAssetId()
		summary.AssetId = imported.GetAsset().GetAssetId()
	})
	return &runtimev1.ImportLocalAssetFileResponse{Asset: imported.GetAsset()}, nil
}

func (s *Service) ScanUnregisteredAssets(_ context.Context, _ *runtimev1.ScanUnregisteredAssetsRequest) (*runtimev1.ScanUnregisteredAssetsResponse, error) {
	root := strings.TrimSpace(resolveLocalModelsPath(s.localModelsPath))
	if root == "" {
		return &runtimev1.ScanUnregisteredAssetsResponse{Items: make([]*runtimev1.LocalUnregisteredAssetDescriptor, 0)}, nil
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return &runtimev1.ScanUnregisteredAssetsResponse{Items: make([]*runtimev1.LocalUnregisteredAssetDescriptor, 0)}, nil
	}
	items := make([]*runtimev1.LocalUnregisteredAssetDescriptor, 0)
	seen := map[string]struct{}{}
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		cleanPath := filepath.Clean(path)
		if d.IsDir() {
			name := strings.ToLower(strings.TrimSpace(d.Name()))
			if name == "resolved" || name == "quarantine" || strings.HasSuffix(cleanPath, string(filepath.Separator)+"resolved") {
				return filepath.SkipDir
			}
			if _, statErr := os.Stat(filepath.Join(cleanPath, "asset.manifest.json")); statErr == nil {
				return filepath.SkipDir
			}
			return nil
		}
		if !isKnownModelFile(cleanPath) {
			return nil
		}
		if _, ok := seen[cleanPath]; ok {
			return nil
		}
		seen[cleanPath] = struct{}{}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		parentName := filepath.Base(filepath.Dir(cleanPath))
		assetKind := normalizeAssetKindForPath(cleanPath)
		items = append(items, &runtimev1.LocalUnregisteredAssetDescriptor{
			Filename:  filepath.Base(cleanPath),
			Path:      cleanPath,
			SizeBytes: info.Size(),
			Declaration: &runtimev1.LocalUnregisteredAssetDeclaration{
				AssetKind: assetKind,
				Engine:    defaultEngineForAssetKind(assetKind),
			},
			SuggestionSource:     "filename",
			Confidence:           "low",
			AutoImportable:       false,
			RequiresManualReview: true,
			FolderName:           parentName,
		})
		return nil
	})
	return &runtimev1.ScanUnregisteredAssetsResponse{Items: items}, nil
}
