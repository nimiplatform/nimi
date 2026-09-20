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
	// One initial request plus the eight exact retries admitted by r029.
	localModelDownloadMaxAttempts = 9
)

var localModelDownloadRetryDelays = []time.Duration{
	300 * time.Millisecond,
	1 * time.Second,
	5 * time.Second,
	15 * time.Second,
	30 * time.Second,
	60 * time.Second,
	120 * time.Second,
	180 * time.Second,
}

// errModelDownloadHashMismatch is the non-transient failure for a verified
// sha256 mismatch on the assembled file: the retry loop must never retry it and
// the caller must discard the `.download` partial.
var errModelDownloadHashMismatch = errors.New("model file hash mismatch")

// managedDownloadedModelSpec is the immutable source of a catalog
// acquisition. It never changes once the transfer is durable; the acquisition
// result (created or reused, final model_asset_id) lives separately on the
// transfer.
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
	sourceProvenance  string
	repo              string
	revision          string
	hashes            map[string]string
	totalSizeBytes    int64
	engineConfig      *structpb.Struct
	planID            string
}

type managedModelDownloadResumePlan struct {
	spec          managedDownloadedModelSpec
	bytesReceived int64
	bytesTotal    int64
}

// @nimi-authority: rule.nimi.runtime.local-compute.r090
// rebuildManagedModelDownloadResumePlan reconstructs every download and commit
// fact from the immutable spec captured in the durable transfer row. It never
// re-reads the current catalog or a process-local install plan. The measured
// staging bytes are the fetched on-disk prefix projected before the worker starts.
func (s *Service) rebuildManagedModelDownloadResumePlan(transferID string) (managedModelDownloadResumePlan, string, error) {
	s.mu.RLock()
	spec, exists := s.managedModelDownloadSpecs[strings.TrimSpace(transferID)]
	summary := cloneLocalTransferSummary(s.transfers[strings.TrimSpace(transferID)])
	s.mu.RUnlock()
	if !exists || summary == nil {
		reason := runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID.String()
		return managedModelDownloadResumePlan{}, reason, grpcerr.WithReasonCodeOptions(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			grpcerr.ReasonOptions{Message: "transfer has no durable managed download spec"},
		)
	}

	modelsRoot, err := s.resolveManagedBundleModelsRoot()
	if err != nil {
		return managedModelDownloadResumePlan{}, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String(), err
	}
	bytesReceived, err := managedModelDownloadStagedBytes(modelsRoot, transferID, spec.files)
	if err != nil {
		reason := runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String()
		return managedModelDownloadResumePlan{}, reason, grpcerr.WrapWithReasonCode(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
			err,
			grpcerr.ReasonOptions{Message: "transfer staging prefix could not be measured"},
		)
	}

	bytesTotal := clampInt64Minimum(spec.totalSizeBytes, 0)
	if bytesTotal == 0 {
		bytesTotal = clampInt64Minimum(summary.GetBytesTotal(), 0)
	}
	return managedModelDownloadResumePlan{
		spec:          cloneManagedDownloadedModelSpec(spec),
		bytesReceived: bytesReceived,
		bytesTotal:    bytesTotal,
	}, "", nil
}

// managedModelDownloadStagedBytes measures bytes fetched into one transfer's
// own staging: completed files not yet published plus a current `.download`
// prefix. It never counts another transfer's material.
func managedModelDownloadStagedBytes(modelsRoot string, transferID string, files []string) (int64, error) {
	if strings.TrimSpace(modelsRoot) == "" || !filepath.IsAbs(modelsRoot) {
		return 0, fmt.Errorf("managed model staging requires an absolute models root")
	}
	stageDir := managedModelDownloadStageDir(modelsRoot, transferID)
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
	record, _, err := s.installManagedDownloadedModelWithTransfer(ctx, spec, "")
	return record, err
}

func managedModelTransferTerminalError(cause error, persistenceErr error) error {
	if persistenceErr != nil {
		return localTransferPersistenceError(persistenceErr)
	}
	return cause
}

// managedModelDownloadDistribution derives the acquisition's distribution
// from the immutable spec. Sizes are unknown (0) until each object is
// verified; the commit compares complete, verified distributions.
func managedModelDownloadDistribution(spec managedDownloadedModelSpec) (modelDistribution, error) {
	files := make([]modelDistributionFile, 0, len(spec.files))
	for _, file := range spec.files {
		files = append(files, modelDistributionFile{
			RelativePath: file, SHA256: expectedModelSHA256(spec.hashes, file), SizeBytes: 0,
			NonExecutableContent: modelDistributionFileNonExecutable(file),
		})
	}
	return newModelDistribution(spec.entry, files)
}

