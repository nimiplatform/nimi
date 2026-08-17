package localservice

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	defaultHFDownloadBaseURL          = "https://huggingface.co"
	localModelDownloadTimeout         = 30 * time.Minute
	localModelDownloadMaxBodyBytes    = 64 << 30
	localArtifactDownloadTimeout      = 30 * time.Minute
	localArtifactDownloadMaxBodyBytes = 64 << 30
	// localModelDownloadMaxAttempts bounds the automatic retry-with-backoff loop
	// for a single managed model file. Multi-GB first-run downloads should feel
	// like a launcher download manager: transient network drops keep resuming in
	// the background for a long window before the job finally fails closed.
	localModelDownloadMaxAttempts = 64
	// localModelDownloadRetryBackoff is the base backoff between transient
	// retries; the loop applies an exponential-ish multiple per attempt.
	localModelDownloadRetryBackoff = 2 * time.Second
)

// errModelDownloadHashMismatch is the non-transient failure for a verified
// sha256 mismatch on the assembled file: the retry loop must never retry it and
// the caller must discard the `.download` partial.
var errModelDownloadHashMismatch = errors.New("model file hash mismatch")

type managedDownloadedModelSpec struct {
	modelID           string
	displayName       string
	catalogAssetID    string
	catalogTemplateID string
	kind              runtimev1.LocalAssetKind
	capabilities      []string
	engine            string
	entry             string
	files             []string
	license           string
	repo              string
	revision          string
	hashes            map[string]string
	engineConfig      *structpb.Struct
}

type managedModelDownloadResumePlan struct {
	spec          managedDownloadedModelSpec
	bytesReceived int64
	bytesTotal    int64
}

// @nimi-authority: rule.nimi.runtime.local-compute.r090
// rebuildManagedModelDownloadResumePlan reconstructs every download and commit
// fact from the persisted asset identity plus the current verified catalog. No
// process-local install plan is treated as durable. The measured staging bytes
// are the fetched on-disk prefix projected before the resumed worker starts.
func (s *Service) rebuildManagedModelDownloadResumePlan(assetID string, transferID string) (managedModelDownloadResumePlan, string, error) {
	descriptor := s.verifiedAssetDescriptorForAssetID(assetID)
	if descriptor == nil {
		reason := runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND.String()
		return managedModelDownloadResumePlan{}, reason, grpcerr.WithReasonCodeOptions(
			codes.NotFound,
			runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND,
			grpcerr.ReasonOptions{Message: "transfer asset is no longer present in the verified catalog"},
		)
	}

	files := normalizeStringSlice(descriptor.GetFiles())
	entry := strings.TrimSpace(descriptor.GetEntry())
	if len(files) == 0 && entry != "" {
		files = []string{entry}
	}
	invalid := func(message string) (managedModelDownloadResumePlan, string, error) {
		reason := runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID.String()
		return managedModelDownloadResumePlan{}, reason, grpcerr.WithReasonCodeOptions(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			grpcerr.ReasonOptions{Message: message},
		)
	}
	if strings.TrimSpace(descriptor.GetRepo()) == "" || len(files) == 0 {
		return invalid("catalog descriptor cannot rebuild the transfer download source")
	}
	for _, file := range files {
		relativeFile, err := normalizeArtifactRelativeFile(file)
		if err != nil {
			return invalid("catalog descriptor contains an invalid transfer file path")
		}
		if expectedModelSHA256(descriptor.GetHashes(), relativeFile) == "" {
			return invalid("catalog descriptor cannot rebuild the transfer expected sha256")
		}
	}
	if entry == "" {
		entry = files[0]
	}

	modelsRoot, err := s.resolveManagedBundleModelsRoot()
	if err != nil {
		return managedModelDownloadResumePlan{}, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String(), err
	}
	bytesReceived, err := managedModelDownloadStagedBytes(modelsRoot, managedModelAcquisitionStorageID(descriptor.GetAssetId(), transferID), files)
	if err != nil {
		reason := runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String()
		return managedModelDownloadResumePlan{}, reason, grpcerr.WrapWithReasonCode(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
			err,
			grpcerr.ReasonOptions{Message: "transfer staging prefix could not be measured"},
		)
	}

	return managedModelDownloadResumePlan{
		spec: managedDownloadedModelSpec{
			modelID:           strings.TrimSpace(descriptor.GetAssetId()),
			displayName:       strings.TrimSpace(descriptor.GetTitle()),
			catalogAssetID:    strings.TrimSpace(descriptor.GetAssetId()),
			catalogTemplateID: strings.TrimSpace(descriptor.GetTemplateId()),
			kind:              descriptor.GetKind(),
			capabilities:      append([]string(nil), descriptor.GetCapabilities()...),
			engine:            strings.TrimSpace(descriptor.GetEngine()),
			entry:             entry,
			files:             files,
			license:           descriptor.GetLicense(),
			repo:              descriptor.GetRepo(),
			revision:          defaultString(descriptor.GetRevision(), "main"),
			hashes:            cloneStringMap(descriptor.GetHashes()),
			engineConfig:      cloneStruct(descriptor.GetEngineConfig()),
		},
		bytesReceived: bytesReceived,
		bytesTotal:    clampInt64Minimum(descriptor.GetTotalSizeBytes(), 0),
	}, "", nil
}

