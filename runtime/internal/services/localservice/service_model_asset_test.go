package localservice

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestImportModelAssetSingleFileHasNoContentAdmission(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "community-unknown.gguf")
	payload := []byte("not a parseable GGUF, but safe content must still import")
	if err := os.WriteFile(source, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, "community")
	if !asset.GetContentVerified() || !asset.GetUnclassified() {
		t.Fatalf("trust projection = content_verified=%v unclassified=%v", asset.GetContentVerified(), asset.GetUnclassified())
	}
	wantDigest := sha256.Sum256(payload)
	if got, want := asset.GetContentId(), "sha256:"+hex.EncodeToString(wantDigest[:]); got != want {
		t.Fatalf("content_id = %q, want %q", got, want)
	}
	if asset.GetCatalogVerification() != runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_NOT_MATCHED {
		t.Fatalf("catalog verification = %v", asset.GetCatalogVerification())
	}
	if _, err := os.Stat(source); err != nil {
		t.Fatalf("external payload moved or removed: %v", err)
	}
	manifest := readModelAssetManifestMap(t, svc, asset.GetModelAssetId())
	for _, forbidden := range []string{"engine", "kind", "capability", "capabilities", "family", "recipe", "driver"} {
		if _, exists := manifest[forbidden]; exists {
			t.Fatalf("manifest contains forbidden field %q", forbidden)
		}
	}
}

func TestImportModelAssetCachesBoundedGGUFFactsWithoutSemanticAdmission(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "facts.gguf")
	if err := os.WriteFile(source, validTestGGUF(), 0o600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, "gguf-facts")
	if asset.GetUnclassified() {
		t.Fatal("valid GGUF facts were not cached")
	}
	fingerprint := asset.GetBoundedFingerprint().AsMap()
	fileFingerprints, ok := fingerprint["file_fingerprints"].([]any)
	if !ok || len(fileFingerprints) != 1 {
		t.Fatalf("bounded file fingerprints = %#v", fingerprint["file_fingerprints"])
	}
	ggufFacts, ok := fileFingerprints[0].(map[string]any)
	if !ok || ggufFacts["format"] != "gguf" || ggufFacts["tensor_count"] != "1" || ggufFacts["metadata_count"] != "3" {
		t.Fatalf("GGUF fingerprint = %#v", fileFingerprints[0])
	}
	metadata, ok := ggufFacts["metadata"].([]any)
	if !ok || len(metadata) != 3 {
		t.Fatalf("GGUF metadata facts = %#v", ggufFacts["metadata"])
	}
	architecture, ok := metadata[0].(map[string]any)
	if !ok || architecture["key"] != "general.architecture" || architecture["string_value"] != "qwen2" {
		t.Fatalf("GGUF architecture fact = %#v", metadata[0])
	}
}

