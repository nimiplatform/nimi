package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
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
	return computeImportFileSHA256WithProgress(path, nil)
}

func computeImportFileSHA256WithProgress(path string, onProgress func(processedBytes int64) error) (string, error) {
	file, err := os.Open(strings.TrimSpace(path))
	if err != nil {
		return "", err
	}
	defer func() {
		_ = file.Close()
	}()
	hasher := sha256.New()
	const progressStepBytes int64 = 64 * 1024 * 1024
	buffer := make([]byte, 4*1024*1024)
	var processedBytes int64
	var reportedBytes int64
	for {
		readCount, readErr := file.Read(buffer)
		if readCount > 0 {
			if _, writeErr := hasher.Write(buffer[:readCount]); writeErr != nil {
				return "", writeErr
			}
			processedBytes += int64(readCount)
			if onProgress != nil && processedBytes-reportedBytes >= progressStepBytes {
				if err := onProgress(processedBytes); err != nil {
					return "", err
				}
				reportedBytes = processedBytes
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return "", readErr
		}
	}
	if onProgress != nil && processedBytes != reportedBytes {
		if err := onProgress(processedBytes); err != nil {
			return "", err
		}
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func validateManagedLogicalModelID(logicalModelID string) error {
	value := strings.TrimSpace(logicalModelID)
	if value == "" || value != logicalModelID {
		return fmt.Errorf("logical_model_id must be a non-empty canonical relative identifier")
	}
	if strings.ContainsAny(value, "\\:\x00") || path.IsAbs(value) {
		return fmt.Errorf("logical_model_id must not contain an absolute or platform-specific path")
	}
	if cleaned := path.Clean(value); cleaned != value {
		return fmt.Errorf("logical_model_id must not contain path traversal or non-canonical segments")
	}
	for _, segment := range strings.Split(value, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return fmt.Errorf("logical_model_id must not contain empty or traversal segments")
		}
		if strings.HasSuffix(segment, ".") || strings.HasSuffix(segment, " ") {
			return fmt.Errorf("logical_model_id contains a platform-ambiguous segment")
		}
		if isWindowsReservedPathSegment(segment) {
			return fmt.Errorf("logical_model_id contains a reserved platform path segment")
		}
	}
	return nil
}

func isWindowsReservedPathSegment(segment string) bool {
	base := strings.ToUpper(strings.SplitN(segment, ".", 2)[0])
	switch base {
	case "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$":
		return true
	}
	return len(base) == 4 &&
		(base[:3] == "COM" || base[:3] == "LPT") &&
		base[3] >= '1' && base[3] <= '9'
}

func pathWithinBase(basePath string, candidatePath string, allowBase bool) bool {
	rel, err := filepath.Rel(basePath, candidatePath)
	if err != nil || filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false
	}
	return allowBase || (rel != "." && rel != "")
}

func resolveRuntimeManagedModelBundleDir(modelsRoot string, logicalModelID string) (string, error) {
	root := strings.TrimSpace(modelsRoot)
	if root == "" || !filepath.IsAbs(root) {
		return "", fmt.Errorf("runtime models root must be absolute")
	}
	if err := validateManagedLogicalModelID(logicalModelID); err != nil {
		return "", err
	}
	rootAbs, err := filepath.Abs(filepath.Clean(root))
	if err != nil {
		return "", fmt.Errorf("resolve runtime models root: %w", err)
	}
	resolvedRoot := filepath.Join(rootAbs, "resolved")
	target := filepath.Join(resolvedRoot, filepath.FromSlash(logicalModelID))
	target, err = filepath.Abs(target)
	if err != nil {
		return "", fmt.Errorf("resolve managed model bundle target: %w", err)
	}
	if !pathWithinBase(resolvedRoot, target, false) {
		return "", fmt.Errorf("managed model bundle target must stay under resolved/")
	}

	canonicalRoot := rootAbs
	if resolved, resolveErr := filepath.EvalSymlinks(rootAbs); resolveErr == nil {
		canonicalRoot = resolved
	} else if !os.IsNotExist(resolveErr) {
		return "", fmt.Errorf("resolve runtime models root links: %w", resolveErr)
	}
	canonicalResolvedRoot := resolvedRoot
	if resolved, resolveErr := filepath.EvalSymlinks(resolvedRoot); resolveErr == nil {
		canonicalResolvedRoot = resolved
		if !pathWithinBase(canonicalRoot, canonicalResolvedRoot, false) {
			return "", fmt.Errorf("resolved models root escapes runtime models root")
		}
	} else if !os.IsNotExist(resolveErr) {
		return "", fmt.Errorf("resolve managed models directory links: %w", resolveErr)
	}

	current := resolvedRoot
	for _, segment := range strings.Split(logicalModelID, "/") {
		current = filepath.Join(current, segment)
		if _, statErr := os.Lstat(current); statErr != nil {
			if os.IsNotExist(statErr) {
				break
			}
			return "", fmt.Errorf("inspect managed model bundle target: %w", statErr)
		}
		resolvedCurrent, resolveErr := filepath.EvalSymlinks(current)
		if resolveErr != nil {
			return "", fmt.Errorf("resolve managed model bundle target links: %w", resolveErr)
		}
		if !pathWithinBase(canonicalResolvedRoot, resolvedCurrent, true) {
			return "", fmt.Errorf("managed model bundle target escapes resolved/ through a link")
		}
	}
	return target, nil
}

func resolveRuntimeManagedImportedBundleDir(modelsRoot string, assetID string, kind runtimev1.LocalAssetKind) (string, error) {
	identity := normalizeLocalInventoryID(assetID)
	if identity == "" {
		return "", fmt.Errorf("asset_id is required for managed bundle storage")
	}
	if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
		return "", fmt.Errorf("asset kind is required for managed bundle storage")
	}
	kindToken, err := localAssetKindToken(kind)
	if err != nil {
		return "", fmt.Errorf("asset kind is invalid for managed bundle storage: %w", err)
	}
	digest := sha256.Sum256([]byte("managed-import\x00" + identity + "\x00" + kindToken))
	storageID := fmt.Sprintf("import-%s-%x", kindToken, digest)
	return resolveRuntimeManagedModelBundleDir(modelsRoot, storageID)
}

