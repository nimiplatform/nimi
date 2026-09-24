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
	"github.com/nimiplatform/nimi/runtime/internal/modelassetintegrity"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	// Manifest 2.0.0 describes an object-linked view: every payload file is a
	// Runtime-created link to the published object with the same SHA-256.
	modelAssetManifestSchemaVersion                   = "2.0.0"
	modelAssetManifestStorageLayoutObjectLinked       = "object-linked"
	modelAssetFingerprintReadLimit              int64 = 4 * 1024 * 1024
	modelAssetFingerprintItemLimit                    = 128
	modelAssetFingerprintStringLimit                  = 512
	modelAssetCleanupOwnerChangedReason               = "MODEL_ASSET_CLEANUP_OWNER_CHANGED"
	modelAssetCleanupGenerationChangedReason          = "MODEL_ASSET_CLEANUP_GENERATION_CHANGED"
	modelAssetCleanupPendingUsersReason               = "MODEL_ASSET_CLEANUP_WAITING_FOR_USERS"
	modelAssetCleanupPendingAccessReason              = "MODEL_ASSET_CLEANUP_ACCESS_PENDING"
	modelAssetCleanupPendingGCClosedReason            = "MODEL_ASSET_CLEANUP_RECLAMATION_CLOSED"
	modelAssetImportStagingSubtree                    = "imports"
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
	StorageLayout             string                   `json:"storage_layout"`
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

// errModelAssetInventoryReconciliation marks an inventory state that needs
// explicit reconciliation before another write: duplicate equivalent assets,
// a corrupt equivalent view, or an unlinked layout.
type modelAssetReconciliationError struct {
	Reason string
	Cause  error
}

func (err *modelAssetReconciliationError) Error() string {
	if err == nil {
		return "ModelAsset inventory requires reconciliation"
	}
	if err.Cause != nil {
		return err.Reason + ": " + err.Cause.Error()
	}
	return err.Reason
}

func (err *modelAssetReconciliationError) Unwrap() error {
	if err == nil {
		return nil
	}
	return err.Cause
}

func modelAssetRestrictionRPCError(restriction *modelAssetStoreRestriction) error {
	return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_STATE_OFFLINE_CONVERSION_REQUIRED, grpcerr.ReasonOptions{
		Message: "ModelAsset inventory requires explicit offline conversion before the model domain is available", ActionHint: "run_local_model_offline_conversion",
		Metadata: map[string]string{"schema_version": fmt.Sprintf("%d", restriction.SchemaVersion)},
	})
}

// requireModelAssetDomain fails closed while the inventory is restricted.
func (s *Service) requireModelAssetDomain() error {
	s.mu.RLock()
	restriction := s.modelAssetStoreRestriction
	s.mu.RUnlock()
	if restriction != nil {
		return modelAssetRestrictionRPCError(restriction)
	}
	return nil
}

// requireModelAssetWrites additionally refuses inventory-changing operations
// while a missing inventory over a non-empty resolved root awaits explicit
// Check & Sync reconciliation: an empty inventory is never assumed for a root
// that visibly holds managed views.
func (s *Service) requireModelAssetWrites() error {
	if err := s.requireModelAssetDomain(); err != nil {
		return err
	}
	s.mu.RLock()
	required := s.modelAssetInventoryReconciliationRequired && !s.adoptResolvedModelImports
	s.mu.RUnlock()
	if required {
		return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_INVENTORY_RECONCILIATION_REQUIRED, grpcerr.ReasonOptions{
			Message: "the models root holds managed views but no inventory; run Check & Sync before changing ModelAssets", ActionHint: "run_product_control_check_sync",
		})
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.local-compute.r009
// @nimi-authority: rule.nimi.runtime.local-compute.r014
func (s *Service) ImportModelAsset(_ context.Context, req *runtimev1.ImportModelAssetRequest) (*runtimev1.ImportModelAssetResponse, error) {
	if err := s.requireModelAssetWrites(); err != nil {
		return nil, err
	}
	source, err := inspectModelAssetSource(req.GetSourcePath(), req.GetDisplayName())
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, err, grpcerr.ReasonOptions{Message: "ModelAsset source is invalid"})
	}
	modelsRoot, err := s.resolveManagedBundleModelsRoot()
	if err != nil {
		return nil, err
	}
	if err := s.ensureModelObjectLinkSupport(modelsRoot); err != nil {
		return nil, modelObjectLinkSupportRPCError(err)
	}
	transfer, err := s.createLocalTransfer(localTransferKindImport, localTransferMutation{
		Phase: "scan", State: localTransferStateRunning, Message: "identifying ModelAsset distribution",
		BytesTotal: source.SizeBytes, SourceLabel: source.DisplayName,
	}, nil, &localTransferImportSpec{SourcePath: source.Path, DisplayName: source.DisplayName, IsDir: source.IsDir, SizeBytes: source.SizeBytes}, true)
	if err != nil {
		return nil, localTransferPersistenceError(err)
	}
	s.transferWorkerWG.Add(1)
	go func() {
		defer s.transferWorkerWG.Done()
		s.runImportModelAsset(s.jobLifetimeCtx, transfer.GetInstallSessionId(), source)
	}()
	return &runtimev1.ImportModelAssetResponse{Transfer: transfer}, nil
}

func modelObjectLinkSupportRPCError(err error) error {
	return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_STORAGE_LINK_UNSUPPORTED, err, grpcerr.ReasonOptions{
		Message: "the models root cannot create same-volume file links required for managed model storage", ActionHint: "select_nimi_data_root",
	})
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

func (s *Service) runImportModelAsset(ctx context.Context, transferID string, source modelAssetSource) {
	control := s.transferControl(transferID)
	var runErr error
	defer func() {
		s.finishManagedModelDownloadExecutor(transferID, control, runErr)
	}()
	_, runErr = s.importModelAssetSync(ctx, transferID, source)
	if runErr == nil {
		return
	}
	s.settleFailedAcquisition(transferID, runErr, false)
}

// settleFailedAcquisition records the terminal outcome of an acquisition
// executor that did not commit. Its exclusive staging and holds are released;
// staging that cannot be removed keeps the transfer's cleanup pending so a
// later explicit cancel or restart retries it.
func (s *Service) settleFailedAcquisition(transferID string, runErr error, preserveStaging bool) {
	var conflict *modelObjectConflict
	switch {
	case errors.Is(runErr, errLocalTransferCancelled) || errors.Is(runErr, context.Canceled):
		if persistErr := s.cancelTransfer(transferID, "ModelAsset acquisition cancelled"); persistErr != nil {
			s.logger.Error("persist cancelled ModelAsset acquisition", "transfer_id", transferID, "error", persistErr)
			return
		}
		s.discardAcquisitionMaterial(transferID)
	case errors.As(runErr, &conflict):
		if persistErr := s.failTransferWithConflict(transferID, conflict); persistErr != nil {
			s.logger.Error("persist conflicting ModelAsset acquisition", "transfer_id", transferID, "error", persistErr)
			return
		}
		s.discardAcquisitionMaterial(transferID)
	default:
		if persistErr := s.failTransfer(transferID, runErr.Error(), preserveStaging); persistErr != nil {
			s.logger.Error("persist failed ModelAsset acquisition", "transfer_id", transferID, "error", persistErr)
			return
		}
		if !preserveStaging {
			s.discardAcquisitionMaterial(transferID)
		}
	}
}

// discardAcquisitionMaterial removes a transfer's exclusive staging and
// releases its holds. Objects already published stay published; whether they
// survive is the reclamation owner's decision against every live root.
func (s *Service) discardAcquisitionMaterial(transferID string) {
	modelsRoot := strings.TrimSpace(s.resolvedLocalModelsPath())
	cleanupPending := !s.discardUncommittedIntentView(transferID)
	if modelsRoot != "" && filepath.IsAbs(modelsRoot) {
		for _, directory := range []string{managedModelDownloadStageDir(modelsRoot, transferID), managedModelImportStageDir(modelsRoot, transferID)} {
			if err := os.RemoveAll(directory); err != nil {
				cleanupPending = true
				s.logger.Warn("acquisition staging cleanup pending", "transfer_id", transferID, "directory", directory, "error", err)
			}
		}
	}
	if !cleanupPending {
		s.releaseModelObjectHolds(transferID)
		if err := s.reclaimUnreferencedModelObjects(); err != nil {
			cleanupPending = true
			s.logger.Warn("acquisition object cleanup pending", "transfer_id", transferID, "error", err)
		}
	}
	s.setTransferCleanupPending(transferID, cleanupPending)
}

func managedModelImportStageDir(modelsRoot string, transferID string) string {
	return filepath.Join(resolveLocalModelsPath(modelsRoot), "quarantine", modelAssetImportStagingSubtree, strings.ToLower(strings.TrimSpace(transferID)))
}

// identifiedModelAssetSource is the complete read of an import source before
// any managed copy: every payload file's digest and size through a verified
// no-follow handle, plus the bounded fingerprint facts.
type identifiedModelAssetSource struct {
	entries      []identifiedModelAssetSourceFile
	distribution modelDistribution
	fingerprint  map[string]any
	unclassified bool
	containsCode bool
	hashes       map[string]string
}

type identifiedModelAssetSourceFile struct {
	absolute string
	relative string
	identity modelAssetSourceFileIdentity
	digest   string
	size     int64
	code     bool
}

