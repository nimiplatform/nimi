// @nimi-authority: rule.nimi.runtime.local-compute.r108

package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	modelAssetManifestSchemaVersion                = "1.0.0"
	modelAssetFingerprintReadLimit           int64 = 4 * 1024 * 1024
	modelAssetFingerprintItemLimit                 = 128
	modelAssetFingerprintStringLimit               = 512
	modelAssetCleanupOwnerChangedReason            = "MODEL_ASSET_CLEANUP_OWNER_CHANGED"
	modelAssetCleanupGenerationChangedReason       = "MODEL_ASSET_CLEANUP_GENERATION_CHANGED"
)

var modelAssetCodeExtensions = map[string]struct{}{
	".bash": {}, ".bat": {}, ".cjs": {}, ".class": {}, ".cmd": {}, ".com": {},
	".dll": {}, ".dylib": {}, ".exe": {}, ".fish": {}, ".jar": {}, ".js": {},
	".jsx": {}, ".lua": {}, ".mjs": {}, ".php": {}, ".pl": {}, ".ps1": {},
	".py": {}, ".pyc": {}, ".pyo": {}, ".r": {}, ".rb": {}, ".sh": {}, ".so": {},
	".tcl": {}, ".ts": {}, ".tsx": {}, ".vbs": {}, ".wasm": {}, ".zsh": {},
}

type modelAssetManifestFile struct {
	RelativePath         string `json:"relative_path"`
	SHA256               string `json:"sha256"`
	SizeBytes            int64  `json:"size_bytes"`
	NonExecutableContent bool   `json:"non_executable_content,omitempty"`
}

type modelAssetManifest struct {
	SchemaVersion             string                   `json:"schema_version"`
	ModelAssetID              string                   `json:"model_asset_id"`
	ContentID                 string                   `json:"content_id"`
	DisplayName               string                   `json:"display_name,omitempty"`
	Entry                     string                   `json:"entry"`
	Files                     []modelAssetManifestFile `json:"files"`
	TotalSizeBytes            int64                    `json:"total_size_bytes"`
	ContentVerified           bool                     `json:"content_verified"`
	CatalogVerified           bool                     `json:"catalog_verified"`
	BoundedFingerprint        map[string]any           `json:"bounded_fingerprint,omitempty"`
	Provenance                map[string]any           `json:"provenance,omitempty"`
	ContainsNonExecutableCode bool                     `json:"contains_non_executable_code,omitempty"`
	CreatedAt                 string                   `json:"created_at"`
}

type modelAssetSource struct {
	Path         string
	DisplayName  string
	IsDir        bool
	SizeBytes    int64
	FileIdentity modelAssetSourceFileIdentity
}

type modelAssetSourceSafetyError struct {
	Path   string
	Reason string
	Cause  error
}

func (err *modelAssetSourceSafetyError) Error() string {
	if err == nil {
		return "ModelAsset source is unsafe"
	}
	message := fmt.Sprintf("ModelAsset source %q is unsafe: %s", err.Path, err.Reason)
	if err.Cause != nil {
		message += ": " + err.Cause.Error()
	}
	return message
}

func (err *modelAssetSourceSafetyError) Unwrap() error {
	if err == nil {
		return nil
	}
	return err.Cause
}

// @nimi-authority: rule.nimi.runtime.local-compute.r009
// @nimi-authority: rule.nimi.runtime.local-compute.r014
func (s *Service) ImportModelAsset(_ context.Context, req *runtimev1.ImportModelAssetRequest) (*runtimev1.ImportModelAssetResponse, error) {
	source, err := inspectModelAssetSource(req.GetSourcePath(), req.GetDisplayName())
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, err, grpcerr.ReasonOptions{Message: "ModelAsset source is invalid"})
	}
	if _, err := s.resolveManagedBundleModelsRoot(); err != nil {
		return nil, err
	}
	modelAssetID := "model_" + strings.ToLower(ulid.Make().String())
	transfer := s.newLocalTransfer(localTransferKindImport, localTransferMutation{
		ModelID: modelAssetID, Phase: "staging",
		State: localTransferStateRunning, Message: "staging ModelAsset distribution", BytesTotal: source.SizeBytes,
	})
	go s.runImportModelAsset(s.jobLifetimeCtx, transfer.GetInstallSessionId(), modelAssetID, source)
	return &runtimev1.ImportModelAssetResponse{Transfer: transfer}, nil
}

func inspectModelAssetSource(rawPath string, displayName string) (modelAssetSource, error) {
	path := filepath.Clean(strings.TrimSpace(rawPath))
	if path == "." || path == "" {
		return modelAssetSource{}, errors.New("source_path is required")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return modelAssetSource{}, err
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return modelAssetSource{}, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return modelAssetSource{}, errors.New("symbolic links are not supported")
	}
	if !info.Mode().IsRegular() && !info.IsDir() {
		return modelAssetSource{}, errors.New("source must be one regular file or one distribution directory")
	}
	name := strings.TrimSpace(displayName)
	if name == "" {
		name = filepath.Base(absolute)
		if info.Mode().IsRegular() {
			name = strings.TrimSuffix(name, filepath.Ext(name))
		}
	}
	var total int64
	var fileIdentity modelAssetSourceFileIdentity
	if info.Mode().IsRegular() {
		fileIdentity, err = preflightModelAssetSourceFile(absolute, info)
		if err != nil {
			return modelAssetSource{}, err
		}
		total = info.Size()
	} else {
		err = filepath.WalkDir(absolute, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if filepath.Clean(path) == absolute {
				return nil
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return fmt.Errorf("distribution contains symbolic link %q", path)
			}
			if entry.IsDir() {
				return nil
			}
			info, infoErr := entry.Info()
			if infoErr != nil {
				return infoErr
			}
			if !info.Mode().IsRegular() {
				return fmt.Errorf("distribution contains non-regular entry %q", path)
			}
			relative, relativeErr := filepath.Rel(absolute, path)
			if relativeErr != nil || !safeModelAssetRelativePath(relative) {
				return fmt.Errorf("distribution path escapes source root: %q", path)
			}
			if isModelAssetControlFile(filepath.ToSlash(relative)) {
				return nil
			}
			total += info.Size()
			return nil
		})
		if err != nil {
			return modelAssetSource{}, err
		}
	}
	if total <= 0 {
		return modelAssetSource{}, errors.New("distribution contains no payload bytes")
	}
	return modelAssetSource{Path: absolute, DisplayName: name, IsDir: info.IsDir(), SizeBytes: total, FileIdentity: fileIdentity}, nil
}

func (s *Service) runImportModelAsset(ctx context.Context, transferID string, modelAssetID string, source modelAssetSource) {
	_, err := s.importModelAssetSync(ctx, transferID, modelAssetID, source)
	if err != nil {
		if errors.Is(err, errLocalTransferCancelled) || errors.Is(err, context.Canceled) {
			if persistErr := s.cancelTransfer(transferID, "ModelAsset import cancelled"); persistErr != nil {
				s.logger.Error("persist cancelled ModelAsset import transfer", "transfer_id", transferID, "error", persistErr)
			}
			return
		}
		if persistErr := s.failTransfer(transferID, err.Error(), false); persistErr != nil {
			s.logger.Error("persist failed ModelAsset import transfer", "transfer_id", transferID, "error", persistErr)
		}
		return
	}
}

