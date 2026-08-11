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

func TestImportLocalAssetBundleCanonicalizesUniqueTTSDescriptorAcrossFolderNames(t *testing.T) {
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
	if err != nil {
		t.Fatalf("import TTS bundle from arbitrary folder name: %v", err)
	}
	if got := asset.GetAssetId(); got != "local-import/Qwen3-TTS-12Hz-0.6B-CustomVoice" {
		t.Fatalf("asset id = %q, want canonical verified bundle import identity", got)
	}
	if got := asset.GetLogicalModelId(); got != defaultLogicalModelID("local-import/downloaded-voice-model") {
		t.Fatalf("logical model id = %q, want renamed-folder provenance", got)
	}

	contentID := "sha256:" + exactDeclaredContentSHA256(asset)
	descriptor, reason, candidate := svc.verifyLocalCapabilityAssetContent(
		asset,
		resolveLocalModelsPath(svc.localModelsPath),
		contentID,
	)
	if !candidate || reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatalf("renamed TTS bundle verification candidate=%t reason=%s", candidate, reason)
	}
	if !stringSliceContains(descriptor.ArtifactRoles, "tts_model") {
		t.Fatalf("verified descriptor roles = %#v, want tts_model", descriptor.ArtifactRoles)
	}
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

func TestImportLocalAssetBundleRejectsCloneModelForPlainSynthesis(t *testing.T) {
	svc := newTestService(t)
	sourceDir := writeCatalogTTSBundleFixture(t, "base")

	scan, err := scanBundleDirectory(sourceDir)
	if err != nil {
		t.Fatalf("scan clone TTS bundle: %v", err)
	}
	_, _, err = svc.scaffoldBundleManifest(
		filepath.Join(t.TempDir(), localAssetManifestFileName),
		"Qwen3-TTS-12Hz-0.6B-CustomVoice",
		[]string{"audio.synthesize"},
		"",
		sourceDir,
		scan,
	)
	if err == nil || !strings.Contains(err.Error(), "plain synthesis requires tts_model_type custom_voice") {
		t.Fatalf("clone TTS bundle error = %v, want plain-synthesis rejection", err)
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