func (s *Service) identifyModelAssetSource(ctx context.Context, source modelAssetSource, onProgress func(int64) error) (identifiedModelAssetSource, error) {
	entries := make([]identifiedModelAssetSourceFile, 0)
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
			entries = append(entries, identifiedModelAssetSourceFile{absolute: path, relative: relative, identity: identity})
			return nil
		})
		if err != nil {
			return identifiedModelAssetSource{}, err
		}
	} else {
		entries = append(entries, identifiedModelAssetSourceFile{absolute: source.Path, relative: filepath.Base(source.Path), identity: source.FileIdentity})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].relative < entries[j].relative })
	if len(entries) == 0 {
		return identifiedModelAssetSource{}, errors.New("distribution contains no payload files")
	}
	result := identifiedModelAssetSource{hashes: make(map[string]string, len(entries)), fingerprint: map[string]any{}}
	extensions := make(map[string]struct{})
	formats := make(map[string]struct{})
	fileFingerprints := make([]any, 0)
	files := make([]modelDistributionFile, 0, len(entries))
	var processed int64
	for index := range entries {
		if err := ctx.Err(); err != nil {
			return identifiedModelAssetSource{}, err
		}
		entry := &entries[index]
		digest, size, err := hashVerifiedModelAssetSourceFile(entry.absolute, entry.identity, func(delta int64) error {
			processed += delta
			if onProgress != nil {
				return onProgress(processed)
			}
			return nil
		})
		if err != nil {
			return identifiedModelAssetSource{}, err
		}
		entry.digest, entry.size = digest, size
		extension := strings.ToLower(filepath.Ext(entry.relative))
		if extension != "" {
			extensions[extension] = struct{}{}
		}
		_, code := modelAssetCodeExtensions[extension]
		entry.code = code
		result.containsCode = result.containsCode || code
		if format, facts := boundedModelAssetFileFingerprint(entry.absolute, extension); format != "" {
			formats[format] = struct{}{}
			fileFingerprint := map[string]any{"relative_path": entry.relative, "format": format}
			for key, value := range facts {
				fileFingerprint[key] = value
			}
			fileFingerprints = append(fileFingerprints, fileFingerprint)
		}
		files = append(files, modelDistributionFile{RelativePath: entry.relative, SHA256: digest, SizeBytes: size, NonExecutableContent: code})
		result.hashes[entry.relative] = digest
	}
	result.entries = entries
	distribution, err := newModelDistribution(safeModelAssetEntry(modelDistribution{Files: files}.modelAssetFiles()), files)
	if err != nil {
		return identifiedModelAssetSource{}, err
	}
	result.distribution = distribution
	formatList := sortedStringSet(formats)
	result.fingerprint = map[string]any{"file_count": len(files), "extensions": sortedStringSet(extensions), "formats": formatList}
	if len(fileFingerprints) > 0 {
		result.fingerprint["file_fingerprints"] = fileFingerprints
	}
	result.unclassified = len(formatList) == 0
	return result, nil
}

