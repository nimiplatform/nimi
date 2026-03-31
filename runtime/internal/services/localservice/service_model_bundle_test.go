package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const managedLocalTestEndpoint = "http://127.0.0.1:51234/v1"

func writeManagedGGUFBundleForTest(t *testing.T, modelsRoot string, logicalModelID string, modelID string, entry string) string {
	t.Helper()
	bundleDir := runtimeManagedResolvedModelDir(modelsRoot, logicalModelID)
	if err := os.MkdirAll(bundleDir, 0o755); err != nil {
		t.Fatalf("mkdir managed bundle dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(bundleDir, entry), validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write managed bundle entry: %v", err)
	}
	manifestPath := filepath.Join(bundleDir, "manifest.json")
	manifestRaw, err := json.Marshal(map[string]any{
		"model_id":         modelID,
		"logical_model_id": logicalModelID,
		"engine":           "llama",
		"entry":            entry,
		"capabilities":     []string{"chat"},
		"integrity_mode":   "local_unverified",
	})
	if err != nil {
		t.Fatalf("marshal managed manifest: %v", err)
	}
	if err := os.WriteFile(manifestPath, manifestRaw, 0o644); err != nil {
		t.Fatalf("write managed manifest: %v", err)
	}
	return manifestPath
}

func fakeGGUFHeaderOnlyForTest() []byte {
	buf := make([]byte, minManagedGGUFSizeBytes)
	copy(buf, []byte("GGUF\x03\x00\x00\x00"))
	buf[len(buf)-1] = 0x01
	return buf
}

func writeLegacyRuntimeLocalStateForTest(t *testing.T, statePath string, localModelID string, modelID string, entry string, status runtimev1.LocalModelStatus) {
	t.Helper()
	snapshot := localStateSnapshot{
		SchemaVersion: 1,
		SavedAt:       nowISO(),
		Models: []localStateModelState{{
			LocalModelID:      localModelID,
			ModelID:           modelID,
			Capabilities:      []string{"chat"},
			Engine:            "llama",
			Entry:             entry,
			SourceRepo:        "local-import/" + slugifyLocalModelID(modelID),
			SourceRev:         "local",
			Endpoint:          managedLocalTestEndpoint,
			Status:            int32(status),
			InstalledAt:       nowISO(),
			UpdatedAt:         nowISO(),
			HealthDetail:      `probe request failed: Get "http://127.0.0.1:51234/v1/models": dial tcp 127.0.0.1:51234: connect: connection refused`,
			EngineRuntimeMode: int32(runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED),
			LogicalModelID:    "local/" + modelID,
		}},
		Artifacts: []localStateArtifactState{},
		Services:  []localStateServiceState{},
		Transfers: []localStateTransferState{},
		Audits:    []localStateAuditState{},
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal local-state snapshot: %v", err)
	}
	if err := os.WriteFile(statePath, raw, 0o644); err != nil {
		t.Fatalf("write local-state snapshot: %v", err)
	}
}

func writeManagedRuntimeLocalStateForTest(t *testing.T, statePath string, localModelID string, modelID string, logicalModelID string, manifestPath string, entry string, status runtimev1.LocalModelStatus, mode runtimev1.LocalEngineRuntimeMode) {
	t.Helper()
	snapshot := localStateSnapshot{
		SchemaVersion: 1,
		SavedAt:       nowISO(),
		Models: []localStateModelState{{
			LocalModelID:      localModelID,
			ModelID:           modelID,
			Capabilities:      []string{"chat"},
			Engine:            "llama",
			Entry:             entry,
			SourceRepo:        "file://" + filepath.ToSlash(manifestPath),
			SourceRev:         "local",
			Endpoint:          managedLocalTestEndpoint,
			Status:            int32(status),
			InstalledAt:       nowISO(),
			UpdatedAt:         nowISO(),
			HealthDetail:      `probe request failed: Get "http://127.0.0.1:51234/v1/models": dial tcp 127.0.0.1:51234: connect: connection refused`,
			EngineRuntimeMode: int32(mode),
			LogicalModelID:    logicalModelID,
		}},
		Artifacts: []localStateArtifactState{},
		Services:  []localStateServiceState{},
		Transfers: []localStateTransferState{},
		Audits:    []localStateAuditState{},
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal managed local-state snapshot: %v", err)
	}
	if err := os.WriteFile(statePath, raw, 0o644); err != nil {
		t.Fatalf("write managed local-state snapshot: %v", err)
	}
}

