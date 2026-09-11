package nimiappinstall

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappnative"
	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	"golang.org/x/mod/semver"
)

const (
	packageWorkDirectory     = "work"
	packageReleaseDirectory  = "releases"
	packageStagePrefix       = ".stage-"
	installRecoveryTimeout   = 5 * time.Second
	installCommitTimeout     = 15 * time.Second
	publicRegistrySourceBase = "public-registry-app:v1:"
)

var (
	ErrInvalidCoordinator            = errors.New("invalid public App install coordinator")
	ErrUnsupportedInstallPlatform    = errors.New("public App install is unsupported on this platform")
	ErrInstallTarget                 = errors.New("invalid approved public App install target")
	ErrAppAlreadyInstalled           = errors.New("public App is already installed")
	ErrUpdateUnavailable             = errors.New("public App update is unavailable")
	ErrUpdateHostRunning             = errors.New("stop the installed App before updating")
	ErrReleasePublication            = errors.New("public App release publication failed")
	ErrInstallStaging                = errors.New("public App install staging failed")
	ErrInstallRecoveryRequired       = errors.New("public App install requires restart recovery")
	ErrCommitOutcomeUnknown          = errors.New("public App install commit outcome is unknown")
	ErrInstallCommit                 = errors.New("public App install commit failed")
	ErrInstallPersistenceUnavailable = errors.New("public App install persistence is unavailable")
	ErrInstallPaused                 = errors.New("public App download is paused")
	ErrInstallQuiescing              = errors.New("public App package owner is quiescing")
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040b
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c

type registryResolver interface {
	Revalidate(context.Context, publicappregistry.ApprovedTargetSelector) (publicappregistry.ResolvedApprovedTarget, error)
	RevalidateInstalled(context.Context, publicappregistry.ApprovedTargetSelector) (publicappregistry.ResolvedApprovedTarget, error)
}

type targetDownloader interface {
	Download(context.Context, publicappregistry.ResolvedApprovedTarget, *os.Root, DownloadHooks) (DownloadedPackage, error)
}

type Coordinator struct {
	logger       *slog.Logger
	operations   sync.RWMutex
	launchMu     sync.Mutex
	uninstalls   map[string]uninstallReservation
	workersMu    sync.Mutex
	workers      map[string]*installWorker
	workersWG    sync.WaitGroup
	closing      bool
	quiescing    bool
	quiesced     bool
	downloadJob  string
	registry     registryResolver
	downloader   targetDownloader
	kernel       *localappkernel.Kernel
	lifecycle    *localappkernel.PackageLifecycleStore
	packagesRoot *os.Root
	packagesPath string
}

type InstallResult struct {
	Job          localappkernel.PackageJob
	Release      localappkernel.CommittedRelease
	Registration localappkernel.Registration
}

type installWorker struct {
	cancel context.CancelFunc
	done   chan struct{}
	mu     sync.Mutex
	reason string
	paused bool
}

func NewCoordinator(
	registryClient *publicappregistry.Client,
	kernel *localappkernel.Kernel,
	logger *slog.Logger,
) (*Coordinator, error) {
	if registryClient == nil || logger == nil {
		return nil, ErrInvalidCoordinator
	}
	coordinator, err := newCoordinator(registryClient, NewCanonicalDownloader(), kernel)
	if err != nil {
		return nil, err
	}
	coordinator.logger = logger
	return coordinator, nil
}

func newCoordinator(
	registryClient registryResolver,
	downloader targetDownloader,
	kernel *localappkernel.Kernel,
) (*Coordinator, error) {
	if registryClient == nil || downloader == nil {
		return nil, ErrInvalidCoordinator
	}
	coordinator, err := openPackageOwner(kernel)
	if err != nil {
		return nil, err
	}
	coordinator.registry = registryClient
	coordinator.downloader = downloader
	return coordinator, nil
}

func openPackageOwner(kernel *localappkernel.Kernel) (*Coordinator, error) {
	if kernel == nil {
		return nil, ErrInvalidCoordinator
	}
	root := filepath.Clean(strings.TrimSpace(kernel.DataRoot()))
	if kernel.PackageLifecycle() == nil ||
		kernel.Registrations() == nil || root == "." || !filepath.IsAbs(root) || root == filepath.VolumeName(root)+string(filepath.Separator) {
		return nil, ErrInvalidCoordinator
	}
	packagesPath := filepath.Join(root, "apps", "packages")
	if err := os.MkdirAll(filepath.Join(packagesPath, packageWorkDirectory), 0o700); err != nil {
		return nil, fmt.Errorf("create public App package work root: %w", err)
	}
	if err := os.MkdirAll(filepath.Join(packagesPath, packageReleaseDirectory), 0o700); err != nil {
		return nil, fmt.Errorf("create public App package release root: %w", err)
	}
	if err := preparePackageDirectories(packagesPath); err != nil {
		return nil, err
	}
	packagesRoot, err := os.OpenRoot(packagesPath)
	if err != nil {
		return nil, fmt.Errorf("open public App package owner root: %w", err)
	}
	return &Coordinator{
		kernel: kernel, lifecycle: kernel.PackageLifecycle(),
		packagesRoot: packagesRoot, packagesPath: packagesPath, workers: make(map[string]*installWorker), uninstalls: make(map[string]uninstallReservation),
	}, nil
}

func (coordinator *Coordinator) Close() error {
	if coordinator == nil {
		return nil
	}
	coordinator.workersMu.Lock()
	alreadyQuiesced := coordinator.quiesced
	coordinator.closing = true
	coordinator.workersMu.Unlock()
	var stopErr error
	if !alreadyQuiesced {
		stopErr = coordinator.quiesce(context.Background())
	}
	coordinator.operations.Lock()
	defer coordinator.operations.Unlock()
	if coordinator.packagesRoot == nil {
		return stopErr
	}
	err := coordinator.packagesRoot.Close()
	coordinator.packagesRoot = nil
	return errors.Join(stopErr, err)
}

// Install performs one internal synchronous verified-only installation. It is
// intentionally not wired to RPC, SDK, Desktop, or any product profile.
func (coordinator *Coordinator) Install(ctx context.Context, selector publicappregistry.ApprovedTargetSelector) (InstallResult, error) {
	job, err := coordinator.StartInstall(ctx, selector)
	if err != nil {
		return InstallResult{}, err
	}
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		job, err = coordinator.GetJob(ctx, job.JobID)
		if err != nil {
			return InstallResult{}, err
		}
		switch job.Phase {
		case localappkernel.PackageJobCompleted:
			// Publication precedes cleanup in the asynchronous product path.
			// The internal synchronous helper waits for that worker to finish.
			coordinator.workersMu.Lock()
			worker := coordinator.workers[job.JobID]
			coordinator.workersMu.Unlock()
			if worker != nil {
				select {
				case <-worker.done:
				case <-ctx.Done():
					return InstallResult{}, ctx.Err()
				}
			}
			coordinator.operations.RLock()
			if coordinator.isClosing() {
				coordinator.operations.RUnlock()
				return InstallResult{}, ErrInstallQuiescing
			}
			release, err := coordinator.lifecycle.GetCommittedRelease(ctx, job.AppID, job.SourceClass)
			if err != nil {
				coordinator.operations.RUnlock()
				return InstallResult{}, err
			}
			if release.ReleaseRef != job.TargetRef {
				coordinator.operations.RUnlock()
				return InstallResult{}, ErrCommitOutcomeUnknown
			}
			registration, err := coordinator.kernel.Registrations().GetByHandle(ctx, release.RegistrationHandle)
			coordinator.operations.RUnlock()
			return InstallResult{Job: job, Release: release, Registration: registration}, err
		case localappkernel.PackageJobPaused:
			return InstallResult{}, ErrInstallPaused
		case localappkernel.PackageJobCanceled:
			return InstallResult{}, context.Canceled
		case localappkernel.PackageJobFailed:
			return InstallResult{}, failureForReason(job.ReasonCode)
		}
		select {
		case <-ctx.Done():
			return InstallResult{}, ctx.Err()
		case <-ticker.C:
		}
	}
}

