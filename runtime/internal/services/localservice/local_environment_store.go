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
	RecordID              string            `json:"recordId"`
	DependencyFamily      string            `json:"dependencyFamily"`
	DependencyID          string            `json:"dependencyId"`
	EnvironmentKey        string            `json:"environmentKey"`
	SourceKind            string            `json:"sourceKind"`
	CanonicalRoot         string            `json:"canonicalRoot,omitempty"`
	Version               string            `json:"version,omitempty"`
	CompatibilityEvidence []string          `json:"compatibilityEvidence,omitempty"`
	VerifiedArtifacts     []string          `json:"verifiedArtifacts,omitempty"`
	Hashes                map[string]string `json:"hashes,omitempty"`
	SelectedConsumers     []string          `json:"selectedConsumers,omitempty"`
	ActivationEnvDelta    []string          `json:"activationEnvDelta,omitempty"`
	SelectedAt            string            `json:"selectedAt,omitempty"`
	LastVerifiedAt        string            `json:"lastVerifiedAt,omitempty"`
	RepairState           string            `json:"repairState,omitempty"`
	AuditReasonCode       string            `json:"auditReasonCode,omitempty"`
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

func localEnvironmentHostProfileID(state localEnvironmentHostProfileState) string {
	parts := []string{
		state.OS,
		state.Arch,
		boolString(state.GPUAvailable),
		state.GPUVendor,
		state.GPUModel,
		boolString(state.PythonAvailable),
		state.PythonVersion,
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

func localEnvironmentKey(dependencyFamily string, dependencyID string, hostProfileID string, platformTuple string, runtimeDataRoot string, consumerScope string) string {
	parts := []string{
		strings.TrimSpace(dependencyFamily),
		strings.TrimSpace(dependencyID),
		strings.TrimSpace(hostProfileID),
		strings.TrimSpace(platformTuple),
		strings.TrimSpace(runtimeDataRoot),
		strings.TrimSpace(consumerScope),
	}
	return strings.Join(parts, "|")
}

func (s *Service) upsertLocalEnvironmentSelectedSourceRecord(record localEnvironmentSelectedSourceRecordState) localEnvironmentSelectedSourceRecordState {
	record.DependencyFamily = strings.TrimSpace(record.DependencyFamily)
	record.DependencyID = strings.TrimSpace(record.DependencyID)
	record.EnvironmentKey = strings.TrimSpace(record.EnvironmentKey)
	record.SourceKind = strings.TrimSpace(record.SourceKind)
	if record.SourceKind == "" {
		record.SourceKind = localEnvironmentSourceManaged
	}
	if record.RepairState == "" {
		record.RepairState = localEnvironmentRepairNone
	}
	if record.RecordID == "" {
		record.RecordID = "src_" + shortHash(record.EnvironmentKey+"|"+record.SourceKind+"|"+record.CanonicalRoot)
	}
	if record.SelectedAt == "" {
		record.SelectedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if record.LastVerifiedAt == "" {
		record.LastVerifiedAt = record.SelectedAt
	}

	s.mu.Lock()
	if s.localEnvironmentSelectedSources == nil {
		s.localEnvironmentSelectedSources = make(map[string]localEnvironmentSelectedSourceRecordState)
	}
	s.localEnvironmentSelectedSources[record.EnvironmentKey] = record
	s.persistStateLocked()
	s.mu.Unlock()
	return record
}

func (s *Service) localEnvironmentSelectedSourceRecord(environmentKey string) (localEnvironmentSelectedSourceRecordState, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	record, ok := s.localEnvironmentSelectedSources[strings.TrimSpace(environmentKey)]
	return record, ok
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
