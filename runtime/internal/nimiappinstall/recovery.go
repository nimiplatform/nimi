package nimiappinstall

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappnative"
	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
)

func (coordinator *Coordinator) failInstall(
	callerContext context.Context,
	job localappkernel.PackageJob,
	cause error,
	removeFinal bool,
) error {
	cleanupContext, cancel := context.WithTimeout(context.Background(), installRecoveryTimeout)
	defer cancel()
	if err := coordinator.cleanupJobArtifacts(job.JobID, removeFinal); err != nil {
		return errors.Join(cause, ErrInstallRecoveryRequired, err)
	}
	current, err := coordinator.lifecycle.GetJob(cleanupContext, job.JobID)
	if err != nil {
		return errors.Join(cause, ErrInstallRecoveryRequired, err)
	}
	if terminalPackagePhase(current.Phase) {
		return cause
	}
	if callerContext != nil && (errors.Is(callerContext.Err(), context.Canceled) || errors.Is(callerContext.Err(), context.DeadlineExceeded)) && current.Cancelable {
		_, err = coordinator.lifecycle.Cancel(cleanupContext, current.JobID, current.Phase, "install-canceled")
	} else {
		_, err = coordinator.lifecycle.Fail(cleanupContext, current.JobID, current.Phase, installFailureReason(cause))
	}
	if err != nil {
		return errors.Join(cause, ErrInstallRecoveryRequired, err)
	}
	return cause
}

func installFailureReason(err error) string {
	switch {
	case errors.Is(err, publicappregistry.ErrPolicyBlocked):
		return "policy-blocked"
	case errors.Is(err, publicappregistry.ErrStaleSelection), errors.Is(err, ErrInstallTarget):
		return "stale-selection"
	case errors.Is(err, ErrDownloadedPackage), errors.Is(err, ErrDownloadDestination), errors.Is(err, ErrDownloadRedirect):
		return "download-failed"
	case errors.Is(err, ErrInstallStaging):
		return "staging-failed"
	case errors.Is(err, nimiapppackage.ErrInvalidPackage), errors.Is(err, nimiapppackage.ErrPackageIntegrity),
		errors.Is(err, nimiapppackage.ErrUnsupportedTarget), errors.Is(err, nimiappnative.ErrNativeVerification),
		errors.Is(err, nimiappnative.ErrNativePostureMismatch), errors.Is(err, nimiappnative.ErrInvalidExpectation):
		return "verification-failed"
	case errors.Is(err, ErrReleasePublication):
		return "publication-failed"
	case errors.Is(err, ErrInstallCommit):
		return "commit-failed"
	default:
		return "install-failed"
	}
}

func (coordinator *Coordinator) resolveCommitError(
	callerContext context.Context,
	job localappkernel.PackageJob,
	expected localappkernel.RegisterInstalledInput,
	commitErr error,
) (InstallResult, error) {
	recoveryContext, cancel := context.WithTimeout(context.Background(), installRecoveryTimeout)
	defer cancel()
	result, committed, err := coordinator.observeCommitOutcome(recoveryContext, job, expected)
	if committed {
		_ = coordinator.packagesRoot.RemoveAll(filepath.Join(packageWorkDirectory, job.JobID))
		return result, nil
	}
	if err != nil {
		return InstallResult{}, errors.Join(commitErr, ErrCommitOutcomeUnknown, err)
	}
	return InstallResult{}, coordinator.failInstall(callerContext, job, commitErr, true)
}

