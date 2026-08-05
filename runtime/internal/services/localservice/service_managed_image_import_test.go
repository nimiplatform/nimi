package localservice

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestLocalImportManifestValidation(t *testing.T) {
	svc := newTestService(t)
	tmpDir := t.TempDir()
	setLocalModelsPathForTest(t, svc, tmpDir)

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
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("unexpected invalid manifest error: %v", err)
	}
	assertGRPCReasonCode(t, err, "ImportLocalAsset(invalid JSON)", runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	var syntaxErr *json.SyntaxError
	if !errors.As(err, &syntaxErr) {
		t.Fatalf("expected JSON syntax cause, got %T", errors.Unwrap(err))
	}
	if strings.Contains(st.Message(), invalidPath) || strings.Contains(st.Message(), "{not-json") {
		t.Fatalf("public status leaked manifest path or content: %q", st.Message())
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
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("unexpected schema invalid manifest error: %v", err)
	}
	assertGRPCReasonCode(t, err, "ImportLocalAsset(invalid capabilities)", runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID)
	if errors.Unwrap(err) == nil {
		t.Fatal("expected manifest schema cause to remain available in-process")
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

	missingHashPath := filepath.Join(tmpDir, "resolved", "nimi", "missing-hash", "asset.manifest.json")
	missingHashManifest := map[string]any{
		"asset_id":         "local/missing-hash",
		"kind":             "image",
		"logical_model_id": "nimi/missing-hash",
		"engine":           "media",
		"capabilities":     []string{"image"},
		"entry":            "z_image_turbo-Q4_K.gguf",
		"files":            []string{"z_image_turbo-Q4_K.gguf"},
		"engine_config": map[string]any{
			"backend": "stablediffusion-ggml",
		},
	}
	missingHashRaw, _ := json.Marshal(missingHashManifest)
	if err := os.MkdirAll(filepath.Dir(missingHashPath), 0o755); err != nil {
		t.Fatalf("create missing hash manifest dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(missingHashPath), "z_image_turbo-Q4_K.gguf"), validImageTestGGUF(), 0o600); err != nil {
		t.Fatalf("write missing hash entry: %v", err)
	}
	if err := os.WriteFile(missingHashPath, missingHashRaw, 0o600); err != nil {
		t.Fatalf("write missing hash manifest: %v", err)
	}
	_, err = svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{ManifestPath: missingHashPath})
	if err == nil || !strings.Contains(err.Error(), "requires non-empty sha256 hash") {
		t.Fatalf("expected missing manifest hash to fail closed, got %v", err)
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

	aliasPath := filepath.Join(tmpDir, "resolved", "nimi", "alias-import", "asset.manifest.json")
	aliasManifest := map[string]any{
		"assetId":        "local/alias-import",
		"kind":           "chat",
		"logicalModelId": "nimi/alias-import",
		"engine":         "llama",
		"capabilities":   []string{"chat"},
		"entry":          "./dist/index.js",
	}
	aliasRaw, _ := json.Marshal(aliasManifest)
	if err := os.MkdirAll(filepath.Dir(aliasPath), 0o755); err != nil {
		t.Fatalf("create alias manifest dir: %v", err)
	}
	if err := os.WriteFile(aliasPath, aliasRaw, 0o600); err != nil {
		t.Fatalf("write alias manifest: %v", err)
	}
	_, err = svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{ManifestPath: aliasPath})
	if err == nil {
		t.Fatalf("expected alias public manifest fields to fail-close")
	}
	st, _ = status.FromError(err)
	if st.Code() != codes.InvalidArgument || st.Message() != runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID.String() {
		t.Fatalf("unexpected alias manifest error: %v", err)
	}

	missingCapabilitiesPath := filepath.Join(tmpDir, "resolved", "nimi", "missing-capabilities", "asset.manifest.json")
	missingCapabilitiesManifest := map[string]any{
		"asset_id":         "local/missing-capabilities",
		"kind":             "chat",
		"logical_model_id": "nimi/missing-capabilities",
		"engine":           "llama",
		"entry":            "./dist/index.js",
	}
	missingCapabilitiesRaw, _ := json.Marshal(missingCapabilitiesManifest)
	if err := os.MkdirAll(filepath.Dir(missingCapabilitiesPath), 0o755); err != nil {
		t.Fatalf("create missing capabilities manifest dir: %v", err)
	}
	if err := os.WriteFile(missingCapabilitiesPath, missingCapabilitiesRaw, 0o600); err != nil {
		t.Fatalf("write missing capabilities manifest: %v", err)
	}
	_, err = svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{ManifestPath: missingCapabilitiesPath})
	if err == nil {
		t.Fatalf("expected missing runnable capabilities to fail-close")
	}
	st, _ = status.FromError(err)
	if st.Code() != codes.InvalidArgument || st.Message() != runtimev1.ReasonCode_AI_LOCAL_MANIFEST_SCHEMA_INVALID.String() {
		t.Fatalf("unexpected missing capabilities error: %v", err)
	}
}