func TestImportModelAssetDirectoryPreservesDistributionAndMarksCodeNonExecutable(t *testing.T) {
	svc := newTestService(t)
	source := t.TempDir()
	if err := os.WriteFile(filepath.Join(source, "model.safetensors"), minimalSafeTensorsPayload(), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(source, "tokenizer"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "tokenizer", "loader.py"), []byte("raise RuntimeError('must never execute')\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, "speech-distribution")
	if asset.GetUnclassified() {
		t.Fatal("valid safetensors header was not retained as a bounded fingerprint")
	}
	if !asset.GetContainsNonExecutableCode() {
		t.Fatal("directory code was not marked non-executable")
	}
	if got := len(asset.GetFiles()); got != 2 {
		t.Fatalf("files = %d, want 2", got)
	}
	if asset.GetEntry() != "model.safetensors" {
		t.Fatalf("entry = %q, want safe model payload", asset.GetEntry())
	}
	fingerprint := asset.GetBoundedFingerprint().AsMap()
	fileFingerprints, ok := fingerprint["file_fingerprints"].([]any)
	if !ok || len(fileFingerprints) != 1 {
		t.Fatalf("bounded file fingerprints = %#v", fingerprint["file_fingerprints"])
	}
	safeTensorsFacts, ok := fileFingerprints[0].(map[string]any)
	if !ok || safeTensorsFacts["format"] != "safetensors" || safeTensorsFacts["tensor_count"] != float64(1) {
		t.Fatalf("safetensors fingerprint = %#v", fileFingerprints[0])
	}
	tensors, ok := safeTensorsFacts["tensors"].([]any)
	if !ok || len(tensors) != 1 {
		t.Fatalf("safetensors tensor facts = %#v", safeTensorsFacts["tensors"])
	}
	tensor, ok := tensors[0].(map[string]any)
	if !ok || tensor["name"] != "tensor" || tensor["dtype"] != "F32" {
		t.Fatalf("safetensors tensor fact = %#v", tensors[0])
	}
	for _, file := range asset.GetFiles() {
		if strings.HasSuffix(file.GetRelativePath(), ".py") && !file.GetNonExecutableContent() {
			t.Fatalf("python file not marked non-executable: %+v", file)
		}
	}
	if !strings.HasPrefix(asset.GetContentId(), "sha256:") || len(asset.GetContentId()) != len("sha256:")+64 {
		t.Fatalf("ordered content id = %q", asset.GetContentId())
	}
}

func TestImportModelAssetDuplicateContentCreatesDistinctInstances(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "model.bin")
	if err := os.WriteFile(source, []byte("same distribution"), 0o600); err != nil {
		t.Fatal(err)
	}
	first := importModelAssetForTest(t, svc, source, "first")
	second := importModelAssetForTest(t, svc, source, "second")
	if first.GetModelAssetId() == second.GetModelAssetId() || first.GetContentId() != second.GetContentId() {
		t.Fatalf("duplicate identities = first=%+v second=%+v", first, second)
	}
	if first.GetDuplicateContent() || !second.GetDuplicateContent() {
		t.Fatalf("duplicate hints = first=%v second=%v", first.GetDuplicateContent(), second.GetDuplicateContent())
	}
}

func TestImportModelAssetCancelledLeavesNoResolvedResidue(t *testing.T) {
	svc := newTestService(t)
	sourcePath := filepath.Join(t.TempDir(), "cancel.bin")
	if err := os.WriteFile(sourcePath, []byte("cancel me"), 0o600); err != nil {
		t.Fatal(err)
	}
	source, err := inspectModelAssetSource(sourcePath, "cancel")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := svc.importModelAssetSync(ctx, "", "model_cancel", source); !errors.Is(err, errLocalTransferCancelled) {
		t.Fatalf("cancel error = %v", err)
	}
	resolvedEntries, err := os.ReadDir(filepath.Join(svc.localModelsPath, "resolved"))
	if err != nil {
		t.Fatal(err)
	}
	if len(resolvedEntries) != 0 {
		t.Fatalf("resolved residue = %v", resolvedEntries)
	}
	quarantineEntries, err := os.ReadDir(filepath.Join(svc.localModelsPath, "quarantine"))
	if err != nil || len(quarantineEntries) == 0 {
		t.Fatalf("quarantine evidence missing: entries=%v err=%v", quarantineEntries, err)
	}
}

func TestImportModelAssetInventoryFailureLeavesNoResolvedResidue(t *testing.T) {
	svc := newTestService(t)
	sourcePath := filepath.Join(t.TempDir(), "inventory-failure.bin")
	if err := os.WriteFile(sourcePath, []byte("inventory persistence must fail closed"), 0o600); err != nil {
		t.Fatal(err)
	}
	source, err := inspectModelAssetSource(sourcePath, "inventory-failure")
	if err != nil {
		t.Fatal(err)
	}
	svc.saveModelAssetStore = func(string, modelAssetStoreSnapshot) error {
		return errors.New("injected inventory persistence failure")
	}
	if _, err := svc.importModelAssetSync(context.Background(), "", "model_inventory_failure", source); err == nil {
		t.Fatal("expected inventory persistence failure")
	}
	resolvedEntries, err := os.ReadDir(filepath.Join(svc.localModelsPath, "resolved"))
	if err != nil {
		t.Fatal(err)
	}
	if len(resolvedEntries) != 0 {
		t.Fatalf("resolved residue = %v", resolvedEntries)
	}
	quarantineEntries, err := os.ReadDir(filepath.Join(svc.localModelsPath, "quarantine"))
	if err != nil || len(quarantineEntries) == 0 {
		t.Fatalf("quarantine evidence missing: entries=%v err=%v", quarantineEntries, err)
	}
	if len(svc.modelAssets) != 0 {
		t.Fatalf("failed import wrote inventory: %d", len(svc.modelAssets))
	}
}

func TestImportModelAssetCompletionPersistenceFailurePublishesNoModelAsset(t *testing.T) {
	svc := newTestService(t)
	sourcePath := filepath.Join(t.TempDir(), "terminal-persistence-failure.bin")
	if err := os.WriteFile(sourcePath, []byte("terminal persistence must fail closed"), 0o600); err != nil {
		t.Fatal(err)
	}
	source, err := inspectModelAssetSource(sourcePath, "terminal-persistence-failure")
	if err != nil {
		t.Fatal(err)
	}
	transfer := svc.newLocalTransfer(localTransferKindImport, localTransferMutation{
		ModelID:    "model_terminal_persistence_failure",
		Phase:      "copy",
		State:      localTransferStateRunning,
		BytesTotal: source.SizeBytes,
	})
	if err := os.Remove(svc.stateStorePath); err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if err := os.Mkdir(svc.stateStorePath, 0o700); err != nil {
		t.Fatal(err)
	}

	svc.runImportModelAsset(context.Background(), transfer.GetInstallSessionId(), "model_terminal_persistence_failure", source)
	svc.mu.RLock()
	assetCount := len(svc.modelAssets)
	svc.mu.RUnlock()
	if assetCount != 0 {
		t.Fatalf("completion persistence failure published %d ModelAssets", assetCount)
	}
	entries, readErr := os.ReadDir(filepath.Join(svc.resolvedLocalModelsPath(), "resolved"))
	if readErr != nil {
		t.Fatalf("read resolved root: %v", readErr)
	}
	if len(entries) != 0 {
		t.Fatalf("completion persistence failure retained resolved payload: %v", entries)
	}
}

func TestImportModelAssetRejectsSymlinkWithoutStateWrite(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation requires environment-specific Windows privilege")
	}
	svc := newTestService(t)
	root := t.TempDir()
	target := filepath.Join(root, "target.bin")
	link := filepath.Join(root, "link.bin")
	if err := os.WriteFile(target, []byte("payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ImportModelAsset(context.Background(), &runtimev1.ImportModelAssetRequest{SourcePath: link}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("symlink import error = %v", err)
	}
	listed, err := svc.ListModelAssets(context.Background(), &runtimev1.ListModelAssetsRequest{})
	if err != nil || len(listed.GetAssets()) != 0 {
		t.Fatalf("inventory changed: %+v err=%v", listed, err)
	}
}

func TestAdoptResolvedModelAssetIsAtomicAndIdempotentWithoutPayloadCopy(t *testing.T) {
	svc := newTestService(t)
	svc.adoptResolvedModelImports = true
	directory := filepath.Join(svc.localModelsPath, "resolved", "legacy-model")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	payloadPath := filepath.Join(directory, "model.bin")
	payload := []byte("legacy payload remains in place")
	if err := os.WriteFile(payloadPath, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	beforeInfo, _ := os.Stat(payloadPath)
	beforeHash, _ := computeImportFileSHA256(payloadPath)
	source, err := inspectModelAssetSource(directory, "legacy")
	if err != nil {
		t.Fatal(err)
	}
	asset, err := svc.importModelAssetSync(context.Background(), "", "model_must_not_replace_adopted_identity", source)
	if err != nil || asset == nil || asset.GetModelAssetId() == "model_must_not_replace_adopted_identity" {
		t.Fatalf("import adoption = asset=%+v err=%v", asset, err)
	}
	skipped := false
	again, skipped, err := svc.adoptResolvedModelAssetDirectory(context.Background(), directory, "legacy")
	if err != nil || !skipped || again.GetModelAssetId() != asset.GetModelAssetId() {
		t.Fatalf("idempotent adopt = asset=%+v skipped=%v err=%v", again, skipped, err)
	}
	afterInfo, _ := os.Stat(payloadPath)
	afterHash, _ := computeImportFileSHA256(payloadPath)
	if beforeInfo.Size() != afterInfo.Size() || beforeHash != afterHash {
		t.Fatalf("payload changed: size %d->%d hash %s->%s", beforeInfo.Size(), afterInfo.Size(), beforeHash, afterHash)
	}
}

func TestImportRegisteredResolvedDirectoryMintsNewModelAssetInstance(t *testing.T) {
	svc := newTestService(t)
	directory := filepath.Join(svc.localModelsPath, "resolved", "existing-transformers-bundle")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	modelPath := filepath.Join(directory, "model.safetensors")
	modelPayload := []byte("safe model payload")
	if err := os.WriteFile(modelPath, modelPayload, 0o600); err != nil {
		t.Fatal(err)
	}
	templatePath := filepath.Join(directory, "chat_template.jinja")
	templatePayload := []byte("safe template payload")
	if err := os.WriteFile(templatePath, templatePayload, 0o600); err != nil {
		t.Fatal(err)
	}
	existing, skipped, err := svc.adoptResolvedModelAssetDirectory(context.Background(), directory, "existing")
	if err != nil || skipped || existing == nil {
		t.Fatalf("seed existing ModelAsset: asset=%+v skipped=%v err=%v", existing, skipped, err)
	}
	beforeModelHash, err := computeImportFileSHA256(modelPath)
	if err != nil {
		t.Fatal(err)
	}
	beforeTemplateHash, err := computeImportFileSHA256(templatePath)
	if err != nil {
		t.Fatal(err)
	}

	source, err := inspectModelAssetSource(directory, "fresh import")
	if err != nil {
		t.Fatal(err)
	}
	wantPayloadBytes := int64(len(modelPayload) + len(templatePayload))
	if source.SizeBytes != wantPayloadBytes {
		t.Fatalf("source bytes = %d, want payload-only %d", source.SizeBytes, wantPayloadBytes)
	}
	imported, err := svc.importModelAssetSync(context.Background(), "", "model_fresh_import", source)
	if err != nil {
		t.Fatal(err)
	}
	if imported.GetModelAssetId() == existing.GetModelAssetId() {
		t.Fatalf("ordinary ImportModelAsset reused existing identity %q", existing.GetModelAssetId())
	}
	if imported.GetContentId() != existing.GetContentId() || !imported.GetDuplicateContent() {
		t.Fatalf("duplicate content projection = imported:%+v existing:%+v", imported, existing)
	}
	if imported.GetEntry() != "model.safetensors" {
		t.Fatalf("fresh import entry = %q, want model.safetensors", imported.GetEntry())
	}
	if len(imported.GetFiles()) != 2 {
		t.Fatalf("fresh import files = %+v, want only two payload files", imported.GetFiles())
	}
	for _, file := range imported.GetFiles() {
		if file.GetRelativePath() == localAssetManifestFileName {
			t.Fatal("Runtime manifest was re-imported as model payload")
		}
	}
	afterModelHash, _ := computeImportFileSHA256(modelPath)
	afterTemplateHash, _ := computeImportFileSHA256(templatePath)
	if afterModelHash != beforeModelHash || afterTemplateHash != beforeTemplateHash {
		t.Fatal("ordinary ImportModelAsset modified the source payload")
	}
}

func TestAdoptResolvedModelAssetFailureBoundariesConverge(t *testing.T) {
	t.Run("manifest failure writes no record", func(t *testing.T) {
		svc := newTestService(t)
		directory := makeAdoptionDirectory(t, svc, "manifest-failure")
		svc.writeModelAssetManifest = func(string, []byte) error { return errors.New("injected manifest failure") }
		if _, _, err := svc.adoptResolvedModelAssetDirectory(context.Background(), directory, "failed"); err == nil {
			t.Fatal("expected manifest failure")
		}
		if len(svc.modelAssets) != 0 {
			t.Fatalf("half record persisted: %d", len(svc.modelAssets))
		}
	})
	t.Run("inventory failure reruns to one record", func(t *testing.T) {
		svc := newTestService(t)
		directory := makeAdoptionDirectory(t, svc, "inventory-failure")
		realSave := svc.saveModelAssetStore
		svc.saveModelAssetStore = func(string, modelAssetStoreSnapshot) error { return errors.New("injected inventory failure") }
		if _, _, err := svc.adoptResolvedModelAssetDirectory(context.Background(), directory, "failed"); err == nil {
			t.Fatal("expected inventory failure")
		}
		if len(svc.modelAssets) != 0 {
			t.Fatalf("half record persisted: %d", len(svc.modelAssets))
		}
		svc.saveModelAssetStore = realSave
		asset, skipped, err := svc.adoptResolvedModelAssetDirectory(context.Background(), directory, "recovered")
		if err != nil || skipped || asset == nil || len(svc.modelAssets) != 1 {
			t.Fatalf("rerun did not converge: asset=%+v skipped=%v count=%d err=%v", asset, skipped, len(svc.modelAssets), err)
		}
	})
}

func TestModelAssetStoreIsolatesInvalidRecordAndKeepsHealthySibling(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "healthy.bin")
	if err := os.WriteFile(source, []byte("healthy"), 0o600); err != nil {
		t.Fatal(err)
	}
	healthy := importModelAssetForTest(t, svc, source, "healthy")
	statePath := svc.stateStorePath
	modelsPath := svc.localModelsPath
	storePath := svc.modelAssetStorePath
	svc.Close()

	payload, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(payload, &document); err != nil {
		t.Fatal(err)
	}
	rows, ok := document["assets"].([]any)
	if !ok {
		t.Fatalf("model asset rows = %#v", document["assets"])
	}
	document["assets"] = append(rows, map[string]any{
		"asset":            map[string]any{"model_asset_id": "model_invalid"},
		"managedDirectory": "",
	})
	poisoned, _ := json.MarshalIndent(document, "", "  ")
	if err := os.WriteFile(storePath, poisoned, 0o600); err != nil {
		t.Fatal(err)
	}

	restarted := restartModelAssetServiceForTest(t, statePath, modelsPath)
	listed, err := restarted.ListModelAssets(context.Background(), &runtimev1.ListModelAssetsRequest{})
	if err != nil || len(listed.GetAssets()) != 1 || listed.GetAssets()[0].GetModelAssetId() != healthy.GetModelAssetId() {
		t.Fatalf("healthy ModelAsset projection = %+v err=%v", listed, err)
	}
	rewritten, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatal(err)
	}
	var healthyDocument modelAssetStoreSnapshot
	if err := json.Unmarshal(rewritten, &healthyDocument); err != nil || len(healthyDocument.Assets) != 1 {
		t.Fatalf("rewritten ModelAsset store = assets=%d err=%v", len(healthyDocument.Assets), err)
	}
}

