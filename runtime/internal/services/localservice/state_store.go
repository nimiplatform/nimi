package localservice

import (
	"encoding/json"
	"errors"
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
)

type localStateSnapshot struct {
	SchemaVersion int                       `json:"schemaVersion"`
	SavedAt       string                    `json:"savedAt"`
	Models        []localStateModelState    `json:"models"`
	Artifacts     []localStateArtifactState `json:"artifacts"`
	Services      []localStateServiceState  `json:"services"`
	Audits        []localStateAuditState    `json:"audits"`
}

type localStateModelState struct {
	LocalModelID         string            `json:"localModelId"`
	ModelID              string            `json:"modelId"`
	Capabilities         []string          `json:"capabilities"`
	Engine               string            `json:"engine"`
	Entry                string            `json:"entry"`
	License              string            `json:"license"`
	SourceRepo           string            `json:"sourceRepo"`
	SourceRev            string            `json:"sourceRevision"`
	Hashes               map[string]string `json:"hashes"`
	Endpoint             string            `json:"endpoint"`
	Status               int32             `json:"status"`
	InstalledAt          string            `json:"installedAt"`
	UpdatedAt            string            `json:"updatedAt"`
	HealthDetail         string            `json:"healthDetail"`
	EngineRuntimeMode    int32             `json:"engineRuntimeMode,omitempty"`
	LocalInvokeProfileID string            `json:"localInvokeProfileId,omitempty"`
	EngineConfig         map[string]any    `json:"engineConfig,omitempty"`
}