func hashVerifiedModelAssetSourceFile(path string, identity modelAssetSourceFileIdentity, onProgress func(int64) error) (digest string, size int64, resultErr error) {
	source, err := openVerifiedModelAssetSourceFile(path, identity)
	if err != nil {
		return "", 0, err
	}
	defer func() {
		if err := source.Close(); resultErr == nil && err != nil {
			digest, resultErr = "", fmt.Errorf("close ModelAsset source file: %w", err)
		}
	}()
	hasher := sha256.New()
	buffer := make([]byte, modelObjectHashBufferLen)
	for {
		count, readErr := source.Read(buffer)
		if count > 0 {
			_, _ = hasher.Write(buffer[:count])
			size += int64(count)
			if onProgress != nil {
				if err := onProgress(int64(count)); err != nil {
					return "", size, err
				}
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return "", size, readErr
		}
	}
	return hex.EncodeToString(hasher.Sum(nil)), size, nil
}

// modelAssetIntake is everything a commit needs beyond the verified objects.
type modelAssetIntake struct {
	distribution   modelDistribution
	displayName    string
	provenance     map[string]any
	fingerprint    map[string]any
	unclassified   bool
	containsCode   bool
	catalogMatched bool
	verifiedAt     string
	completion     modelAssetTransferCompletion
}

// importModelAssetSync identifies the source first, then either commits a
// reuse of the equivalent committed asset, or stages only the files whose
// objects are missing, publishes them, and commits a new view.
func (s *Service) importModelAssetSync(ctx context.Context, transferID string, source modelAssetSource) (*runtimev1.ModelAssetRecord, error) {
	modelsRoot, err := s.resolveManagedBundleModelsRoot()
	if err != nil {
		return nil, err
	}
	if err := s.ensureModelObjectLinkSupport(modelsRoot); err != nil {
		return nil, err
	}
	if source.IsDir && s.adoptResolvedModelImports && pathWithinBase(filepath.Join(modelsRoot, "resolved"), source.Path, false) && resolvedDirectoryHoldsCurrentManifest(source.Path) {
		// Explicit recovery of an existing managed view keeps its manifest
		// identity and never copies payload bytes. A directory without a
		// current-layout manifest is ordinary content and is imported below.
		options := modelAssetAdoptionOptions{displayName: source.DisplayName}
		if strings.TrimSpace(transferID) != "" {
			options.transferCompletion = &modelAssetTransferCompletion{sessionID: transferID, phase: "register", message: "ModelAsset recovered"}
		}
		asset, _, err := s.adoptResolvedModelAssetDirectoryWithOptions(ctx, source.Path, options)
		return asset, err
	}
	return s.importModelAssetContent(ctx, transferID, modelsRoot, source)
}

// resolvedDirectoryHoldsCurrentManifest reports whether the directory carries
// a parseable manifest of the current schema and layout.
func resolvedDirectoryHoldsCurrentManifest(directory string) bool {
	payload, err := os.ReadFile(filepath.Join(directory, localAssetManifestFileName))
	if err != nil {
		return false
	}
	var manifest modelAssetManifest
	if decodeStrictJSON(payload, &manifest) != nil {
		return false
	}
	return !modelAssetManifestIncompatible(manifest)
}

// importModelAssetContent takes the source in as content: identify, reuse an
// equivalent committed asset, or publish the missing objects and commit a
// new linked view.
func (s *Service) importModelAssetContent(ctx context.Context, transferID string, modelsRoot string, source modelAssetSource) (*runtimev1.ModelAssetRecord, error) {
	if strings.TrimSpace(transferID) == "" {
		defer s.releaseModelObjectHolds("")
	}
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
	identified, err := s.identifyModelAssetSource(ctx, source, func(processed int64) error {
		if err := checkActive(); err != nil {
			return err
		}
		s.updateTransferVerification(transferID, "scan", processed, "identifying ModelAsset distribution")
		return nil
	})
	if err != nil {
		if errors.Is(err, errLocalTransferCancelled) || errors.Is(err, context.Canceled) {
			return nil, errLocalTransferCancelled
		}
		return nil, err
	}
	distribution := identified.distribution
	provenance := map[string]any{
		"source_kind": "local_import", "source_name": filepath.Base(source.Path), "distribution": map[bool]string{true: "directory", false: "single_file"}[source.IsDir],
	}
	intake := modelAssetIntake{
		distribution: distribution, displayName: source.DisplayName, provenance: provenance, fingerprint: identified.fingerprint,
		unclassified: identified.unclassified, containsCode: identified.containsCode, catalogMatched: s.modelAssetCatalogMatch(identified.hashes),
		completion: modelAssetTransferCompletion{sessionID: transferID, phase: "register", message: "ModelAsset imported"},
	}
	s.setTransferBytesTotal(transferID, distribution.totalSize())

	reused, err := s.tryReuseEquivalentModelAsset(ctx, transferID, modelsRoot, distribution, checkActive)
	if err != nil || reused != nil {
		return reused, err
	}

	// Stage only files whose object is missing; every other position reuses
	// the verified published object.
	stageDir := managedModelImportStageDir(modelsRoot, transferID)
	if err := os.MkdirAll(stageDir, 0o700); err != nil {
		return nil, fmt.Errorf("prepare import staging: %w", err)
	}
	var received, reusedBytes int64
	for _, entry := range identified.entries {
		if err := checkActive(); err != nil {
			return nil, errLocalTransferCancelled
		}
		s.holdModelObjectForVerification(entry.digest, transferID)
		if err := s.persistModelObjectHolds(transferID); err != nil {
			return nil, err
		}
		present, _, err := modelObjectPresent(modelsRoot, entry.digest)
		if err != nil {
			return nil, err
		}
		if present {
			if _, _, verifyErr := verifyModelObject(modelsRoot, entry.digest, entry.size, func(delta int64) error {
				s.addTransferVerifiedBytes(transferID, delta)
				return checkActive()
			}); verifyErr == nil {
				s.pinModelObject(entry.digest, transferID)
				reusedBytes += entry.size
				s.updateTransferReuse(transferID, "verify", received, reusedBytes, "reusing verified local content for "+entry.relative)
				continue
			} else if errors.Is(verifyErr, errLocalTransferCancelled) || errors.Is(verifyErr, context.Canceled) {
				return nil, errLocalTransferCancelled
			} else if _, isolateErr := s.isolateModelObjectGeneration(modelsRoot, entry.digest, "published object failed verification during explicit import: "+verifyErr.Error()); isolateErr != nil {
				return nil, &modelAssetReconciliationError{Reason: "corrupt published model object could not be isolated", Cause: isolateErr}
			}
		}
		if conflict := s.acquireModelObjectWriter(entry.digest, transferID); conflict != nil {
			return nil, conflict
		}
		if err := s.persistModelObjectHolds(transferID); err != nil {
			return nil, err
		}
		target := filepath.Join(stageDir, filepath.FromSlash(entry.relative))
		if !pathWithinBase(stageDir, target, false) {
			return nil, fmt.Errorf("target path escapes staging: %q", entry.relative)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return nil, err
		}
		_ = os.Remove(target)
		fileReceived := received
		digest, size, err := copyAndHashModelAssetFile(entry.absolute, target, entry.identity, func(delta int64) error {
			fileReceived += delta
			if err := checkActive(); err != nil {
				return err
			}
			s.updateTransferReuse(transferID, "copy", fileReceived, reusedBytes, "copying "+entry.relative)
			return nil
		})
		if err != nil {
			if errors.Is(err, errLocalTransferCancelled) || errors.Is(err, context.Canceled) {
				return nil, errLocalTransferCancelled
			}
			return nil, err
		}
		if digest != entry.digest || size != entry.size {
			return nil, fmt.Errorf("ModelAsset source file %q changed after identification", entry.relative)
		}
		if _, err := normalizeModelPayloadPermissionsBeforePublish(target, entry.relative); err != nil {
			return nil, err
		}
		if _, _, err := publishModelObjectIfAbsent(modelsRoot, entry.digest, target); err != nil {
			return nil, err
		}
		s.pinModelObject(entry.digest, transferID)
		received = fileReceived
		s.updateTransferReuse(transferID, "copy", received, reusedBytes, "copied "+entry.relative)
	}
	// Every file is a published, pinned object; the exclusive staging is
	// released before the commit becomes visible.
	if err := os.RemoveAll(stageDir); err != nil {
		s.logger.Warn("import staging cleanup pending after publish", "transfer_id", transferID, "directory", stageDir, "error", err)
	}
	record, _, err := s.commitManagedModelAssetView(ctx, transferID, modelsRoot, intake, received, reusedBytes)
	if err != nil {
		return nil, err
	}
	s.releaseModelObjectHolds(transferID)
	return record, nil
}

// tryReuseEquivalentModelAsset commits a reused result against the committed
// asset whose distribution equals the intake, after verifying that asset's
// view by reading. A corrupt or ambiguous equivalent is a reconciliation
// error; the acquisition never registers a second copy over it.
func (s *Service) tryReuseEquivalentModelAsset(ctx context.Context, transferID string, modelsRoot string, distribution modelDistribution, checkActive func() error) (*runtimev1.ModelAssetRecord, error) {
	s.mu.RLock()
	candidates := s.equivalentModelAssetsLocked(distribution)
	directories := make(map[string]string, len(candidates))
	for _, candidate := range candidates {
		directories[candidate.GetModelAssetId()] = s.modelAssetDirectories[candidate.GetModelAssetId()]
	}
	s.mu.RUnlock()
	exact := make([]*runtimev1.ModelAssetRecord, 0, len(candidates))
	for _, candidate := range candidates {
		existing, err := modelDistributionFromRecord(candidate)
		if err != nil {
			continue
		}
		if existing.equal(distribution) || (!distributionSizesKnown(distribution) && existing.equalLayout(distribution)) {
			exact = append(exact, candidate)
		}
	}
	if len(exact) == 0 {
		return nil, nil
	}
	if len(exact) > 1 {
		return nil, &modelAssetReconciliationError{Reason: fmt.Sprintf("inventory holds %d equivalent ModelAssets; offline merge is required", len(exact))}
	}
	candidate := exact[0]
	s.lockModelAssetMutation()
	s.mu.RLock()
	current := s.modelAssets[candidate.GetModelAssetId()]
	live := current != nil && current.GetCreatedAt() == candidate.GetCreatedAt()
	s.mu.RUnlock()
	if !live {
		s.modelAssetMutationMu.Unlock()
		return nil, &modelAssetReconciliationError{Reason: "equivalent ModelAsset was removed before verification"}
	}
	release := s.acquireModelAssetUse(candidate.GetModelAssetId(), "acquisition:"+transferID)
	s.modelAssetMutationMu.Unlock()
	defer release()
	if err := s.verifyManagedModelAssetView(ctx, modelsRoot, candidate, directories[candidate.GetModelAssetId()], func(delta int64) error {
		s.addTransferVerifiedBytes(transferID, delta)
		if checkActive != nil {
			return checkActive()
		}
		return nil
	}); err != nil {
		if errors.Is(err, errLocalTransferCancelled) || errors.Is(err, context.Canceled) {
			return nil, errLocalTransferCancelled
		}
		return nil, &modelAssetReconciliationError{Reason: fmt.Sprintf("equivalent ModelAsset %s failed verification", candidate.GetModelAssetId()), Cause: err}
	}
	if checkActive != nil {
		if err := checkActive(); err != nil {
			return nil, errLocalTransferCancelled
		}
	}
	committed, err := s.commitReusedModelAsset(transferID, candidate.GetModelAssetId(), candidate.GetCreatedAt())
	if err != nil {
		return nil, err
	}
	return committed, nil
}

func distributionSizesKnown(distribution modelDistribution) bool {
	for _, file := range distribution.Files {
		if file.SizeBytes < 0 {
			return false
		}
	}
	return true
}

// verifyManagedModelAssetView proves a committed view is healthy: every
// declared file is a plain regular file linked to the published object of its
// digest, with matching size and bytes. It reads every byte.
func (s *Service) verifyManagedModelAssetView(ctx context.Context, modelsRoot string, asset *runtimev1.ModelAssetRecord, directory string, onProgress func(int64) error) error {
	if asset == nil || strings.TrimSpace(directory) == "" || !s.validModelAssetManagedDirectory(directory) {
		return errors.New("ModelAsset view directory is unavailable")
	}
	assetPayload, err := protojson.Marshal(asset)
	if err != nil {
		return err
	}
	if err := validateStoredModelAssetRecord(modelsRoot, &modelAssetStoreRecord{Asset: assetPayload, ManagedDirectory: directory}); err != nil {
		return err
	}
	paths := make([]string, 0, len(asset.GetFiles()))
	for _, file := range asset.GetFiles() {
		paths = append(paths, file.GetRelativePath())
	}
	if err := modelassetintegrity.ValidateDeclaredPayloadSet(directory, paths); err != nil {
		return err
	}
	for _, file := range asset.GetFiles() {
		if err := ctx.Err(); err != nil {
			return err
		}
		if file == nil || !canonicalModelAssetRelativePath(file.GetRelativePath()) {
			return errors.New("ModelAsset file inventory is not canonical")
		}
		viewPath := filepath.Join(directory, filepath.FromSlash(file.GetRelativePath()))
		if !pathWithinBase(directory, viewPath, false) {
			return errors.New("ModelAsset file escapes its view")
		}
		linked, _, err := viewFileLinkedToObject(modelsRoot, file.GetSha256(), viewPath)
		if err != nil {
			return fmt.Errorf("inspect view file %q: %w", file.GetRelativePath(), err)
		}
		if !linked {
			return fmt.Errorf("view file %q is not linked to its published object", file.GetRelativePath())
		}
		digest, size, err := hashRegularFile(viewPath, onProgress)
		if err != nil {
			return fmt.Errorf("verify view file %q: %w", file.GetRelativePath(), err)
		}
		if size != file.GetSizeBytes() || !strings.EqualFold(digest, file.GetSha256()) {
			return fmt.Errorf("view file %q content differs from its inventory", file.GetRelativePath())
		}
		info, err := os.Lstat(viewPath)
		if err == nil {
			s.recordVerifiedFileSHA256(viewPath, info, digest, modelAssetFileVerificationGeneration(asset, file))
		}
	}
	return nil
}

// commitReusedModelAsset is the single commit point of a reused result: the
// transfer's reused result is persisted while the asset is still in inventory
// with the same generation. Until that save succeeds the transfer has not
// reused anything; after it the result stays even if the asset is later
// removed.
func (s *Service) commitReusedModelAsset(transferID string, modelAssetID string, generation string) (*runtimev1.ModelAssetRecord, error) {
	s.lockModelAssetMutation()
	defer s.modelAssetMutationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	asset := cloneModelAsset(s.modelAssets[modelAssetID])
	if asset == nil || strings.TrimSpace(asset.GetCreatedAt()) != strings.TrimSpace(generation) {
		return nil, &modelAssetReconciliationError{Reason: fmt.Sprintf("equivalent ModelAsset %s was removed before the reuse result committed", modelAssetID)}
	}
	if strings.TrimSpace(transferID) == "" {
		// No transfer carries this intake (in-process callers); the reuse is
		// the verified asset itself.
		return asset, nil
	}
	private := s.transferPrivateLocked(transferID)
	if private.cancelRequested {
		return nil, errLocalTransferCancelled
	}
	staged := s.stageTransferCompletionLocked(transferID, "register", "ModelAsset reused", func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.AssetId = modelAssetID
		summary.Disposition = runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_REUSED
		summary.BytesReceived = 0
		summary.BytesReused = asset.GetTotalSizeBytes()
		summary.BytesTotal = asset.GetTotalSizeBytes()
	})
	if staged == nil || !staged.changed {
		return nil, errLocalTransferCancelled
	}
	previousResult := private.result
	private.result = &localTransferResult{Disposition: "reused", ModelAssetID: modelAssetID}
	if err := s.persistStateLocked(); err != nil {
		staged.rollbackLocked(s)
		private.result = previousResult
		return nil, localTransferPersistenceError(err)
	}
	s.publishTransferEventLocked(localTransferEventFromSummary(staged.current))
	return asset, nil
}