func TestModelAssetStoreIsolatesSemanticallyInvalidRecordAndKeepsHealthySibling(t *testing.T) {
	svc := newTestService(t)
	sourceA := filepath.Join(t.TempDir(), "healthy-a.bin")
	sourceB := filepath.Join(t.TempDir(), "healthy-b.bin")
	if err := os.WriteFile(sourceA, []byte("healthy-a"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(sourceB, []byte("healthy-b"), 0o600); err != nil {
		t.Fatal(err)
	}
	poisonedAsset := importModelAssetForTest(t, svc, sourceA, "semantic-invalid")
	healthy := importModelAssetForTest(t, svc, sourceB, "semantic-healthy")
	statePath := svc.stateStorePath
	modelsPath := svc.localModelsPath
	storePath := svc.modelAssetStorePath
	svc.Close()

	payload, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(payload, &document); err != nil {
		t.Fatal(err)
	}
	rows := document["assets"].([]any)
	mutated := false
	for _, raw := range rows {
		row := raw.(map[string]any)
		asset := row["asset"].(map[string]any)
		if asset["model_asset_id"] == poisonedAsset.GetModelAssetId() {
			asset["entry"] = "missing-entry.bin"
			mutated = true
		}
	}
	if !mutated {
		t.Fatal("failed to locate ModelAsset row to poison")
	}
	poisoned, _ := json.MarshalIndent(document, "", "  ")
	if err := os.WriteFile(storePath, poisoned, 0o600); err != nil {
		t.Fatal(err)
	}

	restarted := restartModelAssetServiceForTest(t, statePath, modelsPath)
	listed, err := restarted.ListModelAssets(context.Background(), &runtimev1.ListModelAssetsRequest{})
	if err != nil || len(listed.GetAssets()) != 1 || listed.GetAssets()[0].GetModelAssetId() != healthy.GetModelAssetId() {
		t.Fatalf("semantic record isolation = %+v err=%v", listed, err)
	}
}

func TestModelAssetStoreStartupDoesNotRehashPayload(t *testing.T) {
	svc := newTestService(t)
	driftedSource := filepath.Join(t.TempDir(), "digest-drifted.bin")
	healthySource := filepath.Join(t.TempDir(), "digest-healthy.bin")
	if err := os.WriteFile(driftedSource, []byte("drifted-a"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(healthySource, []byte("healthy"), 0o600); err != nil {
		t.Fatal(err)
	}
	driftedAsset := importModelAssetForTest(t, svc, driftedSource, "digest-drifted")
	healthyAsset := importModelAssetForTest(t, svc, healthySource, "digest-healthy")
	statePath := svc.stateStorePath
	modelsPath := svc.localModelsPath
	storePath := svc.modelAssetStorePath
	svc.mu.RLock()
	driftedPath := filepath.Join(svc.modelAssetDirectories[driftedAsset.GetModelAssetId()], filepath.FromSlash(driftedAsset.GetEntry()))
	svc.mu.RUnlock()
	driftedInfo, err := os.Stat(driftedPath)
	if err != nil {
		t.Fatal(err)
	}
	svc.Close()

	// Preserve size and mtime so startup can validate the durable inventory's
	// structural facts without turning that validation into another content
	// read. Job admission remains the fresh byte-integrity boundary.
	if err := os.WriteFile(driftedPath, []byte("drifted-b"), driftedInfo.Mode().Perm()); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(driftedPath, driftedInfo.ModTime(), driftedInfo.ModTime()); err != nil {
		t.Fatal(err)
	}

	restarted := restartModelAssetServiceForTest(t, statePath, modelsPath)
	listed, err := restarted.ListModelAssets(context.Background(), &runtimev1.ListModelAssetsRequest{})
	if err != nil || len(listed.GetAssets()) != 2 || !modelAssetListContainsID(listed.GetAssets(), driftedAsset.GetModelAssetId()) || !modelAssetListContainsID(listed.GetAssets(), healthyAsset.GetModelAssetId()) {
		t.Fatalf("startup structural restore = %+v err=%v", listed, err)
	}
	storePayload, err := os.ReadFile(storePath)
	if err != nil || !bytes.Contains(storePayload, []byte(driftedAsset.GetModelAssetId())) {
		t.Fatalf("startup rewrote drifted active identity: retained=%t err=%v", bytes.Contains(storePayload, []byte(driftedAsset.GetModelAssetId())), err)
	}
}

func TestModelAssetStoreStartupStillIsolatesPayloadSizeMismatch(t *testing.T) {
	svc := newTestService(t)
	driftedSource := filepath.Join(t.TempDir(), "size-drifted.bin")
	healthySource := filepath.Join(t.TempDir(), "size-healthy.bin")
	if err := os.WriteFile(driftedSource, []byte("size-drifted"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(healthySource, []byte("size-healthy"), 0o600); err != nil {
		t.Fatal(err)
	}
	driftedAsset := importModelAssetForTest(t, svc, driftedSource, "size drifted")
	healthyAsset := importModelAssetForTest(t, svc, healthySource, "size healthy")
	statePath := svc.stateStorePath
	modelsPath := svc.localModelsPath
	svc.mu.RLock()
	driftedPath := filepath.Join(svc.modelAssetDirectories[driftedAsset.GetModelAssetId()], filepath.FromSlash(driftedAsset.GetEntry()))
	svc.mu.RUnlock()
	svc.Close()

	file, err := os.OpenFile(driftedPath, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte("x")); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	restarted := restartModelAssetServiceForTest(t, statePath, modelsPath)
	listed, err := restarted.ListModelAssets(context.Background(), &runtimev1.ListModelAssetsRequest{})
	if err != nil || len(listed.GetAssets()) != 1 || listed.GetAssets()[0].GetModelAssetId() != healthyAsset.GetModelAssetId() {
		t.Fatalf("payload-size isolation = %+v err=%v", listed, err)
	}
}

func TestModelAssetStoreUnavailableResolvedRootPreservesInventory(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "root-unavailable.bin")
	if err := os.WriteFile(source, []byte("root unavailable must not erase inventory"), 0o600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, "root unavailable")
	statePath := svc.stateStorePath
	modelsPath := svc.localModelsPath
	storePath := svc.modelAssetStorePath
	resolvedRoot := filepath.Join(modelsPath, "resolved")
	offlineRoot := filepath.Join(filepath.Dir(resolvedRoot), "resolved-offline")
	svc.Close()

	if err := os.Rename(resolvedRoot, offlineRoot); err != nil {
		t.Fatalf("make resolved root unavailable: %v", err)
	}
	restarted, restartErr := NewWithProductControlDataRoot(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		nil,
		statePath,
		0,
		modelsPath,
		filepath.Dir(modelsPath),
	)
	if restartErr != nil || restarted == nil {
		t.Fatalf("startup must preserve record-only ModelAsset intent: service=%v err=%v", restarted, restartErr)
	}
	listedUnavailable, listErr := restarted.ListModelAssets(context.Background(), &runtimev1.ListModelAssetsRequest{})
	if listErr != nil || len(listedUnavailable.GetAssets()) != 1 || listedUnavailable.GetAssets()[0].GetModelAssetId() != asset.GetModelAssetId() {
		t.Fatalf("record-only ModelAsset inventory = %+v err=%v", listedUnavailable, listErr)
	}
	restarted.Close()
	storeAfter, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatal(err)
	}
	if !modelAssetStorePayloadContainsID(storeAfter, asset.GetModelAssetId()) {
		t.Fatal("root-scope unavailability removed active ModelAsset inventory")
	}
	quarantine, err := filepath.Glob(filepath.Join(
		stateQuarantineDirectory(storePath),
		filepath.Base(storePath)+".*.records.json",
	))
	if err != nil {
		t.Fatal(err)
	}
	if len(quarantine) != 0 {
		t.Fatalf("root-scope unavailability isolated %d records", len(quarantine))
	}

	if err := os.Rename(offlineRoot, resolvedRoot); err != nil {
		t.Fatalf("restore resolved root: %v", err)
	}
	again := restartModelAssetServiceForTest(t, statePath, modelsPath)
	listed, err := again.ListModelAssets(context.Background(), &runtimev1.ListModelAssetsRequest{})
	if err != nil || len(listed.GetAssets()) != 1 || listed.GetAssets()[0].GetModelAssetId() != asset.GetModelAssetId() {
		t.Fatalf("restored root inventory = %+v err=%v", listed, err)
	}
}

func TestImportModelAssetRejectsMissingModelsRootBeforeWriting(t *testing.T) {
	temp := t.TempDir()
	t.Chdir(temp)
	svc := newLoadoutTestService(t, filepath.Join(temp, "state"))
	svc.mu.Lock()
	svc.localModelsPath = ""
	svc.mu.Unlock()
	sourcePath := filepath.Join(temp, "source.bin")
	if err := os.WriteFile(sourcePath, []byte("payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	source, err := inspectModelAssetSource(sourcePath, "missing root")
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.importModelAssetSync(context.Background(), "", "model_missing_root", source)
	if grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("missing models root import error = %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(temp, "resolved")); !os.IsNotExist(statErr) {
		t.Fatalf("missing models root wrote relative resolved/: %v", statErr)
	}
}

func TestModelAssetStoreIsolatesTruncatedDocumentAndStartsEmpty(t *testing.T) {
	svc := newTestService(t)
	statePath := svc.stateStorePath
	modelsPath := svc.localModelsPath
	storePath := svc.modelAssetStorePath
	svc.Close()
	if err := os.WriteFile(storePath, []byte(`{"schemaVersion":1,"assets":[`), 0o600); err != nil {
		t.Fatal(err)
	}

	restarted := restartModelAssetServiceForTest(t, statePath, modelsPath)
	listed, err := restarted.ListModelAssets(context.Background(), &runtimev1.ListModelAssetsRequest{})
	if err != nil || len(listed.GetAssets()) != 0 {
		t.Fatalf("empty ModelAsset projection = %+v err=%v", listed, err)
	}
	quarantinePaths, err := filepath.Glob(filepath.Join(stateQuarantineDirectory(storePath), filepath.Base(storePath)+".*.document.json"))
	if err != nil || len(quarantinePaths) != 1 {
		t.Fatalf("preserved ModelAsset document snapshots = %v, err=%v", quarantinePaths, err)
	}
}

func TestInspectUnreferencedModelAssetRemovalNeverDeletes(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "unreferenced.bin")
	if err := os.WriteFile(source, []byte("inspect only"), 0o600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, "unreferenced")
	inspection, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: asset.GetModelAssetId()})
	if err != nil || !inspection.GetConfirmationRequired() || len(inspection.GetReferencingLoadoutIds()) != 0 {
		t.Fatalf("inspection = %+v err=%v", inspection, err)
	}
	if _, err := svc.GetModelAsset(context.Background(), &runtimev1.GetModelAssetRequest{ModelAssetId: asset.GetModelAssetId()}); err != nil {
		t.Fatalf("inspection removed unreferenced asset: %v", err)
	}
}

func TestRemoveModelAssetEnumeratesReferencesAndPersistsCleanup(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "shared.bin")
	if err := os.WriteFile(source, []byte("shared"), 0o600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, "shared")
	svc.mu.Lock()
	svc.loadouts["loadout-a"] = &runtimev1.Loadout{
		LoadoutId: "loadout-a",
		ModelAxes: []*runtimev1.LoadoutModelAxis{{SlotId: "main", ModelAssetId: asset.GetModelAssetId(), ExpectedContentId: asset.GetContentId()}},
	}
	svc.mu.Unlock()
	inspection, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: asset.GetModelAssetId()})
	if err != nil || !inspection.GetConfirmationRequired() || len(inspection.GetReferencingLoadoutIds()) != 1 {
		t.Fatalf("inspection = %+v err=%v", inspection, err)
	}
	if _, err := svc.GetModelAsset(context.Background(), &runtimev1.GetModelAssetRequest{ModelAssetId: asset.GetModelAssetId()}); err != nil {
		t.Fatalf("inspection removed asset: %v", err)
	}
	svc.removeModelAssetDirectory = func(string) error { return errors.New("injected cleanup failure") }
	removed, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: asset.GetModelAssetId(), Force: true})
	if err != nil || !removed.GetCleanupPending() {
		t.Fatalf("force removal = %+v err=%v", removed, err)
	}
	if _, exists := svc.modelAssetCleanupObligations[asset.GetModelAssetId()]; !exists {
		t.Fatal("durable cleanup obligation missing")
	}
}