// StartInstall persists the exact approved job before returning and schedules
// it under Coordinator supervision. Startup injects this owner only after
// recovery, and the protected Desktop product profile owns its RPC entry.
func (coordinator *Coordinator) StartInstall(
	ctx context.Context,
	selector publicappregistry.ApprovedTargetSelector,
) (localappkernel.PackageJob, error) {
	return coordinator.startInstall(ctx, selector, "", "", nil)
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040b
// The Runtime service checks its exact launch reservations while launchMu is
// held. Once Begin returns, the active package job prevents another launch.
func (coordinator *Coordinator) StartUpdate(ctx context.Context, selector publicappregistry.ApprovedTargetSelector, installedHandle, installedVersion string, requireStopped func(string) error) (localappkernel.PackageJob, error) {
	if installedHandle == "" || installedVersion == "" || requireStopped == nil {
		return localappkernel.PackageJob{}, ErrUpdateUnavailable
	}
	return coordinator.startInstall(ctx, selector, installedHandle, installedVersion, requireStopped)
}

func (coordinator *Coordinator) startInstall(ctx context.Context, selector publicappregistry.ApprovedTargetSelector, installedHandle, installedVersion string, requireStopped func(string) error) (localappkernel.PackageJob, error) {
	if ctx == nil || coordinator == nil {
		return localappkernel.PackageJob{}, ErrInvalidCoordinator
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	if coordinator.isClosing() {
		return localappkernel.PackageJob{}, ErrInstallQuiescing
	}
	coordinator.launchMu.Lock()
	_, job, err := coordinator.beginInstallLocked(ctx, selector, installedHandle, installedVersion, requireStopped)
	coordinator.launchMu.Unlock()
	if err != nil {
		return localappkernel.PackageJob{}, err
	}
	coordinator.workersMu.Lock()
	blocked := coordinator.closing || coordinator.quiescing
	coordinator.workersMu.Unlock()
	if blocked {
		return coordinator.lifecycle.Pause(context.WithoutCancel(ctx), job.JobID, job.Phase, 0, "runtime-interrupted")
	}
	coordinator.scheduleNext()
	return coordinator.lifecycle.GetJob(ctx, job.JobID)
}

func (coordinator *Coordinator) beginInstallLocked(
	ctx context.Context,
	selector publicappregistry.ApprovedTargetSelector,
	installedHandle string,
	installedVersion string,
	requireStopped func(string) error,
) (publicappregistry.ResolvedApprovedTarget, localappkernel.PackageJob, error) {
	if coordinator.registry == nil || coordinator.downloader == nil ||
		coordinator.kernel == nil || coordinator.lifecycle == nil || coordinator.packagesRoot == nil {
		return publicappregistry.ResolvedApprovedTarget{}, localappkernel.PackageJob{}, ErrInvalidCoordinator
	}
	resolved, err := coordinator.registry.Revalidate(ctx, selector)
	if err != nil {
		return publicappregistry.ResolvedApprovedTarget{}, localappkernel.PackageJob{}, err
	}
	selectorText, err := validateResolvedInstallTarget(resolved)
	if err != nil {
		return publicappregistry.ResolvedApprovedTarget{}, localappkernel.PackageJob{}, err
	}
	kind := localappkernel.PackageJobInstall
	var previous *localappkernel.CommittedRelease
	current, currentErr := coordinator.lifecycle.GetCommittedRelease(ctx, resolved.AppID, localappkernel.SourceClassVerified)
	if currentErr == nil {
		if installedHandle == "" {
			return publicappregistry.ResolvedApprovedTarget{}, localappkernel.PackageJob{}, ErrAppAlreadyInstalled
		}
		if current.RegistrationHandle != installedHandle || current.Version != installedVersion {
			return publicappregistry.ResolvedApprovedTarget{}, localappkernel.PackageJob{}, publicappregistry.ErrStaleSelection
		}
		if !semver.IsValid("v"+resolved.Version) || !semver.IsValid("v"+current.Version) {
			return publicappregistry.ResolvedApprovedTarget{}, localappkernel.PackageJob{}, ErrInstallTarget
		}
		if semver.Compare("v"+resolved.Version, "v"+current.Version) <= 0 {
			return publicappregistry.ResolvedApprovedTarget{}, localappkernel.PackageJob{}, ErrAppAlreadyInstalled
		}
		if err := requireStopped(installedHandle); err != nil {
			return publicappregistry.ResolvedApprovedTarget{}, localappkernel.PackageJob{}, err
		}
		kind = localappkernel.PackageJobUpdate
		previous = &current
	} else if !errors.Is(currentErr, localappkernel.ErrCommittedReleaseNotFound) {
		return publicappregistry.ResolvedApprovedTarget{}, localappkernel.PackageJob{}, fmt.Errorf("read current public App release: %w", errors.Join(ErrInstallPersistenceUnavailable, currentErr))
	} else if installedHandle != "" {
		return publicappregistry.ResolvedApprovedTarget{}, localappkernel.PackageJob{}, ErrUpdateUnavailable
	}
	bytesTotal := uint64(resolved.Target.Size)
	if err := ctx.Err(); err != nil {
		return publicappregistry.ResolvedApprovedTarget{}, localappkernel.PackageJob{}, err
	}
	job, err := coordinator.lifecycle.Begin(context.WithoutCancel(ctx), localappkernel.BeginPackageJobInput{
		AppID: resolved.AppID, SourceClass: localappkernel.SourceClassVerified,
		Kind: kind, TargetRef: selectorText,
		ProgressBasis: localappkernel.PackageProgressBytes, BytesTotal: &bytesTotal, Cancelable: true,
		DisplayName: resolved.DisplayName, TargetVersion: resolved.Version, TargetOS: resolved.Target.OS, TargetArch: resolved.Target.Arch, PreviousRelease: previous,
	})
	if err != nil {
		if errors.Is(err, localappkernel.ErrPackageJobActive) {
			return publicappregistry.ResolvedApprovedTarget{}, localappkernel.PackageJob{}, err
		}
		return publicappregistry.ResolvedApprovedTarget{}, localappkernel.PackageJob{}, fmt.Errorf("begin public App install: %w", errors.Join(ErrInstallPersistenceUnavailable, err))
	}
	return resolved, job, nil
}

func (coordinator *Coordinator) runInstallLocked(
	ctx context.Context,
	selector publicappregistry.ApprovedTargetSelector,
	resolved publicappregistry.ResolvedApprovedTarget,
	job localappkernel.PackageJob,
) (InstallResult, error) {
	if !runtimeOwnedChild(job.JobID) {
		return InstallResult{}, coordinator.failInstall(ctx, job, ErrInvalidCoordinator, false)
	}
	var previous *localappkernel.Registration
	if job.Kind == localappkernel.PackageJobUpdate {
		release, err := coordinator.lifecycle.GetCommittedRelease(ctx, job.AppID, job.SourceClass)
		if err != nil {
			return InstallResult{}, coordinator.failInstall(ctx, job, err, false)
		}
		if job.PreviousRelease == nil || !reflect.DeepEqual(release, *job.PreviousRelease) {
			return InstallResult{}, coordinator.failInstall(ctx, job, publicappregistry.ErrStaleSelection, false)
		}
		registration, err := coordinator.kernel.Registrations().GetByHandle(ctx, release.RegistrationHandle)
		if err != nil {
			return InstallResult{}, coordinator.failInstall(ctx, job, err, false)
		}
		previous = &registration
	}
	workRelative := filepath.Join(packageWorkDirectory, job.JobID)
	if err := coordinator.packagesRoot.Mkdir(workRelative, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
		return InstallResult{}, coordinator.failInstall(ctx, job, fmt.Errorf("create public App install work root: %w", err), false)
	}
	if info, err := coordinator.packagesRoot.Lstat(workRelative); err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return InstallResult{}, coordinator.failInstall(ctx, job, errors.Join(ErrDownloadDestination, err), false)
	}
	jobRoot, err := coordinator.packagesRoot.OpenRoot(workRelative)
	if err != nil {
		return InstallResult{}, coordinator.failInstall(ctx, job, fmt.Errorf("open public App install work root: %w", err), false)
	}
	retained, err := coordinator.retainedPackageBytes(job)
	if err != nil {
		_ = jobRoot.Close()
		return InstallResult{}, coordinator.failInstall(ctx, job, err, false)
	}
	advanced, err := coordinator.advanceInstall(ctx, job, localappkernel.PackageJobDownloading, retained)
	if err != nil {
		_ = jobRoot.Close()
		return InstallResult{}, coordinator.failInstall(ctx, job, fmt.Errorf("start public App package download: %w", err), false)
	}
	job = advanced
	var tracker filedownload.RateTracker
	var eta int64
	tracker.ObserveProjection(int64(retained), time.Now())
	downloaded, err := coordinator.downloader.Download(ctx, resolved, jobRoot, DownloadHooks{
		Progress: func(completed, _ int64) {
			now := time.Now()
			speed, known, updated := tracker.ObserveProjection(completed, now)
			if !known {
				speed = 0
			}
			if !known || resolved.Target.Size <= completed {
				eta = 0
			} else if updated {
				eta = filedownload.RemainingSeconds(completed, resolved.Target.Size, speed)
			}
			coordinator.lifecycle.ObserveDownload(job.JobID, uint64(completed), uint64(speed), uint64(eta), now)
		},
		TransferComplete: func() error {
			advanced, err := coordinator.advanceInstall(ctx, job, localappkernel.PackageJobVerifying, uint64(resolved.Target.Size))
			if err != nil {
				return err
			}
			job = advanced
			coordinator.releaseDownload(job.JobID)
			return nil
		},
		PreservePartialOnError: func(cause error) bool { return coordinator.shouldPreserveDownload(job.JobID, cause) },
	})
	if err != nil {
		_ = jobRoot.Close()
		return InstallResult{}, coordinator.failInstall(ctx, job, err, false)
	}
	packageExpected := packageExpectation(resolved)
	nativeVerifier, err := nativeVerifierForTarget(resolved)
	if err != nil {
		_ = jobRoot.Close()
		return InstallResult{}, coordinator.failInstall(ctx, job, err, false)
	}
	probe, err := nimiapppackage.ProbeRuntimeEntry(ctx, downloaded.Path, jobRoot, "native-probe", packageExpected, nativeVerifier)
	closeJobRootErr := jobRoot.Close()
	if err != nil || closeJobRootErr != nil {
		return InstallResult{}, coordinator.failInstall(ctx, job, errors.Join(err, closeJobRootErr), false)
	}
	advanced, err = coordinator.advanceInstall(ctx, job, localappkernel.PackageJobStaging, uint64(resolved.Target.Size))
	if err != nil {
		return InstallResult{}, coordinator.failInstall(ctx, job, fmt.Errorf("start public App package staging: %w", err), false)
	}
	job = advanced
	releasesRoot, err := coordinator.packagesRoot.OpenRoot(packageReleaseDirectory)
	if err != nil {
		return InstallResult{}, coordinator.failInstall(ctx, job, fmt.Errorf("open public App release root: %w", err), false)
	}
	stageName := packageStagePrefix + job.JobID
	materialized, err := nimiapppackage.Materialize(ctx, downloaded.Path, releasesRoot, stageName, packageExpected)
	if err != nil {
		_ = releasesRoot.Close()
		return InstallResult{}, coordinator.failInstall(ctx, job, errors.Join(ErrInstallStaging, err), false)
	}
	if materialized.HostExecutableSHA256 != probe.HostExecutableSHA256 {
		_ = releasesRoot.Close()
		return InstallResult{}, coordinator.failInstall(ctx, job,
			fmt.Errorf("match observed and staged Runtime entry: %w", nimiapppackage.ErrPackageIntegrity), false)
	}
	current, err := coordinator.registry.Revalidate(ctx, selector)
	if err != nil {
		_ = releasesRoot.Close()
		return InstallResult{}, coordinator.failInstall(ctx, job, err, false)
	}
	if !sameResolvedInstallTarget(resolved, current) {
		_ = releasesRoot.Close()
		return InstallResult{}, coordinator.failInstall(ctx, job, ErrInstallTarget, false)
	}
	if job.Kind == localappkernel.PackageJobUpdate {
		baseline, err := coordinator.lifecycle.GetCommittedRelease(ctx, job.AppID, job.SourceClass)
		if err != nil || job.PreviousRelease == nil || !reflect.DeepEqual(baseline, *job.PreviousRelease) {
			_ = releasesRoot.Close()
			return InstallResult{}, coordinator.failInstall(ctx, job, errors.Join(publicappregistry.ErrStaleSelection, err), false)
		}
	}
	advanced, err = coordinator.advanceInstall(ctx, job, localappkernel.PackageJobCommitting, uint64(resolved.Target.Size))
	if err != nil {
		_ = releasesRoot.Close()
		return InstallResult{}, coordinator.failInstall(ctx, job, fmt.Errorf("start public App package commit: %w", err), false)
	}
	job = advanced
	commitContext, cancelCommit := context.WithTimeout(context.WithoutCancel(ctx), installCommitTimeout)
	defer cancelCommit()
	if err := publishStagedRelease(releasesRoot, stageName, job.JobID); err != nil {
		_ = releasesRoot.Close()
		return InstallResult{}, coordinator.failInstall(ctx, job, err, true)
	}
	if err := releasesRoot.Close(); err != nil {
		return InstallResult{}, coordinator.failInstall(ctx, job, fmt.Errorf("close public App release root: %w", err), true)
	}
	registration := coordinator.registrationInput(resolved, job.TargetRef, job.JobID, materialized)
	if previous != nil {
		registration.ExistingRegistrationHandle = previous.RegistrationHandle
		registration.ProvenanceRevision = previous.ProvenanceRevision + 1
	}
	commit, err := coordinator.lifecycle.CommitPackageRelease(commitContext, localappkernel.CommitPackageReleaseInput{
		JobID: job.JobID, Version: resolved.Version, Registration: registration,
	})
	if err != nil {
		return coordinator.resolveCommitError(ctx, job, registration, errors.Join(ErrInstallCommit, err))
	}
	_ = coordinator.packagesRoot.RemoveAll(workRelative)
	if previous != nil {
		oldRoot, err := filepath.Rel(filepath.Join(coordinator.packagesPath, packageReleaseDirectory), previous.ProjectRoot)
		if err == nil && runtimeOwnedChild(oldRoot) && oldRoot != job.JobID {
			// A failed cleanup can be retried by existing startup recovery. The
			// committed new version remains the truthful successful result.
			_ = coordinator.packagesRoot.RemoveAll(filepath.Join(packageReleaseDirectory, oldRoot))
		}
	}
	return InstallResult{Job: commit.Job, Release: commit.Release, Registration: commit.Registration}, nil
}

func validateResolvedInstallTarget(resolved publicappregistry.ResolvedApprovedTarget) (string, error) {
	_, expectedOS, expectedArch, platformErr := publicappregistry.CurrentPlatformTarget()
	if platformErr != nil {
		return "", ErrUnsupportedInstallPlatform
	}
	selectorText, err := resolved.Selector.Encode()
	if err != nil || resolved.Selector.DescriptorID() != resolved.DescriptorID ||
		resolved.Selector.TargetID() != resolved.Target.TargetID ||
		resolved.Selector.ObservedRegistryCommit() != resolved.RegistryRevision || resolved.KillSwitch.Active ||
		resolved.Visibility != "public" || resolved.AppID == "" || resolved.DisplayName == "" || resolved.Version == "" ||
		resolved.Package.Kind != "nimiapp" || resolved.Package.RuntimeKind != "native" || resolved.Package.RegistrationMode != "app-managed" ||
		resolved.Target.OS != expectedOS || resolved.Target.Arch != expectedArch {
		return "", fmt.Errorf("validate approved public App install target: %w", errors.Join(ErrInstallTarget, err))
	}
	return selectorText, nil
}

func packageExpectation(resolved publicappregistry.ResolvedApprovedTarget) nimiapppackage.Expected {
	return nimiapppackage.Expected{
		ArchiveSize: resolved.Target.Size, ArchiveSHA256: resolved.Target.SHA256,
		AppID: resolved.AppID, Version: resolved.Version, TargetID: resolved.Target.TargetID,
		OS: resolved.Target.OS, Arch: resolved.Target.Arch, RuntimeEntry: resolved.Target.RuntimeEntry,
		AppAccess: append([]string(nil), resolved.AppAccess...), ExecutionProfileRef: resolved.Target.ExecutionProfileRef,
		NativeTrust: nimiapppackage.ExpectedNativeTrust{
			WindowsCodeSigning:      resolved.Target.NativeTrust.WindowsCodeSigning,
			SigningSubject:          cloneString(resolved.Target.NativeTrust.SigningSubject),
			ObservedSubject:         cloneString(resolved.Target.NativeTrust.ObservedSubject),
			MacOSNotarization:       resolved.Target.NativeTrust.MacOSNotarization,
			MacOSDeveloperIDSubject: cloneString(resolved.Target.NativeTrust.MacOSDeveloperIDSubject),
		},
	}
}

func nativeVerifierForTarget(resolved publicappregistry.ResolvedApprovedTarget) (nimiapppackage.RuntimeEntryVerifier, error) {
	if resolved.Target.OS == "macos" {
		return nimiappnative.NewMacOSVerifier(nimiappnative.MacOSExpectation{
			Arch: resolved.Target.Arch, ExecutionProfileRef: resolved.Target.ExecutionProfileRef,
			SigningSubject:     cloneString(resolved.Target.NativeTrust.SigningSubject),
			ObservedSubject:    cloneString(resolved.Target.NativeTrust.ObservedSubject),
			DeveloperIDSubject: cloneString(resolved.Target.NativeTrust.MacOSDeveloperIDSubject),
			Notarization:       resolved.Target.NativeTrust.MacOSNotarization,
		})
	}
	if resolved.Target.OS == "windows" {
		return nimiappnative.NewWindowsVerifier(nativeExpectation(resolved))
	}
	return nil, ErrUnsupportedInstallPlatform
}

func nativeExpectation(resolved publicappregistry.ResolvedApprovedTarget) nimiappnative.WindowsExpectation {
	return nimiappnative.WindowsExpectation{
		Arch: resolved.Target.Arch, ExecutionProfileRef: resolved.Target.ExecutionProfileRef,
		WindowsCodeSigning: resolved.Target.NativeTrust.WindowsCodeSigning,
		SigningSubject:     cloneString(resolved.Target.NativeTrust.SigningSubject),
		ObservedSubject:    cloneString(resolved.Target.NativeTrust.ObservedSubject),
	}
}

func (coordinator *Coordinator) registrationInput(
	resolved publicappregistry.ResolvedApprovedTarget,
	selectorText string,
	finalName string,
	materialized nimiapppackage.Materialized,
) localappkernel.RegisterInstalledInput {
	finalRoot := filepath.Join(coordinator.packagesPath, packageReleaseDirectory, finalName)
	var executableDigest protectedlocal.Identifier
	copy(executableDigest[:], materialized.HostExecutableSHA256[:])
	return localappkernel.RegisterInstalledInput{
		AppID: resolved.AppID, DisplayName: resolved.DisplayName,
		SourceRef:   publicRegistrySourceBase + resolved.AppID,
		ProjectRoot: finalRoot, ManifestPath: filepath.Join(finalRoot, "nimi.app.yaml"),
		RawDeclaration: append([]string(nil), materialized.RawDeclaration...), SourceClass: localappkernel.SourceClassVerified,
		ImmutableLineageID:        selectorText,
		ProvenanceAttestationRefs: append([]string(nil), resolved.Target.ProvenanceAttestationRefs...),
		ProvenanceRevision:        1, ExecutionProfileRef: resolved.Target.ExecutionProfileRef,
		HostExecutableDigest: protectedlocal.ExecutableDigestRef(executableDigest),
		PayloadRootDigest:    nimiapppackage.PayloadRootDigestRef(materialized.PayloadRootSHA256),
	}
}

func sameResolvedInstallTarget(left, right publicappregistry.ResolvedApprovedTarget) bool {
	leftSelector, leftErr := left.Selector.Encode()
	rightSelector, rightErr := right.Selector.Encode()
	return leftErr == nil && rightErr == nil && leftSelector == rightSelector &&
		left.DescriptorID == right.DescriptorID && left.AppID == right.AppID && left.DisplayName == right.DisplayName &&
		left.Version == right.Version && reflect.DeepEqual(left.Release, right.Release) &&
		reflect.DeepEqual(left.Package, right.Package) && reflect.DeepEqual(left.AppAccess, right.AppAccess) &&
		reflect.DeepEqual(left.StoragePolicy, right.StoragePolicy) && reflect.DeepEqual(left.Target, right.Target)
}

func runtimeOwnedChild(value string) bool {
	return value != "" && value == strings.TrimSpace(value) && filepath.Base(value) == value &&
		!strings.ContainsAny(value, `/\`) && value != "." && value != ".."
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	result := *value
	return &result
}

func (coordinator *Coordinator) workerCancellationReason(jobID string) string {
	coordinator.workersMu.Lock()
	worker := coordinator.workers[jobID]
	coordinator.workersMu.Unlock()
	if worker == nil {
		return "install-canceled"
	}
	worker.mu.Lock()
	defer worker.mu.Unlock()
	if worker.reason == "" {
		return "install-canceled"
	}
	return worker.reason
}

func (worker *installWorker) requestCancel(reason string) {
	worker.mu.Lock()
	if worker.reason == "" {
		worker.reason = reason
	}
	cancel := worker.cancel
	worker.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (coordinator *Coordinator) isClosing() bool {
	coordinator.workersMu.Lock()
	defer coordinator.workersMu.Unlock()
	return coordinator.closing || coordinator.quiescing
}