// installManagedDownloadedModelWithTransfer runs the managed acquisition
// pipeline either with a new transfer session or with an explicitly restored
// session whose executor was rebuilt by ResumeLocalTransfer.
//
// Order: durable transfer → link-support probe → equivalent committed asset
// (verified by reading, committed as reused) → per file: verified published
// object (reused) or single-writer fetch into this transfer's own staging,
// publish-if-absent, pin → view creation with a durable create intent →
// inventory commit (created) with a concurrent-winner re-check.
func (s *Service) installManagedDownloadedModelWithTransfer(
	ctx context.Context,
	spec managedDownloadedModelSpec,
	restoredTransferID string,
) (modelAssetResult *runtimev1.ModelAssetRecord, installSessionID string, resultErr error) {
	if restriction := s.ModelAssetInventoryRestriction(); restriction != nil {
		return nil, "", modelAssetRestrictionRPCError(restriction)
	}
	canonicalSpec, err := canonicalManagedDownloadedModelSpec(spec)
	if err != nil {
		return nil, "", grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "managed download spec is invalid"},
		)
	}
	spec = canonicalSpec
	modelID := strings.TrimSpace(spec.modelID)
	if modelID == "" {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	}
	if strings.TrimSpace(spec.repo) == "" {
		return nil, "", grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{
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
		return nil, "", grpcerr.WithReasonCodeOptions(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			grpcerr.ReasonOptions{Message: "downloaded passive asset cannot declare execution engine fields"},
		)
	}
	if len(files) == 0 {
		return nil, "", grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, grpcerr.ReasonOptions{
			Message: "downloaded model requires at least one file",
		})
	}
	distribution, err := managedModelDownloadDistribution(spec)
	if err != nil {
		return nil, "", grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, err, grpcerr.ReasonOptions{Message: "managed download distribution is invalid"})
	}
	modelsRoot, err := s.resolveManagedBundleModelsRoot()
	if err != nil {
		return nil, "", err
	}
	transferID := strings.TrimSpace(restoredTransferID)
	if transferID == "" {
		transfer, createErr := s.newManagedModelDownloadTransfer(localTransferMutation{
			Phase:       "download",
			State:       localTransferStateRunning,
			BytesTotal:  clampInt64Minimum(spec.totalSizeBytes, 0),
			Message:     "acquiring managed model bundle",
			Retryable:   true,
			PlanID:      spec.planID,
			SourceLabel: defaultString(strings.TrimSpace(spec.displayName), modelID),
		}, spec)
		if createErr != nil {
			return nil, "", grpcerr.WrapWithReasonCode(
				codes.Unavailable,
				runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
				createErr,
				grpcerr.ReasonOptions{Message: "managed download transfer could not be captured durably"},
			)
		}
		transferID = transfer.GetInstallSessionId()
	} else {
		transfer := s.localTransferSummary(transferID)
		if transfer.GetInstallSessionId() == "" || normalizeTransferKind(transfer.GetSessionKind()) != localTransferKindDownload || isTerminalTransferState(transfer.GetState()) {
			return nil, transferID, fmt.Errorf("restored managed model transfer %q is unavailable", transferID)
		}
		if _, persistErr := s.mutateLocalTransfer(transferID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
			summary.Phase = "download"
			summary.State = localTransferStateRunning
			summary.Message = "resuming managed model bundle acquisition"
			summary.ReasonCode = ""
			summary.Retryable = true
		}); persistErr != nil {
			return nil, transferID, localTransferPersistenceError(persistErr)
		}
	}
	executorControl := s.transferControl(transferID)
	if executorControl == nil {
		return nil, transferID, fmt.Errorf("managed model transfer %q has no executor control", transferID)
	}
	defer func() {
		s.finishManagedModelDownloadExecutor(transferID, executorControl, resultErr)
	}()
	fail := func(cause error, retryable bool) error {
		if retryable {
			// Retryable failures keep this transfer's staging and holds; only
			// the terminal state is recorded.
			return managedModelTransferTerminalError(cause, s.failTransfer(transferID, cause.Error(), true))
		}
		s.settleFailedAcquisition(transferID, cause, false)
		return cause
	}
	if err := s.ensureModelObjectLinkSupport(modelsRoot); err != nil {
		return nil, transferID, fail(modelObjectLinkSupportRPCError(err), false)
	}
	checkActive := func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		return executorControl.wait(ctx)
	}

	// Phase 1: an equivalent committed distribution is reused after a real
	// read verification of its view; nothing is fetched and no view is added.
	reused, reuseErr := s.tryReuseEquivalentModelAsset(ctx, transferID, modelsRoot, distribution, checkActive)
	if reuseErr != nil {
		return nil, transferID, fail(classifyAcquisitionFailure(reuseErr), false)
	}
	if reused != nil {
		s.releaseModelObjectHolds(transferID)
		return reused, transferID, nil
	}

	stagingDir, err := prepareManagedModelDownloadStageDir(modelsRoot, transferID)
	if err != nil {
		return nil, transferID, fail(err, false)
	}
	bundleTotal := clampInt64Minimum(spec.totalSizeBytes, 0)
	if bundleTotal == 0 {
		bundleTotal = clampInt64Minimum(s.localTransferSummary(transferID).GetBytesTotal(), 0)
	}
	var received, reusedBytes int64
	// pendingStaged is this transfer's own prefix material for files not yet
	// processed; it keeps the received projection monotonic across resume.
	pendingStaged := managedModelDownloadPendingStagedBytes(stagingDir, files)
	verifiedFiles := make([]modelDistributionFile, 0, len(files))
	for index, file := range files {
		if err := checkActive(); err != nil {
			return nil, transferID, fail(classifyDownloadInterruption(ctx, err, s, transferID), errors.Is(err, context.Canceled) && !errors.Is(err, errLocalTransferCancelled))
		}
		relativeFile, err := normalizeArtifactRelativeFile(file)
		if err != nil {
			return nil, transferID, fail(err, false)
		}
		expected := expectedModelSHA256(spec.hashes, relativeFile)
		if expected == "" {
			return nil, transferID, fail(fmt.Errorf("model file %q requires admitted expected sha256 before download", relativeFile), false)
		}
		nonExecutable := modelDistributionFileNonExecutable(relativeFile)
		targetPath := filepath.Join(stagingDir, filepath.FromSlash(relativeFile))
		pendingStaged -= managedModelDownloadStagedFileBytes(targetPath)

		// A published object for this digest is reused after verification.
		present, _, presentErr := modelObjectPresent(modelsRoot, expected)
		if presentErr != nil {
			return nil, transferID, fail(presentErr, false)
		}
		if present {
			_, size, verifyErr := verifyModelObject(modelsRoot, expected, -1, func(delta int64) error {
				s.addTransferVerifiedBytes(transferID, delta)
				return checkActive()
			})
			switch {
			case verifyErr == nil:
				// Drop any prefix this transfer fetched for the same digest: the
				// object already exists, so this position is reused, not received.
				_ = os.Remove(targetPath + ".download")
				_ = os.Remove(targetPath)
				s.pinModelObject(expected, transferID)
				reusedBytes += size
				verifiedFiles = append(verifiedFiles, modelDistributionFile{RelativePath: relativeFile, SHA256: expected, SizeBytes: size, NonExecutableContent: nonExecutable})
				s.updateTransferReuse(transferID, "verify", received+pendingStaged, reusedBytes, "reusing verified local content for "+relativeFile)
				continue
			case errors.Is(verifyErr, errLocalTransferCancelled) || errors.Is(verifyErr, context.Canceled):
				return nil, transferID, fail(classifyDownloadInterruption(ctx, verifyErr, s, transferID), errors.Is(verifyErr, context.Canceled) && !errors.Is(verifyErr, errLocalTransferCancelled))
			default:
				// An explicit acquisition met a corrupt published generation: its
				// identity and quarantine target are persisted first, then it
				// leaves the canonical path so a verified replacement can be
				// published. Views still linking the old inode stay unavailable.
				if _, isolateErr := s.isolateModelObjectGeneration(modelsRoot, expected, "published object failed verification during explicit acquisition: "+verifyErr.Error()); isolateErr != nil {
					return nil, transferID, fail(&modelAssetReconciliationError{Reason: "corrupt published model object could not be isolated", Cause: isolateErr}, false)
				}
			}
		}

		// Missing object: this transfer must be the single writer for the digest.
		if conflict := s.acquireModelObjectWriter(expected, transferID); conflict != nil {
			return nil, transferID, fail(conflict, false)
		}
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return nil, transferID, fail(fmt.Errorf("create model file dir %q: %w", relativeFile, err), false)
		}
		completedSize, completed, completedErr := inspectCompletedManagedModelDownloadFile(targetPath, expected)
		if completedErr != nil {
			return nil, transferID, fail(completedErr, isRetryableManagedModelDownloadError(completedErr))
		}
		size := completedSize
		if !completed {
			_, err = s.downloadManagedModelFile(ctx, transferID, spec.repo, spec.revision, relativeFile, targetPath, spec.hashes, received, bundleTotal, index == len(files)-1)
			if err != nil {
				switch {
				case errors.Is(err, errLocalTransferCancelled):
					return nil, transferID, fail(err, false)
				case errors.Is(err, errModelDownloadHashMismatch):
					return nil, transferID, fail(err, false)
				case errors.Is(err, context.Canceled) && rpcctx.WasServerShutdown(ctx):
					return nil, transferID, managedModelTransferTerminalError(err, s.interruptTransfer(transferID, "transfer interrupted by runtime shutdown"))
				case errors.Is(err, context.Canceled) && normalizeTransferState(s.localTransferSummary(transferID).GetState()) == localTransferStatePaused:
					return nil, transferID, err
				case errors.Is(err, context.Canceled), isRetryableManagedModelDownloadError(err):
					return nil, transferID, fail(err, true)
				default:
					return nil, transferID, fail(err, false)
				}
			}
			info, statErr := os.Lstat(targetPath)
			if statErr != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
				if statErr == nil {
					statErr = errors.New("downloaded target is not a direct regular file")
				}
				return nil, transferID, fail(fmt.Errorf("inspect downloaded model file %q: %w", relativeFile, statErr), true)
			}
			size = info.Size()
		}
		if _, err := normalizeModelPayloadPermissionsBeforePublish(targetPath, relativeFile); err != nil {
			return nil, transferID, fail(err, false)
		}
		if _, _, err := publishModelObjectIfAbsent(modelsRoot, expected, targetPath); err != nil {
			return nil, transferID, fail(err, false)
		}
		s.pinModelObject(expected, transferID)
		received += size
		verifiedFiles = append(verifiedFiles, modelDistributionFile{RelativePath: relativeFile, SHA256: expected, SizeBytes: size, NonExecutableContent: nonExecutable})
		s.updateTransferReuse(transferID, "download", received+pendingStaged, reusedBytes, "verified "+relativeFile)
	}
	// Every file is a published, pinned object now; the transfer's exclusive
	// staging holds nothing a resume would need.
	if err := os.RemoveAll(stagingDir); err != nil {
		s.logger.Warn("acquisition staging cleanup pending after publish", "transfer_id", transferID, "directory", stagingDir, "error", err)
	}
	if bundleTotal > 0 && received+reusedBytes != bundleTotal {
		err := fmt.Errorf("managed model bundle size mismatch: expected=%d actual=%d", bundleTotal, received+reusedBytes)
		return nil, transferID, fail(err, false)
	}
	verifiedDistribution, err := newModelDistribution(spec.entry, verifiedFiles)
	if err != nil {
		return nil, transferID, fail(err, false)
	}
	entryPath, entryErr := modelObjectPath(modelsRoot, expectedModelSHA256(spec.hashes, spec.entry))
	if entryErr != nil {
		return nil, transferID, fail(entryErr, false)
	}
	if err := validateManagedModelEntryFile(entryPath); err != nil {
		failure := grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID,
			err,
			grpcerr.ReasonOptions{Message: "downloaded model entry is invalid"},
		)
		return nil, transferID, fail(failure, false)
	}
	if err := checkActive(); err != nil {
		return nil, transferID, fail(classifyDownloadInterruption(ctx, err, s, transferID), errors.Is(err, context.Canceled) && !errors.Is(err, errLocalTransferCancelled))
	}

	provenance := map[string]any{
		"source_kind":     "managed_download",
		"source_repo":     strings.TrimSpace(spec.repo),
		"source_revision": defaultString(strings.TrimSpace(spec.revision), "main"),
		"distribution":    "directory",
	}
	if license := strings.TrimSpace(spec.license); license != "" {
		provenance["license"] = license
	}
	if sourceProvenance := strings.TrimSpace(spec.sourceProvenance); sourceProvenance != "" {
		provenance["source_provenance"] = sourceProvenance
	}
	if catalogAssetID := strings.TrimSpace(spec.catalogAssetID); catalogAssetID != "" {
		provenance["source_kind"] = "catalog_install"
		provenance["catalog_asset_id"] = catalogAssetID
		provenance["catalog_template_id"] = defaultString(strings.TrimSpace(spec.catalogTemplateID), catalogAssetID)
	}
	fingerprint, unclassified := managedDownloadFingerprint(modelsRoot, verifiedDistribution)
	containsCode := false
	for _, file := range verifiedDistribution.Files {
		containsCode = containsCode || file.NonExecutableContent
	}
	s.updateTransferReuse(transferID, "register", received, reusedBytes, "registering ModelAsset")
	record, _, err := s.commitManagedModelAssetView(ctx, transferID, modelsRoot, modelAssetIntake{
		distribution: verifiedDistribution, displayName: defaultString(strings.TrimSpace(spec.displayName), modelID),
		provenance: provenance, fingerprint: fingerprint, unclassified: unclassified, containsCode: containsCode,
		catalogMatched: s.modelAssetCatalogMatch(normalizedManagedDownloadHashes(files, spec.hashes)),
		completion:     modelAssetTransferCompletion{sessionID: transferID, phase: "register", message: "ModelAsset installed"},
	}, received, reusedBytes)
	if err != nil {
		return nil, transferID, fail(classifyAcquisitionFailure(err), false)
	}
	s.releaseModelObjectHolds(transferID)
	return record, transferID, nil
}