func TestModelAssetCleanupObligationRetriesAfterServiceRestart(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "restart-cleanup.bin")
	if err := os.WriteFile(source, []byte("restart cleanup"), 0o600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, "restart-cleanup")
	svc.mu.RLock()
	managedDirectory := svc.modelAssetDirectories[asset.GetModelAssetId()]
	svc.mu.RUnlock()
	svc.removeModelAssetDirectory = func(string) error { return errors.New("injected cleanup failure") }
	removed, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: asset.GetModelAssetId(), Force: true})
	if err != nil || !removed.GetCleanupPending() {
		t.Fatalf("force removal = %+v err=%v", removed, err)
	}
	statePath := svc.stateStorePath
	runtimeRoot := filepath.Dir(svc.localModelsPath)
	svc.Close()

	restarted, err := NewWithProductControlDataRoot(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		nil,
		statePath,
		0,
		filepath.Join(runtimeRoot, "models"),
		runtimeRoot,
	)
	if err != nil {
		t.Fatalf("restart local service: %v", err)
	}
	defer restarted.Close()
	if _, err := os.Stat(managedDirectory); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("cleanup directory survived restart: %v", err)
	}
	restarted.mu.RLock()
	obligationCount := len(restarted.modelAssetCleanupObligations)
	restarted.mu.RUnlock()
	if obligationCount != 0 {
		t.Fatalf("cleanup obligations after restart = %d", obligationCount)
	}
}

