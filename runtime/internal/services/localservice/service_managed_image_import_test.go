package localservice

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestLocalImportManifestValidation(t *testing.T) {
	svc := newTestService(t)
	tmpDir := t.TempDir()
	svc.SetManagedLlamaRegistrationConfig(tmpDir, "", false)

	invalidPath := filepath.Join(tmpDir, "resolved", "nimi", "invalid", "asset.manifest.json")
	if err := os.MkdirAll(filepath.Dir(invalidPath), 0o755); err != nil {
		t.Fatalf("create invalid manifest dir: %v", err)
	}
	if err := os.WriteFile(invalidPath, []byte("{not-json"), 0o600); err != nil {
		t.Fatalf("write invalid manifest: %v", err)
	}
	_, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{ManifestPath: invalidPath})
	if err == nil {
		t.Fatalf("expected invalid manifest parse error")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.InvalidArgument || st.Message() != runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID.String() {
		t.Fatalf("unexpected invalid manifest error: %v", err)
	}

	schemaInvalidPath := filepath.Join(tmpDir, "resolved", "nimi", "schema-invalid", "asset.manifest.json")
	if err := os.MkdirAll(filepath.Dir(schemaInvalidPath), 0o755); err != nil {
		t.Fatalf("create schema invalid manifest dir: %v", err)
	}
	if err := os.WriteFile(schemaInvalidPath, []byte(`{"asset_id":"local/test","kind":"chat","engine":"llama","endpoint":"http://127.0.0.1:1234/v1","capabilities":"chat"}`), 0o600); err != nil {
		t.Fatalf("write schema invalid manifest: %v", err)
	}
	_, err = svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{ManifestPath: schemaInvalidPath})
	if err == nil {
		t.Fatalf("expected schema invalid manifest error")
	}
	st, _ = status.FromError(err)
	if st.Code() != codes.InvalidArgument || st.Message() != runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID.String() {
		t.Fatalf("unexpected schema invalid manifest error: %v", err)
	}

	validPath := filepath.Join(tmpDir, "resolved", "nimi", "import-manifest-ok", "asset.manifest.json")
	validManifest := map[string]any{
		"asset_id":                "local/import-manifest-ok",
		"kind":                    "chat",
		"logical_model_id":        "nimi/import-manifest-ok",
		"engine":                  "llama",
		"capabilities":            []string{"chat"},
		"entry":                   "./dist/index.js",
		"local_invoke_profile_id": "profile-chat-default",
		"endpoint":                "http://127.0.0.1:1234/v1",
		"source": map[string]any{
			"repo":     "nimiplatform/import-model",
			"revision": "main",
		},
	}
	validRaw, _ := json.Marshal(validManifest)
	if err := os.MkdirAll(filepath.Dir(validPath), 0o755); err != nil {
		t.Fatalf("create valid manifest dir: %v", err)
	}
	if err := os.WriteFile(validPath, validRaw, 0o600); err != nil {
		t.Fatalf("write valid manifest: %v", err)
	}
	resp, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{ManifestPath: validPath})
	if err != nil {
		t.Fatalf("import valid manifest: %v", err)
	}
	if resp.GetAsset().GetLocalInvokeProfileId() != "profile-chat-default" {
		t.Fatalf("local_invoke_profile_id should be imported from manifest")
	}

	legacyPath := filepath.Join(tmpDir, "resolved", "nimi", "legacy-import", "asset.manifest.json")
	legacyManifest := map[string]any{
		"model_id":         "local/legacy-import",
		"logical_model_id": "nimi/legacy-import",
		"engine":           "llama",
		"capabilities":     []string{"chat"},
		"entry":            "./dist/index.js",
	}
	legacyRaw, _ := json.Marshal(legacyManifest)
	if err := os.MkdirAll(filepath.Dir(legacyPath), 0o755); err != nil {
		t.Fatalf("create legacy manifest dir: %v", err)
	}
	if err := os.WriteFile(legacyPath, legacyRaw, 0o600); err != nil {
		t.Fatalf("write legacy manifest: %v", err)
	}
	_, err = svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{ManifestPath: legacyPath})
	if err == nil {
		t.Fatalf("expected legacy public manifest fields to fail-close")
	}
	st, _ = status.FromError(err)
	if st.Code() != codes.InvalidArgument || st.Message() != runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID.String() {
		t.Fatalf("unexpected legacy manifest error: %v", err)
	}
}

func TestLocalImportImageModelDefaultsToSupervisedOnLlamaSupportedHost(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")
	tmpDir := t.TempDir()
	svc.SetManagedLlamaRegistrationConfig(tmpDir, "", true)
	svc.SetManagedLlamaEndpoint("http://127.0.0.1:57510/v1")
	manifestPath := filepath.Join(tmpDir, "resolved", "nimi", "image-model", "asset.manifest.json")
	rawManifest, err := json.Marshal(map[string]any{
		"asset_id":         "local-import/z_image_turbo-Q4_K",
		"kind":             "image",
		"logical_model_id": "nimi/image-model",
		"engine":           "media",
		"capabilities":     []string{"image"},
		"entry":            "z_image_turbo-Q4_K.gguf",
		"engineConfig": map[string]any{
			"backend": "stablediffusion-ggml",
		},
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("create manifest dir: %v", err)
	}
	entryPath := filepath.Join(filepath.Dir(manifestPath), "z_image_turbo-Q4_K.gguf")
	if err := os.WriteFile(entryPath, validImageTestGGUF(), 0o600); err != nil {
		t.Fatalf("write entry file: %v", err)
	}
	if err := os.WriteFile(manifestPath, rawManifest, 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	resp, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{
		ManifestPath: manifestPath,
	})
	if err != nil {
		t.Fatalf("expected Windows GGUF manifest import without explicit endpoint to succeed, got %v", err)
	}
	if got := svc.modelRuntimeMode(resp.GetAsset().GetLocalAssetId()); got != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		t.Fatalf("expected supervised runtime mode, got %s", got)
	}
	current := svc.modelByID(resp.GetAsset().GetLocalAssetId())
	if current == nil {
		t.Fatal("expected imported asset to be stored")
	}
	if got := executionRuntimeEngineForModel(current); got != "media" {
		t.Fatalf("expected execution runtime engine media, got %q", got)
	}
	if got := managedRuntimeEngineForModel(current); got != "" {
		t.Fatalf("expected runtime-owned image control plane to expose no supervisor engine, got %q", got)
	}
}

