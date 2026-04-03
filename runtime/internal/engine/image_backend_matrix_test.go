package engine

import (
	"strings"
	"testing"
)

func TestResolveImageSupervisedMatrixSupportedGGUF(t *testing.T) {
	selection := ResolveImageSupervisedMatrix(ImageSupervisedResolverInput{
		OS:              "linux",
		Arch:            "amd64",
		GPUVendor:       "nvidia",
		CUDAReady:       true,
		AssetFamily:     ImageAssetFamilyGGUFImage,
		ProfileKind:     ImageProfileKindSingleBinaryModel,
		ArtifactFormats: []string{"gguf"},
	})
	if !selection.Matched || selection.Conflict || selection.Entry == nil {
		t.Fatalf("expected supported GGUF selection, got %#v", selection)
	}
	if selection.EntryID != "linux-x64-nvidia-gguf" {
		t.Fatalf("unexpected entry id: %q", selection.EntryID)
	}
	if selection.ProductState != ImageProductStateSupported {
		t.Fatalf("unexpected product state: %s", selection.ProductState)
	}
	if selection.ControlPlane != ImageControlPlaneRuntime || selection.ExecutionPlane != EngineMedia {
		t.Fatalf("unexpected planes: control=%s execution=%s", selection.ControlPlane, selection.ExecutionPlane)
	}
}

func TestResolveImageSupervisedMatrixSupportedAppleGGUF(t *testing.T) {
	selection := ResolveImageSupervisedMatrix(ImageSupervisedResolverInput{
		OS:              "darwin",
		Arch:            "arm64",
		GPUVendor:       "apple",
		AssetFamily:     ImageAssetFamilyGGUFImage,
		ProfileKind:     ImageProfileKindSingleBinaryModel,
		ArtifactFormats: []string{"gguf"},
	})
	if !selection.Matched || selection.Conflict || selection.Entry == nil {
		t.Fatalf("expected supported Apple GGUF topology, got %#v", selection)
	}
	if selection.EntryID != "macos-apple-silicon-gguf" {
		t.Fatalf("unexpected entry id: %q", selection.EntryID)
	}
	if selection.ProductState != ImageProductStateSupported {
		t.Fatalf("unexpected product state: %s", selection.ProductState)
	}
	if len(selection.SupportedCapabilities) == 0 {
		t.Fatalf("expected supported capabilities, got %#v", selection.SupportedCapabilities)
	}
	if strings.TrimSpace(selection.CompatibilityDetail) != "" {
		t.Fatalf("expected empty compatibility detail, got %q", selection.CompatibilityDetail)
	}
}

func TestResolveImageSupervisedMatrixProposedAppleWorkflow(t *testing.T) {
	selection := ResolveImageSupervisedMatrix(ImageSupervisedResolverInput{
		OS:              "darwin",
		Arch:            "arm64",
		GPUVendor:       "apple",
		AssetFamily:     ImageAssetFamilyWorkflowSafetensorsImage,
		ProfileKind:     ImageProfileKindWorkflowPipeline,
		ArtifactFormats: []string{"safetensors", "json_config"},
	})
	if !selection.Matched || selection.Entry == nil {
		t.Fatalf("expected proposed Apple workflow topology to be recognized, got %#v", selection)
	}
	if selection.ProductState != ImageProductStateProposed {
		t.Fatalf("unexpected product state: %s", selection.ProductState)
	}
	if !strings.Contains(selection.CompatibilityDetail, "apple-mps-image-poc") {
		t.Fatalf("expected admission gate detail, got %q", selection.CompatibilityDetail)
	}
}

func TestResolveImageSupervisedMatrixCanonicalFactsBeatLegacyHints(t *testing.T) {
	selection := ResolveImageSupervisedMatrix(ImageSupervisedResolverInput{
		OS:                        "windows",
		Arch:                      "amd64",
		GPUVendor:                 "nvidia",
		CUDAReady:                 true,
		AssetFamily:               ImageAssetFamilyGGUFImage,
		ProfileKind:               ImageProfileKindSingleBinaryModel,
		ArtifactFormats:           []string{"gguf"},
		LegacyEngineConfigBackend: "diffusers",
		LegacyPreferredEngine:     "media",
	})
	if selection.EntryID != "windows-x64-nvidia-gguf" {
		t.Fatalf("canonical facts must win over legacy hints, got %q", selection.EntryID)
	}
}

func TestResolveImageSupervisedMatrixFailsCloseWhenCanonicalFactsMissingEvenWithLegacyHints(t *testing.T) {
	selection := ResolveImageSupervisedMatrix(ImageSupervisedResolverInput{
		OS:                        "darwin",
		Arch:                      "arm64",
		GPUVendor:                 "apple",
		LegacyEngineConfigBackend: "diffusers",
	})
	if selection.Matched || selection.Entry != nil {
		t.Fatalf("expected resolver to fail-close without canonical facts, got %#v", selection)
	}
	if !strings.Contains(strings.ToLower(selection.CompatibilityDetail), "canonical image asset facts unavailable") {
		t.Fatalf("unexpected compatibility detail: %q", selection.CompatibilityDetail)
	}
}