// commitManagedModelAssetView creates the view for a distribution whose
// objects are all published and pinned by transferID, then commits it. The
// create intent is durable before the manifest exists; the inventory save is
// the single commit point; the transfer's created result is annotated after
// and never rolls the inventory back. A concurrent equivalent winner turns
// this commit into a reused result and discards the uncommitted view.
func (s *Service) commitManagedModelAssetView(ctx context.Context, transferID string, modelsRoot string, intake modelAssetIntake, received int64, reusedBytes int64) (*runtimev1.ModelAssetRecord, bool, error) {
	if !distributionSizesKnown(intake.distribution) {
		return nil, false, errors.New("distribution sizes must be verified before commit")
	}
	if reused, err := s.tryReuseEquivalentModelAsset(ctx, transferID, modelsRoot, intake.distribution, nil); err != nil || reused != nil {
		return reused, true, err
	}
	modelAssetID := "model_" + strings.ToLower(ulid.Make().String())
	directory, err := resolveRuntimeManagedModelBundleDir(modelsRoot, modelAssetID)
	if err != nil {
		return nil, false, err
	}
	createdAt := nowISO()
	verifiedAt := strings.TrimSpace(intake.verifiedAt)
	if verifiedAt == "" {
		verifiedAt = createdAt
	}
	files := intake.distribution.modelAssetFiles()
	contentID := modelAssetContentID(files)
	fingerprintStruct, _ := structpb.NewStruct(intake.fingerprint)
	provenance, _ := structpb.NewStruct(intake.provenance)
	asset := &runtimev1.ModelAssetRecord{
		ModelAssetId: modelAssetID, ContentId: contentID, DisplayName: defaultString(strings.TrimSpace(intake.displayName), modelAssetID),
		Entry: intake.distribution.Entry, Files: files, TotalSizeBytes: intake.distribution.totalSize(),
		ContentVerified: true, CatalogVerification: runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_NOT_MATCHED,
		Unclassified: intake.unclassified, BoundedFingerprint: fingerprintStruct, Provenance: provenance,
		CreatedAt: createdAt, UpdatedAt: createdAt, LatestIntegrityCheckedAt: verifiedAt,
		ContainsNonExecutableCode: intake.containsCode,
	}
	if intake.catalogMatched {
		asset.CatalogVerification = runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_MATCHED
	}
	// Durable create intent before any view material exists.
	if strings.TrimSpace(transferID) != "" {
		if err := s.persistTransferCommitIntent(transferID, &localTransferCommitIntent{
			Kind: "create", ModelAssetID: modelAssetID, ManagedDirectory: directory, Generation: createdAt,
			Entry: intake.distribution.Entry, Files: intake.distribution.Files,
		}); err != nil {
			return nil, false, err
		}
	}
	if err := s.materializeModelAssetView(modelsRoot, asset, directory); err != nil {
		_ = os.RemoveAll(directory)
		return nil, false, err
	}
	registered, disposition, err := s.registerCreatedModelAssetView(transferID, asset, directory, received, reusedBytes, intake.completion)
	if err != nil {
		_ = os.RemoveAll(directory)
		return nil, false, err
	}
	if disposition == runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_REUSED {
		_ = os.RemoveAll(directory)
		return registered, true, nil
	}
	s.cacheVerifiedViewFiles(registered, directory)
	return registered, false, nil
}

// materializeModelAssetView links every published object into the view
// directory and writes the canonical manifest. The directory must not exist.
func (s *Service) materializeModelAssetView(modelsRoot string, asset *runtimev1.ModelAssetRecord, directory string) error {
	if _, err := os.Lstat(directory); err == nil {
		return fmt.Errorf("ModelAsset view directory %q already exists", directory)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return fmt.Errorf("create ModelAsset view: %w", err)
	}
	for _, file := range asset.GetFiles() {
		viewPath := filepath.Join(directory, filepath.FromSlash(file.GetRelativePath()))
		if !pathWithinBase(directory, viewPath, false) {
			return fmt.Errorf("view path escapes its directory: %q", file.GetRelativePath())
		}
		if _, err := linkModelObjectIntoView(modelsRoot, file.GetSha256(), viewPath); err != nil {
			return err
		}
		info, err := os.Lstat(viewPath)
		if err != nil || info.Size() != file.GetSizeBytes() {
			return fmt.Errorf("linked view file %q does not match its verified size", file.GetRelativePath())
		}
	}
	manifestPayload, err := json.MarshalIndent(modelAssetManifestFromRecord(asset), "", "  ")
	if err != nil {
		return err
	}
	writeManifest := s.writeModelAssetManifest
	if writeManifest == nil {
		writeManifest = func(path string, payload []byte) error { return writeFileAtomically(path, payload, 0o600) }
	}
	if err := writeManifest(filepath.Join(directory, localAssetManifestFileName), manifestPayload); err != nil {
		return fmt.Errorf("commit ModelAsset manifest: %w", err)
	}
	return nil
}

// registerCreatedModelAssetView is the created commit point. Inside one
// metadata boundary it re-checks the durable cancel and equivalent assets,
// then saves the inventory. The transfer's created result is saved after; a
// failure there leaves the asset committed and is reconciled from the durable
// create intent.
func (s *Service) registerCreatedModelAssetView(transferID string, asset *runtimev1.ModelAssetRecord, directory string, received int64, reusedBytes int64, completion modelAssetTransferCompletion) (*runtimev1.ModelAssetRecord, runtimev1.LocalTransferDisposition, error) {
	id := asset.GetModelAssetId()
	distribution, err := modelDistributionFromRecord(asset)
	if err != nil {
		return nil, runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_UNSPECIFIED, err
	}
	s.lockModelAssetMutation()
	defer s.modelAssetMutationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.modelAssetStoreRestriction != nil {
		return nil, runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_UNSPECIFIED, s.modelAssetStoreRestriction
	}
	hasTransfer := strings.TrimSpace(transferID) != ""
	private := s.transferPrivateLocked(transferID)
	if hasTransfer && private.cancelRequested {
		return nil, runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_UNSPECIFIED, errLocalTransferCancelled
	}
	if _, exists := s.modelAssets[id]; exists {
		return nil, runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_UNSPECIFIED, fmt.Errorf("ModelAsset %q already exists", id)
	}
	for _, winner := range s.equivalentModelAssetsLocked(distribution) {
		existing, convertErr := modelDistributionFromRecord(winner)
		if convertErr != nil || !existing.equal(distribution) {
			continue
		}
		// A concurrent equivalent commit won. This acquisition's result becomes
		// a reuse of the winner; the winner was verified by its own intake in
		// this process and remains subject to fresh admission checks.
		if !hasTransfer {
			return cloneModelAsset(winner), runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_REUSED, nil
		}
		staged := s.stageTransferCompletionLocked(transferID, completion.phase, "ModelAsset reused", func(summary *runtimev1.LocalTransferSessionSummary) {
			summary.AssetId = winner.GetModelAssetId()
			summary.Disposition = runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_REUSED
			summary.BytesReceived = received
			summary.BytesReused = reusedBytes
		})
		if staged == nil || !staged.changed {
			return nil, runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_UNSPECIFIED, errLocalTransferCancelled
		}
		previousIntent, previousResult := private.commitIntent, private.result
		private.commitIntent = nil
		private.result = &localTransferResult{Disposition: "reused", ModelAssetID: winner.GetModelAssetId()}
		if err := s.persistStateLocked(); err != nil {
			staged.rollbackLocked(s)
			private.commitIntent, private.result = previousIntent, previousResult
			return nil, runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_UNSPECIFIED, localTransferPersistenceError(err)
		}
		s.publishTransferEventLocked(localTransferEventFromSummary(staged.current))
		return cloneModelAsset(winner), runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_REUSED, nil
	}
	if s.modelAssets == nil {
		s.modelAssets = make(map[string]*runtimev1.ModelAssetRecord)
	}
	if s.modelAssetDirectories == nil {
		s.modelAssetDirectories = make(map[string]string)
	}
	cleanDirectory := filepath.Clean(directory)
	s.modelAssets[id] = cloneModelAsset(asset)
	s.modelAssetDirectories[id] = cleanDirectory
	previousCleanup := s.terminalizeCleanupObligationsForDirectoryLocked(cleanDirectory, id)
	if err := s.persistModelAssetStoreLocked(); err != nil {
		delete(s.modelAssets, id)
		delete(s.modelAssetDirectories, id)
		for cleanupID, obligation := range previousCleanup {
			s.modelAssetCleanupObligations[cleanupID] = obligation
		}
		return nil, runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_UNSPECIFIED, err
	}
	// Committed. Everything below only annotates the transfer's result.
	if !hasTransfer {
		delete(s.transferPrivate, "")
		return cloneModelAsset(asset), runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_CREATED, nil
	}
	staged := s.stageTransferCompletionLocked(transferID, completion.phase, completion.message, func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.AssetId = id
		summary.Disposition = runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_CREATED
		summary.BytesReceived = received
		summary.BytesReused = reusedBytes
		summary.BytesTotal = asset.GetTotalSizeBytes()
		if completion.transferBytesTotal > 0 {
			summary.BytesTotal = completion.transferBytesTotal
		}
	})
	committedIntent := private.commitIntent
	private.commitIntent = nil
	private.result = &localTransferResult{Disposition: "created", ModelAssetID: id}
	if staged != nil && staged.changed {
		if err := s.persistStateLocked(); err != nil {
			// The inventory commit is real, but the result is not yet durable.
			// Keep its target discoverable by removal/recovery settlement.
			private.commitIntent = committedIntent
			s.logger.Warn("ModelAsset committed but transfer result persistence failed; result will be reconciled from the durable create intent", "transfer_id", transferID, "model_asset_id", id, "error", err)
		}
		s.publishTransferEventLocked(localTransferEventFromSummary(staged.current))
	}
	return cloneModelAsset(asset), runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_CREATED, nil
}