// managedModelDownloadStagedBytes measures bytes fetched into one asset's
// stable staging custody. Known catalog files include already-verified files
// plus a current `.download` prefix; without a descriptor (startup healing
// before a later typed resume failure), only resumable `.download` files count.
func managedModelDownloadStagedBytes(modelsRoot string, storageID string, files []string) (int64, error) {
	if strings.TrimSpace(modelsRoot) == "" || !filepath.IsAbs(modelsRoot) {
		return 0, fmt.Errorf("managed model staging requires an absolute models root")
	}
	stageDir := managedModelDownloadStageDir(modelsRoot, storageID)
	var total int64
	if len(files) > 0 {
		for _, file := range files {
			relativeFile, err := normalizeArtifactRelativeFile(file)
			if err != nil {
				return 0, err
			}
			targetPath := filepath.Join(stageDir, filepath.FromSlash(relativeFile))
			measured := targetPath + ".download"
			info, statErr := os.Lstat(measured)
			if os.IsNotExist(statErr) {
				measured = targetPath
				info, statErr = os.Lstat(measured)
			}
			if os.IsNotExist(statErr) {
				continue
			}
			if statErr != nil {
				return 0, fmt.Errorf("stat managed model staging file: %w", statErr)
			}
			if !info.Mode().IsRegular() {
				return 0, fmt.Errorf("managed model staging path is not a regular file: %s", measured)
			}
			total += info.Size()
		}
		return total, nil
	}

	walkErr := filepath.WalkDir(stageDir, func(path string, entry os.DirEntry, err error) error {
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".download") {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("managed model staging path is not a regular file: %s", path)
		}
		total += info.Size()
		return nil
	})
	if os.IsNotExist(walkErr) {
		return 0, nil
	}
	if walkErr != nil {
		return 0, fmt.Errorf("walk managed model download staging: %w", walkErr)
	}
	return total, nil
}

// @nimi-authority: rule.nimi.runtime.local-compute.r029
// @nimi-authority: rule.nimi.runtime.local-compute.r030
func (s *Service) installManagedDownloadedModel(
	ctx context.Context,
	spec managedDownloadedModelSpec,
) (*runtimev1.ModelAssetRecord, error) {
	return s.installManagedDownloadedModelWithTransfer(ctx, spec, "")
}

