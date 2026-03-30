package localservice

import (
	"context"
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

	resp, err := svc.ImportLocalModelFile(context.Background(), &runtimev1.ImportLocalModelFileRequest{
		FilePath:     sourcePath,
		Capabilities: []string{"chat"},
		Engine:       "llama",
	})
	if err != nil {
		t.Fatalf("ImportLocalModelFile: %v", err)
	}
	model := resp.GetModel()
	if model == nil {
		t.Fatal("expected imported model")
	}
	if got := model.GetStatus(); got != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED {
		t.Fatalf("status mismatch: got=%s", got)
	}
	if got := svc.modelRuntimeMode(model.GetLocalModelId()); got != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		t.Fatalf("runtime mode mismatch: got=%s", got)
	}
	manifestPath := runtimeManagedResolvedModelManifestPath(resolveLocalModelsPath(svc.localModelsPath), model.GetLogicalModelId())
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
	if transfer.GetLocalModelId() != model.GetLocalModelId() {
		t.Fatalf("localModelId = %q want %q", transfer.GetLocalModelId(), model.GetLocalModelId())
	}
	if got := model.GetSource().GetRepo(); !strings.HasPrefix(got, "file://") || !strings.HasSuffix(got, "/manifest.json") {
		t.Fatalf("source repo = %q", got)
	}
}

func TestImportLocalModelFileRollsBackStagedBundleWhenRegistrationFails(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "intel")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "false")

	sourceDir := t.TempDir()
	sourcePath := filepath.Join(sourceDir, "z_image_turbo-Q4_K_M.gguf")
	if err := os.WriteFile(sourcePath, validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write source model: %v", err)
	}

	_, err := svc.ImportLocalModelFile(context.Background(), &runtimev1.ImportLocalModelFileRequest{
		FilePath:     sourcePath,
		Capabilities: []string{"image"},
		Engine:       "media",
	})
	if err == nil {
		t.Fatal("expected import to fail without explicit media endpoint")
	}

	logicalModelID := filepath.ToSlash(filepath.Join("nimi", slugifyLocalModelID("local-import/z_image_turbo-Q4_K_M")))
	stagedDir := runtimeManagedResolvedModelDir(resolveLocalModelsPath(svc.localModelsPath), logicalModelID)
	if _, statErr := os.Stat(stagedDir); !os.IsNotExist(statErr) {
		t.Fatalf("expected staged dir rollback, stat err=%v", statErr)
	}
	if _, statErr := os.Stat(sourcePath); statErr != nil {
		t.Fatalf("source file should remain after failed file import: %v", statErr)
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

func TestScaffoldOrphanModelRestoresSourceWhenRegistrationFails(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "intel")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "false")

	sourceDir := t.TempDir()
	sourcePath := filepath.Join(sourceDir, "z_image_turbo-Q4_K_M.gguf")
	if err := os.WriteFile(sourcePath, validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write source model: %v", err)
	}

	_, err := svc.ScaffoldOrphanModel(context.Background(), &runtimev1.ScaffoldOrphanModelRequest{
		Path:         sourcePath,
		Capabilities: []string{"image"},
		Engine:       "media",
	})
	if err == nil {
		t.Fatal("expected scaffold orphan import to fail without explicit media endpoint")
	}

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

func TestScaffoldOrphanModelRestoresSourceAndQuarantinesFailedBundleAfterActivation(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	svc := newTestService(t)
	_ = mustInstallAttachedLocalModel(t, svc, &runtimev1.InstallLocalModelRequest{
		ModelId:      "local-import/orphan",
		Capabilities: []string{"chat"},
		Engine:       "llama",
		Endpoint:     "http://127.0.0.1:11434/v1",
	})

	sourceDir := t.TempDir()
	sourcePath := filepath.Join(sourceDir, "orphan.gguf")
	if err := os.WriteFile(sourcePath, validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write source model: %v", err)
	}

	_, err := svc.ScaffoldOrphanModel(context.Background(), &runtimev1.ScaffoldOrphanModelRequest{
		Path:         sourcePath,
		Capabilities: []string{"chat"},
		Engine:       "llama",
	})
	if err == nil {
		t.Fatal("expected scaffold orphan to fail on duplicate model registration")
	}
	if _, statErr := os.Stat(sourcePath); statErr != nil {
		t.Fatalf("source file should be restored after failed scaffold: %v", statErr)
	}

	logicalModelID := filepath.ToSlash(filepath.Join("nimi", slugifyLocalModelID("local-import/orphan")))
	runtimeDir := runtimeManagedResolvedModelDir(resolveLocalModelsPath(svc.localModelsPath), logicalModelID)
	if _, statErr := os.Stat(runtimeDir); !os.IsNotExist(statErr) {
		t.Fatalf("runtime dir should not remain after failed scaffold, stat err=%v", statErr)
	}

	quarantineDirs := managedModelQuarantineDirsForTest(t, svc)
	if len(quarantineDirs) != 1 {
		t.Fatalf("expected one quarantine dir, got %d", len(quarantineDirs))
	}
	if _, statErr := os.Stat(filepath.Join(quarantineDirs[0], "orphan.gguf")); statErr != nil {
		t.Fatalf("quarantined bundle should retain model file: %v", statErr)
	}
	if _, statErr := os.Stat(filepath.Join(quarantineDirs[0], "manifest.json")); statErr != nil {
		t.Fatalf("quarantined bundle should retain manifest: %v", statErr)
	}
	if len(svc.audits) == 0 || svc.audits[0].GetEventType() != "runtime_model_bundle_quarantined" {
		t.Fatalf("expected quarantine audit event, got %#v", svc.audits)
	}
}

func TestScaffoldOrphanModelMovesSourceIntoRuntimeManagedStorage(t *testing.T) {
	svc := newTestService(t)
	sourceDir := t.TempDir()
	sourcePath := filepath.Join(sourceDir, "orphan.gguf")
	if err := os.WriteFile(sourcePath, validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write source model: %v", err)
	}

	resp, err := svc.ScaffoldOrphanModel(context.Background(), &runtimev1.ScaffoldOrphanModelRequest{
		Path:         sourcePath,
		Capabilities: []string{"chat"},
		Engine:       "llama",
	})
	if err != nil {
		t.Fatalf("ScaffoldOrphanModel: %v", err)
	}
	model := resp.GetModel()
	if model == nil {
		t.Fatal("expected scaffolded model")
	}
	if _, err := os.Stat(sourcePath); !os.IsNotExist(err) {
		t.Fatalf("expected orphan source to be moved, stat err=%v", err)
	}
	manifestPath := runtimeManagedResolvedModelManifestPath(resolveLocalModelsPath(svc.localModelsPath), model.GetLogicalModelId())
	if _, err := os.Stat(manifestPath); err != nil {
		t.Fatalf("managed manifest missing: %v", err)
	}
}

func TestScanUnregisteredAssetsIncludesLegacyDesktopModelsRoot(t *testing.T) {
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
	if item.GetDeclaration() == nil || item.GetDeclaration().GetAssetClass() != "model" {
		t.Fatalf("expected model declaration, got %#v", item.GetDeclaration())
	}
}