func TestLocalImportImageModelSupportsAppleSiliconManagedImageHost(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	tmpDir := t.TempDir()
	svc.SetManagedLlamaRegistrationConfig(tmpDir, "", true)
	manifestPath := filepath.Join(tmpDir, "resolved", "nimi", "image-model-m4", "asset.manifest.json")
	rawManifest, err := json.Marshal(map[string]any{
		"asset_id":         "local-import/z_image_turbo-Q4_K",
		"kind":             "image",
		"logical_model_id": "nimi/image-model-m4",
		"engine":           "media",
		"capabilities":     []string{"image"},
		"entry":            "z_image_turbo-Q4_K.gguf",
		"engineConfig": map[string]any{
			"backend": "stablediffusion-ggml",
		},
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("create manifest dir: %v", err)
	}
	entryPath := filepath.Join(filepath.Dir(manifestPath), "z_image_turbo-Q4_K.gguf")
	if err := os.WriteFile(entryPath, validImageTestGGUF(), 0o600); err != nil {
		t.Fatalf("write entry file: %v", err)
	}
	if err := os.WriteFile(manifestPath, rawManifest, 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	_, err = svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{
		ManifestPath: manifestPath,
	})
	if err != nil {
		t.Fatalf("expected image import on Apple Silicon host to succeed, got %v", err)
	}
}

func TestLocalImportImageModelUnsupportedHostRegistersUnhealthyAsset(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "linux", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")
	tmpDir := t.TempDir()
	svc.SetManagedLlamaRegistrationConfig(tmpDir, "", true)
	manifestPath := filepath.Join(tmpDir, "resolved", "nimi", "image-model-linux", "asset.manifest.json")
	rawManifest, err := json.Marshal(map[string]any{
		"asset_id":         "local-import/z_image_turbo-Q4_K",
		"kind":             "image",
		"logical_model_id": "nimi/image-model-linux",
		"engine":           "media",
		"capabilities":     []string{"image"},
		"entry":            "z_image_turbo-Q4_K.gguf",
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("create manifest dir: %v", err)
	}
	entryPath := filepath.Join(filepath.Dir(manifestPath), "z_image_turbo-Q4_K.gguf")
	if err := os.WriteFile(entryPath, validImageTestGGUF(), 0o600); err != nil {
		t.Fatalf("write entry file: %v", err)
	}
	if err := os.WriteFile(manifestPath, rawManifest, 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	resp, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{
		ManifestPath: manifestPath,
	})
	if err != nil {
		t.Fatalf("expected unsupported-host image import to register unhealthy asset instead of failing, got %v", err)
	}
	if got := svc.modelRuntimeMode(resp.GetAsset().GetLocalAssetId()); got != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		t.Fatalf("expected supervised runtime mode, got %s", got)
	}
	if got := resp.GetAsset().GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("status mismatch: got=%s", got)
	}
	if detail := resp.GetAsset().GetHealthDetail(); !strings.Contains(detail, "no published runtime-owned managed image backend package") {
		t.Fatalf("expected compatibility detail, got %q", detail)
	}
}

