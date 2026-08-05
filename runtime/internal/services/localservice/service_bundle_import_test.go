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
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
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
	if len(asset.GetBundleEntries()) != 0 {
		t.Fatalf("ordinary llama bundle must preserve single-entry content identity: %#v", asset.GetBundleEntries())
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

func TestImportLocalAssetBundleFormsCanonicalOrderedDigestAndRejectsEntryDrift(t *testing.T) {
	svc := newTestService(t)
	sourceDir := t.TempDir()
	mainName := "Qwen3-Sharded-Q4_K_M.gguf"
	shardName := "weights-00002.data"
	if err := os.WriteFile(filepath.Join(sourceDir, mainName), validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write main bundle entry: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, shardName), []byte("second-shard"), 0o644); err != nil {
		t.Fatalf("write second bundle entry: %v", err)
	}

	asset, err := svc.importLocalAssetBundleSync(context.Background(), "", &runtimev1.ImportLocalAssetBundleRequest{
		DirectoryPath:        sourceDir,
		ModelName:            "Qwen3 Sharded",
		Capabilities:         []string{"chat"},
		Engine:               "llama",
		OrderedBundleEntries: []string{mainName, shardName},
	})
	if err != nil {
		t.Fatalf("import sharded bundle: %v", err)
	}
	entries := asset.GetBundleEntries()
	if len(entries) != 2 || entries[0].GetOrdinal() != 1 || entries[0].GetRelativePath() != mainName ||
		entries[1].GetOrdinal() != 2 || entries[1].GetRelativePath() != shardName {
		t.Fatalf("ordered bundle entries = %#v", entries)
	}
	descriptors := []capabilitydriver.BundleEntryDescriptor{
		{Ordinal: entries[0].GetOrdinal(), SHA256: entries[0].GetSha256()},
		{Ordinal: entries[1].GetOrdinal(), SHA256: entries[1].GetSha256()},
	}
	digest, err := capabilitydriver.CanonicalBundleSHA256(descriptors)
	if err != nil {
		t.Fatalf("canonical bundle digest: %v", err)
	}
	if got := exactDeclaredContentSHA256(asset); got != digest {
		t.Fatalf("declared bundle digest = %q, want %q", got, digest)
	}
	descriptor, reason, candidate := svc.verifyLocalCapabilityAssetContent(asset, resolveLocalModelsPath(svc.localModelsPath), "sha256:"+digest)
	if !candidate || reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || descriptor.EntrySHA256 != digest || len(descriptor.BundleEntries) != 2 {
		t.Fatalf("verified bundle = candidate=%t reason=%s descriptor=%#v", candidate, reason, descriptor)
	}
	svc.mu.Lock()
	svc.persistStateLocked()
	statePath := svc.stateStorePath
	svc.mu.Unlock()
	snapshot, err := loadLocalStateSnapshot(statePath)
	if err != nil {
		t.Fatalf("load persisted LocalAsset bundle manifest: %v", err)
	}
	persistedEntries := 0
	for _, row := range snapshot.Assets {
		if row.LocalAssetID == asset.GetLocalAssetId() {
			persistedEntries = len(row.BundleEntries)
		}
	}
	if persistedEntries != 2 {
		t.Fatalf("persisted bundle entries = %d, want 2", persistedEntries)
	}

	bundleDir := runtimeManagedBundleDir(resolveLocalModelsPath(svc.localModelsPath), asset)
	if err := os.WriteFile(filepath.Join(bundleDir, shardName), []byte("drifted-shard"), 0o644); err != nil {
		t.Fatalf("drift second bundle entry: %v", err)
	}
	_, reason, candidate = svc.verifyLocalCapabilityAssetContent(asset, resolveLocalModelsPath(svc.localModelsPath), "sha256:"+digest)
	if !candidate || reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH {
		t.Fatalf("drifted bundle = candidate=%t reason=%s", candidate, reason)
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