func (s *Service) importModelAssetSync(ctx context.Context, transferID string, modelAssetID string, source modelAssetSource) (*runtimev1.ModelAssetRecord, error) {
	modelsRoot, err := s.resolveManagedBundleModelsRoot()
	if err != nil {
		return nil, err
	}
	resolvedRoot := filepath.Join(modelsRoot, "resolved")
	quarantineRoot := filepath.Join(modelsRoot, "quarantine")
	if source.IsDir && s.adoptResolvedModelImports && pathWithinBase(resolvedRoot, source.Path, false) {
		options := modelAssetAdoptionOptions{displayName: source.DisplayName}
		if strings.TrimSpace(transferID) != "" {
			options.transferCompletion = &modelAssetTransferCompletion{sessionID: transferID, phase: "register", message: "ModelAsset imported"}
		}
		asset, _, err := s.adoptResolvedModelAssetDirectoryWithOptions(ctx, source.Path, options)
		return asset, err
	}
	if err := os.MkdirAll(resolvedRoot, 0o755); err != nil {
		return nil, fmt.Errorf("prepare resolved root: %w", err)
	}
	if err := os.MkdirAll(quarantineRoot, 0o700); err != nil {
		return nil, fmt.Errorf("prepare quarantine root: %w", err)
	}
	stageDir, err := os.MkdirTemp(quarantineRoot, ".model-asset-staging-*")
	if err != nil {
		return nil, fmt.Errorf("prepare import staging: %w", err)
	}
	settled := false
	defer func() {
		if !settled {
			_ = quarantineModelAssetStage(stageDir, "import interrupted")
		}
	}()

	control := s.transferControl(transferID)
	checkActive := func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if control != nil {
			return control.wait(ctx)
		}
		return nil
	}
	files, hashes, total, fingerprint, unclassified, containsCode, err := s.copyModelAssetDistribution(ctx, source, stageDir, func(processed int64) error {
		if err := checkActive(); err != nil {
			return err
		}
		if transferID != "" {
			s.updateTransferProgress(transferID, "hashing", processed, source.SizeBytes, "copying and hashing ModelAsset payload")
		}
		return nil
	})
	if err != nil {
		_ = quarantineModelAssetStage(stageDir, err.Error())
		settled = true
		if errors.Is(err, errLocalTransferCancelled) || errors.Is(err, context.Canceled) {
			return nil, errLocalTransferCancelled
		}
		return nil, err
	}
	if len(files) == 0 {
		return nil, errors.New("distribution contains no payload files")
	}
	integrityCheckedAt := nowISO()
	contentID := modelAssetContentID(files)
	catalogMatched := s.modelAssetCatalogMatch(hashes)
	createdAt := nowISO()
	provenance, _ := structpb.NewStruct(map[string]any{
		"source_kind": "local_import", "source_name": filepath.Base(source.Path), "distribution": map[bool]string{true: "directory", false: "single_file"}[source.IsDir],
	})
	fingerprintStruct, _ := structpb.NewStruct(fingerprint)
	duplicate := s.hasModelAssetContent(contentID)
	asset := &runtimev1.ModelAssetRecord{
		ModelAssetId: modelAssetID, ContentId: contentID, DisplayName: source.DisplayName,
		Entry: safeModelAssetEntry(files), Files: files, TotalSizeBytes: total,
		ContentVerified: true, CatalogVerification: runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_NOT_MATCHED,
		Unclassified: unclassified, BoundedFingerprint: fingerprintStruct, Provenance: provenance,
		CreatedAt: createdAt, UpdatedAt: createdAt, LatestIntegrityCheckedAt: integrityCheckedAt,
		DuplicateContent: duplicate, ContainsNonExecutableCode: containsCode,
	}
	if catalogMatched {
		asset.CatalogVerification = runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_MATCHED
	}
	manifest := modelAssetManifestFromRecord(asset)
	manifestPayload, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := writeFileAtomically(filepath.Join(stageDir, localAssetManifestFileName), manifestPayload, 0o600); err != nil {
		return nil, fmt.Errorf("commit ModelAsset manifest: %w", err)
	}
	if err := checkActive(); err != nil {
		return nil, errLocalTransferCancelled
	}
	destination := filepath.Join(resolvedRoot, modelAssetID)
	if err := os.Rename(stageDir, destination); err != nil {
		return nil, fmt.Errorf("activate ModelAsset: %w", err)
	}
	settled = true
	var registered *runtimev1.ModelAssetRecord
	if strings.TrimSpace(transferID) != "" {
		registered, _, err = s.registerModelAssetForTransfer(asset, destination, modelAssetTransferCompletion{
			sessionID: transferID,
			phase:     "register",
			message:   "ModelAsset imported",
		})
	} else {
		registered, _, err = s.registerModelAsset(asset, destination)
	}
	if err != nil {
		failedPath := filepath.Join(quarantineRoot, "register-failed-"+modelAssetID)
		_ = os.Rename(destination, failedPath)
		_ = quarantineModelAssetStage(failedPath, err.Error())
		return nil, fmt.Errorf("persist ModelAsset inventory: %w", err)
	}
	s.cacheVerifiedModelAssetGeneration(registered, destination, stageDir)
	return cloneModelAsset(registered), nil
}