func TestLocalImportImageModelDefaultsToSupervisedOnLlamaSupportedHost(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	setNvidiaGPUProbeForTest(t, true)
	tmpDir := t.TempDir()
	setLocalModelsPathForTest(t, svc, tmpDir)
	manifestPath := filepath.Join(tmpDir, "resolved", "nimi", "image-model", "asset.manifest.json")
	rawManifest, err := json.Marshal(map[string]any{
		"asset_id":         "local-import/z_image_turbo-Q4_K",
		"kind":             "image",
		"logical_model_id": "nimi/image-model",
		"engine":           "media",
		"capabilities":     []string{"image"},
		"entry":            "z_image_turbo-Q4_K.gguf",
		"files":            []string{"z_image_turbo-Q4_K.gguf"},
		"hashes":           map[string]string{"z_image_turbo-Q4_K.gguf": "sha256:" + validImageTestGGUFHash()},
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
	if got := resp.GetAsset().GetCapabilities(); len(got) != 1 || got[0] != "image.generate" {
		t.Fatalf("expected image capability to normalize to image.generate, got %v", got)
	}
	if got := resp.GetAsset().GetPreferredEngine(); got != "media" {
		t.Fatalf("expected image projection preferred engine media, got %q", got)
	}
	if got := strings.Join(resp.GetAsset().GetHostRequirements().GetRequiredBackends(), ","); !strings.Contains(got, "stable-diffusion.cpp") {
		t.Fatalf("expected image projection to require media backend, got %q", got)
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
	setLocalModelsPathForTest(t, svc, tmpDir)
	manifestPath := filepath.Join(tmpDir, "resolved", "nimi", "image-model-m4", "asset.manifest.json")
	rawManifest, err := json.Marshal(map[string]any{
		"asset_id":         "local-import/z_image_turbo-Q4_K",
		"kind":             "image",
		"logical_model_id": "nimi/image-model-m4",
		"engine":           "media",
		"capabilities":     []string{"image"},
		"entry":            "z_image_turbo-Q4_K.gguf",
		"files":            []string{"z_image_turbo-Q4_K.gguf"},
		"hashes":           map[string]string{"z_image_turbo-Q4_K.gguf": "sha256:" + validImageTestGGUFHash()},
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
	setNvidiaGPUProbeForTest(t, true)
	tmpDir := t.TempDir()
	setLocalModelsPathForTest(t, svc, tmpDir)
	manifestPath := filepath.Join(tmpDir, "resolved", "nimi", "image-model-linux", "asset.manifest.json")
	rawManifest, err := json.Marshal(map[string]any{
		"asset_id":         "local-import/z_image_turbo-Q4_K",
		"kind":             "image",
		"logical_model_id": "nimi/image-model-linux",
		"engine":           "media",
		"capabilities":     []string{"image"},
		"entry":            "z_image_turbo-Q4_K.gguf",
		"files":            []string{"z_image_turbo-Q4_K.gguf"},
		"hashes":           map[string]string{"z_image_turbo-Q4_K.gguf": "sha256:" + validImageTestGGUFHash()},
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

func TestImportLocalAssetDoesNotProjectMMProjPathConfig(t *testing.T) {
	svc := newTestService(t)
	tmpDir := t.TempDir()
	setLocalModelsPathForTest(t, svc, tmpDir)

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
		"files":            []string{"weights/model.gguf", "mmproj-vision.gguf"},
		"hashes": map[string]string{
			"weights/model.gguf": "sha256:" + validGemma4TestGGUFHash(),
			"mmproj-vision.gguf": "sha256:" + validTestGGUFHash(),
		},
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
	if config := resp.GetAsset().GetEngineConfig(); config != nil && len(config.GetFields()) != 0 {
		t.Fatalf("import projected retired mmproj path config: %+v", config)
	}
}

func TestLocalStartManagedImageModelSkipsMediaProxyForNativeBinaryDirectBackend(t *testing.T) {
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
	setLocalModelsPathForTest(t, svc, tmpDir)
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
		"files":            []string{"z_image_turbo-Q4_K.gguf"},
		"hashes":           map[string]string{"z_image_turbo-Q4_K.gguf": "sha256:" + validImageTestGGUFHash()},
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
	if mgr.startConfigCalls != 0 || mgr.startCalls != 0 {
		t.Fatalf(
			"native-binary image direct backend must not bootstrap media proxy, got config_calls=%d plain_calls=%d plain_engines=%v last_engine=%q",
			mgr.startConfigCalls,
			mgr.startCalls,
			mgr.startEngines,
			mgr.lastStartEngine,
		)
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
	setNvidiaGPUProbeForTest(t, true)

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
	setNvidiaGPUProbeForTest(t, true)

	tmpDir := t.TempDir()
	setLocalModelsPathForTest(t, svc, tmpDir)
	manifestPath := filepath.Join(tmpDir, "resolved", "nimi", "image-model-linux-start", "asset.manifest.json")
	rawManifest, err := json.Marshal(map[string]any{
		"asset_id":         "local-import/z_image_turbo-Q4_K",
		"kind":             "image",
		"logical_model_id": "nimi/image-model-linux-start",
		"engine":           "media",
		"capabilities":     []string{"image"},
		"entry":            "z_image_turbo-Q4_K.gguf",
		"files":            []string{"z_image_turbo-Q4_K.gguf"},
		"hashes":           map[string]string{"z_image_turbo-Q4_K.gguf": "sha256:" + validImageTestGGUFHash()},
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
	setNvidiaGPUProbeForTest(t, true)

	tmpDir := t.TempDir()
	setLocalModelsPathForTest(t, svc, tmpDir)
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
		"files":            []string{"z_image_turbo-Q4_K.gguf"},
		"hashes":           map[string]string{"z_image_turbo-Q4_K.gguf": "sha256:" + validImageTestGGUFHash()},
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
	if !strings.Contains(started.GetAsset().GetHealthDetail(), "local environment activation blocked") || !strings.Contains(started.GetAsset().GetHealthDetail(), "model.asset") {
		t.Fatalf("expected consumer dependency activation block detail, got %q", started.GetAsset().GetHealthDetail())
	}
	if mgr.startConfigCalls != 0 || mgr.startCalls != 0 {
		t.Fatalf("expected activation gate to block before managed engine bootstrap, got config_calls=%d plain_calls=%d", mgr.startConfigCalls, mgr.startCalls)
	}
	if mgr.lastStartConfig.ImageSupervisedSelection != nil {
		t.Fatalf("expected no image selection forwarding after activation gate block, got %#v", mgr.lastStartConfig.ImageSupervisedSelection)
	}
}
