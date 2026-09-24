package localservice

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"google.golang.org/grpc/codes"
)

const defaultGitHubReleaseDownloadBaseURL = "https://github.com"

// managedModelArchiveStageDirName is reserved inside one transfer's own
// staging directory for its source archive; no declared payload path uses it.
const managedModelArchiveStageDirName = ".nimi-source-archive"

// managedModelArchiveRedirectHosts are the only hosts an official GitHub
// release asset download may be redirected to.
var managedModelArchiveRedirectHosts = map[string]struct{}{
	"github.com":                           {},
	"objects.githubusercontent.com":        {},
	"release-assets.githubusercontent.com": {},
}

// managedModelArchiveSource is the immutable pinned release archive of one
// catalog acquisition. The archive is transfer material only: the declared
// spec files below root, verified one by one, form the ModelAsset.
type managedModelArchiveSource struct {
	file      string
	format    string
	sha256    string
	sizeBytes int64
	root      string
}

type localStateManagedModelDownloadArchive struct {
	File      string `json:"file"`
	Format    string `json:"format"`
	SHA256    string `json:"sha256"`
	SizeBytes int64  `json:"sizeBytes"`
	Root      string `json:"root"`
}

func cloneManagedModelArchiveSource(input *managedModelArchiveSource) *managedModelArchiveSource {
	if input == nil {
		return nil
	}
	cloned := *input
	return &cloned
}

func localStateManagedModelDownloadArchiveFromSource(input *managedModelArchiveSource) *localStateManagedModelDownloadArchive {
	if input == nil {
		return nil
	}
	return &localStateManagedModelDownloadArchive{
		File: input.file, Format: input.format, SHA256: input.sha256, SizeBytes: input.sizeBytes, Root: input.root,
	}
}

func managedModelArchiveSourceFromLocalState(input *localStateManagedModelDownloadArchive) *managedModelArchiveSource {
	if input == nil {
		return nil
	}
	return &managedModelArchiveSource{
		file: input.File, format: input.Format, sha256: input.SHA256, sizeBytes: input.SizeBytes, root: input.Root,
	}
}

// @nimi-authority: rule.nimi.runtime.local-compute.r029
// canonicalManagedModelArchiveSource admits only the pinned official release
// archive shape the catalog admits, over the already canonical spec files.
func canonicalManagedModelArchiveSource(repo string, revision string, input *managedModelArchiveSource, files []string, totalSizeBytes int64) (*managedModelArchiveSource, error) {
	if input == nil {
		return nil, nil
	}
	digest := normalizeExactSHA256Hex(input.sha256)
	if digest == "" {
		return nil, errors.New("release archive source requires an exact SHA-256")
	}
	result := &managedModelArchiveSource{
		file: strings.TrimSpace(input.file), format: strings.TrimSpace(input.format), sha256: "sha256:" + digest,
		sizeBytes: input.sizeBytes, root: strings.TrimSpace(input.root),
	}
	if err := catalog.ValidateLocalPlaneArchive(repo, revision, catalog.LocalPlaneArchive{
		File: result.file, Format: result.format, SHA256: result.sha256, SizeBytes: result.sizeBytes, Root: result.root,
	}, files); err != nil {
		return nil, err
	}
	if totalSizeBytes <= 0 {
		return nil, errors.New("release archive source requires the installed total size")
	}
	for _, file := range files {
		if file == managedModelArchiveStageDirName || strings.HasPrefix(file, managedModelArchiveStageDirName+"/") {
			return nil, fmt.Errorf("declared file %q uses the reserved archive staging path", file)
		}
	}
	return result, nil
}

// catalogReleaseArchiveForPlan returns the pinned release archive of the exact
// catalog variant a plan resolved, after checking that the plan still carries
// that variant's source, entry, files, hashes and installed size. A plan for
// any other source has no archive.
func (s *Service) catalogReleaseArchiveForPlan(plan *runtimev1.LocalInstallPlanDescriptor) (*managedModelArchiveSource, error) {
	row, variant, ok := s.catalogReleaseArchiveVariant(plan.GetTemplateId())
	if !ok {
		return nil, nil
	}
	repo, revision := catalogVariantSource(row, variant)
	if strings.TrimSpace(plan.GetRepo()) != repo || strings.TrimSpace(plan.GetRevision()) != revision ||
		strings.TrimSpace(plan.GetEntry()) != strings.TrimSpace(variant.Entry) || plan.GetTotalSizeBytes() != variant.TotalSizeBytes ||
		len(plan.GetFiles()) != len(variant.Files) {
		return nil, fmt.Errorf("install plan no longer matches release archive offer %q", variant.VariantID)
	}
	for index, file := range variant.Files {
		if plan.GetFiles()[index] != file || normalizeExactSHA256Hex(plan.GetHashes()[file]) != normalizeExactSHA256Hex(variant.Hashes[file]) {
			return nil, fmt.Errorf("install plan no longer matches release archive offer %q", variant.VariantID)
		}
	}
	archive := variant.Archive
	return &managedModelArchiveSource{
		file: archive.File, format: archive.Format, sha256: archive.SHA256, sizeBytes: archive.SizeBytes, root: archive.Root,
	}, nil
}