func TestImportLocalAssetAutoDetectsMMProjAndGemma4ArchitectureWithoutManifestFiles(t *testing.T) {
	svc := newTestService(t)
	tmpDir := t.TempDir()
	svc.SetManagedLlamaRegistrationConfig(tmpDir, "", true)

	manifestPath := filepath.Join(tmpDir, "resolved", "nimi", "plain-import", "asset.manifest.json")
	if err := os.MkdirAll(filepath.Join(filepath.Dir(manifestPath), "weights"), 0o755); err != nil {
		t.Fatalf("create manifest dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(manifestPath), "weights", "model.gguf"), validGemma4TestGGUF(), 0o600); err != nil {
		t.Fatalf("write model entry: %v", err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(manifestPath), "mmproj-vision.gguf"), validTestGGUF(), 0o600); err != nil {
		t.Fatalf("write mmproj companion: %v", err)
	}
	rawManifest, err := json.Marshal(map[string]any{
		"asset_id":         "local/plain-import",
		"kind":             "chat",
		"logical_model_id": "nimi/plain-import",
		"engine":           "llama",
		"capabilities":     []string{"text.generate", "text.generate.vision"},
		"entry":            "weights/model.gguf",
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.WriteFile(manifestPath, rawManifest, 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	resp, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{
		ManifestPath: manifestPath,
	})
	if err != nil {
		t.Fatalf("import local asset: %v", err)
	}
	if got := resp.GetAsset().GetFamily(); got != "gemma" {
		t.Fatalf("family = %q, want gemma", got)
	}
	engineConfig := resp.GetAsset().GetEngineConfig().AsMap()
	llama, _ := engineConfig["llama"].(map[string]any)
	if got, _ := llama["mmproj"].(string); got != "resolved/nimi/plain-import/mmproj-vision.gguf" {
		t.Fatalf("engine_config.llama.mmproj = %q", got)
	}
}

func TestLocalStartManagedImageModelUsesSelectionAwareMediaEngineConfig(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe mocked healthy",
			probeURL:  endpoint,
		}
	})
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	tmpDir := t.TempDir()
	svc.SetManagedLlamaRegistrationConfig(tmpDir, "", true)
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)
	manifestPath := filepath.Join(tmpDir, "resolved", "nimi", "image-model-start", "asset.manifest.json")
	rawManifest, err := json.Marshal(map[string]any{
		"asset_id":         "local-import/z_image_turbo-Q4_K",
		"kind":             "image",
		"logical_model_id": "nimi/image-model-start",
		"engine":           "media",
		"capabilities":     []string{"image"},
		"entry":            "z_image_turbo-Q4_K.gguf",
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("create manifest dir: %v", err)
	}
	imageEntryPath := filepath.Join(filepath.Dir(manifestPath), "z_image_turbo-Q4_K.gguf")
	if err := os.WriteFile(imageEntryPath, validImageTestGGUF(), 0o600); err != nil {
		t.Fatalf("write entry file: %v", err)
	}
	if err := os.WriteFile(manifestPath, rawManifest, 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	imported, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{
		ManifestPath: manifestPath,
	})
	if err != nil {
		t.Fatalf("import image asset: %v", err)
	}
	if got := svc.modelRuntimeMode(imported.GetAsset().GetLocalAssetId()); got != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		t.Fatalf("expected supervised runtime mode, got %s", got)
	}
	current := svc.modelByID(imported.GetAsset().GetLocalAssetId())
	if current == nil {
		t.Fatal("expected imported asset to be stored")
	}
	selection := canonicalSupervisedImageSelectionForLocalAsset(current, collectDeviceProfile())
	if selection.ExecutionPlane != engine.EngineMedia {
		t.Fatalf("expected media execution plane, got control=%s execution=%s entry_id=%s detail=%q", selection.ControlPlane, selection.ExecutionPlane, selection.EntryID, selection.CompatibilityDetail)
	}
	if got := managedRuntimeEngineForModel(current); got != "" {
		t.Fatalf("expected runtime-owned image control plane to expose no supervisor engine, got %q", got)
	}
	if got := executionRuntimeEngineForModel(current); got != "media" {
		t.Fatalf("expected execution runtime engine media, got %q", got)
	}

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: imported.GetAsset().GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("start image asset: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED {
		t.Fatalf(
			"expected image asset to remain installed pending profile validation, got %s detail=%q",
			started.GetAsset().GetStatus(),
			started.GetAsset().GetHealthDetail(),
		)
	}
	if !strings.Contains(started.GetAsset().GetHealthDetail(), "backend validation pending") {
		t.Fatalf("expected pending validation detail, got %q", started.GetAsset().GetHealthDetail())
	}
	if mgr.startConfigCalls != 1 {
		t.Fatalf(
			"expected selection-aware engine start to be used once, got config_calls=%d plain_calls=%d plain_engines=%v last_engine=%q",
			mgr.startConfigCalls,
			mgr.startCalls,
			mgr.startEngines,
			mgr.lastStartEngine,
		)
	}
	if mgr.lastStartConfig.ImageSupervisedSelection == nil {
		t.Fatal("expected media engine start config to include canonical image selection")
	}
	if got := mgr.lastStartConfig.ImageSupervisedSelection.EntryID; got != "macos-apple-silicon-gguf" {
		t.Fatalf("unexpected image selection entry: %q", got)
	}
	if got := mgr.lastStartConfig.MediaMode; got != engine.MediaModeProxyExecution {
		t.Fatalf("expected explicit proxy media mode, got %q", got)
	}
}

func TestListLocalAssetsDoesNotLoadManagedImageInBackground(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	loadCalls := 0
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		loadCalls++
		return nil, nil
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-list-idle")
	cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())
	if _, err := svc.updateModelStatus(asset.GetLocalAssetId(), runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY, "seed unhealthy"); err != nil {
		t.Fatalf("seed unhealthy image status: %v", err)
	}

	resp, err := svc.ListLocalAssets(context.Background(), &runtimev1.ListLocalAssetsRequest{})
	if err != nil {
		t.Fatalf("ListLocalAssets: %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("expected one asset, got %d", len(resp.GetAssets()))
	}
	if loadCalls != 0 {
		t.Fatalf("expected list to avoid managed image load, got %d calls", loadCalls)
	}
}

func TestStartLocalAssetFailsClosedForUnsupportedSafetensorsNativeSelection(t *testing.T) {
	svc := newTestServiceWithProbe(t, nil)
	setLocalRuntimePlatformForTest(t, "linux", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")

	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)
	model := mustInstallUnsupportedSafetensorsNativeImageForTest(t, svc, "local/safetensors-native-start")

	_, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: model.GetLocalAssetId(),
	})
	if err == nil {
		t.Fatal("expected unsupported safetensors native start to fail-close")
	}
	assertGRPCReasonCode(t, err, "StartLocalAsset(unsupported safetensors native)", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	if !strings.Contains(err.Error(), "single-file safetensors image assets") {
		t.Fatalf("expected compatibility detail to surface, got %v", err)
	}
	if mgr.startConfigCalls != 0 || mgr.startCalls != 0 {
		t.Fatalf("unsupported safetensors native must not bootstrap managed engine, got config_calls=%d plain_calls=%d", mgr.startConfigCalls, mgr.startCalls)
	}

	updated := svc.modelByID(model.GetLocalAssetId())
	if updated == nil {
		t.Fatal("expected installed asset to remain available")
	}
	if updated.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("expected unsupported safetensors native asset to become unhealthy, got %s", updated.GetStatus())
	}
	if !strings.Contains(updated.GetHealthDetail(), "single-file safetensors image assets") {
		t.Fatalf("expected health detail to preserve compatibility detail, got %q", updated.GetHealthDetail())
	}
	if strings.Contains(strings.ToLower(updated.GetHealthDetail()), "attached endpoint") {
		t.Fatalf("unsupported safetensors native must not project to attached endpoint detail, got %q", updated.GetHealthDetail())
	}
}