func (coordinator *Coordinator) observeCommitOutcome(
	ctx context.Context,
	job localappkernel.PackageJob,
	expected localappkernel.RegisterInstalledInput,
) (InstallResult, bool, error) {
	currentJob, err := coordinator.lifecycle.GetJob(ctx, job.JobID)
	if err != nil {
		return InstallResult{}, false, err
	}
	if currentJob.Phase != localappkernel.PackageJobCompleted {
		if currentJob.Phase != localappkernel.PackageJobCommitting && !terminalPackagePhase(currentJob.Phase) {
			return InstallResult{}, false, fmt.Errorf("unexpected App install phase %s", currentJob.Phase)
		}
		if release, releaseErr := coordinator.lifecycle.GetCommittedRelease(ctx, job.AppID, localappkernel.SourceClassVerified); releaseErr == nil && release.ReleaseRef == job.TargetRef {
			return InstallResult{}, false, ErrCommitOutcomeUnknown
		} else if releaseErr != nil && !errors.Is(releaseErr, localappkernel.ErrCommittedReleaseNotFound) {
			return InstallResult{}, false, releaseErr
		}
		return InstallResult{}, false, nil
	}
	release, err := coordinator.lifecycle.GetCommittedRelease(ctx, job.AppID, localappkernel.SourceClassVerified)
	if err != nil {
		return InstallResult{}, false, err
	}
	registration, err := coordinator.kernel.Registrations().GetByHandle(ctx, release.RegistrationHandle)
	if err != nil {
		return InstallResult{}, false, err
	}
	if release.Version != expectedVersionFromSelector(job.TargetRef) || release.ReleaseRef != job.TargetRef ||
		release.ImmutableLineageID != expected.ImmutableLineageID || release.ExecutionProfileRef != expected.ExecutionProfileRef ||
		release.HostExecutableDigest != expected.HostExecutableDigest || release.PayloadRootDigest != expected.PayloadRootDigest ||
		!sameInstalledRegistration(registration, expected) {
		return InstallResult{}, false, ErrCommitOutcomeUnknown
	}
	return InstallResult{Job: currentJob, Release: release, Registration: registration}, true, nil
}

func sameInstalledRegistration(actual localappkernel.Registration, expected localappkernel.RegisterInstalledInput) bool {
	return actual.AppID == expected.AppID && actual.DisplayName == expected.DisplayName && actual.SourceClass == expected.SourceClass &&
		actual.SourceRef == expected.SourceRef && actual.ProjectRoot == expected.ProjectRoot && actual.ManifestPath == expected.ManifestPath &&
		actual.ImmutableLineageID == expected.ImmutableLineageID && actual.ProvenanceRevision == expected.ProvenanceRevision &&
		actual.ExecutionProfileRef == expected.ExecutionProfileRef && actual.HostExecutableDigest == expected.HostExecutableDigest &&
		actual.PayloadRootDigest == expected.PayloadRootDigest && equalTextList(actual.RawDeclaration, expected.RawDeclaration) &&
		equalTextList(actual.ProvenanceAttestationRefs, expected.ProvenanceAttestationRefs)
}

func expectedVersionFromSelector(selectorText string) string {
	selector, err := publicSelector(selectorText)
	if err != nil {
		return ""
	}
	descriptorID := selector.DescriptorID()
	separator := strings.LastIndexByte(descriptorID, '@')
	if separator < 0 || separator == len(descriptorID)-1 {
		return ""
	}
	return descriptorID[separator+1:]
}

func publicSelector(value string) (publicappregistry.ApprovedTargetSelector, error) {
	return publicappregistry.ParseApprovedTargetSelector(value)
}

func (coordinator *Coordinator) cleanupJobArtifacts(jobID string, removeFinal bool) error {
	if coordinator == nil || coordinator.packagesRoot == nil || !runtimeOwnedChild(jobID) {
		return ErrInstallRecoveryRequired
	}
	var cleanupErrors []error
	for _, relative := range []string{
		filepath.Join(packageWorkDirectory, jobID),
		filepath.Join(packageReleaseDirectory, packageStagePrefix+jobID),
	} {
		if err := coordinator.packagesRoot.RemoveAll(relative); err != nil {
			cleanupErrors = append(cleanupErrors, err)
		}
	}
	if removeFinal {
		if err := coordinator.packagesRoot.RemoveAll(filepath.Join(packageReleaseDirectory, jobID)); err != nil {
			cleanupErrors = append(cleanupErrors, err)
		}
	}
	return errors.Join(cleanupErrors...)
}

