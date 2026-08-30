package localservice

import (
	"context"
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
