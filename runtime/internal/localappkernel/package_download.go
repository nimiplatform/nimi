package localappkernel

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040b
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040d
// Download observations are transient. Only lifecycle transitions checkpoint
// them; recovery always derives the retained byte count from the package files.
func (store *PackageLifecycleStore) ObserveDownload(jobID string, completed, speed, eta uint64, observed time.Time) {
	store.observationMu.Lock()
	defer store.observationMu.Unlock()
	job, exists := store.observations[jobID]
	if !exists || job.Phase != PackageJobDownloading || completed > math.MaxInt64 || (job.BytesTotal != nil && completed > *job.BytesTotal) {
		return
	}
	job.BytesCompleted, job.SpeedBytesPerSec, job.EtaSeconds = completed, speed, eta
	observed = observed.UTC()
	job.ProgressObservedAt, job.UpdatedAt = &observed, observed
	store.observations[jobID] = job
}

func (store *PackageLifecycleStore) ObserveRetainedBytes(jobID string, phase PackageJobPhase, retained uint64) {
	store.observationMu.Lock()
	defer store.observationMu.Unlock()
	job, exists := store.observations[jobID]
	if !exists || job.Phase != phase || isTerminalPackagePhase(phase) || retained > math.MaxInt64 || (job.BytesTotal != nil && retained > *job.BytesTotal) {
		return
	}
	job.BytesCompleted, job.SpeedBytesPerSec, job.EtaSeconds, job.ProgressObservedAt = retained, 0, 0, nil
	job.UpdatedAt = store.kernel.now().UTC()
	store.observations[jobID] = job
}

func (store *PackageLifecycleStore) rememberJob(job PackageJob) {
	store.observationMu.Lock()
	defer store.observationMu.Unlock()
	if store.observations == nil {
		store.observations = make(map[string]PackageJob)
	}
	job.SpeedBytesPerSec, job.EtaSeconds, job.ProgressObservedAt = 0, 0, nil
	store.observations[job.JobID] = job
}

func (store *PackageLifecycleStore) forgetJob(jobID string) {
	store.observationMu.Lock()
	defer store.observationMu.Unlock()
	delete(store.observations, jobID)
}

func (store *PackageLifecycleStore) projectObserved(job PackageJob) PackageJob {
	store.observationMu.Lock()
	observed, exists := store.observations[job.JobID]
	store.observationMu.Unlock()
	if exists && job.Phase == observed.Phase && !observed.UpdatedAt.Before(job.UpdatedAt) {
		job.BytesCompleted, job.SpeedBytesPerSec, job.EtaSeconds = observed.BytesCompleted, observed.SpeedBytesPerSec, observed.EtaSeconds
		job.ProgressObservedAt, job.UpdatedAt = observed.ProgressObservedAt, observed.UpdatedAt
	}
	if job.Phase != PackageJobDownloading || job.ProgressObservedAt == nil || store.kernel.now().Sub(*job.ProgressObservedAt) > filedownload.RateWindow || store.kernel.now().Before(*job.ProgressObservedAt) {
		job.SpeedBytesPerSec, job.EtaSeconds = 0, 0
	}
	return job
}

func isQueuedDownload(job PackageJob) bool {
	return job.Phase == PackageJobQueued && job.SourceClass == SourceClassVerified && (job.Kind == PackageJobInstall || job.Kind == PackageJobUpdate)
}