// managedModelDownloadStagedFileBytes measures one file's material in this
// transfer's staging: a `.download` prefix or a completed but unpublished file.
func managedModelDownloadStagedFileBytes(targetPath string) int64 {
	for _, candidate := range []string{targetPath + ".download", targetPath} {
		info, err := os.Lstat(candidate)
		if err == nil && info.Mode().IsRegular() {
			return info.Size()
		}
	}
	return 0
}

func managedModelDownloadPendingStagedBytes(stagingDir string, files []string) int64 {
	var total int64
	for _, file := range files {
		relativeFile, err := normalizeArtifactRelativeFile(file)
		if err != nil {
			continue
		}
		total += managedModelDownloadStagedFileBytes(filepath.Join(stagingDir, filepath.FromSlash(relativeFile)))
	}
	return total
}

// classifyDownloadInterruption maps a context or control interruption to the
// executor's terminal cause without inventing a network failure.
func classifyDownloadInterruption(ctx context.Context, err error, s *Service, transferID string) error {
	if errors.Is(err, errLocalTransferCancelled) {
		return errLocalTransferCancelled
	}
	if errors.Is(err, context.Canceled) && rpcctx.WasServerShutdown(ctx) {
		_ = s.interruptTransfer(transferID, "transfer interrupted by runtime shutdown")
	}
	return err
}

