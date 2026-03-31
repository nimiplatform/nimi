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

var knownModelExtensions = map[string]struct{}{
	".gguf":        {},
	".safetensors": {},
	".bin":         {},
	".pt":          {},
	".onnx":        {},
	".pth":         {},
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

func runtimeManagedResolvedModelDir(modelsRoot string, logicalModelID string) string {
	return filepath.Join(modelsRoot, "resolved", filepath.FromSlash(strings.Trim(strings.TrimSpace(logicalModelID), "/")))
}

func runtimeManagedResolvedModelManifestPath(modelsRoot string, logicalModelID string) string {
	return filepath.Join(runtimeManagedResolvedModelDir(modelsRoot, logicalModelID), "manifest.json")
}

func runtimeManagedArtifactDir(modelsRoot string, artifactID string) string {
	return filepath.Join(modelsRoot, "artifacts", slugifyLocalModelID(artifactID))
}

func runtimeManagedArtifactManifestPath(modelsRoot string, artifactID string) string {
	return filepath.Join(runtimeManagedArtifactDir(modelsRoot, artifactID), "artifact.manifest.json")
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

func kindString(kind runtimev1.LocalArtifactKind) string {
	switch kind {
	case runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_LLM:
		return "llm"
	case runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_CLIP:
		return "clip"
	case runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_CONTROLNET:
		return "controlnet"
	case runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_LORA:
		return "lora"
	case runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_AUXILIARY:
		return "auxiliary"
	default:
		return "vae"
	}
}

func normalizeModelTypeForPath(path string) string {
	extension := strings.ToLower(filepath.Ext(strings.TrimSpace(path)))
	switch extension {
	case ".gguf":
		return "chat"
	default:
		return "chat"
	}
}

func defaultEngineForModelType(modelType string) string {
	switch strings.ToLower(strings.TrimSpace(modelType)) {
	case "image", "video":
		return "media"
	case "tts", "stt", "music":
		return "speech"
	default:
		return "llama"
	}
}

func isKnownModelFile(path string) bool {
	_, ok := knownModelExtensions[strings.ToLower(filepath.Ext(strings.TrimSpace(path)))]
	return ok
}

func (s *Service) ImportLocalModelFile(ctx context.Context, req *runtimev1.ImportLocalModelFileRequest) (*runtimev1.ImportLocalModelFileResponse, error) {
	return s.importLocalModelFile(ctx, req, false)
}

func (s *Service) ScaffoldOrphanModel(ctx context.Context, req *runtimev1.ScaffoldOrphanModelRequest) (*runtimev1.ScaffoldOrphanModelResponse, error) {
	resp, err := s.importLocalModelFile(ctx, &runtimev1.ImportLocalModelFileRequest{
		FilePath:     req.GetPath(),
		Capabilities: append([]string(nil), req.GetCapabilities()...),
		Engine:       req.GetEngine(),
		Endpoint:     req.GetEndpoint(),
	}, true)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ScaffoldOrphanModelResponse{Model: resp.GetModel()}, nil
}

func (s *Service) importLocalModelFile(
	ctx context.Context,
	req *runtimev1.ImportLocalModelFileRequest,
	removeSource bool,
) (*runtimev1.ImportLocalModelFileResponse, error) {
	sourcePath, _, err := prepareImportSourcePath(req.GetFilePath())
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{
			Message: err.Error(),
		})
	}
	capabilities := normalizeStringSlice(req.GetCapabilities())
	if len(capabilities) == 0 {
		capabilities = []string{"chat"}
	}
	engine := defaultLocalEngine(strings.TrimSpace(req.GetEngine()), capabilities)
	modelName := strings.TrimSpace(req.GetModelName())
	if modelName == "" {
		modelName = strings.TrimSuffix(filepath.Base(sourcePath), filepath.Ext(sourcePath))
	}
	modelID := "local-import/" + modelName
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
	binding := resolveInstallRuntimeBinding(engine, strings.TrimSpace(req.GetEndpoint()), collectDeviceProfile())
	if normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT && strings.TrimSpace(binding.endpoint) == "" {
		err := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED)
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
	s.updateTransferProgress(transferID, transferPhase, 1, 1, "local model staged")
	manifestPath := filepath.Join(stageDir, "manifest.json")
	manifest := map[string]any{
		"schemaVersion":    "1.0.0",
		"model_id":         modelID,
		"logical_model_id": logicalModelID,
		"capabilities":     capabilities,
		"engine":           engine,
		"entry":            destFileName,
		"files":            []string{destFileName},
		"license":          "unknown",
		"source": map[string]any{
			"repo":     "file://" + filepath.ToSlash(manifestPath),
			"revision": "local",
		},
		"integrity_mode": "local_unverified",
		"hashes":         map[string]string{},
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
	manifestPath = runtimeManagedResolvedModelManifestPath(modelsRoot, logicalModelID)
	s.updateTransferProgress(transferID, "register", 1, 1, "registering local model")
	imported, err := s.ImportLocalModel(ctx, &runtimev1.ImportLocalModelRequest{
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
		summary.LocalModelId = imported.GetModel().GetLocalModelId()
		summary.ModelId = imported.GetModel().GetModelId()
	})
	return &runtimev1.ImportLocalModelFileResponse{Model: imported.GetModel()}, nil
}

func (s *Service) ImportLocalArtifactFile(ctx context.Context, req *runtimev1.ImportLocalArtifactFileRequest) (*runtimev1.ImportLocalArtifactFileResponse, error) {
	return s.importLocalArtifactFile(ctx, req, false)
}

func (s *Service) ScaffoldOrphanArtifact(ctx context.Context, req *runtimev1.ScaffoldOrphanArtifactRequest) (*runtimev1.ScaffoldOrphanArtifactResponse, error) {
	resp, err := s.importLocalArtifactFile(ctx, &runtimev1.ImportLocalArtifactFileRequest{
		FilePath: req.GetPath(),
		Kind:     req.GetKind(),
		Engine:   req.GetEngine(),
	}, true)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ScaffoldOrphanArtifactResponse{Artifact: resp.GetArtifact()}, nil
}

func (s *Service) importLocalArtifactFile(
	ctx context.Context,
	req *runtimev1.ImportLocalArtifactFileRequest,
	removeSource bool,
) (*runtimev1.ImportLocalArtifactFileResponse, error) {
	sourcePath, _, err := prepareImportSourcePath(req.GetFilePath())
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{
			Message: err.Error(),
		})
	}
	kind := req.GetKind()
	if kind == runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_UNSPECIFIED {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	}
	engine := strings.TrimSpace(req.GetEngine())
	if engine == "" && kind != runtimev1.LocalArtifactKind_LOCAL_ARTIFACT_KIND_AUXILIARY {
		engine = defaultLocalEngine("", nil)
	}
	artifactName := strings.TrimSuffix(filepath.Base(sourcePath), filepath.Ext(sourcePath))
	artifactID := "local-import/" + artifactName
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
	destDir := runtimeManagedArtifactDir(modelsRoot, artifactID)
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
	s.updateTransferProgress(transferID, transferPhase, 1, 1, "local artifact staged")
	manifestPath := runtimeManagedArtifactManifestPath(modelsRoot, artifactID)
	manifest := map[string]any{
		"artifact_id": artifactID,
		"kind":        kindString(kind),
		"engine":      engine,
		"entry":       destFileName,
		"files":       []string{destFileName},
		"license":     "unknown",
		"source": map[string]any{
			"repo":     "local-import/" + slugifyLocalModelID(artifactID),
			"revision": "local",
		},
		"integrity_mode": "local_unverified",
		"hashes":         map[string]string{},
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
	imported, err := s.ImportLocalArtifact(ctx, &runtimev1.ImportLocalArtifactRequest{ManifestPath: manifestPath})
	if err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, err
	}
	s.completeTransfer(transferID, "register", "local artifact imported", func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.ArtifactId = imported.GetArtifact().GetArtifactId()
		summary.LocalArtifactId = imported.GetArtifact().GetLocalArtifactId()
		summary.ModelId = imported.GetArtifact().GetArtifactId()
	})
	return &runtimev1.ImportLocalArtifactFileResponse{Artifact: imported.GetArtifact()}, nil
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
			if name == "resolved" || name == "artifacts" || name == "quarantine" || strings.HasSuffix(cleanPath, string(filepath.Separator)+"resolved") {
				return filepath.SkipDir
			}
			if _, statErr := os.Stat(filepath.Join(cleanPath, "artifact.manifest.json")); statErr == nil {
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
			items = append(items, &runtimev1.LocalUnregisteredAssetDescriptor{
				Filename:  filepath.Base(cleanPath),
				Path:      cleanPath,
				SizeBytes: info.Size(),
				Declaration: &runtimev1.LocalUnregisteredAssetDeclaration{
					AssetClass: "model",
					ModelType:  normalizeModelTypeForPath(cleanPath),
					Engine:     defaultEngineForModelType(normalizeModelTypeForPath(cleanPath)),
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