type localStateArtifactState struct {
	LocalArtifactID string            `json:"localArtifactId"`
	ArtifactID      string            `json:"artifactId"`
	Kind            int32             `json:"kind"`
	Engine          string            `json:"engine"`
	Entry           string            `json:"entry"`
	Files           []string          `json:"files"`
	License         string            `json:"license"`
	SourceRepo      string            `json:"sourceRepo"`
	SourceRev       string            `json:"sourceRevision"`
	Hashes          map[string]string `json:"hashes"`
	Status          int32             `json:"status"`
	InstalledAt     string            `json:"installedAt"`
	UpdatedAt       string            `json:"updatedAt"`
	HealthDetail    string            `json:"healthDetail"`
	Metadata        map[string]any    `json:"metadata,omitempty"`
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

func (s *Service) restoreState() {
	path := strings.TrimSpace(s.stateStorePath)
	if path == "" {
		return
	}
	snapshot, err := loadLocalStateSnapshot(path)
	if err != nil {
		s.logger.Warn("load local runtime state failed; fallback to empty state", "path", path, "error", err)
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	healedSnapshot := false

	modelRows := make([]*runtimev1.LocalModelRecord, 0, len(snapshot.Models))
	for _, item := range snapshot.Models {
		record := &runtimev1.LocalModelRecord{
			LocalModelId: item.LocalModelID,
			ModelId:      item.ModelID,
			Capabilities: normalizeStringSlice(item.Capabilities),
			Engine:       item.Engine,
			Entry:        item.Entry,
			License:      item.License,
			Source: &runtimev1.LocalModelSource{
				Repo:     item.SourceRepo,
				Revision: item.SourceRev,
			},
			Hashes:               cloneStringMap(item.Hashes),
			Endpoint:             item.Endpoint,
			Status:               runtimev1.LocalModelStatus(item.Status),
			InstalledAt:          item.InstalledAt,
			UpdatedAt:            item.UpdatedAt,
			HealthDetail:         item.HealthDetail,
			LocalInvokeProfileId: item.LocalInvokeProfileID,
			EngineConfig:         toStruct(item.EngineConfig),
		}
		if record.GetLocalModelId() == "" {
			continue
		}
		modelRows = append(modelRows, record)
		s.setModelRuntimeModeLocked(record.GetLocalModelId(), runtimev1.LocalEngineRuntimeMode(item.EngineRuntimeMode))
	}
	modelRows, modelsChanged := dedupeLocalModelRecords(modelRows)
	if modelsChanged {
		healedSnapshot = true
	}
	for _, record := range modelRows {
		s.models[record.GetLocalModelId()] = record
	}

	artifactRows := make([]*runtimev1.LocalArtifactRecord, 0, len(snapshot.Artifacts))
	for _, item := range snapshot.Artifacts {
		record := &runtimev1.LocalArtifactRecord{
			LocalArtifactId: item.LocalArtifactID,
			ArtifactId:      item.ArtifactID,
			Kind:            runtimev1.LocalArtifactKind(item.Kind),
			Engine:          item.Engine,
			Entry:           item.Entry,
			Files:           normalizeStringSlice(item.Files),
			License:         item.License,
			Source: &runtimev1.LocalArtifactSource{
				Repo:     item.SourceRepo,
				Revision: item.SourceRev,
			},
			Hashes:       cloneStringMap(item.Hashes),
			Status:       runtimev1.LocalArtifactStatus(item.Status),
			InstalledAt:  item.InstalledAt,
			UpdatedAt:    item.UpdatedAt,
			HealthDetail: item.HealthDetail,
			Metadata:     toStruct(item.Metadata),
		}
		if record.GetLocalArtifactId() == "" {
			continue
		}
		artifactRows = append(artifactRows, record)
	}
	artifactRows, artifactsChanged := dedupeLocalArtifactRecords(artifactRows)
	if artifactsChanged {
		healedSnapshot = true
	}
	for _, record := range artifactRows {
		s.artifacts[record.GetLocalArtifactId()] = record
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
	if healedSnapshot {
		s.persistStateLocked()
	}
}

func (s *Service) persistStateLocked() {
	path := strings.TrimSpace(s.stateStorePath)
	if path == "" {
		return
	}

	snapshot := localStateSnapshot{
		SchemaVersion: 1,
		SavedAt:       time.Now().UTC().Format(time.RFC3339Nano),
		Models:        make([]localStateModelState, 0, len(s.models)),
		Artifacts:     make([]localStateArtifactState, 0, len(s.artifacts)),
		Services:      make([]localStateServiceState, 0, len(s.services)),
		Audits:        make([]localStateAuditState, 0, len(s.audits)),
	}

	modelIDs := make([]string, 0, len(s.models))
	for id := range s.models {
		modelIDs = append(modelIDs, id)
	}
	sort.Strings(modelIDs)
	for _, id := range modelIDs {
		model := s.models[id]
		if model == nil {
			continue
		}
		snapshot.Models = append(snapshot.Models, localStateModelState{
			LocalModelID:         model.GetLocalModelId(),
			ModelID:              model.GetModelId(),
			Capabilities:         append([]string(nil), model.GetCapabilities()...),
			Engine:               model.GetEngine(),
			Entry:                model.GetEntry(),
			License:              model.GetLicense(),
			SourceRepo:           model.GetSource().GetRepo(),
			SourceRev:            model.GetSource().GetRevision(),
			Hashes:               cloneStringMap(model.GetHashes()),
			Endpoint:             model.GetEndpoint(),
			Status:               int32(model.GetStatus()),
			InstalledAt:          model.GetInstalledAt(),
			UpdatedAt:            model.GetUpdatedAt(),
			HealthDetail:         model.GetHealthDetail(),
			EngineRuntimeMode:    int32(s.modelRuntimeModes[id]),
			LocalInvokeProfileID: model.GetLocalInvokeProfileId(),
			EngineConfig:         structToMap(model.GetEngineConfig()),
		})
	}

	artifactIDs := make([]string, 0, len(s.artifacts))
	for id := range s.artifacts {
		artifactIDs = append(artifactIDs, id)
	}
	sort.Strings(artifactIDs)
	for _, id := range artifactIDs {
		artifact := s.artifacts[id]
		if artifact == nil {
			continue
		}
		snapshot.Artifacts = append(snapshot.Artifacts, localStateArtifactState{
			LocalArtifactID: artifact.GetLocalArtifactId(),
			ArtifactID:      artifact.GetArtifactId(),
			Kind:            int32(artifact.GetKind()),
			Engine:          artifact.GetEngine(),
			Entry:           artifact.GetEntry(),
			Files:           append([]string(nil), artifact.GetFiles()...),
			License:         artifact.GetLicense(),
			SourceRepo:      artifact.GetSource().GetRepo(),
			SourceRev:       artifact.GetSource().GetRevision(),
			Hashes:          cloneStringMap(artifact.GetHashes()),
			Status:          int32(artifact.GetStatus()),
			InstalledAt:     artifact.GetInstalledAt(),
			UpdatedAt:       artifact.GetUpdatedAt(),
			HealthDetail:    artifact.GetHealthDetail(),
			Metadata:        structToMap(artifact.GetMetadata()),
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
		Models:    []localStateModelState{},
		Artifacts: []localStateArtifactState{},
		Services:  []localStateServiceState{},
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
