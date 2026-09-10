package nimiappinstall

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"unicode/utf8"

	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040b
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040d
// The single reservation covers only HTTP transfer. A worker continues package
// verification/commit after handing the reservation to the next durable job.
func (coordinator *Coordinator) scheduleNext() {
	coordinator.workersMu.Lock()
	defer coordinator.workersMu.Unlock()
	if coordinator.closing || coordinator.quiescing || coordinator.downloadJob != "" {
		return
	}
	jobs, err := coordinator.lifecycle.ListJobs(context.Background())
	if err != nil {
		if coordinator.logger != nil {
			coordinator.logger.Error("read App download queue", "error", err)
		}
		return
	}
	for _, job := range jobs {
		if job.Phase != localappkernel.PackageJobQueued || !downloadJob(job) || coordinator.workers[job.JobID] != nil {
			continue
		}
		ctx, cancel := context.WithCancel(context.Background())
		worker := &installWorker{cancel: cancel, done: make(chan struct{})}
		coordinator.workers[job.JobID], coordinator.downloadJob = worker, job.JobID
		coordinator.workersWG.Add(1)
		go coordinator.runQueued(ctx, worker, job)
		return
	}
}

func downloadJob(job localappkernel.PackageJob) bool {
	return job.SourceClass == localappkernel.SourceClassVerified && (job.Kind == localappkernel.PackageJobInstall || job.Kind == localappkernel.PackageJobUpdate)
}

func (coordinator *Coordinator) runQueued(ctx context.Context, worker *installWorker, job localappkernel.PackageJob) {
	defer func() {
		worker.cancel()
		coordinator.workersMu.Lock()
		delete(coordinator.workers, job.JobID)
		if coordinator.downloadJob == job.JobID {
			coordinator.downloadJob = ""
		}
		close(worker.done)
		coordinator.workersMu.Unlock()
		coordinator.workersWG.Done()
		coordinator.scheduleNext()
	}()
	selector, err := publicSelector(job.TargetRef)
	var resolved publicappregistry.ResolvedApprovedTarget
	if err == nil {
		resolved, err = coordinator.registry.Revalidate(ctx, selector)
	}
	if err == nil {
		_, err = validateResolvedInstallTarget(resolved)
		if resolved.AppID != job.AppID || resolved.Version != job.TargetVersion || job.BytesTotal == nil || *job.BytesTotal != uint64(resolved.Target.Size) {
			err = ErrInstallTarget
		}
	}
	if err != nil {
		err = coordinator.failInstall(ctx, job, err, false)
	} else {
		_, err = coordinator.runInstallLocked(ctx, selector, resolved, job)
	}
	if err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, ErrInstallPaused) && coordinator.logger != nil {
		coordinator.logger.Error("public App package operation failed", "job_id", job.JobID, "app_id", job.AppID, "kind", job.Kind, "error", err)
	}
}

func (coordinator *Coordinator) releaseDownload(jobID string) {
	coordinator.workersMu.Lock()
	if coordinator.downloadJob == jobID {
		coordinator.downloadJob = ""
	}
	coordinator.workersMu.Unlock()
	coordinator.scheduleNext()
}

func (coordinator *Coordinator) advanceInstall(ctx context.Context, job localappkernel.PackageJob, next localappkernel.PackageJobPhase, retained uint64) (localappkernel.PackageJob, error) {
	coordinator.workersMu.Lock()
	defer coordinator.workersMu.Unlock()
	if err := ctx.Err(); err != nil {
		return localappkernel.PackageJob{}, err
	}
	progress := localappkernel.PackageJobProgress{BytesCompleted: retained}
	coordinator.lifecycle.ObserveRetainedBytes(job.JobID, job.Phase, retained)
	return coordinator.lifecycle.Advance(ctx, job.JobID, job.Phase, next, progress)
}

