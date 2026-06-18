package localservice

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
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
func (s *Service) promoteLocalEnvironmentDependencyJobReady(jobID string, readyState string, sourceKind string, canonicalRoot string, pendingRecord localEnvironmentSelectedSourceRecordState) (localEnvironmentDependencyJobState, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.localEnvironmentDependencyJobs[strings.TrimSpace(jobID)]
	if !ok {
		return localEnvironmentDependencyJobState{}, false
	}
	if localEnvironmentDependencyJobTerminal(job.State) {
		// Job was cancelled/failed between executor success and this section.
		// Skip the record upsert entirely so no satisfied prerequisite is left
		// behind for a terminal job.
		return job, true
	}
	record := s.upsertLocalEnvironmentSelectedSourceRecordLocked(pendingRecord)
	job.State = strings.TrimSpace(readyState)
	job.FailureDetail = ""
	job.Retryable = false
	job.ReasonCode = ""
	job.RecoveryDisposition = ""
	job.SelectedSourceRecordID = strings.TrimSpace(record.RecordID)
	job.SourceKind = strings.TrimSpace(sourceKind)
	job.CanonicalRoot = strings.TrimSpace(canonicalRoot)
	// The ready terminal state is not transferring — clear any byte-progress
	// the verifying phase left so a ready job never carries a stale %/rate/ETA.
	job.BytesReceived = 0
	job.BytesTotal = 0
	job.Percent = 0
	job.SpeedBytesPerSec = 0
	job.EtaSeconds = 0
	job.UpdatedAt = nowISO()
	s.localEnvironmentDependencyJobs[job.JobID] = job
	s.persistStateLocked()
	return job, true
}

func validateLocalEnvironmentDependencyJobReadyEvidence(job localEnvironmentDependencyJobState, result localEnvironmentDependencyJobResult) error {
	record := localEnvironmentSelectedSourceRecordState{
		RecordID:                "validation",
		DependencyFamily:        job.DependencyFamily,
		DependencyID:            job.DependencyID,
		EnvironmentKey:          job.EnvironmentKey,
		SourceKind:              result.SourceKind,
		CanonicalRoot:           result.CanonicalRoot,
		Version:                 result.Version,
		CompatibilityEvidence:   normalizeStringSlice(result.CompatibilityEvidence),
		VerifiedArtifacts:       normalizeStringSlice(result.VerifiedArtifacts),
		Hashes:                  cloneStringMap(result.Hashes),
		SelectedConsumers:       normalizeStringSlice(result.SelectedConsumers),
		SourceManifestRef:       result.SourceManifestRef,
		VerificationEvidenceRef: result.VerificationEvidenceRef,
		SelectedAt:              "validation",
		LastVerifiedAt:          "validation",
		RepairState:             localEnvironmentRepairNone,
		AuditReasonCode:         result.AuditReasonCode,
	}
	return validateLocalEnvironmentSelectedSourceRecord(record)
}