func (coordinator *Coordinator) Recover(ctx context.Context) error {
	if ctx == nil || coordinator == nil {
		return ErrInvalidCoordinator
	}
	coordinator.operations.Lock()
	defer coordinator.operations.Unlock()
	if coordinator.packagesRoot == nil || coordinator.lifecycle == nil || coordinator.kernel == nil {
		return ErrInvalidCoordinator
	}
	protected, allowReleaseSweep, recoveryErr := coordinator.protectedReleaseRoots(ctx)
	jobs, err := coordinator.lifecycle.ListJobs(ctx)
	if err != nil {
		return errors.Join(recoveryErr, fmt.Errorf("list App install jobs for recovery: %w", err))
	}
	for _, job := range jobs {
		if err := ctx.Err(); err != nil {
			return errors.Join(recoveryErr, err)
		}
		if !runtimeOwnedChild(job.JobID) || job.Kind != localappkernel.PackageJobInstall {
			recoveryErr = errors.Join(recoveryErr, ErrInstallRecoveryRequired)
			continue
		}
		if job.Phase == localappkernel.PackageJobCompleted {
			if err := coordinator.cleanupJobArtifacts(job.JobID, false); err != nil {
				recoveryErr = errors.Join(recoveryErr, ErrInstallRecoveryRequired, err)
			}
			continue
		}
		if _, referenced := protected[job.JobID]; referenced {
			recoveryErr = errors.Join(recoveryErr, ErrCommitOutcomeUnknown)
			continue
		}
		if err := coordinator.cleanupJobArtifacts(job.JobID, allowReleaseSweep); err != nil {
			recoveryErr = errors.Join(recoveryErr, ErrInstallRecoveryRequired, err)
			continue
		}
		if !terminalPackagePhase(job.Phase) {
			if _, err := coordinator.lifecycle.Fail(ctx, job.JobID, job.Phase, "runtime-restarted"); err != nil {
				recoveryErr = errors.Join(recoveryErr, ErrInstallRecoveryRequired, err)
			}
		}
	}
	if err := coordinator.removeOrphanChildren(packageWorkDirectory, nil, true); err != nil {
		recoveryErr = errors.Join(recoveryErr, err)
	}
	keepReleases := make(map[string]struct{}, len(protected))
	for name := range protected {
		keepReleases[name] = struct{}{}
	}
	if allowReleaseSweep {
		recoveryErr = errors.Join(recoveryErr, coordinator.removeOrphanChildren(packageReleaseDirectory, keepReleases, false))
	}
	return recoveryErr
}

func (coordinator *Coordinator) protectedReleaseRoots(ctx context.Context) (map[string]struct{}, bool, error) {
	result := make(map[string]struct{})
	releases, err := coordinator.lifecycle.ListCommittedReleases(ctx)
	if err != nil {
		return result, false, fmt.Errorf("list committed App releases for recovery: %w", err)
	}
	releaseRootPath := filepath.Join(coordinator.packagesPath, packageReleaseDirectory)
	allowSweep := true
	var integrityErr error
	for _, release := range releases {
		registration, err := coordinator.kernel.Registrations().GetByHandle(ctx, release.RegistrationHandle)
		if err != nil {
			allowSweep = false
			integrityErr = errors.Join(integrityErr, fmt.Errorf("resolve committed App registration for recovery: %w", err))
			continue
		}
		relative, err := filepath.Rel(releaseRootPath, registration.ProjectRoot)
		if err != nil || !runtimeOwnedChild(relative) || registration.ManifestPath != filepath.Join(registration.ProjectRoot, "nimi.app.yaml") {
			allowSweep = false
			integrityErr = errors.Join(integrityErr, ErrInstallRecoveryRequired, err)
			continue
		}
		result[relative] = struct{}{}
		info, err := coordinator.packagesRoot.Lstat(filepath.Join(packageReleaseDirectory, relative))
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			integrityErr = errors.Join(integrityErr, ErrInstallRecoveryRequired, err)
		}
	}
	return result, allowSweep, integrityErr
}

func (coordinator *Coordinator) removeOrphanChildren(directory string, keep map[string]struct{}, removeAll bool) error {
	root, err := coordinator.packagesRoot.OpenRoot(directory)
	if err != nil {
		return errors.Join(ErrInstallRecoveryRequired, err)
	}
	entries, err := fs.ReadDir(root.FS(), ".")
	if err != nil {
		_ = root.Close()
		return errors.Join(ErrInstallRecoveryRequired, err)
	}
	for _, entry := range entries {
		if !runtimeOwnedChild(entry.Name()) {
			_ = root.Close()
			return ErrInstallRecoveryRequired
		}
		info, err := root.Lstat(entry.Name())
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			_ = root.Close()
			return errors.Join(ErrInstallRecoveryRequired, err)
		}
		if _, retained := keep[entry.Name()]; !removeAll && retained {
			continue
		}
		if err := root.RemoveAll(entry.Name()); err != nil {
			_ = root.Close()
			return errors.Join(ErrInstallRecoveryRequired, err)
		}
	}
	if err := root.Close(); err != nil {
		return errors.Join(ErrInstallRecoveryRequired, err)
	}
	return nil
}

func terminalPackagePhase(phase localappkernel.PackageJobPhase) bool {
	return phase == localappkernel.PackageJobCompleted || phase == localappkernel.PackageJobFailed || phase == localappkernel.PackageJobCanceled
}

func equalTextList(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
