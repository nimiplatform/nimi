package localservice

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
)

var errLocalEnvironmentJobCancelled = errors.New("local environment dependency job cancelled")

const (
	localEnvironmentJobRecoveryAutoRetryTransient = "auto_retry_transient"
	localEnvironmentJobRecoveryManualRetry        = "manual_retry"
	localEnvironmentJobRecoveryRepairRequired     = "repair_required"
	localEnvironmentJobRecoveryNotRetryable       = "not_retryable"
)

var localEnvironmentDependencyJobHeartbeatInterval = 15 * time.Second

type localEnvironmentDependencyJobState struct {
	JobID                  string `json:"jobId"`
	EnvironmentKey         string `json:"environmentKey"`
	DependencyFamily       string `json:"dependencyFamily"`
	DependencyID           string `json:"dependencyId"`
	ConsumerScope          string `json:"consumerScope,omitempty"`
	State                  string `json:"state"`
	SourceKind             string `json:"sourceKind"`
	CanonicalRoot          string `json:"canonicalRoot,omitempty"`
	SelectedSourceRecordID string `json:"selectedSourceRecordId,omitempty"`
	FailureDetail          string `json:"failureDetail,omitempty"`
	Retryable              bool   `json:"retryable,omitempty"`
	ReasonCode             string `json:"reasonCode,omitempty"`
	RecoveryDisposition    string `json:"recoveryDisposition,omitempty"`
	CreatedAt              string `json:"createdAt"`
	UpdatedAt              string `json:"updatedAt"`
	// K-RPC-025 download-progress projection. Meaningful only while the job is
	// actively materializing (downloading / verifying); zeroed for every other
	// state. SpeedBytesPerSec / EtaSeconds are 0 (absent) unless a rate can be
	// computed — never fabricated.
	BytesReceived    int64 `json:"bytesReceived,omitempty"`
	BytesTotal       int64 `json:"bytesTotal,omitempty"`
	Percent          int32 `json:"percent,omitempty"`
	SpeedBytesPerSec int64 `json:"speedBytesPerSec,omitempty"`
	EtaSeconds       int64 `json:"etaSeconds,omitempty"`
}

// localEnvironmentDependencyJobProgress is the bounded per-job download-progress
// snapshot an executor publishes onto its job projection while it streams
// artifact bytes. SpeedBytesPerSec / EtaSeconds are absent (0) unless a rate
// could actually be computed; they are never fabricated.
type localEnvironmentDependencyJobProgress struct {
	BytesReceived    int64
	BytesTotal       int64
	SpeedBytesPerSec int64
	EtaSeconds       int64
}

type localEnvironmentDependencyJobRequest struct {
	EnvironmentKey   string
	DependencyFamily string
	DependencyID     string
	ConsumerScope    string
	SourceKind       string
}

type localEnvironmentDependencyJobResult struct {
	State                   string
	SourceKind              string
	CanonicalRoot           string
	Version                 string
	CompatibilityEvidence   []string
	VerifiedArtifacts       []string
	Hashes                  map[string]string
	SelectedConsumers       []string
	SourceManifestRef       string
	VerificationEvidenceRef string
	ActivationEnvDelta      []string
	AuditReasonCode         string
	FailureDetail           string
}

// localEnvironmentDependencyJobProgressReporter lets an executor publish a
// truthful coarse in-progress state (`downloading`, `verifying`, `installing`)
// onto the job projection while the background goroutine drives it, plus — for
// a job that streams artifact bytes — a bounded download-progress snapshot
// (K-RPC-025 progress projection). Both are no-ops once the job has reached a
// terminal state.
//
// State is the coarse-state sink: it publishes `downloading` / `verifying` /
// `installing` onto the job. Progress is the optional byte-progress sink: an
// executor that downloads artifacts publishes a localEnvironmentDependencyJobProgress
// snapshot here so a Desktop consumer can render a concrete %/rate/ETA. An
// executor that does not stream bytes simply never calls Progress and the
// projection stays zeroed.
type localEnvironmentDependencyJobProgressReporter struct {
	State    func(state string)
	Progress func(localEnvironmentDependencyJobProgress)
}

