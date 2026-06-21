package localservice

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
		s.persistStateLocked()
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
	parts := []string{
		strings.TrimSpace(dependencyFamily),
		strings.TrimSpace(dependencyID),
		strings.TrimSpace(hostProfileID),
		strings.TrimSpace(platformTuple),
		strings.TrimSpace(runtimeDataRoot),
	}
	return strings.Join(parts, "|")
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
	return s.upsertLocalEnvironmentSelectedSourceRecordLocked(record)
}

// upsertLocalEnvironmentSelectedSourceRecordLocked normalizes and persists a
// selected-source record into s.localEnvironmentSelectedSources. Caller must
// hold s.mu. It exists so the record write can be folded into the same locked
// critical section as a dependency-job promotion, keeping the two atomic with
// respect to a concurrent Cancel.
func (s *Service) upsertLocalEnvironmentSelectedSourceRecordLocked(record localEnvironmentSelectedSourceRecordState) localEnvironmentSelectedSourceRecordState {
	record.DependencyFamily = strings.TrimSpace(record.DependencyFamily)
	record.DependencyID = strings.TrimSpace(record.DependencyID)
	record.EnvironmentKey = strings.TrimSpace(record.EnvironmentKey)
	record.SourceKind = strings.TrimSpace(record.SourceKind)
	record.SourceManifestRef = strings.TrimSpace(record.SourceManifestRef)
	record.VerificationEvidenceRef = strings.TrimSpace(record.VerificationEvidenceRef)
	record.SelectedConsumers = normalizeStringSlice(record.SelectedConsumers)
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
		record.SelectedConsumers = normalizeStringSlice(append(append([]string(nil), existing.SelectedConsumers...), record.SelectedConsumers...))
	}
	if record.RecordID == "" {
		record.RecordID = "src_" + shortHash(record.EnvironmentKey+"|"+record.DependencyFamily+"|"+record.DependencyID+"|"+record.SourceKind+"|"+record.CanonicalRoot)
	}
	s.localEnvironmentSelectedSources[key] = record
	s.persistStateLocked()
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
	return matched, matched.EnvironmentKey != ""
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
	defer s.mu.RUnlock()
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
		if !stringSliceContains(record.SelectedConsumers, trimmedConsumer) {
			continue
		}
		return record, true
	}
	return localEnvironmentSelectedSourceRecordState{}, false
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
	return matched, matched.EnvironmentKey != ""
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
