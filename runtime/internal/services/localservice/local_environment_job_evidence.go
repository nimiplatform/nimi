package localservice

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

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
