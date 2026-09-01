package localservice

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

const (
	localEnvironmentSourceSystem      = "system"
	localEnvironmentSourceManaged     = "managed"
	localEnvironmentSourceBundled     = "bundled"
	localEnvironmentSourceImported    = "imported"
	localEnvironmentSourceUnavailable = "unavailable"

	localEnvironmentRepairNone     = "none"
	localEnvironmentRepairRequired = "repair_required"
	localEnvironmentRepairRunning  = "repair_running"
	localEnvironmentRepairFailed   = "repair_failed"
)

type localEnvironmentHostProfileState struct {
	HostProfileID     string `json:"hostProfileId"`
	OS                string `json:"os"`
	Arch              string `json:"arch"`
	GPUAvailable      bool   `json:"gpuAvailable"`
	GPUVendor         string `json:"gpuVendor,omitempty"`
	GPUModel          string `json:"gpuModel,omitempty"`
	PythonAvailable   bool   `json:"pythonAvailable"`
	PythonVersion     string `json:"pythonVersion,omitempty"`
	TotalRAMBytes     int64  `json:"totalRamBytes,omitempty"`
	AvailableRAMBytes int64  `json:"availableRamBytes,omitempty"`
	SavedAt           string `json:"savedAt"`
}

type localEnvironmentSelectedSourceRecordState struct {
	RecordID                string            `json:"recordId"`
	DependencyFamily        string            `json:"dependencyFamily"`
	DependencyID            string            `json:"dependencyId"`
	EnvironmentKey          string            `json:"environmentKey"`
	SourceKind              string            `json:"sourceKind"`
	CanonicalRoot           string            `json:"canonicalRoot,omitempty"`
	Version                 string            `json:"version,omitempty"`
	CompatibilityEvidence   []string          `json:"compatibilityEvidence,omitempty"`
	VerifiedArtifacts       []string          `json:"verifiedArtifacts,omitempty"`
	Hashes                  map[string]string `json:"hashes,omitempty"`
	SelectedConsumers       []string          `json:"selectedConsumers,omitempty"`
	SourceManifestRef       string            `json:"sourceManifestRef,omitempty"`
	VerificationEvidenceRef string            `json:"verificationEvidenceRef,omitempty"`
	ActivationEnvDelta      []string          `json:"activationEnvDelta,omitempty"`
	SelectedAt              string            `json:"selectedAt,omitempty"`
	LastVerifiedAt          string            `json:"lastVerifiedAt,omitempty"`
	RepairState             string            `json:"repairState,omitempty"`
	AuditReasonCode         string            `json:"auditReasonCode,omitempty"`
}

type localEnvironmentPlanDependencyContractState struct {
	EnvironmentKey   string `json:"environmentKey"`
	DependencyFamily string `json:"dependencyFamily"`
	DependencyID     string `json:"dependencyId"`
	ConsumerScope    string `json:"consumerScope,omitempty"`
	RecordedAt       string `json:"recordedAt,omitempty"`
}

func localEnvironmentHostProfileFromDeviceProfile(profile *runtimev1.LocalDeviceProfile) localEnvironmentHostProfileState {
	if profile == nil {
		profile = &runtimev1.LocalDeviceProfile{}
	}
	state := localEnvironmentHostProfileState{
		OS:                strings.ToLower(strings.TrimSpace(profile.GetOs())),
		Arch:              strings.ToLower(strings.TrimSpace(profile.GetArch())),
		GPUAvailable:      profile.GetGpu().GetAvailable(),
		GPUVendor:         strings.ToLower(strings.TrimSpace(profile.GetGpu().GetVendor())),
		GPUModel:          strings.TrimSpace(profile.GetGpu().GetModel()),
		PythonAvailable:   profile.GetPython().GetAvailable(),
		PythonVersion:     strings.TrimSpace(profile.GetPython().GetVersion()),
		TotalRAMBytes:     profile.GetTotalRamBytes(),
		AvailableRAMBytes: profile.GetAvailableRamBytes(),
		SavedAt:           time.Now().UTC().Format(time.RFC3339Nano),
	}
	state.HostProfileID = localEnvironmentHostProfileID(state)
	return state
}

