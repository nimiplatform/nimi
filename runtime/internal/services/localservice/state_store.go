package localservice

import (
	"fmt"
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

// localStateTransferSpecVersion is the transfer row shape of the
// content-addressed acquisition owner. A row of another shape is an invalid
// record and is isolated per r111; it is never read through a fallback.
const localStateTransferSpecVersion = 2

type localStateTransferState struct {
	SpecVersion             int                                 `json:"specVersion"`
	InstallSessionID        string                              `json:"installSessionId"`
	AssetID                 string                              `json:"assetId"`
	SessionKind             string                              `json:"sessionKind"`
	Phase                   string                              `json:"phase"`
	State                   string                              `json:"state"`
	BytesReceived           int64                               `json:"bytesReceived"`
	BytesTotal              int64                               `json:"bytesTotal,omitempty"`
	BytesReused             int64                               `json:"bytesReused,omitempty"`
	BytesVerified           int64                               `json:"bytesVerified,omitempty"`
	SpeedBytesPerSec        int64                               `json:"speedBytesPerSec,omitempty"`
	EtaSeconds              int64                               `json:"etaSeconds,omitempty"`
	Message                 string                              `json:"message,omitempty"`
	ReasonCode              string                              `json:"reasonCode,omitempty"`
	Retryable               bool                                `json:"retryable,omitempty"`
	CreatedAt               string                              `json:"createdAt"`
	UpdatedAt               string                              `json:"updatedAt"`
	PlanID                  string                              `json:"planId,omitempty"`
	SourceLabel             string                              `json:"sourceLabel,omitempty"`
	Disposition             string                              `json:"disposition,omitempty"`
	RelatedInstallSessionID string                              `json:"relatedInstallSessionId,omitempty"`
	CleanupPending          bool                                `json:"cleanupPending,omitempty"`
	CancelRequested         bool                                `json:"cancelRequested,omitempty"`
	ManagedDownloadSpec     *localStateManagedModelDownloadSpec `json:"managedDownloadSpec,omitempty"`
	ImportSpec              *localTransferImportSpec            `json:"importSpec,omitempty"`
	CommitIntent            *localTransferCommitIntent          `json:"commitIntent,omitempty"`
	Result                  *localTransferResult                `json:"result,omitempty"`
	ObjectHolds             []modelObjectHold                   `json:"objectHolds,omitempty"`
}

func transferDispositionFromState(value string) runtimev1.LocalTransferDisposition {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "created":
		return runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_CREATED
	case "reused":
		return runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_REUSED
	default:
		return runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_UNSPECIFIED
	}
}