func TestModelAssetCleanupObligationNeverDeletesReplacementDirectoryOwner(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "cleanup-generation.bin")
	if err := os.WriteFile(source, []byte("old-generation"), 0o600); err != nil {
		t.Fatal(err)
	}
	removedAsset := importModelAssetForTest(t, svc, source, "cleanup-generation")
	svc.mu.RLock()
	managedDirectory := svc.modelAssetDirectories[removedAsset.GetModelAssetId()]
	svc.mu.RUnlock()
	svc.removeModelAssetDirectory = func(string) error { return errors.New("injected first cleanup failure") }
	removed, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: removedAsset.GetModelAssetId(), Force: true})
	if err != nil || !removed.GetCleanupPending() {
		t.Fatalf("force removal = %+v err=%v", removed, err)
	}

	entryPath := filepath.Join(managedDirectory, filepath.FromSlash(removedAsset.GetEntry()))
	replacementBytes := []byte("new-generation")
	if err := os.WriteFile(entryPath, replacementBytes, 0o600); err != nil {
		t.Fatal(err)
	}
	replacement, skipped, err := svc.adoptResolvedModelAssetDirectory(context.Background(), managedDirectory, "replacement generation")
	if err != nil || skipped || replacement.GetModelAssetId() == removedAsset.GetModelAssetId() {
		t.Fatalf("adopt replacement generation = %+v skipped=%v err=%v", replacement, skipped, err)
	}
	svc.removeModelAssetDirectory = os.RemoveAll
	if completed := svc.completeModelAssetCleanup(removedAsset.GetModelAssetId()); !completed {
		t.Fatal("superseded cleanup obligation did not terminalize")
	}
	if _, err := os.Stat(managedDirectory); err != nil {
		t.Fatalf("superseded cleanup deleted replacement directory: %v", err)
	}
	preserved, err := os.ReadFile(entryPath)
	if err != nil || !bytes.Equal(preserved, replacementBytes) {
		t.Fatalf("replacement payload changed: bytes=%q err=%v", preserved, err)
	}
	if current, err := svc.GetModelAsset(context.Background(), &runtimev1.GetModelAssetRequest{ModelAssetId: replacement.GetModelAssetId()}); err != nil || current.GetAsset().GetContentId() != replacement.GetContentId() {
		t.Fatalf("replacement owner changed: %+v err=%v", current, err)
	}
	svc.mu.RLock()
	obligation, exists := svc.modelAssetCleanupObligations[removedAsset.GetModelAssetId()]
	svc.mu.RUnlock()
	if !exists || !obligation.Terminal || obligation.TerminalReason != modelAssetCleanupOwnerChangedReason || obligation.Attempts != 1 {
		t.Fatalf("superseded cleanup diagnostic = %+v, exists=%v", obligation, exists)
	}

	statePath := svc.stateStorePath
	runtimeRoot := filepath.Dir(svc.localModelsPath)
	svc.Close()
	restarted, err := NewWithProductControlDataRoot(
		slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath, 0,
		filepath.Join(runtimeRoot, "models"), runtimeRoot,
	)
	if err != nil {
		t.Fatalf("restart local service: %v", err)
	}
	defer restarted.Close()
	preserved, err = os.ReadFile(entryPath)
	if err != nil || !bytes.Equal(preserved, replacementBytes) {
		t.Fatalf("restart cleanup changed replacement payload: bytes=%q err=%v", preserved, err)
	}
	if current, err := restarted.GetModelAsset(context.Background(), &runtimev1.GetModelAssetRequest{ModelAssetId: replacement.GetModelAssetId()}); err != nil || current.GetAsset().GetContentId() != replacement.GetContentId() {
		t.Fatalf("restart replacement owner changed: %+v err=%v", current, err)
	}
	restarted.mu.RLock()
	persistedObligation := restarted.modelAssetCleanupObligations[removedAsset.GetModelAssetId()]
	restarted.mu.RUnlock()
	if !persistedObligation.Terminal || persistedObligation.TerminalReason != modelAssetCleanupOwnerChangedReason {
		t.Fatalf("restart lost superseded cleanup diagnostic: %+v", persistedObligation)
	}
}

