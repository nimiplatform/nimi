package localservice

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func TestDeriveCanonicalImageFactsGGUFImportSource(t *testing.T) {
	facts := canonicalImageResolverFactsForImport(
		"media",
		[]string{"image"},
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		"z_image_turbo-q4.gguf",
		[]string{"z_image_turbo-q4.gguf"},
		nil,
		nil,
		"",
		nil,
	)

	assetFamily, profileKind, artifactFormats := deriveCanonicalImageFacts(facts)
	if assetFamily != engine.ImageAssetFamilyGGUFImage {
		t.Fatalf("unexpected asset family: %s", assetFamily)
	}
	if profileKind != engine.ImageProfileKindSingleBinaryModel {
		t.Fatalf("unexpected profile kind: %s", profileKind)
	}
	if len(artifactFormats) != 1 || artifactFormats[0] != "gguf" {
		t.Fatalf("unexpected artifact formats: %#v", artifactFormats)
	}
}

func TestDeriveCanonicalImageFactsWorkflowBundle(t *testing.T) {
	facts := canonicalImageResolverFactsForImport(
		"media",
		[]string{"image"},
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		"model_index.json",
		[]string{"model_index.json", "transformer/model.safetensors"},
		map[string]string{"model_index.json": "sha256:abc"},
		[]string{"transformer", "tokenizer", "vae"},
		"",
		nil,
	)

	assetFamily, profileKind, artifactFormats := deriveCanonicalImageFacts(facts)
	if assetFamily != engine.ImageAssetFamilyWorkflowSafetensorsImage {
		t.Fatalf("unexpected asset family: %s", assetFamily)
	}
	if profileKind != engine.ImageProfileKindWorkflowPipeline {
		t.Fatalf("unexpected profile kind: %s", profileKind)
	}
	if len(artifactFormats) != 2 || artifactFormats[0] != "json_config" || artifactFormats[1] != "safetensors" {
		t.Fatalf("unexpected artifact formats: %#v", artifactFormats)
	}
}

func TestDeriveCanonicalImageFactsFailsCloseWithoutBundleMarkers(t *testing.T) {
	facts := canonicalImageResolverFactsForImport(
		"media",
		[]string{"image"},
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		"",
		nil,
		nil,
		nil,
		"llama",
		nil,
	)

	assetFamily, profileKind, artifactFormats := deriveCanonicalImageFacts(facts)
	if assetFamily != "" || profileKind != "" || artifactFormats != nil {
		t.Fatalf("expected unresolved canonical facts, got family=%q profile=%q formats=%#v", assetFamily, profileKind, artifactFormats)
	}
}

func TestCanonicalImageCatalogComparableIdentityUsesLogicalModelIDAndAlias(t *testing.T) {
	model := &runtimev1.LocalAssetRecord{
		AssetId:        "local-import/flux.1-schnell",
		LogicalModelId: "nimi/flux.1-schnell",
	}

	identity := canonicalImageCatalogComparableIdentity(model, "nimi-img-abcdef01")
	if identity != "nimi/flux.1-schnell#nimi-img-abcdef01" {
		t.Fatalf("unexpected comparable identity: %q", identity)
	}

	baseIdentity := canonicalImageCatalogComparableIdentity(model, "")
	if baseIdentity != "nimi/flux.1-schnell" {
		t.Fatalf("unexpected base comparable identity: %q", baseIdentity)
	}
}

func TestManagedSupervisedImageBootstrapSelectionPrefersActiveSupportedSelection(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")

	svc.mu.Lock()
	svc.assets["asset_gguf"] = &runtimev1.LocalAssetRecord{
		LocalAssetId: "asset_gguf",
		AssetId:      "local/gguf-image",
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		Capabilities: []string{"image"},
		Engine:       "media",
		Entry:        "z_image_turbo-q4.gguf",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
	}
	svc.assetRuntimeModes["asset_gguf"] = runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED
	svc.assets["asset_workflow"] = &runtimev1.LocalAssetRecord{
		LocalAssetId:  "asset_workflow",
		AssetId:       "local/workflow-image",
		Kind:          runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		Capabilities:  []string{"image"},
		Engine:        "media",
		Entry:         "model_index.json",
		Files:         []string{"model_index.json", "transformer/model.safetensors"},
		Hashes:        map[string]string{"model_index.json": "sha256:abc"},
		ArtifactRoles: []string{"transformer", "vae"},
		Status:        runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
	}
	svc.assetRuntimeModes["asset_workflow"] = runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED
	svc.mu.Unlock()

	selection, ok := svc.ManagedSupervisedImageBootstrapSelection()
	if !ok {
		t.Fatal("expected bootstrap selection to exist")
	}
	if selection.Conflict {
		t.Fatalf("expected active supported selection to win over inert workflow install, got conflict=%#v", selection)
	}
	if selection.EntryID != "windows-x64-nvidia-gguf" {
		t.Fatalf("unexpected bootstrap entry id: %q", selection.EntryID)
	}
}

func TestManagedSupervisedImageBootstrapSelectionIgnoresInertUnsupportedInstallsDuringAutoArbitration(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")

	svc.mu.Lock()
	svc.assets["asset_gguf"] = &runtimev1.LocalAssetRecord{
		LocalAssetId: "asset_gguf",
		AssetId:      "local/gguf-image",
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		Capabilities: []string{"image"},
		Engine:       "media",
		Entry:        "z_image_turbo-q4.gguf",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
	}
	svc.assetRuntimeModes["asset_gguf"] = runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED
	svc.assets["asset_workflow"] = &runtimev1.LocalAssetRecord{
		LocalAssetId:  "asset_workflow",
		AssetId:       "local/workflow-image",
		Kind:          runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		Capabilities:  []string{"image"},
		Engine:        "media",
		Entry:         "model_index.json",
		Files:         []string{"model_index.json", "transformer/model.safetensors"},
		Hashes:        map[string]string{"model_index.json": "sha256:abc"},
		ArtifactRoles: []string{"transformer", "vae"},
		Status:        runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
	}
	svc.assetRuntimeModes["asset_workflow"] = runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED
	svc.mu.Unlock()

	selection, ok := svc.ManagedSupervisedImageBootstrapSelection()
	if !ok {
		t.Fatal("expected supported install to be auto-arbitrated")
	}
	if selection.Conflict {
		t.Fatalf("expected inert unsupported workflow install to be ignored, got conflict=%#v", selection)
	}
	if selection.EntryID != "windows-x64-nvidia-gguf" {
		t.Fatalf("unexpected bootstrap entry id: %q", selection.EntryID)
	}
	if strings.TrimSpace(selection.CompatibilityDetail) != "" {
		t.Fatalf("supported bootstrap selection should not carry compatibility detail, got %q", selection.CompatibilityDetail)
	}
}
