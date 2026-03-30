package localservice

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	desktopLocalRuntimeStateRelPath         = ".nimi/data/state.json"
	desktopLocalRuntimeModelsRelPath        = ".nimi/data/models"
	desktopLocalRuntimeMigrationMarkRelPath = ".nimi/runtime/desktop-local-runtime-migrated.v1"
)

type desktopLocalRuntimeStateSnapshot struct {
	Models []desktopLocalRuntimeModelState `json:"models"`
	Audits []desktopLocalRuntimeAuditState `json:"audits"`
}

type desktopLocalRuntimeModelState struct {
	LocalModelID    string             `json:"localModelId"`
	ModelID         string             `json:"modelId"`
	LogicalModelID  string             `json:"logicalModelId"`
	Capabilities    []string           `json:"capabilities"`
	Engine          string             `json:"engine"`
	Entry           string             `json:"entry"`
	Files           []string           `json:"files"`
	License         string             `json:"license"`
	Source          desktopLocalSource `json:"source"`
	Hashes          map[string]string  `json:"hashes"`
	Endpoint        string             `json:"endpoint"`
	Status          string             `json:"status"`
	InstalledAt     string             `json:"installedAt"`
	UpdatedAt       string             `json:"updatedAt"`
	HealthDetail    string             `json:"healthDetail"`
	ArtifactRoles   []string           `json:"artifactRoles"`
	PreferredEngine string             `json:"preferredEngine"`
	FallbackEngines []string           `json:"fallbackEngines"`
	EngineConfig    map[string]any     `json:"engineConfig"`
}

type desktopLocalSource struct {
	Repo     string `json:"repo"`
	Revision string `json:"revision"`
}

type desktopLocalRuntimeAuditState struct {
	ID           string         `json:"id"`
	EventType    string         `json:"eventType"`
	OccurredAt   string         `json:"occurredAt"`
	ModelID      string         `json:"modelId"`
	LocalModelID string         `json:"localModelId"`
	Payload      map[string]any `json:"payload"`
}

func (s *Service) migrateDesktopLocalRuntimeState() error {
	markerPath := resolveDesktopLocalRuntimeMigrationMarkerPath()
	if strings.TrimSpace(markerPath) == "" {
		return nil
	}
	if _, err := os.Stat(markerPath); err == nil {
		return nil
	} else if err != nil && !os.IsNotExist(err) {
		s.logger.Warn("desktop local runtime migration marker check failed", "path", markerPath, "error", err)
		return nil
	}

	snapshotPath := resolveDesktopLocalRuntimeStatePath()
	snapshot, err := loadDesktopLocalRuntimeStateSnapshot(snapshotPath)
	if err != nil {
		s.logger.Warn("desktop local runtime migration snapshot load failed", "path", snapshotPath, "error", err)
		return nil
	}
	if len(snapshot.Models) == 0 && len(snapshot.Audits) == 0 {
		if err := writeDesktopLocalRuntimeMigrationMarker(markerPath); err != nil {
			s.logger.Warn("desktop local runtime migration marker write failed", "path", markerPath, "error", err)
		}
		return nil
	}

	modelsRoot := resolveLocalModelsPath(s.localModelsPath)
	desktopModelsRoot := resolveDesktopLocalRuntimeModelsPath()
	changed := false

	s.mu.Lock()
	defer s.mu.Unlock()

	for _, row := range snapshot.Models {
		record, mode, migrateChanged, err := s.migrateDesktopModelStateLocked(row, desktopModelsRoot, modelsRoot)
		if err != nil {
			return err
		}
		if record == nil {
			continue
		}
		s.models[record.GetLocalModelId()] = cloneLocalModel(record)
		s.setModelRuntimeModeLocked(record.GetLocalModelId(), mode)
		changed = changed || migrateChanged
	}

	if len(snapshot.Audits) > 0 {
		existing := make(map[string]struct{}, len(s.audits))
		for _, event := range s.audits {
			if event == nil {
				continue
			}
			existing[strings.TrimSpace(event.GetId())] = struct{}{}
		}
		for _, row := range snapshot.Audits {
			id := strings.TrimSpace(row.ID)
			if id == "" {
				id = "audit_" + ulid.Make().String()
			}
			if _, ok := existing[id]; ok {
				continue
			}
			s.audits = append(s.audits, &runtimev1.LocalAuditEvent{
				Id:           id,
				EventType:    strings.TrimSpace(row.EventType),
				OccurredAt:   strings.TrimSpace(row.OccurredAt),
				Source:       "desktop-migration",
				ModelId:      strings.TrimSpace(row.ModelID),
				LocalModelId: strings.TrimSpace(row.LocalModelID),
				Payload:      toStruct(row.Payload),
			})
			existing[id] = struct{}{}
			changed = true
			if len(s.audits) >= s.effectiveLocalAuditCapacity() {
				break
			}
		}
	}

	if changed {
		s.persistStateLocked()
	}
	if err := writeDesktopLocalRuntimeMigrationMarker(markerPath); err != nil {
		s.logger.Warn("desktop local runtime migration marker write failed", "path", markerPath, "error", err)
	}
	return nil
}