func TestStartLocalModelRepairsCorruptedRuntimeManagedBundleFromDesktop(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe mocked healthy",
			probeURL:  endpoint,
			models:    []string{"local-import/Qwen3-4B-Q4_K_M"},
		}
	})
	modelsRoot := filepath.Join(homeDir, ".nimi", "data", "models")
	configPath := filepath.Join(homeDir, ".nimi", "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, configPath, true)

	sourcePath := filepath.Join(t.TempDir(), "Qwen3-4B-Q4_K_M.gguf")
	if err := os.WriteFile(sourcePath, validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write source model: %v", err)
	}

	imported, err := svc.ImportLocalModelFile(context.Background(), &runtimev1.ImportLocalModelFileRequest{
		FilePath:     sourcePath,
		Capabilities: []string{"chat"},
		Engine:       "llama",
		ModelName:    "Qwen3-4B-Q4_K_M",
	})
	if err != nil {
		t.Fatalf("ImportLocalModelFile: %v", err)
	}
	model := imported.GetModel()
	if model == nil {
		t.Fatal("expected imported model")
	}

	runtimeManifestPath := runtimeManagedResolvedModelManifestPath(modelsRoot, model.GetLogicalModelId())
	runtimeEntryPath := filepath.Join(filepath.Dir(runtimeManifestPath), model.GetEntry())
	if err := os.WriteFile(runtimeEntryPath, fakeGGUFHeaderOnlyForTest(), 0o644); err != nil {
		t.Fatalf("corrupt runtime entry: %v", err)
	}

	svc.mu.Lock()
	cloned := cloneLocalModel(svc.models[model.GetLocalModelId()])
	cloned.Source.Repo = "local-import/" + slugifyLocalModelID(model.GetModelId())
	sum := sha256.Sum256(validTestGGUF())
	cloned.Hashes = map[string]string{
		model.GetEntry(): "sha256:" + hex.EncodeToString(sum[:]),
	}
	svc.models[model.GetLocalModelId()] = cloned
	svc.persistStateLocked()
	svc.mu.Unlock()

	desktopDir := filepath.Join(homeDir, ".nimi", "data", "models", "resolved", filepath.FromSlash(model.GetLogicalModelId()))
	if err := os.MkdirAll(desktopDir, 0o755); err != nil {
		t.Fatalf("mkdir desktop bundle dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(desktopDir, model.GetEntry()), validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write desktop entry: %v", err)
	}
	manifest := map[string]any{
		"model_id":         model.GetModelId(),
		"logical_model_id": model.GetLogicalModelId(),
		"engine":           "llama",
		"entry":            model.GetEntry(),
		"capabilities":     []string{"chat"},
		"source": map[string]any{
			"repo":     "local-import/" + slugifyLocalModelID(model.GetModelId()),
			"revision": "local",
		},
		"integrity_mode": "local_unverified",
	}
	manifestRaw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("marshal desktop manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(desktopDir, "manifest.json"), manifestRaw, 0o644); err != nil {
		t.Fatalf("write desktop manifest: %v", err)
	}

	started, err := svc.StartLocalModel(context.Background(), &runtimev1.StartLocalModelRequest{
		LocalModelId: model.GetLocalModelId(),
	})
	if err != nil {
		t.Fatalf("StartLocalModel: %v", err)
	}
	if started.GetModel().GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
		t.Fatalf("status = %s", started.GetModel().GetStatus())
	}
	if err := validateManagedModelEntryFile(runtimeEntryPath); err != nil {
		t.Fatalf("expected repaired runtime entry, got %v", err)
	}
	runtimeManifestRepo := started.GetModel().GetSource().GetRepo()
	if !strings.HasPrefix(runtimeManifestRepo, "file://") || !strings.HasSuffix(runtimeManifestRepo, "/manifest.json") {
		t.Fatalf("source repo = %q", runtimeManifestRepo)
	}
	if _, err := os.Stat(configPath); err != nil {
		t.Fatalf("expected managed llama config after repair: %v", err)
	}
}