func (s *Service) catalogReleaseArchiveVariant(variantID string) (catalog.ModelEntry, catalog.LocalPlaneVariant, bool) {
	variantID = strings.TrimSpace(variantID)
	if variantID == "" || s.localProviderCatalog == nil {
		return catalog.ModelEntry{}, catalog.LocalPlaneVariant{}, false
	}
	for _, row := range s.localProviderCatalog.LocalPlaneModels() {
		if row.Install == nil || strings.TrimSpace(row.Install.InstallKind) != catalog.LocalInstallKindReleaseArchive {
			continue
		}
		for _, variant := range row.Variants {
			if strings.TrimSpace(variant.VariantID) == variantID && variant.Archive != nil {
				return row, variant, true
			}
		}
	}
	return catalog.ModelEntry{}, catalog.LocalPlaneVariant{}, false
}

// catalogReleaseArchiveForOffer projects the archive of a verified catalog
// offer only when the offer's exact source identity is that variant's.
func (s *Service) catalogReleaseArchiveForOffer(offer catalogOffer) (*catalog.LocalPlaneArchive, bool) {
	if offer.identity.sourceKind != "verified" {
		return nil, false
	}
	row, variant, ok := s.catalogReleaseArchiveVariant(offer.templateID)
	if !ok {
		return nil, false
	}
	repo, revision := catalogVariantSource(row, variant)
	if offer.identity.locator != repo || offer.identity.revision != revision {
		return nil, false
	}
	archive := *variant.Archive
	return &archive, true
}

func (s *Service) catalogReleaseArchiveSourceKnown(repo string, revision string) bool {
	if s.localProviderCatalog == nil {
		return false
	}
	for _, row := range s.localProviderCatalog.LocalPlaneModels() {
		if row.Install == nil || strings.TrimSpace(row.Install.InstallKind) != catalog.LocalInstallKindReleaseArchive {
			continue
		}
		for _, variant := range row.Variants {
			variantRepo, variantRevision := catalogVariantSource(row, variant)
			if variantRepo == strings.TrimSpace(repo) && variantRevision == strings.TrimSpace(revision) {
				return true
			}
		}
	}
	return false
}

func catalogVariantSource(row catalog.ModelEntry, variant catalog.LocalPlaneVariant) (string, string) {
	if repo := strings.TrimSpace(variant.Repo); repo != "" {
		return repo, strings.TrimSpace(variant.Revision)
	}
	if row.Install == nil {
		return "", ""
	}
	return strings.TrimSpace(row.Install.Repo), strings.TrimSpace(row.Install.Revision)
}

// managedModelDownloadStagingFiles lists the transfer's own resumable staging
// paths: the declared files, or for an archive acquisition its one archive.
func managedModelDownloadStagingFiles(spec managedDownloadedModelSpec) []string {
	if spec.archive != nil {
		return []string{managedModelArchiveStageDirName + "/" + spec.archive.file}
	}
	return append([]string(nil), spec.files...)
}

// managedModelDownloadTransferTotal is the transfer's known source size: the
// archive for an archive acquisition, otherwise the declared files.
func managedModelDownloadTransferTotal(spec managedDownloadedModelSpec) int64 {
	if spec.archive != nil {
		return clampInt64Minimum(spec.archive.sizeBytes, 0)
	}
	return clampInt64Minimum(spec.totalSizeBytes, 0)
}

func buildManagedModelArchiveURL(baseURL string, repo string, revision string, file string) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" || strings.TrimSpace(repo) == "" || strings.TrimSpace(revision) == "" || strings.TrimSpace(file) == "" {
		return "", errors.New("release archive URL requires base, repository, release tag and asset")
	}
	return base + "/" + strings.TrimSpace(repo) + "/releases/download/" + url.PathEscape(strings.TrimSpace(revision)) + "/" + url.PathEscape(strings.TrimSpace(file)), nil
}