func (s *Service) migrateDesktopModelStateLocked(
	row desktopLocalRuntimeModelState,
	desktopModelsRoot string,
	runtimeModelsRoot string,
) (*runtimev1.LocalModelRecord, runtimev1.LocalEngineRuntimeMode, bool, error) {
	modelID := strings.TrimSpace(row.ModelID)
	engine := strings.TrimSpace(row.Engine)
	if modelID == "" || engine == "" {
		return nil, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_UNSPECIFIED, false, nil
	}
	if migratedModelStatus(row.Status) == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
		return nil, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_UNSPECIFIED, false, nil
	}
	for _, existing := range s.models {
		if existing == nil || existing.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
			continue
		}
		if localModelIdentityKey(existing.GetModelId(), existing.GetEngine()) == localModelIdentityKey(modelID, engine) {
			return nil, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_UNSPECIFIED, false, nil
		}
	}

	logicalModelID := strings.TrimSpace(row.LogicalModelID)
	if logicalModelID == "" {
		logicalModelID = filepath.ToSlash(filepath.Join("nimi", slugifyLocalModelID(modelID)))
	}
	destManifestPath, _, err := migrateDesktopResolvedModelBundle(logicalModelID, desktopModelsRoot, runtimeModelsRoot)
	if err != nil {
		return nil, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_UNSPECIFIED, false, err
	}
	mode := migratedRuntimeModeForEngine(engine)
	engineConfig, err := structFromMap(row.EngineConfig)
	if err != nil {
		return nil, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_UNSPECIFIED, false, err
	}
	now := nowISO()
	localModelID := strings.TrimSpace(row.LocalModelID)
	if localModelID == "" {
		localModelID = ulid.Make().String()
	}
	record := &runtimev1.LocalModelRecord{
		LocalModelId:    localModelID,
		ModelId:         modelID,
		Capabilities:    normalizeStringSlice(row.Capabilities),
		Engine:          engine,
		Entry:           strings.TrimSpace(row.Entry),
		License:         defaultString(strings.TrimSpace(row.License), "unknown"),
		Source:          &runtimev1.LocalModelSource{Repo: "file://" + filepath.ToSlash(destManifestPath), Revision: defaultString(strings.TrimSpace(row.Source.Revision), "migrated-from-desktop")},
		Hashes:          cloneStringMap(row.Hashes),
		Endpoint:        storedEndpointForRuntimeMode(mode, strings.TrimSpace(row.Endpoint), s.managedEndpointForEngineLocked(engine)),
		Status:          migratedModelStatus(row.Status),
		InstalledAt:     defaultString(strings.TrimSpace(row.InstalledAt), now),
		UpdatedAt:       defaultString(strings.TrimSpace(row.UpdatedAt), now),
		HealthDetail:    migratedHealthDetail(row.HealthDetail),
		EngineConfig:    engineConfig,
		LogicalModelId:  logicalModelID,
		ArtifactRoles:   normalizeStringSlice(row.ArtifactRoles),
		PreferredEngine: strings.TrimSpace(row.PreferredEngine),
		FallbackEngines: normalizePublicFallbackEngines(row.FallbackEngines),
		BundleState:     runtimev1.LocalBundleState_LOCAL_BUNDLE_STATE_READY,
		WarmState:       runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD,
	}
	if len(record.GetCapabilities()) == 0 {
		record.Capabilities = []string{"chat"}
	}
	return record, mode, true, nil
}