func TestStartLocalModelInvalidManagedBundleTransitionsUnhealthy(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe mocked healthy",
			probeURL:  endpoint,
			models:    []string{"local-import/Qwen3-4B-Q4_K_M"},
		}
	})
	modelsRoot := filepath.Join(homeDir, ".nimi", "data", "models")
	configPath := filepath.Join(homeDir, ".nimi", "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, configPath, true)

	sourcePath := filepath.Join(t.TempDir(), "Qwen3-4B-Q4_K_M.gguf")
	if err := os.WriteFile(sourcePath, validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write source model: %v", err)
	}

	imported, err := svc.ImportLocalModelFile(context.Background(), &runtimev1.ImportLocalModelFileRequest{
		FilePath:     sourcePath,
		Capabilities: []string{"chat"},
		Engine:       "llama",
		ModelName:    "Qwen3-4B-Q4_K_M",
	})
	if err != nil {
		t.Fatalf("ImportLocalModelFile: %v", err)
	}
	model := imported.GetModel()
	runtimeManifestPath := runtimeManagedResolvedModelManifestPath(modelsRoot, model.GetLogicalModelId())
	runtimeEntryPath := filepath.Join(filepath.Dir(runtimeManifestPath), model.GetEntry())
	if err := os.WriteFile(runtimeEntryPath, fakeGGUFHeaderOnlyForTest(), 0o644); err != nil {
		t.Fatalf("corrupt runtime entry: %v", err)
	}
	svc.mu.Lock()
	cloned := cloneLocalModel(svc.models[model.GetLocalModelId()])
	sum := sha256.Sum256(validTestGGUF())
	cloned.Hashes = map[string]string{
		model.GetEntry(): "sha256:" + hex.EncodeToString(sum[:]),
	}
	svc.models[model.GetLocalModelId()] = cloned
	svc.persistStateLocked()
	svc.mu.Unlock()

	started, err := svc.StartLocalModel(context.Background(), &runtimev1.StartLocalModelRequest{
		LocalModelId: model.GetLocalModelId(),
	})
	if err != nil {
		t.Fatalf("StartLocalModel: %v", err)
	}
	if started.GetModel().GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY {
		t.Fatalf("status = %s", started.GetModel().GetStatus())
	}
	if !strings.Contains(started.GetModel().GetHealthDetail(), "managed local model bundle invalid") {
		t.Fatalf("health detail = %q", started.GetModel().GetHealthDetail())
	}
}

func TestRestoreStateHealsLegacyManagedLocalImportRecord(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	statePath := filepath.Join(t.TempDir(), "local-state.json")
	localModelID := "01KMWJ7Z76YY5QA4QJ35M5ECXM"
	modelID := "local/local-import/Qwen3-4B-Q4_K_M"
	entry := "Qwen3-4B-Q4_K_M.gguf"
	writeLegacyRuntimeLocalStateForTest(t, statePath, localModelID, modelID, entry, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY)

	modelsRoot := filepath.Join(homeDir, ".nimi", "data", "models")
	manifestPath := writeManagedGGUFBundleForTest(t, modelsRoot, "nimi/local-import-qwen3-4b-q4-k-m", modelID, entry)

	svc := newTestServiceWithProbe(t, nil)
	svc.Close()

	restored, err := New(svc.logger, nil, statePath, 0)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer restored.Close()

	model := restored.modelByID(localModelID)
	if model == nil {
		t.Fatal("expected healed model")
	}
	if got := model.GetLogicalModelId(); got != "nimi/local-import-qwen3-4b-q4-k-m" {
		t.Fatalf("logicalModelId = %q", got)
	}
	if got := model.GetSource().GetRepo(); got != "file://"+filepath.ToSlash(manifestPath) {
		t.Fatalf("source repo = %q", got)
	}
}