func validateLocalEnvironmentSelectedSourceRecord(record localEnvironmentSelectedSourceRecordState) error {
	if strings.TrimSpace(record.RecordID) == "" ||
		strings.TrimSpace(record.DependencyFamily) == "" ||
		strings.TrimSpace(record.DependencyID) == "" ||
		strings.TrimSpace(record.EnvironmentKey) == "" {
		return errors.New("LOCAL_ENVIRONMENT_SELECTED_SOURCE_IDENTITY_INCOMPLETE")
	}
	switch strings.TrimSpace(record.SourceKind) {
	case localEnvironmentSourceSystem, localEnvironmentSourceManaged, localEnvironmentSourceBundled, localEnvironmentSourceImported:
	default:
		return errors.New("LOCAL_ENVIRONMENT_SELECTED_SOURCE_KIND_INVALID")
	}
	if strings.TrimSpace(record.CanonicalRoot) == "" {
		return errors.New("LOCAL_ENVIRONMENT_SELECTED_SOURCE_CANONICAL_ROOT_MISSING")
	}
	if strings.TrimSpace(record.SourceManifestRef) == "" {
		return errors.New("LOCAL_ENVIRONMENT_SELECTED_SOURCE_MANIFEST_MISSING")
	}
	if strings.TrimSpace(record.VerificationEvidenceRef) == "" {
		return errors.New("LOCAL_ENVIRONMENT_SELECTED_SOURCE_VERIFICATION_EVIDENCE_MISSING")
	}
	if len(normalizeStringSlice(record.VerifiedArtifacts)) == 0 {
		return errors.New("LOCAL_ENVIRONMENT_SELECTED_SOURCE_ARTIFACT_EVIDENCE_MISSING")
	}
	if len(normalizeStringSlice(record.CompatibilityEvidence)) == 0 {
		return errors.New("LOCAL_ENVIRONMENT_SELECTED_SOURCE_COMPATIBILITY_EVIDENCE_MISSING")
	}
	if strings.TrimSpace(record.Version) == "" && len(record.Hashes) == 0 {
		return errors.New("LOCAL_ENVIRONMENT_SELECTED_SOURCE_VERSION_OR_HASH_MISSING")
	}
	if len(normalizeStringSlice(record.SelectedConsumers)) == 0 {
		return errors.New("LOCAL_ENVIRONMENT_SELECTED_SOURCE_CONSUMER_SCOPE_MISSING")
	}
	if strings.TrimSpace(record.LastVerifiedAt) == "" {
		return errors.New("LOCAL_ENVIRONMENT_SELECTED_SOURCE_LAST_VERIFIED_AT_MISSING")
	}
	if strings.TrimSpace(record.AuditReasonCode) == "" {
		return errors.New("LOCAL_ENVIRONMENT_SELECTED_SOURCE_AUDIT_REASON_MISSING")
	}
	switch strings.TrimSpace(record.RepairState) {
	case "", localEnvironmentRepairNone:
		return nil
	default:
		return errors.New("LOCAL_ENVIRONMENT_SELECTED_SOURCE_REPAIR_REQUIRED")
	}
}

func validateLocalEnvironmentSelectedSourceLocalArtifacts(record localEnvironmentSelectedSourceRecordState) error {
	checks := localEnvironmentSelectedSourceLocalArtifactChecks(record)
	for _, check := range checks {
		info, err := os.Stat(check.Path)
		if err != nil {
			if os.IsNotExist(err) {
				return fmt.Errorf("LOCAL_ENVIRONMENT_SELECTED_SOURCE_ARTIFACT_MISSING path=%s", check.Path)
			}
			return fmt.Errorf("LOCAL_ENVIRONMENT_SELECTED_SOURCE_ARTIFACT_UNREADABLE path=%s: %w", check.Path, err)
		}
		if check.RequireDirectory && !info.IsDir() {
			return fmt.Errorf("LOCAL_ENVIRONMENT_SELECTED_SOURCE_ARTIFACT_NOT_DIRECTORY path=%s", check.Path)
		}
	}
	return nil
}

type localEnvironmentSelectedSourceLocalArtifactCheck struct {
	Path             string
	RequireDirectory bool
}

func localEnvironmentSelectedSourceLocalArtifactChecks(record localEnvironmentSelectedSourceRecordState) []localEnvironmentSelectedSourceLocalArtifactCheck {
	root := strings.TrimSpace(record.CanonicalRoot)
	if root == "" {
		return nil
	}
	checks := make([]localEnvironmentSelectedSourceLocalArtifactCheck, 0, 1+len(record.VerifiedArtifacts))
	rootIsLocal := filepath.IsAbs(root)
	rootIsDirectory := localEnvironmentSelectedSourceCanonicalRootIsDirectory(record.DependencyFamily)
	if rootIsLocal {
		checks = append(checks, localEnvironmentSelectedSourceLocalArtifactCheck{
			Path:             root,
			RequireDirectory: rootIsDirectory,
		})
	}
	for _, artifact := range normalizeStringSlice(record.VerifiedArtifacts) {
		path := localEnvironmentSelectedSourceArtifactLocalPath(root, rootIsDirectory, artifact)
		if path == "" {
			continue
		}
		if stringSliceContainsLocalArtifactCheck(checks, path) {
			continue
		}
		checks = append(checks, localEnvironmentSelectedSourceLocalArtifactCheck{Path: path})
	}
	return checks
}

