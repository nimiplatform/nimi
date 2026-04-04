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
	"google.golang.org/protobuf/types/known/structpb"
)

func writeManagedGGUFBundleForTest(t *testing.T, modelsRoot string, logicalModelID string, modelID string, entry string) string {
	t.Helper()
	bundleDir := runtimeManagedResolvedModelDir(modelsRoot, logicalModelID)
	if err := os.MkdirAll(bundleDir, 0o755); err != nil {
		t.Fatalf("mkdir managed bundle dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(bundleDir, entry), validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write managed bundle entry: %v", err)
	}
	manifestPath := filepath.Join(bundleDir, "asset.manifest.json")
	manifestRaw, err := json.Marshal(map[string]any{
		"asset_id":         modelID,
		"kind":             "chat",
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
	return buf
}

func writeLegacyRuntimeLocalStateForTest(t *testing.T, statePath string, localModelID string, modelID string, entry string, status runtimev1.LocalAssetStatus) {
	t.Helper()
	snapshot := localStateSnapshot{
		SchemaVersion: localStateSchemaVersion,
		SavedAt:       nowISO(),
		Assets: []localStateAssetState{{
			LocalAssetID:      localModelID,
			AssetID:           modelID,
			Kind:              0,
			Capabilities:      []string{"chat"},
			Engine:            "llama",
			Entry:             entry,
			SourceRepo:        "local-import/" + slugifyLocalModelID(modelID),
			SourceRev:         "local",
			Status:            int32(status),
			InstalledAt:       nowISO(),
			UpdatedAt:         nowISO(),
			HealthDetail:      `probe request failed: Get "http://127.0.0.1:51234/v1/models": dial tcp 127.0.0.1:51234: connect: connection refused`,
			EngineRuntimeMode: int32(runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED),
			LogicalModelID:    "local/" + modelID,
		}},
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

func writeManagedRuntimeLocalStateForTest(t *testing.T, statePath string, localModelID string, modelID string, logicalModelID string, manifestPath string, entry string, status runtimev1.LocalAssetStatus, mode runtimev1.LocalEngineRuntimeMode) {
	t.Helper()
	snapshot := localStateSnapshot{
		SchemaVersion: localStateSchemaVersion,
		SavedAt:       nowISO(),
		Assets: []localStateAssetState{{
			LocalAssetID:      localModelID,
			AssetID:           modelID,
			Kind:              0,
			Capabilities:      []string{"chat"},
			Engine:            "llama",
			Entry:             entry,
			SourceRepo:        "file://" + filepath.ToSlash(manifestPath),
			SourceRev:         "local",
			Status:            int32(status),
			InstalledAt:       nowISO(),
			UpdatedAt:         nowISO(),
			HealthDetail:      `probe request failed: Get "http://127.0.0.1:51234/v1/models": dial tcp 127.0.0.1:51234: connect: connection refused`,
			EngineRuntimeMode: int32(mode),
			LogicalModelID:    logicalModelID,
		}},
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

func TestStartLocalModelRejectsLegacyManagedBundleWithoutDesktopRepair(t *testing.T) {
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

	imported, err := svc.ImportLocalAssetFile(context.Background(), &runtimev1.ImportLocalAssetFileRequest{
		FilePath:     sourcePath,
		Capabilities: []string{"chat"},
		Engine:       "llama",
		AssetName:    "Qwen3-4B-Q4_K_M",
	})
	if err != nil {
		t.Fatalf("ImportLocalModelFile: %v", err)
	}
	model := imported.GetAsset()
	if model == nil {
		t.Fatal("expected imported model")
	}

	runtimeManifestPath := runtimeManagedAssetManifestPath(modelsRoot, model.GetLogicalModelId())
	runtimeEntryPath := filepath.Join(filepath.Dir(runtimeManifestPath), model.GetEntry())
	if err := os.WriteFile(runtimeEntryPath, fakeGGUFHeaderOnlyForTest(), 0o644); err != nil {
		t.Fatalf("corrupt runtime entry: %v", err)
	}

	svc.mu.Lock()
	cloned := cloneLocalAsset(svc.assets[model.GetLocalAssetId()])
	cloned.Source.Repo = "local-import/" + slugifyLocalModelID(model.GetAssetId())
	sum := sha256.Sum256(validTestGGUF())
	cloned.Hashes = map[string]string{
		model.GetEntry(): "sha256:" + hex.EncodeToString(sum[:]),
	}
	svc.assets[model.GetLocalAssetId()] = cloned
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
		"asset_id":         model.GetAssetId(),
		"kind":             "chat",
		"logical_model_id": model.GetLogicalModelId(),
		"engine":           "llama",
		"entry":            model.GetEntry(),
		"capabilities":     []string{"chat"},
		"source": map[string]any{
			"repo":     "local-import/" + slugifyLocalModelID(model.GetAssetId()),
			"revision": "local",
		},
		"integrity_mode": "local_unverified",
	}
	manifestRaw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("marshal desktop manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(desktopDir, "asset.manifest.json"), manifestRaw, 0o644); err != nil {
		t.Fatalf("write desktop manifest: %v", err)
	}

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: model.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("StartLocalModel: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("status = %s", started.GetAsset().GetStatus())
	}
	if detail := started.GetAsset().GetHealthDetail(); !strings.Contains(detail, "legacy local-import record is unsupported") {
		t.Fatalf("health detail = %q", detail)
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

	imported, err := svc.ImportLocalAssetFile(context.Background(), &runtimev1.ImportLocalAssetFileRequest{
		FilePath:     sourcePath,
		Capabilities: []string{"chat"},
		Engine:       "llama",
		AssetName:    "Qwen3-4B-Q4_K_M",
	})
	if err != nil {
		t.Fatalf("ImportLocalModelFile: %v", err)
	}
	model := imported.GetAsset()
	runtimeManifestPath := runtimeManagedAssetManifestPath(modelsRoot, model.GetLogicalModelId())
	runtimeEntryPath := filepath.Join(filepath.Dir(runtimeManifestPath), model.GetEntry())
	if err := os.WriteFile(runtimeEntryPath, fakeGGUFHeaderOnlyForTest(), 0o644); err != nil {
		t.Fatalf("corrupt runtime entry: %v", err)
	}
	svc.mu.Lock()
	cloned := cloneLocalAsset(svc.assets[model.GetLocalAssetId()])
	sum := sha256.Sum256(validTestGGUF())
	cloned.Hashes = map[string]string{
		model.GetEntry(): "sha256:" + hex.EncodeToString(sum[:]),
	}
	svc.assets[model.GetLocalAssetId()] = cloned
	svc.persistStateLocked()
	svc.mu.Unlock()

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: model.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("StartLocalModel: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("status = %s", started.GetAsset().GetStatus())
	}
	if !strings.Contains(started.GetAsset().GetHealthDetail(), "managed local model bundle invalid") {
		t.Fatalf("health detail = %q", started.GetAsset().GetHealthDetail())
	}
}

func TestRestoreStateDoesNotHealLegacyManagedLocalImportRecord(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	statePath := filepath.Join(t.TempDir(), "local-state.json")
	localModelID := "01KMWJ7Z76YY5QA4QJ35M5ECXM"
	modelID := "local/local-import/Qwen3-4B-Q4_K_M"
	entry := "Qwen3-4B-Q4_K_M.gguf"
	writeLegacyRuntimeLocalStateForTest(t, statePath, localModelID, modelID, entry, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY)

	modelsRoot := filepath.Join(homeDir, ".nimi", "data", "models")
	writeManagedGGUFBundleForTest(t, modelsRoot, "nimi/local-import-qwen3-4b-q4-k-m", modelID, entry)

	svc := newTestServiceWithProbe(t, nil)
	svc.Close()

	restored, err := New(svc.logger, nil, statePath, 0)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer restored.Close()

	model := restored.modelByID(localModelID)
	if model == nil {
		t.Fatal("expected legacy model to remain present until explicit cleanup")
	}
	if got := model.GetLogicalModelId(); got != "local/"+modelID {
		t.Fatalf("logicalModelId = %q", got)
	}
	if got := model.GetSource().GetRepo(); got != "local-import/"+slugifyLocalModelID(modelID) {
		t.Fatalf("source repo = %q", got)
	}
}

func TestRestoreStateDoesNotHealLegacyManagedLocalImportRecordWithNormalizedManifestModelID(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	statePath := filepath.Join(t.TempDir(), "local-state.json")
	localModelID := "01KMWJ7Z76YY5QA4QJ35M5ECXM"
	recordModelID := "local/local-import/Qwen3-4B-Q4_K_M"
	manifestModelID := "local-import/Qwen3-4B-Q4_K_M"
	entry := "Qwen3-4B-Q4_K_M.gguf"
	writeLegacyRuntimeLocalStateForTest(t, statePath, localModelID, recordModelID, entry, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY)

	modelsRoot := filepath.Join(homeDir, ".nimi", "data", "models")
	writeManagedGGUFBundleForTest(t, modelsRoot, "nimi/local-import-qwen3-4b-q4-k-m", manifestModelID, entry)

	svc := newTestServiceWithProbe(t, nil)
	svc.Close()
	restored, err := New(svc.logger, nil, statePath, 0)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer restored.Close()

	model := restored.modelByID(localModelID)
	if model == nil {
		t.Fatal("expected legacy model to remain present until explicit cleanup")
	}
	if got := model.GetSource().GetRepo(); got != "local-import/"+slugifyLocalModelID(recordModelID) {
		t.Fatalf("source repo = %q", got)
	}
	if got := model.GetLogicalModelId(); got != "local/"+recordModelID {
		t.Fatalf("logicalModelId = %q", got)
	}
}

func TestStartLocalModelRejectsLegacyRecordFromDesktopBundle(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	statePath := filepath.Join(t.TempDir(), "local-state.json")
	localModelID := "01KMWJ7Z76YY5QA4QJ35M5ECXM"
	modelID := "local/local-import/Qwen3-4B-Q4_K_M"
	entry := "Qwen3-4B-Q4_K_M.gguf"
	writeLegacyRuntimeLocalStateForTest(t, statePath, localModelID, modelID, entry, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY)
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

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{LocalAssetId: localModelID})
	if err != nil {
		t.Fatalf("StartLocalModel: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("status = %s", started.GetAsset().GetStatus())
	}
	if detail := started.GetAsset().GetHealthDetail(); !strings.Contains(detail, "legacy local-import record is unsupported") {
		t.Fatalf("health detail = %q", detail)
	}
	if _, err := os.Stat(configPath); !os.IsNotExist(err) {
		t.Fatalf("expected no managed llama config after hard-cut rejection, stat err=%v", err)
	}
}

func TestCheckLocalModelHealthRejectsLegacyUnhealthyRecord(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	statePath := filepath.Join(t.TempDir(), "local-state.json")
	localModelID := "01KMWJ7Z76YY5QA4QJ35M5ECXM"
	modelID := "local/local-import/Qwen3-4B-Q4_K_M"
	entry := "Qwen3-4B-Q4_K_M.gguf"
	writeLegacyRuntimeLocalStateForTest(t, statePath, localModelID, modelID, entry, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY)

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

	resp, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{
		LocalAssetId: localModelID,
	})
	if err != nil {
		t.Fatalf("CheckLocalModelHealth(legacy_record): %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("health assets = %d", len(resp.GetAssets()))
	}
	if got := resp.GetAssets()[0].GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("health status = %s", got)
	}
	if _, statErr := os.Stat(configPath); !os.IsNotExist(statErr) {
		t.Fatalf("expected no managed llama config after hard-cut rejection, stat err=%v", statErr)
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
	writeManagedRuntimeLocalStateForTest(t, statePath, localModelID, modelID, logicalModelID, manifestPath, entry, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED)

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

	resp, err := svc.ListLocalAssets(context.Background(), &runtimev1.ListLocalAssetsRequest{})
	if err != nil {
		t.Fatalf("ListLocalModels: %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("models = %d", len(resp.GetAssets()))
	}
	if got := resp.GetAssets()[0].GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("status = %s detail=%q", got, resp.GetAssets()[0].GetHealthDetail())
	}
	if got := resp.GetAssets()[0].GetWarmState(); got != runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD {
		t.Fatalf("warm_state = %s", got)
	}
	if detail := resp.GetAssets()[0].GetHealthDetail(); !strings.Contains(detail, "managed local model available (cold)") {
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
	writeManagedRuntimeLocalStateForTest(t, statePath, localModelID, modelID, logicalModelID, manifestPath, entry, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT)

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

	resp, err := svc.ListLocalAssets(context.Background(), &runtimev1.ListLocalAssetsRequest{})
	if err != nil {
		t.Fatalf("ListLocalModels: %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("models = %d", len(resp.GetAssets()))
	}
	if got := resp.GetAssets()[0].GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("status = %s detail=%q", got, resp.GetAssets()[0].GetHealthDetail())
	}
	if got := resp.GetAssets()[0].GetWarmState(); got != runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD {
		t.Fatalf("warm_state = %s", got)
	}
	if mode := svc.modelRuntimeMode(localModelID); mode != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		t.Fatalf("runtime mode = %s", mode.String())
	}
}

func TestManagedMediaImageHealingNormalizesSupervisedEndpoint(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	svc := newTestService(t)
	modelsRoot := filepath.Join(homeDir, ".nimi", "data", "models")
	modelID := "local-import/z_image_turbo-Q4_K"
	logicalModelID := "nimi/local-import-z-image-turbo-q4-k"
	entry := "z_image_turbo-Q4_K.gguf"
	manifestPath := filepath.Join(modelsRoot, "resolved", filepath.FromSlash(logicalModelID), "asset.manifest.json")
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("mkdir manifest dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(manifestPath), entry), validImageTestGGUF(), 0o644); err != nil {
		t.Fatalf("write image bundle entry: %v", err)
	}
	if err := os.WriteFile(manifestPath, []byte(`{"asset_id":"`+modelID+`","kind":"image","engine":"media","entry":"`+entry+`","capabilities":["image"],"engine_config":{"backend":"stablediffusion-ggml"}}`), 0o644); err != nil {
		t.Fatalf("write image manifest: %v", err)
	}
	engineConfig, err := structpb.NewStruct(map[string]any{
		"backend": "stablediffusion-ggml",
	})
	if err != nil {
		t.Fatalf("build engine config: %v", err)
	}

	localModelID := "01TESTIMAGEHEALING"
	svc.mu.Lock()
	svc.assets[localModelID] = &runtimev1.LocalAssetRecord{
		LocalAssetId:    localModelID,
		AssetId:         modelID,
		Kind:            runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		Capabilities:    []string{"image"},
		Engine:          "media",
		Entry:           entry,
		License:         "unknown",
		Source:          &runtimev1.LocalAssetSource{Repo: "file://" + filepath.ToSlash(manifestPath), Revision: "local"},
		Status:          runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		InstalledAt:     nowISO(),
		UpdatedAt:       nowISO(),
		HealthDetail:    "managed local model registration missing: managed diffusers backend unavailable",
		Endpoint:        defaultLocalEndpoint,
		LogicalModelId:  logicalModelID,
		PreferredEngine: "llama",
		EngineConfig:    engineConfig,
	}
	svc.setModelRuntimeModeLocked(localModelID, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED)
	svc.persistStateLocked()
	svc.mu.Unlock()

	healed, changed, err := svc.healManagedSupervisedRuntimeMode(localModelID)
	if err != nil {
		t.Fatalf("heal managed image endpoint: %v", err)
	}
	if !changed {
		t.Fatal("expected managed image endpoint heal to change the record")
	}
	if got := healed.GetEndpoint(); got != defaultMediaEndpoint {
		t.Fatalf("endpoint = %q, want %q", got, defaultMediaEndpoint)
	}
	if got := svc.modelByID(localModelID).GetEndpoint(); got != defaultMediaEndpoint {
		t.Fatalf("stored endpoint = %q, want %q", got, defaultMediaEndpoint)
	}
}

func TestEnsureManagedLocalModelBundleReadyRejectsLegacyManagedLocalImportRecord(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	svc := newTestService(t)

	localModelID := "legacy_local_model"
	svc.mu.Lock()
	svc.assets[localModelID] = &runtimev1.LocalAssetRecord{
		LocalAssetId:   localModelID,
		AssetId:        "local/local-import/Qwen3-4B_Q4_K_M",
		Capabilities:   []string{"chat"},
		Engine:         "llama",
		Entry:          "Qwen3-4B_Q4_K_M.gguf",
		Source:         &runtimev1.LocalAssetSource{Repo: "local-import/local-import-qwen3-4b-q4-k-m", Revision: "local"},
		LogicalModelId: "local/local-import/Qwen3-4B_Q4_K_M",
	}
	svc.setModelRuntimeModeLocked(localModelID, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED)
	svc.persistStateLocked()
	svc.mu.Unlock()

	_, _, err := svc.ensureManagedLocalModelBundleReady(context.Background(), svc.modelByID(localModelID))
	if err == nil {
		t.Fatal("expected legacy local-import record to fail-close")
	}
	if !strings.Contains(err.Error(), "legacy local-import record is unsupported") {
		t.Fatalf("unexpected error: %v", err)
	}
}