func TestRestoreStateHealsLegacyManagedLocalImportRecordWithNormalizedManifestModelID(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	statePath := filepath.Join(t.TempDir(), "local-state.json")
	localModelID := "01KMWJ7Z76YY5QA4QJ35M5ECXM"
	recordModelID := "local/local-import/Qwen3-4B-Q4_K_M"
	manifestModelID := "local-import/Qwen3-4B-Q4_K_M"
	entry := "Qwen3-4B-Q4_K_M.gguf"
	writeLegacyRuntimeLocalStateForTest(t, statePath, localModelID, recordModelID, entry, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY)

	modelsRoot := filepath.Join(homeDir, ".nimi", "data", "models")
	manifestPath := writeManagedGGUFBundleForTest(t, modelsRoot, "nimi/local-import-qwen3-4b-q4-k-m", manifestModelID, entry)

	svc := newTestServiceWithProbe(t, nil)
	svc.Close()
	restored, err := New(svc.logger, nil, statePath, 0)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer restored.Close()

	model := restored.modelByID(localModelID)
	if model == nil {
		t.Fatal("expected healed model")
	}
	if got := model.GetSource().GetRepo(); got != "file://"+filepath.ToSlash(manifestPath) {
		t.Fatalf("source repo = %q", got)
	}
	if got := model.GetLogicalModelId(); got != "nimi/local-import-qwen3-4b-q4-k-m" {
		t.Fatalf("logicalModelId = %q", got)
	}
}

func TestStartLocalModelHealsLegacyRecordFromDesktopBundle(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	statePath := filepath.Join(t.TempDir(), "local-state.json")
	localModelID := "01KMWJ7Z76YY5QA4QJ35M5ECXM"
	modelID := "local/local-import/Qwen3-4B-Q4_K_M"
	entry := "Qwen3-4B-Q4_K_M.gguf"
	writeLegacyRuntimeLocalStateForTest(t, statePath, localModelID, modelID, entry, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY)
	writeManagedGGUFBundleForTest(t, filepath.Join(homeDir, ".nimi", "data", "models"), "nimi/local-import-qwen3-4b-q4-k-m", modelID, entry)

	svc, err := New(newTestService(t).logger, nil, statePath, 0)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer svc.Close()
	svc.endpointProbe = func(_ context.Context, _ string, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe mocked healthy",
			probeURL:  endpoint,
			models:    []string{"local-import/Qwen3-4B-Q4_K_M"},
		}
	}
	modelsRoot := filepath.Join(homeDir, ".nimi", "data", "models")
	configPath := filepath.Join(homeDir, ".nimi", "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, configPath, true)

	started, err := svc.StartLocalModel(context.Background(), &runtimev1.StartLocalModelRequest{LocalModelId: localModelID})
	if err != nil {
		t.Fatalf("StartLocalModel: %v", err)
	}
	if started.GetModel().GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
		t.Fatalf("status = %s", started.GetModel().GetStatus())
	}
	runtimeManifestPath := runtimeManagedResolvedModelManifestPath(modelsRoot, "nimi/local-import-qwen3-4b-q4-k-m")
	if got := started.GetModel().GetSource().GetRepo(); got != "file://"+filepath.ToSlash(runtimeManifestPath) {
		t.Fatalf("source repo = %q", got)
	}
	if _, err := os.Stat(configPath); err != nil {
		t.Fatalf("expected managed llama config: %v", err)
	}
}