func localEnvironmentSelectedSourceArtifactLocalPath(root string, rootIsDirectory bool, artifact string) string {
	trimmed := strings.TrimSpace(artifact)
	if trimmed == "" || strings.Contains(trimmed, "=") {
		return ""
	}
	if filepath.IsAbs(trimmed) {
		return trimmed
	}
	if filepath.IsAbs(root) && rootIsDirectory {
		return filepath.Join(root, filepath.FromSlash(trimmed))
	}
	return ""
}

func localEnvironmentSelectedSourceCanonicalRootIsDirectory(family string) bool {
	switch strings.TrimSpace(family) {
	case localEnvironmentFamilyCUDA,
		localEnvironmentFamilyNativeSDCPP,
		localEnvironmentFamilyPythonVenv,
		localEnvironmentFamilyPythonPackageSet,
		localEnvironmentFamilyPythonTorchWheel:
		return true
	default:
		return false
	}
}

func stringSliceContainsLocalArtifactCheck(checks []localEnvironmentSelectedSourceLocalArtifactCheck, path string) bool {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return true
	}
	for _, check := range checks {
		if strings.EqualFold(strings.TrimSpace(check.Path), trimmed) {
			return true
		}
	}
	return false
}

func localEnvironmentSourceManifestRef(job localEnvironmentDependencyJobState, result localEnvironmentDependencyJobResult) string {
	family := strings.TrimSpace(job.DependencyFamily)
	base := localEnvironmentSourceManifestFamilyRef(family)
	if base == "" {
		base = "local-environment-source"
	}
	return base + "#" + shortHash(strings.Join([]string{
		family,
		strings.TrimSpace(job.DependencyID),
		strings.TrimSpace(job.EnvironmentKey),
		strings.TrimSpace(result.SourceKind),
		strings.TrimSpace(result.CanonicalRoot),
		strings.TrimSpace(result.Version),
		strings.Join(normalizeStringSlice(result.VerifiedArtifacts), "|"),
	}, "|"))
}

func localEnvironmentVerificationEvidenceRef(job localEnvironmentDependencyJobState, result localEnvironmentDependencyJobResult) string {
	family := strings.TrimSpace(job.DependencyFamily)
	base := localEnvironmentVerificationEvidenceFamilyRef(family)
	if base == "" {
		base = "local-environment-verification-evidence"
	}
	return base + "#" + shortHash(strings.Join([]string{
		family,
		strings.TrimSpace(job.DependencyID),
		strings.TrimSpace(job.EnvironmentKey),
		strings.Join(normalizeStringSlice(result.CompatibilityEvidence), "|"),
		strings.Join(normalizeStringSlice(result.VerifiedArtifacts), "|"),
		strings.TrimSpace(result.AuditReasonCode),
	}, "|"))
}

func localEnvironmentSourceManifestFamilyRef(family string) string {
	switch strings.TrimSpace(family) {
	case localEnvironmentFamilyCUDA:
		return "managed-cuda-runtime-source"
	case localEnvironmentFamilyNativeLlama:
		return "managed-native-engine-package-source"
	case localEnvironmentFamilyNativeSDCPP:
		return "managed-image-backend-package-source"
	case localEnvironmentFamilyPythonUV:
		return "managed-uv-tool-source"
	case localEnvironmentFamilyPythonRuntime:
		return "managed-python-runtime-source"
	case localEnvironmentFamilyPythonVenv:
		return "managed-python-venv-source"
	case localEnvironmentFamilyPythonPackageSet:
		return "managed-python-package-lock-source"
	case localEnvironmentFamilyPythonTorchWheel:
		return "managed-torch-wheel-source"
	case localEnvironmentFamilyModelAsset:
		return "managed-or-imported-model-asset-source"
	case localEnvironmentFamilyModelCompanion:
		return "managed-or-imported-companion-asset-source"
	default:
		return ""
	}
}

