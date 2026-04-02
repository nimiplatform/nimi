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

func managedModelQuarantineDirsForTest(t *testing.T, svc *Service) []string {
	t.Helper()
	root := runtimeManagedModelQuarantineRoot(resolveLocalModelsPath(svc.localModelsPath))
	entries, err := filepath.Glob(filepath.Join(root, "*"))
	if err != nil {
		t.Fatalf("glob quarantine dirs: %v", err)
	}
	return entries
}

func TestImportLocalModelFileRegistersManagedSupervisedLlama(t *testing.T) {
	svc := newTestService(t)
	sourceDir := t.TempDir()
	sourcePath := filepath.Join(sourceDir, "Qwen3-4B-Q4_K_M.gguf")
	if err := os.WriteFile(sourcePath, validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write source model: %v", err)
	}

	resp, err := svc.ImportLocalAssetFile(context.Background(), &runtimev1.ImportLocalAssetFileRequest{
		FilePath:     sourcePath,
		Capabilities: []string{"chat"},
		Engine:       "llama",
	})
	if err != nil {
		t.Fatalf("ImportLocalModelFile: %v", err)
	}
	model := resp.GetAsset()
	if model == nil {
		t.Fatal("expected imported model")
	}
	if got := model.GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED {
		t.Fatalf("status mismatch: got=%s", got)
	}
	if got := svc.modelRuntimeMode(model.GetLocalAssetId()); got != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		t.Fatalf("runtime mode mismatch: got=%s", got)
	}
	manifestPath := runtimeManagedAssetManifestPath(resolveLocalModelsPath(svc.localModelsPath), model.GetLogicalModelId())
	if _, err := os.Stat(manifestPath); err != nil {
		t.Fatalf("managed manifest missing: %v", err)
	}
	managedFile := filepath.Join(filepath.Dir(manifestPath), "Qwen3-4B-Q4_K_M.gguf")
	if _, err := os.Stat(managedFile); err != nil {
		t.Fatalf("managed model file missing: %v", err)
	}
	if _, err := os.Stat(sourcePath); err != nil {
		t.Fatalf("source file should remain for file import: %v", err)
	}
	transfers, err := svc.ListLocalTransfers(context.Background(), &runtimev1.ListLocalTransfersRequest{})
	if err != nil {
		t.Fatalf("ListLocalTransfers: %v", err)
	}
	if len(transfers.GetTransfers()) == 0 {
		t.Fatal("expected import transfer session")
	}
	transfer := transfers.GetTransfers()[0]
	if transfer.GetSessionKind() != "import" {
		t.Fatalf("sessionKind = %q", transfer.GetSessionKind())
	}
	if transfer.GetState() != "completed" {
		t.Fatalf("state = %q", transfer.GetState())
	}
	if transfer.GetLocalAssetId() != model.GetLocalAssetId() {
		t.Fatalf("localModelId = %q want %q", transfer.GetLocalAssetId(), model.GetLocalAssetId())
	}
	if got := model.GetSource().GetRepo(); !strings.HasPrefix(got, "file://") || !strings.HasSuffix(got, "/asset.manifest.json") {
		t.Fatalf("source repo = %q", got)
	}
}

func TestImportLocalPassiveAssetFileKeepsManifestKind(t *testing.T) {
	svc := newTestService(t)
	sourceDir := t.TempDir()
	sourcePath := filepath.Join(sourceDir, "z_image_ae.safetensors")
	if err := os.WriteFile(sourcePath, []byte("vae-payload"), 0o644); err != nil {
		t.Fatalf("write source asset: %v", err)
	}

	resp, err := svc.ImportLocalAssetFile(context.Background(), &runtimev1.ImportLocalAssetFileRequest{
		FilePath: sourcePath,
		Kind:     runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
		Engine:   "media",
	})
	if err != nil {
		t.Fatalf("ImportLocalAssetFile passive asset: %v", err)
	}
	asset := resp.GetAsset()
	if asset == nil {
		t.Fatal("expected imported passive asset")
	}
	if asset.GetKind() != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE {
		t.Fatalf("passive asset kind mismatch: got=%s", asset.GetKind())
	}
	if len(asset.GetCapabilities()) != 0 {
		t.Fatalf("passive asset must not synthesize runnable capabilities: %#v", asset.GetCapabilities())
	}
	manifestPath := runtimeManagedPassiveAssetManifestPath(resolveLocalModelsPath(svc.localModelsPath), asset.GetAssetId())
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read passive manifest: %v", err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("parse passive manifest: %v", err)
	}
	if got, _ := manifest["asset_id"].(string); got != asset.GetAssetId() {
		t.Fatalf("manifest asset_id mismatch: got=%q want=%q", got, asset.GetAssetId())
	}
	if got, _ := manifest["kind"].(string); got != "vae" {
		t.Fatalf("manifest kind mismatch: got=%q want=vae", got)
	}
	if _, exists := manifest["artifact_id"]; exists {
		t.Fatalf("legacy artifact_id must not be written: %#v", manifest)
	}
}