func TestCheckLocalModelHealthHealsLegacyUnhealthyRecordToInstalled(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	statePath := filepath.Join(t.TempDir(), "local-state.json")
	localModelID := "01KMWJ7Z76YY5QA4QJ35M5ECXM"
	modelID := "local/local-import/Qwen3-4B-Q4_K_M"
	entry := "Qwen3-4B-Q4_K_M.gguf"
	writeLegacyRuntimeLocalStateForTest(t, statePath, localModelID, modelID, entry, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY)

	modelsRoot := filepath.Join(homeDir, ".nimi", "data", "models")
	writeManagedGGUFBundleForTest(t, modelsRoot, "nimi/local-import-qwen3-4b-q4-k-m", modelID, entry)

	svc, err := New(newTestService(t).logger, nil, statePath, 0)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer svc.Close()
	svc.endpointProbe = func(_ context.Context, _ string, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   false,
			responded: false,
			detail:    `probe request failed: Get "http://127.0.0.1:1234/v1/models": dial tcp 127.0.0.1:1234: connect: connection refused`,
			probeURL:  endpoint,
		}
	}
	configPath := filepath.Join(homeDir, ".nimi", "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, configPath, true)

	health, err := svc.CheckLocalModelHealth(context.Background(), &runtimev1.CheckLocalModelHealthRequest{
		LocalModelId: localModelID,
	})
	if err != nil {
		t.Fatalf("CheckLocalModelHealth: %v", err)
	}
	if len(health.GetModels()) != 1 {
		t.Fatalf("health models = %d", len(health.GetModels()))
	}
	if got := health.GetModels()[0].GetStatus(); got != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED {
		t.Fatalf("status = %s detail=%q", got, health.GetModels()[0].GetDetail())
	}
	if !strings.Contains(health.GetModels()[0].GetDetail(), "managed local model ready (not started)") {
		t.Fatalf("detail = %q", health.GetModels()[0].GetDetail())
	}
	if _, err := os.Stat(configPath); err != nil {
		t.Fatalf("expected managed llama config: %v", err)
	}
}

func TestListLocalModelsNormalizesManagedUnhealthyRecordToInstalled(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	statePath := filepath.Join(t.TempDir(), "local-state.json")
	localModelID := "01KMWJ7Z76YY5QA4QJ35M5ECXM"
	modelID := "local/local-import/Qwen3-4B-Q4_K_M"
	logicalModelID := "nimi/local-import-qwen3-4b-q4-k-m"
	entry := "Qwen3-4B-Q4_K_M.gguf"
	modelsRoot := filepath.Join(homeDir, ".nimi", "data", "models")
	manifestPath := writeManagedGGUFBundleForTest(t, modelsRoot, logicalModelID, "local-import/Qwen3-4B-Q4_K_M", entry)
	writeManagedRuntimeLocalStateForTest(t, statePath, localModelID, modelID, logicalModelID, manifestPath, entry, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED)

	svc, err := New(newTestService(t).logger, nil, statePath, 0)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer svc.Close()
	svc.endpointProbe = func(_ context.Context, _ string, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   false,
			responded: false,
			detail:    `probe request failed: Get "http://127.0.0.1:1234/v1/models": dial tcp 127.0.0.1:1234: connect: connection refused`,
			probeURL:  endpoint,
		}
	}
	configPath := filepath.Join(homeDir, ".nimi", "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, configPath, true)

	resp, err := svc.ListLocalModels(context.Background(), &runtimev1.ListLocalModelsRequest{})
	if err != nil {
		t.Fatalf("ListLocalModels: %v", err)
	}
	if len(resp.GetModels()) != 1 {
		t.Fatalf("models = %d", len(resp.GetModels()))
	}
	if got := resp.GetModels()[0].GetStatus(); got != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED {
		t.Fatalf("status = %s detail=%q", got, resp.GetModels()[0].GetHealthDetail())
	}
	if detail := resp.GetModels()[0].GetHealthDetail(); !strings.Contains(detail, "managed local model ready (not started)") {
		t.Fatalf("detail = %q", detail)
	}
}