func localEnvironmentVerificationEvidenceFamilyRef(family string) string {
	switch strings.TrimSpace(family) {
	case localEnvironmentFamilyCUDA:
		return "accelerator-cuda-runtime-evidence"
	case localEnvironmentFamilyNativeLlama, localEnvironmentFamilyNativeSDCPP:
		return "native-engine-package-evidence"
	case localEnvironmentFamilyPythonUV:
		return "python-tool-uv-evidence"
	case localEnvironmentFamilyPythonRuntime:
		return "python-runtime-evidence"
	case localEnvironmentFamilyPythonVenv:
		return "python-venv-evidence"
	case localEnvironmentFamilyPythonPackageSet:
		return "python-package-set-evidence"
	case localEnvironmentFamilyPythonTorchWheel:
		return "python-torch-wheel-evidence"
	case localEnvironmentFamilyModelAsset:
		return "model-asset-evidence"
	case localEnvironmentFamilyModelCompanion:
		return "model-companion-asset-evidence"
	default:
		return ""
	}
}

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
const defaultLocalEnvironmentPrerequisiteWaitTimeout = 45 * time.Minute

const localEnvironmentPrerequisiteWaitPoll = 25 * time.Millisecond

// SetLocalEnvironmentPrerequisiteWaitTimeout overrides the bounded prerequisite
// wait. It exists so tests can assert the wait-then-fail-closed behaviour for a
// genuinely absent prerequisite without a multi-minute pause.
func (s *Service) SetLocalEnvironmentPrerequisiteWaitTimeout(d time.Duration) {
	if s == nil || d <= 0 {
		return
	}
	s.mu.Lock()
	s.localEnvironmentPrerequisiteWaitTimeout = d
	s.mu.Unlock()
}

func (s *Service) prerequisiteWaitTimeout() time.Duration {
	s.mu.RLock()
	d := s.localEnvironmentPrerequisiteWaitTimeout
	s.mu.RUnlock()
	if d <= 0 {
		return defaultLocalEnvironmentPrerequisiteWaitTimeout
	}
	return d
}

// waitForSelectedSourceForFamilyAndConsumer blocks until the prerequisite
// family's selected-source record both exists and still verifies for the
// consumer (repair state clear, evidence complete, local artifacts present),
// the job ctx is cancelled, or the bounded wait elapses. A concurrent unordered
// Start from the desktop therefore converges correctly: the dependent executor
// parks here while the prerequisite job's own background goroutine drives it to
// ready_managed, but stale / repair-required records are never consumed as
// readiness.
func (s *Service) waitForSelectedSourceForFamilyAndConsumer(ctx context.Context, family string, consumer string) (localEnvironmentSelectedSourceRecordState, bool) {
	record, ok, _ := s.waitForSelectedSourceForFamilyAndConsumerDetail(ctx, family, consumer)
	return record, ok
}

func (s *Service) waitForSelectedSourceForFamilyAndConsumerDetail(ctx context.Context, family string, consumer string) (localEnvironmentSelectedSourceRecordState, bool, string) {
	if record, ok, detail := s.readySelectedSourceForFamilyAndConsumer(family, consumer); ok {
		return record, true, detail
	} else {
		if job, jobOK := s.latestLocalEnvironmentDependencyJobForFamilyAndConsumer(family, consumer); jobOK &&
			localEnvironmentDependencyJobBlocksPrerequisiteWait(job.State) {
			return localEnvironmentSelectedSourceRecordState{}, false, localEnvironmentPrerequisiteFailureDetail(family, consumer, job, detail)
		}
	}
	deadline := time.NewTimer(s.prerequisiteWaitTimeout())
	defer deadline.Stop()
	ticker := time.NewTicker(localEnvironmentPrerequisiteWaitPoll)
	defer ticker.Stop()
	lastDetail := "no selected source record for consumer"
	for {
		select {
		case <-ctx.Done():
			if err := ctx.Err(); err != nil {
				return localEnvironmentSelectedSourceRecordState{}, false, err.Error()
			}
			return localEnvironmentSelectedSourceRecordState{}, false, "prerequisite wait cancelled"
		case <-deadline.C:
			return localEnvironmentSelectedSourceRecordState{}, false, lastDetail
		case <-ticker.C:
			if record, ok, detail := s.readySelectedSourceForFamilyAndConsumer(family, consumer); ok {
				return record, true, detail
			} else {
				lastDetail = detail
			}
			if job, ok := s.latestLocalEnvironmentDependencyJobForFamilyAndConsumer(family, consumer); ok &&
				localEnvironmentDependencyJobBlocksPrerequisiteWait(job.State) {
				return localEnvironmentSelectedSourceRecordState{}, false, localEnvironmentPrerequisiteFailureDetail(family, consumer, job, lastDetail)
			}
		}
	}
}