func (s *Service) copyModelAssetDistribution(ctx context.Context, source modelAssetSource, stageDir string, onProgress func(int64) error) ([]*runtimev1.ModelAssetFile, map[string]string, int64, map[string]any, bool, bool, error) {
	type sourceEntry struct {
		absolute string
		relative string
		identity modelAssetSourceFileIdentity
	}
	entries := make([]sourceEntry, 0)
	if source.IsDir {
		err := filepath.WalkDir(source.Path, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if filepath.Clean(path) == filepath.Clean(source.Path) || entry.IsDir() {
				return nil
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return fmt.Errorf("distribution contains symbolic link %q", path)
			}
			info, err := entry.Info()
			if err != nil {
				return err
			}
			if !info.Mode().IsRegular() {
				return fmt.Errorf("distribution contains non-regular entry %q", path)
			}
			relative, err := filepath.Rel(source.Path, path)
			if err != nil || !safeModelAssetRelativePath(relative) {
				return fmt.Errorf("distribution path escapes source root: %q", path)
			}
			relative = filepath.ToSlash(relative)
			if isModelAssetControlFile(relative) {
				return nil
			}
			identity, err := preflightModelAssetSourceFile(path, info)
			if err != nil {
				return err
			}
			entries = append(entries, sourceEntry{absolute: path, relative: relative, identity: identity})
			return nil
		})
		if err != nil {
			return nil, nil, 0, nil, true, false, err
		}
	} else {
		entries = append(entries, sourceEntry{absolute: source.Path, relative: filepath.Base(source.Path), identity: source.FileIdentity})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].relative < entries[j].relative })
	files := make([]*runtimev1.ModelAssetFile, 0, len(entries))
	hashes := make(map[string]string, len(entries))
	extensions := make(map[string]struct{})
	formats := make(map[string]struct{})
	fileFingerprints := make([]any, 0)
	var processed, total int64
	containsCode := false
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return nil, nil, 0, nil, true, false, err
		}
		target := filepath.Join(stageDir, filepath.FromSlash(entry.relative))
		if !pathWithinBase(stageDir, target, false) {
			return nil, nil, 0, nil, true, false, fmt.Errorf("target path escapes staging: %q", entry.relative)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return nil, nil, 0, nil, true, false, err
		}
		digest, size, err := copyAndHashModelAssetFile(entry.absolute, target, entry.identity, func(delta int64) error {
			processed += delta
			if onProgress != nil {
				return onProgress(processed)
			}
			return nil
		})
		if err != nil {
			return nil, nil, 0, nil, true, false, err
		}
		verifiedInfo, err := os.Lstat(target)
		if err != nil {
			return nil, nil, 0, nil, true, false, fmt.Errorf("inspect copied ModelAsset file %q after hashing: %w", entry.relative, err)
		}
		if !verifiedInfo.Mode().IsRegular() || verifiedInfo.Mode()&os.ModeSymlink != 0 || verifiedInfo.Size() != size {
			return nil, nil, 0, nil, true, false, fmt.Errorf("copied ModelAsset file %q changed after hashing", entry.relative)
		}
		s.recordVerifiedFileSHA256(target, verifiedInfo, digest, "")
		extension := strings.ToLower(filepath.Ext(entry.relative))
		if extension != "" {
			extensions[extension] = struct{}{}
		}
		_, code := modelAssetCodeExtensions[extension]
		containsCode = containsCode || code
		if format, facts := boundedModelAssetFileFingerprint(target, extension); format != "" {
			formats[format] = struct{}{}
			fileFingerprint := map[string]any{"relative_path": entry.relative, "format": format}
			for key, value := range facts {
				fileFingerprint[key] = value
			}
			fileFingerprints = append(fileFingerprints, fileFingerprint)
		}
		files = append(files, &runtimev1.ModelAssetFile{RelativePath: entry.relative, Sha256: digest, SizeBytes: size, NonExecutableContent: code})
		hashes[entry.relative] = digest
		total += size
	}
	extensionList := sortedStringSet(extensions)
	formatList := sortedStringSet(formats)
	fingerprint := map[string]any{"file_count": len(files), "extensions": extensionList, "formats": formatList}
	if len(fileFingerprints) > 0 {
		fingerprint["file_fingerprints"] = fileFingerprints
	}
	return files, hashes, total, fingerprint, len(formatList) == 0, containsCode, nil
}

func copyAndHashModelAssetFile(sourcePath string, destinationPath string, expectedIdentity modelAssetSourceFileIdentity, onProgress func(int64) error) (digest string, bytesCopied int64, resultErr error) {
	source, err := openVerifiedModelAssetSourceFile(sourcePath, expectedIdentity)
	if err != nil {
		return "", 0, err
	}
	sourceClosed := false
	defer func() {
		if sourceClosed {
			return
		}
		if err := source.Close(); resultErr == nil && err != nil {
			digest = ""
			resultErr = fmt.Errorf("close ModelAsset source file: %w", err)
		}
	}()
	destination, err := os.OpenFile(destinationPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return "", 0, err
	}
	keep := false
	defer func() {
		_ = destination.Close()
		if !keep {
			_ = os.Remove(destinationPath)
		}
	}()
	hasher := sha256.New()
	buffer := make([]byte, 4*1024*1024)
	var total int64
	for {
		count, readErr := source.Read(buffer)
		if count > 0 {
			if _, err := destination.Write(buffer[:count]); err != nil {
				return "", total, err
			}
			_, _ = hasher.Write(buffer[:count])
			total += int64(count)
			if onProgress != nil {
				if err := onProgress(int64(count)); err != nil {
					return "", total, err
				}
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return "", total, readErr
		}
	}
	if err := destination.Sync(); err != nil {
		return "", total, err
	}
	if err := destination.Close(); err != nil {
		return "", total, err
	}
	if err := source.Close(); err != nil {
		return "", total, fmt.Errorf("close ModelAsset source file: %w", err)
	}
	sourceClosed = true
	keep = true
	return hex.EncodeToString(hasher.Sum(nil)), total, nil
}

func safeModelAssetRelativePath(path string) bool {
	value := filepath.Clean(strings.TrimSpace(path))
	return value != "." && value != "" && !filepath.IsAbs(value) && value != ".." && !strings.HasPrefix(value, ".."+string(filepath.Separator))
}

func isModelAssetControlFile(relativePath string) bool {
	relative := filepath.ToSlash(strings.TrimSpace(relativePath))
	return relative == localAssetManifestFileName || strings.EqualFold(filepath.Base(relative), "quarantine.manifest.json")
}

func boundedModelAssetFileFingerprint(path string, extension string) (string, map[string]any) {
	switch extension {
	case ".gguf":
		file, err := os.Open(path)
		if err != nil {
			return "", nil
		}
		defer func() { _ = file.Close() }()
		summary, err := ggufmeta.Inspect(io.LimitReader(file, modelAssetFingerprintReadLimit))
		if err != nil {
			return "", nil
		}
		metadata := make([]any, 0, min(len(summary.Entries), modelAssetFingerprintItemLimit))
		for _, entry := range summary.Entries {
			if len(metadata) >= modelAssetFingerprintItemLimit {
				break
			}
			fact := map[string]any{"key": entry.Key, "value_type": int(entry.Type)}
			if entry.HasStringValue {
				fact["string_value"] = boundedModelAssetFingerprintString(entry.StringValue)
			}
			if entry.HasUint64Value {
				fact["uint64_value"] = fmt.Sprintf("%d", entry.Uint64Value)
			}
			metadata = append(metadata, fact)
		}
		tensorNames := make([]any, 0, min(len(summary.TensorNames), modelAssetFingerprintItemLimit))
		for _, name := range summary.TensorNames {
			if len(tensorNames) >= modelAssetFingerprintItemLimit {
				break
			}
			tensorNames = append(tensorNames, boundedModelAssetFingerprintString(name))
		}
		return "gguf", map[string]any{
			"version":            int(summary.Version),
			"tensor_count":       fmt.Sprintf("%d", summary.TensorCount),
			"metadata_count":     fmt.Sprintf("%d", summary.KVCount),
			"metadata":           metadata,
			"tensor_names":       tensorNames,
			"metadata_truncated": len(summary.Entries) > len(metadata),
			"tensors_truncated":  len(summary.TensorNames) > len(tensorNames),
		}
	case ".safetensors":
		file, err := os.Open(path)
		if err != nil {
			return "", nil
		}
		defer func() { _ = file.Close() }()
		lengthPrefix := make([]byte, 8)
		if _, err := io.ReadFull(file, lengthPrefix); err != nil {
			return "", nil
		}
		headerLength := binary.LittleEndian.Uint64(lengthPrefix)
		if headerLength < 2 || headerLength > uint64(modelAssetFingerprintReadLimit-8) {
			return "", nil
		}
		header := make([]byte, int(headerLength))
		if _, err := io.ReadFull(file, header); err != nil {
			return "", nil
		}
		var rows map[string]json.RawMessage
		if err := json.Unmarshal(header, &rows); err != nil || len(rows) == 0 {
			return "", nil
		}
		tensorNames := make([]string, 0, len(rows))
		metadataKeys := make([]string, 0)
		for name, raw := range rows {
			if name == "__metadata__" {
				var metadata map[string]json.RawMessage
				if json.Unmarshal(raw, &metadata) != nil {
					return "", nil
				}
				for key := range metadata {
					metadataKeys = append(metadataKeys, key)
				}
				continue
			}
			var tensor struct {
				DType       string        `json:"dtype"`
				Shape       []json.Number `json:"shape"`
				DataOffsets []json.Number `json:"data_offsets"`
			}
			if json.Unmarshal(raw, &tensor) != nil || strings.TrimSpace(tensor.DType) == "" || tensor.Shape == nil || len(tensor.DataOffsets) != 2 {
				return "", nil
			}
			tensorNames = append(tensorNames, name)
		}
		if len(tensorNames) == 0 {
			return "", nil
		}
		sort.Strings(tensorNames)
		sort.Strings(metadataKeys)
		tensors := make([]any, 0, min(len(tensorNames), modelAssetFingerprintItemLimit))
		for _, name := range tensorNames {
			if len(tensors) >= modelAssetFingerprintItemLimit {
				break
			}
			var tensor struct {
				DType string        `json:"dtype"`
				Shape []json.Number `json:"shape"`
			}
			if err := json.Unmarshal(rows[name], &tensor); err != nil {
				return "", nil
			}
			shape := make([]any, 0, len(tensor.Shape))
			for _, dimension := range tensor.Shape {
				shape = append(shape, dimension.String())
			}
			tensors = append(tensors, map[string]any{
				"name":  boundedModelAssetFingerprintString(name),
				"dtype": boundedModelAssetFingerprintString(tensor.DType),
				"shape": shape,
			})
		}
		metadata := make([]any, 0, min(len(metadataKeys), modelAssetFingerprintItemLimit))
		for _, key := range metadataKeys {
			if len(metadata) >= modelAssetFingerprintItemLimit {
				break
			}
			metadata = append(metadata, boundedModelAssetFingerprintString(key))
		}
		return "safetensors", map[string]any{
			"header_size_bytes":  fmt.Sprintf("%d", headerLength),
			"tensor_count":       len(tensorNames),
			"tensors":            tensors,
			"metadata_keys":      metadata,
			"tensors_truncated":  len(tensorNames) > len(tensors),
			"metadata_truncated": len(metadataKeys) > len(metadata),
		}
	default:
		return "", nil
	}
}

func boundedModelAssetFingerprintString(value string) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= modelAssetFingerprintStringLimit {
		return string(runes)
	}
	return string(runes[:modelAssetFingerprintStringLimit])
}

