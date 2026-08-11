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
		safetensorsFixtureWithDecoderConvInChannels(16),
		0o600,
	); err != nil {
		t.Fatalf("write Z-Image VAE fixture: %v", err)
	}
	if err := os.WriteFile(filepath.Join(assetDir, localAssetManifestFileName), []byte(`{"asset_id":"local-import/z-image-ae","kind":"vae"}`), 0o600); err != nil {
		t.Fatalf("write Z-Image VAE manifest: %v", err)
	}

	record := &runtimev1.LocalAssetRecord{
		LocalAssetId: "local-z-image-ae",
		AssetId:      assetID,
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
		Engine:       "media",
		Entry:        "ae.safetensors",
		Family:       "flux2-vae",
		Source: &runtimev1.LocalAssetSource{
			Repo: "file://" + filepath.ToSlash(filepath.Join(assetDir, "asset.manifest.json")),
		},
	}

	if !healManagedImagePassiveProjection(modelsRoot, record, nil) {
		t.Fatal("expected stale VAE projection to self-heal")
	}
	if got := record.GetFamily(); got != "flux1-vae" {
		t.Fatalf("healed family = %q, want flux1-vae", got)
	}
	if !stringSliceContains(record.GetArtifactRoles(), "vae") {
		t.Fatalf("healed artifact roles = %#v, want vae", record.GetArtifactRoles())
	}
}

func TestHealManagedImagePassiveProjectionAlignsStaleLoRAFamily(t *testing.T) {
	modelsRoot := t.TempDir()
	assetID := "local-import/z-image-ink-lora"
	assetDir := runtimeManagedPassiveAssetDir(modelsRoot, assetID)
	if err := os.MkdirAll(assetDir, 0o755); err != nil {
		t.Fatalf("mkdir LoRA asset dir: %v", err)
	}
	entryName := "z-image-turbo-ink-lora.safetensors"
	if err := os.WriteFile(filepath.Join(assetDir, entryName), []byte("lora"), 0o600); err != nil {
		t.Fatalf("write LoRA fixture: %v", err)
	}
	if err := os.WriteFile(filepath.Join(assetDir, localAssetManifestFileName), []byte(`{"asset_id":"local-import/z-image-ink-lora","kind":"lora"}`), 0o600); err != nil {
		t.Fatalf("write LoRA manifest: %v", err)
	}

	record := &runtimev1.LocalAssetRecord{
		LocalAssetId: "local-z-image-ink-lora",
		AssetId:      assetID,
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_LORA,
		Engine:       "media",
		Entry:        entryName,
		Source: &runtimev1.LocalAssetSource{
			Repo: "file://" + filepath.ToSlash(filepath.Join(assetDir, "asset.manifest.json")),
		},
	}

	if !healManagedImagePassiveProjection(modelsRoot, record, nil) {
		t.Fatal("expected LoRA projection to self-heal")
	}
	if got := record.GetFamily(); got != "z-image-turbo" {
		t.Fatalf("healed LoRA family = %q, want z-image-turbo", got)
	}
	if !stringSliceContains(record.GetArtifactRoles(), "lora") {
		t.Fatalf("healed LoRA artifact roles = %#v, want lora", record.GetArtifactRoles())
	}

	unknown := &runtimev1.LocalAssetRecord{
		LocalAssetId: "local-generic-lora",
		AssetId:      "local-import/generic-lora",
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_LORA,
		Engine:       "media",
		Entry:        entryName,
		Source:       &runtimev1.LocalAssetSource{},
	}
	unknown.Entry = "ink-lora.safetensors"
	genericDir := runtimeManagedPassiveAssetDir(modelsRoot, "local-import/generic-lora")
	if err := os.MkdirAll(genericDir, 0o755); err != nil {
		t.Fatalf("mkdir generic LoRA asset dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(genericDir, unknown.GetEntry()), []byte("lora"), 0o600); err != nil {
		t.Fatalf("write generic LoRA fixture: %v", err)
	}
	if healManagedImagePassiveProjection(modelsRoot, unknown, nil) {
		t.Fatal("LoRA without a recognizable family in its file name must fail closed")
	}
}

func TestManagedImageVAEFamilyCompatibilityKeepsZImageNarrow(t *testing.T) {
	for _, imageFamily := range []string{"z-image", "z-image-turbo"} {
		if !managedImageVAEFamilyCompatibleWithImageFamily(imageFamily, "flux1-vae") {
			t.Fatalf("%s must admit the catalog Z-Image VAE family", imageFamily)
		}
		for _, incompatibleFamily := range []string{"flux2-vae", "sdxl-vae", "generic"} {
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