// cacheVerifiedViewFiles records the intake's verification proof for every
// linked view file so projection paths can reuse it; admission still rereads.
func (s *Service) cacheVerifiedViewFiles(asset *runtimev1.ModelAssetRecord, directory string) {
	if s == nil || asset == nil {
		return
	}
	for _, file := range asset.GetFiles() {
		if file == nil {
			continue
		}
		viewPath := filepath.Join(directory, filepath.FromSlash(file.GetRelativePath()))
		info, err := os.Lstat(viewPath)
		if err != nil || !info.Mode().IsRegular() || info.Size() != file.GetSizeBytes() {
			continue
		}
		s.recordVerifiedFileSHA256(viewPath, info, file.GetSha256(), modelAssetFileVerificationGeneration(asset, file))
	}
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
	buffer := make([]byte, modelObjectHashBufferLen)
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
		SchemaVersion: modelAssetManifestSchemaVersion, StorageLayout: modelAssetManifestStorageLayoutObjectLinked,
		ModelAssetID: asset.GetModelAssetId(), ContentID: asset.GetContentId(),
		DisplayName: asset.GetDisplayName(), Entry: asset.GetEntry(), Files: files, TotalSizeBytes: asset.GetTotalSizeBytes(),
		ContentVerified: asset.GetContentVerified(), CatalogVerified: asset.GetCatalogVerification() == runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_MATCHED,
		BoundedFingerprint: structToMap(asset.GetBoundedFingerprint()), Provenance: structToMap(asset.GetProvenance()),
		ContainsNonExecutableCode: asset.GetContainsNonExecutableCode(), CreatedAt: asset.GetCreatedAt(),
	}
}

