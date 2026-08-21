package localservice

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	defaultLocalStateRelativePath = ".nimi/runtime/local-state.json"
	localStateSchemaVersion       = 2
)

// localStateSnapshot is the steady-state v2 runtime store. Model inventory is
// owned by the separate ModelAsset store; retired LocalAsset rows are never
// decoded into this snapshot.
type localStateSnapshot struct {
	SchemaVersion                   int                                           `json:"schemaVersion"`
	SavedAt                         string                                        `json:"savedAt"`
	Transfers                       []localStateTransferState                     `json:"transfers,omitempty"`
	Audits                          []localStateAuditState                        `json:"audits,omitempty"`
	LocalEnvironmentHostProfiles    []localEnvironmentHostProfileState            `json:"localEnvironmentHostProfiles,omitempty"`
	LocalEnvironmentSelectedSources []localEnvironmentSelectedSourceRecordState   `json:"localEnvironmentSelectedSourceRecords,omitempty"`
	LocalEnvironmentDependencyJobs  []localEnvironmentDependencyJobState          `json:"localEnvironmentDependencyJobs,omitempty"`
	LocalEnvironmentPlanContracts   []localEnvironmentPlanDependencyContractState `json:"localEnvironmentPlanDependencyContracts,omitempty"`
	retainedRecords                 []quarantinedStateRecord
}

type localStateAuditState struct {
	ID            string         `json:"id"`
	EventType     string         `json:"eventType"`
	OccurredAt    string         `json:"occurredAt"`
	Source        string         `json:"source"`
	Modality      string         `json:"modality"`
	ReasonCode    string         `json:"reasonCode"`
	Detail        string         `json:"detail"`
	ModelID       string         `json:"modelId"`
	Payload       map[string]any `json:"payload"`
	TraceID       string         `json:"traceId,omitempty"`
	AppID         string         `json:"appId,omitempty"`
	Domain        string         `json:"domain,omitempty"`
	Operation     string         `json:"operation,omitempty"`
	SubjectUserID string         `json:"subjectUserId,omitempty"`
}

type localStateTransferState struct {
	InstallSessionID    string                              `json:"installSessionId"`
	AssetID             string                              `json:"assetId"`
	SessionKind         string                              `json:"sessionKind"`
	Phase               string                              `json:"phase"`
	State               string                              `json:"state"`
	BytesReceived       int64                               `json:"bytesReceived"`
	BytesTotal          int64                               `json:"bytesTotal,omitempty"`
	SpeedBytesPerSec    int64                               `json:"speedBytesPerSec,omitempty"`
	EtaSeconds          int64                               `json:"etaSeconds,omitempty"`
	Message             string                              `json:"message,omitempty"`
	ReasonCode          string                              `json:"reasonCode,omitempty"`
	Retryable           bool                                `json:"retryable,omitempty"`
	CreatedAt           string                              `json:"createdAt"`
	UpdatedAt           string                              `json:"updatedAt"`
	ManagedDownloadSpec *localStateManagedModelDownloadSpec `json:"managedDownloadSpec,omitempty"`
}

type localStateManagedModelDownloadSpec struct {
	ModelID           string                   `json:"modelId"`
	DisplayName       string                   `json:"displayName,omitempty"`
	CatalogAssetID    string                   `json:"catalogAssetId,omitempty"`
	CatalogTemplateID string                   `json:"catalogTemplateId,omitempty"`
	Kind              runtimev1.LocalAssetKind `json:"kind,omitempty"`
	Capabilities      []string                 `json:"capabilities,omitempty"`
	Engine            string                   `json:"engine,omitempty"`
	Entry             string                   `json:"entry"`
	Files             []string                 `json:"files"`
	License           string                   `json:"license,omitempty"`
	SourceProvenance  string                   `json:"sourceProvenance,omitempty"`
	Repo              string                   `json:"repo"`
	Revision          string                   `json:"revision"`
	Hashes            map[string]string        `json:"hashes"`
	TotalSizeBytes    int64                    `json:"totalSizeBytes,omitempty"`
	EngineConfig      map[string]any           `json:"engineConfig,omitempty"`
}