func TestModelAssetCleanupObligationPreservesChangedUnownedGeneration(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "cleanup-content.bin")
	if err := os.WriteFile(source, []byte("old-content"), 0o600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, "cleanup-content")
	svc.mu.RLock()
	managedDirectory := svc.modelAssetDirectories[asset.GetModelAssetId()]
	svc.mu.RUnlock()
	svc.removeModelAssetDirectory = func(string) error { return errors.New("injected first cleanup failure") }
	if removed, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: asset.GetModelAssetId(), Force: true}); err != nil || !removed.GetCleanupPending() {
		t.Fatalf("force removal = %+v err=%v", removed, err)
	}
	entryPath := filepath.Join(managedDirectory, filepath.FromSlash(asset.GetEntry()))
	changed := []byte("new-content")
	if err := os.WriteFile(entryPath, changed, 0o600); err != nil {
		t.Fatal(err)
	}
	svc.removeModelAssetDirectory = os.RemoveAll
	if completed := svc.completeModelAssetCleanup(asset.GetModelAssetId()); !completed {
		t.Fatal("changed cleanup generation did not terminalize")
	}
	preserved, err := os.ReadFile(entryPath)
	if err != nil || !bytes.Equal(preserved, changed) {
		t.Fatalf("changed unowned generation was deleted: bytes=%q err=%v", preserved, err)
	}
	svc.mu.RLock()
	obligation := svc.modelAssetCleanupObligations[asset.GetModelAssetId()]
	svc.mu.RUnlock()
	if !obligation.Terminal || obligation.TerminalReason != modelAssetCleanupGenerationChangedReason {
		t.Fatalf("changed generation cleanup diagnostic = %+v", obligation)
	}
}