// validateManagedModelArchiveRedirect keeps an archive download on its own
// host or, from github.com over https, on GitHub's release asset hosts.
func validateManagedModelArchiveRedirect(sourceURL string, target *url.URL) error {
	source, err := url.Parse(strings.TrimSpace(sourceURL))
	if err != nil || target == nil {
		return errors.New("release archive redirect is invalid")
	}
	sourceHost, targetHost := strings.ToLower(source.Hostname()), strings.ToLower(target.Hostname())
	sourceScheme, targetScheme := strings.ToLower(source.Scheme), strings.ToLower(target.Scheme)
	if sourceHost == "" || targetHost == "" || sourceScheme != targetScheme {
		return fmt.Errorf("release archive redirect from %s to %s is not allowed", sourceHost, targetHost)
	}
	if targetHost == sourceHost && target.Port() == source.Port() {
		return nil
	}
	if sourceScheme == "https" && sourceHost == "github.com" {
		if _, ok := managedModelArchiveRedirectHosts[targetHost]; ok {
			return nil
		}
	}
	return fmt.Errorf("release archive redirect from %s to %s is not allowed", sourceHost, targetHost)
}

func managedModelArchiveCheckRedirect(sourceURL string) func(*http.Request, []*http.Request) error {
	return func(request *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return errors.New("release archive download stopped after 10 redirects")
		}
		return validateManagedModelArchiveRedirect(sourceURL, request.URL)
	}
}

// managedModelArchiveAcquisition is the verified outcome of an archive-backed
// acquisition. Every declared file is a published object pinned by the
// transfer. Byte counts stay in transfer terms: when the archive was fetched,
// received and total are its bytes and nothing counts as reused; only when
// every declared object was already published does the whole installed size
// count as reused with nothing received.
type managedModelArchiveAcquisition struct {
	files         []modelDistributionFile
	receivedBytes int64
	reusedBytes   int64
	transferTotal int64
}

// managedModelArchiveInvalidError is a pinned archive whose contents cannot
// form the declared distribution. It is never retried.
type managedModelArchiveInvalidError struct{ cause error }

func (e *managedModelArchiveInvalidError) Error() string {
	return "release archive does not match its catalog offer: " + e.cause.Error()
}

func (e *managedModelArchiveInvalidError) Unwrap() error { return e.cause }

func managedModelArchiveManifestError(err error) error {
	return &managedModelArchiveInvalidError{cause: err}
}

// failManagedModelArchiveDownload settles an archive acquisition failure with
// the same interruption, pause, retry and discard semantics as a per-file
// acquisition, and returns integrity failures in their typed public form.
func (s *Service) failManagedModelArchiveDownload(ctx context.Context, transferID string, err error, fail func(error, bool) error) error {
	var invalid *managedModelArchiveInvalidError
	var conflict *modelObjectConflict
	var reconciliation *modelAssetReconciliationError
	switch {
	case errors.As(err, &conflict):
		return fail(conflict, false)
	case errors.As(err, &invalid):
		failure := fail(err, false)
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID, failure, grpcerr.ReasonOptions{
			Message: "release archive does not match its catalog offer",
		})
	case errors.Is(err, errModelDownloadHashMismatch):
		failure := fail(err, false)
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DOWNLOAD_HASH_MISMATCH, failure, grpcerr.ReasonOptions{
			Message: "release archive content does not match its pinned integrity",
		})
	case errors.As(err, &reconciliation):
		return fail(classifyAcquisitionFailure(err), false)
	case errors.Is(err, errLocalTransferCancelled):
		return fail(err, false)
	case errors.Is(err, context.Canceled) && rpcctx.WasServerShutdown(ctx):
		return managedModelTransferTerminalError(err, s.interruptTransfer(transferID, "transfer interrupted by runtime shutdown"))
	case errors.Is(err, context.Canceled) && normalizeTransferState(s.localTransferSummary(transferID).GetState()) == localTransferStatePaused:
		return err
	case errors.Is(err, context.Canceled), isRetryableManagedModelDownloadError(err):
		return fail(err, true)
	default:
		return fail(err, false)
	}
}