func (coordinator *Coordinator) GetJob(ctx context.Context, jobID string) (localappkernel.PackageJob, error) {
	if coordinator == nil || ctx == nil {
		return localappkernel.PackageJob{}, ErrInvalidCoordinator
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	if coordinator.isClosing() {
		return localappkernel.PackageJob{}, ErrInstallQuiescing
	}
	return coordinator.lifecycle.GetJob(ctx, jobID)
}

func (coordinator *Coordinator) ListJobs(ctx context.Context) ([]localappkernel.PackageJob, error) {
	if coordinator == nil || ctx == nil {
		return nil, ErrInvalidCoordinator
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	if coordinator.isClosing() {
		return nil, ErrInstallQuiescing
	}
	return coordinator.lifecycle.ListJobs(ctx)
}

func (coordinator *Coordinator) PauseInstall(ctx context.Context, jobID string) (localappkernel.PackageJob, error) {
	if coordinator == nil || ctx == nil || !runtimeOwnedChild(jobID) {
		return localappkernel.PackageJob{}, localappkernel.ErrInvalidArgument
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	if coordinator.isClosing() {
		return localappkernel.PackageJob{}, ErrInstallQuiescing
	}
	coordinator.workersMu.Lock()
	job, err := coordinator.lifecycle.GetJob(ctx, jobID)
	if err != nil {
		coordinator.workersMu.Unlock()
		return localappkernel.PackageJob{}, err
	}
	if !downloadJob(job) || (job.Phase != localappkernel.PackageJobQueued && job.Phase != localappkernel.PackageJobDownloading && job.Phase != localappkernel.PackageJobPaused) {
		coordinator.workersMu.Unlock()
		return localappkernel.PackageJob{}, localappkernel.ErrPackageJobPhase
	}
	if job.Phase == localappkernel.PackageJobPaused {
		coordinator.workersMu.Unlock()
		return job, nil
	}
	worker := coordinator.workers[jobID]
	if worker == nil {
		retained, statErr := coordinator.retainedPackageBytes(job)
		if statErr == nil {
			job, err = coordinator.lifecycle.Pause(ctx, jobID, job.Phase, retained, "user-paused")
		} else {
			err = statErr
		}
		coordinator.workersMu.Unlock()
		return job, err
	}
	worker.requestPause("user-paused")
	coordinator.workersMu.Unlock()
	select {
	case <-ctx.Done():
		return localappkernel.PackageJob{}, ctx.Err()
	case <-worker.done:
	}
	job, err = coordinator.lifecycle.GetJob(ctx, jobID)
	if err == nil && job.Phase != localappkernel.PackageJobPaused {
		return localappkernel.PackageJob{}, localappkernel.ErrPackageJobPhase
	}
	return job, err
}

func (coordinator *Coordinator) ResumeInstall(ctx context.Context, jobID string) (localappkernel.PackageJob, error) {
	if coordinator == nil || ctx == nil || !runtimeOwnedChild(jobID) {
		return localappkernel.PackageJob{}, localappkernel.ErrInvalidArgument
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	if coordinator.isClosing() {
		return localappkernel.PackageJob{}, ErrInstallQuiescing
	}
	coordinator.workersMu.Lock()
	job, err := coordinator.lifecycle.GetJob(ctx, jobID)
	if err == nil && (job.Phase != localappkernel.PackageJobPaused || !downloadJob(job)) {
		err = localappkernel.ErrPackageJobPhase
	}
	coordinator.workersMu.Unlock()
	if err != nil {
		return localappkernel.PackageJob{}, err
	}
	selector, err := publicSelector(job.TargetRef)
	if err == nil {
		var resolved publicappregistry.ResolvedApprovedTarget
		resolved, err = coordinator.registry.Revalidate(ctx, selector)
		if err == nil {
			_, err = validateResolvedInstallTarget(resolved)
		}
		if err == nil && (resolved.AppID != job.AppID || resolved.Version != job.TargetVersion || job.BytesTotal == nil || *job.BytesTotal != uint64(resolved.Target.Size)) {
			err = ErrInstallTarget
		}
	}
	if err == nil && job.Kind == localappkernel.PackageJobUpdate {
		var current localappkernel.CommittedRelease
		current, err = coordinator.lifecycle.GetCommittedRelease(ctx, job.AppID, job.SourceClass)
		if err == nil && (job.PreviousRelease == nil || !reflect.DeepEqual(current, *job.PreviousRelease)) {
			err = publicappregistry.ErrStaleSelection
		}
	}
	if err != nil {
		if errors.Is(err, publicappregistry.ErrStaleSelection) || errors.Is(err, publicappregistry.ErrPolicyBlocked) || errors.Is(err, ErrInstallTarget) {
			coordinator.workersMu.Lock()
			current, readErr := coordinator.lifecycle.GetJob(ctx, jobID)
			if readErr == nil && (current.Phase != localappkernel.PackageJobPaused || coordinator.workers[jobID] != nil) {
				readErr = localappkernel.ErrPackageJobPhase
			}
			if readErr == nil {
				readErr = coordinator.cleanupJobArtifacts(jobID, false)
			}
			if readErr == nil {
				_, readErr = coordinator.lifecycle.Fail(ctx, jobID, current.Phase, installFailureReason(err))
			}
			coordinator.workersMu.Unlock()
			return localappkernel.PackageJob{}, errors.Join(err, readErr)
		}
		return localappkernel.PackageJob{}, err
	}
	coordinator.workersMu.Lock()
	if coordinator.closing || coordinator.quiescing {
		coordinator.workersMu.Unlock()
		return localappkernel.PackageJob{}, ErrInstallQuiescing
	}
	job, err = coordinator.lifecycle.GetJob(ctx, jobID)
	if err == nil && job.Phase != localappkernel.PackageJobPaused {
		err = localappkernel.ErrPackageJobPhase
	}
	if err == nil {
		var retained uint64
		retained, err = coordinator.retainedPackageBytes(job)
		if err == nil {
			_, err = coordinator.lifecycle.Pause(ctx, jobID, job.Phase, retained, job.ReasonCode)
		}
		if err == nil {
			job, err = coordinator.lifecycle.Resume(ctx, jobID)
		}
	}
	coordinator.workersMu.Unlock()
	if err != nil {
		return localappkernel.PackageJob{}, err
	}
	coordinator.scheduleNext()
	return coordinator.lifecycle.GetJob(ctx, jobID)
}

func (coordinator *Coordinator) ReorderInstall(ctx context.Context, jobID, beforeID string) (localappkernel.PackageJob, error) {
	if coordinator == nil || ctx == nil {
		return localappkernel.PackageJob{}, localappkernel.ErrInvalidArgument
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	if coordinator.isClosing() {
		return localappkernel.PackageJob{}, ErrInstallQuiescing
	}
	coordinator.workersMu.Lock()
	defer coordinator.workersMu.Unlock()
	if coordinator.workers[jobID] != nil || (beforeID != "" && coordinator.workers[beforeID] != nil) {
		return localappkernel.PackageJob{}, localappkernel.ErrPackageJobPhase
	}
	return coordinator.lifecycle.Reorder(ctx, jobID, beforeID)
}

func (coordinator *Coordinator) CancelInstall(ctx context.Context, jobID string, expectedPhase localappkernel.PackageJobPhase, reasonCode string) (localappkernel.PackageJob, error) {
	if ctx == nil || coordinator == nil || !runtimeOwnedChild(jobID) || reasonCode == "" || reasonCode != strings.TrimSpace(reasonCode) || !utf8.ValidString(reasonCode) || len([]byte(reasonCode)) > 16*1024 {
		return localappkernel.PackageJob{}, localappkernel.ErrInvalidArgument
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	if coordinator.isClosing() {
		return localappkernel.PackageJob{}, ErrInstallQuiescing
	}
	coordinator.workersMu.Lock()
	job, err := coordinator.lifecycle.GetJob(ctx, jobID)
	if err != nil {
		coordinator.workersMu.Unlock()
		return localappkernel.PackageJob{}, err
	}
	if !downloadJob(job) || job.Phase != expectedPhase {
		coordinator.workersMu.Unlock()
		return localappkernel.PackageJob{}, localappkernel.ErrPackageJobPhase
	}
	if !job.Cancelable || terminalPackagePhase(job.Phase) {
		coordinator.workersMu.Unlock()
		return localappkernel.PackageJob{}, localappkernel.ErrPackageJobNotCancelable
	}
	worker := coordinator.workers[jobID]
	if worker == nil {
		if job.Phase != localappkernel.PackageJobQueued && job.Phase != localappkernel.PackageJobPaused {
			coordinator.workersMu.Unlock()
			return localappkernel.PackageJob{}, localappkernel.ErrPackageJobNotCancelable
		}
		if err = coordinator.cleanupJobArtifacts(jobID, false); err == nil {
			job, err = coordinator.lifecycle.Cancel(ctx, jobID, job.Phase, reasonCode)
		}
		coordinator.workersMu.Unlock()
		return job, err
	}
	worker.requestCancel(reasonCode)
	coordinator.workersMu.Unlock()
	select {
	case <-ctx.Done():
		return localappkernel.PackageJob{}, ctx.Err()
	case <-worker.done:
	}
	job, err = coordinator.lifecycle.GetJob(ctx, jobID)
	if err == nil && job.Phase != localappkernel.PackageJobCanceled {
		return localappkernel.PackageJob{}, localappkernel.ErrPackageJobNotCancelable
	}
	return job, err
}

func (worker *installWorker) requestPause(reason string) {
	worker.mu.Lock()
	if worker.reason == "" {
		worker.reason, worker.paused = reason, true
	}
	cancel := worker.cancel
	worker.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (coordinator *Coordinator) workerPause(jobID string) (bool, string) {
	coordinator.workersMu.Lock()
	worker := coordinator.workers[jobID]
	coordinator.workersMu.Unlock()
	if worker == nil {
		return false, ""
	}
	worker.mu.Lock()
	defer worker.mu.Unlock()
	return worker.paused, worker.reason
}

func (coordinator *Coordinator) shouldPreserveDownload(jobID string, cause error) bool {
	if errors.Is(cause, filedownload.ErrHashMismatch) || errors.Is(cause, filedownload.ErrSizeMismatch) || errors.Is(cause, filedownload.ErrMaxBodyExceeded) {
		return false
	}
	paused, _ := coordinator.workerPause(jobID)
	return paused || errors.Is(cause, filedownload.ErrTransientAttemptsExhausted)
}

func (coordinator *Coordinator) retainedPackageBytes(job localappkernel.PackageJob) (uint64, error) {
	var retained uint64
	found := false
	for _, name := range []string{downloadedPackageName, downloadedPackageName + ".download"} {
		info, err := coordinator.packagesRoot.Lstat(filepath.Join(packageWorkDirectory, job.JobID, name))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return 0, fmt.Errorf("inspect retained App package: %w", err)
		}
		if found || !info.Mode().IsRegular() || info.Size() < 0 || (job.BytesTotal != nil && uint64(info.Size()) > *job.BytesTotal) {
			return 0, ErrDownloadDestination
		}
		found, retained = true, uint64(info.Size())
	}
	return retained, nil
}

func failureForReason(reason string) error {
	switch reason {
	case "stale-selection":
		return publicappregistry.ErrStaleSelection
	case "policy-blocked":
		return publicappregistry.ErrPolicyBlocked
	case "verification-failed":
		return nimiapppackage.ErrPackageIntegrity
	case "download-failed":
		return ErrDownloadedPackage
	case "staging-failed":
		return ErrInstallStaging
	case "publication-failed":
		return ErrReleasePublication
	case "commit-failed":
		return ErrInstallCommit
	default:
		return fmt.Errorf("App package operation failed: %s", reason)
	}
}