// installManagedDownloadedModelWithTransfer runs the managed download/install
// pipeline either with a new transfer session or with an explicitly restored
// session whose executor was rebuilt by ResumeLocalTransfer.
func (s *Service) installManagedDownloadedModelWithTransfer(
	ctx context.Context,
	spec managedDownloadedModelSpec,
	restoredTransferID string,
) (*runtimev1.ModelAssetRecord, error) {
	modelID := strings.TrimSpace(spec.modelID)
	if modelID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	if strings.TrimSpace(spec.repo) == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{
			Message: "downloaded model requires repo",
		})
	}
	files := normalizeStringSlice(spec.files)
	capabilities := normalizeAssetCapabilities(spec.capabilities)
	kind := spec.kind
	if kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
		kind = inferAssetKindFromCapabilities(capabilities)
	}
	if !isRunnableKind(kind) && (strings.TrimSpace(spec.engine) != "" || spec.engineConfig != nil) {
		return nil, grpcerr.WithReasonCodeOptions(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			grpcerr.ReasonOptions{Message: "downloaded passive asset cannot declare execution engine fields"},
		)
	}
	if len(files) == 0 {
		files = []string{strings.TrimSpace(spec.entry)}
	}
	if len(files) == 0 {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{
			Message: "downloaded model requires at least one file",
		})
	}
	modelsRoot, err := s.resolveManagedBundleModelsRoot()
	if err != nil {
		return nil, err
	}
	transferID := strings.TrimSpace(restoredTransferID)
	if transferID == "" {
		transfer := s.newLocalTransfer(localTransferKindDownload, localTransferMutation{
			ModelID:   modelID,
			Phase:     "download",
			State:     localTransferStateRunning,
			Message:   "downloading managed model bundle",
			Retryable: true,
		})
		transferID = transfer.GetInstallSessionId()
	} else {
		transfer := s.localTransferSummary(transferID)
		if transfer.GetInstallSessionId() == "" || normalizeTransferKind(transfer.GetSessionKind()) != localTransferKindDownload ||
			strings.TrimSpace(transfer.GetAssetId()) != modelID || isTerminalTransferState(transfer.GetState()) {
			return nil, fmt.Errorf("restored managed model transfer %q is unavailable", transferID)
		}
		_ = s.mutateLocalTransfer(transferID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
			summary.Phase = "download"
			summary.State = localTransferStateRunning
			summary.Message = "resuming managed model bundle download"
			summary.ReasonCode = ""
			summary.Retryable = true
		})
	}
	storageID := managedModelAcquisitionStorageID(modelID, transferID)
	logicalModelID := storageID
	modelDir, err := resolveRuntimeManagedModelBundleDir(modelsRoot, logicalModelID)
	if err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "downloaded model storage identity is invalid"},
		)
	}
	stagingDir, err := prepareManagedModelDownloadStageDir(modelsRoot, storageID)
	if err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, err
	}

	success := false
	preserveStaging := false
	defer func() {
		if !success && !preserveStaging {
			_ = os.RemoveAll(stagingDir)
		}
	}()

	actualHashes := make(map[string]string, len(files))
	for _, file := range files {
		relativeFile, err := normalizeArtifactRelativeFile(file)
		if err != nil {
			s.failTransfer(transferID, err.Error(), false)
			return nil, err
		}
		targetPath := filepath.Join(stagingDir, filepath.FromSlash(relativeFile))
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			s.failTransfer(transferID, fmt.Sprintf("create model file dir %q: %v", relativeFile, err), false)
			return nil, fmt.Errorf("create model file dir %q: %w", relativeFile, err)
		}
		fileHash, err := s.downloadManagedModelFile(ctx, transferID, spec.repo, spec.revision, relativeFile, targetPath, spec.hashes)
		if err != nil {
			switch {
			case errors.Is(err, errLocalTransferCancelled):
				s.cancelTransfer(transferID, "transfer cancelled")
			case errors.Is(err, errModelDownloadHashMismatch):
				s.failTransfer(transferID, err.Error(), false)
			case errors.Is(err, context.Canceled) && rpcctx.WasServerShutdown(ctx):
				preserveStaging = true
				s.interruptTransfer(transferID, "transfer interrupted by runtime shutdown")
			case errors.Is(err, context.Canceled):
				preserveStaging = true
				s.failTransfer(transferID, err.Error(), true)
			case isRetryableManagedModelDownloadError(err):
				preserveStaging = true
				s.failTransfer(transferID, err.Error(), true)
			default:
				s.failTransfer(transferID, err.Error(), false)
			}
			return nil, err
		}
		actualHashes[relativeFile] = "sha256:" + fileHash
	}
	entryFile := strings.TrimSpace(spec.entry)
	if entryFile == "" && len(files) > 0 {
		entryFile = files[0]
	}
	entryPath := filepath.Join(stagingDir, filepath.FromSlash(entryFile))
	if err := validateManagedModelEntryFile(entryPath); err != nil {
		s.failTransfer(transferID, err.Error(), false)
		return nil, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "downloaded model entry is invalid"},
		)
	}
	activation, err := activateManagedModelBundle(modelDir, stagingDir)
	if err != nil {
		quarantinePath, quarantineErr := s.quarantineManagedModelBundle(
			modelsRoot,
			logicalModelID,
			stagingDir,
			"managed_model_download_install",
			fmt.Sprintf("activate bundle: %v", err),
			modelID,
		)
		if quarantineErr != nil {
			s.failTransfer(transferID, fmt.Sprintf("activate managed model bundle: %v; quarantine=%v", err, quarantineErr), false)
			return nil, fmt.Errorf("activate managed model bundle: %v; quarantine=%w", err, quarantineErr)
		}
		if strings.TrimSpace(quarantinePath) != "" {
			s.failTransfer(transferID, fmt.Sprintf("activate managed model bundle: %v; quarantine=%s", err, quarantinePath), false)
		} else {
			s.failTransfer(transferID, fmt.Sprintf("activate managed model bundle: %v", err), false)
		}
		return nil, fmt.Errorf("activate managed model bundle: %w", err)
	}
	success = true

	s.updateTransferProgress(transferID, "register", 0, 0, "registering ModelAsset")
	provenance := map[string]any{
		"source_kind":     "managed_download",
		"source_repo":     strings.TrimSpace(spec.repo),
		"source_revision": defaultString(strings.TrimSpace(spec.revision), "main"),
		"distribution":    "directory",
	}
	if catalogAssetID := strings.TrimSpace(spec.catalogAssetID); catalogAssetID != "" {
		provenance["source_kind"] = "catalog_install"
		provenance["catalog_asset_id"] = catalogAssetID
		provenance["catalog_template_id"] = defaultString(strings.TrimSpace(spec.catalogTemplateID), catalogAssetID)
	}
	modelAsset, _, err := s.adoptResolvedModelAssetDirectoryWithOptions(ctx, modelDir, modelAssetAdoptionOptions{
		displayName:         defaultString(strings.TrimSpace(spec.displayName), modelID),
		preferredEntry:      entryFile,
		provenance:          provenance,
		requireCatalogMatch: strings.TrimSpace(spec.catalogAssetID) != "",
	})
	if err != nil {
		if quarantinePath, rollbackErr := activation.Rollback(
			s,
			modelsRoot,
			logicalModelID,
			"managed_model_download_install",
			err.Error(),
			modelID,
		); rollbackErr != nil {
			s.failTransfer(transferID, fmt.Sprintf("%s; rollback=%v", err.Error(), rollbackErr), false)
			return nil, err
		} else if strings.TrimSpace(quarantinePath) != "" {
			s.failTransfer(transferID, fmt.Sprintf("%s; quarantine=%s", err.Error(), quarantinePath), false)
			return nil, err
		}
		s.failTransfer(transferID, err.Error(), false)
		return nil, err
	}
	if commitErr := activation.Commit(); commitErr != nil {
		s.logger.Warn("cleanup managed bundle backup failed after download install", "logical_model_id", logicalModelID, "error", commitErr)
	}
	s.completeTransfer(transferID, "register", "ModelAsset installed", func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.AssetId = modelAsset.GetModelAssetId()
	})
	return modelAsset, nil
}