func TestStartLocalAssetFailsClosedForUnsupportedImportedGGUFImage(t *testing.T) {
	svc := newTestServiceWithProbe(t, nil)
	setLocalRuntimePlatformForTest(t, "linux", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")

	tmpDir := t.TempDir()
	svc.SetManagedLlamaRegistrationConfig(tmpDir, "", true)
	manifestPath := filepath.Join(tmpDir, "resolved", "nimi", "image-model-linux-start", "asset.manifest.json")
	rawManifest, err := json.Marshal(map[string]any{
		"asset_id":         "local-import/z_image_turbo-Q4_K",
		"kind":             "image",
		"logical_model_id": "nimi/image-model-linux-start",
		"engine":           "media",
		"capabilities":     []string{"image"},
		"entry":            "z_image_turbo-Q4_K.gguf",
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("create manifest dir: %v", err)
	}
	imageEntryPath := filepath.Join(filepath.Dir(manifestPath), "z_image_turbo-Q4_K.gguf")
	if err := os.WriteFile(imageEntryPath, validImageTestGGUF(), 0o600); err != nil {
		t.Fatalf("write entry file: %v", err)
	}
	if err := os.WriteFile(manifestPath, rawManifest, 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	imported, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{
		ManifestPath: manifestPath,
	})
	if err != nil {
		t.Fatalf("import image asset: %v", err)
	}

	_, err = svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: imported.GetAsset().GetLocalAssetId(),
	})
	if err == nil {
		t.Fatal("expected unsupported imported image start to fail-close")
	}
	assertGRPCReasonCode(t, err, "StartLocalAsset(unsupported imported gguf image)", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	if !strings.Contains(err.Error(), "no published runtime-owned managed image backend package") {
		t.Fatalf("expected compatibility detail to surface, got %v", err)
	}

	updated := svc.modelByID(imported.GetAsset().GetLocalAssetId())
	if updated == nil {
		t.Fatal("expected imported asset to remain available")
	}
	if updated.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("expected unsupported imported image asset to stay unhealthy, got %s", updated.GetStatus())
	}
}

func TestStartLocalAssetFailsClosedWhenManagedImageBackendTargetUnavailable(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")

	tmpDir := t.TempDir()
	svc.SetManagedLlamaRegistrationConfig(tmpDir, "", true)
	svc.SetManagedMediaEndpoint("http://127.0.0.1:8321/v1")
	svc.SetManagedImageBackendConfig(false, "")
	mgr := &mockEngineManager{sharedAcceleratorDependencyStatus: &engine.SharedAcceleratorDependencyStatus{
		DependencyID: engine.NVIDIACUDAUserSpaceRuntimeDependencyID,
		State:        engine.SharedAcceleratorDependencyReadySystem,
		Source:       "compatible_system",
		Detail:       "nvidia_cuda_user_space_runtime state=ready_system source=compatible_system",
	}}
	svc.SetEngineManager(mgr)
	manifestPath := filepath.Join(tmpDir, "resolved", "nimi", "image-model-proxy-start", "asset.manifest.json")
	rawManifest, err := json.Marshal(map[string]any{
		"asset_id":         "local-import/z_image_turbo-Q4_K",
		"kind":             "image",
		"logical_model_id": "nimi/image-model-proxy-start",
		"engine":           "media",
		"capabilities":     []string{"image"},
		"entry":            "z_image_turbo-Q4_K.gguf",
		"source": map[string]any{
			"repo": "file://" + filepath.ToSlash(manifestPath),
		},
		"engine_config": map[string]any{
			"backend": "stablediffusion-ggml",
		},
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("create manifest dir: %v", err)
	}
	imageEntryPath := filepath.Join(filepath.Dir(manifestPath), "z_image_turbo-Q4_K.gguf")
	if err := os.WriteFile(imageEntryPath, validImageTestGGUF(), 0o600); err != nil {
		t.Fatalf("write entry file: %v", err)
	}
	if err := os.WriteFile(manifestPath, rawManifest, 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	_, err = svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{
		ManifestPath: manifestPath,
	})
	if err != nil {
		t.Fatalf("expected Windows GGUF image import to succeed before backend availability is checked, got %v", err)
	}

	models, listErr := svc.ListLocalAssets(context.Background(), &runtimev1.ListLocalAssetsRequest{})
	if listErr != nil {
		t.Fatalf("ListLocalAssets: %v", listErr)
	}
	if len(models.GetAssets()) != 1 {
		t.Fatalf("expected one imported asset, got %d", len(models.GetAssets()))
	}
	imported := models.GetAssets()[0]
	if got := svc.modelRuntimeMode(imported.GetLocalAssetId()); got != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		t.Fatalf("expected supervised runtime mode after import, got %s", got)
	}
	cacheManagedImageProfileForTest(t, svc, imported.GetLocalAssetId())
	mgr.startConfigCalls = 0
	mgr.startCalls = 0
	mgr.startEngines = nil
	mgr.startConfigs = nil
	mgr.lastStartEngine = ""
	mgr.lastStartConfig = engine.EngineConfig{}

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: imported.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("expected StartLocalAsset to return unhealthy asset state instead of transport error, got %v", err)
	}
	if got := started.GetAsset().GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("expected unhealthy asset state when managed image backend target is unavailable, got %s", got)
	}
	if !strings.Contains(started.GetAsset().GetHealthDetail(), "managed image backend target is unavailable") {
		t.Fatalf("expected backend target unavailable detail, got %q", started.GetAsset().GetHealthDetail())
	}
	if mgr.startConfigCalls != 1 || mgr.startCalls != 0 {
		t.Fatalf("expected selection-aware managed engine bootstrap attempt before fail-close, got config_calls=%d plain_calls=%d", mgr.startConfigCalls, mgr.startCalls)
	}
	if mgr.lastStartConfig.ImageSupervisedSelection == nil {
		t.Fatal("expected image selection to be forwarded into managed engine start config")
	}
	if got := mgr.lastStartConfig.ImageSupervisedSelection.EntryID; got != "windows-x64-nvidia-gguf" {
		t.Fatalf("unexpected image selection entry: %q", got)
	}
}

