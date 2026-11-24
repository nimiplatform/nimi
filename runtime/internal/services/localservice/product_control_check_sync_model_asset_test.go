package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestCheckSyncRejectsDuplicateCanonicalModelAssetManifestIdentityBeforeAdoption(t *testing.T) {
	root := t.TempDir()
	resolved := filepath.Join(root, "models", "resolved")
	manifest := modelAssetManifest{
		SchemaVersion: modelAssetManifestSchemaVersion,
		StorageLayout: modelAssetManifestStorageLayoutObjectLinked,
		ModelAssetID:  "model_asset_duplicate",
		ContentID:     "content_duplicate",
		DisplayName:   "Duplicate",
		Entry:         "model.bin",
		Files: []modelAssetManifestFile{{
			RelativePath: "model.bin", SHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", SizeBytes: 1,
		}},
		TotalSizeBytes:  1,
		ContentVerified: true,
		CreatedAt:       "2026-08-30T00:00:00Z",
	}
	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"first", "second"} {
		directory := filepath.Join(resolved, name)
		if err := os.MkdirAll(directory, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(directory, localAssetManifestFileName), payload, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	service := &Service{
		modelAssets:                       make(map[string]*runtimev1.ModelAssetRecord),
		modelAssetDirectories:             make(map[string]string),
		modelAssetCleanupObligations:      make(map[string]modelAssetCleanupObligation),
		modelAssetPendingDirectoryRebases: make(map[string]string),
		modelAssetPendingCleanupRebases:   make(map[string]modelAssetCleanupObligation),
		loadouts:                          make(map[string]*runtimev1.Loadout),
	}
	result := service.reconcileProductControlCheckSyncModelAssets(context.Background(), ProductControlCheckSyncInput{
		RootActivationID: "rootact_duplicate_manifest", DataRoot: root,
	})
	conflicts := 0
	for _, resource := range result.Resources {
		if resource.Kind == "model_asset" && resource.Reference != nil && *resource.Reference == manifest.ModelAssetID &&
			resource.Status == "conflict" && resource.Reason == "MODEL_MANIFEST_ID_AMBIGUOUS" {
			conflicts++
		}
	}
	if conflicts != 2 {
		t.Fatalf("duplicate manifest results = %+v", result.Resources)
	}
	if len(service.modelAssets) != 0 || len(service.modelAssetDirectories) != 0 {
		t.Fatalf("ambiguous manifests mutated inventory: assets=%d directories=%d", len(service.modelAssets), len(service.modelAssetDirectories))
	}
}

func TestCheckSyncModelAssetAdoptionIsIdempotentAcrossRepeatedRuns(t *testing.T) {
	svc := newTestService(t)
	root := filepath.Dir(svc.resolvedLocalModelsPath())
	modelsRoot := svc.resolvedLocalModelsPath()
	payload := append([]byte("GGUF"), []byte("payload-for-idempotent-sync")...)
	digest := sha256.Sum256(payload)
	sum := hex.EncodeToString(digest[:])
	objectPath, err := modelObjectPath(modelsRoot, sum)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(objectPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(objectPath, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	assetDir := filepath.Join(modelsRoot, "resolved", "model_asset_disk_existing")
	if err := os.MkdirAll(assetDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(objectPath, filepath.Join(assetDir, "sample.gguf")); err != nil {
		t.Fatal(err)
	}
	contentID := modelAssetContentID([]*runtimev1.ModelAssetFile{{
		RelativePath: "sample.gguf", Sha256: sum, SizeBytes: int64(len(payload)),
	}})
	manifest := modelAssetManifestFromRecord(&runtimev1.ModelAssetRecord{
		ModelAssetId:        "model_asset_disk_existing",
		ContentId:           contentID,
		DisplayName:         "Existing Disk Model",
		Entry:               "sample.gguf",
		Files:               []*runtimev1.ModelAssetFile{{RelativePath: "sample.gguf", Sha256: sum, SizeBytes: int64(len(payload))}},
		TotalSizeBytes:      int64(len(payload)),
		ContentVerified:     true,
		CatalogVerification: runtimev1.ModelAssetCatalogVerification_MODEL_ASSET_CATALOG_VERIFICATION_NOT_MATCHED,
		BoundedFingerprint:  toStruct(map[string]any{"file_count": 1}),
		Provenance:          toStruct(map[string]any{"source_kind": "local_import"}),
		CreatedAt:           "2026-11-23T15:00:00Z",
	})
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(assetDir, localAssetManifestFileName), raw, 0o600); err != nil {
		t.Fatal(err)
	}

	first := svc.reconcileProductControlCheckSyncModelAssets(context.Background(), ProductControlCheckSyncInput{
		RootActivationID: "rootact_first", DataRoot: root,
	})
	adoptedFirst := 0
	for _, r := range first.Resources {
		if r.Kind == "model_asset" && r.Reference != nil && *r.Reference == manifest.ModelAssetID &&
			r.Change != nil && *r.Change == "adopted" && r.Reason == "MODEL_MANIFEST_ADOPTED" {
			adoptedFirst++
		}
	}
	if adoptedFirst != 1 {
		t.Fatalf("first sync expected 1 adopted asset, got %+v", first.Resources)
	}

	second := svc.reconcileProductControlCheckSyncModelAssets(context.Background(), ProductControlCheckSyncInput{
		RootActivationID: "rootact_second", DataRoot: root,
	})
	adoptedSecond := 0
	reusedSecond := 0
	for _, r := range second.Resources {
		if r.Kind == "model_asset" && r.Reference != nil && *r.Reference == manifest.ModelAssetID {
			if r.Change != nil && *r.Change == "adopted" {
				adoptedSecond++
			}
			if r.Change == nil && r.Reason == "MODEL_MANIFEST_REUSED" {
				reusedSecond++
			}
		}
	}
	if adoptedSecond != 0 || reusedSecond != 1 {
		t.Fatalf("second sync must be idempotent (0 adopted, 1 reused), got %+v", second.Resources)
	}
}
