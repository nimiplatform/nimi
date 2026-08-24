package catalog

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const gib = int64(1) << 30

func cpuHost(ramGiB int64) *runtimev1.LocalDeviceProfile {
	return &runtimev1.LocalDeviceProfile{
		Os:            "linux",
		Arch:          "amd64",
		TotalRamBytes: ramGiB * gib,
	}
}

func TestLoadBuiltInLocalProviderCatalog(t *testing.T) {
	local, err := LoadBuiltInLocalProviderCatalog()
	if err != nil {
		t.Fatalf("LoadBuiltInLocalProviderCatalog: %v", err)
	}
	if local.CatalogVersion == "" {
		t.Fatal("expected a non-empty catalog version")
	}
	rows := local.LocalPlaneModels()
	if len(rows) == 0 {
		t.Fatal("expected at least one local-plane model row")
	}
	for _, row := range rows {
		if row.Install == nil || len(row.Variants) == 0 {
			t.Fatalf("local-plane row %q is structurally incomplete", row.ModelID)
		}
		_, passive := localPassiveModelTypes[row.ModelType]
		if passive && (row.Fitness != nil || len(row.Capabilities) != 0 || row.Install.PreferredEngine != "") {
			t.Fatalf("passive ModelAsset offer %q carries runnable facts", row.ModelID)
		}
		fitnessOptional := row.ModelType == "tts" || row.ModelType == "stt"
		if !passive && !fitnessOptional && row.Fitness == nil {
			t.Fatalf("runnable local-plane row %q has no fitness", row.ModelID)
		}
		for _, variant := range row.Variants {
			if variant.VariantID == "" {
				t.Fatalf("row %q has a variant with empty variant_id", row.ModelID)
			}
			for _, file := range variant.Files {
				if variant.Hashes[file] == "" {
					t.Fatalf("variant %q file %q is missing an integrity hash", variant.VariantID, file)
				}
			}
		}
	}
}

func TestQwen3ASRPackageNativeCatalogDoesNotAdvertiseUnsupportedTimestamps(t *testing.T) {
	local := mustLoadLocal(t)
	row, ok := local.ModelRow("qwen3-asr-local")
	if !ok {
		t.Fatal("expected qwen3-asr-local catalog row")
	}
	if row.Transcription == nil {
		t.Fatal("expected qwen3-asr-local transcription metadata")
	}
	if row.Transcription.SupportsTimestamps {
		t.Fatal("package-native qwen3-asr must not advertise unsupported timestamps")
	}
	if len(row.Transcription.Tiers) != 1 || row.Transcription.Tiers[0] != "core_transcript" {
		t.Fatalf("package-native qwen3-asr tiers = %v, want [core_transcript]", row.Transcription.Tiers)
	}
}

func TestSelectVariantNeverSelectsTightVariant(t *testing.T) {
	local := mustLoadLocal(t)
	chat, ok := local.ModelRow("gemma-4-e2b-it-local")
	if !ok {
		t.Fatal("expected the gemma-4-e2b-it-local row")
	}
	smallest := int64(1) << 62
	for _, variant := range chat.Variants {
		if variant.HostRequirement.MinRAMBytes < smallest {
			smallest = variant.HostRequirement.MinRAMBytes
		}
	}
	budget := hostBudget{cpuAvailable: true, ramBytes: smallest}
	if _, runnable := selectVariant(chat.Variants, budget); runnable {
		t.Fatal("a tight (ratio==1.0) variant must not be auto-selected")
	}
}

func TestRecommendVariantForHostUsesRuntimeCatalogPolicy(t *testing.T) {
	local := mustLoadLocal(t)
	recipe, ok := local.LoadoutRecipe("z-image")
	if !ok || len(recipe.SlotMetadata) == 0 {
		t.Fatal("expected z-image recipe metadata")
	}
	variantIDs := recipe.SlotMetadata[0].RecommendedVariantIDs
	cudaVariant, ok := local.RecommendVariantForHost(variantIDs, cudaHost(64, 24))
	if !ok || cudaVariant != "local.image.z-image-turbo.q4-k.cuda" {
		t.Fatalf("CUDA recommendation = %q, ok=%t", cudaVariant, ok)
	}
	metalVariant, ok := local.RecommendVariantForHost(variantIDs, metalHost(64, 32))
	if !ok || metalVariant != "local.image.z-image-turbo.q4-k.metal" {
		t.Fatalf("Metal recommendation = %q, ok=%t", metalVariant, ok)
	}
	if variant, ok := local.RecommendVariantForHost(variantIDs, cpuHost(64)); ok || variant != "" {
		t.Fatalf("CPU-only recommendation must fail closed, got %q", variant)
	}
}

func cudaHost(ramGiB int64, vramGiB int64) *runtimev1.LocalDeviceProfile {
	return &runtimev1.LocalDeviceProfile{
		Os:            "linux",
		Arch:          "amd64",
		TotalRamBytes: ramGiB * gib,
		Gpu: &runtimev1.LocalGpuProfile{
			Available:      true,
			Vendor:         "NVIDIA",
			TotalVramBytes: vramGiB * gib,
			MemoryModel:    runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_DISCRETE,
		},
	}
}

func metalHost(ramGiB int64, vramGiB int64) *runtimev1.LocalDeviceProfile {
	return &runtimev1.LocalDeviceProfile{
		Os:            "darwin",
		Arch:          "arm64",
		TotalRamBytes: ramGiB * gib,
		Gpu: &runtimev1.LocalGpuProfile{
			Available:      true,
			Vendor:         "Apple",
			TotalVramBytes: vramGiB * gib,
			MemoryModel:    runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_UNIFIED,
		},
	}
}

func mustLoadLocal(t *testing.T) *LocalProviderCatalog {
	t.Helper()
	local, err := LoadBuiltInLocalProviderCatalog()
	if err != nil {
		t.Fatalf("LoadBuiltInLocalProviderCatalog: %v", err)
	}
	return local
}
