package nimiappinstall

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	"golang.org/x/mod/semver"
)

const localPackageSourceBase = "local-package-app:v1:"
const localPackageLineageBase = "local-package:v1:"
const localCandidateLifetime = 15 * time.Minute

var ErrLocalCandidate = errors.New("local App package selection expired or unavailable")

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040e
type LocalPackagePreview struct {
	Selector  string
	Metadata  nimiapppackage.LocalMetadata
	ExpiresAt time.Time
}

type localPackageCandidate struct {
	preview   LocalPackagePreview
	directory string
	timer     *time.Timer
}

// PrepareLocalPackage follows the existing protected local-file import
// carrier: only the Desktop machine-product caller supplies a selected path.
// The file is copied before inspection; subsequent actions consume only the
// Runtime-owned immutable copy, never the user's original path.
func (coordinator *Coordinator) PrepareLocalPackage(ctx context.Context, selectedPath string) (LocalPackagePreview, error) {
	if ctx == nil || coordinator == nil || !filepath.IsAbs(selectedPath) || !strings.EqualFold(filepath.Ext(selectedPath), ".nimiapp") {
		return LocalPackagePreview{}, nimiapppackage.ErrInvalidPackage
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	if coordinator.isClosing() {
		return LocalPackagePreview{}, ErrInstallQuiescing
	}
	_, targetOS, targetArch, err := publicappregistry.CurrentPlatformTarget()
	if err != nil {
		return LocalPackagePreview{}, ErrUnsupportedInstallPlatform
	}
	input, err := os.Open(selectedPath)
	if err != nil {
		return LocalPackagePreview{}, fmt.Errorf("read selected App package: %w", err)
	}
	defer func() { _ = input.Close() }()
	info, err := input.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 {
		return LocalPackagePreview{}, nimiapppackage.ErrInvalidPackage
	}
	var random [24]byte
	if _, err := rand.Read(random[:]); err != nil {
		return LocalPackagePreview{}, err
	}
	selector := hex.EncodeToString(random[:])
	directory := filepath.Join(packageWorkDirectory, "candidate-"+selector)
	if err := coordinator.packagesRoot.Mkdir(directory, 0o700); err != nil {
		return LocalPackagePreview{}, err
	}
	retained := false
	defer func() {
		if !retained {
			_ = coordinator.packagesRoot.RemoveAll(directory)
		}
	}()
	root, err := coordinator.packagesRoot.OpenRoot(directory)
	if err != nil {
		return LocalPackagePreview{}, err
	}
	defer func() { _ = root.Close() }()
	output, err := root.OpenFile("package.nimiapp", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return LocalPackagePreview{}, err
	}
	_, copyErr := io.CopyN(output, localContextReader{ctx: ctx, reader: input}, info.Size())
	syncErr := output.Sync()
	closeErr := output.Close()
	if err := errors.Join(copyErr, syncErr, closeErr); err != nil {
		return LocalPackagePreview{}, fmt.Errorf("copy selected App package: %w", err)
	}
	archivePath := filepath.Join(coordinator.packagesPath, directory, "package.nimiapp")
	metadata, err := nimiapppackage.InspectLocal(ctx, archivePath, targetOS, targetArch)
	if err != nil {
		return LocalPackagePreview{}, err
	}
	verifier, err := nativeVerifierForExpected(metadata.Expected)
	if err != nil {
		return LocalPackagePreview{}, err
	}
	if _, err := nimiapppackage.ProbeRuntimeEntry(ctx, archivePath, root, "native-probe", metadata.Expected, verifier); err != nil {
		return LocalPackagePreview{}, err
	}
	preview := LocalPackagePreview{Selector: selector, Metadata: metadata, ExpiresAt: time.Now().UTC().Add(localCandidateLifetime)}
	coordinator.workersMu.Lock()
	defer coordinator.workersMu.Unlock()
	if coordinator.closing || coordinator.quiescing {
		return LocalPackagePreview{}, ErrInstallQuiescing
	}
	candidate := &localPackageCandidate{preview: preview, directory: directory}
	coordinator.localCandidates[selector] = candidate
	candidate.timer = time.AfterFunc(localCandidateLifetime, func() { _ = coordinator.DiscardLocalPackage(context.Background(), selector) })
	retained = true
	return preview, nil
}

type localContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (reader localContextReader) Read(bytes []byte) (int, error) {
	if err := reader.ctx.Err(); err != nil {
		return 0, err
	}
	return reader.reader.Read(bytes)
}

func (coordinator *Coordinator) DiscardLocalPackage(ctx context.Context, selector string) error {
	if coordinator == nil || ctx == nil {
		return ErrLocalCandidate
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	coordinator.workersMu.Lock()
	defer coordinator.workersMu.Unlock()
	candidate := coordinator.localCandidates[selector]
	if candidate == nil {
		return nil
	}
	if err := coordinator.packagesRoot.RemoveAll(candidate.directory); err != nil {
		return err
	}
	candidate.timer.Stop()
	delete(coordinator.localCandidates, selector)
	return nil
}

func (coordinator *Coordinator) StartLocalPackage(ctx context.Context, selector, installedHandle, installedVersion string, requireStopped func(string) error) (localappkernel.PackageJob, error) {
	if coordinator == nil || ctx == nil {
		return localappkernel.PackageJob{}, ErrLocalCandidate
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	coordinator.launchMu.Lock()
	defer coordinator.launchMu.Unlock()
	coordinator.workersMu.Lock()
	defer coordinator.workersMu.Unlock()
	if coordinator.closing || coordinator.quiescing {
		return localappkernel.PackageJob{}, ErrInstallQuiescing
	}
	candidate := coordinator.localCandidates[selector]
	if candidate == nil || !time.Now().Before(candidate.preview.ExpiresAt) {
		return localappkernel.PackageJob{}, ErrLocalCandidate
	}
	metadata := candidate.preview.Metadata
	kind := localappkernel.PackageJobInstall
	var previous *localappkernel.CommittedRelease
	current, err := coordinator.lifecycle.GetCommittedRelease(ctx, metadata.Expected.AppID, localappkernel.SourceClassUserImported)
	if err == nil {
		if installedHandle == "" {
			return localappkernel.PackageJob{}, ErrAppAlreadyInstalled
		}
		if current.RegistrationHandle != installedHandle || current.Version != installedVersion {
			return localappkernel.PackageJob{}, ErrLocalCandidate
		}
		if semver.Compare("v"+metadata.Expected.Version, "v"+current.Version) <= 0 {
			return localappkernel.PackageJob{}, ErrAppAlreadyInstalled
		}
		if requireStopped == nil {
			return localappkernel.PackageJob{}, ErrUpdateUnavailable
		}
		if err := requireStopped(installedHandle); err != nil {
			return localappkernel.PackageJob{}, err
		}
		kind, previous = localappkernel.PackageJobUpdate, &current
	} else if !errors.Is(err, localappkernel.ErrCommittedReleaseNotFound) {
		return localappkernel.PackageJob{}, err
	} else if installedHandle != "" || installedVersion != "" {
		return localappkernel.PackageJob{}, ErrUpdateUnavailable
	}
	total := uint64(metadata.Expected.ArchiveSize)
	job, err := coordinator.lifecycle.Begin(ctx, localappkernel.BeginPackageJobInput{
		AppID: metadata.Expected.AppID, SourceClass: localappkernel.SourceClassUserImported, Kind: kind,
		TargetRef: localPackageLineageBase + selector, ProgressBasis: localappkernel.PackageProgressBytes, BytesTotal: &total, Cancelable: true,
		DisplayName: metadata.DisplayName, TargetVersion: metadata.Expected.Version, TargetOS: metadata.Expected.OS, TargetArch: metadata.Expected.Arch, PreviousRelease: previous,
	})
	if err != nil {
		return localappkernel.PackageJob{}, err
	}
	if err := coordinator.packagesRoot.Rename(candidate.directory, filepath.Join(packageWorkDirectory, job.JobID)); err != nil {
		_, failErr := coordinator.lifecycle.Fail(context.WithoutCancel(ctx), job.JobID, job.Phase, "local-read-failed")
		return localappkernel.PackageJob{}, errors.Join(err, failErr)
	}
	candidate.timer.Stop()
	delete(coordinator.localCandidates, selector)
	workerContext, cancel := context.WithCancel(context.Background())
	worker := &installWorker{cancel: cancel, done: make(chan struct{})}
	coordinator.workers[job.JobID] = worker
	coordinator.workersWG.Add(1)
	go coordinator.runLocalPackage(workerContext, worker, job, metadata)
	return job, nil
}

func (coordinator *Coordinator) runLocalPackage(ctx context.Context, worker *installWorker, job localappkernel.PackageJob, metadata nimiapppackage.LocalMetadata) {
	defer func() {
		worker.cancel()
		coordinator.workersMu.Lock()
		delete(coordinator.workers, job.JobID)
		close(worker.done)
		coordinator.workersMu.Unlock()
		coordinator.workersWG.Done()
	}()
	work := filepath.Join(packageWorkDirectory, job.JobID)
	root, err := coordinator.packagesRoot.OpenRoot(work)
	if err == nil {
		var advanced localappkernel.PackageJob
		advanced, err = coordinator.advanceInstall(ctx, job, localappkernel.PackageJobVerifying, uint64(metadata.Expected.ArchiveSize))
		if err == nil {
			job = advanced
		} else {
			_ = root.Close()
		}
	}
	if err != nil {
		_ = coordinator.failInstall(ctx, job, err, false)
		return
	}
	_, err = coordinator.finishPackageInstall(ctx, job, filepath.Join(coordinator.packagesPath, work, "package.nimiapp"), root, metadata.Expected,
		func(materialized nimiapppackage.Materialized) localappkernel.RegisterInstalledInput {
			return coordinator.localRegistrationInput(metadata, job.TargetRef, job.JobID, materialized)
		}, nil)
	if err != nil && coordinator.logger != nil {
		coordinator.logger.Error("local App package operation failed", "job_id", job.JobID, "error", err)
	}
}

func (coordinator *Coordinator) localRegistrationInput(metadata nimiapppackage.LocalMetadata, lineage, releaseName string, materialized nimiapppackage.Materialized) localappkernel.RegisterInstalledInput {
	root := filepath.Join(coordinator.packagesPath, packageReleaseDirectory, releaseName)
	var digest protectedlocal.Identifier
	copy(digest[:], materialized.HostExecutableSHA256[:])
	return localappkernel.RegisterInstalledInput{
		AppID: metadata.Expected.AppID, DisplayName: metadata.DisplayName, SourceClass: localappkernel.SourceClassUserImported,
		SourceRef: localPackageSourceBase + metadata.Expected.AppID, ProjectRoot: root, ManifestPath: filepath.Join(root, "nimi.app.yaml"),
		RawDeclaration: append([]string(nil), metadata.Expected.AppAccess...), ImmutableLineageID: lineage, ProvenanceRevision: 1,
		ExecutionProfileRef: metadata.Expected.ExecutionProfileRef, HostExecutableDigest: protectedlocal.ExecutableDigestRef(digest),
		PayloadRootDigest: nimiapppackage.PayloadRootDigestRef(materialized.PayloadRootSHA256),
	}
}