func runtimeManagedPassiveAssetDir(modelsRoot string, assetID string) string {
	return filepath.Join(modelsRoot, "resolved", slugifyLocalModelID(assetID))
}

func runtimeManagedPassiveAssetManifestPath(modelsRoot string, assetID string) string {
	return filepath.Join(runtimeManagedPassiveAssetDir(modelsRoot, assetID), "asset.manifest.json")
}

func maybeMoveOrCopyFile(sourcePath string, destPath string, removeSource bool) error {
	return maybeMoveOrCopyFileWithProgress(sourcePath, destPath, removeSource, nil)
}

func maybeMoveOrCopyFileWithProgress(sourcePath string, destPath string, removeSource bool, onProgress func(processedBytes int64) error) error {
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return err
	}
	if removeSource {
		if err := os.Rename(sourcePath, destPath); err == nil {
			if onProgress != nil {
				info, statErr := os.Stat(destPath)
				if statErr != nil {
					return statErr
				}
				return onProgress(info.Size())
			}
			return nil
		}
	}
	info, err := os.Stat(sourcePath)
	if err != nil {
		return err
	}
	if err := copyFileWithProgress(sourcePath, destPath, info.Mode().Perm(), onProgress); err != nil {
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
	return copyFileWithProgress(src, dst, perm, nil)
}