type localEnvironmentDependencyJobExecutor func(context.Context, localEnvironmentDependencyJobState, localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error)

// startLocalEnvironmentDependencyJob creates (or dedups onto) a dependency job,
// persists it at `queued`, and — when an executor is supplied — drives it on a
// background goroutine detached from the caller RPC context. The non-terminal
// job is returned to the caller immediately; the desktop observes terminal
// transition by polling ListLocalEnvironmentDependencyJobs. The RPC handler
// `ctx` is intentionally unused for execution: it is cancelled the moment Start
// returns, which would abort multi-GB downloads.
func (s *Service) startLocalEnvironmentDependencyJob(_ context.Context, req localEnvironmentDependencyJobRequest, executor localEnvironmentDependencyJobExecutor) (localEnvironmentDependencyJobState, error) {
	normalized := normalizeLocalEnvironmentDependencyJobRequest(req)
	if normalized.EnvironmentKey == "" || normalized.DependencyFamily == "" || normalized.DependencyID == "" {
		return localEnvironmentDependencyJobState{}, errors.New("local environment dependency job requires environment key, family, and dependency id")
	}

	now := nowISO()
	s.mu.Lock()
	if s.localEnvironmentDependencyJobs == nil {
		s.localEnvironmentDependencyJobs = make(map[string]localEnvironmentDependencyJobState)
	}
	if s.localEnvironmentJobCancels == nil {
		s.localEnvironmentJobCancels = make(map[string]context.CancelFunc)
	}
	for _, job := range s.localEnvironmentDependencyJobs {
		if job.EnvironmentKey == normalized.EnvironmentKey &&
			job.DependencyFamily == normalized.DependencyFamily &&
			job.DependencyID == normalized.DependencyID &&
			strings.TrimSpace(job.ConsumerScope) == strings.TrimSpace(normalized.ConsumerScope) &&
			!localEnvironmentDependencyJobTerminal(job.State) {
			s.mu.Unlock()
			return job, nil
		}
	}
	job := localEnvironmentDependencyJobState{
		JobID:            "localenv_job_" + strings.ToLower(ulid.Make().String()),
		EnvironmentKey:   normalized.EnvironmentKey,
		DependencyFamily: normalized.DependencyFamily,
		DependencyID:     normalized.DependencyID,
		ConsumerScope:    normalized.ConsumerScope,
		State:            localEnvironmentStateQueued,
		SourceKind:       normalized.SourceKind,
		Retryable:        true,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	s.localEnvironmentDependencyJobs[job.JobID] = job
	s.persistStateLocked()

	if executor == nil {
		s.mu.Unlock()
		return job, nil
	}

	// Detach execution from the RPC context. Use the service-lifetime context
	// as the parent so a daemon shutdown still aborts in-flight jobs, and
	// register a per-job cancel func so CancelLocalEnvironmentDependencyJob can
	// abort a running job.
	parent := s.jobLifetimeCtx
	if parent == nil {
		parent = context.Background()
	}
	jobCtx, jobCancel := context.WithCancel(parent)
	s.localEnvironmentJobCancels[job.JobID] = jobCancel
	s.localEnvironmentJobWG.Add(1)
	s.mu.Unlock()

	go func() {
		defer s.localEnvironmentJobWG.Done()
		defer func() {
			s.mu.Lock()
			delete(s.localEnvironmentJobCancels, job.JobID)
			s.mu.Unlock()
			jobCancel()
		}()
		if _, err := s.runLocalEnvironmentDependencyJob(jobCtx, job.JobID, executor); err != nil {
			s.logger.Debug("local environment dependency job ended with error",
				"job_id", job.JobID,
				"dependency_family", job.DependencyFamily,
				"error", err)
		}
	}()

	return job, nil
}

func (s *Service) runLocalEnvironmentDependencyJob(ctx context.Context, jobID string, executor localEnvironmentDependencyJobExecutor) (localEnvironmentDependencyJobState, error) {
	job, ok := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateInstalling, "", true)
	if !ok {
		return localEnvironmentDependencyJobState{}, errors.New("local environment dependency job not found")
	}
	if executor == nil {
		return job, nil
	}

	reporter := localEnvironmentDependencyJobProgressReporter{
		State: func(state string) {
			coarse := strings.TrimSpace(state)
			switch coarse {
			case localEnvironmentStateDownloading, localEnvironmentStateVerifying, localEnvironmentStateInstalling:
				s.transitionLocalEnvironmentDependencyJob(jobID, coarse, "", true)
			}
		},
		Progress: func(progress localEnvironmentDependencyJobProgress) {
			s.updateLocalEnvironmentDependencyJobProgress(jobID, progress)
		},
	}

	heartbeatCtx, stopHeartbeat := context.WithCancel(ctx)
	defer stopHeartbeat()
	go s.runLocalEnvironmentDependencyJobHeartbeat(heartbeatCtx, jobID)

	result, err := executor(ctx, job, reporter)
	if err != nil {
		if errors.Is(err, errLocalEnvironmentJobCancelled) || errors.Is(err, context.Canceled) {
			cancelled, _ := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateCancelled, err.Error(), true)
			return cancelled, err
		}
		failed, _ := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateFailed, err.Error(), true)
		return failed, err
	}

	resultState := strings.TrimSpace(result.State)
	switch resultState {
	case localEnvironmentStateUnsupported:
		unsupported, _ := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateUnsupported, localEnvironmentDependencyJobResultDetail(result), false)
		return unsupported, nil
	case localEnvironmentStateRepairRequired:
		repairRequired, _ := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateRepairRequired, localEnvironmentDependencyJobResultDetail(result), true)
		return repairRequired, nil
	case localEnvironmentStateFailed:
		failed, _ := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateFailed, localEnvironmentDependencyJobResultDetail(result), true)
		return failed, nil
	case localEnvironmentStateReadySystem, localEnvironmentStateReadyManaged:
	default:
		failed, _ := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateFailed, "LOCAL_ENVIRONMENT_DEPENDENCY_VERIFICATION_INCOMPLETE", true)
		return failed, nil
	}

	sourceKind := strings.TrimSpace(result.SourceKind)
	if sourceKind == "" {
		if resultState == localEnvironmentStateReadySystem {
			sourceKind = localEnvironmentSourceSystem
		} else {
			sourceKind = job.SourceKind
		}
	}
	if sourceKind == "" {
		sourceKind = localEnvironmentSourceManaged
	}
	result.SourceKind = sourceKind
	result.SourceManifestRef = strings.TrimSpace(result.SourceManifestRef)
	if result.SourceManifestRef == "" {
		result.SourceManifestRef = localEnvironmentSourceManifestRef(job, result)
	}
	result.VerificationEvidenceRef = strings.TrimSpace(result.VerificationEvidenceRef)
	if result.VerificationEvidenceRef == "" {
		result.VerificationEvidenceRef = localEnvironmentVerificationEvidenceRef(job, result)
	}
	if err := validateLocalEnvironmentDependencyJobReadyEvidence(job, result); err != nil {
		failed, _ := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateFailed, err.Error(), true)
		return failed, nil
	}
	if !stringSliceContains(result.SelectedConsumers, job.ConsumerScope) {
		failed, _ := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateFailed, "LOCAL_ENVIRONMENT_SELECTED_SOURCE_CONSUMER_SCOPE_MISMATCH", true)
		return failed, nil
	}
	// Promote the job to its terminal ready state, write the selected-source
	// record, and write the job's selected-source promotion fields in a single
	// locked critical section. With async execution a desktop poller observes
	// the job concurrently and a concurrent Cancel can land at any instant:
	// performing the record upsert in its own lock then the promotion in a
	// separate lock leaves a window where a Cancel between the two persists a
	// live selected-source record alongside a cancelled job — a fail-close
	// violation, because plan resolution would still read that record as a
	// satisfied prerequisite. Folding both into one section behind the
	// non-terminal guard keeps them atomic with respect to cancellation: when
	// the job is already terminal the record is never written.
	pendingRecord := localEnvironmentSelectedSourceRecordState{
		DependencyFamily:        job.DependencyFamily,
		DependencyID:            job.DependencyID,
		EnvironmentKey:          job.EnvironmentKey,
		SourceKind:              sourceKind,
		CanonicalRoot:           strings.TrimSpace(result.CanonicalRoot),
		Version:                 strings.TrimSpace(result.Version),
		CompatibilityEvidence:   normalizeStringSlice(result.CompatibilityEvidence),
		VerifiedArtifacts:       normalizeStringSlice(result.VerifiedArtifacts),
		Hashes:                  cloneStringMap(result.Hashes),
		SelectedConsumers:       normalizeStringSlice(result.SelectedConsumers),
		SourceManifestRef:       strings.TrimSpace(result.SourceManifestRef),
		VerificationEvidenceRef: strings.TrimSpace(result.VerificationEvidenceRef),
		ActivationEnvDelta:      normalizeStringSlice(result.ActivationEnvDelta),
		AuditReasonCode:         strings.TrimSpace(result.AuditReasonCode),
	}
	promoted, ok := s.promoteLocalEnvironmentDependencyJobReady(jobID, resultState, sourceKind, strings.TrimSpace(result.CanonicalRoot), pendingRecord)
	if !ok {
		return localEnvironmentDependencyJobState{}, errors.New("local environment dependency job not found")
	}
	return promoted, nil
}

