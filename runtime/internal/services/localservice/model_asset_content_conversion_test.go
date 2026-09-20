package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

// writeLegacyLayoutView writes a pre-conversion (schema 1.0.0) manifest
// directory with independent payload files, as the old per-import layout did.
func writeLegacyLayoutView(t *testing.T, directory string, modelAssetID string, displayName string, entry string, files map[string][]byte, createdAt string) modelAssetManifest {
	t.Helper()
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	inventory := make([]*runtimev1.ModelAssetFile, 0, len(files))
	var total int64
	for relative, payload := range files {
		path := filepath.Join(directory, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, payload, 0o600); err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(payload)
		inventory = append(inventory, &runtimev1.ModelAssetFile{RelativePath: relative, Sha256: hex.EncodeToString(sum[:]), SizeBytes: int64(len(payload))})
		total += int64(len(payload))
	}
	manifestFiles := make([]modelAssetManifestFile, 0, len(inventory))
	for _, file := range inventory {
		manifestFiles = append(manifestFiles, modelAssetManifestFile{RelativePath: file.GetRelativePath(), SHA256: file.GetSha256(), SizeBytes: file.GetSizeBytes()})
	}
	manifest := modelAssetManifest{
		SchemaVersion: "1.0.0", ModelAssetID: modelAssetID, ContentID: modelAssetContentID(inventory), DisplayName: displayName,
		Entry: entry, Files: manifestFiles, TotalSizeBytes: total, ContentVerified: true, CreatedAt: createdAt,
		BoundedFingerprint: map[string]any{"file_count": len(files)}, Provenance: map[string]any{"source_kind": "legacy"},
	}
	// The old manifest has no storage_layout; marshal it without the field.
	raw := map[string]any{
		"schema_version": manifest.SchemaVersion, "model_asset_id": manifest.ModelAssetID, "content_id": manifest.ContentID,
		"display_name": manifest.DisplayName, "entry": manifest.Entry, "total_size_bytes": manifest.TotalSizeBytes,
		"content_verified": true, "catalog_verified": false, "bounded_fingerprint": manifest.BoundedFingerprint,
		"provenance": manifest.Provenance, "created_at": manifest.CreatedAt,
	}
	fileRows := make([]map[string]any, 0, len(manifestFiles))
	for _, file := range manifestFiles {
		fileRows = append(fileRows, map[string]any{"relative_path": file.RelativePath, "sha256": file.SHA256, "size_bytes": file.SizeBytes})
	}
	raw["files"] = fileRows
	payload, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, localAssetManifestFileName), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	return manifest
}

func legacyStoreRowForManifest(t *testing.T, manifest modelAssetManifest, locator string) map[string]any {
	t.Helper()
	asset, err := modelAssetRecordFromCanonicalManifestLoose(manifest)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(asset)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	return map[string]any{"asset": decoded, "managedDirectory": locator}
}

// modelAssetRecordFromCanonicalManifestLoose builds a record from a legacy
// manifest for fixture purposes only.
func modelAssetRecordFromCanonicalManifestLoose(manifest modelAssetManifest) (*runtimev1.ModelAssetRecord, error) {
	copied := manifest
	copied.SchemaVersion = modelAssetManifestSchemaVersion
	copied.StorageLayout = modelAssetManifestStorageLayoutObjectLinked
	return modelAssetRecordFromCanonicalManifest(copied)
}