func sortedStringSet(values map[string]struct{}) []any {
	items := make([]string, 0, len(values))
	for value := range values {
		items = append(items, value)
	}
	sort.Strings(items)
	result := make([]any, 0, len(items))
	for _, item := range items {
		result = append(result, item)
	}
	return result
}

func safeModelAssetEntry(files []*runtimev1.ModelAssetFile) string {
	for _, file := range files {
		if file == nil || file.GetNonExecutableContent() {
			continue
		}
		switch strings.ToLower(filepath.Ext(file.GetRelativePath())) {
		case ".gguf", ".safetensors":
			return file.GetRelativePath()
		}
	}
	for _, file := range files {
		if file != nil && !file.GetNonExecutableContent() {
			return file.GetRelativePath()
		}
	}
	if len(files) > 0 && files[0] != nil {
		return files[0].GetRelativePath()
	}
	return ""
}

func modelAssetContentID(files []*runtimev1.ModelAssetFile) string {
	ordered := append([]*runtimev1.ModelAssetFile(nil), files...)
	sort.Slice(ordered, func(i, j int) bool {
		return ordered[i].GetRelativePath() < ordered[j].GetRelativePath()
	})
	if len(ordered) == 1 {
		return normalizeVerifiedContentID(ordered[0].GetSha256())
	}
	hasher := sha256.New()
	for _, file := range ordered {
		digest, err := hex.DecodeString(strings.TrimPrefix(strings.ToLower(strings.TrimSpace(file.GetSha256())), "sha256:"))
		if err != nil || len(digest) != sha256.Size {
			continue
		}
		_, _ = hasher.Write(digest)
	}
	return "sha256:" + hex.EncodeToString(hasher.Sum(nil))
}

func modelAssetManifestFromRecord(asset *runtimev1.ModelAssetRecord) modelAssetManifest {
	files := make([]modelAssetManifestFile, 0, len(asset.GetFiles()))
	for _, file := range asset.GetFiles() {
		files = append(files, modelAssetManifestFile{RelativePath: file.GetRelativePath(), SHA256: file.GetSha256(), SizeBytes: file.GetSizeBytes(), NonExecutableContent: file.GetNonExecutableContent()})
	}
	return modelAssetManifest{
		SchemaVersion: modelAssetManifestSchemaVersion, ModelAssetID: asset.GetModelAssetId(), ContentID: asset.GetContentId(),
		DisplayName: asset.GetDisplayName(), Entry: asset.GetEntry(), Files: files, TotalSizeBytes: asset.GetTotalSizeBytes(),
		ContentVerified: asset.GetContentVerified(), CatalogVerified: asset.GetCatalogVerification() == runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_MATCHED,
		BoundedFingerprint: structToMap(asset.GetBoundedFingerprint()), Provenance: structToMap(asset.GetProvenance()),
		ContainsNonExecutableCode: asset.GetContainsNonExecutableCode(), CreatedAt: asset.GetCreatedAt(),
	}
}

func quarantineModelAssetStage(stageDir string, reason string) error {
	if strings.TrimSpace(stageDir) == "" {
		return nil
	}
	payload, _ := json.MarshalIndent(map[string]any{"reason": strings.TrimSpace(reason), "quarantined_at": nowISO()}, "", "  ")
	return writeFileAtomically(filepath.Join(stageDir, "quarantine.manifest.json"), payload, 0o600)
}

func (s *Service) modelAssetCatalogMatch(hashes map[string]string) bool {
	s.mu.RLock()
	verified := append([]*runtimev1.LocalVerifiedAssetDescriptor(nil), s.verified...)
	s.mu.RUnlock()
	return resolvedPayloadCatalogHit(hashes, verified)
}

func (s *Service) hasModelAssetContent(contentID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, asset := range s.modelAssets {
		if asset != nil && asset.GetContentId() == contentID {
			return true
		}
	}
	return false
}

func cloneModelAsset(asset *runtimev1.ModelAssetRecord) *runtimev1.ModelAssetRecord {
	if asset == nil {
		return nil
	}
	return proto.Clone(asset).(*runtimev1.ModelAssetRecord)
}

func (s *Service) registerModelAsset(asset *runtimev1.ModelAssetRecord, managedDirectory string) (*runtimev1.ModelAssetRecord, bool, error) {
	return s.registerModelAssetWithPrecommit(asset, managedDirectory, nil)
}

func (s *Service) registerModelAssetWithPrecommit(asset *runtimev1.ModelAssetRecord, managedDirectory string, precommit func() error) (*runtimev1.ModelAssetRecord, bool, error) {
	return s.registerModelAssetWithPrecommitAndTransfer(asset, managedDirectory, precommit, nil)
}