func TestImportLocalImageModelFileRegistersManagedSupervisedMediaWithoutEndpoint(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")

	sourceDir := t.TempDir()
	sourcePath := filepath.Join(sourceDir, "z_image_turbo-Q4_K_M.gguf")
	if err := os.WriteFile(sourcePath, validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write source model: %v", err)
	}

	_, err := svc.ImportLocalAssetFile(context.Background(), &runtimev1.ImportLocalAssetFileRequest{
		FilePath:     sourcePath,
		Capabilities: []string{"image"},
		Engine:       "media",
	})
	if err != nil {
		t.Fatalf("expected image import without explicit endpoint to succeed, got %v", err)
	}

	logicalModelID := filepath.ToSlash(filepath.Join("nimi", slugifyLocalModelID("local-import/z_image_turbo-Q4_K_M")))
	manifestPath := runtimeManagedAssetManifestPath(resolveLocalModelsPath(svc.localModelsPath), logicalModelID)
	if _, err := os.Stat(manifestPath); err != nil {
		t.Fatalf("managed manifest missing: %v", err)
	}
	resp, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{
		ManifestPath: manifestPath,
	})
	if err != nil {
		t.Fatalf("re-import managed manifest: %v", err)
	}
	if got := svc.modelRuntimeMode(resp.GetAsset().GetLocalAssetId()); got != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		t.Fatalf("runtime mode mismatch: got=%s", got)
	}
	rawManifest, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read managed manifest: %v", err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(rawManifest, &manifest); err != nil {
		t.Fatalf("parse managed manifest: %v", err)
	}
	if _, exists := manifest["engine_config"]; exists {
		t.Fatalf("canonical supervised image manifest must not write engine_config backend markers: %#v", manifest["engine_config"])
	}
	if _, statErr := os.Stat(sourcePath); statErr != nil {
		t.Fatalf("source file should remain after file import: %v", statErr)
	}
}

func TestImportLocalImageModelFileInfersCapabilitiesFromKindWithoutEndpoint(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")

	sourceDir := t.TempDir()
	sourcePath := filepath.Join(sourceDir, "z_image_turbo-Q4_K.gguf")
	if err := os.WriteFile(sourcePath, validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write source model: %v", err)
	}

	resp, err := svc.ImportLocalAssetFile(context.Background(), &runtimev1.ImportLocalAssetFileRequest{
		FilePath: sourcePath,
		Kind:     runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		Engine:   "media",
	})
	if err != nil {
		t.Fatalf("expected image file import with kind-only declaration to succeed, got %v", err)
	}
	model := resp.GetAsset()
	if model == nil {
		t.Fatal("expected imported model")
	}
	if got := model.GetKind(); got != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE {
		t.Fatalf("kind mismatch: got=%s", got)
	}
	if len(model.GetCapabilities()) != 1 || model.GetCapabilities()[0] != "image" {
		t.Fatalf("capabilities mismatch: %#v", model.GetCapabilities())
	}
	if got := svc.modelRuntimeMode(model.GetLocalAssetId()); got != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		t.Fatalf("runtime mode mismatch: got=%s", got)
	}
}