// Pause checkpoints only after the owner has stopped I/O. Unlike Advance, its
// actual retained size may be smaller than a previous observation (HTTP 200
// restart, removed file, or an interrupted write).
func (store *PackageLifecycleStore) Pause(ctx context.Context, jobID string, expected PackageJobPhase, retained uint64, reason string) (PackageJob, error) {
	if store == nil || store.kernel == nil || requireExactText("job_id", jobID) != nil || requireExactText("reason", reason) != nil || retained > math.MaxInt64 {
		return PackageJob{}, ErrInvalidArgument
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return PackageJob{}, fmt.Errorf("begin App download pause: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	job, err := loadPackageJob(ctx, tx, jobID)
	if err != nil {
		return PackageJob{}, err
	}
	if job.Phase != expected || job.SourceClass != SourceClassVerified || (job.Kind != PackageJobInstall && job.Kind != PackageJobUpdate) {
		return PackageJob{}, ErrPackageJobPhase
	}
	if isTerminalPackagePhase(job.Phase) {
		return PackageJob{}, ErrPackageJobTerminal
	}
	if !job.Cancelable || job.Phase == PackageJobCommitting {
		return PackageJob{}, ErrPackageJobNotCancelable
	}
	if job.BytesTotal != nil && retained > *job.BytesTotal {
		return PackageJob{}, ErrPackageJobProgress
	}
	now := store.kernel.now().UTC()
	if _, err := tx.ExecContext(ctx, `UPDATE app_package_job SET phase = 'paused', bytes_completed = ?, reason_code = ?, updated_unix_nano = ? WHERE job_id = ?`, retained, reason, now.UnixNano(), jobID); err != nil {
		return PackageJob{}, fmt.Errorf("pause App download: %w", err)
	}
	if err := store.kernel.commitTransaction(tx); err != nil {
		return PackageJob{}, fmt.Errorf("commit App download pause: %w", err)
	}
	job.Phase, job.BytesCompleted, job.ReasonCode, job.UpdatedAt = PackageJobPaused, retained, reason, now
	store.rememberJob(job)
	return store.GetJob(ctx, jobID)
}

func (store *PackageLifecycleStore) Resume(ctx context.Context, jobID string) (PackageJob, error) {
	if store == nil || store.kernel == nil || requireExactText("job_id", jobID) != nil {
		return PackageJob{}, ErrInvalidArgument
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return PackageJob{}, fmt.Errorf("begin App download resume: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	job, err := loadPackageJob(ctx, tx, jobID)
	if err != nil {
		return PackageJob{}, err
	}
	if job.Phase != PackageJobPaused || job.SourceClass != SourceClassVerified || (job.Kind != PackageJobInstall && job.Kind != PackageJobUpdate) {
		return PackageJob{}, ErrPackageJobPhase
	}
	var order int64
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(queue_order), 0) + 1 FROM app_package_job WHERE phase NOT IN ('completed','failed','canceled')`).Scan(&order); err != nil {
		return PackageJob{}, err
	}
	now := store.kernel.now().UTC()
	if _, err := tx.ExecContext(ctx, `UPDATE app_package_job SET phase = 'queued', queue_order = ?, reason_code = '', updated_unix_nano = ? WHERE job_id = ?`, order, now.UnixNano(), jobID); err != nil {
		return PackageJob{}, fmt.Errorf("queue resumed App download: %w", err)
	}
	if err := store.kernel.commitTransaction(tx); err != nil {
		return PackageJob{}, fmt.Errorf("commit App download resume: %w", err)
	}
	job.Phase, job.QueueOrder, job.ReasonCode, job.UpdatedAt = PackageJobQueued, order, "", now
	store.rememberJob(job)
	return store.GetJob(ctx, jobID)
}

func (store *PackageLifecycleStore) Reorder(ctx context.Context, jobID, beforeID string) (PackageJob, error) {
	if store == nil || store.kernel == nil || requireExactText("job_id", jobID) != nil || (beforeID != "" && requireExactText("before_job_id", beforeID) != nil) || beforeID == jobID {
		return PackageJob{}, ErrInvalidArgument
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return PackageJob{}, fmt.Errorf("begin App queue reorder: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `SELECT job_id FROM app_package_job WHERE phase = 'queued' AND source_class = 'verified' AND kind IN ('install','update') ORDER BY queue_order, job_id`)
	if err != nil {
		return PackageJob{}, err
	}
	var order []string
	found, anchor := false, beforeID == ""
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return PackageJob{}, err
		}
		if id == jobID {
			found = true
			continue
		}
		if id == beforeID {
			anchor = true
			order = append(order, jobID)
		}
		order = append(order, id)
	}
	readErr := rows.Err()
	_ = rows.Close()
	if readErr != nil {
		return PackageJob{}, readErr
	}
	if !found || !anchor {
		return PackageJob{}, ErrPackageJobPhase
	}
	if beforeID == "" {
		order = append(order, jobID)
	}
	now := store.kernel.now().UTC()
	for index, id := range order {
		if _, err := tx.ExecContext(ctx, `UPDATE app_package_job SET queue_order = ?, updated_unix_nano = ? WHERE job_id = ?`, index+1, now.UnixNano(), id); err != nil {
			return PackageJob{}, fmt.Errorf("reorder App queue: %w", err)
		}
	}
	if err := store.kernel.commitTransaction(tx); err != nil {
		return PackageJob{}, fmt.Errorf("commit App queue reorder: %w", err)
	}
	return store.GetJob(ctx, jobID)
}
