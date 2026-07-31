package localservice

import (
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestHealManagedImageVAEProjectionAlignsStaleZImageVAEFamily(t *testing.T) {
	modelsRoot := t.TempDir()
	assetID := "local-import/z-image-ae"
	assetDir := runtimeManagedPassiveAssetDir(modelsRoot, assetID)
	if err := os.MkdirAll(assetDir, 0o755); err != nil {
		t.Fatalf("mkdir VAE asset dir: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(assetDir, "ae.safetensors"),
		safetensorsFixtureWithDecoderConvInChannels(32),
		0o600,
	); err != nil {
		t.Fatalf("write Z-Image VAE fixture: %v", err)
	}

	record := &runtimev1.LocalAssetRecord{
		LocalAssetId: "local-z-image-ae",
		AssetId:      assetID,
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
		Engine:       "media",
		Entry:        "ae.safetensors",
		Family:       "flux1-vae",
		Source: &runtimev1.LocalAssetSource{
			Repo: "file://" + filepath.ToSlash(filepath.Join(assetDir, "asset.manifest.json")),
		},
	}

	if !healManagedImageVAEProjection(modelsRoot, record, nil) {
		t.Fatal("expected stale VAE projection to self-heal")
	}
	if got := record.GetFamily(); got != "flux2-vae" {
		t.Fatalf("healed family = %q, want flux2-vae", got)
	}
	if !stringSliceContains(record.GetArtifactRoles(), "vae") {
		t.Fatalf("healed artifact roles = %#v, want vae", record.GetArtifactRoles())
	}
}

func TestManagedImageVAEFamilyCompatibilityKeepsZImageNarrow(t *testing.T) {
	for _, imageFamily := range []string{"z-image", "z-image-turbo"} {
		if !managedImageVAEFamilyCompatibleWithImageFamily(imageFamily, "flux2-vae") {
			t.Fatalf("%s must admit the catalog Z-Image VAE family", imageFamily)
		}
		for _, incompatibleFamily := range []string{"flux1-vae", "sdxl-vae", "generic"} {
			if managedImageVAEFamilyCompatibleWithImageFamily(imageFamily, incompatibleFamily) {
				t.Fatalf("%s must reject unrelated VAE family %q", imageFamily, incompatibleFamily)
			}
		}
	}

	if !managedImageVAEFamilyCompatibleWithImageFamily("ideogram4", "flux2-vae") {
		t.Fatal("Ideogram4 compatibility must remain unchanged")
	}
	if managedImageVAEFamilyCompatibleWithImageFamily("ideogram4", "flux1-vae") {
		t.Fatal("Ideogram4 must continue rejecting flux1-vae")
	}
}