func TestImportLocalImageModelFileSupportsAppleSiliconManagedImageHost(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")

	sourceDir := t.TempDir()
	sourcePath := filepath.Join(sourceDir, "z_image_turbo-Q4_K.gguf")
	if err := os.WriteFile(sourcePath, validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write source model: %v", err)
	}

	resp, err := svc.ImportLocalAssetFile(context.Background(), &runtimev1.ImportLocalAssetFileRequest{
		FilePath: sourcePath,
		Kind:     runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		Engine:   "media",
	})
	if err != nil {
		t.Fatalf("expected Apple Silicon image file import to succeed, got %v", err)
	}
	if got := svc.modelRuntimeMode(resp.GetAsset().GetLocalAssetId()); got != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		t.Fatalf("runtime mode mismatch: got=%s", got)
	}
}

func TestScaffoldOrphanVideoModelRestoresSourceWhenRegistrationFails(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "intel")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "false")
	modelsRoot := t.TempDir()
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)

	sourceDir := t.TempDir()
	sourcePath := filepath.Join(sourceDir, "z_image_turbo-Q4_K_M.gguf")
	if err := os.WriteFile(sourcePath, validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write source model: %v", err)
	}

	_, err := svc.ScaffoldOrphanAsset(context.Background(), &runtimev1.ScaffoldOrphanAssetRequest{
		Path:         sourcePath,
		Capabilities: []string{"video.generate"},
		Engine:       "media",
	})
	if err == nil {
		t.Fatal("expected scaffold orphan video import to fail without explicit media endpoint")
	}
	assertGRPCReasonCode(t, err, "ScaffoldOrphanAsset(video missing endpoint)", runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED)

	logicalModelID := filepath.ToSlash(filepath.Join("nimi", slugifyLocalModelID("local-import/z_image_turbo-Q4_K_M")))
	stagedDir := runtimeManagedResolvedModelDir(resolveLocalModelsPath(svc.localModelsPath), logicalModelID)
	if _, statErr := os.Stat(stagedDir); !os.IsNotExist(statErr) {
		t.Fatalf("expected staged dir rollback, stat err=%v", statErr)
	}
	if _, statErr := os.Stat(sourcePath); statErr != nil {
		t.Fatalf("source file should be restored after failed orphan scaffold: %v", statErr)
	}

	transfers, listErr := svc.ListLocalTransfers(context.Background(), &runtimev1.ListLocalTransfersRequest{})
	if listErr != nil {
		t.Fatalf("ListLocalTransfers: %v", listErr)
	}
	if len(transfers.GetTransfers()) != 1 {
		t.Fatalf("expected one failed transfer, got %d", len(transfers.GetTransfers()))
	}
	if transfers.GetTransfers()[0].GetState() != "failed" {
		t.Fatalf("expected failed transfer, got %q", transfers.GetTransfers()[0].GetState())
	}
}

func TestScaffoldOrphanImageModelInfersCapabilitiesFromKindWithoutEndpoint(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")

	sourceDir := t.TempDir()
	sourcePath := filepath.Join(sourceDir, "z_image_turbo-Q4_K.gguf")
	if err := os.WriteFile(sourcePath, validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write source model: %v", err)
	}

	resp, err := svc.ScaffoldOrphanAsset(context.Background(), &runtimev1.ScaffoldOrphanAssetRequest{
		Path:   sourcePath,
		Kind:   runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		Engine: "media",
	})
	if err != nil {
		t.Fatalf("expected scaffold orphan image import with kind-only declaration to succeed, got %v", err)
	}
	model := resp.GetAsset()
	if model == nil {
		t.Fatal("expected scaffolded model")
	}
	if got := model.GetKind(); got != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE {
		t.Fatalf("kind mismatch: got=%s", got)
	}
	if len(model.GetCapabilities()) != 1 || model.GetCapabilities()[0] != "image" {
		t.Fatalf("capabilities mismatch: %#v", model.GetCapabilities())
	}
	if got := svc.modelRuntimeMode(model.GetLocalAssetId()); got != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		t.Fatalf("runtime mode mismatch: got=%s", got)
	}
	if _, err := os.Stat(sourcePath); !os.IsNotExist(err) {
		t.Fatalf("expected orphan source to be moved, stat err=%v", err)
	}
}