// classifyAcquisitionFailure gives reconciliation and conflict causes their
// typed public form while preserving the cause chain.
func classifyAcquisitionFailure(err error) error {
	var conflict *modelObjectConflict
	if errors.As(err, &conflict) {
		return conflict
	}
	var reconciliation *modelAssetReconciliationError
	if errors.As(err, &reconciliation) {
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_INVENTORY_RECONCILIATION_REQUIRED, err, grpcerr.ReasonOptions{
			Message: reconciliation.Reason, ActionHint: "run_product_control_check_sync",
		})
	}
	return err
}

// managedDownloadFingerprint derives bounded facts from the published objects
// of a verified distribution.
func managedDownloadFingerprint(modelsRoot string, distribution modelDistribution) (map[string]any, bool) {
	extensions := make(map[string]struct{})
	formats := make(map[string]struct{})
	fileFingerprints := make([]any, 0)
	for _, file := range distribution.Files {
		extension := strings.ToLower(filepath.Ext(file.RelativePath))
		if extension != "" {
			extensions[extension] = struct{}{}
		}
		objectPath, err := modelObjectPath(modelsRoot, file.SHA256)
		if err != nil {
			continue
		}
		if format, facts := boundedModelAssetFileFingerprint(objectPath, extension); format != "" {
			formats[format] = struct{}{}
			fileFingerprint := map[string]any{"relative_path": file.RelativePath, "format": format}
			for key, value := range facts {
				fileFingerprint[key] = value
			}
			fileFingerprints = append(fileFingerprints, fileFingerprint)
		}
	}
	formatList := sortedStringSet(formats)
	fingerprint := map[string]any{"file_count": len(distribution.Files), "extensions": sortedStringSet(extensions), "formats": formatList}
	if len(fileFingerprints) > 0 {
		fingerprint["file_fingerprints"] = fileFingerprints
	}
	return fingerprint, len(formatList) == 0
}

