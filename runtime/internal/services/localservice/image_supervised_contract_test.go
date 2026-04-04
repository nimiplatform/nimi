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

func TestDeriveCanonicalImageFactsSingleFileSafetensors(t *testing.T) {
	facts := canonicalImageResolverFactsForImport(
		"media",
		[]string{"image"},
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		"model.safetensors",
		[]string{"model.safetensors"},
		nil,
		nil,
		"",
		nil,
	)

	assetFamily, profileKind, artifactFormats := deriveCanonicalImageFacts(facts)
	if assetFamily != engine.ImageAssetFamilySafetensorsNativeImage {
		t.Fatalf("expected safetensors_native_image, got %s", assetFamily)
	}
	if profileKind != engine.ImageProfileKindSingleBinaryModel {
		t.Fatalf("expected single_binary_model, got %s", profileKind)
	}
	if len(artifactFormats) != 1 || artifactFormats[0] != "safetensors" {
		t.Fatalf("expected [safetensors], got %#v", artifactFormats)
	}
}

func TestDeriveCanonicalImageFactsSafetensorsWithRolesButNoModelIndex(t *testing.T) {
	// artifact_roles present but no model_index.json -> must NOT upgrade to workflow
	facts := canonicalImageResolverFactsForImport(
		"media",
		[]string{"image"},
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		"model.safetensors",
		[]string{"model.safetensors"},
		nil,
		[]string{"transformer", "vae"},
		"",
		nil,
	)

	assetFamily, profileKind, artifactFormats := deriveCanonicalImageFacts(facts)
	if assetFamily != engine.ImageAssetFamilySafetensorsNativeImage {
		t.Fatalf("artifact_roles without model_index.json must not produce workflow topology, got %s", assetFamily)
	}
	if profileKind != engine.ImageProfileKindSingleBinaryModel {
		t.Fatalf("expected single_binary_model, got %s", profileKind)
	}
	if len(artifactFormats) != 1 || artifactFormats[0] != "safetensors" {
		t.Fatalf("expected [safetensors], got %#v", artifactFormats)
	}
}

func TestDeriveCanonicalImageFactsSlotOnlySafetensorsNotWorkflow(t *testing.T) {
	// Slot components are safetensors but main model has no workflow bundle markers
	facts := canonicalImageResolverFactsForImport(
		"media",
		[]string{"image"},
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		"main_model.safetensors",
		[]string{"main_model.safetensors"},
		nil,
		nil,
		"",
		nil,
	)

	assetFamily, _, _ := deriveCanonicalImageFacts(facts)
	if assetFamily == engine.ImageAssetFamilyWorkflowSafetensorsImage {
		t.Fatal("slot-only safetensors without workflow bundle markers must not be classified as workflow")
	}
	if assetFamily != engine.ImageAssetFamilySafetensorsNativeImage {
		t.Fatalf("expected safetensors_native_image, got %s", assetFamily)
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
		t.Fatalf("expected active recognized selection to win over inert workflow install, got conflict=%#v", selection)
	}
	if selection.EntryID != "windows-x64-nvidia-gguf" {
		t.Fatalf("unexpected bootstrap entry id: %q", selection.EntryID)
	}
	if selection.ProductState != engine.ImageProductStateSupported {
		t.Fatalf("expected Windows GGUF bootstrap selection to be marked supported, got %s", selection.ProductState)
	}
	if strings.TrimSpace(selection.CompatibilityDetail) != "" {
		t.Fatalf("expected no compatibility detail for supported Windows GGUF topology, got %q", selection.CompatibilityDetail)
	}
}

func TestManagedSupervisedImageBootstrapSelectionIgnoresSafetensorsNativeInstall(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "linux", "amd64")
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
	svc.assets["asset_st_native"] = &runtimev1.LocalAssetRecord{
		LocalAssetId: "asset_st_native",
		AssetId:      "local/safetensors-image",
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		Capabilities: []string{"image"},
		Engine:       "media",
		Entry:        "model.safetensors",
		Files:        []string{"model.safetensors"},
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
	}
	svc.assetRuntimeModes["asset_st_native"] = runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED
	svc.mu.Unlock()

	selection, ok := svc.ManagedSupervisedImageBootstrapSelection()
	if !ok {
		t.Fatal("expected bootstrap selection to exist")
	}
	if selection.Conflict {
		t.Fatalf("safetensors native install must not conflict with recognized GGUF topology, got %#v", selection)
	}
	if selection.EntryID != "linux-x64-nvidia-gguf" {
		t.Fatalf("active recognized GGUF topology must win, got %q", selection.EntryID)
	}
	if selection.ProductState != engine.ImageProductStateUnsupported {
		t.Fatalf("expected Linux GGUF topology to be marked unsupported after rollback, got %s", selection.ProductState)
	}
	if !strings.Contains(selection.CompatibilityDetail, "no published runtime-owned managed image backend package") {
		t.Fatalf("expected honest rollback detail, got %q", selection.CompatibilityDetail)
	}
}

func TestManagedSupervisedImageBootstrapSelectionPrefersSupportedInstalledWindowsGGUFDuringAutoArbitration(t *testing.T) {
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
		t.Fatal("expected supported Windows GGUF topology to become bootstrap selection")
	}
	if selection.Conflict {
		t.Fatalf("supported installed-only Windows GGUF topology must not conflict during bootstrap arbitration, got %#v", selection)
	}
	if selection.EntryID != "windows-x64-nvidia-gguf" {
		t.Fatalf("unexpected bootstrap entry id: %q", selection.EntryID)
	}
	if selection.ProductState != engine.ImageProductStateSupported {
		t.Fatalf("expected Windows GGUF bootstrap selection to stay supported, got %s", selection.ProductState)
	}
	if strings.TrimSpace(selection.CompatibilityDetail) != "" {
		t.Fatalf("expected no compatibility detail for supported Windows GGUF topology, got %q", selection.CompatibilityDetail)
	}
}

func TestManagedSupervisedImageBootstrapSelectionDoesNotAutoSelectUnsupportedSafetensorsNative(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "linux", "amd64")
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	t.Setenv("NIMI_RUNTIME_GPU_CUDA_READY", "true")

	svc.mu.Lock()
	svc.assets["asset_st_native"] = &runtimev1.LocalAssetRecord{
		LocalAssetId: "asset_st_native",
		AssetId:      "local/safetensors-image",
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		Capabilities: []string{"image"},
		Engine:       "media",
		Entry:        "model.safetensors",
		Files:        []string{"model.safetensors"},
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
	}
	svc.assetRuntimeModes["asset_st_native"] = runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED
	svc.mu.Unlock()

	selection, ok := svc.ManagedSupervisedImageBootstrapSelection()
	if ok {
		t.Fatalf("unsupported safetensors native install must not become bootstrap selection, got %#v", selection)
	}
	if selection.Matched || selection.Entry != nil || selection.EntryID != "" {
		t.Fatalf("expected empty selection when only unsupported safetensors native is installed, got %#v", selection)
	}
}
