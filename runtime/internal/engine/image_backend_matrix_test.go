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