func inspectCompletedManagedModelDownloadFile(targetPath string, expectedSHA256 string) (int64, bool, error) {
	info, err := os.Lstat(targetPath)
	if errors.Is(err, os.ErrNotExist) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("inspect completed managed model file: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return 0, false, errors.New("completed managed model file is not a direct regular file")
	}
	expected := normalizeExactSHA256Hex(expectedSHA256)
	if expected == "" {
		return 0, false, errors.New("completed managed model file has no admitted SHA-256")
	}
	actual, err := computeFileSHA256(targetPath)
	if err != nil {
		return 0, false, fmt.Errorf("verify completed managed model file: %w", err)
	}
	if !strings.EqualFold(actual, expected) {
		return 0, false, fmt.Errorf("completed managed model file: %w: expected=%s actual=%s", errModelDownloadHashMismatch, expected, actual)
	}
	if err := os.Remove(targetPath + ".download"); err != nil && !errors.Is(err, os.ErrNotExist) {
		return 0, false, fmt.Errorf("discard stale completed-file partial: %w", err)
	}
	return info.Size(), true, nil
}

func normalizedManagedDownloadHashes(files []string, hashes map[string]string) map[string]string {
	result := make(map[string]string, len(files))
	for _, file := range files {
		relativeFile := filepath.ToSlash(strings.TrimSpace(file))
		digest := normalizeExactSHA256Hex(hashes[relativeFile])
		if relativeFile == "" || digest == "" {
			continue
		}
		result[relativeFile] = digest
	}
	return result
}

