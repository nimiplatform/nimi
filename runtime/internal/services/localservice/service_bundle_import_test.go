package localservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

func TestImportLocalAssetBundleRejectsLogicalModelIDPathEscapeBeforeMutation(t *testing.T) {
	svc := newTestService(t)
	modelsRoot := filepath.Join(t.TempDir(), "models")
	setLocalModelsPathForTest(t, svc, modelsRoot)
	if err := os.MkdirAll(filepath.Join(modelsRoot, "resolved"), 0o755); err != nil {
		t.Fatalf("create resolved models root: %v", err)
	}
	sentinelPath := filepath.Join(modelsRoot, "keep.txt")
	if err := os.WriteFile(sentinelPath, []byte("keep"), 0o600); err != nil {
		t.Fatalf("write models-root sentinel: %v", err)
	}

	sourceDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(sourceDir, "model.bin"), []byte("model"), 0o600); err != nil {
		t.Fatalf("write bundle entry: %v", err)
	}
	manifestRaw, err := json.Marshal(map[string]any{
		"schema_version":   "1.0.0",
		"asset_id":         "local-import/path-escape",
		"kind":             "video",
		"logical_model_id": "../escaped-bundle",
		"engine":           "media",
		"capabilities":     []string{"video.generate"},
		"entry":            "model.bin",
		"files":            []string{"model.bin"},
		"license":          "unknown",
		"source": map[string]any{
			"repo":     "file://source/asset.manifest.json",
			"revision": "local",
		},
		"hashes": map[string]string{"model.bin": "sha256:source"},
	})
	if err != nil {
		t.Fatalf("marshal bundle manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, localAssetManifestFileName), manifestRaw, 0o600); err != nil {
		t.Fatalf("write bundle manifest: %v", err)
	}

	_, err = svc.importLocalAssetBundleSync(context.Background(), "", &runtimev1.ImportLocalAssetBundleRequest{
		DirectoryPath: sourceDir,
	})
	if err == nil {
		t.Fatal("expected logical_model_id path escape to fail")
	}
	if got, readErr := os.ReadFile(sentinelPath); readErr != nil || string(got) != "keep" {
		t.Errorf("models-root sentinel changed: content=%q err=%v", got, readErr)
	}
	if matches, globErr := filepath.Glob(filepath.Join(modelsRoot, "escaped-bundle*")); globErr != nil {
		t.Fatalf("glob escaped bundle paths: %v", globErr)
	} else if len(matches) != 0 {
		t.Errorf("path escape mutated models root before rejection: %#v", matches)
	}
	if _, statErr := os.Stat(runtimeManagedModelQuarantineRoot(modelsRoot)); !os.IsNotExist(statErr) {
		t.Errorf("path escape reached quarantine before rejection: %v", statErr)
	}
	assertGRPCReasonCode(t, err, "ImportLocalAssetBundle(logical model path escape)", runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
}

func TestImportLocalAssetRejectsLogicalModelIDPathEscape(t *testing.T) {
	svc := newTestService(t)
	modelsRoot := filepath.Join(t.TempDir(), "models")
	setLocalModelsPathForTest(t, svc, modelsRoot)
	bundleDir := filepath.Join(modelsRoot, "resolved", "owned-bundle")
	if err := os.MkdirAll(bundleDir, 0o755); err != nil {
		t.Fatalf("create managed bundle: %v", err)
	}
	entryPath := filepath.Join(bundleDir, "model.bin")
	if err := os.WriteFile(entryPath, []byte("model"), 0o600); err != nil {
		t.Fatalf("write managed bundle entry: %v", err)
	}
	entryHash, err := computeImportFileSHA256(entryPath)
	if err != nil {
		t.Fatalf("hash managed bundle entry: %v", err)
	}
	manifestPath := filepath.Join(bundleDir, localAssetManifestFileName)
	manifestRaw, err := json.Marshal(map[string]any{
		"schema_version":   "1.0.0",
		"asset_id":         "local-import/path-escape-direct",
		"kind":             "video",
		"logical_model_id": "..",
		"engine":           "media",
		"capabilities":     []string{"video.generate"},
		"entry":            "model.bin",
		"files":            []string{"model.bin"},
		"license":          "unknown",
		"source": map[string]any{
			"repo":     "file://ignored-by-import",
			"revision": "local",
		},
		"hashes": map[string]string{"model.bin": "sha256:" + entryHash},
	})
	if err != nil {
		t.Fatalf("marshal managed bundle manifest: %v", err)
	}
	if err := os.WriteFile(manifestPath, manifestRaw, 0o600); err != nil {
		t.Fatalf("write managed bundle manifest: %v", err)
	}

	_, err = svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{ManifestPath: manifestPath})
	if err == nil {
		t.Fatal("expected direct manifest import to reject path-shaped logical_model_id")
	}
	assertGRPCReasonCode(t, err, "ImportLocalAsset(logical model path escape)", runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
	if got, readErr := os.ReadFile(entryPath); readErr != nil || string(got) != "model" {
		t.Fatalf("direct rejected import mutated its managed bundle: content=%q err=%v", got, readErr)
	}
}

func TestResolveRuntimeManagedModelBundleDirRejectsNonCanonicalPathForms(t *testing.T) {
	modelsRoot := filepath.Join(t.TempDir(), "models")
	if err := os.MkdirAll(filepath.Join(modelsRoot, "resolved"), 0o755); err != nil {
		t.Fatalf("create resolved models root: %v", err)
	}
	for _, logicalModelID := range []string{
		"..",
		"../escape",
		"a/../../escape",
		`..\escape`,
		`\escape`,
		`C:\escape`,
		`C:escape`,
		`\\server\share`,
		`\\?\C:\escape`,
		"/escape",
		"a//b",
		"a/./b",
		"a:b",
		"CON",
		"models/LPT1.bin",
	} {
		t.Run(strings.NewReplacer("/", "_", `\`, "_").Replace(logicalModelID), func(t *testing.T) {
			if target, err := resolveRuntimeManagedModelBundleDir(modelsRoot, logicalModelID); err == nil {
				t.Fatalf("resolve target = %q, want invalid logical_model_id %q", target, logicalModelID)
			}
		})
	}

	for _, logicalModelID := range []string{
		"nimi/local-import-model",
		"Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
	} {
		t.Run("valid_"+strings.ReplaceAll(logicalModelID, "/", "_"), func(t *testing.T) {
			target, err := resolveRuntimeManagedModelBundleDir(modelsRoot, logicalModelID)
			if err != nil {
				t.Fatalf("resolve valid logical_model_id %q: %v", logicalModelID, err)
			}
			if !pathWithinBase(filepath.Join(modelsRoot, "resolved"), target, false) {
				t.Fatalf("resolved target escaped managed root: %q", target)
			}
		})
	}
}

func TestImportedManifestUsesItsParentForEntryAndRemovalTruth(t *testing.T) {
	svc := newTestService(t)
	modelsRoot := filepath.Join(t.TempDir(), "models")
	setLocalModelsPathForTest(t, svc, modelsRoot)

	victimDir := filepath.Join(modelsRoot, "resolved", "nimi", "victim-bundle")
	if err := os.MkdirAll(victimDir, 0o755); err != nil {
		t.Fatalf("create victim bundle: %v", err)
	}
	victimPath := filepath.Join(victimDir, "model.bin")
	if err := os.WriteFile(victimPath, []byte("victim"), 0o600); err != nil {
		t.Fatalf("write victim bundle: %v", err)
	}

	ownedDir := filepath.Join(modelsRoot, "resolved", "owned-bundle")
	if err := os.MkdirAll(ownedDir, 0o755); err != nil {
		t.Fatalf("create imported bundle: %v", err)
	}
	ownedEntryPath := filepath.Join(ownedDir, "model.bin")
	if err := os.WriteFile(ownedEntryPath, []byte("owned"), 0o600); err != nil {
		t.Fatalf("write imported bundle: %v", err)
	}
	ownedHash, err := computeImportFileSHA256(ownedEntryPath)
	if err != nil {
		t.Fatalf("hash imported bundle: %v", err)
	}
	manifestPath := filepath.Join(ownedDir, localAssetManifestFileName)
	manifestRaw, err := json.Marshal(map[string]any{
		"schema_version":   "1.0.0",
		"asset_id":         "local-import/owned-bundle",
		"kind":             "video",
		"logical_model_id": "nimi/victim-bundle",
		"engine":           "media",
		"capabilities":     []string{"video.generate"},
		"entry":            "model.bin",
		"files":            []string{"model.bin"},
		"license":          "unknown",
		"source": map[string]any{
			"repo":     "file://ignored-by-import",
			"revision": "local",
		},
		"hashes": map[string]string{"model.bin": "sha256:" + ownedHash},
	})
	if err != nil {
		t.Fatalf("marshal imported manifest: %v", err)
	}
	if err := os.WriteFile(manifestPath, manifestRaw, 0o600); err != nil {
		t.Fatalf("write imported manifest: %v", err)
	}

	imported, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{ManifestPath: manifestPath})
	if err != nil {
		t.Fatalf("import managed manifest: %v", err)
	}
	entryPath, err := resolveManagedModelEntryAbsolutePath(modelsRoot, imported.GetAsset())
	if err != nil {
		t.Fatalf("resolve imported entry: %v", err)
	}
	if entryPath != ownedEntryPath {
		t.Fatalf("imported entry path = %q, want manifest-parent path %q", entryPath, ownedEntryPath)
	}
	malformedFileSource := cloneLocalAsset(imported.GetAsset())
	malformedFileSource.Source = &runtimev1.LocalAssetSource{Repo: "file://" + filepath.ToSlash(victimPath), Revision: "local"}
	if bundleDir, err := resolveRuntimeManagedBundleDir(modelsRoot, malformedFileSource); err == nil {
		t.Fatalf("malformed file source fell back to logical_model_id storage: %q", bundleDir)
	}
	if entryPath, err := resolveManagedModelEntryAbsolutePath(modelsRoot, malformedFileSource); err == nil {
		t.Fatalf("malformed file source resolved through logical_model_id fallback: %q", entryPath)
	}

	if _, err := svc.RemoveLocalAsset(context.Background(), &runtimev1.RemoveLocalAssetRequest{
		LocalAssetId: imported.GetAsset().GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("remove imported asset: %v", err)
	}
	if _, err := os.Stat(ownedDir); !os.IsNotExist(err) {
		t.Fatalf("imported manifest parent was not removed: %v", err)
	}
	if got, err := os.ReadFile(victimPath); err != nil || string(got) != "victim" {
		t.Fatalf("logical_model_id selected an unrelated bundle during removal: content=%q err=%v", got, err)
	}
}

func TestImportLocalAssetBundleWithManifestUsesRuntimeOwnedStorageIdentity(t *testing.T) {
	svc := newTestService(t)
	modelsRoot := filepath.Join(t.TempDir(), "models")
	setLocalModelsPathForTest(t, svc, modelsRoot)
	sourceDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(sourceDir, "model.bin"), []byte("model"), 0o600); err != nil {
		t.Fatalf("write source bundle entry: %v", err)
	}
	manifestRaw, err := json.Marshal(map[string]any{
		"schema_version":   "1.0.0",
		"asset_id":         "local-import/source-manifest-bundle",
		"kind":             "video",
		"logical_model_id": "Qwen/Source-Manifest-Bundle",
		"engine":           "media",
		"capabilities":     []string{"video.generate"},
		"entry":            "model.bin",
		"files":            []string{"model.bin"},
		"license":          "unknown",
		"source": map[string]any{
			"repo":     "file://source/asset.manifest.json",
			"revision": "local",
		},
		"hashes": map[string]string{"model.bin": "sha256:source"},
	})
	if err != nil {
		t.Fatalf("marshal source bundle manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, localAssetManifestFileName), manifestRaw, 0o600); err != nil {
		t.Fatalf("write source bundle manifest: %v", err)
	}

	asset, err := svc.importLocalAssetBundleSync(context.Background(), "", &runtimev1.ImportLocalAssetBundleRequest{
		DirectoryPath: sourceDir,
	})
	if err != nil {
		t.Fatalf("import bundle with manifest: %v", err)
	}
	managedDir, err := resolveManagedManifestBundleDir(modelsRoot, asset.GetSource().GetRepo())
	if err != nil {
		t.Fatalf("resolve imported manifest parent: %v", err)
	}
	expectedDir, err := resolveRuntimeManagedImportedBundleDir(modelsRoot, asset.GetAssetId(), asset.GetKind())
	if err != nil {
		t.Fatalf("resolve Runtime-owned storage identity: %v", err)
	}
	if managedDir != expectedDir {
		t.Fatalf("managed bundle dir = %q, want Runtime-owned asset storage %q", managedDir, expectedDir)
	}
	logicalDir, err := resolveRuntimeManagedModelBundleDir(modelsRoot, asset.GetLogicalModelId())
	if err != nil {
		t.Fatalf("resolve logical metadata path for negative assertion: %v", err)
	}
	if _, err := os.Stat(logicalDir); !os.IsNotExist(err) {
		t.Fatalf("logical_model_id unexpectedly selected bundle storage: %v", err)
	}
}

func TestImportLocalAssetBundleSeparatesCollidingManifestStorageIdentities(t *testing.T) {
	svc := newTestService(t)
	modelsRoot := filepath.Join(t.TempDir(), "models")
	setLocalModelsPathForTest(t, svc, modelsRoot)

	importBundle := func(assetID string, logicalModelID string, content string) *runtimev1.LocalAssetRecord {
		t.Helper()
		sourceDir := t.TempDir()
		if err := os.WriteFile(filepath.Join(sourceDir, "model.bin"), []byte(content), 0o600); err != nil {
			t.Fatalf("write source bundle entry: %v", err)
		}
		manifestRaw, err := json.Marshal(map[string]any{
			"schema_version":   "1.0.0",
			"asset_id":         assetID,
			"kind":             "video",
			"logical_model_id": logicalModelID,
			"engine":           "media",
			"capabilities":     []string{"video.generate"},
			"entry":            "model.bin",
			"files":            []string{"model.bin"},
			"license":          "unknown",
			"source": map[string]any{
				"repo":     "file://source/asset.manifest.json",
				"revision": "local",
			},
			"hashes": map[string]string{"model.bin": "sha256:source"},
		})
		if err != nil {
			t.Fatalf("marshal source bundle manifest: %v", err)
		}
		if err := os.WriteFile(filepath.Join(sourceDir, localAssetManifestFileName), manifestRaw, 0o600); err != nil {
			t.Fatalf("write source bundle manifest: %v", err)
		}
		asset, err := svc.importLocalAssetBundleSync(context.Background(), "", &runtimev1.ImportLocalAssetBundleRequest{
			DirectoryPath: sourceDir,
		})
		if err != nil {
			t.Fatalf("import bundle %q: %v", assetID, err)
		}
		return asset
	}

	first := importBundle("Acme/Model", "Provenance/First", "first")
	second := importBundle("acme-model", "Provenance/Second", "second")
	firstDir, err := resolveManagedManifestBundleDir(modelsRoot, first.GetSource().GetRepo())
	if err != nil {
		t.Fatalf("resolve first imported bundle: %v", err)
	}
	secondDir, err := resolveManagedManifestBundleDir(modelsRoot, second.GetSource().GetRepo())
	if err != nil {
		t.Fatalf("resolve second imported bundle: %v", err)
	}
	if firstDir == secondDir {
		t.Fatalf("distinct (asset_id, kind) identities shared managed storage: %q", firstDir)
	}
	if got, err := os.ReadFile(filepath.Join(firstDir, "model.bin")); err != nil || string(got) != "first" {
		t.Fatalf("first bundle was overwritten: content=%q err=%v", got, err)
	}
	if got, err := os.ReadFile(filepath.Join(secondDir, "model.bin")); err != nil || string(got) != "second" {
		t.Fatalf("second bundle content mismatch: content=%q err=%v", got, err)
	}

	if _, err := svc.RemoveLocalAsset(context.Background(), &runtimev1.RemoveLocalAssetRequest{LocalAssetId: first.GetLocalAssetId()}); err != nil {
		t.Fatalf("remove first imported bundle: %v", err)
	}
	if _, err := os.Stat(firstDir); !os.IsNotExist(err) {
		t.Fatalf("first imported bundle directory was not removed: %v", err)
	}
	if got, err := os.ReadFile(filepath.Join(secondDir, "model.bin")); err != nil || string(got) != "second" {
		t.Fatalf("removing first bundle damaged second bundle: content=%q err=%v", got, err)
	}

	sharedFirst := importBundle("Shared/Model", "Provenance/Shared", "shared")
	sharedSecond := importBundle("Shared/Model", "Provenance/Shared", "shared")
	if sharedFirst.GetLocalAssetId() == sharedSecond.GetLocalAssetId() {
		t.Fatalf("duplicate manifest import did not mint a distinct local asset id: %q", sharedFirst.GetLocalAssetId())
	}
	sharedDir, err := resolveManagedManifestBundleDir(modelsRoot, sharedSecond.GetSource().GetRepo())
	if err != nil {
		t.Fatalf("resolve shared imported bundle: %v", err)
	}
	if _, err := svc.updateModelStatus(sharedFirst.GetLocalAssetId(), runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY, "first remains unhealthy"); err != nil {
		t.Fatalf("mark first shared record unhealthy: %v", err)
	}
	if _, err := svc.updateModelStatus(sharedSecond.GetLocalAssetId(), runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY, "second needs rescan"); err != nil {
		t.Fatalf("mark second shared record unhealthy: %v", err)
	}
	rescanned, err := svc.rescanLocalAssetBundleSync(context.Background(), "", &runtimev1.RescanLocalAssetBundleRequest{
		LocalAssetId: sharedSecond.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("rescan second shared record: %v", err)
	}
	if rescanned.GetLocalAssetId() != sharedSecond.GetLocalAssetId() {
		t.Fatalf("rescan rebound local asset %q, want exact target %q", rescanned.GetLocalAssetId(), sharedSecond.GetLocalAssetId())
	}
	if got := svc.modelByID(sharedFirst.GetLocalAssetId()).GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("rescan mutated peer duplicate status: %s", got)
	}

	if _, err := svc.RemoveLocalAsset(context.Background(), &runtimev1.RemoveLocalAssetRequest{LocalAssetId: sharedFirst.GetLocalAssetId()}); err != nil {
		t.Fatalf("remove first shared record: %v", err)
	}
	if got, err := os.ReadFile(filepath.Join(sharedDir, "model.bin")); err != nil || string(got) != "shared" {
		t.Fatalf("removing one shared record damaged its active peer: content=%q err=%v", got, err)
	}
	if _, err := svc.RemoveLocalAsset(context.Background(), &runtimev1.RemoveLocalAssetRequest{LocalAssetId: sharedSecond.GetLocalAssetId()}); err != nil {
		t.Fatalf("remove final shared record: %v", err)
	}
	if _, err := os.Stat(sharedDir); !os.IsNotExist(err) {
		t.Fatalf("final shared record removal left bundle directory behind: %v", err)
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
		Capabilities:  []string{"text.generate"},
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

func writeCatalogTTSBundleFixture(t *testing.T, ttsModelType string) string {
	t.Helper()
	sourceDir := filepath.Join(t.TempDir(), "Qwen3-TTS-12Hz-0.6B-CustomVoice")
	requiredFiles := []string{
		"model.safetensors",
		"config.json",
		"generation_config.json",
		"preprocessor_config.json",
		"tokenizer_config.json",
		"vocab.json",
		"merges.txt",
		"speech_tokenizer/model.safetensors",
		"speech_tokenizer/config.json",
		"speech_tokenizer/configuration.json",
		"speech_tokenizer/preprocessor_config.json",
	}
	for _, relativePath := range requiredFiles {
		path := filepath.Join(sourceDir, filepath.FromSlash(relativePath))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("create TTS bundle directory: %v", err)
		}
		content := []byte(relativePath)
		if relativePath == "config.json" {
			content = []byte(fmt.Sprintf(`{"model_type":"qwen3_tts","tts_model_type":%q}`, ttsModelType))
		}
		if err := os.WriteFile(path, content, 0o644); err != nil {
			t.Fatalf("write TTS bundle file %s: %v", relativePath, err)
		}
	}
	gitMetadata := filepath.Join(sourceDir, ".git", "lfs", "incomplete", "partial-model")
	if err := os.MkdirAll(filepath.Dir(gitMetadata), 0o755); err != nil {
		t.Fatalf("create source-control metadata directory: %v", err)
	}
	if err := os.WriteFile(gitMetadata, []byte("not a model asset"), 0o644); err != nil {
		t.Fatalf("write source-control metadata: %v", err)
	}
	return sourceDir
}

func TestImportLocalAssetBundleAdmitsCompleteCatalogTTSBundle(t *testing.T) {
	svc := newTestService(t)
	sourceDir := writeCatalogTTSBundleFixture(t, "custom_voice")

	asset, err := svc.importLocalAssetBundleSync(context.Background(), "", &runtimev1.ImportLocalAssetBundleRequest{
		DirectoryPath: sourceDir,
		ModelName:     "Qwen3-TTS-12Hz-0.6B-CustomVoice",
		Capabilities:  []string{"audio.synthesize"},
	})
	if err != nil {
		t.Fatalf("import complete TTS bundle: %v", err)
	}
	if got := asset.GetKind(); got != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS {
		t.Fatalf("kind = %s, want TTS", got)
	}
	if got := asset.GetEngine(); got != "speech" {
		t.Fatalf("engine = %q, want speech", got)
	}
	if got := asset.GetEntry(); got != "model.safetensors" {
		t.Fatalf("entry = %q, want model.safetensors", got)
	}
	for _, role := range []string{"tts_model", "speech_tokenizer", "tokenizer"} {
		if !stringSliceContains(asset.GetArtifactRoles(), role) {
			t.Fatalf("artifact roles = %#v, want %q", asset.GetArtifactRoles(), role)
		}
	}
	if !bundleStringSliceContains(asset.GetFiles(), "speech_tokenizer/model.safetensors") {
		t.Fatalf("bundle files = %#v, missing nested speech tokenizer", asset.GetFiles())
	}
	if bundleStringSliceContains(asset.GetFiles(), ".git/lfs/incomplete/partial-model") {
		t.Fatalf("bundle files = %#v, source-control metadata must not be imported", asset.GetFiles())
	}
	managedDir := filepath.Dir(runtimeManagedAssetManifestPath(resolveLocalModelsPath(svc.localModelsPath), asset.GetLogicalModelId()))
	if _, err := os.Stat(filepath.Join(managedDir, ".git")); !os.IsNotExist(err) {
		t.Fatalf("managed TTS bundle .git state = %v, want not present", err)
	}
}

func TestImportLocalAssetBundleRejectsAmbiguousTTSDescriptorAcrossFolderNames(t *testing.T) {
	svc := newTestService(t)
	sourceDir := writeCatalogTTSBundleFixture(t, "custom_voice")
	renamedSourceDir := filepath.Join(filepath.Dir(sourceDir), "downloaded-voice-model")
	if err := os.Rename(sourceDir, renamedSourceDir); err != nil {
		t.Fatalf("rename TTS source folder: %v", err)
	}

	asset, err := svc.importLocalAssetBundleSync(context.Background(), "", &runtimev1.ImportLocalAssetBundleRequest{
		DirectoryPath: renamedSourceDir,
		Capabilities:  []string{"audio.synthesize"},
	})
	if asset != nil || err == nil {
		t.Fatalf("ambiguous TTS import asset=%+v error=%v", asset, err)
	}
	assertGRPCReasonCode(t, err, "ambiguous TTS import", runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
}

func TestImportLocalAssetBundleRejectsIncompleteCatalogTTSBundle(t *testing.T) {
	svc := newTestService(t)
	sourceDir := writeCatalogTTSBundleFixture(t, "custom_voice")
	if err := os.Remove(filepath.Join(sourceDir, "speech_tokenizer", "model.safetensors")); err != nil {
		t.Fatalf("remove nested speech tokenizer fixture: %v", err)
	}

	scan, err := scanBundleDirectory(sourceDir)
	if err != nil {
		t.Fatalf("scan incomplete TTS bundle: %v", err)
	}
	_, _, err = svc.scaffoldBundleManifest(
		filepath.Join(t.TempDir(), localAssetManifestFileName),
		"Qwen3-TTS-12Hz-0.6B-CustomVoice",
		[]string{"audio.synthesize"},
		"",
		sourceDir,
		scan,
	)
	if err == nil || !strings.Contains(err.Error(), "speech_tokenizer/model.safetensors") {
		t.Fatalf("incomplete TTS bundle error = %v, want missing nested tokenizer", err)
	}
}

func TestImportLocalAssetBundleAdmitsCloneModelForVoiceCreateAndSynthesis(t *testing.T) {
	svc := newTestService(t)
	sourceDir := writeCatalogTTSBundleFixture(t, "base")

	scan, err := scanBundleDirectory(sourceDir)
	if err != nil {
		t.Fatalf("scan clone TTS bundle: %v", err)
	}
	manifest, _, err := svc.scaffoldBundleManifest(
		filepath.Join(t.TempDir(), localAssetManifestFileName),
		"Qwen3-TTS-12Hz-0.6B-Base",
		[]string{"audio.synthesize", "voice.create"},
		"",
		sourceDir,
		scan,
	)
	if err != nil {
		t.Fatalf("clone TTS bundle scaffold: %v", err)
	}
	roles := valueAsStringSlice(manifest["artifact_roles"])
	if !stringSliceContains(roles, "tts_model") || !stringSliceContains(roles, capabilitydriver.Qwen3VoiceCloneArtifactRole) {
		t.Fatalf("clone TTS bundle roles=%v", roles)
	}
}

func writeCatalogASRBundleFixture(t *testing.T) string {
	t.Helper()
	sourceDir := filepath.Join(t.TempDir(), "Qwen3-ASR-0.6B")
	requiredFiles := []string{
		"model.safetensors",
		"config.json",
		"generation_config.json",
		"preprocessor_config.json",
		"chat_template.json",
		"tokenizer_config.json",
		"vocab.json",
		"merges.txt",
	}
	for _, relativePath := range requiredFiles {
		path := filepath.Join(sourceDir, filepath.FromSlash(relativePath))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("create ASR bundle directory: %v", err)
		}
		if err := os.WriteFile(path, []byte(relativePath), 0o644); err != nil {
			t.Fatalf("write ASR bundle file %s: %v", relativePath, err)
		}
	}
	return sourceDir
}

func TestImportLocalAssetBundleAdmitsCompleteCatalogASRBundle(t *testing.T) {
	svc := newTestService(t)
	sourceDir := writeCatalogASRBundleFixture(t)

	asset, err := svc.importLocalAssetBundleSync(context.Background(), "", &runtimev1.ImportLocalAssetBundleRequest{
		DirectoryPath: sourceDir,
		ModelName:     "Qwen3-ASR-0.6B",
		Capabilities:  []string{"audio.transcribe"},
	})
	if err != nil {
		t.Fatalf("import complete ASR bundle: %v", err)
	}
	if got := asset.GetKind(); got != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT {
		t.Fatalf("kind = %s, want STT", got)
	}
	if got := asset.GetEngine(); got != "speech" {
		t.Fatalf("engine = %q, want speech", got)
	}
	if got := asset.GetEntry(); got != "model.safetensors" {
		t.Fatalf("entry = %q, want model.safetensors", got)
	}
	for _, role := range []string{"stt_model", "tokenizer"} {
		if !stringSliceContains(asset.GetArtifactRoles(), role) {
			t.Fatalf("artifact roles = %#v, want %q", asset.GetArtifactRoles(), role)
		}
	}
	if !bundleStringSliceContains(asset.GetFiles(), "chat_template.json") {
		t.Fatalf("bundle files = %#v, missing chat template", asset.GetFiles())
	}
}

func writeCatalogTransformersASRBundleFixture(t *testing.T, modelName string) string {
	t.Helper()
	sourceDir := filepath.Join(t.TempDir(), modelName)
	for _, relativePath := range []string{
		"model.safetensors",
		"config.json",
		"generation_config.json",
		"processor_config.json",
		"chat_template.jinja",
		"tokenizer_config.json",
		"tokenizer.json",
	} {
		if err := os.MkdirAll(sourceDir, 0o755); err != nil {
			t.Fatalf("create Transformers ASR bundle directory: %v", err)
		}
		if err := os.WriteFile(filepath.Join(sourceDir, relativePath), []byte(relativePath), 0o644); err != nil {
			t.Fatalf("write Transformers ASR bundle file %s: %v", relativePath, err)
		}
	}
	return sourceDir
}

func TestImportLocalAssetBundleAdmitsTransformersNativeASRBundlesSeparately(t *testing.T) {
	for _, modelName := range []string{"Qwen3-ASR-0.6B-hf", "Qwen3-ASR-1.7B-hf"} {
		t.Run(modelName, func(t *testing.T) {
			svc := newTestService(t)
			sourceDir := writeCatalogTransformersASRBundleFixture(t, modelName)

			asset, err := svc.importLocalAssetBundleSync(context.Background(), "", &runtimev1.ImportLocalAssetBundleRequest{
				DirectoryPath: sourceDir,
				ModelName:     modelName,
				Capabilities:  []string{"audio.transcribe"},
			})
			if err != nil {
				t.Fatalf("import Transformers-native ASR bundle: %v", err)
			}
			if got := asset.GetEngine(); got != "speech" {
				t.Fatalf("engine = %q, want speech", got)
			}
			for _, role := range []string{"stt_transformers_model", "tokenizer"} {
				if !stringSliceContains(asset.GetArtifactRoles(), role) {
					t.Fatalf("artifact roles = %#v, want %q", asset.GetArtifactRoles(), role)
				}
			}
			if stringSliceContains(asset.GetArtifactRoles(), "stt_model") {
				t.Fatalf("Transformers-native ASR bundle must not satisfy package-native role: %#v", asset.GetArtifactRoles())
			}
			if !bundleStringSliceContains(asset.GetFiles(), "processor_config.json") || !bundleStringSliceContains(asset.GetFiles(), "chat_template.jinja") {
				t.Fatalf("bundle files = %#v, missing Transformers-native processor/template", asset.GetFiles())
			}
			contentID := "sha256:" + exactDeclaredContentSHA256(asset)
			descriptor, reason, candidate := svc.verifyLocalCapabilityAssetContent(
				asset,
				resolveLocalModelsPath(svc.localModelsPath),
				contentID,
			)
			if !candidate || reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
				t.Fatalf("Transformers-native ASR bundle verification candidate=%t reason=%s", candidate, reason)
			}
			if !stringSliceContains(descriptor.ArtifactRoles, "stt_transformers_model") {
				t.Fatalf("verified descriptor roles = %#v, want stt_transformers_model", descriptor.ArtifactRoles)
			}
		})
	}
}

func TestVerifyLocalCapabilityAssetRejectsSingleFileSpeechBeforeHost(t *testing.T) {
	svc := newTestService(t)
	asset := &runtimev1.LocalAssetRecord{
		LocalAssetId:  "legacy-single-file-asr",
		AssetId:       "local-import/Qwen3-ASR-1.7B-hf/01KZLEGACY",
		Kind:          runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT,
		Engine:        "speech",
		Entry:         "Qwen3-ASR-1.7B-hf.safetensors",
		Files:         []string{"Qwen3-ASR-1.7B-hf.safetensors"},
		Capabilities:  []string{"audio.transcribe"},
		ArtifactRoles: []string{"stt_model"},
		Status:        runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
	}

	_, reason, candidate := svc.verifyLocalCapabilityAssetContent(asset, resolveLocalModelsPath(svc.localModelsPath), "sha256:"+strings.Repeat("a", 64))
	if !candidate || reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("single-file ASR verification candidate=%t reason=%s, want incompatible", candidate, reason)
	}
}

func TestImportLocalAssetBundleRejectsIncompleteCatalogASRBundle(t *testing.T) {
	svc := newTestService(t)
	sourceDir := writeCatalogASRBundleFixture(t)
	if err := os.Remove(filepath.Join(sourceDir, "merges.txt")); err != nil {
		t.Fatalf("remove ASR bundle fixture: %v", err)
	}

	scan, err := scanBundleDirectory(sourceDir)
	if err != nil {
		t.Fatalf("scan incomplete ASR bundle: %v", err)
	}
	_, _, err = svc.scaffoldBundleManifest(
		filepath.Join(t.TempDir(), localAssetManifestFileName),
		"Qwen3-ASR-0.6B",
		[]string{"audio.transcribe"},
		"",
		sourceDir,
		scan,
	)
	if err == nil || !strings.Contains(err.Error(), "merges.txt") {
		t.Fatalf("incomplete ASR bundle error = %v, want missing merges", err)
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
		Capabilities:         []string{"text.generate"},
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
		Capabilities:  []string{"text.generate"},
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
