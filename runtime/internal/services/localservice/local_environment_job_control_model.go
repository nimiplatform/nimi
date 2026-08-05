package localservice

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (s *Service) executeModelAssetEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState, report localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
	// First-run materialization: if the resolved model asset is not yet
	// installed, download + install it from the verified catalog descriptor
	// before verifying. This mirrors the native engine materializer
	// (executeNativeLlamaEnvironmentDependencyJob → EnsureEngineBinaryDependency):
	// the materializer job is the seam that actually fetches the asset, not just
	// a verifier. A still-failing verify after install attempt fails closed to
	// repair_required (corrupt/incomplete bundle), never pseudo-success.
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateDownloading)
	// Carry the per-job byte-progress sink on the install context so the shared
	// model download core publishes a concrete %/rate/ETA onto this job's
	// K-RPC-025 progress projection while it fetches the asset.
	downloadCtx := withLocalEnvironmentJobDownloadProgressSink(ctx, func(progress localEnvironmentDependencyJobProgress) {
		reportLocalEnvironmentJobDownloadProgress(report, progress)
	})
	if err := s.ensureLocalEnvironmentModelAssetInstalled(downloadCtx, job.DependencyID); err != nil {
		return localEnvironmentDependencyJobResult{}, err
	}
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateVerifying)
	model, entryPath, entryHash, sourceKind, err := s.verifyLocalEnvironmentModelAsset(ctx, job.DependencyID)
	if err != nil {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	if model == nil || strings.TrimSpace(entryPath) == "" || strings.TrimSpace(entryHash) == "" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	return localEnvironmentDependencyJobResult{
		State:         localEnvironmentStateReadyManaged,
		SourceKind:    sourceKind,
		CanonicalRoot: strings.TrimSpace(entryPath),
		Version:       strings.TrimSpace(model.GetUpdatedAt()),
		CompatibilityEvidence: normalizeStringSlice([]string{
			"asset_id=" + strings.TrimSpace(model.GetAssetId()),
			"local_asset_id=" + strings.TrimSpace(model.GetLocalAssetId()),
			"logical_model_id=" + strings.TrimSpace(model.GetLogicalModelId()),
			"capabilities=" + strings.Join(normalizeStringSlice(model.GetCapabilities()), ","),
			"source_repo=" + strings.TrimSpace(model.GetSource().GetRepo()),
			"source_revision=" + strings.TrimSpace(model.GetSource().GetRevision()),
		}),
		VerifiedArtifacts: normalizeStringSlice([]string{strings.TrimSpace(entryPath)}),
		Hashes: mergeStringMaps(cloneStringMap(model.GetHashes()), map[string]string{
			"entry_sha256":   strings.TrimSpace(entryHash),
			"asset_id":       strings.TrimSpace(model.GetAssetId()),
			"local_asset_id": strings.TrimSpace(model.GetLocalAssetId()),
		}),
		SelectedConsumers: modelAssetSelectedConsumers(job),
		AuditReasonCode:   "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	}, nil
}

func (s *Service) executeModelCompanionEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState, report localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
	parentAssetID := companionParentAssetIDFromDependencyID(job.DependencyID)
	// model.companion-asset depends on its parent model.asset selected-source
	// record. Concurrent unordered Start from the desktop can run the companion
	// job before the parent job has promoted its record — wait (bounded, on the
	// job ctx) for the parent rather than failing closed with a hard
	// PREREQUISITE_MISSING. A genuinely absent parent still fails closed once
	// the bounded wait elapses.
	parentRecord, ok := s.readySelectedModelAssetSourceForAssetID(parentAssetID)
	if !ok || strings.TrimSpace(parentRecord.RecordID) == "" {
		parentRecord, ok = s.waitForSelectedModelAssetSourceForAssetID(ctx, parentAssetID)
	}
	if !ok || strings.TrimSpace(parentRecord.RecordID) == "" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateFailed,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_PREREQUISITE_MISSING",
		}, nil
	}
	// First-run materialization: download + install the companion asset from
	// the verified catalog descriptor when it is not yet installed, then verify.
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateDownloading)
	downloadCtx := withLocalEnvironmentJobDownloadProgressSink(ctx, func(progress localEnvironmentDependencyJobProgress) {
		reportLocalEnvironmentJobDownloadProgress(report, progress)
	})
	if err := s.ensureLocalEnvironmentModelAssetInstalled(downloadCtx, job.DependencyID); err != nil {
		return localEnvironmentDependencyJobResult{}, err
	}
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateVerifying)
	model, entryPath, entryHash, sourceKind, err := s.verifyLocalEnvironmentModelAsset(ctx, job.DependencyID)
	if err != nil {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	if model == nil || strings.TrimSpace(entryPath) == "" || strings.TrimSpace(entryHash) == "" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	if strings.TrimSpace(model.GetAssetId()) == parentAssetID {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateFailed,
			SourceKind:      sourceKind,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_PREREQUISITE_MISSING",
		}, nil
	}
	return localEnvironmentDependencyJobResult{
		State:         localEnvironmentStateReadyManaged,
		SourceKind:    sourceKind,
		CanonicalRoot: strings.TrimSpace(entryPath),
		Version:       strings.TrimSpace(model.GetUpdatedAt()),
		CompatibilityEvidence: normalizeStringSlice([]string{
			"companion_asset_id=" + strings.TrimSpace(model.GetAssetId()),
			"companion_local_asset_id=" + strings.TrimSpace(model.GetLocalAssetId()),
			"parent_model_asset_record=" + strings.TrimSpace(parentRecord.RecordID),
			"artifact_roles=" + strings.Join(normalizeStringSlice(model.GetArtifactRoles()), ","),
			"source_repo=" + strings.TrimSpace(model.GetSource().GetRepo()),
			"source_revision=" + strings.TrimSpace(model.GetSource().GetRevision()),
		}),
		VerifiedArtifacts: normalizeStringSlice([]string{strings.TrimSpace(entryPath)}),
		Hashes: mergeStringMaps(cloneStringMap(model.GetHashes()), map[string]string{
			"entry_sha256":              strings.TrimSpace(entryHash),
			"companion_asset_id":        strings.TrimSpace(model.GetAssetId()),
			"companion_local_asset_id":  strings.TrimSpace(model.GetLocalAssetId()),
			"parent_model_asset_record": strings.TrimSpace(parentRecord.RecordID),
		}),
		SelectedConsumers: modelAssetSelectedConsumers(job),
		AuditReasonCode:   "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	}, nil
}

