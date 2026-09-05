package nimiappinstall

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

const uninstallRootPrefix = ".uninstall-"

var ErrUninstall = errors.New("verified App uninstall failed")

type uninstallReservation struct {
	registration localappkernel.Registration
	release      localappkernel.CommittedRelease
	releaseName  string
}

// The existing durable queued job excludes every new package mutation and
// launch/bind. The generation snapshot is needed only by this live operation;
// startup restores any pre-commit detached root and fails interrupted jobs.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040b
func (coordinator *Coordinator) StartUninstall(ctx context.Context, handle string) (localappkernel.PackageJob, error) {
	if ctx == nil || coordinator == nil || runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		return localappkernel.PackageJob{}, ErrInvalidCoordinator
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	coordinator.launchMu.Lock()
	defer coordinator.launchMu.Unlock()
	if coordinator.isClosing() {
		return localappkernel.PackageJob{}, ErrInvalidCoordinator
	}
	reservation, err := coordinator.resolveUninstall(ctx, handle)
	if err != nil {
		return localappkernel.PackageJob{}, err
	}
	steps := uint64(2)
	job, err := coordinator.lifecycle.Begin(ctx, localappkernel.BeginPackageJobInput{
		AppID: reservation.release.AppID, SourceClass: localappkernel.SourceClassVerified, Kind: localappkernel.PackageJobUninstall,
		TargetRef: reservation.release.ReleaseRef, ProgressBasis: localappkernel.PackageProgressSteps, StepsTotal: &steps, Cancelable: true,
	})
	if err != nil {
		return localappkernel.PackageJob{}, err
	}
	coordinator.uninstalls[job.JobID] = reservation
	return job, nil
}

func (coordinator *Coordinator) resolveUninstall(ctx context.Context, handle string) (uninstallReservation, error) {
	registration, err := coordinator.kernel.Registrations().GetByHandle(ctx, handle)
	if err != nil || registration.State != localappkernel.RegistrationStateActive || registration.SourceClass != localappkernel.SourceClassVerified || registration.SourceGeneration == 0 || registration.DeclarationGeneration == 0 {
		return uninstallReservation{}, errors.Join(ErrUninstall, err)
	}
	release, err := coordinator.lifecycle.GetCommittedRelease(ctx, registration.AppID, localappkernel.SourceClassVerified)
	if err != nil || release.RegistrationHandle != handle || release.ReleaseRef != registration.ImmutableLineageID {
		return uninstallReservation{}, errors.Join(ErrUninstall, err)
	}
	name, err := filepath.Rel(filepath.Join(coordinator.packagesPath, packageReleaseDirectory), registration.ProjectRoot)
	if err != nil || !runtimeOwnedChild(name) || registration.ProjectRoot != filepath.Join(coordinator.packagesPath, packageReleaseDirectory, name) || registration.ManifestPath != filepath.Join(registration.ProjectRoot, "nimi.app.yaml") {
		return uninstallReservation{}, errors.Join(ErrUninstall, err)
	}
	return uninstallReservation{registration: registration, release: release, releaseName: name}, nil
}