// modelAssetManifestIncompatible reports a parseable manifest of another
// schema or layout. Such a directory is a valid distribution awaiting offline
// conversion, never orphan content and never an adoptable view.
func modelAssetManifestIncompatible(manifest modelAssetManifest) bool {
	return manifest.SchemaVersion != modelAssetManifestSchemaVersion || manifest.StorageLayout != modelAssetManifestStorageLayoutObjectLinked
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

func cloneModelAsset(asset *runtimev1.ModelAssetRecord) *runtimev1.ModelAssetRecord {
	if asset == nil {
		return nil
	}
	return proto.Clone(asset).(*runtimev1.ModelAssetRecord)
}

type modelAssetTransferCompletion struct {
	sessionID string
	phase     string
	message   string
	// transferBytesTotal, when positive, is the source size the transfer
	// actually moved (a release archive) and stays the completed total.
	transferBytesTotal int64
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

func (s *Service) ListModelAssets(_ context.Context, req *runtimev1.ListModelAssetsRequest) (*runtimev1.ListModelAssetsResponse, error) {
	if err := s.requireModelAssetDomain(); err != nil {
		return nil, err
	}
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
	if err := s.requireModelAssetDomain(); err != nil {
		return nil, err
	}
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

// RemoveModelAsset releases one distribution view. Inside the removal's
// metadata boundary every pending acquisition result targeting the asset is
// settled first (a committed create is annotated as created; an uncommitted
// reuse ends as unavailable), then the inventory row is replaced by a
// wait_users cleanup obligation carrying the view's captured file identities
// and object candidates. Objects other live roots reference always survive.
func (s *Service) RemoveModelAsset(_ context.Context, req *runtimev1.RemoveModelAssetRequest) (*runtimev1.RemoveModelAssetResponse, error) {
	if err := s.requireModelAssetWrites(); err != nil {
		return nil, err
	}
	id := strings.TrimSpace(req.GetModelAssetId())
	if id == "" {
		return nil, status.Error(codes.InvalidArgument, "model_asset_id is required")
	}
	s.lockModelAssetMutation()
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
	obligation, captureErr := captureModelAssetCleanupObligation(id, asset, directory)
	if captureErr != nil {
		s.mu.Unlock()
		return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_INVENTORY_RECONCILIATION_REQUIRED, captureErr, grpcerr.ReasonOptions{Message: "ModelAsset view identity could not be captured for removal"})
	}
	settled, settleErr := s.settlePendingTransferResultsForAssetLocked(id, asset.GetCreatedAt())
	if settleErr != nil {
		s.mu.Unlock()
		return nil, grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_PERSISTENCE_UNAVAILABLE, settleErr, grpcerr.ReasonOptions{Message: "pending acquisition results for this ModelAsset could not be settled"})
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
	for _, staged := range settled.completions {
		s.publishTransferEventLocked(localTransferEventFromSummary(staged.current))
	}
	s.mu.Unlock()

	cleanupPending := !s.completeModelAssetCleanupLocked(id)
	return &runtimev1.RemoveModelAssetResponse{Asset: asset, ReferencingLoadoutIds: references, CleanupPending: cleanupPending}, nil
}

// captureModelAssetCleanupObligation snapshots the view's file identities
// before anything is removed so later phases delete only what they captured.
func captureModelAssetCleanupObligation(id string, asset *runtimev1.ModelAssetRecord, directory string) (modelAssetCleanupObligation, error) {
	now := nowISO()
	obligation := modelAssetCleanupObligation{
		ModelAssetID: id, ContentID: asset.GetContentId(), Generation: strings.TrimSpace(asset.GetCreatedAt()),
		ManagedDirectory: directory, Reason: "ModelAsset removed", Phase: modelAssetCleanupPhaseWaitUsers,
		CreatedAt: now, UpdatedAt: now,
	}
	candidates := make(map[string]struct{}, len(asset.GetFiles()))
	for _, file := range asset.GetFiles() {
		if file == nil {
			continue
		}
		captured := modelAssetCleanupFile{RelativePath: file.GetRelativePath(), SHA256: normalizeExactSHA256Hex(file.GetSha256()), SizeBytes: file.GetSizeBytes()}
		viewPath := filepath.Join(directory, filepath.FromSlash(file.GetRelativePath()))
		identity, info, err := modelFileIdentityOf(viewPath)
		if err == nil && info.Mode().IsRegular() {
			captured.Identity = &identity
		} else if err != nil && !errors.Is(err, os.ErrNotExist) {
			return modelAssetCleanupObligation{}, fmt.Errorf("inspect view file %q: %w", file.GetRelativePath(), err)
		}
		obligation.Files = append(obligation.Files, captured)
		candidates[captured.SHA256] = struct{}{}
	}
	for digest := range candidates {
		obligation.ObjectCandidates = append(obligation.ObjectCandidates, digest)
	}
	sort.Strings(obligation.ObjectCandidates)
	return obligation, nil
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

// completeModelAssetCleanupLocked advances one obligation as far as the
// current live roots allow. It returns true only when the obligation is
// finished (or terminal). Caller holds modelAssetMutationMu.
func (s *Service) completeModelAssetCleanupLocked(modelAssetID string) bool {
	s.mu.RLock()
	if s.jobLifetimeCancel == nil {
		s.mu.RUnlock()
		return false
	}
	obligation, exists := s.modelAssetCleanupObligations[modelAssetID]
	gcOpen := s.modelAssetReclamationOpen && s.modelAssetStoreRestriction == nil && !s.modelAssetInventoryReconciliationRequired
	liveOwnerID := ""
	if exists {
		for id, directory := range s.modelAssetDirectories {
			if canonicalReportPath(directory) == canonicalReportPath(obligation.ManagedDirectory) && s.modelAssets[id] != nil {
				liveOwnerID = id
				break
			}
		}
	}
	s.mu.RUnlock()
	if !exists || obligation.Terminal {
		return true
	}
	if !gcOpen {
		s.markModelAssetCleanupPendingLocked(modelAssetID, modelAssetCleanupPendingGCClosedReason)
		return false
	}
	if liveOwnerID != "" {
		return s.terminalizeModelAssetCleanupLocked(modelAssetID, modelAssetCleanupOwnerChangedReason, fmt.Sprintf("managed directory is now owned by ModelAsset %s", liveOwnerID))
	}
	modelsRoot := s.resolvedLocalModelsPath()
	for {
		switch obligation.Phase {
		case "", modelAssetCleanupPhaseWaitUsers:
			if holders := s.modelAssetUseHolders(modelAssetID); len(holders) > 0 {
				s.markModelAssetCleanupPendingLocked(modelAssetID, modelAssetCleanupPendingUsersReason+": "+strings.Join(holders, ","))
				return false
			}
			if s.transferPinsAssetLocked(modelAssetID) {
				s.markModelAssetCleanupPendingLocked(modelAssetID, modelAssetCleanupPendingUsersReason+": acquisition")
				return false
			}
			for _, host := range s.modelAssetHosts {
				retired, err := host.RetireModelAsset(modelAssetID)
				if err != nil || !retired {
					detail := "resident Host is still using captured files"
					if err != nil {
						detail = err.Error()
					}
					s.markModelAssetCleanupPendingLocked(modelAssetID, modelAssetCleanupPendingUsersReason+": "+detail)
					return false
				}
			}
			if !s.advanceModelAssetCleanupPhaseLocked(modelAssetID, modelAssetCleanupPhaseRemoveView) {
				return false
			}
			obligation.Phase = modelAssetCleanupPhaseRemoveView
		case modelAssetCleanupPhaseRemoveView:
			// Files change from here on, so admission holds go first.
			s.releaseAdmissionHolds()
			if err := removeModelAssetView(obligation); err != nil {
				var conflict *modelAssetCleanupConflict
				if errors.As(err, &conflict) {
					return s.terminalizeModelAssetCleanupLocked(modelAssetID, modelAssetCleanupGenerationChangedReason, err.Error())
				}
				s.markModelAssetCleanupPendingLocked(modelAssetID, modelAssetCleanupPendingAccessReason+": "+err.Error())
				return false
			}
			if !s.advanceModelAssetCleanupPhaseLocked(modelAssetID, modelAssetCleanupPhaseReclaimObjects) {
				return false
			}
			obligation.Phase = modelAssetCleanupPhaseReclaimObjects
		case modelAssetCleanupPhaseReclaimObjects:
			s.releaseAdmissionHolds()
			if err := s.reclaimModelAssetObjects(modelsRoot, modelAssetID, obligation); err != nil {
				s.markModelAssetCleanupPendingLocked(modelAssetID, modelAssetCleanupPendingAccessReason+": "+err.Error())
				return false
			}
			s.mu.Lock()
			delete(s.modelAssetCleanupObligations, modelAssetID)
			err := s.persistModelAssetStoreLocked()
			if err != nil {
				s.modelAssetCleanupObligations[modelAssetID] = obligation
			}
			s.mu.Unlock()
			if err == nil {
				// A released view may have been the last reference to an
				// isolated object generation.
				s.retryModelObjectQuarantinesLocked(modelsRoot)
			}
			return err == nil
		default:
			return s.terminalizeModelAssetCleanupLocked(modelAssetID, modelAssetCleanupGenerationChangedReason, "cleanup obligation phase is unknown")
		}
	}
}

// modelAssetCleanupConflict is a real owner or generation change: a captured
// file now has another identity, or an undeclared entry appeared. Such a view
// is never deleted by the old decision.
type modelAssetCleanupConflict struct {
	Reason string
}

func (err *modelAssetCleanupConflict) Error() string { return err.Reason }

// removeModelAssetView unlinks each captured file only while it still carries
// the captured identity; a missing file is a completed step. Files without a
// captured identity (missing at removal time) are treated as already gone.
func removeModelAssetView(obligation modelAssetCleanupObligation) error {
	directory := obligation.ManagedDirectory
	if _, err := os.Lstat(directory); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	for _, file := range obligation.Files {
		viewPath := filepath.Join(directory, filepath.FromSlash(file.RelativePath))
		if !pathWithinBase(directory, viewPath, false) {
			return &modelAssetCleanupConflict{Reason: fmt.Sprintf("captured view path %q escapes the view", file.RelativePath)}
		}
		identity, info, err := modelFileIdentityOf(viewPath)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || file.Identity == nil || identity != *file.Identity {
			return &modelAssetCleanupConflict{Reason: fmt.Sprintf("view file %q no longer carries the identity captured at removal", file.RelativePath)}
		}
		if err := os.Remove(viewPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	manifestPath := filepath.Join(directory, localAssetManifestFileName)
	if err := os.Remove(manifestPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	// Any remaining entry is undeclared content: leave it and report.
	remaining := make([]string, 0)
	walkErr := filepath.WalkDir(directory, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == directory || entry.IsDir() {
			return nil
		}
		relative, _ := filepath.Rel(directory, path)
		remaining = append(remaining, filepath.ToSlash(relative))
		return nil
	})
	if walkErr != nil && !errors.Is(walkErr, os.ErrNotExist) {
		return walkErr
	}
	if len(remaining) > 0 {
		return &modelAssetCleanupConflict{Reason: fmt.Sprintf("view directory holds undeclared entries after removal: %s", strings.Join(remaining, ","))}
	}
	if err := os.RemoveAll(directory); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// reclaimModelAssetObjects unlinks each candidate object no other live root
// references. The obligation's own candidates are not roots. An object whose
// current physical identity differs from every captured identity belongs to a
// newer generation and is left alone; a missing object is a completed step.
func (s *Service) reclaimModelAssetObjects(modelsRoot string, modelAssetID string, obligation modelAssetCleanupObligation) error {
	manifestRoots, err := modelObjectManifestRoots(modelsRoot)
	if err != nil {
		return err
	}
	captured := make(map[string]map[modelFileIdentity]struct{}, len(obligation.Files))
	for _, file := range obligation.Files {
		if file.Identity == nil {
			continue
		}
		if captured[file.SHA256] == nil {
			captured[file.SHA256] = make(map[modelFileIdentity]struct{})
		}
		captured[file.SHA256][*file.Identity] = struct{}{}
	}
	for _, digest := range obligation.ObjectCandidates {
		if manifestRoots[digest] {
			continue
		}
		if err := s.reclaimCapturedModelObject(modelsRoot, modelAssetID, digest, captured[digest]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) reclaimCapturedModelObject(modelsRoot, modelAssetID, digest string, captured map[modelFileIdentity]struct{}) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	s.modelObjectMu.Lock()
	defer s.modelObjectMu.Unlock()
	if s.modelObjectReferencedLocked(digest, modelAssetID) {
		return nil
	}
	objectPath, err := modelObjectPath(modelsRoot, digest)
	if err != nil {
		return err
	}
	identity, info, err := modelFileIdentityOf(objectPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return nil
	}
	if len(captured) > 0 {
		if _, ours := captured[identity]; !ours {
			return nil
		}
	}
	if err := os.Remove(objectPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	_ = os.Remove(filepath.Dir(objectPath))
	return nil
}

func (s *Service) advanceModelAssetCleanupPhaseLocked(modelAssetID string, phase string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	before, exists := s.modelAssetCleanupObligations[modelAssetID]
	if !exists {
		return false
	}
	current := before
	current.Phase = phase
	current.PendingReason = ""
	current.UpdatedAt = nowISO()
	s.modelAssetCleanupObligations[modelAssetID] = current
	if err := s.persistModelAssetStoreLocked(); err != nil {
		s.modelAssetCleanupObligations[modelAssetID] = before
		return false
	}
	return true
}

func (s *Service) markModelAssetCleanupPendingLocked(modelAssetID string, reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	before, exists := s.modelAssetCleanupObligations[modelAssetID]
	if !exists || before.Terminal {
		return
	}
	current := before
	current.Attempts++
	current.PendingReason = strings.TrimSpace(reason)
	current.UpdatedAt = nowISO()
	s.modelAssetCleanupObligations[modelAssetID] = current
	if err := s.persistModelAssetStoreLocked(); err != nil {
		s.modelAssetCleanupObligations[modelAssetID] = before
	}
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

// retryModelAssetCleanupObligation advances one obligation after a use or
// acquisition hold on its asset was released.
func (s *Service) retryModelAssetCleanupObligation(modelAssetID string) {
	s.mu.RLock()
	_, exists := s.modelAssetCleanupObligations[modelAssetID]
	_, pendingRebase := s.modelAssetPendingCleanupRebases[modelAssetID]
	open := s.modelAssetReclamationOpen
	s.mu.RUnlock()
	if !exists || pendingRebase || !open {
		return
	}
	_ = s.completeModelAssetCleanup(modelAssetID)
}

func (s *Service) retryModelAssetCleanupObligations() {
	s.mu.RLock()
	if !s.modelAssetReclamationOpen {
		s.mu.RUnlock()
		return
	}
	ids := make([]string, 0, len(s.modelAssetCleanupObligations))
	for id := range s.modelAssetCleanupObligations {
		if _, pending := s.modelAssetPendingCleanupRebases[id]; pending {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	s.mu.RUnlock()
	for _, id := range ids {
		_ = s.completeModelAssetCleanup(id)
	}
	s.retryModelObjectQuarantines()
}

func (s *Service) persistModelAssetStoreLocked() error {
	if s.modelAssetStoreRestriction != nil {
		return s.modelAssetStoreRestriction
	}
	if len(s.modelAssetPendingDirectoryRebases) > 0 || len(s.modelAssetPendingCleanupRebases) > 0 {
		return errors.New("ModelAsset store requires Check & Sync reconciliation before mutation")
	}
	snapshot, err := buildModelAssetStoreSnapshot(s.modelAssets, s.modelAssetDirectories, s.modelAssetCleanupObligations, s.modelObjectQuarantines, s.localModelsPath)
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

// restoreModelAssetStore loads the inventory without reclaiming anything.
// Reclamation opens only after every reference owner has recovered
// (OpenModelAssetReclamation).
func (s *Service) restoreModelAssetStore() error {
	decoded, err := loadModelAssetStore(s.modelAssetStorePath, s.localModelsPathSnapshot())
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.modelAssets = decoded.Assets
	s.modelAssetDirectories = decoded.Directories
	s.modelAssetCleanupObligations = decoded.CleanupObligations
	s.modelObjectQuarantines = decoded.ObjectQuarantines
	s.modelAssetPendingDirectoryRebases = decoded.PendingDirectoryRebases
	s.modelAssetPendingCleanupRebases = decoded.PendingCleanupRebases
	s.modelAssetRetainedRecords = cloneQuarantinedStateRecords(decoded.retainedRecords)
	s.modelAssetStoreRestriction = decoded.Restriction
	s.modelAssetInventoryReconciliationRequired = decoded.Restriction == nil && len(decoded.Assets) == 0 && !decoded.RewriteRequired &&
		modelAssetStoreAbsent(s.modelAssetStorePath) && resolvedRootHoldsManagedViews(s.localModelsPath)
	s.recordStartupStateIsolationDiagnostics(decoded.Diagnostics)
	if decoded.RewriteRequired && decoded.Restriction == nil && len(decoded.PendingDirectoryRebases) == 0 && len(decoded.PendingCleanupRebases) == 0 {
		err = s.persistModelAssetStoreLocked()
	}
	s.mu.Unlock()
	if err != nil {
		return err
	}
	if decoded.Restriction != nil {
		s.logger.Warn("ModelAsset inventory is restricted until explicit offline conversion", "path", decoded.Restriction.Path, "schema_version", decoded.Restriction.SchemaVersion)
		return nil
	}
	for id, asset := range decoded.Assets {
		directory := decoded.Directories[id]
		if pending, ok := decoded.PendingDirectoryRebases[id]; ok {
			directory = pending
		}
		s.restoreVerifiedModelAssetGeneration(asset, directory)
	}
	return nil
}

func modelAssetStoreAbsent(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	_, err := os.Lstat(path)
	return errors.Is(err, os.ErrNotExist)
}

// resolvedRootHoldsManagedViews reports whether any first-level directory
// under resolved/ carries a canonical manifest.
func resolvedRootHoldsManagedViews(modelsRoot string) bool {
	root := resolveLocalModelsPath(modelsRoot)
	if root == "" || !filepath.IsAbs(root) {
		return false
	}
	entries, err := os.ReadDir(filepath.Join(root, "resolved"))
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if _, err := os.Lstat(filepath.Join(root, "resolved", entry.Name(), localAssetManifestFileName)); err == nil {
			return true
		}
	}
	return false
}

// OpenModelAssetReclamation is the startup gate for garbage collection. The
// composition root calls it once every reference owner (transfer state, Job
// and Host owners, Product Control reconciliation) has finished its own
// recovery, so no reclamation decision can run against an unrestored owner.
func (s *Service) OpenModelAssetReclamation() {
	s.reconcileTransferCommitIntents()
	s.mu.Lock()
	s.modelAssetReclamationOpen = true
	s.mu.Unlock()
	s.retryModelAssetCleanupObligations()
	s.retryAcquisitionMaterialCleanup()
	if err := s.reclaimUnreferencedModelObjects(); err != nil {
		s.logger.Warn("unreferenced model object cleanup pending", "error", err)
	}
}

// IsRegisteredModelAssetDirectory reports whether the directory is the
// committed view of an inventory asset.
func (s *Service) IsRegisteredModelAssetDirectory(directory string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, registered := s.modelAssetForManagedDirectoryLocked(directory)
	return registered
}

// ModelAssetInventoryRestriction reports the typed offline-conversion state.
func (s *Service) ModelAssetInventoryRestriction() *modelAssetStoreRestriction {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.modelAssetStoreRestriction
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

// adoptResolvedModelAssetDirectoryWithOptions recovers an existing managed
// view whose canonical manifest is valid and whose payload verifies. The
// manifest's own model_asset_id is kept; every payload file must already be
// the published object for its digest or, when no object exists yet, is taken
// over as that object by linking without a copy. A file that differs from an
// existing object, or a distribution equivalent to another committed asset,
// is a reconciliation conflict rather than a new identity.
// @nimi-authority: rule.nimi.runtime.local-compute.r009
// @nimi-authority: rule.nimi.runtime.local-compute.r014
func (s *Service) adoptResolvedModelAssetDirectoryWithOptions(ctx context.Context, directory string, options modelAssetAdoptionOptions) (*runtimev1.ModelAssetRecord, bool, error) {
	if restriction := s.ModelAssetInventoryRestriction(); restriction != nil {
		return nil, false, restriction
	}
	absolute, err := filepath.Abs(filepath.Clean(directory))
	if err != nil || !s.validModelAssetManagedDirectory(absolute) {
		return nil, false, errors.New("adoption directory must stay under resolved/")
	}
	modelsRoot, err := s.resolveManagedBundleModelsRoot()
	if err != nil {
		return nil, false, err
	}
	s.mu.RLock()
	for id, existing := range s.modelAssetDirectories {
		if canonicalReportPath(existing) == canonicalReportPath(absolute) {
			asset := cloneModelAsset(s.modelAssets[id])
			s.mu.RUnlock()
			if options.transferCompletion != nil {
				if _, err := s.commitReusedModelAsset(options.transferCompletion.sessionID, asset.GetModelAssetId(), asset.GetCreatedAt()); err != nil {
					return nil, false, err
				}
			}
			return asset, true, nil
		}
	}
	s.mu.RUnlock()
	info, err := os.Lstat(absolute)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, false, errors.New("adoption directory is not a safe distribution directory")
	}
	manifestPayload, err := os.ReadFile(filepath.Join(absolute, localAssetManifestFileName))
	if err != nil {
		return nil, false, &modelAssetReconciliationError{Reason: "adoption requires a canonical manifest; unmanaged content must be imported", Cause: err}
	}
	var manifest modelAssetManifest
	if err := decodeStrictJSON(manifestPayload, &manifest); err != nil {
		return nil, false, &modelAssetReconciliationError{Reason: "adoption manifest is invalid", Cause: err}
	}
	if modelAssetManifestIncompatible(manifest) {
		return nil, false, &modelAssetReconciliationError{Reason: "adoption manifest version or layout requires explicit offline conversion"}
	}
	asset, err := modelAssetRecordFromCanonicalManifest(manifest)
	if err != nil {
		return nil, false, &modelAssetReconciliationError{Reason: "adoption manifest identity is incomplete", Cause: err}
	}
	if err := s.ensureModelObjectLinkSupport(modelsRoot); err != nil {
		return nil, false, err
	}
	files, hashes, total, _, _, err := s.hashResolvedPayloadDetailed(ctx, absolute)
	if err != nil {
		return nil, false, err
	}
	distribution, err := modelDistributionFromFiles(asset.GetEntry(), files)
	if err != nil {
		return nil, false, err
	}
	declared, err := modelDistributionFromRecord(asset)
	if err != nil {
		return nil, false, err
	}
	if !distribution.equal(declared) || total != asset.GetTotalSizeBytes() || modelAssetContentID(files) != asset.GetContentId() {
		return nil, false, &modelAssetReconciliationError{Reason: "adoption payload differs from its canonical manifest"}
	}
	if len(options.expectedHashes) > 0 && !equalResolvedPayloadHashes(hashes, options.expectedHashes) {
		return nil, false, errors.New("resolved ModelAsset distribution does not match the protected acquisition plan")
	}
	// Establish or verify object linkage for every file without copying.
	for _, file := range files {
		viewPath := filepath.Join(absolute, filepath.FromSlash(file.GetRelativePath()))
		present, _, presentErr := modelObjectPresent(modelsRoot, file.GetSha256())
		if presentErr != nil {
			return nil, false, presentErr
		}
		if !present {
			if _, err := normalizeModelPayloadPermissionsBeforePublish(viewPath, file.GetRelativePath()); err != nil {
				return nil, false, err
			}
			if _, _, err := publishModelObjectIfAbsent(modelsRoot, file.GetSha256(), viewPath); err != nil {
				return nil, false, err
			}
			continue
		}
		linked, _, linkErr := viewFileLinkedToObject(modelsRoot, file.GetSha256(), viewPath)
		if linkErr != nil {
			return nil, false, linkErr
		}
		if !linked {
			return nil, false, &modelAssetReconciliationError{Reason: fmt.Sprintf("view file %q is not linked to its published object; explicit offline conversion is required", file.GetRelativePath())}
		}
	}
	registered, skipped, err := s.commitAdoptedModelAssetView(asset, distribution, absolute, options)
	if err != nil || skipped {
		return registered, skipped, err
	}
	s.cacheVerifiedViewFiles(registered, absolute)
	return registered, false, nil
}

// commitAdoptedModelAssetView is the metadata boundary of a recovery: it
// re-checks directory ownership and equivalence under the mutation lock and
// saves the inventory as the commit point.
func (s *Service) commitAdoptedModelAssetView(asset *runtimev1.ModelAssetRecord, distribution modelDistribution, absolute string, options modelAssetAdoptionOptions) (*runtimev1.ModelAssetRecord, bool, error) {
	s.lockModelAssetMutation()
	defer s.modelAssetMutationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	id := asset.GetModelAssetId()
	if reason := s.modelAssetRecoveryBlockedReasonLocked(id, absolute); reason != "" {
		return nil, false, &modelAssetReconciliationError{Reason: reason}
	}
	if existing := s.modelAssets[id]; existing != nil {
		if canonicalReportPath(s.modelAssetDirectories[id]) == canonicalReportPath(absolute) {
			// A concurrent recovery of the same view already committed.
			return cloneModelAsset(existing), true, nil
		}
		return nil, false, &modelAssetReconciliationError{Reason: fmt.Sprintf("ModelAsset %s is already registered at another directory", id)}
	}
	if equivalents := s.equivalentModelAssetsLocked(distribution); len(equivalents) > 0 {
		return nil, false, &modelAssetReconciliationError{Reason: fmt.Sprintf("distribution is equivalent to committed ModelAsset %s; offline merge is required", equivalents[0].GetModelAssetId())}
	}
	if s.modelAssets == nil {
		s.modelAssets = make(map[string]*runtimev1.ModelAssetRecord)
	}
	if s.modelAssetDirectories == nil {
		s.modelAssetDirectories = make(map[string]string)
	}
	asset.LatestIntegrityCheckedAt = nowISO()
	s.modelAssets[id] = cloneModelAsset(asset)
	s.modelAssetDirectories[id] = absolute
	previousCleanup := s.terminalizeCleanupObligationsForDirectoryLocked(absolute, id)
	if err := s.persistModelAssetStoreLocked(); err != nil {
		delete(s.modelAssets, id)
		delete(s.modelAssetDirectories, id)
		for cleanupID, obligation := range previousCleanup {
			s.modelAssetCleanupObligations[cleanupID] = obligation
		}
		return nil, false, err
	}
	if options.transferCompletion != nil {
		staged := s.stageTransferCompletionLocked(options.transferCompletion.sessionID, options.transferCompletion.phase, options.transferCompletion.message, func(summary *runtimev1.LocalTransferSessionSummary) {
			summary.AssetId = id
			summary.Disposition = runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_CREATED
		})
		if staged != nil && staged.changed {
			private := s.transferPrivateLocked(options.transferCompletion.sessionID)
			committedIntent := private.commitIntent
			private.commitIntent = nil
			private.result = &localTransferResult{Disposition: "created", ModelAssetID: id}
			if err := s.persistStateLocked(); err != nil {
				private.commitIntent = committedIntent
				s.logger.Warn("ModelAsset adopted but transfer result persistence failed", "model_asset_id", id, "error", err)
			}
			s.publishTransferEventLocked(localTransferEventFromSummary(staged.current))
		}
	}
	return cloneModelAsset(asset), false, nil
}

// A valid manifest is not permission to undo a durable removal or cancel.
// Both the optimistic CheckSync projection and the final adoption commit use
// this decision; the latter is serialized with the corresponding mutation.
func (s *Service) modelAssetRecoveryBlockedReasonLocked(id, directory string) string {
	for removedID, obligation := range s.modelAssetCleanupObligations {
		if removedID == id || (!obligation.Terminal && canonicalReportPath(obligation.ManagedDirectory) == canonicalReportPath(directory)) {
			return "MODEL_ASSET_REMOVAL_PENDING"
		}
	}
	for _, private := range s.transferPrivate {
		if private != nil && private.cancelRequested && private.commitIntent != nil &&
			(private.commitIntent.ModelAssetID == id || canonicalReportPath(private.commitIntent.ManagedDirectory) == canonicalReportPath(directory)) {
			return "MODEL_ACQUISITION_CANCELLED_CLEANUP_PENDING"
		}
	}
	return ""
}

// hashResolvedPayloadDetailed reads every payload file under directory and
// returns the ordered file inventory. It is a pure read: permission
// normalization happens once before publish, never during verification.
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
		info, err := os.Lstat(absolute)
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

// --- object quarantine (corrupt generation isolation) --------------------

// isolateModelObjectGeneration persists the quarantine target and the old
// physical identity first, then moves the corrupt object out of its canonical
// hash path. Views that still link the old inode stay unavailable and are
// removed by their own captured identities; a healthy object published later
// at the same path is a new generation this obligation never touches.
func (s *Service) isolateModelObjectGeneration(modelsRoot string, digest string, reason string) (string, error) {
	key := normalizeExactSHA256Hex(digest)
	objectPath, err := modelObjectPath(modelsRoot, key)
	if err != nil {
		return "", err
	}
	identity, info, err := modelFileIdentityOf(objectPath)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("model object is not a plain regular file")
	}
	id := "objq_" + strings.ToLower(ulid.Make().String())
	quarantinePath := filepath.Join(resolveLocalModelsPath(modelsRoot), "quarantine", "objects", key+"-"+id)
	obligation := modelObjectQuarantineObligation{
		ID: id, Digest: key, ObjectIdentity: &identity, QuarantinePath: quarantinePath, Reason: strings.TrimSpace(reason),
		Phase: modelObjectQuarantinePhaseIsolate, CreatedAt: nowISO(), UpdatedAt: nowISO(),
	}
	s.lockModelAssetMutation()
	defer s.modelAssetMutationMu.Unlock()
	s.mu.Lock()
	if s.modelObjectQuarantines == nil {
		s.modelObjectQuarantines = make(map[string]modelObjectQuarantineObligation)
	}
	s.modelObjectQuarantines[id] = obligation
	if err := s.persistModelAssetStoreLocked(); err != nil {
		delete(s.modelObjectQuarantines, id)
		s.mu.Unlock()
		return "", err
	}
	s.mu.Unlock()
	progressErr := s.progressModelObjectQuarantineLocked(modelsRoot, id)
	s.mu.RLock()
	current, exists := s.modelObjectQuarantines[id]
	s.mu.RUnlock()
	if !exists || current.Phase == modelObjectQuarantinePhaseReclaim {
		// The corrupt generation left the canonical path; its final reclaim
		// waits only for views that still reference the old identity.
		return quarantinePath, nil
	}
	if progressErr == nil {
		progressErr = errors.New("corrupt object generation is still at its canonical path")
	}
	return quarantinePath, progressErr
}

// progressModelObjectQuarantineLocked moves the captured generation to its
// quarantine target (isolate) and, once no live root references the old
// identity, removes the quarantined file (reclaim). Caller holds
// modelAssetMutationMu.
func (s *Service) progressModelObjectQuarantineLocked(modelsRoot string, id string) error {
	s.mu.RLock()
	obligation, exists := s.modelObjectQuarantines[id]
	s.mu.RUnlock()
	if !exists {
		return nil
	}
	objectPath, err := modelObjectPath(modelsRoot, obligation.Digest)
	if err != nil {
		return err
	}
	if obligation.Phase == modelObjectQuarantinePhaseIsolate {
		identity, info, err := modelFileIdentityOf(objectPath)
		switch {
		case err == nil && info.Mode().IsRegular() && obligation.ObjectIdentity != nil && identity == *obligation.ObjectIdentity:
			if err := os.MkdirAll(filepath.Dir(obligation.QuarantinePath), 0o700); err != nil {
				return s.markModelObjectQuarantinePending(id, err)
			}
			if err := os.Rename(objectPath, obligation.QuarantinePath); err != nil {
				return s.markModelObjectQuarantinePending(id, err)
			}
		case err == nil && obligation.ObjectIdentity != nil && identity != *obligation.ObjectIdentity:
			// Another generation already occupies the canonical path; the
			// captured generation either moved already or is gone.
		case err != nil && !errors.Is(err, os.ErrNotExist):
			return s.markModelObjectQuarantinePending(id, err)
		}
		quarantinedIdentity, _, quarantineErr := modelFileIdentityOf(obligation.QuarantinePath)
		if quarantineErr != nil && !errors.Is(quarantineErr, os.ErrNotExist) {
			return s.markModelObjectQuarantinePending(id, quarantineErr)
		}
		if quarantineErr == nil && obligation.ObjectIdentity != nil && quarantinedIdentity != *obligation.ObjectIdentity {
			return s.markModelObjectQuarantinePending(id, errors.New("quarantine target holds an unexpected file identity"))
		}
		s.mu.Lock()
		current := s.modelObjectQuarantines[id]
		current.Phase = modelObjectQuarantinePhaseReclaim
		current.PendingReason = ""
		current.UpdatedAt = nowISO()
		s.modelObjectQuarantines[id] = current
		err = s.persistModelAssetStoreLocked()
		if err != nil {
			s.modelObjectQuarantines[id] = obligation
		}
		s.mu.Unlock()
		if err != nil {
			return err
		}
		obligation = current
	}
	if obligation.Phase == modelObjectQuarantinePhaseReclaim {
		if obligation.ObjectIdentity != nil && s.modelFileIdentityReferencedByViews(*obligation.ObjectIdentity) {
			return s.markModelObjectQuarantinePending(id, errors.New("views still reference the isolated generation"))
		}
		if err := os.Remove(obligation.QuarantinePath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return s.markModelObjectQuarantinePending(id, err)
		}
		s.mu.Lock()
		delete(s.modelObjectQuarantines, id)
		err := s.persistModelAssetStoreLocked()
		if err != nil {
			s.modelObjectQuarantines[id] = obligation
		}
		s.mu.Unlock()
		return err
	}
	return nil
}

func (s *Service) markModelObjectQuarantinePending(id string, cause error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	before, exists := s.modelObjectQuarantines[id]
	if !exists {
		return cause
	}
	current := before
	current.Attempts++
	current.PendingReason = cause.Error()
	current.UpdatedAt = nowISO()
	s.modelObjectQuarantines[id] = current
	if err := s.persistModelAssetStoreLocked(); err != nil {
		s.modelObjectQuarantines[id] = before
	}
	return cause
}

// modelFileIdentityReferencedByViews reports whether any committed view file
// or pending cleanup obligation still carries the physical identity.
func (s *Service) modelFileIdentityReferencedByViews(identity modelFileIdentity) bool {
	s.mu.RLock()
	assets := make(map[string]*runtimev1.ModelAssetRecord, len(s.modelAssets))
	directories := make(map[string]string, len(s.modelAssetDirectories))
	for id, asset := range s.modelAssets {
		assets[id] = cloneModelAsset(asset)
		directories[id] = s.modelAssetDirectories[id]
	}
	obligations := make([]modelAssetCleanupObligation, 0, len(s.modelAssetCleanupObligations))
	for _, obligation := range s.modelAssetCleanupObligations {
		obligations = append(obligations, obligation)
	}
	s.mu.RUnlock()
	for id, asset := range assets {
		for _, file := range asset.GetFiles() {
			candidate, info, err := modelFileIdentityOf(filepath.Join(directories[id], filepath.FromSlash(file.GetRelativePath())))
			if err == nil && info.Mode().IsRegular() && candidate == identity {
				return true
			}
		}
	}
	for _, obligation := range obligations {
		if obligation.Terminal || obligation.Phase == modelAssetCleanupPhaseReclaimObjects {
			continue
		}
		for _, file := range obligation.Files {
			if file.Identity != nil && *file.Identity == identity {
				return true
			}
		}
	}
	return false
}

// retryModelObjectQuarantines also runs whenever an execution Host goes idle,
// so it releases admission holds only when there is a generation to move.
func (s *Service) retryModelObjectQuarantines() {
	s.modelAssetMutationMu.Lock()
	defer s.modelAssetMutationMu.Unlock()
	s.retryModelObjectQuarantinesLocked(s.resolvedLocalModelsPath())
}

// retryModelObjectQuarantinesLocked progresses every isolated generation.
// Caller holds modelAssetMutationMu.
func (s *Service) retryModelObjectQuarantinesLocked(modelsRoot string) {
	s.mu.RLock()
	ids := make([]string, 0, len(s.modelObjectQuarantines))
	for id := range s.modelObjectQuarantines {
		ids = append(ids, id)
	}
	open := s.modelAssetReclamationOpen && s.modelAssetStoreRestriction == nil
	s.mu.RUnlock()
	if !open || len(ids) == 0 {
		return
	}
	s.releaseAdmissionHolds()
	sort.Strings(ids)
	for _, id := range ids {
		_ = s.progressModelObjectQuarantineLocked(modelsRoot, id)
	}
}