func TestListLocalModelsHealsManagedAttachedRuntimeModeToInstalled(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	statePath := filepath.Join(t.TempDir(), "local-state.json")
	localModelID := "01KMWJ7Z76YY5QA4QJ35M5ECXM"
	modelID := "local/local-import/Qwen3-4B-Q4_K_M"
	logicalModelID := "nimi/local-import-qwen3-4b-q4-k-m"
	entry := "Qwen3-4B-Q4_K_M.gguf"
	modelsRoot := filepath.Join(homeDir, ".nimi", "data", "models")
	manifestPath := writeManagedGGUFBundleForTest(t, modelsRoot, logicalModelID, "local-import/Qwen3-4B-Q4_K_M", entry)
	writeManagedRuntimeLocalStateForTest(t, statePath, localModelID, modelID, logicalModelID, manifestPath, entry, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT)

	svc, err := New(newTestService(t).logger, nil, statePath, 0)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer svc.Close()
	svc.endpointProbe = func(_ context.Context, _ string, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   false,
			responded: false,
			detail:    `probe request failed: Get "http://127.0.0.1:1234/v1/models": dial tcp 127.0.0.1:1234: connect: connection refused`,
			probeURL:  endpoint,
		}
	}
	configPath := filepath.Join(homeDir, ".nimi", "runtime", "llama-models.yaml")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, configPath, true)

	resp, err := svc.ListLocalModels(context.Background(), &runtimev1.ListLocalModelsRequest{})
	if err != nil {
		t.Fatalf("ListLocalModels: %v", err)
	}
	if len(resp.GetModels()) != 1 {
		t.Fatalf("models = %d", len(resp.GetModels()))
	}
	if got := resp.GetModels()[0].GetStatus(); got != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED {
		t.Fatalf("status = %s detail=%q", got, resp.GetModels()[0].GetHealthDetail())
	}
	if mode := svc.modelRuntimeMode(localModelID); mode != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		t.Fatalf("runtime mode = %s", mode.String())
	}
}

func TestRepairManagedLocalModelBundleFromDesktopSkipsWhenPathsMatch(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	svc := newTestService(t)
	logicalModelID := "nimi/local-import-qwen3-4b-q4-k-m"

	model := &runtimev1.LocalModelRecord{
		LocalModelId:   "local_model_qwen",
		ModelId:        "local/local-import/Qwen3-4B-Q4_K_M",
		Engine:         "llama",
		Entry:          "Qwen3-4B-Q4_K_M.gguf",
		LogicalModelId: logicalModelID,
	}
	repaired, err := svc.repairManagedLocalModelBundleFromDesktop(model)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if repaired {
		t.Fatal("expected no-op when desktop and runtime models roots match")
	}
}

func TestHealLegacyManagedLocalImportRecordSkipsDesktopFallbackWhenPathsMatch(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	svc := newTestService(t)

	localModelID := "legacy_local_model"
	svc.mu.Lock()
	svc.models[localModelID] = &runtimev1.LocalModelRecord{
		LocalModelId:   localModelID,
		ModelId:        "local/local-import/Qwen3-4B_Q4_K_M",
		Capabilities:   []string{"chat"},
		Engine:         "llama",
		Entry:          "Qwen3-4B_Q4_K_M.gguf",
		Source:         &runtimev1.LocalModelSource{Repo: "local-import/local-import-qwen3-4b-q4-k-m", Revision: "local"},
		LogicalModelId: "local/local-import/Qwen3-4B_Q4_K_M",
	}
	svc.setModelRuntimeModeLocked(localModelID, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED)
	svc.persistStateLocked()
	svc.mu.Unlock()

	_, _, err := svc.healLegacyManagedLocalImportRecord(localModelID)
	if err == nil {
		t.Fatal("expected heal to fail when no managed bundle exists and desktop fallback is skipped")
	}
}