// resolveManagedBundleModelsRoot resolves the absolute models root a managed
// bundle install must stage and activate under. This is the single
// synchronized config-sourced Runtime models root — `s.resolvedLocalModelsPath()`
// → `<dataRootRef>/models` (config.resolveLocalModelsPath / NewDataPlaneModel) —
// the same root every other models-root consumer reads (verify, engine
// activation, warm, residency, media).
//
// An empty or relative resolved root fails closed with a typed reason code: the
// runtime must never stage a multi-GB bundle into a relative `resolved/`
// directory resolved against its process CWD (the repo working tree on a
// desktop-bridge runtime). A relative model root is a fail-close condition, not
// a default — the desktop config sync must supply the user-selected data root
// before materialization.
func (s *Service) resolveManagedBundleModelsRoot() (string, error) {
	modelsRoot := strings.TrimSpace(s.resolvedLocalModelsPath())
	if modelsRoot == "" || !filepath.IsAbs(modelsRoot) {
		return "", grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "managed model install requires an absolute models root; runtime has no resolved data root",
			ActionHint: "select_nimi_data_root",
		})
	}
	return modelsRoot, nil
}

func (s *Service) downloadManagedModelFile(
	ctx context.Context,
	sessionID string,
	repo string,
	revision string,
	relativeFile string,
	targetPath string,
	hashes map[string]string,
) (string, error) {
	requestURL, err := buildHFResolveURL(
		defaultString(strings.TrimSpace(s.hfDownloadBaseURL), defaultHFDownloadBaseURL),
		repo,
		defaultString(revision, "main"),
		relativeFile,
	)
	if err != nil {
		return "", err
	}
	expectedHash := expectedModelSHA256(hashes, relativeFile)
	if expectedHash == "" {
		return "", fmt.Errorf("model file %q requires admitted expected sha256 before download", relativeFile)
	}
	timeout := s.modelDownloadTimeout
	if timeout <= 0 {
		timeout = localModelDownloadTimeout
	}
	maxBodyBytes := s.modelDownloadMaxBodyBytes
	if maxBodyBytes <= 0 {
		maxBodyBytes = localModelDownloadMaxBodyBytes
	}

	_ = s.mutateLocalTransfer(sessionID, false, func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.Phase = "download"
		summary.Message = "downloading " + relativeFile
		summary.State = localTransferStateRunning
	})

	header := http.Header{}
	header.Set("User-Agent", "nimi-runtime/0.1")

	result, err := s.downloadToFileWithTransfer(
		ctx,
		sessionID,
		"download",
		requestURL,
		targetPath,
		expectedHash,
		maxBodyBytes,
		header,
		timeout,
	)
	if err != nil {
		if errors.Is(err, errLocalTransferCancelled) {
			return "", err
		}
		if errors.Is(err, filedownload.ErrHashMismatch) {
			return "", fmt.Errorf("model file %q: %w: %v", relativeFile, errModelDownloadHashMismatch, err)
		}
		return "", fmt.Errorf("download model file %q: %w", relativeFile, err)
	}
	return result.SHA256, nil
}