func (coordinator *Coordinator) CancelUninstall(ctx context.Context, jobID string, expected localappkernel.PackageJobPhase, reason string) (localappkernel.PackageJob, error) {
	if ctx == nil || coordinator == nil {
		return localappkernel.PackageJob{}, ErrInvalidCoordinator
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	coordinator.launchMu.Lock()
	defer coordinator.launchMu.Unlock()
	job, err := coordinator.lifecycle.GetJob(ctx, jobID)
	if err != nil {
		return localappkernel.PackageJob{}, err
	}
	if job.Kind != localappkernel.PackageJobUninstall || expected != localappkernel.PackageJobQueued || job.Phase != expected {
		return localappkernel.PackageJob{}, localappkernel.ErrPackageJobNotCancelable
	}
	job, err = coordinator.lifecycle.Cancel(ctx, jobID, expected, reason)
	if err == nil {
		delete(coordinator.uninstalls, jobID)
	}
	return job, err
}

// CompleteUninstall is redeemed only by Desktop main after its exact process
// scope has stopped. The same selector, queued job and registration generation
// must still agree before Runtime detaches or mutates anything.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
func (coordinator *Coordinator) CompleteUninstall(ctx context.Context, jobID, handle string) (localappkernel.PackageJob, error) {
	if ctx == nil || coordinator == nil {
		return localappkernel.PackageJob{}, ErrInvalidCoordinator
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	coordinator.launchMu.Lock()
	defer coordinator.launchMu.Unlock()
	if coordinator.isClosing() {
		return localappkernel.PackageJob{}, ErrInvalidCoordinator
	}
	expected, ok := coordinator.uninstalls[jobID]
	if !ok || expected.registration.RegistrationHandle != handle {
		return localappkernel.PackageJob{}, ErrUninstall
	}
	job, err := coordinator.lifecycle.GetJob(ctx, jobID)
	if err != nil {
		return localappkernel.PackageJob{}, err
	}
	if job.Kind != localappkernel.PackageJobUninstall || job.Phase != localappkernel.PackageJobQueued || job.TargetRef != expected.release.ReleaseRef {
		return localappkernel.PackageJob{}, localappkernel.ErrPackageJobPhase
	}
	current, err := coordinator.resolveUninstall(ctx, handle)
	if err != nil || current.releaseName != expected.releaseName || current.release.ReleaseRef != expected.release.ReleaseRef ||
		current.registration.SourceGeneration != expected.registration.SourceGeneration || current.registration.DeclarationGeneration != expected.registration.DeclarationGeneration {
		return localappkernel.PackageJob{}, errors.Join(ErrUninstall, err)
	}
	root, err := coordinator.packagesRoot.OpenRoot(packageReleaseDirectory)
	if err != nil {
		return localappkernel.PackageJob{}, errors.Join(ErrUninstall, err)
	}
	defer func() { _ = root.Close() }()
	quarantine := uninstallRootPrefix + jobID
	job, err = coordinator.lifecycle.Advance(ctx, jobID, job.Phase, localappkernel.PackageJobRemovingPackage, localappkernel.PackageJobProgress{})
	if err != nil {
		return localappkernel.PackageJob{}, err
	}
	if err := publishStagedRelease(root, current.releaseName, quarantine); err != nil {
		return localappkernel.PackageJob{}, coordinator.rollbackUninstall(ctx, job, expected, err)
	}
	advanced, err := coordinator.lifecycle.Advance(ctx, jobID, job.Phase, localappkernel.PackageJobUnregistering, localappkernel.PackageJobProgress{StepsCompleted: 1})
	if err != nil {
		return localappkernel.PackageJob{}, coordinator.rollbackUninstall(ctx, job, expected, err)
	}
	job = advanced
	commitCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), installCommitTimeout)
	defer cancel()
	completed, commitErr := coordinator.lifecycle.CompleteUninstall(commitCtx, jobID, handle, expected.registration.SourceGeneration, expected.registration.DeclarationGeneration)
	if commitErr != nil {
		observed, readErr := coordinator.lifecycle.GetJob(commitCtx, jobID)
		if readErr != nil {
			return localappkernel.PackageJob{}, errors.Join(ErrInstallRecoveryRequired, commitErr, readErr)
		}
		if observed.Phase != localappkernel.PackageJobCompleted {
			return localappkernel.PackageJob{}, coordinator.rollbackUninstall(commitCtx, observed, expected, commitErr)
		}
		completed = observed
	}
	delete(coordinator.uninstalls, jobID)
	if err := root.RemoveAll(quarantine); err != nil {
		return localappkernel.PackageJob{}, errors.Join(ErrUninstall, err)
	}
	return completed, nil
}

func (coordinator *Coordinator) rollbackUninstall(ctx context.Context, job localappkernel.PackageJob, reservation uninstallReservation, cause error) error {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), installRecoveryTimeout)
	defer cancel()
	if err := coordinator.restoreUninstallRoot(job, reservation); err != nil {
		return errors.Join(cause, ErrInstallRecoveryRequired, err)
	}
	current, err := coordinator.lifecycle.GetJob(cleanup, job.JobID)
	if err != nil {
		return errors.Join(cause, ErrInstallRecoveryRequired, err)
	}
	if !terminalPackagePhase(current.Phase) {
		_, err = coordinator.lifecycle.Fail(cleanup, job.JobID, current.Phase, "uninstall-failed")
	}
	if err == nil {
		delete(coordinator.uninstalls, job.JobID)
	}
	return errors.Join(ErrUninstall, cause, err)
}

func (coordinator *Coordinator) restoreUninstallRoot(job localappkernel.PackageJob, reservation uninstallReservation) error {
	root, err := coordinator.packagesRoot.OpenRoot(packageReleaseDirectory)
	if err != nil {
		return err
	}
	defer func() { _ = root.Close() }()
	quarantine := uninstallRootPrefix + job.JobID
	if _, err := root.Lstat(quarantine); errors.Is(err, os.ErrNotExist) {
		info, err := root.Lstat(reservation.releaseName)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return errors.Join(ErrUninstall, err)
		}
		return nil
	} else if err != nil {
		return err
	}
	return publishStagedRelease(root, quarantine, reservation.releaseName)
}

func (coordinator *Coordinator) recoverUninstall(ctx context.Context, job localappkernel.PackageJob) error {
	if !runtimeOwnedChild(job.JobID) {
		return ErrInstallRecoveryRequired
	}
	if job.Phase == localappkernel.PackageJobCompleted {
		return coordinator.packagesRoot.RemoveAll(filepath.Join(packageReleaseDirectory, uninstallRootPrefix+job.JobID))
	}
	if terminalPackagePhase(job.Phase) {
		_, err := coordinator.packagesRoot.Lstat(filepath.Join(packageReleaseDirectory, uninstallRootPrefix+job.JobID))
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return errors.Join(ErrInstallRecoveryRequired, err)
	}
	release, err := coordinator.lifecycle.GetCommittedRelease(ctx, job.AppID, localappkernel.SourceClassVerified)
	if err != nil {
		return errors.Join(ErrInstallRecoveryRequired, err)
	}
	reservation, err := coordinator.resolveUninstall(ctx, release.RegistrationHandle)
	if err != nil || release.ReleaseRef != job.TargetRef {
		return errors.Join(ErrInstallRecoveryRequired, err)
	}
	if err := coordinator.restoreUninstallRoot(job, reservation); err != nil {
		return fmt.Errorf("restore interrupted App uninstall: %w", err)
	}
	if !terminalPackagePhase(job.Phase) {
		_, err = coordinator.lifecycle.Fail(ctx, job.JobID, job.Phase, "runtime-restarted")
	}
	return err
}