func restartModelAssetServiceForTest(t *testing.T, statePath string, modelsPath string) *Service {
	t.Helper()
	runtimeRoot := filepath.Dir(modelsPath)
	svc, err := NewWithProductControlDataRoot(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		nil,
		statePath,
		0,
		modelsPath,
		runtimeRoot,
	)
	if err != nil {
		t.Fatalf("restart local service: %v", err)
	}
	t.Cleanup(svc.Close)
	return svc
}

func modelAssetListContainsID(assets []*runtimev1.ModelAssetRecord, id string) bool {
	for _, asset := range assets {
		if asset.GetModelAssetId() == id {
			return true
		}
	}
	return false
}

func modelAssetStorePayloadContainsID(payload []byte, id string) bool {
	return id != "" && bytes.Contains(payload, []byte(id))
}

func importModelAssetForTest(t *testing.T, svc *Service, sourcePath string, displayName string) *runtimev1.ModelAssetRecord {
	t.Helper()
	source, err := inspectModelAssetSource(sourcePath, displayName)
	if err != nil {
		t.Fatal(err)
	}
	asset, err := svc.importModelAssetSync(context.Background(), "", "model_"+strings.ToLower(strings.ReplaceAll(displayName, " ", "_"))+"_"+strings.ToLower(ulidSuffixForTest(t)), source)
	if err != nil {
		t.Fatal(err)
	}
	return asset
}