func localEnvironmentDependencyJobResultDetail(result localEnvironmentDependencyJobResult) string {
	if detail := strings.TrimSpace(result.FailureDetail); detail != "" {
		return detail
	}
	return strings.TrimSpace(result.AuditReasonCode)
}

func (s *Service) runLocalEnvironmentDependencyJobHeartbeat(ctx context.Context, jobID string) {
	interval := localEnvironmentDependencyJobHeartbeatInterval
	if interval <= 0 {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !s.touchLocalEnvironmentDependencyJobHeartbeat(jobID) {
				return
			}
		}
	}
}

func (s *Service) touchLocalEnvironmentDependencyJobHeartbeat(jobID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.localEnvironmentDependencyJobs[strings.TrimSpace(jobID)]
	if !ok || localEnvironmentDependencyJobTerminal(job.State) {
		return false
	}
	// Downloading / verifying jobs must prove liveness with byte-progress
	// updates. Heartbeats are only for non-byte phases such as installing,
	// where a subprocess can legitimately run for minutes without a percent.
	if localEnvironmentDependencyJobTransferring(job.State) {
		return true
	}
	job.UpdatedAt = nowISO()
	s.localEnvironmentDependencyJobs[job.JobID] = job
	return true
}

// promoteLocalEnvironmentDependencyJobReady atomically writes the
// selected-source record and transitions a job to its terminal ready state
// together with its selected-source promotion fields, all under one s.mu
// section. A concurrent poller therefore never observes a ready job with an
// incomplete projection, and — critically — a Cancel that lands before this
// section acquires the lock leaves the job already terminal so the record is
// never written: a cancelled job can never coexist with a live selected-source
// record. A job already at a terminal state (e.g. cancelled mid-flight) is left
// untouched and pendingRecord is discarded.