func TestCheckLocalAssetHealthFailsClosedForUnsupportedSafetensorsNativeSelection(t *testing.T) {
	svc := newTestServiceWithProbe(t, nil)
	setLocalRuntimePlatformForTest(t, "linux", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")

	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)
	model := mustInstallUnsupportedSafetensorsNativeImageForTest(t, svc, "local/safetensors-native-health")

	_, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{
		LocalAssetId: model.GetLocalAssetId(),
	})
	if err == nil {
		t.Fatal("expected targeted health check for unsupported safetensors native to fail-close")
	}
	assertGRPCReasonCode(t, err, "CheckLocalAssetHealth(unsupported safetensors native)", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	if !strings.Contains(err.Error(), "single-file safetensors image assets") {
		t.Fatalf("expected compatibility detail to surface, got %v", err)
	}
	if mgr.startConfigCalls != 0 || mgr.startCalls != 0 {
		t.Fatalf("unsupported safetensors native health check must not bootstrap managed engine, got config_calls=%d plain_calls=%d", mgr.startConfigCalls, mgr.startCalls)
	}

	updated := svc.modelByID(model.GetLocalAssetId())
	if updated == nil {
		t.Fatal("expected installed asset to remain available")
	}
	if updated.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("expected unsupported safetensors native asset to become unhealthy, got %s", updated.GetStatus())
	}
	if !strings.Contains(updated.GetHealthDetail(), "single-file safetensors image assets") {
		t.Fatalf("expected health detail to preserve compatibility detail, got %q", updated.GetHealthDetail())
	}
	if strings.Contains(strings.ToLower(updated.GetHealthDetail()), "attached endpoint") {
		t.Fatalf("unsupported safetensors native must not project to attached endpoint detail, got %q", updated.GetHealthDetail())
	}
}

func TestCheckLocalAssetHealthFailsClosedForUnsupportedImportedGGUFImage(t *testing.T) {
	svc := newTestServiceWithProbe(t, nil)
	setLocalRuntimePlatformForTest(t, "linux", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")

	tmpDir := t.TempDir()
	svc.SetManagedLlamaRegistrationConfig(tmpDir, "", true)
	manifestPath := filepath.Join(tmpDir, "resolved", "nimi", "image-model-linux-health", "asset.manifest.json")
	rawManifest, err := json.Marshal(map[string]any{
		"asset_id":         "local-import/z_image_turbo-Q4_K",
		"kind":             "image",
		"logical_model_id": "nimi/image-model-linux-health",
		"engine":           "media",
		"capabilities":     []string{"image"},
		"entry":            "z_image_turbo-Q4_K.gguf",
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("create manifest dir: %v", err)
	}
	imageEntryPath := filepath.Join(filepath.Dir(manifestPath), "z_image_turbo-Q4_K.gguf")
	if err := os.WriteFile(imageEntryPath, validImageTestGGUF(), 0o600); err != nil {
		t.Fatalf("write entry file: %v", err)
	}
	if err := os.WriteFile(manifestPath, rawManifest, 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	imported, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{
		ManifestPath: manifestPath,
	})
	if err != nil {
		t.Fatalf("import image asset: %v", err)
	}

	_, err = svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{
		LocalAssetId: imported.GetAsset().GetLocalAssetId(),
	})
	if err == nil {
		t.Fatal("expected targeted health check for unsupported imported image to fail-close")
	}
	assertGRPCReasonCode(t, err, "CheckLocalAssetHealth(unsupported imported gguf image)", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	if !strings.Contains(err.Error(), "no published runtime-owned managed image backend package") {
		t.Fatalf("expected compatibility detail to surface, got %v", err)
	}

	updated := svc.modelByID(imported.GetAsset().GetLocalAssetId())
	if updated == nil {
		t.Fatal("expected imported asset to remain available")
	}
	if updated.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("expected unsupported imported image asset to stay unhealthy, got %s", updated.GetStatus())
	}
}

func TestCheckLocalAssetHealthBulkDoesNotLoadManagedImage(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	loadCalls := 0
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		loadCalls++
		return nil, nil
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-health-bulk")
	cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())

	resp, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{})
	if err != nil {
		t.Fatalf("CheckLocalAssetHealth: %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("expected one asset, got %d", len(resp.GetAssets()))
	}
	if loadCalls != 0 {
		t.Fatalf("expected bulk health to avoid managed image load, got %d calls", loadCalls)
	}
}

func TestManagedImageExplicitHealthLoadsAndMarksActive(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	loadCalls := 0
	freeCalls := 0
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		loadCalls++
		return nil, nil
	}
	svc.managedImageFreeModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) error {
		freeCalls++
		return nil
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-explicit-health")
	cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())

	resp, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{
		LocalAssetId: asset.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("CheckLocalAssetHealth(targeted): %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("expected one health row, got %d", len(resp.GetAssets()))
	}
	if loadCalls != 1 {
		t.Fatalf("expected one managed image load, got %d", loadCalls)
	}
	if freeCalls != 0 {
		t.Fatalf("expected explicit health check to keep managed image resident during keep_alive, got %d", freeCalls)
	}
	if got := resp.GetAssets()[0].GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("expected active image asset, got %s", got)
	}
	if detail := resp.GetAssets()[0].GetDetail(); !strings.Contains(detail, "backend load verified") {
		t.Fatalf("unexpected health detail: %q", detail)
	}
}