func migratedRuntimeModeForEngine(engine string) runtimev1.LocalEngineRuntimeMode {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "llama", "media", "speech", "sidecar":
		return runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED
	default:
		return runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT
	}
}

func migratedModelStatus(value string) runtimev1.LocalModelStatus {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "removed":
		return runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED
	case "unhealthy":
		return runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY
	default:
		return runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED
	}
}

func migratedHealthDetail(detail string) string {
	trimmed := strings.TrimSpace(detail)
	if trimmed != "" {
		return "migrated from desktop local runtime: " + trimmed
	}
	return "migrated from desktop local runtime"
}

func migrateDesktopResolvedModelBundle(logicalModelID string, desktopModelsRoot string, runtimeModelsRoot string) (string, bool, error) {
	normalizedLogical := strings.Trim(strings.TrimSpace(logicalModelID), "/")
	if normalizedLogical == "" {
		return "", false, fmt.Errorf("desktop migration logical model id required")
	}
	srcDir := filepath.Join(desktopModelsRoot, "resolved", filepath.FromSlash(normalizedLogical))
	srcManifestPath := filepath.Join(srcDir, "manifest.json")
	if _, err := os.Stat(srcManifestPath); err != nil {
		return "", false, err
	}
	destDir := filepath.Join(runtimeModelsRoot, "resolved", filepath.FromSlash(normalizedLogical))
	destManifestPath := filepath.Join(destDir, "manifest.json")
	if _, err := os.Stat(destManifestPath); err == nil {
		return destManifestPath, false, nil
	}
	if err := copyDirRecursive(srcDir, destDir); err != nil {
		return "", false, err
	}
	return destManifestPath, true, nil
}

func copyDirRecursive(srcDir string, destDir string) error {
	return filepath.WalkDir(srcDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		targetPath := filepath.Join(destDir, rel)
		if d.IsDir() {
			return os.MkdirAll(targetPath, 0o755)
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			linkTarget, err := os.Readlink(path)
			if err != nil {
				return err
			}
			if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
				return err
			}
			_ = os.Remove(targetPath)
			return os.Symlink(linkTarget, targetPath)
		}
		return copyFile(path, targetPath, info.Mode().Perm())
	})
}

func copyFile(srcPath string, destPath string, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return err
	}
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()
	dest, err := os.OpenFile(destPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, perm)
	if err != nil {
		return err
	}
	defer dest.Close()
	_, err = io.Copy(dest, src)
	return err
}

func loadDesktopLocalRuntimeStateSnapshot(path string) (desktopLocalRuntimeStateSnapshot, error) {
	result := desktopLocalRuntimeStateSnapshot{
		Models: []desktopLocalRuntimeModelState{},
		Audits: []desktopLocalRuntimeAuditState{},
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
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

func resolveDesktopLocalRuntimeStatePath() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, desktopLocalRuntimeStateRelPath)
}

func resolveDesktopLocalRuntimeModelsPath() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, desktopLocalRuntimeModelsRelPath)
}

func resolveDesktopLocalRuntimeMigrationMarkerPath() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, desktopLocalRuntimeMigrationMarkRelPath)
}

func writeDesktopLocalRuntimeMigrationMarker(path string) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte("desktop-local-runtime-migrated\n"), 0o600)
}

func structFromMap(value map[string]any) (*structpb.Struct, error) {
	if len(value) == 0 {
		return nil, nil
	}
	cloned := cloneAnyMap(value)
	for key, raw := range cloned {
		if text := strings.TrimSpace(valueAsString(raw)); strings.EqualFold(key, "repo") && strings.HasPrefix(text, "file://") {
			if parsed, err := url.Parse(text); err == nil && parsed.Path != "" {
				cloned[key] = "file://" + filepath.ToSlash(parsed.Path)
			}
		}
	}
	return structpb.NewStruct(cloned)
}