// ensureLocalEnvironmentModelAssetInstalled is the first-run materializer
// install seam for the model.asset / model.companion-asset families. The
// install-level resolver fills each dependency with a concrete semantic asset
// id (DependencyID `<asset_id>`, or `asset_id=<id>|parent_asset_id=<p>` for a
// companion). When that asset is not yet installed on this host, this downloads
// + installs it from the verified catalog descriptor via the shared
// installVerifiedAssetByTemplateID path. An already-installed asset is reused
// only when its bundle verifies under the current configured models root. A
// stale registry row left by a data-root change is rebound in place after the
// asset has been materialized successfully under the current root.
//
// A non-asset-specific DependencyID (e.g. a resolver fail-close pack-placeholder
// id) is left untouched: nothing is downloaded and the verify step projects the
// established repair_required outcome rather than a hard install failure. A
// catalog-miss or download failure for a concrete asset id propagates the
// install error verbatim so the materializer job fails closed — never pseudo-
// success.
//
// The models root is the single config-sourced runtime models root
// (`resolveLocalModelsPath(s.localModelsPath)` → `<dataRootRef>/models`), the
// same root every other models-root consumer reads. The desktop-bridge runtime
// is given that data root by the desktop config sync before materialization
// starts; an unresolved root fails closed downstream rather than staging a
// relative `resolved/` directory into the runtime process CWD.
func (s *Service) ensureLocalEnvironmentModelAssetInstalled(ctx context.Context, dependencyID string) error {
	if localEnvironmentModelAssetDependencyIDIsPlaceholder(dependencyID) {
		return nil
	}
	assetID := localEnvironmentModelAssetIDFromDependencyID(dependencyID)
	if assetID == "" {
		return nil
	}
	if s.installedAssetRecordForAssetID(assetID) != nil {
		model, err := s.localEnvironmentAssetByDependencyID(dependencyID)
		if err == nil {
			_, _, err = s.validateLocalEnvironmentModelAssetBundle(model)
		}
		if err == nil {
			// The registry row and its bundle agree under the current configured
			// models root. Leave engine synchronization and the final projection
			// to the caller's verify step.
			return nil
		}
	}
	// Idempotent materialization: the in-memory asset registry is rehydrated
	// only from `~/.nimi`, but the model bundles live under the user data
	// root (`<dataRoot>/models/resolved/<logicalModelID>/`). When `~/.nimi`
	// is cleared but the data-root bundle is intact, the registry is empty
	// yet the multi-GB asset is already on disk. Reconcile disk → registry:
	// when a valid bundle (manifest + artifacts + catalog-admitted hashes) is
	// present, adopt it and skip the download. A present-but-invalid bundle
	// is never adopted — it falls through to the download path.
	if adopted, err := s.adoptExistingResolvedModelBundle(ctx, assetID); err != nil {
		return fmt.Errorf("adopt resolved model bundle %q: %w", assetID, err)
	} else if adopted {
		return nil
	}
	if _, err := s.installVerifiedAssetByTemplateIDWithExistingPolicy(
		ctx,
		assetID,
		"",
		localAssetExistingPolicyRebind,
	); err != nil {
		return fmt.Errorf("install resolved model asset %q: %w", assetID, err)
	}
	return nil
}