func TestManagedImageStartLocalAssetPreloadReusesCanonicalAliasForGenerate(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	loadCalls := 0
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		loadCalls++
		return nil, nil
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-start-preload-reuse")
	profile := cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: asset.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("StartLocalAsset: %v", err)
	}
	if started.GetAsset() == nil || started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("expected active asset after StartLocalAsset, got %#v", started.GetAsset())
	}
	if loadCalls != 1 {
		t.Fatalf("expected one preload load during StartLocalAsset, got %d", loadCalls)
	}

	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request"); err != nil {
		t.Fatalf("EnsureManagedMediaImageLoaded(generate_request): %v", err)
	}
	if loadCalls != 1 {
		t.Fatalf("expected generate_request to reuse preloaded resident load, got %d loads", loadCalls)
	}
}

func TestEnsureManagedMediaImageLoadedUsesBoundedLoadTimeout(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-load-timeout")
	profile := cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())

	svc.managedImageLoadModel = func(ctx context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		deadline, ok := ctx.Deadline()
		if !ok {
			t.Fatal("expected managed image load context to carry a deadline")
		}
		if remaining := time.Until(deadline); remaining <= 0 || remaining > managedImageLoadTimeout {
			t.Fatalf("unexpected managed image load timeout window: %s", remaining)
		}
		return nil, nil
	}

	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request"); err != nil {
		t.Fatalf("EnsureManagedMediaImageLoaded(generate_request): %v", err)
	}
}

func TestManagedImageRecoverySweepSkipsBackgroundLoad(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	loadCalls := 0
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		loadCalls++
		return nil, nil
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-recovery-idle")
	cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())
	if _, err := svc.updateModelStatus(asset.GetLocalAssetId(), runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY, "seed unhealthy"); err != nil {
		t.Fatalf("seed unhealthy image status: %v", err)
	}

	svc.runRecoverySweep(context.Background())
	if loadCalls != 0 {
		t.Fatalf("expected recovery sweep to skip managed image load, got %d calls", loadCalls)
	}
}

func TestManagedImageLoadCacheReusesExplicitLoadUntilBackendEpochChanges(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	loadCalls := 0
	freeCalls := 0
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		loadCalls++
		return nil, nil
	}
	svc.managedImageFreeModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) error {
		freeCalls++
		return nil
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-cache-reuse")
	profile := cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())

	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request"); err != nil {
		t.Fatalf("first EnsureManagedMediaImageLoaded: %v", err)
	}
	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request"); err != nil {
		t.Fatalf("second EnsureManagedMediaImageLoaded: %v", err)
	}
	if loadCalls != 1 {
		t.Fatalf("expected cache hit on second explicit load, got %d calls", loadCalls)
	}

	if err := svc.ReleaseManagedMediaImage(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request_cleanup"); err != nil {
		t.Fatalf("first ReleaseManagedMediaImage: %v", err)
	}
	if freeCalls != 0 {
		t.Fatalf("expected held model to stay resident after first release, got free_calls=%d", freeCalls)
	}
	if err := svc.ReleaseManagedMediaImage(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request_cleanup"); err != nil {
		t.Fatalf("second ReleaseManagedMediaImage: %v", err)
	}
	if freeCalls != 0 {
		t.Fatalf("expected keep_alive release to keep managed image resident, got %d", freeCalls)
	}

	svc.SetManagedImageBackendHealth(false, "backend restarting")
	svc.SetManagedImageBackendHealth(true, "backend restarted")
	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request"); err != nil {
		t.Fatalf("third EnsureManagedMediaImageLoaded after backend epoch bump: %v", err)
	}
	if loadCalls != 2 {
		t.Fatalf("expected backend epoch change to invalidate cache, got %d calls", loadCalls)
	}
}

func TestManagedImageLoadCacheReloadsWhenRequestOverridesChange(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	var loadRequests []managedimagebackend.LoadModelRequest
	svc.managedImageLoadModel = func(_ context.Context, req managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		loadRequests = append(loadRequests, cloneManagedImageLoadRequest(req))
		return nil, nil
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-cache-overrides")
	profile := cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())
	profile["options"] = []any{
		"diffusion_model",
		"sampler:heun",
		"llm_path:/tmp/qwen.gguf",
	}

	overrideA := map[string]any{
		"cfg_scale": "7.5",
		"mode":      "euler",
	}
	overrideB := map[string]any{
		"cfg_scale": float64(9),
		"method":    "dpm++2m",
		"scheduler": "karras",
	}

	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, overrideA, "generate_request"); err != nil {
		t.Fatalf("first EnsureManagedMediaImageLoaded: %v", err)
	}
	if err := svc.ReleaseManagedMediaImage(context.Background(), "media/"+asset.GetAssetId(), "", profile, overrideA, "generate_request_cleanup"); err != nil {
		t.Fatalf("first ReleaseManagedMediaImage: %v", err)
	}
	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, overrideA, "generate_request"); err != nil {
		t.Fatalf("second EnsureManagedMediaImageLoaded with same override: %v", err)
	}
	if len(loadRequests) != 1 {
		t.Fatalf("expected identical override to hit cache, got %d loads", len(loadRequests))
	}
	if !strings.Contains(strings.Join(loadRequests[0].Options, ","), "sampler:euler") {
		t.Fatalf("first load options = %v, want sampler:euler", loadRequests[0].Options)
	}
	if !containsString(loadRequests[0].Options, "scheduler:discrete") {
		t.Fatalf("first load options = %v, want scheduler:discrete", loadRequests[0].Options)
	}
	if !containsString(loadRequests[0].Options, "diffusion_model") {
		t.Fatalf("first load options = %v, want diffusion_model retained", loadRequests[0].Options)
	}
	if !almostEqualFloat32(loadRequests[0].CFGScale, 7.5) {
		t.Fatalf("first load CFGScale = %f, want 7.5", loadRequests[0].CFGScale)
	}

	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, overrideB, "generate_request"); err != nil {
		t.Fatalf("third EnsureManagedMediaImageLoaded with different override: %v", err)
	}
	if len(loadRequests) != 2 {
		t.Fatalf("expected different override to trigger reload, got %d loads", len(loadRequests))
	}
	if !containsString(loadRequests[1].Options, "sampler:dpmpp2m") {
		t.Fatalf("second load options = %v, want sampler:dpmpp2m", loadRequests[1].Options)
	}
	if !containsString(loadRequests[1].Options, "scheduler:karras") {
		t.Fatalf("second load options = %v, want scheduler:karras", loadRequests[1].Options)
	}
	for _, option := range loadRequests[1].Options {
		if option == "sampler:heun" || option == "scheduler:discrete" {
			t.Fatalf("second load options = %v, stale sampler/scheduler must be replaced", loadRequests[1].Options)
		}
	}
	if !almostEqualFloat32(loadRequests[1].CFGScale, 9) {
		t.Fatalf("second load CFGScale = %f, want 9", loadRequests[1].CFGScale)
	}

	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, overrideB, "generate_request"); err != nil {
		t.Fatalf("fourth EnsureManagedMediaImageLoaded with same override: %v", err)
	}
	if len(loadRequests) != 2 {
		t.Fatalf("expected second identical override to hit cache, got %d loads", len(loadRequests))
	}
}

