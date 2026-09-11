package localappkernel

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"strings"
	"sync"
	"time"
)

var (
	ErrPackageJobActive         = errors.New("App package mutation job is already active")
	ErrPackageJobNotFound       = errors.New("App package mutation job not found")
	ErrPackageJobPhase          = errors.New("App package mutation job phase conflict")
	ErrPackageJobNotCancelable  = errors.New("App package mutation job is not cancelable")
	ErrPackageJobProgress       = errors.New("App package mutation job progress is invalid")
	ErrPackageJobTerminal       = errors.New("App package mutation job is terminal")
	ErrCommittedReleaseNotFound = errors.New("committed App release not found")
)

type PackageJobKind string

const (
	PackageJobInstall   PackageJobKind = "install"
	PackageJobUpdate    PackageJobKind = "update"
	PackageJobRepair    PackageJobKind = "repair"
	PackageJobUninstall PackageJobKind = "uninstall"
)

type PackageJobPhase string

const (
	PackageJobQueued             PackageJobPhase = "queued"
	PackageJobDownloading        PackageJobPhase = "downloading"
	PackageJobPaused             PackageJobPhase = "paused"
	PackageJobReadingLocal       PackageJobPhase = "reading-local"
	PackageJobVerifying          PackageJobPhase = "verifying"
	PackageJobVerifyingInstalled PackageJobPhase = "verifying-installed"
	PackageJobAcquiringMissing   PackageJobPhase = "acquiring-missing"
	PackageJobStaging            PackageJobPhase = "staging"
	PackageJobCommitting         PackageJobPhase = "committing"
	PackageJobRemovingPackage    PackageJobPhase = "removing-package"
	PackageJobUnregistering      PackageJobPhase = "unregistering"
	PackageJobCompleted          PackageJobPhase = "completed"
	PackageJobFailed             PackageJobPhase = "failed"
	PackageJobCanceled           PackageJobPhase = "canceled"
)

type PackageProgressBasis string

const (
	PackageProgressBytes         PackageProgressBasis = "bytes"
	PackageProgressSteps         PackageProgressBasis = "steps"
	PackageProgressIndeterminate PackageProgressBasis = "indeterminate"
)

type PackageJob struct {
	JobID              string
	AppID              string
	SourceClass        SourceClass
	Kind               PackageJobKind
	TargetRef          string
	Phase              PackageJobPhase
	ProgressBasis      PackageProgressBasis
	BytesCompleted     uint64
	BytesTotal         *uint64
	StepsCompleted     uint64
	StepsTotal         *uint64
	StartedAt          time.Time
	CompletedAt        *time.Time
	TerminalResult     string
	ReasonCode         string
	Cancelable         bool
	QueueOrder         int64
	QueuePosition      uint32
	DisplayName        string
	TargetVersion      string
	PreviousVersion    string
	TargetOS           string
	TargetArch         string
	PreviousRelease    *CommittedRelease
	UpdatedAt          time.Time
	SpeedBytesPerSec   uint64
	EtaSeconds         uint64
	ProgressObservedAt *time.Time
}

type BeginPackageJobInput struct {
	AppID           string
	SourceClass     SourceClass
	Kind            PackageJobKind
	TargetRef       string
	ProgressBasis   PackageProgressBasis
	BytesTotal      *uint64
	StepsTotal      *uint64
	Cancelable      bool
	DisplayName     string
	TargetVersion   string
	TargetOS        string
	TargetArch      string
	PreviousRelease *CommittedRelease
}

type PackageJobProgress struct {
	BytesCompleted uint64
	StepsCompleted uint64
}

type CommittedRelease struct {
	AppID                     string
	SourceClass               SourceClass
	Version                   string
	ReleaseRef                string
	RegistrationHandle        string
	ImmutableLineageID        string
	ProvenanceAttestationRefs []string
	ProvenanceRevision        uint64
	ExecutionProfileRef       string
	HostExecutableDigest      string
	PayloadRootDigest         string
	CommittedAt               time.Time
}

type CommitPackageReleaseInput struct {
	JobID        string
	Version      string
	Registration RegisterInstalledInput
}