// @nimi-authority: rule.nimi.runtime.local-compute.r029
// @nimi-authority: rule.nimi.runtime.local-compute.r030
// acquireManagedModelArchiveFiles reuses every declared file whose published
// object verifies. Otherwise it fetches the one pinned archive into this
// transfer's own staging (resumable, verified by exact size and SHA-256),
// extracts only the declared files below the archive root, verifies each by
// exact size and SHA-256 under its own single-writer grant, and publishes it.
func (s *Service) acquireManagedModelArchiveFiles(
	ctx context.Context,
	transferID string,
	modelsRoot string,
	stagingDir string,
	spec managedDownloadedModelSpec,
	checkActive func() error,
) (managedModelArchiveAcquisition, error) {
	archive := spec.archive
	result := managedModelArchiveAcquisition{}
	present := make(map[string]modelDistributionFile, len(spec.files))
	var presentBytes int64
	for _, relativeFile := range spec.files {
		if err := checkActive(); err != nil {
			return result, err
		}
		expected := expectedModelSHA256(spec.hashes, relativeFile)
		if expected == "" {
			return result, managedModelArchiveManifestError(fmt.Errorf("declared file %q has no exact SHA-256", relativeFile))
		}
		size, reused, err := s.verifyPublishedModelObjectForAcquisition(transferID, modelsRoot, expected, checkActive)
		if err != nil {
			return result, err
		}
		if reused {
			present[relativeFile] = modelDistributionFile{RelativePath: relativeFile, SHA256: expected, SizeBytes: size, NonExecutableContent: modelDistributionFileNonExecutable(relativeFile)}
			presentBytes += size
		}
	}
	if len(present) == len(spec.files) {
		for _, relativeFile := range spec.files {
			s.pinModelObject(present[relativeFile].SHA256, transferID)
			result.files = append(result.files, present[relativeFile])
		}
		result.reusedBytes, result.transferTotal = presentBytes, presentBytes
		s.setTransferBytesTotal(transferID, presentBytes)
		s.updateTransferReuse(transferID, "verify", 0, presentBytes, "reusing verified local content")
		return result, nil
	}

	archivePath := filepath.Join(stagingDir, managedModelArchiveStageDirName, archive.file)
	if err := os.MkdirAll(filepath.Dir(archivePath), 0o755); err != nil {
		return result, fmt.Errorf("create release archive staging: %w", err)
	}
	archiveSHA256 := normalizeExactSHA256Hex(archive.sha256)
	_, completed, err := inspectCompletedManagedModelDownloadFile(archivePath, archiveSHA256)
	if err != nil {
		return result, err
	}
	if !completed {
		if err := s.downloadManagedModelArchive(ctx, transferID, spec, archivePath); err != nil {
			return result, err
		}
	}
	info, err := os.Lstat(archivePath)
	if err != nil || !info.Mode().IsRegular() || info.Size() != archive.sizeBytes {
		if err == nil {
			err = fmt.Errorf("release archive size mismatch: expected=%d actual=%d", archive.sizeBytes, info.Size())
		}
		return result, fmt.Errorf("release archive %q: %w: %v", archive.file, errModelDownloadHashMismatch, err)
	}
	result.receivedBytes, result.transferTotal = archive.sizeBytes, archive.sizeBytes
	s.updateTransferReuse(transferID, "extract", result.receivedBytes, 0, "verifying release archive contents")

	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return result, managedModelArchiveManifestError(fmt.Errorf("open release archive: %w", err))
	}
	defer func() { _ = reader.Close() }()
	entries, err := indexManagedModelArchiveEntries(reader.File, archive.root, spec.files)
	if err != nil {
		return result, managedModelArchiveManifestError(err)
	}
	var extractedBytes int64
	for _, relativeFile := range spec.files {
		if err := checkActive(); err != nil {
			return result, err
		}
		if file, ok := present[relativeFile]; ok {
			s.pinModelObject(file.SHA256, transferID)
			result.files = append(result.files, file)
			continue
		}
		expected := expectedModelSHA256(spec.hashes, relativeFile)
		file, err := s.publishManagedModelArchiveFile(transferID, modelsRoot, stagingDir, relativeFile, expected, entries[relativeFile], spec.totalSizeBytes-extractedBytes, checkActive)
		if err != nil {
			return result, err
		}
		extractedBytes += file.SizeBytes
		result.files = append(result.files, file)
		s.updateTransferReuse(transferID, "extract", result.receivedBytes, 0, "verified "+relativeFile)
	}
	// The archive stays in this transfer's staging until the commit removes
	// the whole staging directory after the archive reader is closed.
	return result, nil
}