// isTransientModelDownloadError classifies a model-download transport/stream
// error as worth a shared-core retry. Mid-stream connection drops
// (`unexpected EOF`), connection resets, broken pipes, and network timeouts
// are transient; the core handles 5xx, hash mismatch, 4xx, oversize and
// context cancellation itself and never routes them here.
func isRetryableManagedModelDownloadError(err error) bool {
	if err == nil || errors.Is(err, errModelDownloadHashMismatch) || errors.Is(err, errLocalTransferCancelled) {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, filedownload.ErrTransientAttemptsExhausted) {
		return true
	}
	var pathErr *os.PathError
	return errors.As(err, &pathErr) || isTransientModelDownloadError(err)
}

func (s *Service) discardManagedModelDownloadStaging(storageID string) {
	modelsRoot := strings.TrimSpace(s.resolvedLocalModelsPath())
	if modelsRoot == "" || !filepath.IsAbs(modelsRoot) || strings.TrimSpace(storageID) == "" {
		return
	}
	_ = os.RemoveAll(managedModelDownloadStageDir(modelsRoot, storageID))
}

func isTransientModelDownloadError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	lower := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(lower, "eof") ||
		strings.Contains(lower, "connection reset") ||
		strings.Contains(lower, "broken pipe") ||
		strings.Contains(lower, "connection refused") ||
		strings.Contains(lower, "tls handshake timeout") ||
		strings.Contains(lower, "timeout")
}

func normalizeArtifactRelativeFile(file string) (string, error) {
	cleaned := filepath.ToSlash(strings.TrimSpace(file))
	if cleaned == "" || cleaned == "." || cleaned == "/" {
		return "", fmt.Errorf("empty artifact relative file path")
	}
	cleaned = strings.TrimPrefix(cleaned, "./")
	cleaned = strings.TrimPrefix(cleaned, "/")
	if strings.Contains(cleaned, "..") {
		return "", fmt.Errorf("artifact relative file path must not contain '..': %s", cleaned)
	}
	return cleaned, nil
}

func buildHFResolveURL(baseURL string, repo string, revision string, relativeFile string) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		return "", fmt.Errorf("HF base URL required")
	}
	normalizedRepo := strings.TrimSpace(repo)
	if normalizedRepo == "" {
		return "", fmt.Errorf("HF repo required")
	}
	normalizedRevision := strings.TrimSpace(revision)
	if normalizedRevision == "" {
		normalizedRevision = "main"
	}
	normalizedFile := strings.TrimSpace(relativeFile)
	if normalizedFile == "" {
		return "", fmt.Errorf("HF relative file required")
	}
	return fmt.Sprintf("%s/%s/resolve/%s/%s", base, normalizedRepo, normalizedRevision, normalizedFile), nil
}

func expectedModelSHA256(hashes map[string]string, relativeFile string) string {
	if len(hashes) == 0 {
		return ""
	}
	value := strings.TrimSpace(hashes[relativeFile])
	if value == "" {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(strings.ToLower(value), "sha256:"))
}