func (s *Service) rememberLocalEnvironmentPlanDependencyContracts(deps []localEnvironmentPlanDependency) {
	if len(deps) == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.localEnvironmentPlanDependencyContracts == nil {
		s.localEnvironmentPlanDependencyContracts = make(map[string]localEnvironmentPlanDependencyContractState)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	changed := false
	for _, dep := range deps {
		key := localEnvironmentPlanDependencyContractKey(dep.EnvironmentKey, dep.DependencyFamily, dep.DependencyID, dep.ConsumerScope)
		if key == "" {
			continue
		}
		record := localEnvironmentPlanDependencyContractState{
			EnvironmentKey:   strings.TrimSpace(dep.EnvironmentKey),
			DependencyFamily: strings.TrimSpace(dep.DependencyFamily),
			DependencyID:     strings.TrimSpace(dep.DependencyID),
			ConsumerScope:    strings.TrimSpace(dep.ConsumerScope),
			RecordedAt:       now,
		}
		if existing, ok := s.localEnvironmentPlanDependencyContracts[key]; ok &&
			existing.DependencyFamily == record.DependencyFamily &&
			existing.DependencyID == record.DependencyID &&
			existing.ConsumerScope == record.ConsumerScope {
			continue
		}
		s.localEnvironmentPlanDependencyContracts[key] = record
		changed = true
	}
	if changed {
		if err := s.persistStateLocked(); err != nil {
			s.logger.Error("persist local environment plan dependency contracts", "error", err)
		}
	}
}

func (s *Service) localEnvironmentPlanDependencyContract(environmentKey string, dependencyFamily string, dependencyID string, consumerScope string) (localEnvironmentPlanDependencyContractState, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	record, ok := s.localEnvironmentPlanDependencyContracts[localEnvironmentPlanDependencyContractKey(environmentKey, dependencyFamily, dependencyID, consumerScope)]
	return record, ok
}

func (s *Service) localEnvironmentPlanDependencyContractForStart(environmentKey string, dependencyFamily string, dependencyID string) (localEnvironmentPlanDependencyContractState, bool) {
	trimmedKey := strings.TrimSpace(environmentKey)
	trimmedFamily := strings.TrimSpace(dependencyFamily)
	trimmedID := strings.TrimSpace(dependencyID)
	if trimmedKey == "" {
		return localEnvironmentPlanDependencyContractState{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var matched localEnvironmentPlanDependencyContractState
	for _, record := range s.localEnvironmentPlanDependencyContracts {
		if strings.TrimSpace(record.EnvironmentKey) != trimmedKey {
			continue
		}
		if trimmedFamily != "" && strings.TrimSpace(record.DependencyFamily) != trimmedFamily {
			continue
		}
		if trimmedID != "" && strings.TrimSpace(record.DependencyID) != trimmedID {
			continue
		}
		if matched.EnvironmentKey != "" && strings.TrimSpace(matched.ConsumerScope) != strings.TrimSpace(record.ConsumerScope) {
			return localEnvironmentPlanDependencyContractState{}, false
		}
		matched = record
	}
	return matched, matched.EnvironmentKey != ""
}

func localEnvironmentHostProfileID(state localEnvironmentHostProfileState) string {
	parts := []string{
		state.OS,
		state.Arch,
		boolString(state.GPUAvailable),
		state.GPUVendor,
		state.GPUModel,
		boolString(state.PythonAvailable),
	}
	return "host_" + shortHash(strings.Join(parts, "|"))
}

func localEnvironmentPlatformTuple(profile localEnvironmentHostProfileState) string {
	osName := strings.ToLower(strings.TrimSpace(profile.OS))
	arch := strings.ToLower(strings.TrimSpace(profile.Arch))
	if osName == "" {
		osName = "unknown-os"
	}
	if arch == "" {
		arch = "unknown-arch"
	}
	return osName + "/" + arch
}

func localEnvironmentKey(dependencyFamily string, dependencyID string, hostProfileID string, platformTuple string, runtimeDataRoot string) string {
	_ = hostProfileID
	_ = runtimeDataRoot
	parts := []string{
		strings.TrimSpace(dependencyFamily),
		strings.TrimSpace(dependencyID),
		strings.TrimSpace(platformTuple),
	}
	return strings.Join(parts, "|")
}

func localEnvironmentNativeLlamaKey(version string, platformTuple string) string {
	return strings.Join([]string{
		localEnvironmentFamilyNativeLlama,
		"llama.cpp.package",
		"version=" + strings.TrimSpace(version),
		strings.TrimSpace(platformTuple),
	}, "|")
}

func localEnvironmentNativeLlamaVersion(environmentKey string) (string, bool) {
	parts := strings.Split(strings.TrimSpace(environmentKey), "|")
	if len(parts) != 4 || parts[0] != localEnvironmentFamilyNativeLlama || parts[1] != "llama.cpp.package" || !strings.HasPrefix(parts[2], "version=") || strings.TrimSpace(parts[3]) == "" {
		return "", false
	}
	version := strings.TrimSpace(strings.TrimPrefix(parts[2], "version="))
	return version, version != ""
}

func localEnvironmentPythonTorchWheelKey(identity engine.PythonTorchWheelDependencyIdentity, platformTuple string, runtimeDataRoot string) string {
	_ = runtimeDataRoot
	parts := []string{
		localEnvironmentFamilyPythonTorchWheel,
		strings.TrimSpace(identity.TorchVersion),
		strings.TrimSpace(identity.AcceleratorPlane),
		strings.TrimSpace(identity.CUDAABI),
		strings.TrimSpace(identity.WheelLockHash),
		strings.TrimSpace(identity.WheelIndex),
		strings.TrimSpace(identity.PackageSource),
		strings.TrimSpace(platformTuple),
	}
	return strings.Join(parts, "|")
}

func localEnvironmentManagedUVKey(platformTuple string, runtimeDataRoot string) string {
	_ = runtimeDataRoot
	return strings.Join([]string{
		localEnvironmentFamilyPythonUV,
		engine.ManagedUVVersion,
		strings.TrimSpace(platformTuple),
	}, "|")
}

func localEnvironmentPythonRuntimeKey(platformTuple string, runtimeDataRoot string) string {
	_ = runtimeDataRoot
	return strings.Join([]string{
		localEnvironmentFamilyPythonRuntime,
		engine.ManagedPythonVersion,
		engine.ManagedPythonABI,
		strings.TrimSpace(platformTuple),
	}, "|")
}

func localEnvironmentPythonProfileKey(family string, dependencyID string, runtimeDataRoot string) string {
	_ = runtimeDataRoot
	return strings.Join([]string{
		strings.TrimSpace(family),
		strings.TrimSpace(dependencyID),
	}, "|")
}

func localEnvironmentConsumerAwareIdentityKey(environmentKey string, dependencyFamily string, dependencyID string, consumerScope string) string {
	key := strings.TrimSpace(environmentKey)
	family := strings.TrimSpace(dependencyFamily)
	id := strings.TrimSpace(dependencyID)
	consumer := strings.TrimSpace(consumerScope)
	if key == "" || family == "" || id == "" || consumer == "" {
		return ""
	}
	return strings.Join([]string{key, family, id, consumer}, "\x1f")
}

func localEnvironmentPlanDependencyContractKey(environmentKey string, dependencyFamily string, dependencyID string, consumerScope string) string {
	return localEnvironmentConsumerAwareIdentityKey(environmentKey, dependencyFamily, dependencyID, consumerScope)
}

func localEnvironmentSelectedSourceRecordKey(record localEnvironmentSelectedSourceRecordState) string {
	key := strings.TrimSpace(record.EnvironmentKey)
	family := strings.TrimSpace(record.DependencyFamily)
	id := strings.TrimSpace(record.DependencyID)
	if key == "" || family == "" || id == "" {
		return ""
	}
	return strings.Join([]string{key, family, id}, "\x1f")
}

func (s *Service) upsertLocalEnvironmentSelectedSourceRecord(record localEnvironmentSelectedSourceRecordState) localEnvironmentSelectedSourceRecordState {
	s.mu.Lock()
	defer s.mu.Unlock()
	merged := s.mergeLocalEnvironmentSelectedSourceRecordLocked(record)
	if err := s.persistStateLocked(); err != nil {
		s.logger.Error("persist local environment selected source", "environment_key", merged.EnvironmentKey, "error", err)
	}
	return merged
}

// mergeLocalEnvironmentSelectedSourceRecordLocked normalizes and merges a
// selected-source record into s.localEnvironmentSelectedSources without
// persisting it. Caller must hold s.mu and persist after all related state has
// been mutated. This lets dependency-job promotion place its record and ready
// job in one durable snapshot.
func (s *Service) mergeLocalEnvironmentSelectedSourceRecordLocked(record localEnvironmentSelectedSourceRecordState) localEnvironmentSelectedSourceRecordState {
	record.DependencyFamily = strings.TrimSpace(record.DependencyFamily)
	record.DependencyID = strings.TrimSpace(record.DependencyID)
	record.EnvironmentKey = strings.TrimSpace(record.EnvironmentKey)
	record.SourceKind = strings.TrimSpace(record.SourceKind)
	record.SourceManifestRef = strings.TrimSpace(record.SourceManifestRef)
	record.VerificationEvidenceRef = strings.TrimSpace(record.VerificationEvidenceRef)
	record.SelectedConsumers = normalizeStringSlice(record.SelectedConsumers)
	if localEnvironmentPythonSelectedSourceFamily(record.DependencyFamily) {
		// Python selected-source ownership is canonical and consumer-independent.
		// Consumer membership and private process activation stay on the existing
		// consumer-scoped dependency job / activation-gate projection.
		record.SelectedConsumers = nil
		record.ActivationEnvDelta = nil
	}
	if record.SourceKind == "" {
		record.SourceKind = localEnvironmentSourceManaged
	}
	if record.RepairState == "" {
		record.RepairState = localEnvironmentRepairNone
	}
	if record.SelectedAt == "" {
		record.SelectedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if record.LastVerifiedAt == "" {
		record.LastVerifiedAt = record.SelectedAt
	}
	if s.localEnvironmentSelectedSources == nil {
		s.localEnvironmentSelectedSources = make(map[string]localEnvironmentSelectedSourceRecordState)
	}
	key := localEnvironmentSelectedSourceRecordKey(record)
	if key == "" {
		key = strings.TrimSpace(record.EnvironmentKey)
	}
	if existing, ok := s.localEnvironmentSelectedSources[key]; ok {
		if record.RecordID == "" {
			record.RecordID = strings.TrimSpace(existing.RecordID)
		}
		if strings.TrimSpace(existing.SelectedAt) != "" {
			record.SelectedAt = existing.SelectedAt
		}
		if !localEnvironmentPythonSelectedSourceFamily(record.DependencyFamily) {
			record.SelectedConsumers = normalizeStringSlice(append(append([]string(nil), existing.SelectedConsumers...), record.SelectedConsumers...))
		}
	}
	if record.RecordID == "" {
		record.RecordID = "src_" + shortHash(record.EnvironmentKey+"|"+record.DependencyFamily+"|"+record.DependencyID+"|"+record.SourceKind+"|"+record.CanonicalRoot)
	}
	s.localEnvironmentSelectedSources[key] = record
	return record
}

func (s *Service) localEnvironmentSelectedSourceRecord(environmentKey string) (localEnvironmentSelectedSourceRecordState, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	trimmedKey := strings.TrimSpace(environmentKey)
	var matched localEnvironmentSelectedSourceRecordState
	for _, record := range s.localEnvironmentSelectedSources {
		if strings.TrimSpace(record.EnvironmentKey) != trimmedKey {
			continue
		}
		if matched.EnvironmentKey != "" {
			return localEnvironmentSelectedSourceRecordState{}, false
		}
		matched = record
	}
	return canonicalLocalEnvironmentPythonSelectedSourceRecord(matched), matched.EnvironmentKey != ""
}

func (s *Service) localEnvironmentSelectedSourceRecordForDependency(environmentKey string, dependencyFamily string, dependencyID string, consumerScope string) (localEnvironmentSelectedSourceRecordState, bool) {
	trimmedKey := strings.TrimSpace(environmentKey)
	trimmedFamily := strings.TrimSpace(dependencyFamily)
	trimmedID := strings.TrimSpace(dependencyID)
	trimmedConsumer := strings.TrimSpace(consumerScope)
	if trimmedKey == "" || trimmedFamily == "" || trimmedID == "" || trimmedConsumer == "" {
		return localEnvironmentSelectedSourceRecordState{}, false
	}
	s.mu.RLock()
	var matched localEnvironmentSelectedSourceRecordState
	for _, record := range s.localEnvironmentSelectedSources {
		if strings.TrimSpace(record.EnvironmentKey) != trimmedKey {
			continue
		}
		if strings.TrimSpace(record.DependencyFamily) != trimmedFamily {
			continue
		}
		if strings.TrimSpace(record.DependencyID) != trimmedID {
			continue
		}
		if !localEnvironmentPythonSelectedSourceFamily(record.DependencyFamily) &&
			!stringSliceContains(record.SelectedConsumers, trimmedConsumer) {
			continue
		}
		matched = canonicalLocalEnvironmentPythonSelectedSourceRecord(record)
		break
	}
	s.mu.RUnlock()
	if matched.EnvironmentKey == "" {
		return localEnvironmentSelectedSourceRecordState{}, false
	}
	if matched.DependencyFamily == localEnvironmentFamilyPythonPackageSet {
		if _, ok, _ := s.localEnvironmentPythonPackageSetConsumptionJob(matched, trimmedConsumer); !ok {
			return localEnvironmentSelectedSourceRecordState{}, false
		}
	}
	return matched, true
}

func localEnvironmentPythonSelectedSourceFamily(family string) bool {
	switch strings.TrimSpace(family) {
	case localEnvironmentFamilyPythonUV,
		localEnvironmentFamilyPythonRuntime,
		localEnvironmentFamilyPythonVenv,
		localEnvironmentFamilyPythonPackageSet,
		localEnvironmentFamilyPythonTorchWheel:
		return true
	default:
		return false
	}
}

func canonicalLocalEnvironmentPythonSelectedSourceRecord(record localEnvironmentSelectedSourceRecordState) localEnvironmentSelectedSourceRecordState {
	if localEnvironmentPythonSelectedSourceFamily(record.DependencyFamily) {
		record.SelectedConsumers = nil
		record.ActivationEnvDelta = nil
	}
	return record
}

// selected-source paths are runtime-derived absolute paths in memory and
// owner-relative locators on disk. A copied nimi_data root therefore reopens
// without retaining a former machine/root address.
func localEnvironmentSelectedSourceRecordForStorage(record localEnvironmentSelectedSourceRecordState, dataRoot string) localEnvironmentSelectedSourceRecordState {
	record.VerifiedArtifacts = append([]string(nil), record.VerifiedArtifacts...)
	if record.SourceKind == localEnvironmentSourceSystem {
		detachLocalEnvironmentSelectedSourceForStorage(&record)
		return record
	}
	if strings.TrimSpace(record.CanonicalRoot) != "" {
		if locator, ok := localEnvironmentOwnerRelativeLocator(dataRoot, record.CanonicalRoot); ok {
			if !localEnvironmentManagedOwnerLocator(locator) {
				detachLocalEnvironmentSelectedSourceForStorage(&record)
				return record
			}
			record.CanonicalRoot = locator
		} else if _, ok := localEnvironmentOwnerPathFromLocator(dataRoot, record.CanonicalRoot); !ok || !localEnvironmentManagedOwnerLocator(record.CanonicalRoot) {
			detachLocalEnvironmentSelectedSourceForStorage(&record)
			return record
		}
	}
	for index, artifact := range record.VerifiedArtifacts {
		if !filepath.IsAbs(strings.TrimSpace(artifact)) {
			continue
		}
		locator, ok := localEnvironmentOwnerRelativeLocator(dataRoot, artifact)
		if !ok || !localEnvironmentManagedOwnerLocator(locator) {
			detachLocalEnvironmentSelectedSourceForStorage(&record)
			return record
		}
		record.VerifiedArtifacts[index] = locator
	}
	return record
}

func validateLocalEnvironmentSelectedSourceRuntimePathsForPromotion(record localEnvironmentSelectedSourceRecordState, dataRoot string) error {
	if record.SourceKind == localEnvironmentSourceSystem {
		return nil
	}
	rootLocator, ok := localEnvironmentOwnerRelativeLocator(dataRoot, record.CanonicalRoot)
	if !ok || !localEnvironmentManagedOwnerLocator(rootLocator) {
		return fmt.Errorf("LOCAL_ENVIRONMENT_SELECTED_SOURCE_OWNER_ROOT_NOT_PORTABLE")
	}
	for _, artifact := range record.VerifiedArtifacts {
		trimmed := strings.TrimSpace(artifact)
		if trimmed == "" || strings.Contains(trimmed, "=") {
			continue
		}
		if !filepath.IsAbs(trimmed) {
			if !localEnvironmentSelectedSourceCanonicalRootIsDirectory(record.DependencyFamily) {
				return fmt.Errorf("LOCAL_ENVIRONMENT_SELECTED_SOURCE_ARTIFACT_MUST_BE_ABSOLUTE")
			}
			cleaned := filepath.Clean(filepath.FromSlash(trimmed))
			if cleaned == "." || cleaned == ".." || filepath.IsAbs(cleaned) || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
				return fmt.Errorf("LOCAL_ENVIRONMENT_SELECTED_SOURCE_ARTIFACT_LOCATOR_INVALID")
			}
			continue
		}
		locator, ok := localEnvironmentOwnerRelativeLocator(dataRoot, trimmed)
		if !ok || !localEnvironmentManagedOwnerLocator(locator) {
			return fmt.Errorf("LOCAL_ENVIRONMENT_SELECTED_SOURCE_ARTIFACT_NOT_PORTABLE")
		}
	}
	return nil
}

func detachLocalEnvironmentSelectedSourceForStorage(record *localEnvironmentSelectedSourceRecordState) {
	if record == nil {
		return
	}
	record.CanonicalRoot = ""
	record.VerifiedArtifacts = nil
	record.CompatibilityEvidence = nil
	record.LastVerifiedAt = ""
	record.RepairState = localEnvironmentRepairRequired
}

func localEnvironmentSelectedSourceRecordFromStorage(record localEnvironmentSelectedSourceRecordState, dataRoot string) localEnvironmentSelectedSourceRecordState {
	record.VerifiedArtifacts = append([]string(nil), record.VerifiedArtifacts...)
	storedRoot := strings.TrimSpace(record.CanonicalRoot)
	if path, ok := localEnvironmentOwnerPathFromLocator(dataRoot, record.CanonicalRoot); ok && localEnvironmentManagedOwnerLocator(record.CanonicalRoot) {
		record.CanonicalRoot = path
	} else if storedRoot != "" && !filepath.IsAbs(storedRoot) {
		detachLocalEnvironmentSelectedSourceForStorage(&record)
		return record
	}
	for index, artifact := range record.VerifiedArtifacts {
		// Relative artifact names are interpreted from CanonicalRoot by the
		// dependency owner. Only an artifact locator that was serialized as the
		// canonical root itself or one of its descendants is data-root relative.
		// Rehydrating every relative name against dataRoot turns
		// "cudart64_12.dll" into "<dataRoot>/cudart64_12.dll" and falsely marks a
		// healthy CUDA dependency for repair after Runtime restart.
		if !localEnvironmentArtifactUsesOwnerLocator(storedRoot, artifact) {
			continue
		}
		if path, ok := localEnvironmentOwnerPathFromLocator(dataRoot, artifact); ok {
			record.VerifiedArtifacts[index] = path
		}
	}
	return record
}

func localEnvironmentArtifactUsesOwnerLocator(storedRoot string, artifact string) bool {
	value := filepath.ToSlash(filepath.Clean(filepath.FromSlash(strings.TrimSpace(artifact))))
	if value == "." || filepath.IsAbs(filepath.FromSlash(value)) {
		return false
	}
	return localEnvironmentManagedOwnerLocator(value)
}

func localEnvironmentManagedOwnerLocator(value string) bool {
	cleaned := filepath.ToSlash(filepath.Clean(filepath.FromSlash(strings.TrimSpace(value))))
	return cleaned == "environments" || strings.HasPrefix(cleaned, "environments/") || cleaned == "dependencies" || strings.HasPrefix(cleaned, "dependencies/")
}

func localEnvironmentOwnerRelativeLocator(dataRoot string, value string) (string, bool) {
	root := filepath.Clean(strings.TrimSpace(dataRoot))
	path := filepath.Clean(strings.TrimSpace(value))
	if root == "." || path == "." || !filepath.IsAbs(root) || !filepath.IsAbs(path) {
		return "", false
	}
	relative, err := filepath.Rel(root, path)
	if err != nil || filepath.IsAbs(relative) || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", false
	}
	return filepath.ToSlash(relative), true
}

func localEnvironmentOwnerPathFromLocator(dataRoot string, value string) (string, bool) {
	root := filepath.Clean(strings.TrimSpace(dataRoot))
	value = strings.TrimSpace(value)
	if root == "." || value == "" || filepath.IsAbs(value) {
		return "", false
	}
	locator := filepath.Clean(filepath.FromSlash(value))
	if locator == "." || locator == ".." || filepath.IsAbs(locator) || strings.HasPrefix(locator, ".."+string(filepath.Separator)) {
		return "", false
	}
	return filepath.Join(root, locator), true
}

func cloneLocalEnvironmentSelectedSourceRecordsForMutation(input map[string]localEnvironmentSelectedSourceRecordState) map[string]localEnvironmentSelectedSourceRecordState {
	output := make(map[string]localEnvironmentSelectedSourceRecordState, len(input))
	for key, record := range input {
		record.CompatibilityEvidence = append([]string(nil), record.CompatibilityEvidence...)
		record.VerifiedArtifacts = append([]string(nil), record.VerifiedArtifacts...)
		record.SelectedConsumers = append([]string(nil), record.SelectedConsumers...)
		record.ActivationEnvDelta = append([]string(nil), record.ActivationEnvDelta...)
		record.Hashes = cloneStringMap(record.Hashes)
		output[key] = record
	}
	return output
}

func (s *Service) localEnvironmentSelectedSourceRecordForRepair(environmentKey string, dependencyFamily string, dependencyID string, consumerScope string) (localEnvironmentSelectedSourceRecordState, bool) {
	if record, ok := s.localEnvironmentSelectedSourceRecordForDependency(environmentKey, dependencyFamily, dependencyID, consumerScope); ok {
		return record, true
	}
	trimmedKey := strings.TrimSpace(environmentKey)
	trimmedFamily := strings.TrimSpace(dependencyFamily)
	trimmedID := strings.TrimSpace(dependencyID)
	if trimmedKey == "" {
		return localEnvironmentSelectedSourceRecordState{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var matched localEnvironmentSelectedSourceRecordState
	for _, record := range s.localEnvironmentSelectedSources {
		if strings.TrimSpace(record.EnvironmentKey) != trimmedKey {
			continue
		}
		if trimmedFamily != "" && strings.TrimSpace(record.DependencyFamily) != trimmedFamily {
			continue
		}
		if trimmedID != "" && strings.TrimSpace(record.DependencyID) != trimmedID {
			continue
		}
		if matched.EnvironmentKey != "" {
			return localEnvironmentSelectedSourceRecordState{}, false
		}
		matched = record
	}
	return canonicalLocalEnvironmentPythonSelectedSourceRecord(matched), matched.EnvironmentKey != ""
}

func shortHash(input string) string {
	sum := sha256.Sum256([]byte(input))
	return hex.EncodeToString(sum[:])[:16]
}

func boolString(value bool) string {
	if value {
		return "true"
	}
	return "false"
}