func canonicalManagedDownloadedModelSpec(input managedDownloadedModelSpec) (managedDownloadedModelSpec, error) {
	result := managedDownloadedModelSpec{
		modelID:           strings.TrimSpace(input.modelID),
		displayName:       strings.TrimSpace(input.displayName),
		catalogAssetID:    strings.TrimSpace(input.catalogAssetID),
		catalogTemplateID: strings.TrimSpace(input.catalogTemplateID),
		kind:              input.kind,
		capabilities:      normalizeAssetCapabilities(input.capabilities),
		engine:            strings.TrimSpace(input.engine),
		license:           strings.TrimSpace(input.license),
		sourceProvenance:  strings.TrimSpace(input.sourceProvenance),
		repo:              strings.TrimSpace(input.repo),
		revision:          defaultString(strings.TrimSpace(input.revision), "main"),
		hashes:            make(map[string]string),
		totalSizeBytes:    clampInt64Minimum(input.totalSizeBytes, 0),
		engineConfig:      toStruct(structToMap(input.engineConfig)),
		planID:            strings.TrimSpace(input.planID),
	}
	if result.modelID == "" || result.repo == "" {
		return managedDownloadedModelSpec{}, errors.New("managed download spec requires model and repository identity")
	}
	seen := make(map[string]struct{}, len(input.files))
	for _, rawFile := range input.files {
		relativeFile, err := normalizeArtifactRelativeFile(rawFile)
		if err != nil {
			return managedDownloadedModelSpec{}, fmt.Errorf("managed download spec file: %w", err)
		}
		if _, exists := seen[relativeFile]; exists {
			return managedDownloadedModelSpec{}, fmt.Errorf("managed download spec repeats file %q", relativeFile)
		}
		seen[relativeFile] = struct{}{}
		result.files = append(result.files, relativeFile)
		digest := normalizeExactSHA256Hex(input.hashes[rawFile])
		if digest == "" {
			digest = normalizeExactSHA256Hex(input.hashes[relativeFile])
		}
		if digest == "" {
			return managedDownloadedModelSpec{}, fmt.Errorf("managed download spec has no exact SHA-256 for %q", relativeFile)
		}
		result.hashes[relativeFile] = "sha256:" + digest
	}
	if len(result.files) == 0 {
		entry, err := normalizeArtifactRelativeFile(input.entry)
		if err != nil {
			return managedDownloadedModelSpec{}, errors.New("managed download spec requires a payload file")
		}
		result.files = []string{entry}
		digest := normalizeExactSHA256Hex(input.hashes[input.entry])
		if digest == "" {
			digest = normalizeExactSHA256Hex(input.hashes[entry])
		}
		if digest == "" {
			return managedDownloadedModelSpec{}, fmt.Errorf("managed download spec has no exact SHA-256 for %q", entry)
		}
		result.hashes[entry] = "sha256:" + digest
		seen[entry] = struct{}{}
	}
	entry, err := normalizeArtifactRelativeFile(defaultString(strings.TrimSpace(input.entry), result.files[0]))
	if err != nil {
		return managedDownloadedModelSpec{}, fmt.Errorf("managed download spec entry: %w", err)
	}
	if _, exists := seen[entry]; !exists {
		return managedDownloadedModelSpec{}, fmt.Errorf("managed download spec entry %q is not declared", entry)
	}
	result.entry = entry
	return result, nil
}