type modelAssetTransferCompletion struct {
	sessionID string
	phase     string
	message   string
}

func (s *Service) registerModelAssetForTransfer(
	asset *runtimev1.ModelAssetRecord,
	managedDirectory string,
	completion modelAssetTransferCompletion,
) (*runtimev1.ModelAssetRecord, bool, error) {
	return s.registerModelAssetWithPrecommitAndTransfer(asset, managedDirectory, nil, &completion)
}

func (s *Service) registerModelAssetWithPrecommitAndTransfer(
	asset *runtimev1.ModelAssetRecord,
	managedDirectory string,
	precommit func() error,
	completion *modelAssetTransferCompletion,
) (*runtimev1.ModelAssetRecord, bool, error) {
	if asset == nil || strings.TrimSpace(asset.GetModelAssetId()) == "" {
		return nil, false, errors.New("ModelAsset identity is required")
	}
	if !s.validModelAssetManagedDirectory(managedDirectory) {
		return nil, false, errors.New("ModelAsset managed directory must stay under the Runtime resolved models root")
	}
	cleanDirectory := filepath.Clean(managedDirectory)
	id := asset.GetModelAssetId()

	s.modelAssetMutationMu.Lock()
	defer s.modelAssetMutationMu.Unlock()

	s.mu.RLock()
	existing, directoryExists := s.modelAssetForManagedDirectoryLocked(cleanDirectory)
	_, idExists := s.modelAssets[id]
	s.mu.RUnlock()
	if directoryExists {
		if existing == nil {
			return nil, false, fmt.Errorf("ModelAsset managed directory %q has an unavailable registration", cleanDirectory)
		}
		if completion != nil {
			if err := s.completeTransfer(completion.sessionID, completion.phase, completion.message, func(summary *runtimev1.LocalTransferSessionSummary) {
				summary.AssetId = existing.GetModelAssetId()
			}); err != nil {
				return nil, false, err
			}
		}
		return existing, true, nil
	}
	if idExists {
		return nil, false, fmt.Errorf("ModelAsset %q already exists", id)
	}
	if precommit != nil {
		if err := precommit(); err != nil {
			return nil, false, err
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.modelAssets == nil {
		s.modelAssets = make(map[string]*runtimev1.ModelAssetRecord)
	}
	if s.modelAssetDirectories == nil {
		s.modelAssetDirectories = make(map[string]string)
	}
	if existing, directoryExists := s.modelAssetForManagedDirectoryLocked(cleanDirectory); directoryExists {
		if existing == nil {
			return nil, false, fmt.Errorf("ModelAsset managed directory %q has an unavailable registration", cleanDirectory)
		}
		return existing, true, nil
	}
	if _, exists := s.modelAssets[id]; exists {
		return nil, false, fmt.Errorf("ModelAsset %q already exists", id)
	}
	s.modelAssets[id] = cloneModelAsset(asset)
	s.modelAssetDirectories[id] = cleanDirectory
	previousCleanup := s.terminalizeCleanupObligationsForDirectoryLocked(cleanDirectory, id)
	var stagedCompletion *stagedTransferCompletion
	if completion != nil {
		stagedCompletion = s.stageTransferCompletionLocked(completion.sessionID, completion.phase, completion.message, func(summary *runtimev1.LocalTransferSessionSummary) {
			summary.AssetId = id
		})
		if stagedCompletion == nil || !stagedCompletion.changed {
			delete(s.modelAssets, id)
			delete(s.modelAssetDirectories, id)
			for cleanupID, obligation := range previousCleanup {
				s.modelAssetCleanupObligations[cleanupID] = obligation
			}
			return nil, false, errLocalTransferCancelled
		}
	}
	if err := s.persistModelAssetStoreLocked(); err != nil {
		stagedCompletion.rollbackLocked(s)
		delete(s.modelAssets, id)
		delete(s.modelAssetDirectories, id)
		for cleanupID, obligation := range previousCleanup {
			s.modelAssetCleanupObligations[cleanupID] = obligation
		}
		return nil, false, err
	}
	if stagedCompletion != nil {
		if err := s.persistStateLocked(); err != nil {
			stagedCompletion.rollbackLocked(s)
			delete(s.modelAssets, id)
			delete(s.modelAssetDirectories, id)
			for cleanupID, obligation := range previousCleanup {
				s.modelAssetCleanupObligations[cleanupID] = obligation
			}
			if rollbackErr := s.persistModelAssetStoreLocked(); rollbackErr != nil {
				return nil, false, localTransferPersistenceError(fmt.Errorf("persist transfer completion: %w; rollback ModelAsset inventory: %v", err, rollbackErr))
			}
			return nil, false, localTransferPersistenceError(err)
		}
		s.publishTransferEventLocked(localTransferEventFromSummary(stagedCompletion.current))
	}
	return cloneModelAsset(asset), false, nil
}

func (s *Service) modelAssetForManagedDirectoryLocked(managedDirectory string) (*runtimev1.ModelAssetRecord, bool) {
	canonicalDirectory := canonicalReportPath(managedDirectory)
	for id, existingDirectory := range s.modelAssetDirectories {
		if canonicalReportPath(existingDirectory) == canonicalDirectory {
			return cloneModelAsset(s.modelAssets[id]), true
		}
	}
	return nil, false
}

func (s *Service) replaceModelAssetRegistrationIdentity(replacedModelAssetID string, asset *runtimev1.ModelAssetRecord, managedDirectory string) error {
	if asset == nil {
		return errors.New("replacement requires distinct ModelAsset identities and a managed directory")
	}
	oldID := strings.TrimSpace(replacedModelAssetID)
	newID := strings.TrimSpace(asset.GetModelAssetId())
	if oldID == "" || newID == "" || oldID == newID || !s.validModelAssetManagedDirectory(managedDirectory) {
		return errors.New("replacement requires distinct ModelAsset identities and a managed directory")
	}
	s.modelAssetMutationMu.Lock()
	defer s.modelAssetMutationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	before := cloneModelAsset(s.modelAssets[oldID])
	beforeDirectory := s.modelAssetDirectories[oldID]
	if before == nil {
		return fmt.Errorf("ModelAsset %q does not exist", oldID)
	}
	if s.modelAssets[newID] != nil {
		return fmt.Errorf("ModelAsset %q already exists", newID)
	}
	delete(s.modelAssets, oldID)
	delete(s.modelAssetDirectories, oldID)
	s.modelAssets[newID] = cloneModelAsset(asset)
	s.modelAssetDirectories[newID] = filepath.Clean(managedDirectory)
	if err := s.persistModelAssetStoreLocked(); err != nil {
		delete(s.modelAssets, newID)
		delete(s.modelAssetDirectories, newID)
		s.modelAssets[oldID] = before
		s.modelAssetDirectories[oldID] = beforeDirectory
		return err
	}
	return nil
}

func (s *Service) ListModelAssets(_ context.Context, req *runtimev1.ListModelAssetsRequest) (*runtimev1.ListModelAssetsResponse, error) {
	s.mu.RLock()
	assets := make([]*runtimev1.ModelAssetRecord, 0, len(s.modelAssets))
	for _, asset := range s.modelAssets {
		assets = append(assets, cloneModelAsset(asset))
	}
	s.mu.RUnlock()
	sort.Slice(assets, func(i, j int) bool { return assets[i].GetModelAssetId() < assets[j].GetModelAssetId() })
	start, end, next, err := resolvePageBounds(req.GetPageToken(), pagination.FilterDigest("model-assets"), req.GetPageSize(), 50, 200, len(assets))
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListModelAssetsResponse{Assets: assets[start:end], NextPageToken: next}, nil
}

func (s *Service) GetModelAsset(_ context.Context, req *runtimev1.GetModelAssetRequest) (*runtimev1.GetModelAssetResponse, error) {
	id := strings.TrimSpace(req.GetModelAssetId())
	if id == "" {
		return nil, status.Error(codes.InvalidArgument, "model_asset_id is required")
	}
	s.mu.RLock()
	asset := cloneModelAsset(s.modelAssets[id])
	s.mu.RUnlock()
	if asset == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_ASSET_NOT_FOUND)
	}
	return &runtimev1.GetModelAssetResponse{Asset: asset}, nil
}