// verifyPublishedModelObjectForAcquisition reuses a published object for this
// digest after a real verification read. A corrupt occupant is isolated so a
// verified replacement can be published.
func (s *Service) verifyPublishedModelObjectForAcquisition(transferID string, modelsRoot string, digest string, checkActive func() error) (int64, bool, error) {
	s.holdModelObjectForVerification(digest, transferID)
	if err := s.persistModelObjectHolds(transferID); err != nil {
		return 0, false, err
	}
	present, _, err := modelObjectPresent(modelsRoot, digest)
	if err != nil || !present {
		return 0, false, err
	}
	_, size, verifyErr := verifyModelObject(modelsRoot, digest, -1, func(delta int64) error {
		s.addTransferVerifiedBytes(transferID, delta)
		return checkActive()
	})
	switch {
	case verifyErr == nil:
		return size, true, nil
	case errors.Is(verifyErr, errLocalTransferCancelled) || errors.Is(verifyErr, context.Canceled):
		return 0, false, verifyErr
	}
	if _, isolateErr := s.isolateModelObjectGeneration(modelsRoot, digest, "published object failed verification during explicit acquisition: "+verifyErr.Error()); isolateErr != nil {
		return 0, false, &modelAssetReconciliationError{Reason: "corrupt published model object could not be isolated", Cause: isolateErr}
	}
	return 0, false, nil
}

func (s *Service) downloadManagedModelArchive(ctx context.Context, transferID string, spec managedDownloadedModelSpec, archivePath string) error {
	archive := spec.archive
	requestURL, err := buildManagedModelArchiveURL(
		defaultString(strings.TrimSpace(s.githubReleaseDownloadBaseURL), defaultGitHubReleaseDownloadBaseURL),
		spec.repo, spec.revision, archive.file,
	)
	if err != nil {
		return err
	}
	timeout := s.modelDownloadTimeout
	if timeout <= 0 {
		timeout = localModelDownloadTimeout
	}
	_, _ = s.mutateLocalTransfer(transferID, false, func(summary *runtimev1.LocalTransferSessionSummary) {
		summary.Phase = "download"
		summary.Message = "downloading " + archive.file
		summary.State = localTransferStateRunning
	})
	header := http.Header{}
	header.Set("User-Agent", "nimi-runtime/0.1")
	_, err = s.downloadToFileWithTransfer(ctx, transferID, "download", requestURL, archivePath, normalizeExactSHA256Hex(archive.sha256),
		0, archive.sizeBytes, true, archive.sizeBytes, header, timeout, archive.sizeBytes, managedModelArchiveCheckRedirect(requestURL))
	if err == nil {
		return nil
	}
	if errors.Is(err, errLocalTransferCancelled) {
		return err
	}
	if isManagedDownloadIntegrityError(err) {
		return fmt.Errorf("release archive %q: %w: %v", archive.file, errModelDownloadHashMismatch, err)
	}
	return fmt.Errorf("download release archive %q: %w", archive.file, err)
}

// indexManagedModelArchiveEntries maps each declared file to its one archive
// entry below root. Entries outside the declared set are ignored and never
// written; a missing, repeated, directory, link or special entry fails.
func indexManagedModelArchiveEntries(files []*zip.File, root string, declared []string) (map[string]*zip.File, error) {
	wanted := make(map[string]struct{}, len(declared))
	for _, file := range declared {
		wanted[file] = struct{}{}
	}
	prefix := root + "/"
	entries := make(map[string]*zip.File, len(declared))
	for _, entry := range files {
		if !strings.HasPrefix(entry.Name, prefix) {
			continue
		}
		relative := strings.TrimPrefix(entry.Name, prefix)
		if _, ok := wanted[relative]; !ok {
			continue
		}
		if _, duplicate := entries[relative]; duplicate {
			return nil, fmt.Errorf("release archive repeats declared file %q", relative)
		}
		if entry.FileInfo().IsDir() || !entry.Mode().IsRegular() {
			return nil, fmt.Errorf("release archive entry %q is not a regular file", relative)
		}
		entries[relative] = entry
	}
	for _, file := range declared {
		if entries[file] == nil {
			return nil, fmt.Errorf("release archive lacks declared file %q", file)
		}
	}
	return entries, nil
}