func cloneManagedDownloadedModelSpec(input managedDownloadedModelSpec) managedDownloadedModelSpec {
	return managedDownloadedModelSpec{
		modelID:           input.modelID,
		displayName:       input.displayName,
		catalogAssetID:    input.catalogAssetID,
		catalogTemplateID: input.catalogTemplateID,
		kind:              input.kind,
		capabilities:      append([]string(nil), input.capabilities...),
		engine:            input.engine,
		entry:             input.entry,
		files:             append([]string(nil), input.files...),
		license:           input.license,
		sourceProvenance:  input.sourceProvenance,
		repo:              input.repo,
		revision:          input.revision,
		hashes:            cloneStringMap(input.hashes),
		totalSizeBytes:    input.totalSizeBytes,
		engineConfig:      toStruct(structToMap(input.engineConfig)),
		planID:            input.planID,
	}
}

func localStateManagedDownloadSpec(input managedDownloadedModelSpec) *localStateManagedModelDownloadSpec {
	return &localStateManagedModelDownloadSpec{
		ModelID:           input.modelID,
		DisplayName:       input.displayName,
		CatalogAssetID:    input.catalogAssetID,
		CatalogTemplateID: input.catalogTemplateID,
		Kind:              input.kind,
		Capabilities:      append([]string(nil), input.capabilities...),
		Engine:            input.engine,
		Entry:             input.entry,
		Files:             append([]string(nil), input.files...),
		License:           input.license,
		SourceProvenance:  input.sourceProvenance,
		Repo:              input.repo,
		Revision:          input.revision,
		Hashes:            cloneStringMap(input.hashes),
		TotalSizeBytes:    input.totalSizeBytes,
		EngineConfig:      structToMap(input.engineConfig),
	}
}

func managedDownloadedModelSpecFromLocalState(input *localStateManagedModelDownloadSpec) (managedDownloadedModelSpec, error) {
	if input == nil {
		return managedDownloadedModelSpec{}, errors.New("managed download spec is required")
	}
	return canonicalManagedDownloadedModelSpec(managedDownloadedModelSpec{
		modelID:           input.ModelID,
		displayName:       input.DisplayName,
		catalogAssetID:    input.CatalogAssetID,
		catalogTemplateID: input.CatalogTemplateID,
		kind:              input.Kind,
		capabilities:      append([]string(nil), input.Capabilities...),
		engine:            input.Engine,
		entry:             input.Entry,
		files:             append([]string(nil), input.Files...),
		license:           input.License,
		sourceProvenance:  input.SourceProvenance,
		repo:              input.Repo,
		revision:          input.Revision,
		hashes:            cloneStringMap(input.Hashes),
		totalSizeBytes:    input.TotalSizeBytes,
		engineConfig:      toStruct(input.EngineConfig),
	})
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
	completedBytes int64,
	bundleTotal int64,
	isLastFile bool,
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

	_, _ = s.mutateLocalTransfer(sessionID, false, func(summary *runtimev1.LocalTransferSessionSummary) {
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
		completedBytes,
		bundleTotal,
		isLastFile,
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