func (s *Service) RemoveModelAsset(_ context.Context, req *runtimev1.RemoveModelAssetRequest) (*runtimev1.RemoveModelAssetResponse, error) {
	id := strings.TrimSpace(req.GetModelAssetId())
	if id == "" {
		return nil, status.Error(codes.InvalidArgument, "model_asset_id is required")
	}
	s.modelAssetMutationMu.Lock()
	defer s.modelAssetMutationMu.Unlock()
	s.mu.Lock()
	asset := cloneModelAsset(s.modelAssets[id])
	if asset == nil {
		s.mu.Unlock()
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_ASSET_NOT_FOUND)
	}
	references := s.modelAssetReferenceIDsLocked(id)
	if !req.GetForce() {
		s.mu.Unlock()
		return &runtimev1.RemoveModelAssetResponse{Asset: asset, ReferencingLoadoutIds: references, ConfirmationRequired: true}, nil
	}
	directory := s.modelAssetDirectories[id]
	obligation := modelAssetCleanupObligation{
		ModelAssetID: id, ContentID: asset.GetContentId(), Generation: strings.TrimSpace(asset.GetCreatedAt()),
		ManagedDirectory: directory, Reason: "ModelAsset removed", CreatedAt: nowISO(), UpdatedAt: nowISO(),
	}
	delete(s.modelAssets, id)
	delete(s.modelAssetDirectories, id)
	if s.modelAssetCleanupObligations == nil {
		s.modelAssetCleanupObligations = make(map[string]modelAssetCleanupObligation)
	}
	s.modelAssetCleanupObligations[id] = obligation
	if err := s.persistModelAssetStoreLocked(); err != nil {
		s.modelAssets[id] = asset
		s.modelAssetDirectories[id] = directory
		delete(s.modelAssetCleanupObligations, id)
		s.mu.Unlock()
		return nil, grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_PERSISTENCE_UNAVAILABLE, err, grpcerr.ReasonOptions{Message: "ModelAsset removal could not be committed"})
	}
	s.mu.Unlock()

	cleanupPending := !s.completeModelAssetCleanupLocked(id)
	return &runtimev1.RemoveModelAssetResponse{Asset: asset, ReferencingLoadoutIds: references, CleanupPending: cleanupPending}, nil
}

