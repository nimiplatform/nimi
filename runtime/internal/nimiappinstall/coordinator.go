package nimiappinstall

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappnative"
	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
)

const (
	packageWorkDirectory     = "work"
	packageReleaseDirectory  = "releases"
	packageStagePrefix       = ".stage-"
	installProgressSteps     = uint64(3)
	installRecoveryTimeout   = 5 * time.Second
	installCommitTimeout     = 15 * time.Second
	publicRegistrySourceBase = "public-registry-app:v1:"
)

var (
	ErrInvalidCoordinator         = errors.New("invalid public App install coordinator")
	ErrUnsupportedInstallPlatform = errors.New("public App install is unsupported on this platform")
	ErrInstallTarget              = errors.New("invalid approved public App install target")
	ErrAppAlreadyInstalled        = errors.New("public App is already installed")
	ErrReleasePublication         = errors.New("public App release publication failed")
	ErrInstallStaging             = errors.New("public App install staging failed")
	ErrInstallRecoveryRequired    = errors.New("public App install requires restart recovery")
	ErrCommitOutcomeUnknown       = errors.New("public App install commit outcome is unknown")
	ErrInstallCommit              = errors.New("public App install commit failed")
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040b
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c

type registryResolver interface {
	Revalidate(context.Context, publicappregistry.ApprovedTargetSelector) (publicappregistry.ResolvedApprovedTarget, error)
}

type targetDownloader interface {
	Download(context.Context, publicappregistry.ResolvedApprovedTarget, *os.Root) (DownloadedPackage, error)
}

type Coordinator struct {
	operations   sync.RWMutex
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

func NewCoordinator(
	registryClient *publicappregistry.Client,
	kernel *localappkernel.Kernel,
) (*Coordinator, error) {
	if registryClient == nil {
		return nil, ErrInvalidCoordinator
	}
	return newCoordinator(registryClient, NewCanonicalDownloader(), kernel)
}

func newCoordinator(
	registryClient registryResolver,
	downloader targetDownloader,
	kernel *localappkernel.Kernel,
) (*Coordinator, error) {
	root := filepath.Clean(strings.TrimSpace(kernel.DataRoot()))
	if registryClient == nil || downloader == nil || kernel == nil || kernel.PackageLifecycle() == nil ||
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
	packagesRoot, err := os.OpenRoot(packagesPath)
	if err != nil {
		return nil, fmt.Errorf("open public App package owner root: %w", err)
	}
	return &Coordinator{
		registry: registryClient, downloader: downloader, kernel: kernel, lifecycle: kernel.PackageLifecycle(),
		packagesRoot: packagesRoot, packagesPath: packagesPath,
	}, nil
}

func (coordinator *Coordinator) Close() error {
	if coordinator == nil {
		return nil
	}
	coordinator.operations.Lock()
	defer coordinator.operations.Unlock()
	if coordinator.packagesRoot == nil {
		return nil
	}
	err := coordinator.packagesRoot.Close()
	coordinator.packagesRoot = nil
	return err
}

// Install performs one internal synchronous verified-only installation. It is
// intentionally not wired to RPC, SDK, Desktop, or any product profile.
func (coordinator *Coordinator) Install(
	ctx context.Context,
	selector publicappregistry.ApprovedTargetSelector,
) (InstallResult, error) {
	if ctx == nil || coordinator == nil {
		return InstallResult{}, ErrInvalidCoordinator
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	if coordinator.registry == nil || coordinator.downloader == nil ||
		coordinator.kernel == nil || coordinator.lifecycle == nil || coordinator.packagesRoot == nil {
		return InstallResult{}, ErrInvalidCoordinator
	}
	resolved, err := coordinator.registry.Revalidate(ctx, selector)
	if err != nil {
		return InstallResult{}, err
	}
	selectorText, err := validateResolvedInstallTarget(resolved)
	if err != nil {
		return InstallResult{}, err
	}
	if _, err := coordinator.lifecycle.GetCommittedRelease(ctx, resolved.AppID, localappkernel.SourceClassVerified); err == nil {
		return InstallResult{}, ErrAppAlreadyInstalled
	} else if !errors.Is(err, localappkernel.ErrCommittedReleaseNotFound) {
		return InstallResult{}, fmt.Errorf("read current public App release: %w", err)
	}
	steps := installProgressSteps
	job, err := coordinator.lifecycle.Begin(ctx, localappkernel.BeginPackageJobInput{
		AppID: resolved.AppID, SourceClass: localappkernel.SourceClassVerified,
		Kind: localappkernel.PackageJobInstall, TargetRef: selectorText,
		ProgressBasis: localappkernel.PackageProgressSteps, StepsTotal: &steps, Cancelable: true,
	})
	if err != nil {
		return InstallResult{}, fmt.Errorf("begin public App install: %w", err)
	}
	if !runtimeOwnedChild(job.JobID) {
		return InstallResult{}, coordinator.failInstall(ctx, job, ErrInvalidCoordinator, false)
	}
	workRelative := filepath.Join(packageWorkDirectory, job.JobID)
	if err := coordinator.packagesRoot.Mkdir(workRelative, 0o700); err != nil {
		return InstallResult{}, coordinator.failInstall(ctx, job, fmt.Errorf("create public App install work root: %w", err), false)
	}
	jobRoot, err := coordinator.packagesRoot.OpenRoot(workRelative)
	if err != nil {
		return InstallResult{}, coordinator.failInstall(ctx, job, fmt.Errorf("open public App install work root: %w", err), false)
	}
	advanced, err := coordinator.lifecycle.Advance(ctx, job.JobID, job.Phase, localappkernel.PackageJobDownloading, localappkernel.PackageJobProgress{})
	if err != nil {
		_ = jobRoot.Close()
		return InstallResult{}, coordinator.failInstall(ctx, job, fmt.Errorf("start public App package download: %w", err), false)
	}
	job = advanced
	downloaded, err := coordinator.downloader.Download(ctx, resolved, jobRoot)
	if err != nil {
		_ = jobRoot.Close()
		return InstallResult{}, coordinator.failInstall(ctx, job, err, false)
	}
	advanced, err = coordinator.lifecycle.Advance(ctx, job.JobID, job.Phase, localappkernel.PackageJobVerifying, localappkernel.PackageJobProgress{StepsCompleted: 1})
	if err != nil {
		_ = jobRoot.Close()
		return InstallResult{}, coordinator.failInstall(ctx, job, fmt.Errorf("start public App package verification: %w", err), false)
	}
	job = advanced
	packageExpected := packageExpectation(resolved)
	nativeVerifier, err := nimiappnative.NewWindowsVerifier(nativeExpectation(resolved))
	if err != nil {
		_ = jobRoot.Close()
		return InstallResult{}, coordinator.failInstall(ctx, job, err, false)
	}
	probe, err := nimiapppackage.ProbeRuntimeEntry(ctx, downloaded.Path, jobRoot, "native-probe", packageExpected, nativeVerifier)
	closeJobRootErr := jobRoot.Close()
	if err != nil || closeJobRootErr != nil {
		return InstallResult{}, coordinator.failInstall(ctx, job, errors.Join(err, closeJobRootErr), false)
	}
	advanced, err = coordinator.lifecycle.Advance(ctx, job.JobID, job.Phase, localappkernel.PackageJobStaging, localappkernel.PackageJobProgress{StepsCompleted: 2})
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
	advanced, err = coordinator.lifecycle.Advance(ctx, job.JobID, job.Phase, localappkernel.PackageJobCommitting, localappkernel.PackageJobProgress{StepsCompleted: 3})
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
	registration := coordinator.registrationInput(resolved, selectorText, job.JobID, materialized)
	commit, err := coordinator.lifecycle.CommitPackageRelease(commitContext, localappkernel.CommitPackageReleaseInput{
		JobID: job.JobID, Version: resolved.Version, Registration: registration,
	})
	if err != nil {
		return coordinator.resolveCommitError(ctx, job, registration, errors.Join(ErrInstallCommit, err))
	}
	_ = coordinator.packagesRoot.RemoveAll(workRelative)
	return InstallResult{Job: commit.Job, Release: commit.Release, Registration: commit.Registration}, nil
}

func validateResolvedInstallTarget(resolved publicappregistry.ResolvedApprovedTarget) (string, error) {
	selectorText, err := resolved.Selector.Encode()
	if err != nil || resolved.Selector.DescriptorID() != resolved.DescriptorID ||
		resolved.Selector.TargetID() != resolved.Target.TargetID ||
		resolved.Selector.ObservedRegistryCommit() != resolved.RegistryRevision || resolved.KillSwitch.Active ||
		resolved.Visibility != "public" || resolved.AppID == "" || resolved.DisplayName == "" || resolved.Version == "" ||
		resolved.Package.Kind != "nimiapp" || resolved.Package.RuntimeKind != "native" || resolved.Package.RegistrationMode != "app-managed" ||
		resolved.Target.OS != "windows" || resolved.Target.Arch != "x86_64" || runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
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
			WindowsCodeSigning: resolved.Target.NativeTrust.WindowsCodeSigning,
			SigningSubject:     cloneString(resolved.Target.NativeTrust.SigningSubject),
			ObservedSubject:    cloneString(resolved.Target.NativeTrust.ObservedSubject),
		},
	}
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