func TestManagedImageIdleSweepFreesBackendAndStopsIdleEngines(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.localModelKeepAlive = 0
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	loadCalls := 0
	freeCalls := 0
	engineMgr := &mockEngineManager{}
	svc.SetEngineManager(engineMgr)
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		loadCalls++
		return nil, nil
	}
	svc.managedImageFreeModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) error {
		freeCalls++
		return nil
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-idle-sweep")
	profile := cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())

	if err := svc.AcquireLocalAssetLease(context.Background(), asset.GetLocalAssetId(), "generate_request"); err != nil {
		t.Fatalf("AcquireLocalAssetLease: %v", err)
	}
	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request"); err != nil {
		t.Fatalf("EnsureManagedMediaImageLoaded: %v", err)
	}
	if err := svc.ReleaseManagedMediaImage(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request_cleanup"); err != nil {
		t.Fatalf("ReleaseManagedMediaImage: %v", err)
	}
	if err := svc.ReleaseLocalAssetLease(context.Background(), asset.GetLocalAssetId(), "generate_request_cleanup"); err != nil {
		t.Fatalf("ReleaseLocalAssetLease: %v", err)
	}

	if loadCalls != 1 {
		t.Fatalf("expected one managed image load, got %d", loadCalls)
	}
	if freeCalls != 1 {
		t.Fatalf("expected idle sweep to free managed image once, got %d", freeCalls)
	}
	if !containsString(engineMgr.stopEngines, "media") {
		t.Fatalf("expected media engine idle-stop, got %#v", engineMgr.stopEngines)
	}
	if containsString(engineMgr.stopEngines, managedImageBackendEngineName) {
		t.Fatalf("managed image backend should stay running for later image reuse, got %#v", engineMgr.stopEngines)
	}
	updated := svc.modelByID(asset.GetLocalAssetId())
	if updated == nil || updated.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED {
		t.Fatalf("expected managed image to return to installed after idle sweep, got %#v", updated)
	}
}

func TestAcquireLocalAssetLeaseKeepsIdleManagedImageResidentWhenCurrentTextWorkerIsHealthy(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe mocked healthy",
			probeURL:  endpoint,
			models:    []string{"beta-model"},
		}
	})
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	freeCalls := 0
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		return nil, nil
	}
	svc.managedImageFreeModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) error {
		freeCalls++
		return nil
	}
	svc.SetEngineManager(&mockEngineManager{
		status: &EngineInfo{
			Engine:   "llama",
			Version:  engine.DefaultLlamaConfig().Version,
			Status:   "healthy",
			Port:     1234,
			Endpoint: defaultLocalEndpoint,
		},
	})
	svc.SetManagedLlamaRegistrationConfig(svc.localModelsPath, svc.managedLlamaModelsConfigPath, true)

	imageAsset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-before-text")
	profile := cacheManagedImageProfileForTest(t, svc, imageAsset.GetLocalAssetId())
	if err := svc.AcquireLocalAssetLease(context.Background(), imageAsset.GetLocalAssetId(), "scenario_media_request"); err != nil {
		t.Fatalf("AcquireLocalAssetLease(image): %v", err)
	}
	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+imageAsset.GetAssetId(), "", profile, nil, "generate_request"); err != nil {
		t.Fatalf("EnsureManagedMediaImageLoaded: %v", err)
	}
	if err := svc.ReleaseManagedMediaImage(context.Background(), "media/"+imageAsset.GetAssetId(), "", profile, nil, "generate_request_cleanup"); err != nil {
		t.Fatalf("ReleaseManagedMediaImage: %v", err)
	}
	if err := svc.ReleaseLocalAssetLease(context.Background(), imageAsset.GetLocalAssetId(), "scenario_media_request_cleanup"); err != nil {
		t.Fatalf("ReleaseLocalAssetLease(image): %v", err)
	}
	if err := svc.UpdateManagedMediaImageExecutionStatus(context.Background(), "media/"+imageAsset.GetAssetId(), true, ""); err != nil {
		t.Fatalf("UpdateManagedMediaImageExecutionStatus: %v", err)
	}

	beta := addManagedLlamaAssetForTest(
		t,
		svc,
		"asset_beta",
		"local/beta-model",
		"nimi/beta-model",
		"beta.gguf",
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY,
	)
	svc.setCurrentManagedLlamaLoadedLocalAssetID(beta.GetLocalAssetId())
	recordManagedLlamaWarmKeyForTest(t, svc, beta, defaultLocalEndpoint)

	if err := svc.AcquireLocalAssetLease(context.Background(), beta.GetLocalAssetId(), "stream_text_generate_request"); err != nil {
		t.Fatalf("AcquireLocalAssetLease: %v", err)
	}
	if freeCalls != 0 {
		t.Fatalf("expected healthy text lease to keep idle managed image resident, got %d", freeCalls)
	}
	engineMgr := svc.engineManagerOrNil()
	if engineMgr == nil {
		t.Fatal("expected engine manager")
	}
	mockMgr, ok := engineMgr.(*mockEngineManager)
	if !ok {
		t.Fatalf("expected mock engine manager, got %T", engineMgr)
	}
	if containsString(mockMgr.stopEngines, "media") {
		t.Fatalf("expected healthy text lease to avoid stopping media engine, got %#v", mockMgr.stopEngines)
	}
	if containsString(mockMgr.stopEngines, managedImageBackendEngineName) {
		t.Fatalf("managed image backend should remain running during text reclaim, got %#v", mockMgr.stopEngines)
	}
	updatedImage := svc.modelByID(imageAsset.GetLocalAssetId())
	if updatedImage == nil {
		t.Fatal("expected managed image asset")
	}
	if got := updatedImage.GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("managed image status = %v, want ACTIVE", got)
	}
	if got := updatedImage.GetHealthDetail(); strings.Contains(got, "resident released for text generation") {
		t.Fatalf("managed image health detail = %q, did not expect text generation reclaim detail", got)
	}
}

