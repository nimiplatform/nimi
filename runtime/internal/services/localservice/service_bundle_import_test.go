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
)

func TestImportLocalAssetBundleInvalidSourcePreservesCauseWithoutLeakingPath(t *testing.T) {
	svc := newTestService(t)
	privatePath := filepath.Join(t.TempDir(), "private-customer-bundle", "asset.manifest.json")

	_, err := svc.importLocalAssetBundleSync(context.Background(), "", &runtimev1.ImportLocalAssetBundleRequest{
		DirectoryPath: privatePath,
	})
	if err == nil {
		t.Fatal("expected invalid bundle source to fail")
	}

	var pathErr *os.PathError
	if !errors.As(err, &pathErr) {
		t.Fatalf("expected wrapped *os.PathError, got %T: %v", err, err)
	}
	if !errors.Is(err, pathErr) {
		t.Fatalf("expected wrapped error identity to retain the path error: %v", err)
	}
	assertGRPCReasonCode(t, err, "import bundle invalid source", runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	if strings.Contains(err.Error(), privatePath) || strings.Contains(err.Error(), "private-customer-bundle") {
		t.Fatalf("public gRPC detail leaked private source path: %v", err)
	}
}

func TestImportLocalAssetBundleScaffoldsManagedManifest(t *testing.T) {
	svc := newTestService(t)
	sourceDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(sourceDir, "Qwen3-4B-Q4_K_M.gguf"), validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write source model: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "tokenizer.json"), []byte(`{"type":"test"}`), 0o644); err != nil {
		t.Fatalf("write sidecar file: %v", err)
	}

	asset, err := svc.importLocalAssetBundleSync(context.Background(), "", &runtimev1.ImportLocalAssetBundleRequest{
		DirectoryPath: sourceDir,
		ModelName:     "Qwen3 Bundle",
		Capabilities:  []string{"chat"},
		Engine:        "llama",
	})
	if err != nil {
		t.Fatalf("import bundle: %v", err)
	}
	if asset == nil {
		t.Fatal("expected imported asset")
	}
	if got := asset.GetAssetId(); got != "local-import/Qwen3 Bundle" {
		t.Fatalf("asset id mismatch: got=%q", got)
	}
	if got := asset.GetEntry(); got != "Qwen3-4B-Q4_K_M.gguf" {
		t.Fatalf("entry mismatch: got=%q", got)
	}

	manifestPath := runtimeManagedAssetManifestPath(resolveLocalModelsPath(svc.localModelsPath), asset.GetLogicalModelId())
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read managed manifest: %v", err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("parse managed manifest: %v", err)
	}
	if got, _ := manifest["entry"].(string); got != "Qwen3-4B-Q4_K_M.gguf" {
		t.Fatalf("manifest entry mismatch: got=%q", got)
	}
	files := valueAsStringSlice(manifest["files"])
	if !bundleStringSliceContains(files, "Qwen3-4B-Q4_K_M.gguf") || !bundleStringSliceContains(files, "tokenizer.json") {
		t.Fatalf("manifest files missing bundle members: %#v", files)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(manifestPath), "Qwen3-4B-Q4_K_M.gguf")); err != nil {
		t.Fatalf("managed model missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(sourceDir, "Qwen3-4B-Q4_K_M.gguf")); err != nil {
		t.Fatalf("bundle import must not remove source files: %v", err)
	}
}

func TestRescanLocalAssetBundleRefreshesManagedManifestFiles(t *testing.T) {
	svc := newTestService(t)
	sourceDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(sourceDir, "Qwen3-4B-Q4_K_M.gguf"), validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write source model: %v", err)
	}

	asset, err := svc.importLocalAssetBundleSync(context.Background(), "", &runtimev1.ImportLocalAssetBundleRequest{
		DirectoryPath: sourceDir,
		ModelName:     "Qwen3 Rescan",
		Capabilities:  []string{"chat"},
		Engine:        "llama",
	})
	if err != nil {
		t.Fatalf("import bundle: %v", err)
	}

	bundleDir := runtimeManagedBundleDir(resolveLocalModelsPath(svc.localModelsPath), asset)
	if err := os.WriteFile(filepath.Join(bundleDir, "added.txt"), []byte("metadata"), 0o644); err != nil {
		t.Fatalf("write added bundle file: %v", err)
	}

	rescanned, err := svc.rescanLocalAssetBundleSync(context.Background(), "", &runtimev1.RescanLocalAssetBundleRequest{
		LocalAssetId: asset.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("rescan bundle: %v", err)
	}
	if got := rescanned.GetLocalAssetId(); got != asset.GetLocalAssetId() {
		t.Fatalf("local asset id changed: got=%q want=%q", got, asset.GetLocalAssetId())
	}

	manifestPath := filepath.Join(bundleDir, localAssetManifestFileName)
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read rescanned manifest: %v", err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("parse rescanned manifest: %v", err)
	}
	files := valueAsStringSlice(manifest["files"])
	if !bundleStringSliceContains(files, "added.txt") {
		t.Fatalf("rescanned manifest files missing added file: %#v", files)
	}
}