// publishManagedModelArchiveFile extracts one declared entry into this
// transfer's staging under the digest's single-writer grant, verifies its
// exact size and SHA-256, and publishes the object if absent.
func (s *Service) publishManagedModelArchiveFile(
	transferID string,
	modelsRoot string,
	stagingDir string,
	relativeFile string,
	expected string,
	entry *zip.File,
	remainingBytes int64,
	checkActive func() error,
) (modelDistributionFile, error) {
	nonExecutable := modelDistributionFileNonExecutable(relativeFile)
	if conflict := s.acquireModelObjectWriter(expected, transferID); conflict != nil {
		return modelDistributionFile{}, conflict
	}
	if err := s.persistModelObjectHolds(transferID); err != nil {
		return modelDistributionFile{}, err
	}
	// Another acquisition may have published this digest since the scan.
	if size, reused, err := s.verifyPublishedModelObjectForAcquisition(transferID, modelsRoot, expected, checkActive); err != nil || reused {
		if err != nil {
			return modelDistributionFile{}, err
		}
		s.pinModelObject(expected, transferID)
		return modelDistributionFile{RelativePath: relativeFile, SHA256: expected, SizeBytes: size, NonExecutableContent: nonExecutable}, nil
	}
	if entry.UncompressedSize64 > uint64(clampInt64Minimum(remainingBytes, 0)) {
		return modelDistributionFile{}, managedModelArchiveManifestError(fmt.Errorf("release archive file %q exceeds the declared installed size", relativeFile))
	}
	declaredSize := int64(entry.UncompressedSize64)
	targetPath := filepath.Join(stagingDir, filepath.FromSlash(relativeFile))
	if !pathWithinBase(stagingDir, targetPath, false) {
		return modelDistributionFile{}, managedModelArchiveManifestError(fmt.Errorf("declared file %q escapes staging", relativeFile))
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return modelDistributionFile{}, fmt.Errorf("create model file dir %q: %w", relativeFile, err)
	}
	if err := os.Remove(targetPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return modelDistributionFile{}, fmt.Errorf("discard stale extracted file %q: %w", relativeFile, err)
	}
	digest, size, err := extractManagedModelArchiveEntry(entry, targetPath, declaredSize)
	if err != nil {
		return modelDistributionFile{}, err
	}
	if size != declaredSize || !strings.EqualFold(digest, expected) {
		_ = os.Remove(targetPath)
		return modelDistributionFile{}, fmt.Errorf("model file %q: %w: expected=%s actual=%s size=%d", relativeFile, errModelDownloadHashMismatch, expected, digest, size)
	}
	if err := checkActive(); err != nil {
		return modelDistributionFile{}, err
	}
	if _, err := normalizeModelPayloadPermissionsBeforePublish(targetPath, relativeFile); err != nil {
		return modelDistributionFile{}, err
	}
	if _, _, err := publishModelObjectIfAbsent(modelsRoot, expected, targetPath); err != nil {
		return modelDistributionFile{}, err
	}
	s.pinModelObject(expected, transferID)
	return modelDistributionFile{RelativePath: relativeFile, SHA256: expected, SizeBytes: size, NonExecutableContent: nonExecutable}, nil
}

func extractManagedModelArchiveEntry(entry *zip.File, targetPath string, declaredSize int64) (string, int64, error) {
	source, err := entry.Open()
	if err != nil {
		return "", 0, managedModelArchiveManifestError(fmt.Errorf("open release archive entry: %w", err))
	}
	defer func() { _ = source.Close() }()
	output, err := os.OpenFile(targetPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return "", 0, fmt.Errorf("create extracted model file: %w", err)
	}
	hasher := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(output, hasher), io.LimitReader(source, declaredSize+1))
	closeErr := output.Close()
	if copyErr != nil {
		_ = os.Remove(targetPath)
		if errors.Is(copyErr, zip.ErrChecksum) || errors.Is(copyErr, zip.ErrFormat) || errors.Is(copyErr, io.ErrUnexpectedEOF) {
			return "", 0, managedModelArchiveManifestError(fmt.Errorf("release archive entry is corrupt: %w", copyErr))
		}
		return "", 0, fmt.Errorf("extract release archive entry: %w", copyErr)
	}
	if closeErr != nil {
		_ = os.Remove(targetPath)
		return "", 0, fmt.Errorf("close extracted model file: %w", closeErr)
	}
	return hex.EncodeToString(hasher.Sum(nil)), written, nil
}

// isManagedDownloadIntegrityError reports a fetched source that cannot match
// its pinned integrity; it is never retried and its staging is discarded.
func isManagedDownloadIntegrityError(err error) bool {
	return errors.Is(err, filedownload.ErrHashMismatch) || errors.Is(err, filedownload.ErrSizeMismatch) || errors.Is(err, filedownload.ErrMaxBodyExceeded)
}