func transferDispositionToState(value runtimev1.LocalTransferDisposition) string {
	switch value {
	case runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_CREATED:
		return "created"
	case runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_REUSED:
		return "reused"
	default:
		return ""
	}
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
	// Archive is present only for a pinned release archive acquisition.
	Archive *localStateManagedModelDownloadArchive `json:"archive,omitempty"`
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
	s.transferPrivate = make(map[string]*localTransferPrivateState, len(snapshot.Transfers))
	for _, item := range snapshot.Transfers {
		summary := &runtimev1.LocalTransferSessionSummary{
			InstallSessionId:        item.InstallSessionID,
			AssetId:                 item.AssetID,
			SessionKind:             normalizeTransferKind(item.SessionKind),
			Phase:                   item.Phase,
			State:                   normalizeTransferState(item.State),
			BytesReceived:           item.BytesReceived,
			BytesTotal:              item.BytesTotal,
			BytesReused:             item.BytesReused,
			BytesVerified:           item.BytesVerified,
			SpeedBytesPerSec:        item.SpeedBytesPerSec,
			EtaSeconds:              item.EtaSeconds,
			Message:                 item.Message,
			ReasonCode:              item.ReasonCode,
			Retryable:               item.Retryable,
			CreatedAt:               item.CreatedAt,
			UpdatedAt:               item.UpdatedAt,
			PlanId:                  item.PlanID,
			SourceLabel:             item.SourceLabel,
			Disposition:             transferDispositionFromState(item.Disposition),
			RelatedInstallSessionId: item.RelatedInstallSessionID,
			CleanupPending:          item.CleanupPending,
		}
		if summary.GetInstallSessionId() == "" {
			continue
		}
		key := summary.GetInstallSessionId()
		s.transfers[key] = summary
		private := &localTransferPrivateState{cancelRequested: item.CancelRequested}
		if item.ImportSpec != nil {
			copied := *item.ImportSpec
			private.importSpec = &copied
		}
		if item.CommitIntent != nil {
			copied := *item.CommitIntent
			copied.Files = append([]modelDistributionFile(nil), item.CommitIntent.Files...)
			private.commitIntent = &copied
		}
		if item.Result != nil {
			copied := *item.Result
			private.result = &copied
		}
		s.transferPrivate[key] = private
		s.restoreModelObjectHolds(key, item.ObjectHolds)
		if item.ManagedDownloadSpec != nil {
			spec, specErr := managedDownloadedModelSpecFromLocalState(item.ManagedDownloadSpec)
			if specErr != nil {
				continue
			}
			s.managedModelDownloadSpecs[key] = spec
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
		item = localEnvironmentSelectedSourceRecordFromStorage(item, s.runtimeDataRoot)
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
		if err := s.persistStateLocked(); err != nil {
			s.mu.Unlock()
			return fmt.Errorf("persist healed local state snapshot: %w", err)
		}
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
			SpecVersion:             localStateTransferSpecVersion,
			InstallSessionID:        transfer.GetInstallSessionId(),
			AssetID:                 transfer.GetAssetId(),
			SessionKind:             normalizeTransferKind(transfer.GetSessionKind()),
			Phase:                   transfer.GetPhase(),
			State:                   normalizeTransferState(transfer.GetState()),
			BytesReceived:           transfer.GetBytesReceived(),
			BytesTotal:              transfer.GetBytesTotal(),
			BytesReused:             transfer.GetBytesReused(),
			BytesVerified:           transfer.GetBytesVerified(),
			SpeedBytesPerSec:        transfer.GetSpeedBytesPerSec(),
			EtaSeconds:              transfer.GetEtaSeconds(),
			Message:                 transfer.GetMessage(),
			ReasonCode:              transfer.GetReasonCode(),
			Retryable:               transfer.GetRetryable(),
			CreatedAt:               transfer.GetCreatedAt(),
			UpdatedAt:               transfer.GetUpdatedAt(),
			PlanID:                  transfer.GetPlanId(),
			SourceLabel:             transfer.GetSourceLabel(),
			Disposition:             transferDispositionToState(transfer.GetDisposition()),
			RelatedInstallSessionID: transfer.GetRelatedInstallSessionId(),
			CleanupPending:          transfer.GetCleanupPending(),
		}
		if spec, exists := s.managedModelDownloadSpecs[transfer.GetInstallSessionId()]; exists {
			row.ManagedDownloadSpec = localStateManagedDownloadSpec(spec)
		}
		if private := s.transferPrivate[transfer.GetInstallSessionId()]; private != nil {
			row.CancelRequested = private.cancelRequested
			if private.importSpec != nil {
				copied := *private.importSpec
				row.ImportSpec = &copied
			}
			if private.commitIntent != nil {
				copied := *private.commitIntent
				copied.Files = append([]modelDistributionFile(nil), private.commitIntent.Files...)
				row.CommitIntent = &copied
			}
			if private.result != nil {
				copied := *private.result
				row.Result = &copied
			}
		}
		row.ObjectHolds = s.modelObjectHoldsForTransfer(transfer.GetInstallSessionId())
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
		record := localEnvironmentSelectedSourceRecordForStorage(s.localEnvironmentSelectedSources[key], s.runtimeDataRoot)
		snapshot.LocalEnvironmentSelectedSources = append(snapshot.LocalEnvironmentSelectedSources, record)
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