func copyFileWithProgress(src, dst string, perm os.FileMode, onProgress func(processedBytes int64) error) error {
	source, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open source file: %w", err)
	}
	defer func() {
		_ = source.Close()
	}()
	target, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, perm)
	if err != nil {
		return fmt.Errorf("open destination file: %w", err)
	}
	buffer := make([]byte, 4*1024*1024)
	var processedBytes int64
	var copyErr error
	for {
		readCount, readErr := source.Read(buffer)
		if readCount > 0 {
			if _, writeErr := target.Write(buffer[:readCount]); writeErr != nil {
				copyErr = writeErr
				break
			}
			processedBytes += int64(readCount)
			if onProgress != nil {
				if progressErr := onProgress(processedBytes); progressErr != nil {
					copyErr = progressErr
					break
				}
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			copyErr = readErr
			break
		}
	}
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
	sourcePath, sourceInfo, err := prepareImportSourcePath(req.GetFilePath())
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "local model source file is invalid"},
		)
	}
	kind := req.GetKind()
	if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
		kind = normalizeAssetKindForPath(sourcePath)
	}
	capabilities := normalizeAssetCapabilities(req.GetCapabilities())
	if len(capabilities) == 0 {
		capabilities = defaultCapabilitiesForAssetKind(kind)
	}
	if len(capabilities) == 0 {
		capabilities = []string{"chat"}
	}
	engine := strings.TrimSpace(req.GetEngine())
	if engine == "" {
		engine = defaultEngineForAssetKind(kind)
	}
	if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS || kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT {
		return nil, grpcerr.WithReasonCodeOptions(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			grpcerr.ReasonOptions{
				Message:    "local speech models require a complete admitted folder bundle",
				ActionHint: "import_complete_speech_model_folder",
			},
		)
	}
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
		ModelID:    modelID,
		Phase:      transferPhase,
		State:      localTransferStateRunning,
		Message:    "staging local model file",
		Retryable:  false,
		BytesTotal: sourceInfo.Size(),
	})
	transferID := transfer.GetInstallSessionId()
	control := s.transferControl(transferID)
	// checkActive honors CancelLocalTransfer (via the transfer control) and a
	// dead client (ctx done) so an import never outlives its cancellation.
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
	isAbort := func(err error) bool {
		return errors.Is(err, errLocalTransferCancelled) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
	}
	logicalModelID := filepath.ToSlash(filepath.Join("nimi", slugifyLocalModelID(modelID)))
	modelsRoot := resolveLocalModelsPath(s.localModelsPath)
	destDir, err := resolveRuntimeManagedModelBundleDir(modelsRoot, logicalModelID)
	if err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "managed model target is invalid"},
		)
	}
	stageDir, err := prepareManagedModelBundleStageDir(destDir, "import")
	if err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			err,
			grpcerr.ReasonOptions{Message: "managed model staging directory could not be prepared"},
		)
	}
	destFileName := filepath.Base(sourcePath)
	stageFilePath := filepath.Join(stageDir, destFileName)
	// abortStagedImport settles the session as cancelled and undoes the
	// staging: before the move/copy completed the source file is untouched, so
	// the partial stage is simply dropped; afterwards the staged file is moved
	// back to the source path when the import consumed it (removeSource).
	abortStagedImport := func(staged bool) error {
		if staged {
			if _, rollbackErr := s.rollbackManagedModelStageBeforeActivation(modelsRoot, logicalModelID, sourcePath, stageFilePath, stageDir, removeSource, "local_model_import", "cancelled", modelID); rollbackErr != nil {
				s.cancelTransfer(transferID, fmt.Sprintf("transfer cancelled; rollback=%v", rollbackErr))
				return errLocalTransferCancelled
			}
		} else {
			_ = os.RemoveAll(stageDir)
		}
		s.cancelTransfer(transferID, "transfer cancelled")
		return errLocalTransferCancelled
	}
	if err := checkActive(); err != nil {
		return nil, abortStagedImport(false)
	}
	staged := false
	if err := maybeMoveOrCopyFileWithProgress(sourcePath, stageFilePath, removeSource, func(processedBytes int64) error {
		if err := checkActive(); err != nil {
			return err
		}
		s.updateTransferProgress(transferID, transferPhase, processedBytes, sourceInfo.Size(), "staging local model file")
		return nil
	}); err != nil {
		if isAbort(err) {
			return nil, abortStagedImport(false)
		}
		s.failTransfer(transferID, fmt.Sprintf("stage managed model file: %v", err), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			err,
			grpcerr.ReasonOptions{Message: "managed model file could not be staged"},
		)
	}
	staged = true
	stageFileHash, err := computeImportFileSHA256WithProgress(stageFilePath, func(processedBytes int64) error {
		if err := checkActive(); err != nil {
			return err
		}
		s.updateTransferProgress(transferID, transferPhase, processedBytes, sourceInfo.Size(), "staging local model file")
		return nil
	})
	if err != nil {
		if isAbort(err) {
			return nil, abortStagedImport(staged)
		}
		s.failTransfer(transferID, fmt.Sprintf("hash staged managed model file: %v", err), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			err,
			grpcerr.ReasonOptions{Message: "managed model file integrity could not be computed"},
		)
	}
	s.updateTransferProgress(transferID, transferPhase, sourceInfo.Size(), sourceInfo.Size(), "local model staged")
	if err := checkActive(); err != nil {
		return nil, abortStagedImport(staged)
	}
	manifestPath := filepath.Join(stageDir, "asset.manifest.json")
	kindToken, err := localAssetKindToken(kind)
	if err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "local model asset kind is invalid"},
		)
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
	if artifactRoles := defaultArtifactRolesForAssetKind(kind); len(artifactRoles) > 0 {
		manifest["artifact_roles"] = artifactRoles
	}
	s.updateTransferProgress(transferID, "manifest", sourceInfo.Size(), sourceInfo.Size(), "writing runtime manifest")
	payload, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		if _, rollbackErr := s.rollbackManagedModelStageBeforeActivation(modelsRoot, logicalModelID, sourcePath, stageFilePath, stageDir, removeSource, "local_model_import", fmt.Sprintf("serialize manifest: %v", err), modelID); rollbackErr != nil {
			s.failTransfer(transferID, fmt.Sprintf("serialize runtime managed model manifest: %v; rollback=%v", err, rollbackErr), false)
			return nil, grpcerr.WrapWithReasonCode(
				codes.Internal,
				runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
				errors.Join(err, rollbackErr),
				grpcerr.ReasonOptions{Message: "managed model manifest serialization and rollback failed"},
			)
		}
		s.failTransfer(transferID, fmt.Sprintf("serialize runtime managed model manifest: %v", err), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			err,
			grpcerr.ReasonOptions{Message: "managed model manifest could not be encoded"},
		)
	}
	if err := os.WriteFile(manifestPath, payload, 0o644); err != nil {
		if _, rollbackErr := s.rollbackManagedModelStageBeforeActivation(modelsRoot, logicalModelID, sourcePath, stageFilePath, stageDir, removeSource, "local_model_import", fmt.Sprintf("write manifest: %v", err), modelID); rollbackErr != nil {
			s.failTransfer(transferID, fmt.Sprintf("write runtime managed model manifest: %v; rollback=%v", err, rollbackErr), false)
			return nil, grpcerr.WrapWithReasonCode(
				codes.Internal,
				runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
				errors.Join(err, rollbackErr),
				grpcerr.ReasonOptions{Message: "managed model manifest write and rollback failed"},
			)
		}
		s.failTransfer(transferID, fmt.Sprintf("write runtime managed model manifest: %v", err), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			err,
			grpcerr.ReasonOptions{Message: "managed model manifest could not be written"},
		)
	}
	activation, err := activateManagedModelBundle(destDir, stageDir)
	if err != nil {
		if _, rollbackErr := s.rollbackManagedModelStageBeforeActivation(modelsRoot, logicalModelID, sourcePath, stageFilePath, stageDir, removeSource, "local_model_import", fmt.Sprintf("activate bundle: %v", err), modelID); rollbackErr != nil {
			s.failTransfer(transferID, fmt.Sprintf("activate managed model bundle: %v; rollback=%v", err, rollbackErr), false)
			return nil, grpcerr.WrapWithReasonCode(
				codes.Internal,
				runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
				errors.Join(err, rollbackErr),
				grpcerr.ReasonOptions{Message: "managed model bundle activation and rollback failed"},
			)
		}
		s.failTransfer(transferID, fmt.Sprintf("activate managed model bundle: %v", err), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			err,
			grpcerr.ReasonOptions{Message: "managed model bundle could not be activated"},
		)
	}
	manifestPath = filepath.Join(destDir, localAssetManifestFileName)
	s.updateTransferProgress(transferID, "register", sourceInfo.Size(), sourceInfo.Size(), "registering local model")
	imported, err := s.ImportLocalAsset(ctx, &runtimev1.ImportLocalAssetRequest{ManifestPath: manifestPath})
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
	sourcePath, sourceInfo, err := prepareImportSourcePath(req.GetFilePath())
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "local artifact source file is invalid"},
		)
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
		BytesTotal: sourceInfo.Size(),
	})
	transferID := transfer.GetInstallSessionId()
	control := s.transferControl(transferID)
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
	isAbort := func(err error) bool {
		return errors.Is(err, errLocalTransferCancelled) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
	}
	modelsRoot := resolveLocalModelsPath(s.localModelsPath)
	destDir := runtimeManagedPassiveAssetDir(modelsRoot, artifactID)
	destFileName := filepath.Base(sourcePath)
	destFilePath := filepath.Join(destDir, destFileName)
	// abortPassiveImport settles the session as cancelled and undoes the
	// staging: a partial copy is dropped; a fully staged file that consumed
	// the source (removeSource) is moved back to the source path.
	abortPassiveImport := func(staged bool) error {
		if staged && removeSource {
			_ = maybeMoveOrCopyFile(destFilePath, sourcePath, false)
		} else {
			_ = os.Remove(destFilePath)
		}
		s.cancelTransfer(transferID, "transfer cancelled")
		return errLocalTransferCancelled
	}
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		s.failTransfer(transferID, fmt.Sprintf("create runtime managed artifact directory: %v", err), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			err,
			grpcerr.ReasonOptions{Message: "managed artifact directory could not be prepared"},
		)
	}
	if err := checkActive(); err != nil {
		return nil, abortPassiveImport(false)
	}
	staged := false
	if err := maybeMoveOrCopyFileWithProgress(sourcePath, destFilePath, removeSource, func(processedBytes int64) error {
		if err := checkActive(); err != nil {
			return err
		}
		s.updateTransferProgress(transferID, transferPhase, processedBytes, sourceInfo.Size(), "staging local artifact file")
		return nil
	}); err != nil {
		if isAbort(err) {
			return nil, abortPassiveImport(false)
		}
		s.failTransfer(transferID, fmt.Sprintf("stage managed artifact file: %v", err), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			err,
			grpcerr.ReasonOptions{Message: "managed artifact file could not be staged"},
		)
	}
	staged = true
	destFileHash, err := computeImportFileSHA256WithProgress(destFilePath, func(processedBytes int64) error {
		if err := checkActive(); err != nil {
			return err
		}
		s.updateTransferProgress(transferID, transferPhase, processedBytes, sourceInfo.Size(), "staging local artifact file")
		return nil
	})
	if err != nil {
		if isAbort(err) {
			return nil, abortPassiveImport(staged)
		}
		s.failTransfer(transferID, fmt.Sprintf("hash staged managed artifact file: %v", err), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			err,
			grpcerr.ReasonOptions{Message: "managed artifact file integrity could not be computed"},
		)
	}
	s.updateTransferProgress(transferID, transferPhase, sourceInfo.Size(), sourceInfo.Size(), "local artifact staged")
	if err := checkActive(); err != nil {
		return nil, abortPassiveImport(staged)
	}
	manifestPath := runtimeManagedPassiveAssetManifestPath(modelsRoot, artifactID)
	kindToken, err := localAssetKindToken(kind)
	if err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "local artifact kind is invalid"},
		)
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
	s.updateTransferProgress(transferID, "manifest", sourceInfo.Size(), sourceInfo.Size(), "writing artifact manifest")
	payload, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		s.failTransfer(transferID, fmt.Sprintf("serialize runtime managed artifact manifest: %v", err), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			err,
			grpcerr.ReasonOptions{Message: "managed artifact manifest could not be encoded"},
		)
	}
	if err := os.WriteFile(manifestPath, payload, 0o644); err != nil {
		s.failTransfer(transferID, fmt.Sprintf("write runtime managed artifact manifest: %v", err), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.Internal,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			err,
			grpcerr.ReasonOptions{Message: "managed artifact manifest could not be written"},
		)
	}
	s.updateTransferProgress(transferID, "register", sourceInfo.Size(), sourceInfo.Size(), "registering local artifact")
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