// installedAssetRecordForAssetID returns the first non-removed installed asset
// record whose catalog asset id matches assetID, or nil when none is installed.
func (s *Service) installedAssetRecordForAssetID(assetID string) *runtimev1.LocalAssetRecord {
	trimmed := strings.TrimSpace(assetID)
	if trimmed == "" {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, candidate := range s.assets {
		if candidate == nil || candidate.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
			continue
		}
		if strings.TrimSpace(candidate.GetAssetId()) == trimmed {
			return cloneLocalAsset(candidate)
		}
	}
	return nil
}

// verifiedAssetDescriptorForAssetID returns the verified catalog descriptor
// whose template id matches assetID, or nil when the catalog has no row for it.
// The descriptor is the K-LOCAL-010 verified-asset SSOT — it carries the
// admitted expected sha256 hashes and the logical model id that locate the
// canonical resolved bundle directory.
func (s *Service) verifiedAssetDescriptorForAssetID(assetID string) *runtimev1.LocalVerifiedAssetDescriptor {
	trimmed := strings.TrimSpace(assetID)
	if trimmed == "" {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, item := range s.verified {
		if item.GetTemplateId() == trimmed {
			return cloneVerifiedAsset(item)
		}
	}
	return nil
}

// adoptExistingResolvedModelBundle reconciles disk → registry for a model.asset
// / model.companion-asset. When the canonical resolved bundle directory already
// holds a valid, hash-verified bundle (the catalog descriptor's admitted sha256
// are the verification authority), it adopts the bundle by registering its
// `asset.manifest.json` through the shared import path — the same manifest-schema
// validation, managed-entry validation, and asset registration a completed
// download's activation performs. An existing row is rebound in place, while an
// empty registry receives a normal insert. It returns false (download as today)
// when the bundle is absent, incomplete, corrupt, or fails hash verification: a
// present-but-invalid bundle is never adopted as success (no pseudo-success).
// It fails closed with an error only on an unresolvable models root.
func (s *Service) adoptExistingResolvedModelBundle(ctx context.Context, assetID string) (bool, error) {
	descriptor := s.verifiedAssetDescriptorForAssetID(assetID)
	if descriptor == nil {
		// No verified catalog descriptor — installVerifiedAssetByTemplateID will
		// fail closed with the typed catalog-miss reason code. Nothing to adopt.
		return false, nil
	}
	logicalModelID := strings.Trim(strings.TrimSpace(descriptor.GetLogicalModelId()), "/")
	if logicalModelID == "" {
		return false, nil
	}
	modelsRoot := strings.TrimSpace(s.resolvedLocalModelsPath())
	if modelsRoot == "" || !filepath.IsAbs(modelsRoot) {
		// An unresolved data root is a fail-close condition for the materializer;
		// installVerifiedAssetByTemplateID's resolveManagedBundleModelsRoot raises
		// the typed reason code. Do not attempt adoption against a relative root.
		return false, nil
	}
	bundleDir := runtimeManagedResolvedModelDir(modelsRoot, logicalModelID)
	manifestPath := runtimeManagedAssetManifestPath(modelsRoot, logicalModelID)
	if info, err := os.Stat(manifestPath); err != nil || info.IsDir() {
		// No bundle (or no manifest) on disk — download as today.
		return false, nil
	}
	// Verify every catalog-declared artifact is present in the bundle dir and its
	// sha256 matches the catalog descriptor's admitted expected hash. The catalog
	// descriptor stays the verification authority; adoption must not weaken it.
	files := normalizeStringSlice(descriptor.GetFiles())
	if len(files) == 0 {
		return false, nil
	}
	for _, file := range files {
		relativeFile, err := normalizeArtifactRelativeFile(file)
		if err != nil {
			return false, nil
		}
		expectedHash := expectedModelSHA256(descriptor.GetHashes(), file)
		if expectedHash == "" {
			expectedHash = expectedModelSHA256(descriptor.GetHashes(), relativeFile)
		}
		if expectedHash == "" {
			// A verified descriptor without an admitted hash for a declared file
			// cannot be adopted fail-closed — fall through to the download path,
			// which itself fails closed on a missing expected hash.
			return false, nil
		}
		artifactPath := filepath.Join(bundleDir, filepath.FromSlash(relativeFile))
		artifactInfo, err := os.Stat(artifactPath)
		if err != nil || artifactInfo.IsDir() {
			// Incomplete bundle — a declared artifact is missing.
			return false, nil
		}
		actualHash, err := computeFileSHA256(artifactPath)
		if err != nil {
			return false, nil
		}
		if !strings.EqualFold(strings.TrimSpace(actualHash), expectedHash) {
			// Corrupt / tampered artifact — never adopt; re-download instead.
			return false, nil
		}
	}
	// All artifacts verified against the catalog-admitted hashes. Register the
	// on-disk bundle through the shared import machinery — manifest schema
	// validation, managed-entry validation, and asset registration. Rebind
	// preserves the existing local asset identity when the registry row still
	// points at a previous data root; with no existing row it inserts normally.
	// A registration failure (e.g. a manifest schema drift) falls through to the
	// download path rather than failing the job.
	if _, err := s.importLocalAsset(
		ctx,
		&runtimev1.ImportLocalAssetRequest{ManifestPath: manifestPath},
		localAssetExistingPolicyRebind,
	); err != nil {
		return false, nil
	}
	return true, nil
}

// verifyLocalEnvironmentModelAsset verifies a materialized model.asset bundle.
// The bundle entry path resolves under the single config-sourced runtime models
// root (`resolvedLocalModelsPath` → `<dataRootRef>/models`), the same root the
// install path staged into and every other models-root consumer reads. An
// unresolved root fails closed inside resolveManagedModelEntryAbsolutePath
// rather than resolving a relative path against the runtime process CWD.
func (s *Service) verifyLocalEnvironmentModelAsset(_ context.Context, dependencyID string) (*runtimev1.LocalAssetRecord, string, string, string, error) {
	model, err := s.localEnvironmentAssetByDependencyID(dependencyID)
	if err != nil {
		return nil, "", "", localEnvironmentSourceManaged, err
	}
	if model == nil {
		return nil, "", "", localEnvironmentSourceManaged, errors.New("model asset record missing")
	}
	if model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
		return nil, "", "", localEnvironmentSourceManaged, errors.New("model asset record removed")
	}
	_, entryPath, err := s.validateLocalEnvironmentModelAssetBundle(model)
	if err != nil {
		return model, entryPath, "", localEnvironmentSourceKindForAsset(model), err
	}
	hash, err := computeFileSHA256(entryPath)
	if err != nil {
		return model, entryPath, "", localEnvironmentSourceKindForAsset(model), err
	}
	return model, entryPath, hash, localEnvironmentSourceKindForAsset(model), nil
}