func resolveLocalStatePath(configuredPath string) string {
	if value := strings.TrimSpace(configuredPath); value != "" {
		return value
	}
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_STATE_PATH")); value != "" {
		return value
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, defaultLocalStateRelativePath)
}

func (s *Service) restoreState() error {
	path := strings.TrimSpace(s.stateStorePath)
	if path == "" {
		return nil
	}
	snapshot, isolationDiagnostics, rewriteRequired, err := loadLocalStateSnapshotIsolated(path)
	if err != nil {
		return err
	}

	modelsRoot := s.resolvedLocalModelsPath()
	s.mu.Lock()
	s.recordStartupStateIsolationDiagnostics(isolationDiagnostics)
	s.localStateRetainedRecords = cloneQuarantinedStateRecords(snapshot.retainedRecords)
	healedSnapshot := rewriteRequired

	s.audits = s.audits[:0]
	capacity := s.effectiveLocalAuditCapacity()
	for _, item := range snapshot.Audits {
		event := &runtimev1.LocalAuditEvent{
			Id:            item.ID,
			EventType:     item.EventType,
			OccurredAt:    item.OccurredAt,
			Source:        item.Source,
			Modality:      item.Modality,
			ReasonCode:    item.ReasonCode,
			Detail:        item.Detail,
			ModelId:       item.ModelID,
			Payload:       toStruct(item.Payload),
			TraceId:       item.TraceID,
			AppId:         item.AppID,
			Domain:        item.Domain,
			Operation:     item.Operation,
			SubjectUserId: item.SubjectUserID,
		}
		s.audits = append(s.audits, event)
		if len(s.audits) >= capacity {
			break
		}
	}
	s.transfers = make(map[string]*runtimev1.LocalTransferSessionSummary, len(snapshot.Transfers))
	s.managedModelDownloadSpecs = make(map[string]managedDownloadedModelSpec)
	s.transferControls = make(map[string]*localTransferControl)
	for _, item := range snapshot.Transfers {
		summary := &runtimev1.LocalTransferSessionSummary{
			InstallSessionId: item.InstallSessionID,
			AssetId:          item.AssetID,
			SessionKind:      normalizeTransferKind(item.SessionKind),
			Phase:            item.Phase,
			State:            normalizeTransferState(item.State),
			BytesReceived:    item.BytesReceived,
			BytesTotal:       item.BytesTotal,
			SpeedBytesPerSec: item.SpeedBytesPerSec,
			EtaSeconds:       item.EtaSeconds,
			Message:          item.Message,
			ReasonCode:       item.ReasonCode,
			Retryable:        item.Retryable,
			CreatedAt:        item.CreatedAt,
			UpdatedAt:        item.UpdatedAt,
		}
		if summary.GetInstallSessionId() == "" {
			continue
		}
		s.transfers[summary.GetInstallSessionId()] = summary
		if item.ManagedDownloadSpec != nil {
			spec, specErr := managedDownloadedModelSpecFromLocalState(item.ManagedDownloadSpec)
			if specErr != nil || spec.modelID != summary.GetAssetId() {
				continue
			}
			s.managedModelDownloadSpecs[summary.GetInstallSessionId()] = spec
		}
	}
	s.localEnvironmentHostProfiles = make(map[string]localEnvironmentHostProfileState, len(snapshot.LocalEnvironmentHostProfiles))
	for _, item := range snapshot.LocalEnvironmentHostProfiles {
		if strings.TrimSpace(item.HostProfileID) == "" {
			continue
		}
		s.localEnvironmentHostProfiles[item.HostProfileID] = item
	}
	s.localEnvironmentSelectedSources = make(map[string]localEnvironmentSelectedSourceRecordState, len(snapshot.LocalEnvironmentSelectedSources))
	for _, item := range snapshot.LocalEnvironmentSelectedSources {
		if strings.TrimSpace(item.EnvironmentKey) == "" {
			continue
		}
		if localEnvironmentPythonSelectedSourceFamily(item.DependencyFamily) &&
			(len(item.SelectedConsumers) > 0 || len(item.ActivationEnvDelta) > 0) {
			item = canonicalLocalEnvironmentPythonSelectedSourceRecord(item)
			healedSnapshot = true
		}
		key := localEnvironmentSelectedSourceRecordKey(item)
		if key == "" {
			key = strings.TrimSpace(item.EnvironmentKey)
		}
		s.localEnvironmentSelectedSources[key] = item
	}
	s.localEnvironmentDependencyJobs = make(map[string]localEnvironmentDependencyJobState, len(snapshot.LocalEnvironmentDependencyJobs))
	for _, item := range snapshot.LocalEnvironmentDependencyJobs {
		if strings.TrimSpace(item.JobID) == "" {
			continue
		}
		s.localEnvironmentDependencyJobs[item.JobID] = item
	}
	s.localEnvironmentPlanDependencyContracts = make(map[string]localEnvironmentPlanDependencyContractState, len(snapshot.LocalEnvironmentPlanContracts))
	for _, item := range snapshot.LocalEnvironmentPlanContracts {
		if strings.TrimSpace(item.EnvironmentKey) == "" {
			continue
		}
		key := localEnvironmentPlanDependencyContractKey(item.EnvironmentKey, item.DependencyFamily, item.DependencyID, item.ConsumerScope)
		if key == "" {
			continue
		}
		s.localEnvironmentPlanDependencyContracts[key] = item
	}
	// Crash recovery: a job persisted at a non-terminal state across a daemon
	// restart has no background goroutine driving it. Fail every orphan closed
	// (retryable) so it is never a permanently frozen in-progress job.
	if s.failOrphanedLocalEnvironmentDependencyJobsLocked() > 0 {
		healedSnapshot = true
	}
	// Transfer crash recovery pauses resumable downloads with their interruption
	// reason while retaining the existing fail-closed handling for imports.
	if s.reconcileOrphanedLocalTransfersLocked(modelsRoot) > 0 {
		healedSnapshot = true
	}
	if healedSnapshot {
		s.persistStateLocked()
	}
	s.mu.Unlock()
	return nil
}

