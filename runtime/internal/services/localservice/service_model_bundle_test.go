package localservice

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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

func writeManagedRuntimeLocalStateForTest(t *testing.T, statePath string, localModelID string, modelID string, logicalModelID string, manifestPath string, entry string, status runtimev1.LocalAssetStatus) {
	t.Helper()
	snapshot := localStateSnapshot{
		SchemaVersion: localStateSchemaVersion,
		SavedAt:       nowISO(),
		Assets: []localStateAssetState{{
			LocalAssetID:   localModelID,
			AssetID:        modelID,
			Kind:           0,
			Capabilities:   []string{"chat"},
			Engine:         "llama",
			Entry:          entry,
			SourceRepo:     "file://" + filepath.ToSlash(manifestPath),
			SourceRev:      "local",
			Status:         int32(status),
			InstalledAt:    nowISO(),
			UpdatedAt:      nowISO(),
			HealthDetail:   `probe request failed: Get "http://127.0.0.1:51234/v1/models": dial tcp 127.0.0.1:51234: connect: connection refused`,
			LogicalModelID: logicalModelID,
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

func TestListLocalModelsDoesNotNormalizeManagedUnhealthyRecord(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	statePath := filepath.Join(t.TempDir(), "local-state.json")
	localModelID := "01KMWJ7Z76YY5QA4QJ35M5ECXM"
	modelID := "local/local-import/Qwen3-4B-Q4_K_M"
	logicalModelID := "nimi/local-import-qwen3-4b-q4-k-m"
	entry := "Qwen3-4B-Q4_K_M.gguf"
	modelsRoot := filepath.Join(homeDir, "selected-nimi-data", "models")
	manifestPath := writeManagedGGUFBundleForTest(t, modelsRoot, logicalModelID, "local-import/Qwen3-4B-Q4_K_M", entry)
	writeManagedRuntimeLocalStateForTest(t, statePath, localModelID, modelID, logicalModelID, manifestPath, entry, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY)

	svc, err := New(newTestService(t).logger, nil, statePath, 0)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer func() { svc.Close() }()
	probeCalls := 0
	svc.endpointProbe = func(_ context.Context, _ string, endpoint string) endpointProbeResult {
		probeCalls++
		return endpointProbeResult{
			healthy:   false,
			responded: false,
			detail:    `probe request failed: Get "http://127.0.0.1:1234/v1/models": dial tcp 127.0.0.1:1234: connect: connection refused`,
			probeURL:  endpoint,
		}
	}
	setLocalModelsPathForTest(t, svc, modelsRoot)

	resp, err := svc.ListLocalAssets(context.Background(), &runtimev1.ListLocalAssetsRequest{})
	if err != nil {
		t.Fatalf("ListLocalModels: %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("models = %d", len(resp.GetAssets()))
	}
	if got := resp.GetAssets()[0].GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("status = %s detail=%q", got, resp.GetAssets()[0].GetHealthDetail())
	}
	if probeCalls != 0 {
		t.Fatalf("ListLocalAssets must not probe or normalize managed unhealthy records, got %d probe calls", probeCalls)
	}
	if detail := resp.GetAssets()[0].GetHealthDetail(); strings.Contains(detail, "managed local model available (cold)") {
		t.Fatalf("ListLocalAssets must not replace snapshot detail with cold availability, got %q", detail)
	}
}

func TestListLocalModelsDoesNotMaterializeHostProjection(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	statePath := filepath.Join(t.TempDir(), "local-state.json")
	localModelID := "01KMWJ7Z76YY5QA4QJ35M5ECXM"
	modelID := "local/local-import/Qwen3-4B-Q4_K_M"
	logicalModelID := "nimi/local-import-qwen3-4b-q4-k-m"
	entry := "Qwen3-4B-Q4_K_M.gguf"
	modelsRoot := filepath.Join(homeDir, "selected-nimi-data", "models")
	manifestPath := writeManagedGGUFBundleForTest(t, modelsRoot, logicalModelID, "local-import/Qwen3-4B-Q4_K_M", entry)
	writeManagedRuntimeLocalStateForTest(t, statePath, localModelID, modelID, logicalModelID, manifestPath, entry, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY)

	svc, err := New(newTestService(t).logger, nil, statePath, 0)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer func() { svc.Close() }()
	probeCalls := 0
	svc.endpointProbe = func(_ context.Context, _ string, endpoint string) endpointProbeResult {
		probeCalls++
		return endpointProbeResult{
			healthy:   false,
			responded: false,
			detail:    `probe request failed: Get "http://127.0.0.1:1234/v1/models": dial tcp 127.0.0.1:1234: connect: connection refused`,
			probeURL:  endpoint,
		}
	}
	setLocalModelsPathForTest(t, svc, modelsRoot)

	resp, err := svc.ListLocalAssets(context.Background(), &runtimev1.ListLocalAssetsRequest{})
	if err != nil {
		t.Fatalf("ListLocalModels: %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("models = %d", len(resp.GetAssets()))
	}
	if got := resp.GetAssets()[0].GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("status = %s detail=%q", got, resp.GetAssets()[0].GetHealthDetail())
	}
	if probeCalls != 0 {
		t.Fatalf("ListLocalAssets must not probe or heal managed runtime mode, got %d probe calls", probeCalls)
	}
}

func TestValidateManagedLocalAssetRecordRequiresCanonicalManifestSource(t *testing.T) {
	model := &runtimev1.LocalAssetRecord{
		Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
		Capabilities:   []string{"text.generate"},
		Engine:         "llama",
		Entry:          "model.gguf",
		LogicalModelId: "nimi/current-model",
		Source: &runtimev1.LocalAssetSource{
			Repo: "https://models.example/current-model",
		},
	}
	mode := runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED

	err := validateManagedLocalAssetRecord(model, mode)
	if err == nil {
		t.Fatal("expected non-canonical managed source record to fail closed")
	}
	if !strings.Contains(err.Error(), "must point to file://.../asset.manifest.json") {
		t.Fatalf("unexpected error: %v", err)
	}

	model.Source.Repo = "file://" + filepath.ToSlash(filepath.Join(t.TempDir(), "asset.manifest.json"))
	if err := validateManagedLocalAssetRecord(model, mode); err != nil {
		t.Fatalf("current canonical managed source record rejected: %v", err)
	}
}

func TestEnsureManagedLocalModelBundleReadyRejectsManagedSpeechBundleMissingDeclaredFile(t *testing.T) {
	svc := newTestService(t)

	model := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/kokoro-tts-model",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		entry:        "model.onnx",
		files:        []string{"model.onnx", "voices.json"},
	})
	writeManagedBundleFilesForTest(t, svc, model, []string{"model.onnx", "voices.json"}, map[string][]byte{
		"model.onnx": []byte("fake-onnx"),
	})

	_, _, err := svc.ensureManagedLocalModelBundleReady(context.Background(), svc.modelByID(model.GetLocalAssetId()))
	if err == nil {
		t.Fatal("expected managed speech bundle validation to fail-close")
	}
	if !strings.Contains(err.Error(), `managed bundle file "voices.json" missing`) {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestEnsureManagedLocalModelBundleReadyAcceptsManagedSpeechBundleWithDeclaredFiles(t *testing.T) {
	svc := newTestService(t)

	model := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/kokoro-tts-model",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		entry:        "model.onnx",
		files:        []string{"model.onnx", "voices.json"},
	})
	writeManagedBundleFilesForTest(t, svc, model, []string{"model.onnx", "voices.json"}, map[string][]byte{
		"model.onnx":  []byte("fake-onnx"),
		"voices.json": []byte(`{"voices":["af"]}`),
	})

	entryPath, repaired, err := svc.ensureManagedLocalModelBundleReady(context.Background(), svc.modelByID(model.GetLocalAssetId()))
	if err != nil {
		t.Fatalf("expected managed speech bundle to validate: %v", err)
	}
	if repaired {
		t.Fatal("expected no repair path for valid managed speech bundle")
	}
	if got := filepath.Base(entryPath); got != "model.onnx" {
		t.Fatalf("entry path = %q", entryPath)
	}
}