// validateLocalEnvironmentModelAssetBundle verifies the registry row against
// the bundle rooted at the currently configured models path. It intentionally
// excludes engine synchronization: the materializer uses this static check to
// decide whether an existing row can be reused, while the final verify step
// performs any required engine mutation exactly once.
func (s *Service) validateLocalEnvironmentModelAssetBundle(model *runtimev1.LocalAssetRecord) (string, string, error) {
	if model == nil {
		return "", "", errors.New("model asset record missing")
	}
	modelsRoot := s.resolvedLocalModelsPath()
	entryPath, err := resolveManagedModelEntryAbsolutePath(modelsRoot, model)
	if err != nil {
		return modelsRoot, "", err
	}
	if err := s.validateManagedModelEntryForModel(entryPath, model); err != nil {
		return modelsRoot, entryPath, err
	}
	if isManagedSupervisedSpeechModel(model, s.modelRuntimeMode(model.GetLocalAssetId())) {
		if err := validateManagedSpeechBundleFiles(modelsRoot, model); err != nil {
			return modelsRoot, entryPath, err
		}
	}
	return modelsRoot, entryPath, nil
}

func (s *Service) localEnvironmentAssetByDependencyID(dependencyID string) (*runtimev1.LocalAssetRecord, error) {
	assetID := localEnvironmentModelAssetIDFromDependencyID(dependencyID)
	if assetID == "" || localEnvironmentModelAssetDependencyIDIsPlaceholder(dependencyID) {
		return nil, errors.New("model asset dependency id must be asset-specific")
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var matched *runtimev1.LocalAssetRecord
	for _, candidate := range s.assets {
		if candidate == nil || candidate.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
			continue
		}
		if strings.TrimSpace(candidate.GetAssetId()) != assetID {
			continue
		}
		if matched != nil {
			return nil, errors.New("model asset id is ambiguous")
		}
		matched = cloneLocalAsset(candidate)
	}
	if matched == nil {
		return nil, errors.New("model asset record not found")
	}
	return matched, nil
}