func TestAcquireLocalAssetLeaseReclaimsIdleManagedImageResidentBeforeTextWorkerSwitch(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe mocked healthy",
			probeURL:  endpoint,
			models:    []string{"alpha-model", "beta-model"},
		}
	})
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	freeCalls := 0
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		return nil, nil
	}
	svc.managedImageFreeModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) error {
		freeCalls++
		return nil
	}
	svc.SetEngineManager(&mockEngineManager{
		status: &EngineInfo{
			Engine:   "llama",
			Version:  engine.DefaultLlamaConfig().Version,
			Status:   "healthy",
			Port:     1234,
			Endpoint: defaultLocalEndpoint,
		},
	})
	svc.SetManagedLlamaRegistrationConfig(svc.localModelsPath, svc.managedLlamaModelsConfigPath, true)

	imageAsset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-before-switch")
	profile := cacheManagedImageProfileForTest(t, svc, imageAsset.GetLocalAssetId())
	if err := svc.AcquireLocalAssetLease(context.Background(), imageAsset.GetLocalAssetId(), "scenario_media_request"); err != nil {
		t.Fatalf("AcquireLocalAssetLease(image): %v", err)
	}
	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+imageAsset.GetAssetId(), "", profile, nil, "generate_request"); err != nil {
		t.Fatalf("EnsureManagedMediaImageLoaded: %v", err)
	}
	if err := svc.ReleaseManagedMediaImage(context.Background(), "media/"+imageAsset.GetAssetId(), "", profile, nil, "generate_request_cleanup"); err != nil {
		t.Fatalf("ReleaseManagedMediaImage: %v", err)
	}
	if err := svc.ReleaseLocalAssetLease(context.Background(), imageAsset.GetLocalAssetId(), "scenario_media_request_cleanup"); err != nil {
		t.Fatalf("ReleaseLocalAssetLease(image): %v", err)
	}
	if err := svc.UpdateManagedMediaImageExecutionStatus(context.Background(), "media/"+imageAsset.GetAssetId(), true, ""); err != nil {
		t.Fatalf("UpdateManagedMediaImageExecutionStatus: %v", err)
	}

	alpha := addManagedLlamaAssetForTest(
		t,
		svc,
		"asset_alpha",
		"local/alpha-model",
		"nimi/alpha-model",
		"alpha.gguf",
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY,
	)
	beta := addManagedLlamaAssetForTest(
		t,
		svc,
		"asset_beta",
		"local/beta-model",
		"nimi/beta-model",
		"beta.gguf",
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD,
	)
	svc.setCurrentManagedLlamaLoadedLocalAssetID(alpha.GetLocalAssetId())
	recordManagedLlamaWarmKeyForTest(t, svc, beta, defaultLocalEndpoint)

	if err := svc.AcquireLocalAssetLease(context.Background(), beta.GetLocalAssetId(), "stream_text_generate_request"); err != nil {
		t.Fatalf("AcquireLocalAssetLease: %v", err)
	}
	if freeCalls != 1 {
		t.Fatalf("expected text worker switch to reclaim idle managed image resident once, got %d", freeCalls)
	}
	engineMgr := svc.engineManagerOrNil()
	if engineMgr == nil {
		t.Fatal("expected engine manager")
	}
	mockMgr, ok := engineMgr.(*mockEngineManager)
	if !ok {
		t.Fatalf("expected mock engine manager, got %T", engineMgr)
	}
	if !containsString(mockMgr.stopEngines, "media") {
		t.Fatalf("expected text worker switch to stop media engine, got %#v", mockMgr.stopEngines)
	}
	updatedImage := svc.modelByID(imageAsset.GetLocalAssetId())
	if updatedImage == nil {
		t.Fatal("expected managed image asset")
	}
	if got := updatedImage.GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED {
		t.Fatalf("managed image status = %v, want INSTALLED", got)
	}
	if got := updatedImage.GetHealthDetail(); !strings.Contains(got, "resident released for text generation") {
		t.Fatalf("managed image health detail = %q, want text generation reclaim detail", got)
	}
}