func ulidSuffixForTest(t *testing.T) string {
	t.Helper()
	return strings.ReplaceAll(t.Name(), "/", "_") + "_" + randomTestSuffix()
}

func randomTestSuffix() string {
	payload := sha256.Sum256([]byte(strings.Join([]string{runtime.GOOS, runtime.GOARCH, nowISO()}, "|")))
	return hex.EncodeToString(payload[:4])
}

func readModelAssetManifestMap(t *testing.T, svc *Service, modelAssetID string) map[string]any {
	t.Helper()
	svc.mu.RLock()
	directory := svc.modelAssetDirectories[modelAssetID]
	svc.mu.RUnlock()
	payload, err := os.ReadFile(filepath.Join(directory, localAssetManifestFileName))
	if err != nil {
		t.Fatal(err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(payload, &manifest); err != nil {
		t.Fatal(err)
	}
	return manifest
}

func minimalSafeTensorsPayload() []byte {
	header := []byte(`{"tensor":{"dtype":"F32","shape":[1],"data_offsets":[0,4]}}`)
	payload := make([]byte, 8+len(header)+4)
	binary.LittleEndian.PutUint64(payload[:8], uint64(len(header)))
	copy(payload[8:], header)
	copy(payload[8+len(header):], []byte{0, 0, 0, 0})
	return payload
}

func makeAdoptionDirectory(t *testing.T, svc *Service, name string) string {
	t.Helper()
	directory := filepath.Join(svc.localModelsPath, "resolved", name)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "model.bin"), []byte(name), 0o600); err != nil {
		t.Fatal(err)
	}
	return directory
}

func TestModelAssetContentIDUsesCanonicalRelativePathOrderForQwenSpeechBundle(t *testing.T) {
	files := []*runtimev1.ModelAssetFile{
		{RelativePath: "model.safetensors", Sha256: strings.Repeat("a", 64)},
		{RelativePath: "config.json", Sha256: strings.Repeat("b", 64)},
		{RelativePath: "speech_tokenizer/model.safetensors", Sha256: strings.Repeat("c", 64)},
	}
	const want = "sha256:4a9ad32c68b9ff1e0abfe12ebda22c69e5695a2e7b4e5264c901cbc0b5887803"
	if got := modelAssetContentID(files); got != want {
		t.Fatalf("Qwen speech content ID = %q, want catalog identity %q", got, want)
	}
	hashes := make(map[string]string, len(files))
	for _, file := range files {
		hashes[file.GetRelativePath()] = file.GetSha256()
	}
	if got := resolvedPayloadContentID(hashes); got != want {
		t.Fatalf("recovery content ID = %q, want canonical ModelAsset identity %q", got, want)
	}
}