func localEnvironmentModelAssetDependencyIDIsPlaceholder(dependencyID string) bool {
	trimmed := strings.TrimSpace(dependencyID)
	return trimmed == "" ||
		strings.HasSuffix(trimmed, ".model-asset") ||
		strings.HasSuffix(trimmed, ".companion-asset")
}

func localEnvironmentModelAssetIDFromDependencyID(dependencyID string) string {
	trimmed := strings.TrimSpace(dependencyID)
	if trimmed == "" || localEnvironmentModelAssetDependencyIDIsPlaceholder(trimmed) {
		return ""
	}
	if index := strings.Index(trimmed, "|"); index >= 0 {
		trimmed = strings.TrimSpace(trimmed[:index])
	}
	if strings.HasPrefix(trimmed, "asset_id=") {
		trimmed = strings.TrimSpace(strings.TrimPrefix(trimmed, "asset_id="))
	}
	return trimmed
}

func localEnvironmentSourceKindForAsset(model *runtimev1.LocalAssetRecord) string {
	repo := strings.ToLower(strings.TrimSpace(model.GetSource().GetRepo()))
	switch {
	case strings.HasPrefix(repo, "file://"), strings.HasPrefix(repo, "local-import/"):
		return localEnvironmentSourceImported
	default:
		return localEnvironmentSourceManaged
	}
}

func modelAssetSelectedConsumers(job localEnvironmentDependencyJobState) []string {
	if consumer := strings.TrimSpace(job.ConsumerScope); consumer != "" {
		return []string{consumer}
	}
	environmentKey := strings.TrimSpace(job.EnvironmentKey)
	for _, consumer := range []string{
		"llama.cpp.cuda",
		"llama.cpp.vulkan",
		"llama.cpp.cpu",
		"stable-diffusion.cpp.cuda",
		"stable-diffusion.cpp.metal",
		"stable-diffusion.cpp.cpu",
		"media.diffusers.cuda",
		"media.diffusers.cpu",
		"media.video-python.cuda",
		"media.video-python.cpu",
		"speech.qwen3-asr.python",
		"speech.qwen3-tts.python",
	} {
		if strings.Contains(environmentKey, "|"+consumer) {
			return []string{consumer}
		}
	}
	return []string{"local.model"}
}

func companionParentAssetIDFromDependencyID(dependencyID string) string {
	parts := strings.Split(strings.TrimSpace(dependencyID), "|")
	for _, part := range parts {
		if strings.HasPrefix(strings.TrimSpace(part), "parent_asset_id=") {
			return strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(part), "parent_asset_id="))
		}
	}
	return ""
}