func TestConvertModelStorageToContentAddressedMergesEquivalentsAndLinksObjects(t *testing.T) {
	runtimeRoot := t.TempDir()
	modelsRoot := filepath.Join(runtimeRoot, "models")
	resolved := filepath.Join(modelsRoot, "resolved")
	stateDir := filepath.Join(runtimeRoot, "accounts", "runtime")
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(stateDir, "local-state.json")
	storePath := filepath.Join(stateDir, modelAssetStoreFileName)
	sharedPayload := []byte("shared weights bytes for the conversion fixture")
	uniquePayload := []byte("unique payload only in D")

	// A and B: equivalent distributions, both registered. C: an unregistered
	// nested equivalent that a Loadout still references. D: a unique
	// unregistered distribution sharing one file's bytes with A. E: a removed
	// asset whose old cleanup obligation never completed.
	manifestA := writeLegacyLayoutView(t, filepath.Join(resolved, "model_a"), "model_a", "A", "model.bin", map[string][]byte{"model.bin": sharedPayload}, "2026-01-01T00:00:00Z")
	manifestB := writeLegacyLayoutView(t, filepath.Join(resolved, "model_b"), "model_b", "B", "model.bin", map[string][]byte{"model.bin": sharedPayload}, "2026-02-01T00:00:00Z")
	manifestC := writeLegacyLayoutView(t, filepath.Join(resolved, "nimi", "history", "model_c"), "model_c", "C", "model.bin", map[string][]byte{"model.bin": sharedPayload}, "2026-03-01T00:00:00Z")
	manifestD := writeLegacyLayoutView(t, filepath.Join(resolved, "local-import-d"), "model_d", "D", "weights/model.bin", map[string][]byte{"weights/model.bin": sharedPayload, "config.json": uniquePayload}, "2026-04-01T00:00:00Z")
	manifestE := writeLegacyLayoutView(t, filepath.Join(resolved, "model_e"), "model_e", "E", "model.bin", map[string][]byte{"model.bin": []byte("removed asset bytes")}, "2026-05-01T00:00:00Z")

	store := map[string]any{
		"schemaVersion": 1, "savedAt": "2026-06-01T00:00:00Z",
		"assets": []any{
			legacyStoreRowForManifest(t, manifestA, "resolved/model_a"),
			legacyStoreRowForManifest(t, manifestB, "resolved/model_b"),
		},
		"cleanupObligations": []any{map[string]any{
			"modelAssetId": "model_e", "contentId": manifestE.ContentID, "generation": manifestE.CreatedAt, "managedDirectory": "resolved/model_e",
			"reason": "ModelAsset removed", "attempts": 0, "terminal": true, "terminalReason": modelAssetCleanupGenerationChangedReason,
			"createdAt": "2026-06-01T00:00:00Z", "updatedAt": "2026-06-01T00:00:00Z",
		}},
	}
	storePayload, _ := json.MarshalIndent(store, "", "  ")
	if err := os.WriteFile(storePath, storePayload, 0o600); err != nil {
		t.Fatal(err)
	}

	// Two old-shape retryable prefixes for the same content, different sizes.
	prefixPayload := []byte("prefix bytes of an interrupted download that is much longer than the other one")
	prefixSum := sha256.Sum256(prefixPayload)
	transfers := make([]any, 0)
	for index, size := range []int{40, 20} {
		transferID := []string{"transfer_prefix_big", "transfer_prefix_small"}[index]
		directory := legacyManagedModelDownloadStageDir(modelsRoot, "local-chat-gemma", transferID)
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(directory, "gemma.gguf.download"), prefixPayload[:size], 0o600); err != nil {
			t.Fatal(err)
		}
		transfers = append(transfers, map[string]any{
			"installSessionId": transferID, "assetId": "local-chat-gemma", "sessionKind": "download", "phase": "download", "state": "failed",
			"bytesReceived": size, "bytesTotal": len(prefixPayload), "retryable": true, "createdAt": "2026-06-01T00:00:00Z", "updatedAt": "2026-06-01T00:00:00Z",
			"managedDownloadSpec": map[string]any{
				"modelId": "local-chat-gemma", "entry": "gemma.gguf", "files": []string{"gemma.gguf"}, "repo": "unsloth/gemma", "revision": "main",
				"hashes": map[string]string{"gemma.gguf": "sha256:" + hex.EncodeToString(prefixSum[:])}, "totalSizeBytes": len(prefixPayload),
			},
		})
	}
	transfers = append(transfers, map[string]any{
		"installSessionId": "transfer_done", "assetId": "local/other", "sessionKind": "download", "phase": "register", "state": "completed",
		"bytesReceived": 5, "createdAt": "2026-06-01T00:00:00Z", "updatedAt": "2026-06-01T00:00:00Z",
	})
	statePayload, _ := json.MarshalIndent(map[string]any{"schemaVersion": localStateSchemaVersion, "savedAt": "2026-06-01T00:00:00Z", "transfers": transfers}, "", "  ")
	if err := os.WriteFile(statePath, statePayload, 0o600); err != nil {
		t.Fatal(err)
	}

	// A Loadout referencing the unregistered nested copy C with C's content.
	svcForLoadout, err := NewForLocalModelRecovery(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath, 8, modelsRoot)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(svcForLoadout.Close)
	if restriction := svcForLoadout.ModelAssetInventoryRestriction(); restriction == nil {
		t.Fatal("schema 1 inventory was not restricted")
	}
	svcForLoadout.mu.Lock()
	loadout := &runtimev1.Loadout{
		LoadoutId: "loadout_b", CapabilityContract: "text.embed", RecipeId: "llama.text-embed.gguf.v1", RecipeRevision: "r1", DisplayName: "B loadout",
		CreatedAt: "2026-06-01T00:00:00Z", UpdatedAt: "2026-06-01T00:00:00Z",
		Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "impl.llama", DriverId: "driver.llama", DriverDialect: "llama.cpp/text-embed/v1"},
		ModelAxes: []*runtimev1.LoadoutModelAxis{{
			SlotId: "main", DisplayLabel: "Main", Presence: runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
			ModelAssetId: "model_c", ExpectedContentId: manifestC.ContentID,
			Resolution: runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_CONFIGURED, RecipeCompatible: true,
		}},
	}
	svcForLoadout.loadouts["loadout_b"] = loadout
	saveErr := svcForLoadout.loadoutStore.Save([]*runtimev1.Loadout{loadout}, nil, map[string]string{})
	svcForLoadout.mu.Unlock()
	svcForLoadout.Close()
	if saveErr != nil {
		t.Fatal(saveErr)
	}

	// Dry-run.
	svc, err := NewForLocalModelRecovery(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath, 8, modelsRoot)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(svc.Close)
	report, err := svc.ConvertModelStorageToContentAddressed(context.Background(), ModelStorageConversionOptions{})
	if err != nil {
		t.Fatalf("dry-run: %v", err)
	}
	if report.Mode != "dry-run" || report.Applied || report.InventorySchemaVersion != 1 {
		t.Fatalf("dry-run report = %+v", report)
	}
	if report.AssetCountBefore != 2 || report.AssetCountAfter != 2 {
		t.Fatalf("asset counts = before %d after %d, want 2 kept (A group, D)", report.AssetCountBefore, report.AssetCountAfter)
	}
	var groupA *ModelStorageConversionGroup
	for index := range report.Groups {
		if report.Groups[index].KeepModelAssetID == "model_a" {
			groupA = &report.Groups[index]
		}
	}
	if groupA == nil || len(groupA.MergedModelAssetIDs) != 2 || !groupA.KeepRegistered {
		t.Fatalf("group A = %+v (groups=%+v)", groupA, report.Groups)
	}
	if len(report.LoadoutRewrites) != 1 || !report.LoadoutRewrites[0].Resolved || report.LoadoutRewrites[0].ToModelAssetID != "model_a" {
		t.Fatalf("loadout rewrites = %+v", report.LoadoutRewrites)
	}
	keptPrefix, discardedPrefix := 0, 0
	for _, prefix := range report.Prefixes {
		switch prefix.Disposition {
		case "keep":
			keptPrefix++
			if prefix.TransferID != "transfer_prefix_big" {
				t.Fatalf("kept prefix = %+v, want the larger one", prefix)
			}
		case "discard":
			discardedPrefix++
		}
	}
	if keptPrefix != 1 || discardedPrefix != 1 {
		t.Fatalf("prefix dispositions = %+v", report.Prefixes)
	}
	if len(report.OldCleanupObligations) != 1 || len(report.SharedObjects) != 1 || report.ObjectsToPublish != 2 {
		t.Fatalf("obligations=%+v shared=%+v objects=%d", report.OldCleanupObligations, report.SharedObjects, report.ObjectsToPublish)
	}
	// Dry-run touched nothing.
	if _, err := os.Lstat(filepath.Join(resolved, "model_b", "model.bin")); err != nil {
		t.Fatalf("dry-run deleted a merged view: %v", err)
	}
	if payload, err := os.ReadFile(storePath); err != nil || string(payload) != string(storePayload) {
		t.Fatal("dry-run rewrote the inventory")
	}
	svc.Close()

	// Apply.
	svc, err = NewForLocalModelRecovery(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath, 8, modelsRoot)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(svc.Close)
	applied, err := svc.ConvertModelStorageToContentAddressed(context.Background(), ModelStorageConversionOptions{Apply: true})
	svc.Close()
	if err != nil || !applied.Applied {
		t.Fatalf("apply: report=%+v err=%v", applied, err)
	}
	if applied.ReclaimedBytes <= 0 {
		t.Fatalf("apply reclaimed %d bytes", applied.ReclaimedBytes)
	}
	for _, gone := range []string{filepath.Join(resolved, "model_b"), filepath.Join(resolved, "nimi"), filepath.Join(resolved, "model_e")} {
		if _, err := os.Lstat(gone); !os.IsNotExist(err) {
			t.Fatalf("merged or removed directory survived apply: %s err=%v", gone, err)
		}
	}
	// A kept its identity and directory; D moved to resolved/model_d.
	viewA := filepath.Join(resolved, "model_a", "model.bin")
	viewD := filepath.Join(resolved, "model_d", "weights", "model.bin")
	identityA, _, err := modelFileIdentityOf(viewA)
	if err != nil {
		t.Fatal(err)
	}
	identityD, _, err := modelFileIdentityOf(viewD)
	if err != nil {
		t.Fatal(err)
	}
	if identityA != identityD {
		t.Fatalf("shared bytes across distributions are not one object: %s vs %s", identityA, identityD)
	}
	objectPath, _ := modelObjectPath(modelsRoot, hex.EncodeToString(func() []byte { s := sha256.Sum256(sharedPayload); return s[:] }()))
	objectIdentity, _, err := modelFileIdentityOf(objectPath)
	if err != nil || objectIdentity != identityA {
		t.Fatalf("object identity = %s err=%v, want %s", objectIdentity, err, identityA)
	}
	kept := managedModelDownloadStageDir(modelsRoot, "transfer_prefix_big")
	if info, err := os.Lstat(filepath.Join(kept, "gemma.gguf.download")); err != nil || info.Size() != 40 {
		t.Fatalf("kept prefix was not re-keyed: %v", err)
	}

	// The converted root starts unrestricted, keeps the rewritten Loadout,
	// and an equivalent acquisition reuses the kept identity.
	reopened, err := NewWithProductControlDataRoot(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath, 8, modelsRoot, runtimeRoot)
	if err != nil {
		t.Fatalf("reopen converted root: %v", err)
	}
	t.Cleanup(reopened.Close)
	reopened.OpenModelAssetReclamation()
	if restriction := reopened.ModelAssetInventoryRestriction(); restriction != nil {
		t.Fatalf("converted inventory still restricted: %+v", restriction)
	}
	listed, err := reopened.ListModelAssets(context.Background(), &runtimev1.ListModelAssetsRequest{})
	if err != nil || len(listed.GetAssets()) != 2 {
		t.Fatalf("converted inventory = %+v err=%v", listed, err)
	}
	reopened.mu.RLock()
	rewritten := reopened.loadouts["loadout_b"]
	reopened.mu.RUnlock()
	if rewritten == nil || rewritten.GetModelAxes()[0].GetModelAssetId() != "model_a" || rewritten.GetModelAxes()[0].GetExpectedContentId() != manifestC.ContentID {
		t.Fatalf("rewritten loadout = %+v", rewritten)
	}
	prefixSummary := reopened.localTransferSummary("transfer_prefix_big")
	if prefixSummary.GetState() != localTransferStateFailed || !prefixSummary.GetRetryable() || prefixSummary.GetBytesReceived() != 40 {
		t.Fatalf("kept prefix transfer = %+v", prefixSummary)
	}
	if small := reopened.localTransferSummary("transfer_prefix_small"); small.GetRetryable() {
		t.Fatalf("discarded prefix transfer still retryable: %+v", small)
	}
	source := filepath.Join(t.TempDir(), "model.bin")
	if err := os.WriteFile(source, sharedPayload, 0o600); err != nil {
		t.Fatal(err)
	}
	reused := importModelAssetForTest(t, reopened, source, "again")
	if reused.GetModelAssetId() != "model_a" || reused.GetDisplayName() != manifestA.DisplayName {
		t.Fatalf("post-conversion equivalent import = %+v, want model_a reused", reused)
	}
	_ = manifestD
	_ = manifestB

	// A second apply is a no-op plan.
	reopened.Close()
	again, err := NewForLocalModelRecovery(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath, 8, modelsRoot)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(again.Close)
	second, err := again.ConvertModelStorageToContentAddressed(context.Background(), ModelStorageConversionOptions{})
	if err != nil || !second.AlreadyConverted || len(second.DirectoriesToDelete) != 0 {
		t.Fatalf("second dry-run = %+v err=%v", second, err)
	}
}
