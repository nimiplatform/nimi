package localservice

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	defaultLocalStateRelativePath = ".nimi/runtime/local-state.json"
	localStateSchemaVersion       = 2
)

// localStateSnapshot is the v2 state format. Unified assets[] replaces
// the legacy models[] + artifacts[] dual structure. SchemaVersion must be 2.
// Runtime does NOT read v1 state — hard cut per plan §0.
type localStateSnapshot struct {
	SchemaVersion int                       `json:"schemaVersion"`
	SavedAt       string                    `json:"savedAt"`
	Assets        []localStateAssetState    `json:"assets"`
	Services      []localStateServiceState  `json:"services"`
	Transfers     []localStateTransferState `json:"transfers,omitempty"`
	Audits        []localStateAuditState    `json:"audits,omitempty"`
}

// localStateAssetState is the unified persistence row for all asset kinds.
type localStateAssetState struct {
	LocalAssetID      string            `json:"localAssetId"`
	AssetID           string            `json:"assetId"`
	Kind              int32             `json:"kind"`
	Engine            string            `json:"engine"`
	Entry             string            `json:"entry"`
	Files             []string          `json:"files,omitempty"`
	License           string            `json:"license"`
	SourceRepo        string            `json:"sourceRepo"`
	SourceRev         string            `json:"sourceRevision"`
	Hashes            map[string]string `json:"hashes"`
	Status            int32             `json:"status"`
	InstalledAt       string            `json:"installedAt"`
	UpdatedAt         string            `json:"updatedAt"`
	HealthDetail      string            `json:"healthDetail"`
	EngineRuntimeMode int32             `json:"engineRuntimeMode,omitempty"`
	Endpoint          string            `json:"endpoint,omitempty"`
	// Runnable-only fields
	Capabilities         []string       `json:"capabilities,omitempty"`
	LogicalModelID       string         `json:"logicalModelId,omitempty"`
	Family               string         `json:"family,omitempty"`
	ArtifactRoles        []string       `json:"artifactRoles,omitempty"`
	PreferredEngine      string         `json:"preferredEngine,omitempty"`
	FallbackEngines      []string       `json:"fallbackEngines,omitempty"`
	BundleState          int32          `json:"bundleState,omitempty"`
	WarmState            int32          `json:"warmState,omitempty"`
	HostRequirements     map[string]any `json:"hostRequirements,omitempty"`
	LocalInvokeProfileID string         `json:"localInvokeProfileId,omitempty"`
	EngineConfig         map[string]any `json:"engineConfig,omitempty"`
	// Passive-only fields
	Metadata map[string]any `json:"metadata,omitempty"`
}

type localStateServiceState struct {
	ServiceID         string   `json:"serviceId"`
	Title             string   `json:"title"`
	Engine            string   `json:"engine"`
	ArtifactType      string   `json:"artifactType"`
	Endpoint          string   `json:"endpoint"`
	Capabilities      []string `json:"capabilities"`
	LocalModelID      string   `json:"localModelId"`
	Status            int32    `json:"status"`
	Detail            string   `json:"detail"`
	InstalledAt       string   `json:"installedAt"`
	UpdatedAt         string   `json:"updatedAt"`
	EngineRuntimeMode int32    `json:"engineRuntimeMode,omitempty"`
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
	LocalModelID  string         `json:"localModelId"`
	Payload       map[string]any `json:"payload"`
	TraceID       string         `json:"traceId,omitempty"`
	AppID         string         `json:"appId,omitempty"`
	Domain        string         `json:"domain,omitempty"`
	Operation     string         `json:"operation,omitempty"`
	SubjectUserID string         `json:"subjectUserId,omitempty"`
}