// waitForSelectedModelAssetSourceForAssetID blocks until the parent model asset
// has promoted a selected-source record, the job ctx is cancelled, or the
// bounded prerequisite wait elapses. It lets a model.companion-asset job that
// races ahead of its parent model.asset job converge instead of failing closed.
func (s *Service) waitForSelectedModelAssetSourceForAssetID(ctx context.Context, assetID string) (localEnvironmentSelectedSourceRecordState, bool) {
	if record, ok := s.readySelectedModelAssetSourceForAssetID(assetID); ok {
		return record, true
	}
	deadline := time.NewTimer(s.prerequisiteWaitTimeout())
	defer deadline.Stop()
	ticker := time.NewTicker(localEnvironmentPrerequisiteWaitPoll)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return localEnvironmentSelectedSourceRecordState{}, false
		case <-deadline.C:
			return localEnvironmentSelectedSourceRecordState{}, false
		case <-ticker.C:
			if record, ok := s.readySelectedModelAssetSourceForAssetID(assetID); ok {
				return record, true
			}
		}
	}
}

func (s *Service) readySelectedModelAssetSourceForAssetID(assetID string) (localEnvironmentSelectedSourceRecordState, bool) {
	candidates := s.selectedModelAssetSourceCandidatesForAssetID(assetID)
	for _, record := range candidates {
		if isLocalEnvironmentRepairActive(record.RepairState) {
			continue
		}
		if err := validateLocalEnvironmentSelectedSourceRecord(record); err != nil {
			continue
		}
		if err := validateLocalEnvironmentSelectedSourceLocalArtifacts(record); err != nil {
			continue
		}
		return record, true
	}
	return localEnvironmentSelectedSourceRecordState{}, false
}

func (s *Service) selectedModelAssetSourceCandidatesForAssetID(assetID string) []localEnvironmentSelectedSourceRecordState {
	trimmedAssetID := strings.TrimSpace(assetID)
	if trimmedAssetID == "" {
		return nil
	}
	s.mu.RLock()
	candidates := make([]localEnvironmentSelectedSourceRecordState, 0)
	for _, record := range s.localEnvironmentSelectedSources {
		if record.DependencyFamily != localEnvironmentFamilyModelAsset {
			continue
		}
		if !selectedModelAssetSourceRecordMatchesAssetID(record, trimmedAssetID) {
			continue
		}
		candidates = append(candidates, record)
	}
	s.mu.RUnlock()
	sort.SliceStable(candidates, func(left, right int) bool {
		leftVerified := strings.TrimSpace(candidates[left].LastVerifiedAt)
		rightVerified := strings.TrimSpace(candidates[right].LastVerifiedAt)
		if leftVerified != rightVerified {
			return leftVerified > rightVerified
		}
		return strings.TrimSpace(candidates[left].RecordID) > strings.TrimSpace(candidates[right].RecordID)
	})
	return candidates
}

func (s *Service) selectedModelAssetSourceForAssetID(assetID string) (localEnvironmentSelectedSourceRecordState, bool) {
	trimmedAssetID := strings.TrimSpace(assetID)
	if trimmedAssetID == "" {
		return localEnvironmentSelectedSourceRecordState{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, record := range s.localEnvironmentSelectedSources {
		if record.DependencyFamily != localEnvironmentFamilyModelAsset {
			continue
		}
		if selectedModelAssetSourceRecordMatchesAssetID(record, trimmedAssetID) {
			return record, true
		}
	}
	return localEnvironmentSelectedSourceRecordState{}, false
}

func selectedModelAssetSourceRecordMatchesAssetID(record localEnvironmentSelectedSourceRecordState, assetID string) bool {
	trimmedAssetID := strings.TrimSpace(assetID)
	if trimmedAssetID == "" {
		return false
	}
	if strings.TrimSpace(record.DependencyID) == trimmedAssetID {
		return true
	}
	return strings.TrimSpace(record.Hashes["asset_id"]) == trimmedAssetID
}

func mergeStringMaps(base map[string]string, overlay map[string]string) map[string]string {
	out := make(map[string]string, len(base)+len(overlay))
	for key, value := range base {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(value) == "" {
			continue
		}
		out[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}
	for key, value := range overlay {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(value) == "" {
			continue
		}
		out[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}
	return out
}