func TestScaffoldOrphanModelRebindsExistingAssetWithoutQuarantine(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	svc := newTestService(t)
	modelsRoot := t.TempDir()
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", true)
	existing := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local-import/orphan",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     "http://127.0.0.1:11434/v1",
	})

	sourceDir := t.TempDir()
	sourcePath := filepath.Join(sourceDir, "orphan.gguf")
	if err := os.WriteFile(sourcePath, validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write source model: %v", err)
	}

	resp, err := svc.ScaffoldOrphanAsset(context.Background(), &runtimev1.ScaffoldOrphanAssetRequest{
		Path:         sourcePath,
		Capabilities: []string{"chat"},
		Engine:       "llama",
	})
	if err != nil {
		t.Fatalf("expected scaffold orphan duplicate to rebind existing asset, got %v", err)
	}
	if resp.GetAsset() == nil {
		t.Fatal("expected rebound asset")
	}
	if resp.GetAsset().GetLocalAssetId() != existing.GetLocalAssetId() {
		t.Fatalf("rebind must preserve local asset id: got=%q want=%q", resp.GetAsset().GetLocalAssetId(), existing.GetLocalAssetId())
	}
	if _, statErr := os.Stat(sourcePath); !os.IsNotExist(statErr) {
		t.Fatalf("source file should be moved into runtime-managed storage after successful rebind, stat err=%v", statErr)
	}

	logicalModelID := filepath.ToSlash(filepath.Join("nimi", slugifyLocalModelID("local-import/orphan")))
	runtimeDir := runtimeManagedResolvedModelDir(resolveLocalModelsPath(svc.localModelsPath), logicalModelID)
	if _, statErr := os.Stat(runtimeDir); statErr != nil {
		t.Fatalf("runtime dir should contain rebound bundle, stat err=%v", statErr)
	}

	quarantineDirs := managedModelQuarantineDirsForTest(t, svc)
	if len(quarantineDirs) != 0 {
		t.Fatalf("expected no quarantine dirs on successful rebind, got %d", len(quarantineDirs))
	}
}

func TestScaffoldOrphanModelMovesSourceIntoRuntimeManagedStorage(t *testing.T) {
	svc := newTestService(t)
	sourceDir := t.TempDir()
	sourcePath := filepath.Join(sourceDir, "orphan.gguf")
	if err := os.WriteFile(sourcePath, validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write source model: %v", err)
	}

	resp, err := svc.ScaffoldOrphanAsset(context.Background(), &runtimev1.ScaffoldOrphanAssetRequest{
		Path:         sourcePath,
		Capabilities: []string{"chat"},
		Engine:       "llama",
	})
	if err != nil {
		t.Fatalf("ScaffoldOrphanModel: %v", err)
	}
	model := resp.GetAsset()
	if model == nil {
		t.Fatal("expected scaffolded model")
	}
	if _, err := os.Stat(sourcePath); !os.IsNotExist(err) {
		t.Fatalf("expected orphan source to be moved, stat err=%v", err)
	}
	manifestPath := runtimeManagedAssetManifestPath(resolveLocalModelsPath(svc.localModelsPath), model.GetLogicalModelId())
	if _, err := os.Stat(manifestPath); err != nil {
		t.Fatalf("managed manifest missing: %v", err)
	}
}

func TestScanUnregisteredAssetsFindsModelsInDefaultRoot(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	legacyModelsDir := filepath.Join(homeDir, ".nimi", "data", "models")
	if err := os.MkdirAll(legacyModelsDir, 0o755); err != nil {
		t.Fatalf("create legacy models dir: %v", err)
	}
	assetPath := filepath.Join(legacyModelsDir, "legacy-qwen.gguf")
	if err := os.WriteFile(assetPath, validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write legacy model asset: %v", err)
	}

	svc := newTestService(t)
	svc.localModelsPath = legacyModelsDir
	resp, err := svc.ScanUnregisteredAssets(context.Background(), &runtimev1.ScanUnregisteredAssetsRequest{})
	if err != nil {
		t.Fatalf("ScanUnregisteredAssets: %v", err)
	}
	if len(resp.GetItems()) != 1 {
		t.Fatalf("expected one unregistered asset, got %d", len(resp.GetItems()))
	}
	item := resp.GetItems()[0]
	if item.GetPath() != assetPath {
		t.Fatalf("asset path mismatch: got=%q want=%q", item.GetPath(), assetPath)
	}
	if item.GetDeclaration() == nil || item.GetDeclaration().GetAssetKind() != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT {
		t.Fatalf("expected model declaration, got %#v", item.GetDeclaration())
	}
}
