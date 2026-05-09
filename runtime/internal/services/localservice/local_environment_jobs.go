package localservice

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
)

var errLocalEnvironmentJobCancelled = errors.New("local environment dependency job cancelled")

type localEnvironmentDependencyJobState struct {
	JobID                  string `json:"jobId"`
	EnvironmentKey         string `json:"environmentKey"`
	DependencyFamily       string `json:"dependencyFamily"`
	DependencyID           string `json:"dependencyId"`
	State                  string `json:"state"`
	SourceKind             string `json:"sourceKind"`
	CanonicalRoot          string `json:"canonicalRoot,omitempty"`
	SelectedSourceRecordID string `json:"selectedSourceRecordId,omitempty"`
	FailureDetail          string `json:"failureDetail,omitempty"`
	Retryable              bool   `json:"retryable,omitempty"`
	CreatedAt              string `json:"createdAt"`
	UpdatedAt              string `json:"updatedAt"`
}

type localEnvironmentDependencyJobRequest struct {
	EnvironmentKey   string
	DependencyFamily string
	DependencyID     string
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
}

type localEnvironmentDependencyJobExecutor func(context.Context, localEnvironmentDependencyJobState) (localEnvironmentDependencyJobResult, error)

func (s *Service) startLocalEnvironmentDependencyJob(ctx context.Context, req localEnvironmentDependencyJobRequest, executor localEnvironmentDependencyJobExecutor) (localEnvironmentDependencyJobState, error) {
	normalized := normalizeLocalEnvironmentDependencyJobRequest(req)
	if normalized.EnvironmentKey == "" || normalized.DependencyFamily == "" || normalized.DependencyID == "" {
		return localEnvironmentDependencyJobState{}, errors.New("local environment dependency job requires environment key, family, and dependency id")
	}

	now := nowISO()
	s.mu.Lock()
	if s.localEnvironmentDependencyJobs == nil {
		s.localEnvironmentDependencyJobs = make(map[string]localEnvironmentDependencyJobState)
	}
	for _, job := range s.localEnvironmentDependencyJobs {
		if job.EnvironmentKey == normalized.EnvironmentKey && !localEnvironmentDependencyJobTerminal(job.State) {
			s.mu.Unlock()
			return job, nil
		}
	}
	job := localEnvironmentDependencyJobState{
		JobID:            "localenv_job_" + strings.ToLower(ulid.Make().String()),
		EnvironmentKey:   normalized.EnvironmentKey,
		DependencyFamily: normalized.DependencyFamily,
		DependencyID:     normalized.DependencyID,
		State:            localEnvironmentStateQueued,
		SourceKind:       normalized.SourceKind,
		Retryable:        true,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	s.localEnvironmentDependencyJobs[job.JobID] = job
	s.persistStateLocked()
	s.mu.Unlock()

	if executor == nil {
		return job, nil
	}
	return s.runLocalEnvironmentDependencyJob(ctx, job.JobID, executor)
}

func (s *Service) runLocalEnvironmentDependencyJob(ctx context.Context, jobID string, executor localEnvironmentDependencyJobExecutor) (localEnvironmentDependencyJobState, error) {
	job, ok := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateInstalling, "", true)
	if !ok {
		return localEnvironmentDependencyJobState{}, errors.New("local environment dependency job not found")
	}
	if executor == nil {
		return job, nil
	}

	result, err := executor(ctx, job)
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
		unsupported, _ := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateUnsupported, strings.TrimSpace(result.AuditReasonCode), false)
		return unsupported, nil
	case localEnvironmentStateRepairRequired:
		repairRequired, _ := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateRepairRequired, strings.TrimSpace(result.AuditReasonCode), true)
		return repairRequired, nil
	case localEnvironmentStateFailed:
		failed, _ := s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateFailed, strings.TrimSpace(result.AuditReasonCode), true)
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
	record := s.upsertLocalEnvironmentSelectedSourceRecord(localEnvironmentSelectedSourceRecordState{
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
	})

	readyState := resultState
	promoted, _ := s.transitionLocalEnvironmentDependencyJob(jobID, readyState, "", false)
	promoted.SelectedSourceRecordID = record.RecordID
	promoted.SourceKind = sourceKind
	promoted.CanonicalRoot = strings.TrimSpace(result.CanonicalRoot)

	s.mu.Lock()
	s.localEnvironmentDependencyJobs[promoted.JobID] = promoted
	s.persistStateLocked()
	s.mu.Unlock()
	return promoted, nil
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
	return s.transitionLocalEnvironmentDependencyJob(jobID, localEnvironmentStateCancelled, "", true)
}

func (s *Service) markLocalEnvironmentDependencyRepairRequired(environmentKey string, reason string) (localEnvironmentSelectedSourceRecordState, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.localEnvironmentSelectedSources[strings.TrimSpace(environmentKey)]
	if !ok {
		return localEnvironmentSelectedSourceRecordState{}, false
	}
	record.RepairState = localEnvironmentRepairRequired
	record.AuditReasonCode = strings.TrimSpace(reason)
	record.LastVerifiedAt = time.Now().UTC().Format(time.RFC3339Nano)
	s.localEnvironmentSelectedSources[record.EnvironmentKey] = record
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
	job.State = strings.TrimSpace(state)
	job.FailureDetail = strings.TrimSpace(detail)
	job.Retryable = retryable
	job.UpdatedAt = nowISO()
	s.localEnvironmentDependencyJobs[job.JobID] = job
	s.persistStateLocked()
	return job, true
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