func TestResolveImageSupervisedMatrixDoesNotDefaultToGGUF(t *testing.T) {
	selection := ResolveImageSupervisedMatrix(ImageSupervisedResolverInput{
		OS:        "linux",
		Arch:      "amd64",
		GPUVendor: "nvidia",
		CUDAReady: true,
	})
	if selection.Matched || selection.Entry != nil {
		t.Fatalf("resolver must fail-close without canonical or legacy facts, got %#v", selection)
	}
	if !strings.Contains(strings.ToLower(selection.CompatibilityDetail), "canonical image asset facts unavailable") {
		t.Fatalf("unexpected compatibility detail: %q", selection.CompatibilityDetail)
	}
}

func TestResolveImageSupervisedMatrixSafetensorsNativeMatchesUnsupported(t *testing.T) {
	selection := ResolveImageSupervisedMatrix(ImageSupervisedResolverInput{
		OS:              "linux",
		Arch:            "amd64",
		GPUVendor:       "nvidia",
		CUDAReady:       true,
		AssetFamily:     ImageAssetFamilySafetensorsNativeImage,
		ProfileKind:     ImageProfileKindSingleBinaryModel,
		ArtifactFormats: []string{"safetensors"},
	})
	if !selection.Matched || selection.Conflict || selection.Entry == nil {
		t.Fatalf("expected safetensors native topology to match, got %#v", selection)
	}
	if selection.EntryID != "linux-x64-nvidia-safetensors-native" {
		t.Fatalf("unexpected entry id: %q", selection.EntryID)
	}
	if selection.ProductState != ImageProductStateUnsupported {
		t.Fatalf("safetensors native must be unsupported, got %s", selection.ProductState)
	}
	if selection.BackendClass != ImageBackendClassNativeBinary {
		t.Fatalf("expected native_binary backend class, got %s", selection.BackendClass)
	}
	if selection.BackendFamily != ImageBackendFamilyStableDiffusionGGML {
		t.Fatalf("expected stablediffusion-ggml backend family, got %s", selection.BackendFamily)
	}
}

func TestResolveImageSupervisedMatrixSafetensorsNativeApple(t *testing.T) {
	selection := ResolveImageSupervisedMatrix(ImageSupervisedResolverInput{
		OS:              "darwin",
		Arch:            "arm64",
		GPUVendor:       "apple",
		AssetFamily:     ImageAssetFamilySafetensorsNativeImage,
		ProfileKind:     ImageProfileKindSingleBinaryModel,
		ArtifactFormats: []string{"safetensors"},
	})
	if !selection.Matched || selection.Entry == nil {
		t.Fatalf("expected Apple safetensors native to match, got %#v", selection)
	}
	if selection.EntryID != "macos-apple-silicon-safetensors-native" {
		t.Fatalf("unexpected entry id: %q", selection.EntryID)
	}
	if selection.ProductState != ImageProductStateUnsupported {
		t.Fatalf("expected unsupported, got %s", selection.ProductState)
	}
}

func TestResolveImageSupervisedMatrixSafetensorsNativeFailsCloseOnExecution(t *testing.T) {
	selection := ResolveImageSupervisedMatrix(ImageSupervisedResolverInput{
		OS:              "linux",
		Arch:            "amd64",
		GPUVendor:       "nvidia",
		CUDAReady:       true,
		AssetFamily:     ImageAssetFamilySafetensorsNativeImage,
		ProfileKind:     ImageProfileKindSingleBinaryModel,
		ArtifactFormats: []string{"safetensors"},
	})
	// MediaModeFromSelection must fail-close for unsupported product_state
	_, err := MediaModeFromSelection(selection)
	if err == nil {
		t.Fatal("expected MediaModeFromSelection to fail-close for unsupported safetensors native topology")
	}
}

func TestResolveImageSupervisedMatrixSafetensorsNativeDoesNotMatchWorkflowEntries(t *testing.T) {
	// safetensors_native_image family with [safetensors] must not match workflow entries
	// because asset_family differs (safetensors_native_image vs workflow_safetensors_image).
	selection := ResolveImageSupervisedMatrix(ImageSupervisedResolverInput{
		OS:              "linux",
		Arch:            "amd64",
		GPUVendor:       "nvidia",
		CUDAReady:       true,
		AssetFamily:     ImageAssetFamilySafetensorsNativeImage,
		ProfileKind:     ImageProfileKindSingleBinaryModel,
		ArtifactFormats: []string{"safetensors"},
	})
	if !selection.Matched || selection.Entry == nil {
		t.Fatalf("expected safetensors native to match its own entry, got %#v", selection)
	}
	if selection.Entry.AssetFamily != ImageAssetFamilySafetensorsNativeImage {
		t.Fatalf("must match safetensors_native_image entry, got %s", selection.Entry.AssetFamily)
	}
	if strings.Contains(selection.EntryID, "workflow") {
		t.Fatalf("safetensors native must not match workflow entry, got %q", selection.EntryID)
	}
}