type CommitPackageReleaseResult struct {
	Job          PackageJob
	Release      CommittedRelease
	Registration Registration
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040b
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
type PackageLifecycleStore struct {
	kernel        *Kernel
	observationMu sync.Mutex
	observations  map[string]PackageJob
}

var packageLifecycleSchemaStatements = []string{
	`CREATE TABLE IF NOT EXISTS app_package_job (
		job_id TEXT PRIMARY KEY,
		app_id TEXT NOT NULL,
		source_class TEXT NOT NULL CHECK(source_class IN ('verified','user_imported')),
		kind TEXT NOT NULL CHECK(kind IN ('install','update','repair','uninstall')),
		target_ref TEXT NOT NULL,
		phase TEXT NOT NULL CHECK(phase IN ('queued','downloading','paused','reading-local','verifying','verifying-installed','acquiring-missing','staging','committing','removing-package','unregistering','completed','failed','canceled')),
		progress_basis TEXT NOT NULL CHECK(progress_basis IN ('bytes','steps','indeterminate')),
		bytes_completed INTEGER NOT NULL CHECK(bytes_completed >= 0),
		bytes_total INTEGER CHECK(bytes_total IS NULL OR bytes_total >= 0),
		steps_completed INTEGER NOT NULL CHECK(steps_completed >= 0),
		steps_total INTEGER CHECK(steps_total IS NULL OR steps_total >= 0),
		started_unix_nano INTEGER NOT NULL,
		completed_unix_nano INTEGER,
		terminal_result TEXT NOT NULL,
		reason_code TEXT NOT NULL,
		cancelable INTEGER NOT NULL CHECK(cancelable IN (0,1)),
		queue_order INTEGER NOT NULL CHECK(queue_order >= 0),
		display_name TEXT NOT NULL,
		target_version TEXT NOT NULL,
		target_os TEXT NOT NULL,
		target_arch TEXT NOT NULL,
		previous_release_json TEXT NOT NULL,
		updated_unix_nano INTEGER NOT NULL,
		CHECK((phase IN ('completed','failed','canceled') AND completed_unix_nano IS NOT NULL AND terminal_result <> '')
		   OR (phase = 'paused' AND completed_unix_nano IS NULL AND terminal_result = '' AND reason_code <> '')
		   OR (phase NOT IN ('paused','completed','failed','canceled') AND completed_unix_nano IS NULL AND terminal_result = '' AND reason_code = ''))
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS app_package_job_one_active_source
		ON app_package_job(app_id, source_class)
		WHERE phase NOT IN ('completed','failed','canceled')`,
	`CREATE TABLE IF NOT EXISTS committed_app_release (
		app_id TEXT NOT NULL,
		source_class TEXT NOT NULL CHECK(source_class IN ('verified','user_imported')),
		version TEXT NOT NULL,
		release_ref TEXT NOT NULL,
		registration_handle TEXT NOT NULL,
		immutable_lineage_id TEXT NOT NULL,
		provenance_attestation_refs_json TEXT NOT NULL,
		provenance_revision INTEGER NOT NULL CHECK(provenance_revision > 0),
		execution_profile_ref TEXT NOT NULL,
		host_executable_digest TEXT NOT NULL,
		payload_root_digest TEXT NOT NULL,
		committed_unix_nano INTEGER NOT NULL,
		PRIMARY KEY(app_id, source_class),
		FOREIGN KEY(registration_handle) REFERENCES canonical_registration(registration_handle)
	)`,
}

func (store *PackageLifecycleStore) Begin(ctx context.Context, input BeginPackageJobInput) (PackageJob, error) {
	if store == nil || store.kernel == nil {
		return PackageJob{}, ErrInvalidArgument
	}
	if err := validateBeginPackageJob(input); err != nil {
		return PackageJob{}, err
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return PackageJob{}, fmt.Errorf("begin App package job transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var active int
	err = tx.QueryRowContext(ctx, `SELECT 1 FROM app_package_job WHERE app_id = ? AND source_class = ?
		AND phase NOT IN ('completed','failed','canceled')`, input.AppID, string(input.SourceClass)).Scan(&active)
	if err == nil {
		return PackageJob{}, ErrPackageJobActive
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PackageJob{}, fmt.Errorf("read active App package job: %w", err)
	}
	jobID, err := store.kernel.nextIdentifier("apj_v1_", func(candidate string) (bool, error) {
		var found int
		err := tx.QueryRowContext(ctx, `SELECT 1 FROM app_package_job WHERE job_id = ?`, candidate).Scan(&found)
		return err == nil, ignoreNoRows(err)
	})
	if err != nil {
		return PackageJob{}, err
	}
	now := store.kernel.now().UTC()
	var queueOrder int64
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(queue_order), 0) + 1 FROM app_package_job WHERE phase NOT IN ('completed','failed','canceled')`).Scan(&queueOrder); err != nil {
		return PackageJob{}, fmt.Errorf("allocate App download queue position: %w", err)
	}
	previousJSON := ""
	if input.PreviousRelease != nil {
		raw, err := json.Marshal(input.PreviousRelease)
		if err != nil {
			return PackageJob{}, err
		}
		previousJSON = string(raw)
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO app_package_job(
		job_id, app_id, source_class, kind, target_ref, phase, progress_basis,
		bytes_completed, bytes_total, steps_completed, steps_total, started_unix_nano,
		completed_unix_nano, terminal_result, reason_code, cancelable,
		queue_order, display_name, target_version, target_os, target_arch, previous_release_json, updated_unix_nano
	) VALUES (?, ?, ?, ?, ?, 'queued', ?, 0, ?, 0, ?, ?, NULL, '', '', ?, ?, ?, ?, ?, ?, ?, ?)`,
		jobID, input.AppID, string(input.SourceClass), string(input.Kind), input.TargetRef,
		string(input.ProgressBasis), nullableUint64(input.BytesTotal), nullableUint64(input.StepsTotal), now.UnixNano(), boolInt(input.Cancelable),
		queueOrder, input.DisplayName, input.TargetVersion, input.TargetOS, input.TargetArch, previousJSON, now.UnixNano())
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return PackageJob{}, ErrPackageJobActive
		}
		return PackageJob{}, fmt.Errorf("insert App package job: %w", err)
	}
	if err := store.kernel.commitTransaction(tx); err != nil {
		return PackageJob{}, fmt.Errorf("commit App package job: %w", err)
	}
	job := PackageJob{
		JobID: jobID, AppID: input.AppID, SourceClass: input.SourceClass, Kind: input.Kind,
		TargetRef: input.TargetRef, Phase: PackageJobQueued, ProgressBasis: input.ProgressBasis,
		BytesTotal: cloneUint64(input.BytesTotal), StepsTotal: cloneUint64(input.StepsTotal),
		StartedAt: now, UpdatedAt: now, Cancelable: input.Cancelable,
		QueueOrder: queueOrder, DisplayName: input.DisplayName, TargetVersion: input.TargetVersion,
		TargetOS: input.TargetOS, TargetArch: input.TargetArch, PreviousRelease: input.PreviousRelease,
	}
	store.rememberJob(job)
	return store.GetJob(ctx, jobID)
}