func (s *Service) latestBlockingLocalEnvironmentDependencyJobForFamilyAndConsumer(family string, consumer string) (localEnvironmentDependencyJobState, bool) {
	job, ok := s.latestLocalEnvironmentDependencyJobForFamilyAndConsumer(family, consumer)
	if !ok || !localEnvironmentDependencyJobBlocksPrerequisiteWait(job.State) {
		return localEnvironmentDependencyJobState{}, false
	}
	return job, true
}

func (s *Service) latestLocalEnvironmentDependencyJobForFamilyAndConsumer(family string, consumer string) (localEnvironmentDependencyJobState, bool) {
	trimmedFamily := strings.TrimSpace(family)
	trimmedConsumer := strings.TrimSpace(consumer)
	if trimmedFamily == "" {
		return localEnvironmentDependencyJobState{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var latest localEnvironmentDependencyJobState
	for _, job := range s.localEnvironmentDependencyJobs {
		if strings.TrimSpace(job.DependencyFamily) != trimmedFamily {
			continue
		}
		if trimmedConsumer != "" && !localEnvironmentDependencyJobMatchesConsumer(job, trimmedConsumer) {
			continue
		}
		if latest.JobID == "" || localEnvironmentDependencyJobNewer(job, latest) {
			latest = job
		}
	}
	return latest, latest.JobID != ""
}

func localEnvironmentDependencyJobBlocksPrerequisiteWait(state string) bool {
	switch strings.TrimSpace(state) {
	case localEnvironmentStateFailed, localEnvironmentStateCancelled, localEnvironmentStateUnsupported, localEnvironmentStateRepairRequired:
		return true
	default:
		return false
	}
}

func localEnvironmentDependencyJobMatchesConsumer(job localEnvironmentDependencyJobState, consumer string) bool {
	trimmedConsumer := strings.TrimSpace(consumer)
	if trimmedConsumer == "" {
		return true
	}
	if strings.TrimSpace(job.ConsumerScope) == trimmedConsumer {
		return true
	}
	if localEnvironmentConsumerScopeFromKey(job.EnvironmentKey) == trimmedConsumer {
		return true
	}
	return pythonMaterializerConsumerForDependency(job.DependencyID) == trimmedConsumer
}

func localEnvironmentDependencyJobNewer(candidate localEnvironmentDependencyJobState, current localEnvironmentDependencyJobState) bool {
	candidateUpdated := strings.TrimSpace(candidate.UpdatedAt)
	currentUpdated := strings.TrimSpace(current.UpdatedAt)
	if candidateUpdated != currentUpdated {
		return candidateUpdated > currentUpdated
	}
	candidateCreated := strings.TrimSpace(candidate.CreatedAt)
	currentCreated := strings.TrimSpace(current.CreatedAt)
	if candidateCreated != currentCreated {
		return candidateCreated > currentCreated
	}
	return strings.TrimSpace(candidate.JobID) > strings.TrimSpace(current.JobID)
}

func localEnvironmentPrerequisiteFailureDetail(family string, consumer string, job localEnvironmentDependencyJobState, fallback string) string {
	detail := strings.TrimSpace(job.FailureDetail)
	if detail == "" {
		detail = strings.TrimSpace(fallback)
	}
	if detail == "" {
		detail = "no selected source record for consumer"
	}
	jobID := strings.TrimSpace(job.JobID)
	if jobID == "" {
		jobID = "unknown"
	}
	consumerLabel := strings.TrimSpace(consumer)
	if consumerLabel == "" {
		consumerLabel = "unspecified"
	}
	return fmt.Sprintf("prerequisite dependency %s/%s for consumer %s is %s (job=%s): %s",
		strings.TrimSpace(family),
		strings.TrimSpace(job.DependencyID),
		consumerLabel,
		strings.TrimSpace(job.State),
		jobID,
		detail,
	)
}

func failedPrerequisiteDependencyResult(detail string) localEnvironmentDependencyJobResult {
	trimmed := strings.TrimSpace(detail)
	if trimmed == "" {
		trimmed = "required local environment prerequisite is not ready"
	}
	return localEnvironmentDependencyJobResult{
		State:           localEnvironmentStateFailed,
		SourceKind:      localEnvironmentSourceManaged,
		AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_PREREQUISITE_FAILED",
		FailureDetail:   trimmed,
	}
}

func (s *Service) readySelectedSourceForFamilyAndConsumer(family string, consumer string) (localEnvironmentSelectedSourceRecordState, bool, string) {
	candidates := s.selectedSourceCandidatesForFamilyAndConsumer(family, consumer)
	if len(candidates) == 0 {
		return localEnvironmentSelectedSourceRecordState{}, false, "no selected source record for consumer"
	}
	lastDetail := "no selected source record satisfies readiness"
	for _, record := range candidates {
		if isLocalEnvironmentRepairActive(record.RepairState) {
			lastDetail = "selected source record is under repair"
			continue
		}
		if err := validateLocalEnvironmentSelectedSourceRecord(record); err != nil {
			lastDetail = "selected source record fails verification: " + err.Error()
			continue
		}
		if err := validateLocalEnvironmentSelectedSourceLocalArtifacts(record); err != nil {
			lastDetail = "selected source record fails local artifact verification: " + err.Error()
			continue
		}
		return record, true, ""
	}
	return localEnvironmentSelectedSourceRecordState{}, false, lastDetail
}

func (s *Service) selectedSourceCandidatesForFamilyAndConsumer(family string, consumer string) []localEnvironmentSelectedSourceRecordState {
	trimmedFamily := strings.TrimSpace(family)
	trimmedConsumer := strings.TrimSpace(consumer)
	s.mu.RLock()
	candidates := make([]localEnvironmentSelectedSourceRecordState, 0)
	for _, record := range s.localEnvironmentSelectedSources {
		if record.DependencyFamily != trimmedFamily {
			continue
		}
		if trimmedConsumer != "" && !stringSliceContains(record.SelectedConsumers, trimmedConsumer) {
			continue
		}
		candidates = append(candidates, record)
	}
	s.mu.RUnlock()
	sort.SliceStable(candidates, func(left, right int) bool {
		leftVerified := strings.TrimSpace(candidates[left].LastVerifiedAt)
		rightVerified := strings.TrimSpace(candidates[right].LastVerifiedAt)
		if leftVerified != rightVerified {
			return leftVerified > rightVerified
		}
		leftSelected := strings.TrimSpace(candidates[left].SelectedAt)
		rightSelected := strings.TrimSpace(candidates[right].SelectedAt)
		if leftSelected != rightSelected {
			return leftSelected > rightSelected
		}
		return strings.TrimSpace(candidates[left].RecordID) > strings.TrimSpace(candidates[right].RecordID)
	})
	return candidates
}

// failOrphanedLocalEnvironmentDependencyJobsLocked is the crash-recovery seam.
// On daemon restart restoreState rehydrates persisted jobs but no goroutine is
// driving them, so any job persisted at a non-terminal state would otherwise be
// a permanent orphan. Fail every such job closed (retryable) with an audit
// reason so the desktop projects it as a retryable failure rather than a frozen
// in-progress job. Caller must hold s.mu.
func (s *Service) failOrphanedLocalEnvironmentDependencyJobsLocked() int {
	if len(s.localEnvironmentDependencyJobs) == 0 {
		return 0
	}
	now := nowISO()
	healed := 0
	for jobID, job := range s.localEnvironmentDependencyJobs {
		if localEnvironmentDependencyJobTerminal(job.State) {
			continue
		}
		job.State = localEnvironmentStateFailed
		job.FailureDetail = "LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED"
		job.Retryable = true
		job.ReasonCode = "LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED"
		job.RecoveryDisposition = localEnvironmentJobRecoveryAutoRetryTransient
		// A job rehydrated mid-download carries a stale byte-progress
		// projection; the failed terminal state is not transferring, so clear
		// it rather than leaving a frozen %/rate/ETA on a dead job.
		job.BytesReceived = 0
		job.BytesTotal = 0
		job.Percent = 0
		job.SpeedBytesPerSec = 0
		job.EtaSeconds = 0
		job.UpdatedAt = now
		s.localEnvironmentDependencyJobs[jobID] = job
		healed++
	}
	return healed
}

// localEnvironmentJobDownloadProgressSink is a per-job byte-progress callback an
// executor attaches to the job context before it enters the shared model
// install/download path. The shared download core's progress callback resolves
// it from the context and forwards each byte-progress snapshot, so the install
// path (installVerifiedAssetByTemplateID → installManagedDownloadedModel →
// downloadManagedModelFile → downloadToFileWithTransfer) needs no extra
// signature parameter to carry per-job progress. A context with no sink leaves
// the install path's behaviour unchanged (the InstallVerifiedAsset RPC path).
type localEnvironmentJobDownloadProgressSink func(localEnvironmentDependencyJobProgress)

type localEnvironmentJobProgressContextKey struct{}

// withLocalEnvironmentJobDownloadProgressSink returns a child context carrying a
// byte-progress sink for the running materializer job. The model.asset /
// model.companion-asset executors attach their reporter's Progress sink so the
// shared download core can publish onto the job projection.
func withLocalEnvironmentJobDownloadProgressSink(ctx context.Context, sink localEnvironmentJobDownloadProgressSink) context.Context {
	if sink == nil {
		return ctx
	}
	return context.WithValue(ctx, localEnvironmentJobProgressContextKey{}, sink)
}

// localEnvironmentJobDownloadProgressSinkFromContext resolves the per-job
// byte-progress sink, or nil when the context carries none (e.g. the
// InstallVerifiedAsset RPC path, which has no owning materializer job).
func localEnvironmentJobDownloadProgressSinkFromContext(ctx context.Context) localEnvironmentJobDownloadProgressSink {
	if ctx == nil {
		return nil
	}
	sink, _ := ctx.Value(localEnvironmentJobProgressContextKey{}).(localEnvironmentJobDownloadProgressSink)
	return sink
}

// reportLocalEnvironmentJobProgress is a nil-safe shim so executors can publish
// a coarse in-progress state without a nil-check at every call site (executor
// unit tests pass jobs through with a zero reporter).
func reportLocalEnvironmentJobProgress(report localEnvironmentDependencyJobProgressReporter, state string) {
	if report.State == nil {
		return
	}
	report.State(state)
}

// reportLocalEnvironmentJobDownloadProgress is the nil-safe byte-progress shim.
// An executor that streams artifact bytes calls it with each progress snapshot;
// a zero reporter (unit tests, or a non-downloading executor) is a no-op.
func reportLocalEnvironmentJobDownloadProgress(report localEnvironmentDependencyJobProgressReporter, progress localEnvironmentDependencyJobProgress) {
	if report.Progress == nil {
		return
	}
	report.Progress(progress)
}

func localEnvironmentEngineDownloadProgressContext(ctx context.Context, report localEnvironmentDependencyJobProgressReporter) context.Context {
	return engine.WithDownloadProgress(ctx, func(bytesReceived, bytesTotal int64) {
		reportLocalEnvironmentJobDownloadProgress(report, localEnvironmentDependencyJobProgress{
			BytesReceived: bytesReceived,
			BytesTotal:    bytesTotal,
		})
	})
}

func normalizeLocalEnvironmentDependencyJobRequest(req localEnvironmentDependencyJobRequest) localEnvironmentDependencyJobRequest {
	sourceKind := strings.TrimSpace(req.SourceKind)
	if sourceKind == "" {
		sourceKind = localEnvironmentSourceManaged
	}
	return localEnvironmentDependencyJobRequest{
		EnvironmentKey:   strings.TrimSpace(req.EnvironmentKey),
		DependencyFamily: strings.TrimSpace(req.DependencyFamily),
		DependencyID:     strings.TrimSpace(req.DependencyID),
		ConsumerScope:    strings.TrimSpace(req.ConsumerScope),
		SourceKind:       sourceKind,
	}
}

func localEnvironmentDependencyJobTerminal(state string) bool {
	switch strings.TrimSpace(state) {
	case localEnvironmentStateReadySystem, localEnvironmentStateReadyManaged, localEnvironmentStateFailed, localEnvironmentStateUnsupported, localEnvironmentStateCancelled:
		return true
	default:
		return false
	}
}