type localStateTransferState struct {
	InstallSessionID string `json:"installSessionId"`
	AssetID          string `json:"assetId"`
	LocalAssetID     string `json:"localAssetId,omitempty"`
	SessionKind      string `json:"sessionKind"`
	Phase            string `json:"phase"`
	State            string `json:"state"`
	BytesReceived    int64  `json:"bytesReceived"`
	BytesTotal       int64  `json:"bytesTotal,omitempty"`
	SpeedBytesPerSec int64  `json:"speedBytesPerSec,omitempty"`
	EtaSeconds       int64  `json:"etaSeconds,omitempty"`
	Message          string `json:"message,omitempty"`
	ReasonCode       string `json:"reasonCode,omitempty"`
	Retryable        bool   `json:"retryable,omitempty"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
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
	snapshot, err := loadLocalStateSnapshot(path)
	if err != nil {
		return err
	}

	s.mu.Lock()
	healedSnapshot := false

	assetRows := make([]*runtimev1.LocalAssetRecord, 0, len(snapshot.Assets))
	for _, item := range snapshot.Assets {
		record := &runtimev1.LocalAssetRecord{
			LocalAssetId: item.LocalAssetID,
			AssetId:      item.AssetID,
			Kind:         runtimev1.LocalAssetKind(item.Kind),
			Engine:       item.Engine,
			Entry:        item.Entry,
			Files:        normalizeStringSlice(item.Files),
			License:      item.License,
			Source: &runtimev1.LocalAssetSource{
				Repo:     item.SourceRepo,
				Revision: item.SourceRev,
			},
			Hashes:               cloneStringMap(item.Hashes),
			Status:               runtimev1.LocalAssetStatus(item.Status),
			InstalledAt:          item.InstalledAt,
			UpdatedAt:            item.UpdatedAt,
			HealthDetail:         item.HealthDetail,
			Endpoint:             item.Endpoint,
			Capabilities:         normalizeStringSlice(item.Capabilities),
			LogicalModelId:       item.LogicalModelID,
			Family:               item.Family,
			ArtifactRoles:        normalizeStringSlice(item.ArtifactRoles),
			PreferredEngine:      item.PreferredEngine,
			FallbackEngines:      normalizeStringSlice(item.FallbackEngines),
			BundleState:          runtimev1.LocalBundleState(item.BundleState),
			WarmState:            runtimev1.LocalWarmState(item.WarmState),
			HostRequirements:     hostRequirementsFromMap(item.HostRequirements),
			LocalInvokeProfileId: item.LocalInvokeProfileID,
			EngineConfig:         toStruct(item.EngineConfig),
			Metadata:             toStruct(item.Metadata),
		}
		if record.GetLocalAssetId() == "" {
			continue
		}
		assetRows = append(assetRows, record)
		s.setModelRuntimeModeLocked(record.GetLocalAssetId(), runtimev1.LocalEngineRuntimeMode(item.EngineRuntimeMode))
	}
	assetRows, changed := dedupeLocalAssetRecords(assetRows)
	if changed {
		healedSnapshot = true
	}
	for _, record := range assetRows {
		s.assets[record.GetLocalAssetId()] = record
	}

	for _, item := range snapshot.Services {
		record := &runtimev1.LocalServiceDescriptor{
			ServiceId:    item.ServiceID,
			Title:        item.Title,
			Engine:       item.Engine,
			ArtifactType: item.ArtifactType,
			Endpoint:     item.Endpoint,
			Capabilities: normalizeStringSlice(item.Capabilities),
			LocalModelId: item.LocalModelID,
			Status:       runtimev1.LocalServiceStatus(item.Status),
			Detail:       item.Detail,
			InstalledAt:  item.InstalledAt,
			UpdatedAt:    item.UpdatedAt,
		}
		if record.GetServiceId() == "" {
			continue
		}
		s.services[record.GetServiceId()] = record
		s.setServiceRuntimeModeLocked(record.GetServiceId(), runtimev1.LocalEngineRuntimeMode(item.EngineRuntimeMode))
	}

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
			LocalModelId:  item.LocalModelID,
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
	s.transferControls = make(map[string]*localTransferControl)
	for _, item := range snapshot.Transfers {
		summary := &runtimev1.LocalTransferSessionSummary{
			InstallSessionId: item.InstallSessionID,
			AssetId:          item.AssetID,
			LocalAssetId:     item.LocalAssetID,
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
		if !isTerminalTransferState(summary.GetState()) && summary.GetSessionKind() == localTransferKindDownload {
			s.transferControls[summary.GetInstallSessionId()] = newLocalTransferControl()
		}
	}
	if healedSnapshot {
		s.persistStateLocked()
	}
	s.mu.Unlock()
	return nil
}

func (s *Service) persistStateLocked() {
	path := strings.TrimSpace(s.stateStorePath)
	if path == "" {
		return
	}

	snapshot := localStateSnapshot{
		SchemaVersion: localStateSchemaVersion,
		SavedAt:       time.Now().UTC().Format(time.RFC3339Nano),
		Assets:        make([]localStateAssetState, 0, len(s.assets)),
		Services:      make([]localStateServiceState, 0, len(s.services)),
		Transfers:     make([]localStateTransferState, 0, len(s.transfers)),
		Audits:        make([]localStateAuditState, 0, len(s.audits)),
	}

	assetIDs := make([]string, 0, len(s.assets))
	for id := range s.assets {
		assetIDs = append(assetIDs, id)
	}
	sort.Strings(assetIDs)
	for _, id := range assetIDs {
		asset := s.assets[id]
		if asset == nil {
			continue
		}
		snapshot.Assets = append(snapshot.Assets, localStateAssetState{
			LocalAssetID:         asset.GetLocalAssetId(),
			AssetID:              asset.GetAssetId(),
			Kind:                 int32(asset.GetKind()),
			Engine:               asset.GetEngine(),
			Entry:                asset.GetEntry(),
			Files:                append([]string(nil), asset.GetFiles()...),
			License:              asset.GetLicense(),
			SourceRepo:           asset.GetSource().GetRepo(),
			SourceRev:            asset.GetSource().GetRevision(),
			Hashes:               cloneStringMap(asset.GetHashes()),
			Status:               int32(asset.GetStatus()),
			InstalledAt:          asset.GetInstalledAt(),
			UpdatedAt:            asset.GetUpdatedAt(),
			HealthDetail:         asset.GetHealthDetail(),
			EngineRuntimeMode:    int32(s.assetRuntimeModes[id]),
			Endpoint:             asset.GetEndpoint(),
			Capabilities:         append([]string(nil), asset.GetCapabilities()...),
			LogicalModelID:       asset.GetLogicalModelId(),
			Family:               asset.GetFamily(),
			ArtifactRoles:        append([]string(nil), asset.GetArtifactRoles()...),
			PreferredEngine:      asset.GetPreferredEngine(),
			FallbackEngines:      append([]string(nil), asset.GetFallbackEngines()...),
			BundleState:          int32(asset.GetBundleState()),
			WarmState:            int32(asset.GetWarmState()),
			HostRequirements:     hostRequirementsToMap(asset.GetHostRequirements()),
			LocalInvokeProfileID: asset.GetLocalInvokeProfileId(),
			EngineConfig:         structToMap(asset.GetEngineConfig()),
			Metadata:             structToMap(asset.GetMetadata()),
		})
	}

	serviceIDs := make([]string, 0, len(s.services))
	for id := range s.services {
		serviceIDs = append(serviceIDs, id)
	}
	sort.Strings(serviceIDs)
	for _, id := range serviceIDs {
		service := s.services[id]
		if service == nil {
			continue
		}
		snapshot.Services = append(snapshot.Services, localStateServiceState{
			ServiceID:         service.GetServiceId(),
			Title:             service.GetTitle(),
			Engine:            service.GetEngine(),
			ArtifactType:      service.GetArtifactType(),
			Endpoint:          service.GetEndpoint(),
			Capabilities:      append([]string(nil), service.GetCapabilities()...),
			LocalModelID:      service.GetLocalModelId(),
			Status:            int32(service.GetStatus()),
			Detail:            service.GetDetail(),
			InstalledAt:       service.GetInstalledAt(),
			UpdatedAt:         service.GetUpdatedAt(),
			EngineRuntimeMode: int32(s.serviceRuntimeModes[id]),
		})
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
		snapshot.Transfers = append(snapshot.Transfers, localStateTransferState{
			InstallSessionID: transfer.GetInstallSessionId(),
			AssetID:          transfer.GetAssetId(),
			LocalAssetID:     transfer.GetLocalAssetId(),
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
		})
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
			LocalModelID:  event.GetLocalModelId(),
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

	if err := saveLocalStateSnapshot(path, snapshot); err != nil {
		s.logger.Warn("persist local runtime state failed", "path", path, "error", err)
	}
}

func loadLocalStateSnapshot(path string) (localStateSnapshot, error) {
	result := localStateSnapshot{
		Assets:    []localStateAssetState{},
		Services:  []localStateServiceState{},
		Transfers: []localStateTransferState{},
		Audits:    []localStateAuditState{},
	}

	payload, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return result, nil
		}
		return result, err
	}
	if len(payload) == 0 {
		return result, nil
	}
	if err := json.Unmarshal(payload, &result); err != nil {
		return result, err
	}
	if result.SchemaVersion != 0 && result.SchemaVersion != localStateSchemaVersion {
		return result, fmt.Errorf("unsupported local-state.json schemaVersion=%d (expected %d); delete local-state.json or run migration script", result.SchemaVersion, localStateSchemaVersion)
	}
	return result, nil
}

func saveLocalStateSnapshot(path string, snapshot localStateSnapshot) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	payload, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmpPath := path + ".tmp." + strconv.FormatInt(time.Now().UTC().UnixNano(), 10)
	if err := os.WriteFile(tmpPath, payload, 0o600); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

func hostRequirementsToMap(input *runtimev1.LocalHostRequirements) map[string]any {
	if input == nil {
		return nil
	}
	return map[string]any{
		"gpuRequired":           input.GetGpuRequired(),
		"pythonRuntimeRequired": input.GetPythonRuntimeRequired(),
		"supportedPlatforms":    append([]string(nil), input.GetSupportedPlatforms()...),
		"requiredBackends":      append([]string(nil), input.GetRequiredBackends()...),
	}
}

func hostRequirementsFromMap(input map[string]any) *runtimev1.LocalHostRequirements {
	if len(input) == 0 {
		return nil
	}
	requirements := &runtimev1.LocalHostRequirements{}
	if value, ok := input["gpuRequired"].(bool); ok {
		requirements.GpuRequired = value
	}
	if value, ok := input["pythonRuntimeRequired"].(bool); ok {
		requirements.PythonRuntimeRequired = value
	}
	if values, ok := input["supportedPlatforms"].([]any); ok {
		requirements.SupportedPlatforms = anySliceToStrings(values)
	}
	if values, ok := input["requiredBackends"].([]any); ok {
		requirements.RequiredBackends = anySliceToStrings(values)
	}
	return requirements
}

func anySliceToStrings(values []any) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			out = append(out, strings.TrimSpace(text))
		}
	}
	return out
}