func (store *PackageLifecycleStore) GetJob(ctx context.Context, jobID string) (PackageJob, error) {
	if store == nil || store.kernel == nil || requireExactText("job_id", jobID) != nil {
		return PackageJob{}, ErrInvalidArgument
	}
	job, err := loadPackageJob(ctx, store.kernel.db, jobID)
	if err != nil {
		return PackageJob{}, err
	}
	job = store.projectObserved(job)
	if isQueuedDownload(job) {
		if err := store.kernel.db.QueryRowContext(ctx, `SELECT count(*) FROM app_package_job
			WHERE phase = 'queued' AND source_class = 'verified' AND kind IN ('install','update')
			AND (queue_order < ? OR (queue_order = ? AND job_id <= ?))`, job.QueueOrder, job.QueueOrder, job.JobID).Scan(&job.QueuePosition); err != nil {
			return PackageJob{}, fmt.Errorf("read App download queue position: %w", err)
		}
	}
	return job, nil
}

func (store *PackageLifecycleStore) GetActiveJob(ctx context.Context, appID string, sourceClass SourceClass) (PackageJob, error) {
	if store == nil || store.kernel == nil || requireExactText("app_id", appID) != nil || !packageSourceClass(sourceClass) {
		return PackageJob{}, ErrInvalidArgument
	}
	var jobID string
	err := store.kernel.db.QueryRowContext(ctx, `SELECT job_id FROM app_package_job
		WHERE app_id = ? AND source_class = ? AND phase NOT IN ('completed','failed','canceled')`, appID, string(sourceClass)).Scan(&jobID)
	if errors.Is(err, sql.ErrNoRows) {
		return PackageJob{}, ErrPackageJobNotFound
	}
	if err != nil {
		return PackageJob{}, fmt.Errorf("read active App package job: %w", err)
	}
	return store.GetJob(ctx, jobID)
}

