package localservice

import (
	"testing"

	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
)

func TestProjectVerifiedVoxCPMAssetCarriesCanonicalFamilyAndPrivateBackend(t *testing.T) {
	row := catalog.ModelEntry{
		ModelID:      "voxcpm2-local",
		ModelType:    "tts",
		Family:       "voxcpm",
		Capabilities: []string{"audio.synthesize"},
		Install: &catalog.LocalPlaneInstall{
			Repo:            "openbmb/VoxCPM2",
			Revision:        "bffb3df5a29440629464e5e839f4d214c8714c3d",
			InstallKind:     "verified-hf-multi-file",
			Entry:           "model.safetensors",
			ArtifactRoles:   []string{"tts_model"},
			PreferredEngine: "speech",
		},
	}
	variant := catalog.LocalPlaneVariant{
		VariantID:      "local.tts.voxcpm2.mlx.metal",
		Quant:          "Q4_0",
		Entry:          "model.safetensors",
		Files:          []string{"model.safetensors"},
		Hashes:         map[string]string{"model.safetensors": "sha256:25bddc99a7cc6d28214f12dd676ed0afa9b0a805d6477f85c275bb113cb8acee"},
		TotalSizeBytes: 2300904017,
		Repo:           "mlx-community/VoxCPM2-4bit",
		Revision:       "dc9e5c187858da5f4a13dc4c247e297339216381",
		DriverBackend:  "mlx",
		HostRequirement: catalog.LocalPlaneHostRequirement{
			Accelerator:  "metal",
			MinRAMBytes:  8589934592,
			MinVRAMBytes: 6442450944,
		},
	}

	descriptor, err := projectVerifiedAssetDescriptor(row, variant)
	if err != nil {
		t.Fatalf("project VoxCPM descriptor: %v", err)
	}
	if descriptor.GetRepo() != variant.Repo || descriptor.GetRevision() != variant.Revision {
		t.Fatalf("variant source override was lost: repo=%q revision=%q", descriptor.GetRepo(), descriptor.GetRevision())
	}
	if descriptor.GetMetadata().GetFields()["family"].GetStringValue() != "voxcpm" ||
		descriptor.GetEngineConfig().GetFields()["driver_family"].GetStringValue() != "voxcpm" ||
		descriptor.GetEngineConfig().GetFields()["driver_backend"].GetStringValue() != "mlx" {
		t.Fatalf("VoxCPM descriptor identity material=%+v engine=%+v", descriptor.GetMetadata(), descriptor.GetEngineConfig())
	}
	if len(descriptor.GetCapabilities()) != 1 || descriptor.GetCapabilities()[0] != "audio.synthesize" {
		t.Fatalf("VoxCPM capabilities=%v", descriptor.GetCapabilities())
	}
}