func (s *Service) persistStateLocked() error {
	path := strings.TrimSpace(s.stateStorePath)
	if path == "" {
		return nil
	}

	snapshot := localStateSnapshot{
		SchemaVersion:                   localStateSchemaVersion,
		SavedAt:                         time.Now().UTC().Format(time.RFC3339Nano),
		Transfers:                       make([]localStateTransferState, 0, len(s.transfers)),
		Audits:                          make([]localStateAuditState, 0, len(s.audits)),
		LocalEnvironmentHostProfiles:    make([]localEnvironmentHostProfileState, 0, len(s.localEnvironmentHostProfiles)),
		LocalEnvironmentSelectedSources: make([]localEnvironmentSelectedSourceRecordState, 0, len(s.localEnvironmentSelectedSources)),
		LocalEnvironmentDependencyJobs:  make([]localEnvironmentDependencyJobState, 0, len(s.localEnvironmentDependencyJobs)),
		LocalEnvironmentPlanContracts:   make([]localEnvironmentPlanDependencyContractState, 0, len(s.localEnvironmentPlanDependencyContracts)),
		retainedRecords:                 cloneQuarantinedStateRecords(s.localStateRetainedRecords),
	}

	transferIDs := make([]string, 0, len(s.transfers))
	for id := range s.transfers {
		transferIDs = append(transferIDs, id)
	}
	sort.Strings(transferIDs)
	for _, id := range transferIDs {
		transfer := s.transfers[id]
		if transfer == nil {
			continue
		}
		row := localStateTransferState{
			InstallSessionID: transfer.GetInstallSessionId(),
			AssetID:          transfer.GetAssetId(),
			SessionKind:      normalizeTransferKind(transfer.GetSessionKind()),
			Phase:            transfer.GetPhase(),
			State:            normalizeTransferState(transfer.GetState()),
			BytesReceived:    transfer.GetBytesReceived(),
			BytesTotal:       transfer.GetBytesTotal(),
			SpeedBytesPerSec: transfer.GetSpeedBytesPerSec(),
			EtaSeconds:       transfer.GetEtaSeconds(),
			Message:          transfer.GetMessage(),
			ReasonCode:       transfer.GetReasonCode(),
			Retryable:        transfer.GetRetryable(),
			CreatedAt:        transfer.GetCreatedAt(),
			UpdatedAt:        transfer.GetUpdatedAt(),
		}
		if spec, exists := s.managedModelDownloadSpecs[transfer.GetInstallSessionId()]; exists {
			row.ManagedDownloadSpec = localStateManagedDownloadSpec(spec)
		}
		snapshot.Transfers = append(snapshot.Transfers, row)
	}

	for _, event := range s.audits {
		if event == nil {
			continue
		}
		snapshot.Audits = append(snapshot.Audits, localStateAuditState{
			ID:            event.GetId(),
			EventType:     event.GetEventType(),
			OccurredAt:    event.GetOccurredAt(),
			Source:        event.GetSource(),
			Modality:      event.GetModality(),
			ReasonCode:    event.GetReasonCode(),
			Detail:        event.GetDetail(),
			ModelID:       event.GetModelId(),
			Payload:       structToMap(event.GetPayload()),
			TraceID:       event.GetTraceId(),
			AppID:         event.GetAppId(),
			Domain:        event.GetDomain(),
			Operation:     event.GetOperation(),
			SubjectUserID: event.GetSubjectUserId(),
		})
		if len(snapshot.Audits) >= s.effectiveLocalAuditCapacity() {
			break
		}
	}

	hostProfileIDs := make([]string, 0, len(s.localEnvironmentHostProfiles))
	for id := range s.localEnvironmentHostProfiles {
		hostProfileIDs = append(hostProfileIDs, id)
	}
	sort.Strings(hostProfileIDs)
	for _, id := range hostProfileIDs {
		snapshot.LocalEnvironmentHostProfiles = append(snapshot.LocalEnvironmentHostProfiles, s.localEnvironmentHostProfiles[id])
	}

	selectedSourceKeys := make([]string, 0, len(s.localEnvironmentSelectedSources))
	for key := range s.localEnvironmentSelectedSources {
		selectedSourceKeys = append(selectedSourceKeys, key)
	}
	sort.Strings(selectedSourceKeys)
	for _, key := range selectedSourceKeys {
		snapshot.LocalEnvironmentSelectedSources = append(snapshot.LocalEnvironmentSelectedSources, s.localEnvironmentSelectedSources[key])
	}

	dependencyJobIDs := make([]string, 0, len(s.localEnvironmentDependencyJobs))
	for id := range s.localEnvironmentDependencyJobs {
		dependencyJobIDs = append(dependencyJobIDs, id)
	}
	sort.Strings(dependencyJobIDs)
	for _, id := range dependencyJobIDs {
		snapshot.LocalEnvironmentDependencyJobs = append(snapshot.LocalEnvironmentDependencyJobs, s.localEnvironmentDependencyJobs[id])
	}

	planContractKeys := make([]string, 0, len(s.localEnvironmentPlanDependencyContracts))
	for key := range s.localEnvironmentPlanDependencyContracts {
		planContractKeys = append(planContractKeys, key)
	}
	sort.Strings(planContractKeys)
	for _, key := range planContractKeys {
		snapshot.LocalEnvironmentPlanContracts = append(snapshot.LocalEnvironmentPlanContracts, s.localEnvironmentPlanDependencyContracts[key])
	}

	if err := saveLocalStateSnapshot(path, snapshot); err != nil {
		s.logger.Warn("persist local runtime state failed", "path", path, "error", err)
		return err
	}
	return nil
}