func (s *Service) cancelLocalEnvironmentDependencyJob(jobID string) (localEnvironmentDependencyJobState, bool) {
	// Abort the background executor goroutine first so its in-flight download /
	// verification ctx is cancelled, then mark the job cancelled. The goroutine
	// observes the terminal state via transitionLocalEnvironmentDependencyJob's
	// terminal short-circuit and does not overwrite it.
	s.mu.Lock()
	cancel := s.localEnvironmentJobCancels[strings.TrimSpace(jobID)]
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateCancelled, "", true)
}

func (s *Service) markLocalEnvironmentDependencyRepairRequired(environmentKey string, identityAndReason ...string) (localEnvironmentSelectedSourceRecordState, bool) {
	dependencyFamily := ""
	dependencyID := ""
	consumerScope := ""
	reason := ""
	switch len(identityAndReason) {
	case 1:
		reason = identityAndReason[0]
	default:
		if len(identityAndReason) > 0 {
			dependencyFamily = identityAndReason[0]
		}
		if len(identityAndReason) > 1 {
			dependencyID = identityAndReason[1]
		}
		if len(identityAndReason) > 2 {
			consumerScope = identityAndReason[2]
		}
		if len(identityAndReason) > 3 {
			reason = identityAndReason[3]
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var recordKey string
	var record localEnvironmentSelectedSourceRecordState
	for key, candidate := range s.localEnvironmentSelectedSources {
		if strings.TrimSpace(candidate.EnvironmentKey) != strings.TrimSpace(environmentKey) {
			continue
		}
		if strings.TrimSpace(dependencyFamily) != "" && strings.TrimSpace(candidate.DependencyFamily) != strings.TrimSpace(dependencyFamily) {
			continue
		}
		if strings.TrimSpace(dependencyID) != "" && strings.TrimSpace(candidate.DependencyID) != strings.TrimSpace(dependencyID) {
			continue
		}
		if strings.TrimSpace(consumerScope) != "" && !stringSliceContains(candidate.SelectedConsumers, strings.TrimSpace(consumerScope)) {
			continue
		}
		if recordKey != "" {
			return localEnvironmentSelectedSourceRecordState{}, false
		}
		recordKey = key
		record = candidate
	}
	if recordKey == "" {
		return localEnvironmentSelectedSourceRecordState{}, false
	}
	record.RepairState = localEnvironmentRepairRequired
	record.AuditReasonCode = strings.TrimSpace(reason)
	record.LastVerifiedAt = time.Now().UTC().Format(time.RFC3339Nano)
	s.localEnvironmentSelectedSources[recordKey] = record
	s.persistStateLocked()
	return record, true
}

func (s *Service) transitionLocalEnvironmentDependencyJob(jobID string, state string, detail string, retryable bool) (localEnvironmentDependencyJobState, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.localEnvironmentDependencyJobs[strings.TrimSpace(jobID)]
	if !ok {
		return localEnvironmentDependencyJobState{}, false
	}
	if localEnvironmentDependencyJobTerminal(job.State) {
		return job, true
	}
	next := strings.TrimSpace(state)
	job.State = next
	job.FailureDetail = strings.TrimSpace(detail)
	job.Retryable = retryable
	job.ReasonCode, job.RecoveryDisposition = localEnvironmentDependencyJobRecoveryProjection(job, next, detail, retryable)
	// The K-RPC-025 download-progress projection is meaningful only while the
	// job is actively transferring bytes. Any transition out of a transferring
	// state (to installing, a terminal state, or repair_required) clears the
	// progress fields so a stale %/rate/ETA is never carried onto a state that
	// is not downloading — fail-closed, not back-filled.
	if !localEnvironmentDependencyJobTransferring(next) {
		job.BytesReceived = 0
		job.BytesTotal = 0
		job.Percent = 0
		job.SpeedBytesPerSec = 0
		job.EtaSeconds = 0
	}
	job.UpdatedAt = nowISO()
	s.localEnvironmentDependencyJobs[job.JobID] = job
	s.persistStateLocked()
	return job, true
}

func localEnvironmentDependencyJobRecoveryProjection(job localEnvironmentDependencyJobState, state string, detail string, retryable bool) (string, string) {
	next := strings.TrimSpace(state)
	normalizedDetail := strings.TrimSpace(detail)
	reason := localEnvironmentDependencyJobReasonCode(next, normalizedDetail)
	switch next {
	case localEnvironmentStateFailed:
		if retryable && localEnvironmentDependencyJobAutoRecoverable(job.DependencyFamily, normalizedDetail, reason) {
			return reason, localEnvironmentJobRecoveryAutoRetryTransient
		}
		if retryable {
			return reason, localEnvironmentJobRecoveryManualRetry
		}
		return reason, localEnvironmentJobRecoveryNotRetryable
	case localEnvironmentStateCancelled:
		if retryable {
			return reason, localEnvironmentJobRecoveryManualRetry
		}
		return reason, localEnvironmentJobRecoveryNotRetryable
	case localEnvironmentStateRepairRequired:
		return reason, localEnvironmentJobRecoveryRepairRequired
	case localEnvironmentStateUnsupported:
		return reason, localEnvironmentJobRecoveryNotRetryable
	default:
		return "", ""
	}
}

func localEnvironmentDependencyJobReasonCode(state string, detail string) string {
	trimmed := strings.TrimSpace(detail)
	if strings.HasPrefix(trimmed, "LOCAL_ENVIRONMENT_") && !strings.ContainsAny(trimmed, " \t\n\r:=") {
		return trimmed
	}
	switch strings.TrimSpace(state) {
	case localEnvironmentStateCancelled:
		return "LOCAL_ENVIRONMENT_DEPENDENCY_JOB_CANCELLED"
	case localEnvironmentStateRepairRequired:
		if trimmed != "" {
			return trimmed
		}
		return "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED"
	case localEnvironmentStateUnsupported:
		if trimmed != "" {
			return trimmed
		}
		return "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED"
	case localEnvironmentStateFailed:
		if localEnvironmentDependencyJobInterruptedDetail(trimmed) {
			return "LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED"
		}
		return "LOCAL_ENVIRONMENT_DEPENDENCY_JOB_FAILED"
	default:
		return ""
	}
}

func localEnvironmentDependencyJobAutoRecoverable(family string, detail string, reasonCode string) bool {
	if strings.TrimSpace(reasonCode) == "LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED" {
		return true
	}
	normalizedFamily := strings.ToLower(strings.TrimSpace(family))
	normalizedDetail := strings.ToLower(strings.TrimSpace(detail))
	if normalizedDetail == "" {
		return false
	}
	interrupted := localEnvironmentDependencyJobInterruptedDetail(normalizedDetail)
	switch normalizedFamily {
	case localEnvironmentFamilyModelAsset, localEnvironmentFamilyModelCompanion:
		return interrupted
	case localEnvironmentFamilyPythonRuntime,
		localEnvironmentFamilyPythonVenv,
		localEnvironmentFamilyPythonPackageSet,
		localEnvironmentFamilyPythonTorchWheel:
		return interrupted ||
			strings.Contains(normalizedDetail, "no virtual environment or system python installation found") ||
			strings.Contains(normalizedDetail, "system cannot find the path specified") ||
			strings.Contains(normalizedDetail, "cannot find the path specified") ||
			strings.Contains(normalizedDetail, "no such file or directory") ||
			strings.Contains(normalizedDetail, "waiting for lock on uv cache")
	default:
		return false
	}
}

func localEnvironmentDependencyJobInterruptedDetail(detail string) bool {
	normalized := strings.ToLower(strings.TrimSpace(detail))
	return normalized == "local_environment_dependency_job_interrupted" ||
		strings.Contains(normalized, "local_environment_dependency_job_interrupted") ||
		strings.Contains(normalized, "unexpected eof") ||
		strings.Contains(normalized, "client.timeout") ||
		strings.Contains(normalized, "context deadline exceeded") ||
		strings.Contains(normalized, "connection reset") ||
		strings.Contains(normalized, "connection refused") ||
		strings.Contains(normalized, "broken pipe") ||
		strings.Contains(normalized, "tls handshake timeout") ||
		strings.Contains(normalized, "timeout while reading body")
}

// localEnvironmentDependencyJobTransferring reports whether a job state is one
// where the K-RPC-025 download-progress projection is meaningful — the job is
// actively streaming artifact bytes. Only `downloading` and `verifying` qualify
// (verifying can still re-read streamed artifacts); `queued` / `installing` and
// every terminal state carry no live byte progress.
func localEnvironmentDependencyJobTransferring(state string) bool {
	switch strings.TrimSpace(state) {
	case localEnvironmentStateDownloading, localEnvironmentStateVerifying:
		return true
	default:
		return false
	}
}

// updateLocalEnvironmentDependencyJobProgress publishes a bounded
// download-progress snapshot onto a job. It is a no-op once the job is terminal
// or is no longer in a transferring state, so a late progress callback from an
// aborted download can never resurrect a stale percentage. `percent` is derived
// only when `bytesTotal > 0`; speed/eta are persisted verbatim from the snapshot
// (the caller already projects them absent when a rate cannot be computed).
func (s *Service) updateLocalEnvironmentDependencyJobProgress(jobID string, progress localEnvironmentDependencyJobProgress) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.localEnvironmentDependencyJobs[strings.TrimSpace(jobID)]
	if !ok {
		return
	}
	if localEnvironmentDependencyJobTerminal(job.State) || !localEnvironmentDependencyJobTransferring(job.State) {
		return
	}
	bytesReceived := progress.BytesReceived
	if bytesReceived < 0 {
		bytesReceived = 0
	}
	bytesTotal := progress.BytesTotal
	if bytesTotal < 0 {
		bytesTotal = 0
	}
	job.BytesReceived = bytesReceived
	job.BytesTotal = bytesTotal
	job.Percent = localEnvironmentDependencyJobPercent(bytesReceived, bytesTotal)
	speed := progress.SpeedBytesPerSec
	if speed < 0 {
		speed = 0
	}
	job.SpeedBytesPerSec = speed
	eta := progress.EtaSeconds
	if eta < 0 {
		eta = 0
	}
	job.EtaSeconds = eta
	job.UpdatedAt = nowISO()
	s.localEnvironmentDependencyJobs[job.JobID] = job
	// Progress ticks are high-frequency; they are not persisted to the state
	// store on every tick (a terminal transition persists). Holding the live
	// projection in memory keeps the ListLocalEnvironmentDependencyJobs poll
	// truthful without a write amplification on every 128 KiB chunk.
}

// localEnvironmentDependencyJobPercent projects an integer 0..100 completion
// only when the total is known; an unknown total projects 0 so the consumer
// renders an indeterminate state rather than a fabricated percentage.
func localEnvironmentDependencyJobPercent(bytesReceived int64, bytesTotal int64) int32 {
	if bytesTotal <= 0 || bytesReceived <= 0 {
		return 0
	}
	if bytesReceived >= bytesTotal {
		return 100
	}
	return int32((bytesReceived * 100) / bytesTotal)
}

// defaultLocalEnvironmentPrerequisiteWaitTimeout bounds how long a dependent
// python / companion executor waits for an upstream family's selected-source
// record to appear before it fails closed. The desktop fires the python family
// chain (uv -> python.runtime -> python.venv -> python.package-set) as
// concurrent unordered Start calls; ordering is runtime authority, so a
// dependent job that races ahead of its prerequisite waits rather than failing
// with a hard PREREQUISITE_MISSING. Each prerequisite job is itself bounded by
// its own download/verify timeout. Tests override the per-service value via
// SetLocalEnvironmentPrerequisiteWaitTimeout.