func (store *PackageLifecycleStore) ListJobs(ctx context.Context) ([]PackageJob, error) {
	if store == nil || store.kernel == nil {
		return nil, ErrInvalidArgument
	}
	rows, err := store.kernel.db.QueryContext(ctx, `SELECT job_id, app_id, source_class, kind, target_ref, phase,
		progress_basis, bytes_completed, bytes_total, steps_completed, steps_total, started_unix_nano,
		completed_unix_nano, terminal_result, reason_code, cancelable,
		queue_order, display_name, target_version, target_os, target_arch, previous_release_json, updated_unix_nano FROM app_package_job
		ORDER BY queue_order, job_id`)
	if err != nil {
		return nil, fmt.Errorf("list App package jobs: %w", err)
	}
	defer func() { _ = rows.Close() }()
	jobs := make([]PackageJob, 0)
	for rows.Next() {
		job, scanErr := scanPackageJob(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		jobs = append(jobs, store.projectObserved(job))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate App package jobs: %w", err)
	}
	var position uint32
	for index := range jobs {
		if isQueuedDownload(jobs[index]) {
			position++
			jobs[index].QueuePosition = position
		}
	}
	return jobs, nil
}

func (store *PackageLifecycleStore) Advance(ctx context.Context, jobID string, expected, next PackageJobPhase, progress PackageJobProgress) (PackageJob, error) {
	if store == nil || store.kernel == nil || requireExactText("job_id", jobID) != nil {
		return PackageJob{}, ErrInvalidArgument
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return PackageJob{}, fmt.Errorf("begin App package progress transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	job, err := loadPackageJob(ctx, tx, jobID)
	if err != nil {
		return PackageJob{}, err
	}
	if isTerminalPackagePhase(job.Phase) {
		return PackageJob{}, ErrPackageJobTerminal
	}
	if job.Phase != expected || !allowedPackagePhaseTransition(job.Kind, expected, next) {
		return PackageJob{}, ErrPackageJobPhase
	}
	job = store.projectObserved(job)
	if err := validateProgressAdvance(job, progress); err != nil {
		return PackageJob{}, err
	}
	cancelable := job.Cancelable && next != PackageJobCommitting && next != PackageJobRemovingPackage && next != PackageJobUnregistering
	now := store.kernel.now().UTC()
	result, err := tx.ExecContext(ctx, `UPDATE app_package_job SET phase = ?, bytes_completed = ?, steps_completed = ?, cancelable = ?, reason_code = '', updated_unix_nano = ?
		WHERE job_id = ? AND phase = ? AND completed_unix_nano IS NULL`, string(next), progress.BytesCompleted,
		progress.StepsCompleted, boolInt(cancelable), now.UnixNano(), jobID, string(expected))
	if err != nil {
		return PackageJob{}, fmt.Errorf("advance App package job: %w", err)
	}
	if changed, _ := result.RowsAffected(); changed != 1 {
		return PackageJob{}, ErrPackageJobPhase
	}
	if err := store.kernel.commitTransaction(tx); err != nil {
		return PackageJob{}, fmt.Errorf("commit App package progress: %w", err)
	}
	job.Phase, job.BytesCompleted, job.StepsCompleted, job.Cancelable, job.UpdatedAt = next, progress.BytesCompleted, progress.StepsCompleted, cancelable, now
	job.ReasonCode = ""
	store.rememberJob(job)
	return store.GetJob(ctx, jobID)
}

func (store *PackageLifecycleStore) Fail(ctx context.Context, jobID string, expected PackageJobPhase, reasonCode string) (PackageJob, error) {
	return store.terminalize(ctx, jobID, expected, PackageJobFailed, "failed", reasonCode, false)
}

func (store *PackageLifecycleStore) Cancel(ctx context.Context, jobID string, expected PackageJobPhase, reasonCode string) (PackageJob, error) {
	return store.terminalize(ctx, jobID, expected, PackageJobCanceled, "canceled", reasonCode, true)
}

func (store *PackageLifecycleStore) terminalize(ctx context.Context, jobID string, expected, terminal PackageJobPhase, resultValue, reasonCode string, requireCancelable bool) (PackageJob, error) {
	if store == nil || store.kernel == nil || requireExactText("job_id", jobID) != nil || requireExactText("reason_code", reasonCode) != nil {
		return PackageJob{}, ErrInvalidArgument
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return PackageJob{}, fmt.Errorf("begin terminal App package job transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	job, err := loadPackageJob(ctx, tx, jobID)
	if err != nil {
		return PackageJob{}, err
	}
	if isTerminalPackagePhase(job.Phase) {
		return PackageJob{}, ErrPackageJobTerminal
	}
	if job.Phase != expected {
		return PackageJob{}, ErrPackageJobPhase
	}
	if requireCancelable && !job.Cancelable {
		return PackageJob{}, ErrPackageJobNotCancelable
	}
	now := store.kernel.now().UTC()
	result, err := tx.ExecContext(ctx, `UPDATE app_package_job SET phase = ?, completed_unix_nano = ?,
		terminal_result = ?, reason_code = ?, cancelable = 0, bytes_completed = 0, updated_unix_nano = ? WHERE job_id = ? AND phase = ? AND completed_unix_nano IS NULL`,
		string(terminal), now.UnixNano(), resultValue, reasonCode, now.UnixNano(), jobID, string(expected))
	if err != nil {
		return PackageJob{}, fmt.Errorf("terminalize App package job: %w", err)
	}
	if changed, _ := result.RowsAffected(); changed != 1 {
		return PackageJob{}, ErrPackageJobPhase
	}
	if err := store.kernel.commitTransaction(tx); err != nil {
		return PackageJob{}, fmt.Errorf("commit terminal App package job: %w", err)
	}
	store.forgetJob(jobID)
	return store.GetJob(ctx, jobID)
}

func (store *PackageLifecycleStore) GetCommittedRelease(ctx context.Context, appID string, sourceClass SourceClass) (CommittedRelease, error) {
	if store == nil || store.kernel == nil || requireExactText("app_id", appID) != nil || !packageSourceClass(sourceClass) {
		return CommittedRelease{}, ErrInvalidArgument
	}
	return loadCommittedRelease(ctx, store.kernel.db, appID, sourceClass)
}

func (store *PackageLifecycleStore) ListCommittedReleases(ctx context.Context) ([]CommittedRelease, error) {
	if store == nil || store.kernel == nil {
		return nil, ErrInvalidArgument
	}
	rows, err := store.kernel.db.QueryContext(ctx, `SELECT app_id, source_class, version, release_ref, registration_handle,
		immutable_lineage_id, provenance_attestation_refs_json, provenance_revision, execution_profile_ref,
		host_executable_digest, payload_root_digest, committed_unix_nano FROM committed_app_release
		ORDER BY app_id, source_class`)
	if err != nil {
		return nil, fmt.Errorf("list committed App releases: %w", err)
	}
	defer func() { _ = rows.Close() }()
	releases := make([]CommittedRelease, 0)
	for rows.Next() {
		release, scanErr := scanCommittedRelease(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		releases = append(releases, release)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate committed App releases: %w", err)
	}
	return releases, nil
}

// @nimi-authority: definition.nimi.platform.app-ecosystem.immutable-package-seam
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040b
func (store *PackageLifecycleStore) CommitPackageRelease(ctx context.Context, input CommitPackageReleaseInput) (CommitPackageReleaseResult, error) {
	if store == nil || store.kernel == nil || requireExactText("job_id", input.JobID) != nil || !safeLifecycleSegment(input.Version) {
		return CommitPackageReleaseResult{}, ErrInvalidArgument
	}
	if err := validateInstalledInput(input.Registration); err != nil {
		return CommitPackageReleaseResult{}, err
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return CommitPackageReleaseResult{}, fmt.Errorf("begin committed App release transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	job, err := loadPackageJob(ctx, tx, input.JobID)
	if err != nil {
		return CommitPackageReleaseResult{}, err
	}
	if isTerminalPackagePhase(job.Phase) {
		return CommitPackageReleaseResult{}, ErrPackageJobTerminal
	}
	if job.Phase != PackageJobCommitting || (job.Kind != PackageJobInstall && job.Kind != PackageJobUpdate && job.Kind != PackageJobRepair) {
		return CommitPackageReleaseResult{}, ErrPackageJobPhase
	}
	if job.AppID != input.Registration.AppID || job.SourceClass != input.Registration.SourceClass {
		return CommitPackageReleaseResult{}, ErrStateConflict
	}
	current, currentErr := loadCommittedRelease(ctx, tx, job.AppID, job.SourceClass)
	if job.Kind == PackageJobInstall && currentErr == nil {
		return CommitPackageReleaseResult{}, ErrStateConflict
	}
	if (job.Kind == PackageJobUpdate || job.Kind == PackageJobRepair) && currentErr != nil {
		return CommitPackageReleaseResult{}, currentErr
	}
	if currentErr != nil && !errors.Is(currentErr, ErrCommittedReleaseNotFound) {
		return CommitPackageReleaseResult{}, currentErr
	}
	if currentErr == nil && input.Registration.ExistingRegistrationHandle != current.RegistrationHandle {
		return CommitPackageReleaseResult{}, ErrStateConflict
	}
	if job.Kind == PackageJobUpdate && (job.PreviousRelease == nil || !reflect.DeepEqual(*job.PreviousRelease, current)) {
		return CommitPackageReleaseResult{}, ErrRevisionConflict
	}
	if job.Kind == PackageJobRepair && !sameCommittedReleaseRepair(current, job.TargetRef, input) {
		return CommitPackageReleaseResult{}, ErrStateConflict
	}
	registration, err := store.kernel.registrations.registerTx(ctx, tx, installedRegistrationMutation(input.Registration))
	if err != nil {
		return CommitPackageReleaseResult{}, err
	}
	provenanceJSON, _ := json.Marshal(registration.ProvenanceAttestationRefs)
	now := store.kernel.now().UTC()
	_, err = tx.ExecContext(ctx, `INSERT INTO committed_app_release(
		app_id, source_class, version, release_ref, registration_handle, immutable_lineage_id,
		provenance_attestation_refs_json, provenance_revision, execution_profile_ref,
		host_executable_digest, payload_root_digest, committed_unix_nano
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(app_id, source_class) DO UPDATE SET version = excluded.version, release_ref = excluded.release_ref,
		registration_handle = excluded.registration_handle, immutable_lineage_id = excluded.immutable_lineage_id,
		provenance_attestation_refs_json = excluded.provenance_attestation_refs_json,
		provenance_revision = excluded.provenance_revision, execution_profile_ref = excluded.execution_profile_ref,
		host_executable_digest = excluded.host_executable_digest, payload_root_digest = excluded.payload_root_digest,
		committed_unix_nano = excluded.committed_unix_nano`,
		job.AppID, string(job.SourceClass), input.Version, job.TargetRef, registration.RegistrationHandle,
		registration.ImmutableLineageID, string(provenanceJSON), registration.ProvenanceRevision,
		registration.ExecutionProfileRef, registration.HostExecutableDigest, registration.PayloadRootDigest, now.UnixNano())
	if err != nil {
		return CommitPackageReleaseResult{}, fmt.Errorf("write committed App release: %w", err)
	}
	result, err := tx.ExecContext(ctx, `UPDATE app_package_job SET phase = 'completed', completed_unix_nano = ?,
		terminal_result = 'completed', reason_code = '', cancelable = 0, updated_unix_nano = ?
		WHERE job_id = ? AND phase = 'committing' AND completed_unix_nano IS NULL`, now.UnixNano(), now.UnixNano(), job.JobID)
	if err != nil {
		return CommitPackageReleaseResult{}, fmt.Errorf("complete App package job: %w", err)
	}
	if changed, _ := result.RowsAffected(); changed != 1 {
		return CommitPackageReleaseResult{}, ErrPackageJobPhase
	}
	if err := store.kernel.commitTransaction(tx); err != nil {
		return CommitPackageReleaseResult{}, fmt.Errorf("commit App release and registration: %w", err)
	}
	store.forgetJob(job.JobID)
	completed, err := store.GetJob(ctx, job.JobID)
	if err != nil {
		return CommitPackageReleaseResult{}, err
	}
	release, err := store.GetCommittedRelease(ctx, job.AppID, job.SourceClass)
	if err != nil {
		return CommitPackageReleaseResult{}, err
	}
	return CommitPackageReleaseResult{Job: completed, Release: release, Registration: registration}, nil
}

func sameCommittedReleaseRepair(current CommittedRelease, targetRef string, input CommitPackageReleaseInput) bool {
	return input.Version == current.Version && targetRef == current.ReleaseRef &&
		input.Registration.ImmutableLineageID == current.ImmutableLineageID &&
		equalStrings(input.Registration.ProvenanceAttestationRefs, current.ProvenanceAttestationRefs) &&
		input.Registration.ProvenanceRevision == current.ProvenanceRevision &&
		input.Registration.ExecutionProfileRef == current.ExecutionProfileRef &&
		input.Registration.HostExecutableDigest == current.HostExecutableDigest &&
		input.Registration.PayloadRootDigest == current.PayloadRootDigest
}

// CompleteUninstall permanently unregisters the committed release after the
// caller has stopped the host and removed its package. Durable registration
// and binding history remain tombstoned; this method does not touch payloads.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
func (store *PackageLifecycleStore) CompleteUninstall(ctx context.Context, jobID, registrationHandle string, sourceGeneration, declarationGeneration uint64) (PackageJob, error) {
	if store == nil || store.kernel == nil || requireExactText("job_id", jobID) != nil || registrationHandle == "" || sourceGeneration == 0 || declarationGeneration == 0 {
		return PackageJob{}, ErrInvalidArgument
	}
	store.kernel.mu.Lock()
	defer store.kernel.mu.Unlock()
	tx, err := store.kernel.db.BeginTx(ctx, nil)
	if err != nil {
		return PackageJob{}, fmt.Errorf("begin App uninstall completion transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	job, err := loadPackageJob(ctx, tx, jobID)
	if err != nil {
		return PackageJob{}, err
	}
	if isTerminalPackagePhase(job.Phase) {
		return PackageJob{}, ErrPackageJobTerminal
	}
	if job.Kind != PackageJobUninstall || job.Phase != PackageJobUnregistering {
		return PackageJob{}, ErrPackageJobPhase
	}
	release, err := loadCommittedRelease(ctx, tx, job.AppID, job.SourceClass)
	if err != nil {
		return PackageJob{}, err
	}
	if release.RegistrationHandle != registrationHandle || release.ReleaseRef != job.TargetRef {
		return PackageJob{}, ErrRevisionConflict
	}
	var currentSource, currentDeclaration uint64
	var registrationState string
	if err := tx.QueryRowContext(ctx, `SELECT source_generation, declaration_generation, state FROM canonical_registration WHERE registration_handle = ?`, registrationHandle).Scan(&currentSource, &currentDeclaration, &registrationState); err != nil {
		return PackageJob{}, fmt.Errorf("read uninstall registration generation: %w", err)
	}
	if currentSource != sourceGeneration || currentDeclaration != declarationGeneration || registrationState != string(RegistrationStateActive) {
		return PackageJob{}, ErrRevisionConflict
	}
	if err := store.kernel.registrations.tombstoneTx(ctx, tx, release.RegistrationHandle); err != nil {
		return PackageJob{}, err
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM committed_app_release
		WHERE app_id = ? AND source_class = ? AND registration_handle = ?`, job.AppID, string(job.SourceClass), release.RegistrationHandle)
	if err != nil {
		return PackageJob{}, fmt.Errorf("delete committed App release: %w", err)
	}
	if changed, _ := result.RowsAffected(); changed != 1 {
		return PackageJob{}, ErrStateConflict
	}
	now := store.kernel.now().UTC()
	result, err = tx.ExecContext(ctx, `UPDATE app_package_job SET phase = 'completed', completed_unix_nano = ?,
		terminal_result = 'completed', reason_code = '', cancelable = 0, steps_completed = COALESCE(steps_total, steps_completed)
		WHERE job_id = ? AND phase = 'unregistering' AND completed_unix_nano IS NULL`, now.UnixNano(), job.JobID)
	if err != nil {
		return PackageJob{}, fmt.Errorf("complete App uninstall job: %w", err)
	}
	if changed, _ := result.RowsAffected(); changed != 1 {
		return PackageJob{}, ErrPackageJobPhase
	}
	if err := store.kernel.commitTransaction(tx); err != nil {
		return PackageJob{}, fmt.Errorf("commit App uninstall completion: %w", err)
	}
	store.forgetJob(jobID)
	return store.GetJob(ctx, job.JobID)
}

func validateBeginPackageJob(input BeginPackageJobInput) error {
	if requireExactText("app_id", input.AppID) != nil || requireExactText("target_ref", input.TargetRef) != nil || !packageSourceClass(input.SourceClass) || !packageJobKind(input.Kind) {
		return ErrInvalidArgument
	}
	if input.BytesTotal != nil && *input.BytesTotal > math.MaxInt64 || input.StepsTotal != nil && *input.StepsTotal > math.MaxInt64 {
		return ErrPackageJobProgress
	}
	if input.PreviousRelease != nil && (input.Kind != PackageJobUpdate || input.PreviousRelease.AppID != input.AppID || input.PreviousRelease.SourceClass != input.SourceClass) {
		return ErrInvalidArgument
	}
	switch input.ProgressBasis {
	case PackageProgressBytes:
		if input.StepsTotal != nil {
			return ErrPackageJobProgress
		}
	case PackageProgressSteps:
		if input.BytesTotal != nil {
			return ErrPackageJobProgress
		}
	case PackageProgressIndeterminate:
		if input.BytesTotal != nil || input.StepsTotal != nil {
			return ErrPackageJobProgress
		}
	default:
		return ErrPackageJobProgress
	}
	return nil
}

func cloneUint64(value *uint64) *uint64 {
	if value == nil {
		return nil
	}
	result := *value
	return &result
}

func validateProgressAdvance(job PackageJob, progress PackageJobProgress) error {
	if progress.BytesCompleted > math.MaxInt64 || progress.StepsCompleted > math.MaxInt64 {
		return ErrPackageJobProgress
	}
	switch job.ProgressBasis {
	case PackageProgressBytes:
		if progress.BytesCompleted < job.BytesCompleted || progress.StepsCompleted != 0 || job.BytesTotal != nil && progress.BytesCompleted > *job.BytesTotal {
			return ErrPackageJobProgress
		}
	case PackageProgressSteps:
		if progress.StepsCompleted < job.StepsCompleted || progress.BytesCompleted != 0 || job.StepsTotal != nil && progress.StepsCompleted > *job.StepsTotal {
			return ErrPackageJobProgress
		}
	case PackageProgressIndeterminate:
		if progress.BytesCompleted != 0 || progress.StepsCompleted != 0 {
			return ErrPackageJobProgress
		}
	default:
		return ErrPackageJobProgress
	}
	return nil
}

func allowedPackagePhaseTransition(kind PackageJobKind, from, to PackageJobPhase) bool {
	if isTerminalPackagePhase(to) {
		return false
	}
	allowed := map[PackageJobPhase]map[PackageJobPhase]bool{
		PackageJobQueued:             {PackageJobDownloading: true, PackageJobReadingLocal: true, PackageJobVerifying: true, PackageJobVerifyingInstalled: true, PackageJobRemovingPackage: true},
		PackageJobDownloading:        {PackageJobVerifying: true},
		PackageJobReadingLocal:       {PackageJobVerifying: true},
		PackageJobVerifying:          {PackageJobAcquiringMissing: true, PackageJobStaging: true},
		PackageJobVerifyingInstalled: {PackageJobAcquiringMissing: true, PackageJobStaging: true},
		PackageJobAcquiringMissing:   {PackageJobStaging: true},
		PackageJobStaging:            {PackageJobCommitting: true},
		PackageJobRemovingPackage:    {PackageJobUnregistering: true},
	}
	if kind == PackageJobUninstall {
		return allowed[from][to] && (from == PackageJobQueued || from == PackageJobRemovingPackage)
	}
	return allowed[from][to] && to != PackageJobRemovingPackage && to != PackageJobUnregistering
}

type packageLifecycleRowScanner interface {
	Scan(...any) error
}

func loadPackageJob(ctx context.Context, query registrationQuerier, jobID string) (PackageJob, error) {
	return scanPackageJob(query.QueryRowContext(ctx, `SELECT job_id, app_id, source_class, kind, target_ref, phase,
		progress_basis, bytes_completed, bytes_total, steps_completed, steps_total, started_unix_nano,
		completed_unix_nano, terminal_result, reason_code, cancelable,
		queue_order, display_name, target_version, target_os, target_arch, previous_release_json, updated_unix_nano FROM app_package_job WHERE job_id = ?`, jobID))
}

func scanPackageJob(row packageLifecycleRowScanner) (PackageJob, error) {
	var job PackageJob
	var sourceClass, kind, phase, basis string
	var bytesCompleted, stepsCompleted, started int64
	var bytesTotal, stepsTotal, completed sql.NullInt64
	var cancelable int
	var previousJSON string
	var updated int64
	err := row.Scan(
		&job.JobID, &job.AppID, &sourceClass, &kind, &job.TargetRef, &phase, &basis,
		&bytesCompleted, &bytesTotal, &stepsCompleted, &stepsTotal, &started, &completed,
		&job.TerminalResult, &job.ReasonCode, &cancelable,
		&job.QueueOrder, &job.DisplayName, &job.TargetVersion, &job.TargetOS, &job.TargetArch, &previousJSON, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return PackageJob{}, ErrPackageJobNotFound
	}
	if err != nil {
		return PackageJob{}, fmt.Errorf("read App package job: %w", err)
	}
	job.SourceClass, job.Kind, job.Phase, job.ProgressBasis = SourceClass(sourceClass), PackageJobKind(kind), PackageJobPhase(phase), PackageProgressBasis(basis)
	job.BytesCompleted, job.StepsCompleted = uint64(bytesCompleted), uint64(stepsCompleted)
	job.BytesTotal, job.StepsTotal = uint64FromNull(bytesTotal), uint64FromNull(stepsTotal)
	job.StartedAt = time.Unix(0, started).UTC()
	if completed.Valid {
		value := time.Unix(0, completed.Int64).UTC()
		job.CompletedAt = &value
	}
	job.Cancelable = cancelable == 1
	job.UpdatedAt = time.Unix(0, updated).UTC()
	if previousJSON != "" {
		if err := json.Unmarshal([]byte(previousJSON), &job.PreviousRelease); err != nil {
			return PackageJob{}, fmt.Errorf("read App update baseline: %w", err)
		}
		if job.PreviousRelease != nil {
			job.PreviousVersion = job.PreviousRelease.Version
		}
	}
	return job, nil
}

func loadCommittedRelease(ctx context.Context, query registrationQuerier, appID string, sourceClass SourceClass) (CommittedRelease, error) {
	return scanCommittedRelease(query.QueryRowContext(ctx, `SELECT app_id, source_class, version, release_ref, registration_handle,
		immutable_lineage_id, provenance_attestation_refs_json, provenance_revision, execution_profile_ref,
		host_executable_digest, payload_root_digest, committed_unix_nano
		FROM committed_app_release WHERE app_id = ? AND source_class = ?`, appID, string(sourceClass)))
}

func scanCommittedRelease(row packageLifecycleRowScanner) (CommittedRelease, error) {
	var release CommittedRelease
	var source, provenanceJSON string
	var revision, committed int64
	err := row.Scan(
		&release.AppID, &source, &release.Version, &release.ReleaseRef, &release.RegistrationHandle,
		&release.ImmutableLineageID, &provenanceJSON, &revision, &release.ExecutionProfileRef,
		&release.HostExecutableDigest, &release.PayloadRootDigest, &committed)
	if errors.Is(err, sql.ErrNoRows) {
		return CommittedRelease{}, ErrCommittedReleaseNotFound
	}
	if err != nil {
		return CommittedRelease{}, fmt.Errorf("read committed App release: %w", err)
	}
	if err := json.Unmarshal([]byte(provenanceJSON), &release.ProvenanceAttestationRefs); err != nil {
		return CommittedRelease{}, fmt.Errorf("decode committed App provenance: %w", err)
	}
	release.SourceClass, release.ProvenanceRevision = SourceClass(source), uint64(revision)
	release.CommittedAt = time.Unix(0, committed).UTC()
	return release, nil
}

func packageSourceClass(value SourceClass) bool {
	return value == SourceClassVerified || value == SourceClassUserImported
}
func packageJobKind(value PackageJobKind) bool {
	return value == PackageJobInstall || value == PackageJobUpdate || value == PackageJobRepair || value == PackageJobUninstall
}
func isTerminalPackagePhase(value PackageJobPhase) bool {
	return value == PackageJobCompleted || value == PackageJobFailed || value == PackageJobCanceled
}
func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
func nullableUint64(value *uint64) any {
	if value == nil {
		return nil
	}
	return int64(*value)
}
func uint64FromNull(value sql.NullInt64) *uint64 {
	if !value.Valid {
		return nil
	}
	converted := uint64(value.Int64)
	return &converted
}
func ignoreNoRows(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	return err
}

func safeLifecycleSegment(value string) bool {
	return value != "" && value == strings.TrimSpace(value) && value != "." && value != ".." && !strings.ContainsAny(value, `/\`)
}
