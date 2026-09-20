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

func TestImportModelAssetEquivalentDistributionReusesAsset(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "model.bin")
	if err := os.WriteFile(source, []byte("same distribution"), 0o600); err != nil {
		t.Fatal(err)
	}
	first := importModelAssetForTest(t, svc, source, "first")
	second := importModelAssetForTest(t, svc, source, "second")
	if first.GetModelAssetId() != second.GetModelAssetId() || first.GetContentId() != second.GetContentId() {
		t.Fatalf("equivalent import minted a second identity: first=%+v second=%+v", first, second)
	}
	if second.GetDisplayName() != "first" {
		t.Fatalf("repeat import overwrote the original display name: %q", second.GetDisplayName())
	}
	if len(svc.modelAssets) != 1 {
		t.Fatalf("inventory count = %d, want 1", len(svc.modelAssets))
	}
	entries, err := os.ReadDir(filepath.Join(svc.localModelsPath, "resolved"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("resolved views = %v err=%v, want exactly one", entries, err)
	}
}

func TestImportModelAssetDifferentLayoutSharesObjectButKeepsOwnView(t *testing.T) {
	svc := newTestService(t)
	payload := []byte("shared bytes, different names")
	sourceA := filepath.Join(t.TempDir(), "a.bin")
	sourceB := filepath.Join(t.TempDir(), "b.bin")
	if err := os.WriteFile(sourceA, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(sourceB, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	first := importModelAssetForTest(t, svc, sourceA, "a")
	second := importModelAssetForTest(t, svc, sourceB, "b")
	if first.GetModelAssetId() == second.GetModelAssetId() {
		t.Fatal("different layouts were merged into one asset")
	}
	if first.GetContentId() != second.GetContentId() {
		t.Fatalf("public content ids differ for identical bytes: %q vs %q", first.GetContentId(), second.GetContentId())
	}
	viewA := filepath.Join(svc.modelAssetDirectories[first.GetModelAssetId()], "a.bin")
	viewB := filepath.Join(svc.modelAssetDirectories[second.GetModelAssetId()], "b.bin")
	identityA, _, err := modelFileIdentityOf(viewA)
	if err != nil {
		t.Fatal(err)
	}
	identityB, _, err := modelFileIdentityOf(viewB)
	if err != nil {
		t.Fatal(err)
	}
	if identityA != identityB {
		t.Fatalf("views do not share one physical object: %s vs %s", identityA, identityB)
	}
	objectPath, err := modelObjectPath(svc.localModelsPath, first.GetFiles()[0].GetSha256())
	if err != nil {
		t.Fatal(err)
	}
	objectIdentity, _, err := modelFileIdentityOf(objectPath)
	if err != nil || objectIdentity != identityA {
		t.Fatalf("published object identity = %s err=%v, want %s", objectIdentity, err, identityA)
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
	if _, err := svc.importModelAssetSync(ctx, "", source); !errors.Is(err, errLocalTransferCancelled) {
		t.Fatalf("cancel error = %v", err)
	}
	resolvedEntries, err := os.ReadDir(filepath.Join(svc.localModelsPath, "resolved"))
	if err != nil {
		t.Fatal(err)
	}
	if len(resolvedEntries) != 0 {
		t.Fatalf("resolved residue = %v", resolvedEntries)
	}
	if len(svc.modelAssets) != 0 {
		t.Fatalf("cancelled import wrote inventory: %d", len(svc.modelAssets))
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
	if _, err := svc.importModelAssetSync(context.Background(), "", source); err == nil {
		t.Fatal("expected inventory persistence failure")
	}
	resolvedEntries, err := os.ReadDir(filepath.Join(svc.localModelsPath, "resolved"))
	if err != nil {
		t.Fatal(err)
	}
	if len(resolvedEntries) != 0 {
		t.Fatalf("resolved residue = %v", resolvedEntries)
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
	transfer := newImportTransferForTest(t, svc, source)
	if err := os.Remove(svc.stateStorePath); err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if err := os.Mkdir(svc.stateStorePath, 0o700); err != nil {
		t.Fatal(err)
	}

	svc.runImportModelAsset(context.Background(), transfer.GetInstallSessionId(), source)
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

func TestAdoptResolvedModelAssetRecoversManagedViewWithoutPayloadCopy(t *testing.T) {
	svc := newTestService(t)
	svc.adoptResolvedModelImports = true
	source := filepath.Join(t.TempDir(), "recover.bin")
	payload := []byte("managed view payload remains in place")
	if err := os.WriteFile(source, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, "recover")
	directory := svc.modelAssetDirectories[asset.GetModelAssetId()]
	payloadPath := filepath.Join(directory, "recover.bin")
	beforeIdentity, beforeInfo, err := modelFileIdentityOf(payloadPath)
	if err != nil {
		t.Fatal(err)
	}
	forgetModelAssetInventoryForTest(t, svc, asset.GetModelAssetId())

	recovered, skipped, err := svc.adoptResolvedModelAssetDirectory(context.Background(), directory, "ignored display name")
	if err != nil || skipped || recovered.GetModelAssetId() != asset.GetModelAssetId() {
		t.Fatalf("recover managed view = asset=%+v skipped=%v err=%v", recovered, skipped, err)
	}
	if recovered.GetDisplayName() != "recover" {
		t.Fatalf("recovery replaced the manifest display name: %q", recovered.GetDisplayName())
	}
	again, skipped, err := svc.adoptResolvedModelAssetDirectory(context.Background(), directory, "recover")
	if err != nil || !skipped || again.GetModelAssetId() != asset.GetModelAssetId() {
		t.Fatalf("idempotent recovery = asset=%+v skipped=%v err=%v", again, skipped, err)
	}
	afterIdentity, afterInfo, err := modelFileIdentityOf(payloadPath)
	if err != nil || afterIdentity != beforeIdentity || afterInfo.Size() != beforeInfo.Size() {
		t.Fatalf("recovery changed the view file: before=%s after=%s err=%v", beforeIdentity, afterIdentity, err)
	}
	source2, err := inspectModelAssetSource(directory, "resolved-dir-import")
	if err != nil {
		t.Fatal(err)
	}
	viaImport, err := svc.importModelAssetSync(context.Background(), "", source2)
	if err != nil || viaImport.GetModelAssetId() != asset.GetModelAssetId() {
		t.Fatalf("recovery import of a managed view = %+v err=%v, want the manifest identity", viaImport, err)
	}
}

func TestImportRegisteredViewDirectoryReturnsEquivalentAsset(t *testing.T) {
	svc := newTestService(t)
	sourceRoot := t.TempDir()
	modelPayload := []byte("safe model payload")
	templatePayload := []byte("safe template payload")
	if err := os.WriteFile(filepath.Join(sourceRoot, "model.safetensors"), modelPayload, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourceRoot, "chat_template.jinja"), templatePayload, 0o600); err != nil {
		t.Fatal(err)
	}
	existing := importModelAssetForTest(t, svc, sourceRoot, "existing")
	directory := svc.modelAssetDirectories[existing.GetModelAssetId()]
	modelPath := filepath.Join(directory, "model.safetensors")
	beforeModelHash, err := computeImportFileSHA256(modelPath)
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
	imported, err := svc.importModelAssetSync(context.Background(), "", source)
	if err != nil {
		t.Fatal(err)
	}
	if imported.GetModelAssetId() != existing.GetModelAssetId() {
		t.Fatalf("importing a committed view produced a second asset %q", imported.GetModelAssetId())
	}
	if imported.GetEntry() != "model.safetensors" || len(imported.GetFiles()) != 2 {
		t.Fatalf("equivalent import projection = %+v", imported)
	}
	for _, file := range imported.GetFiles() {
		if file.GetRelativePath() == localAssetManifestFileName {
			t.Fatal("Runtime manifest was treated as model payload")
		}
	}
	afterModelHash, _ := computeImportFileSHA256(modelPath)
	if afterModelHash != beforeModelHash {
		t.Fatal("equivalent import modified the managed view")
	}
	if len(svc.modelAssets) != 1 {
		t.Fatalf("inventory count = %d, want 1", len(svc.modelAssets))
	}
}

func TestAdoptResolvedModelAssetFailureBoundariesConverge(t *testing.T) {
	t.Run("unlinked view is a reconciliation conflict", func(t *testing.T) {
		svc := newTestService(t)
		directory, asset := makeAdoptionDirectory(t, svc, "unlinked")
		viewPath := filepath.Join(directory, "model.bin")
		payload, err := os.ReadFile(viewPath)
		if err != nil {
			t.Fatal(err)
		}
		// Expand the link: same bytes, new inode, object still present.
		if err := os.Remove(viewPath); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(viewPath, payload, 0o600); err != nil {
			t.Fatal(err)
		}
		_, _, err = svc.adoptResolvedModelAssetDirectory(context.Background(), directory, "failed")
		var reconciliation *modelAssetReconciliationError
		if !errors.As(err, &reconciliation) {
			t.Fatalf("unlinked view adoption error = %v, want reconciliation conflict", err)
		}
		if len(svc.modelAssets) != 0 {
			t.Fatalf("half record persisted: %d", len(svc.modelAssets))
		}
		_ = asset
	})
	t.Run("inventory failure reruns to one record", func(t *testing.T) {
		svc := newTestService(t)
		directory, asset := makeAdoptionDirectory(t, svc, "inventory-failure")
		realSave := svc.saveModelAssetStore
		svc.saveModelAssetStore = func(string, modelAssetStoreSnapshot) error { return errors.New("injected inventory failure") }
		if _, _, err := svc.adoptResolvedModelAssetDirectory(context.Background(), directory, "failed"); err == nil {
			t.Fatal("expected inventory failure")
		}
		if len(svc.modelAssets) != 0 {
			t.Fatalf("half record persisted: %d", len(svc.modelAssets))
		}
		svc.saveModelAssetStore = realSave
		recovered, skipped, err := svc.adoptResolvedModelAssetDirectory(context.Background(), directory, "recovered")
		if err != nil || skipped || recovered == nil || recovered.GetModelAssetId() != asset.GetModelAssetId() || len(svc.modelAssets) != 1 {
			t.Fatalf("rerun did not converge: asset=%+v skipped=%v count=%d err=%v", recovered, skipped, len(svc.modelAssets), err)
		}
	})
	t.Run("missing object is taken over from the view without copying", func(t *testing.T) {
		svc := newTestService(t)
		directory, asset := makeAdoptionDirectory(t, svc, "missing-object")
		objectPath, err := modelObjectPath(svc.localModelsPath, asset.GetFiles()[0].GetSha256())
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(objectPath); err != nil {
			t.Fatal(err)
		}
		viewIdentity, _, err := modelFileIdentityOf(filepath.Join(directory, "model.bin"))
		if err != nil {
			t.Fatal(err)
		}
		recovered, skipped, err := svc.adoptResolvedModelAssetDirectory(context.Background(), directory, "recovered")
		if err != nil || skipped || recovered.GetModelAssetId() != asset.GetModelAssetId() {
			t.Fatalf("takeover adoption = asset=%+v skipped=%v err=%v", recovered, skipped, err)
		}
		objectIdentity, _, err := modelFileIdentityOf(objectPath)
		if err != nil || objectIdentity != viewIdentity {
			t.Fatalf("takeover published object identity = %s err=%v, want view identity %s", objectIdentity, err, viewIdentity)
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
	_, err = svc.importModelAssetSync(context.Background(), "", source)
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
	release := svc.acquireModelAssetUse(asset.GetModelAssetId(), "job:test")
	removed, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: asset.GetModelAssetId(), Force: true})
	if err != nil || !removed.GetCleanupPending() {
		t.Fatalf("force removal = %+v err=%v", removed, err)
	}
	obligation, exists := svc.modelAssetCleanupObligations[asset.GetModelAssetId()]
	if !exists || obligation.Phase != modelAssetCleanupPhaseWaitUsers || len(obligation.Files) != 1 || obligation.Files[0].Identity == nil {
		t.Fatalf("durable cleanup obligation = %+v exists=%v", obligation, exists)
	}
	directory := obligation.ManagedDirectory
	if _, err := os.Stat(filepath.Join(directory, "shared.bin")); err != nil {
		t.Fatalf("view removed while a user still held it: %v", err)
	}
	release()
	if _, exists := svc.modelAssetCleanupObligations[asset.GetModelAssetId()]; exists {
		t.Fatalf("cleanup obligation survived release: %+v", svc.modelAssetCleanupObligations[asset.GetModelAssetId()])
	}
	if _, err := os.Stat(directory); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("view directory survived cleanup: %v", err)
	}
	objectPath, _ := modelObjectPath(svc.localModelsPath, asset.GetFiles()[0].GetSha256())
	if _, err := os.Stat(objectPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unreferenced object survived reclamation: %v", err)
	}
}

func TestRemoveModelAssetKeepsObjectSharedByAnotherDistribution(t *testing.T) {
	svc := newTestService(t)
	payload := []byte("shared object bytes")
	sourceA := filepath.Join(t.TempDir(), "a.bin")
	sourceB := filepath.Join(t.TempDir(), "b.bin")
	for _, path := range []string{sourceA, sourceB} {
		if err := os.WriteFile(path, payload, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	first := importModelAssetForTest(t, svc, sourceA, "a")
	second := importModelAssetForTest(t, svc, sourceB, "b")
	removed, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: first.GetModelAssetId(), Force: true})
	if err != nil || removed.GetCleanupPending() {
		t.Fatalf("remove first distribution = %+v err=%v", removed, err)
	}
	objectPath, _ := modelObjectPath(svc.localModelsPath, second.GetFiles()[0].GetSha256())
	if _, err := os.Stat(objectPath); err != nil {
		t.Fatalf("shared object was reclaimed while another distribution references it: %v", err)
	}
	viewB := filepath.Join(svc.modelAssetDirectories[second.GetModelAssetId()], "b.bin")
	got, err := os.ReadFile(viewB)
	if err != nil || !bytes.Equal(got, payload) {
		t.Fatalf("surviving distribution unreadable: bytes=%q err=%v", got, err)
	}
	if err := svc.verifyManagedModelAssetView(context.Background(), svc.localModelsPath, second, svc.modelAssetDirectories[second.GetModelAssetId()], nil); err != nil {
		t.Fatalf("surviving view failed verification: %v", err)
	}
	if removed, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: second.GetModelAssetId(), Force: true}); err != nil || removed.GetCleanupPending() {
		t.Fatalf("remove last distribution = %+v err=%v", removed, err)
	}
	if _, err := os.Stat(objectPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("object survived after its last reference was released: %v", err)
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
	_ = svc.acquireModelAssetUse(asset.GetModelAssetId(), "host:test")
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
	if _, err := os.Stat(managedDirectory); err != nil {
		t.Fatalf("reclamation ran before the composition root opened it: %v", err)
	}
	restarted.OpenModelAssetReclamation()
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

func TestModelAssetCleanupObligationRejectsRemovedIdentityRecovery(t *testing.T) {
	svc := newTestService(t)
	svc.adoptResolvedModelImports = true
	source := filepath.Join(t.TempDir(), "cleanup-generation.bin")
	if err := os.WriteFile(source, []byte("old-generation"), 0o600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, "cleanup-generation")
	svc.mu.RLock()
	directory := svc.modelAssetDirectories[asset.GetModelAssetId()]
	svc.mu.RUnlock()
	release := svc.acquireModelAssetUse(asset.GetModelAssetId(), "job:hold")
	removed, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: asset.GetModelAssetId(), Force: true})
	if err != nil || !removed.GetCleanupPending() {
		t.Fatalf("removal = %+v err=%v", removed, err)
	}
	if _, _, err := svc.adoptResolvedModelAssetDirectory(context.Background(), directory, "recovery"); err == nil {
		t.Fatal("recovery resurrected the identity awaiting cleanup")
	}
	entryPath := filepath.Join(directory, filepath.FromSlash(asset.GetEntry()))
	if _, err := os.Stat(entryPath); err != nil {
		t.Fatalf("pinned view disappeared: %v", err)
	}
	release()
	if _, err := os.Stat(directory); !os.IsNotExist(err) {
		t.Fatalf("released view remains: %v", err)
	}
	statePath, runtimeRoot := svc.stateStorePath, filepath.Dir(svc.localModelsPath)
	svc.Close()
	restarted, err := NewWithProductControlDataRoot(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath, 0, filepath.Join(runtimeRoot, "models"), runtimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	restarted.OpenModelAssetReclamation()
	if _, err := restarted.GetModelAsset(context.Background(), &runtimev1.GetModelAssetRequest{ModelAssetId: asset.GetModelAssetId()}); err == nil {
		t.Fatal("restart recovered a removed identity")
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
	release := svc.acquireModelAssetUse(asset.GetModelAssetId(), "job:hold")
	if removed, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: asset.GetModelAssetId(), Force: true}); err != nil || !removed.GetCleanupPending() {
		t.Fatalf("force removal = %+v err=%v", removed, err)
	}
	entryPath := filepath.Join(managedDirectory, filepath.FromSlash(asset.GetEntry()))
	// A new physical generation at the captured path: remove and recreate.
	if err := os.Remove(entryPath); err != nil {
		t.Fatal(err)
	}
	changed := []byte("new-content")
	if err := os.WriteFile(entryPath, changed, 0o600); err != nil {
		t.Fatal(err)
	}
	release()
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

func TestModelAssetStoreParseableOlderVersionRestrictsDomainWithoutRewriting(t *testing.T) {
	svc := newTestService(t)
	statePath := svc.stateStorePath
	modelsPath := svc.localModelsPath
	storePath := svc.modelAssetStorePath
	svc.Close()
	legacy := []byte(`{"schemaVersion":1,"savedAt":"2026-01-01T00:00:00Z","assets":[]}`)
	if err := os.WriteFile(storePath, legacy, 0o600); err != nil {
		t.Fatal(err)
	}
	restarted := restartModelAssetServiceForTest(t, statePath, modelsPath)
	if restriction := restarted.ModelAssetInventoryRestriction(); restriction == nil || restriction.SchemaVersion != 1 {
		t.Fatalf("restriction = %+v, want schema 1 offline conversion", restriction)
	}
	_, err := restarted.ListModelAssets(context.Background(), &runtimev1.ListModelAssetsRequest{})
	if grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOCAL_MODEL_STATE_OFFLINE_CONVERSION_REQUIRED {
		t.Fatalf("restricted inventory list error = %v", err)
	}
	source := filepath.Join(t.TempDir(), "blocked.bin")
	if err := os.WriteFile(source, []byte("blocked"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.ImportModelAsset(context.Background(), &runtimev1.ImportModelAssetRequest{SourcePath: source}); grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOCAL_MODEL_STATE_OFFLINE_CONVERSION_REQUIRED {
		t.Fatalf("restricted import error = %v", err)
	}
	after, err := os.ReadFile(storePath)
	if err != nil || !bytes.Equal(after, legacy) {
		t.Fatalf("restricted inventory was rewritten or isolated: err=%v same=%v", err, bytes.Equal(after, legacy))
	}
	quarantinePaths, _ := filepath.Glob(filepath.Join(stateQuarantineDirectory(storePath), filepath.Base(storePath)+".*"))
	if len(quarantinePaths) != 0 {
		t.Fatalf("restricted inventory produced quarantine artifacts: %v", quarantinePaths)
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
	asset, err := svc.importModelAssetSync(context.Background(), "", source)
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

// makeAdoptionDirectory creates a committed managed view and then forgets
// its inventory row, leaving a valid manifest directory for recovery tests.
func makeAdoptionDirectory(t *testing.T, svc *Service, name string) (string, *runtimev1.ModelAssetRecord) {
	t.Helper()
	source := filepath.Join(t.TempDir(), "model.bin")
	if err := os.WriteFile(source, []byte(name), 0o600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, name)
	directory := svc.modelAssetDirectories[asset.GetModelAssetId()]
	forgetModelAssetInventoryForTest(t, svc, asset.GetModelAssetId())
	return directory, asset
}

// forgetModelAssetInventoryForTest drops the inventory row (as a lost or
// rebuilt inventory would) while leaving the view directory untouched.
func forgetModelAssetInventoryForTest(t *testing.T, svc *Service, modelAssetID string) {
	t.Helper()
	svc.modelAssetMutationMu.Lock()
	defer svc.modelAssetMutationMu.Unlock()
	svc.mu.Lock()
	defer svc.mu.Unlock()
	delete(svc.modelAssets, modelAssetID)
	delete(svc.modelAssetDirectories, modelAssetID)
	if err := svc.persistModelAssetStoreLocked(); err != nil {
		t.Fatal(err)
	}
}

func newImportTransferForTest(t *testing.T, svc *Service, source modelAssetSource) *runtimev1.LocalTransferSessionSummary {
	t.Helper()
	transfer, err := svc.createLocalTransfer(localTransferKindImport, localTransferMutation{
		Phase: "scan", State: localTransferStateRunning, BytesTotal: source.SizeBytes, SourceLabel: source.DisplayName,
	}, nil, &localTransferImportSpec{SourcePath: source.Path, DisplayName: source.DisplayName, IsDir: source.IsDir, SizeBytes: source.SizeBytes}, true)
	if err != nil {
		t.Fatal(err)
	}
	return transfer
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