func TestResolveImageSupervisedMatrixWorkflowRequiresJsonConfig(t *testing.T) {
	// workflow_safetensors_image with full [safetensors, json_config] matches
	selection := ResolveImageSupervisedMatrix(ImageSupervisedResolverInput{
		OS:              "linux",
		Arch:            "amd64",
		GPUVendor:       "nvidia",
		CUDAReady:       true,
		AssetFamily:     ImageAssetFamilyWorkflowSafetensorsImage,
		ProfileKind:     ImageProfileKindWorkflowPipeline,
		ArtifactFormats: []string{"safetensors", "json_config"},
	})
	if !selection.Matched || selection.Entry == nil {
		t.Fatalf("expected workflow topology to match with full artifact_formats, got %#v", selection)
	}
	if selection.EntryID != "linux-x64-nvidia-workflow-safetensors" {
		t.Fatalf("unexpected entry id: %q", selection.EntryID)
	}
}

func TestResolveImageSupervisedMatrixWorkflowWithoutJSONConfigFailsClose(t *testing.T) {
	selection := ResolveImageSupervisedMatrix(ImageSupervisedResolverInput{
		OS:              "linux",
		Arch:            "amd64",
		GPUVendor:       "nvidia",
		CUDAReady:       true,
		AssetFamily:     ImageAssetFamilyWorkflowSafetensorsImage,
		ProfileKind:     ImageProfileKindWorkflowPipeline,
		ArtifactFormats: []string{"safetensors"},
	})
	if selection.Matched || selection.Entry != nil {
		t.Fatalf("workflow topology without json_config must fail-close, got %#v", selection)
	}
	if !strings.Contains(selection.CompatibilityDetail, "artifact_formats=safetensors") {
		t.Fatalf("expected artifact_formats detail, got %q", selection.CompatibilityDetail)
	}
}

func TestResolveImageSupervisedMatrixSafetensorsNativeDoesNotConflictWithGGUF(t *testing.T) {
	// Ensure safetensors_native and gguf_image don't conflict on the same host
	ggufSel := ResolveImageSupervisedMatrix(ImageSupervisedResolverInput{
		OS:              "linux",
		Arch:            "amd64",
		GPUVendor:       "nvidia",
		CUDAReady:       true,
		AssetFamily:     ImageAssetFamilyGGUFImage,
		ProfileKind:     ImageProfileKindSingleBinaryModel,
		ArtifactFormats: []string{"gguf"},
	})
	stSel := ResolveImageSupervisedMatrix(ImageSupervisedResolverInput{
		OS:              "linux",
		Arch:            "amd64",
		GPUVendor:       "nvidia",
		CUDAReady:       true,
		AssetFamily:     ImageAssetFamilySafetensorsNativeImage,
		ProfileKind:     ImageProfileKindSingleBinaryModel,
		ArtifactFormats: []string{"safetensors"},
	})
	if ggufSel.Conflict || stSel.Conflict {
		t.Fatal("safetensors_native and gguf_image must not conflict")
	}
	if ggufSel.EntryID == stSel.EntryID {
		t.Fatalf("must resolve to different entries, both got %q", ggufSel.EntryID)
	}
}

func TestResolveImageSupervisedMatrixConflictFailsClose(t *testing.T) {
	original := append([]ImageSupervisedMatrixEntry(nil), imageSupervisedMatrixV2...)
	t.Cleanup(func() {
		imageSupervisedMatrixV2 = original
	})
	imageSupervisedMatrixV2 = append(imageSupervisedMatrixV2, ImageSupervisedMatrixEntry{
		EntryID:               "linux-x64-nvidia-gguf-duplicate",
		OS:                    "linux",
		Arch:                  "amd64",
		GPUVendor:             "nvidia",
		CUDARequired:          true,
		AssetFamily:           ImageAssetFamilyGGUFImage,
		ArtifactFormats:       []string{"gguf"},
		ProfileKind:           ImageProfileKindSingleBinaryModel,
		BackendClass:          ImageBackendClassNativeBinary,
		BackendFamily:         ImageBackendFamilyStableDiffusionGGML,
		ControlPlane:          ImageControlPlaneRuntime,
		ExecutionPlane:        EngineMedia,
		SupportedCapabilities: []string{"image.generate.t2i", "image.generate.i2i"},
		TopologyState:         ImageTopologyStateDefined,
		ProductState:          ImageProductStateSupported,
	})

	selection := ResolveImageSupervisedMatrix(ImageSupervisedResolverInput{
		OS:              "linux",
		Arch:            "amd64",
		GPUVendor:       "nvidia",
		CUDAReady:       true,
		AssetFamily:     ImageAssetFamilyGGUFImage,
		ProfileKind:     ImageProfileKindSingleBinaryModel,
		ArtifactFormats: []string{"gguf"},
	})
	if !selection.Conflict {
		t.Fatalf("expected conflict selection, got %#v", selection)
	}
	if len(selection.ConflictEntryIDs) != 2 {
		t.Fatalf("expected two conflicting entries, got %#v", selection.ConflictEntryIDs)
	}
}