func (s *Service) modelAssetReferenceIDsLocked(modelAssetID string) []string {
	seen := make(map[string]struct{})
	for id, loadout := range s.loadouts {
		if loadout == nil {
			continue
		}
		for _, axis := range loadout.GetModelAxes() {
			if strings.TrimSpace(axis.GetModelAssetId()) == modelAssetID {
				seen[id] = struct{}{}
				break
			}
		}
	}
	ids := make([]string, 0, len(seen))
	for id := range seen {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func (s *Service) completeModelAssetCleanup(modelAssetID string) bool {
	s.modelAssetMutationMu.Lock()
	defer s.modelAssetMutationMu.Unlock()
	return s.completeModelAssetCleanupLocked(modelAssetID)
}

func (s *Service) completeModelAssetCleanupLocked(modelAssetID string) bool {
	s.mu.RLock()
	obligation, exists := s.modelAssetCleanupObligations[modelAssetID]
	liveOwnerID := ""
	for id, directory := range s.modelAssetDirectories {
		if canonicalReportPath(directory) == canonicalReportPath(obligation.ManagedDirectory) && s.modelAssets[id] != nil {
			liveOwnerID = id
			break
		}
	}
	s.mu.RUnlock()
	if !exists || obligation.Terminal {
		return true
	}
	if liveOwnerID != "" {
		return s.terminalizeModelAssetCleanupLocked(modelAssetID, modelAssetCleanupOwnerChangedReason, fmt.Sprintf("managed directory is now owned by ModelAsset %s", liveOwnerID))
	}
	if err := s.verifyModelAssetCleanupGeneration(obligation); err != nil {
		return s.terminalizeModelAssetCleanupLocked(modelAssetID, modelAssetCleanupGenerationChangedReason, err.Error())
	}
	removeDirectory := s.removeModelAssetDirectory
	if removeDirectory == nil {
		removeDirectory = os.RemoveAll
	}
	if err := removeDirectory(obligation.ManagedDirectory); err != nil {
		s.mu.Lock()
		current := s.modelAssetCleanupObligations[modelAssetID]
		current.Attempts++
		current.UpdatedAt = nowISO()
		s.modelAssetCleanupObligations[modelAssetID] = current
		_ = s.persistModelAssetStoreLocked()
		s.mu.Unlock()
		return false
	}
	s.mu.Lock()
	delete(s.modelAssetCleanupObligations, modelAssetID)
	err := s.persistModelAssetStoreLocked()
	if err != nil {
		s.modelAssetCleanupObligations[modelAssetID] = obligation
	}
	s.mu.Unlock()
	return err == nil
}

func (s *Service) verifyModelAssetCleanupGeneration(obligation modelAssetCleanupObligation) error {
	if !s.validModelAssetManagedDirectory(obligation.ManagedDirectory) || strings.TrimSpace(obligation.ContentID) == "" || strings.TrimSpace(obligation.Generation) == "" {
		return errors.New("cleanup generation identity is incomplete")
	}
	manifestPath := filepath.Join(obligation.ManagedDirectory, localAssetManifestFileName)
	payload, err := os.ReadFile(manifestPath)
	if err != nil {
		return fmt.Errorf("read cleanup generation manifest: %w", err)
	}
	var manifest modelAssetManifest
	if err := decodeStrictJSON(payload, &manifest); err != nil {
		return fmt.Errorf("decode cleanup generation manifest: %w", err)
	}
	if strings.TrimSpace(manifest.ModelAssetID) != strings.TrimSpace(obligation.ModelAssetID) ||
		strings.TrimSpace(manifest.ContentID) != strings.TrimSpace(obligation.ContentID) ||
		strings.TrimSpace(manifest.CreatedAt) != strings.TrimSpace(obligation.Generation) {
		return errors.New("cleanup generation manifest no longer matches the removed ModelAsset")
	}
	files, _, _, _, _, err := s.hashResolvedPayloadDetailed(context.Background(), obligation.ManagedDirectory)
	if err != nil {
		return fmt.Errorf("verify cleanup generation content: %w", err)
	}
	if modelAssetContentID(files) != strings.TrimSpace(obligation.ContentID) {
		return errors.New("cleanup generation content no longer matches the removed ModelAsset")
	}
	return nil
}

func (s *Service) terminalizeModelAssetCleanupLocked(modelAssetID string, reasonCode string, detail string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	before, exists := s.modelAssetCleanupObligations[modelAssetID]
	if !exists || before.Terminal {
		return true
	}
	current := before
	current.Terminal = true
	current.TerminalReason = strings.TrimSpace(reasonCode)
	current.Reason = strings.TrimSpace(detail)
	current.UpdatedAt = nowISO()
	s.modelAssetCleanupObligations[modelAssetID] = current
	if err := s.persistModelAssetStoreLocked(); err != nil {
		s.modelAssetCleanupObligations[modelAssetID] = before
		return false
	}
	return true
}

func (s *Service) terminalizeCleanupObligationsForDirectoryLocked(managedDirectory string, ownerID string) map[string]modelAssetCleanupObligation {
	previous := make(map[string]modelAssetCleanupObligation)
	for id, obligation := range s.modelAssetCleanupObligations {
		if obligation.Terminal || canonicalReportPath(obligation.ManagedDirectory) != canonicalReportPath(managedDirectory) {
			continue
		}
		previous[id] = obligation
		obligation.Terminal = true
		obligation.TerminalReason = modelAssetCleanupOwnerChangedReason
		obligation.Reason = fmt.Sprintf("managed directory is now owned by ModelAsset %s", ownerID)
		obligation.UpdatedAt = nowISO()
		s.modelAssetCleanupObligations[id] = obligation
	}
	return previous
}

func (s *Service) validModelAssetManagedDirectory(directory string) bool {
	return modelAssetManagedDirectoryWithinRoot(s.resolvedLocalModelsPath(), directory)
}

func modelAssetManagedDirectoryWithinRoot(modelsRoot string, directory string) bool {
	root := filepath.Join(resolveLocalModelsPath(modelsRoot), "resolved")
	absoluteRoot, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	absoluteDirectory, err := filepath.Abs(filepath.Clean(strings.TrimSpace(directory)))
	return err == nil && pathWithinBase(absoluteRoot, absoluteDirectory, false)
}

func (s *Service) retryModelAssetCleanupObligations() {
	s.mu.RLock()
	ids := make([]string, 0, len(s.modelAssetCleanupObligations))
	for id := range s.modelAssetCleanupObligations {
		if _, pending := s.modelAssetPendingCleanupRebases[id]; pending {
			continue
		}
		ids = append(ids, id)
	}
	s.mu.RUnlock()
	for _, id := range ids {
		_ = s.completeModelAssetCleanup(id)
	}
}

func (s *Service) persistModelAssetStoreLocked() error {
	if len(s.modelAssetPendingDirectoryRebases) > 0 || len(s.modelAssetPendingCleanupRebases) > 0 {
		return errors.New("ModelAsset store requires Check & Sync reconciliation before mutation")
	}
	snapshot, err := buildModelAssetStoreSnapshot(s.modelAssets, s.modelAssetDirectories, s.modelAssetCleanupObligations, s.localModelsPath)
	if err != nil {
		return err
	}
	snapshot.retainedRecords = cloneQuarantinedStateRecords(s.modelAssetRetainedRecords)
	save := s.saveModelAssetStore
	if save == nil {
		save = saveModelAssetStore
	}
	return save(s.modelAssetStorePath, snapshot)
}

func (s *Service) restoreModelAssetStore() error {
	decoded, err := loadModelAssetStore(s.modelAssetStorePath, s.localModelsPathSnapshot())
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.modelAssets = decoded.Assets
	s.modelAssetDirectories = decoded.Directories
	s.modelAssetCleanupObligations = decoded.CleanupObligations
	s.modelAssetPendingDirectoryRebases = decoded.PendingDirectoryRebases
	s.modelAssetPendingCleanupRebases = decoded.PendingCleanupRebases
	s.modelAssetRetainedRecords = cloneQuarantinedStateRecords(decoded.retainedRecords)
	s.recordStartupStateIsolationDiagnostics(decoded.Diagnostics)
	if decoded.RewriteRequired && len(decoded.PendingDirectoryRebases) == 0 && len(decoded.PendingCleanupRebases) == 0 {
		err = s.persistModelAssetStoreLocked()
	}
	s.mu.Unlock()
	if err != nil {
		return err
	}
	for id, asset := range decoded.Assets {
		directory := decoded.Directories[id]
		if pending, ok := decoded.PendingDirectoryRebases[id]; ok {
			directory = pending
		}
		s.restoreVerifiedModelAssetGeneration(asset, directory)
	}
	s.retryModelAssetCleanupObligations()
	return nil
}

type modelAssetAdoptionOptions struct {
	displayName         string
	preferredEntry      string
	provenance          map[string]any
	expectedHashes      map[string]string
	replaceModelAssetID string
	transferCompletion  *modelAssetTransferCompletion
}

func (s *Service) resolvedLocalModelsPath() string {
	return resolveLocalModelsPath(s.localModelsPathSnapshot())
}

func (s *Service) localModelsPathSnapshot() string {
	s.mu.RLock()
	configured := s.localModelsPath
	s.mu.RUnlock()
	return configured
}

func computeImportFileSHA256(path string) (string, error) {
	return computeFileSHA256(path)
}

func (s *Service) adoptResolvedModelAssetDirectory(ctx context.Context, directory string, displayName string) (*runtimev1.ModelAssetRecord, bool, error) {
	return s.adoptResolvedModelAssetDirectoryWithOptions(ctx, directory, modelAssetAdoptionOptions{displayName: displayName})
}

// @nimi-authority: rule.nimi.runtime.local-compute.r009
// @nimi-authority: rule.nimi.runtime.local-compute.r014
func (s *Service) adoptResolvedModelAssetDirectoryWithOptions(ctx context.Context, directory string, options modelAssetAdoptionOptions) (*runtimev1.ModelAssetRecord, bool, error) {
	absolute, err := filepath.Abs(filepath.Clean(directory))
	if err != nil || !s.validModelAssetManagedDirectory(absolute) {
		return nil, false, errors.New("adoption directory must stay under resolved/")
	}
	s.mu.RLock()
	for id, existing := range s.modelAssetDirectories {
		if canonicalReportPath(existing) == canonicalReportPath(absolute) {
			asset := cloneModelAsset(s.modelAssets[id])
			s.mu.RUnlock()
			if options.transferCompletion != nil {
				if err := s.completeTransfer(options.transferCompletion.sessionID, options.transferCompletion.phase, options.transferCompletion.message, func(summary *runtimev1.LocalTransferSessionSummary) {
					summary.AssetId = asset.GetModelAssetId()
				}); err != nil {
					return nil, false, err
				}
			}
			s.cacheVerifiedModelAssetGeneration(asset, absolute)
			return asset, true, nil
		}
	}
	s.mu.RUnlock()
	info, err := os.Lstat(absolute)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, false, errors.New("adoption directory is not a safe distribution directory")
	}
	files, hashes, total, fingerprint, unclassified, err := s.hashResolvedPayloadDetailed(ctx, absolute)
	if err != nil {
		return nil, false, err
	}
	if len(files) == 0 {
		return nil, false, errors.New("adoption directory contains no payload files")
	}
	integrityCheckedAt := nowISO()
	modelAssetID := "model_" + strings.ToLower(ulid.Make().String())
	createdAt := nowISO()
	if replaceID := strings.TrimSpace(options.replaceModelAssetID); replaceID != "" {
		s.mu.RLock()
		existing := cloneModelAsset(s.modelAssets[replaceID])
		s.mu.RUnlock()
		if existing == nil {
			return nil, false, fmt.Errorf("ModelAsset %q is unavailable for replacement", replaceID)
		}
	}
	contentID := modelAssetContentID(files)
	name := strings.TrimSpace(options.displayName)
	if name == "" {
		name = filepath.Base(absolute)
	}
	entry := safeModelAssetEntry(files)
	if preferred := filepath.ToSlash(strings.TrimSpace(options.preferredEntry)); preferred != "" {
		found := false
		for _, file := range files {
			if file.GetRelativePath() == preferred {
				entry = preferred
				found = true
				break
			}
		}
		if !found {
			return nil, false, fmt.Errorf("preferred ModelAsset entry %q is not in the verified distribution", preferred)
		}
	}
	catalogMatched := s.modelAssetCatalogMatch(hashes)
	if len(options.expectedHashes) > 0 && !equalResolvedPayloadHashes(hashes, options.expectedHashes) {
		return nil, false, errors.New("resolved ModelAsset distribution does not match the protected acquisition plan")
	}
	fingerprintStruct, _ := structpb.NewStruct(fingerprint)
	provenanceFacts := options.provenance
	if len(provenanceFacts) == 0 {
		provenanceFacts = map[string]any{"source_kind": "in_place_adoption", "source_name": filepath.Base(absolute), "distribution": "directory"}
	}
	provenance, _ := structpb.NewStruct(provenanceFacts)
	containsCode := false
	for _, file := range files {
		containsCode = containsCode || file.GetNonExecutableContent()
	}
	asset := &runtimev1.ModelAssetRecord{ModelAssetId: modelAssetID, ContentId: contentID, DisplayName: name, Entry: entry, Files: files, TotalSizeBytes: total, ContentVerified: true, CatalogVerification: runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_NOT_MATCHED, Unclassified: unclassified, BoundedFingerprint: fingerprintStruct, Provenance: provenance, CreatedAt: createdAt, UpdatedAt: createdAt, LatestIntegrityCheckedAt: integrityCheckedAt, DuplicateContent: s.hasModelAssetContent(contentID), ContainsNonExecutableCode: containsCode}
	if catalogMatched {
		asset.CatalogVerification = runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_MATCHED
	}
	manifestPayload, err := json.MarshalIndent(modelAssetManifestFromRecord(asset), "", "  ")
	if err != nil {
		return nil, false, err
	}
	writeManifest := s.writeModelAssetManifest
	if writeManifest == nil {
		writeManifest = func(path string, payload []byte) error { return writeFileAtomically(path, payload, 0o600) }
	}
	manifestPath := filepath.Join(absolute, localAssetManifestFileName)
	if replaceID := strings.TrimSpace(options.replaceModelAssetID); replaceID != "" {
		if err := writeManifest(manifestPath, manifestPayload); err != nil {
			return nil, false, err
		}
		if err := s.replaceModelAssetRegistrationIdentity(replaceID, asset, absolute); err != nil {
			return nil, false, err
		}
		s.cacheVerifiedModelAssetGeneration(asset, absolute)
		return cloneModelAsset(asset), false, nil
	}
	registered, skipped, err := s.registerModelAssetWithPrecommitAndTransfer(asset, absolute, func() error {
		return writeManifest(manifestPath, manifestPayload)
	}, options.transferCompletion)
	if err != nil {
		return nil, false, err
	}
	registeredDirectory := absolute
	if skipped {
		s.mu.RLock()
		registeredDirectory = s.modelAssetDirectories[registered.GetModelAssetId()]
		s.mu.RUnlock()
	}
	s.cacheVerifiedModelAssetGeneration(registered, registeredDirectory)
	return cloneModelAsset(registered), skipped, nil
}

func (s *Service) hashResolvedPayloadDetailed(ctx context.Context, directory string) ([]*runtimev1.ModelAssetFile, map[string]string, int64, map[string]any, bool, error) {
	paths := make([]string, 0)
	err := filepath.WalkDir(directory, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if filepath.Clean(path) == filepath.Clean(directory) || entry.IsDir() {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("payload contains symlink %q", path)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("payload contains non-regular entry %q", path)
		}
		relative, err := filepath.Rel(directory, path)
		if err != nil || !safeModelAssetRelativePath(relative) {
			return fmt.Errorf("payload path escapes directory")
		}
		relative = filepath.ToSlash(relative)
		if isModelAssetControlFile(relative) {
			return nil
		}
		paths = append(paths, relative)
		return nil
	})
	if err != nil {
		return nil, nil, 0, nil, true, err
	}
	sort.Strings(paths)
	files := make([]*runtimev1.ModelAssetFile, 0, len(paths))
	hashes := make(map[string]string, len(paths))
	extensions := make(map[string]struct{})
	formats := make(map[string]struct{})
	fileFingerprints := make([]any, 0)
	var total int64
	for _, relative := range paths {
		if err := ctx.Err(); err != nil {
			return nil, nil, 0, nil, true, err
		}
		absolute := filepath.Join(directory, filepath.FromSlash(relative))
		digest, err := computeImportFileSHA256(absolute)
		if err != nil {
			return nil, nil, 0, nil, true, err
		}
		info, err := os.Stat(absolute)
		if err != nil {
			return nil, nil, 0, nil, true, err
		}
		s.recordVerifiedFileSHA256(absolute, info, digest, "")
		extension := strings.ToLower(filepath.Ext(relative))
		if extension != "" {
			extensions[extension] = struct{}{}
		}
		_, codeExtension := modelAssetCodeExtensions[extension]
		code := codeExtension || info.Mode().Perm()&0o111 != 0
		if code {
			if err := os.Chmod(absolute, 0o600); err != nil {
				return nil, nil, 0, nil, true, fmt.Errorf("mark code file as non-executable content: %w", err)
			}
		}
		if format, facts := boundedModelAssetFileFingerprint(absolute, extension); format != "" {
			formats[format] = struct{}{}
			fileFingerprint := map[string]any{"relative_path": relative, "format": format}
			for key, value := range facts {
				fileFingerprint[key] = value
			}
			fileFingerprints = append(fileFingerprints, fileFingerprint)
		}
		files = append(files, &runtimev1.ModelAssetFile{RelativePath: relative, Sha256: digest, SizeBytes: info.Size(), NonExecutableContent: code})
		hashes[relative] = digest
		total += info.Size()
	}
	fingerprint := map[string]any{
		"file_count": len(files),
		"extensions": sortedStringSet(extensions),
		"formats":    sortedStringSet(formats),
	}
	if len(fileFingerprints) > 0 {
		fingerprint["file_fingerprints"] = fileFingerprints
	}
	return files, hashes, total, fingerprint, len(formats) == 0, nil
}
