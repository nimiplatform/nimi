package catalog

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const gib = int64(1) << 30

// cpuHost returns a CPU-only LocalDeviceProfile with the given RAM budget.
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
	if _, ok := local.Preset("minimal"); !ok {
		t.Fatal("expected a minimal preset")
	}
	if _, ok := local.Preset("recommended"); !ok {
		t.Fatal("expected a recommended preset")
	}
	rows := local.LocalPlaneModels()
	if len(rows) == 0 {
		t.Fatal("expected at least one local-plane model row")
	}
	for _, row := range rows {
		if row.Install == nil || len(row.Variants) == 0 || row.Fitness == nil {
			t.Fatalf("local-plane row %q is structurally incomplete", row.ModelID)
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

func TestResolveLocalModelSetInstallLevelInvalid(t *testing.T) {
	local := mustLoadLocal(t)
	outcome := local.ResolveLocalModelSet("aggressive", cpuHost(64))
	if outcome.Kind != LocalResolveFailClose {
		t.Fatalf("expected fail-close, got %v", outcome.Kind)
	}
	if outcome.ReasonCode != ReasonLocalModelResolveInstallLevelInvalid {
		t.Fatalf("expected install-level-invalid reason, got %q", outcome.ReasonCode)
	}
}

func TestResolveLocalModelSetMinimalOnCapableHost(t *testing.T) {
	local := mustLoadLocal(t)
	// A 64 GiB host comfortably fits every minimal variant.
	outcome := local.ResolveLocalModelSet("minimal", cpuHost(64))
	if outcome.Kind != LocalResolveResolved {
		t.Fatalf("expected resolved, got %v (%s)", outcome.Kind, outcome.Detail)
	}
	if outcome.InstallLevel != "minimal" {
		t.Fatalf("expected install level minimal, got %q", outcome.InstallLevel)
	}
	for _, slotID := range []string{"chat", "stt", "tts"} {
		slot, ok := outcome.ResolvedSlotByName(slotID)
		if !ok {
			t.Fatalf("expected resolved slot %q", slotID)
		}
		if slot.AssetID == "" || slot.AssetID != slot.VariantID {
			t.Fatalf("slot %q asset_id must equal a non-empty variant_id, got %q", slotID, slot.AssetID)
		}
	}
}

func TestResolveLocalModelSetSelectsHighestRunnableQuant(t *testing.T) {
	local := mustLoadLocal(t)
	// A 64 GiB host fits the gemma E2B Q8_0 variant — the highest quant rank.
	outcome := local.ResolveLocalModelSet("minimal", cpuHost(64))
	if outcome.Kind != LocalResolveResolved {
		t.Fatalf("expected resolved, got %v", outcome.Kind)
	}
	chat, ok := outcome.ResolvedSlotByName("chat")
	if !ok {
		t.Fatal("expected a resolved chat slot")
	}
	if chat.Quant != "Q8_0" {
		t.Fatalf("expected the highest runnable quant Q8_0, got %q", chat.Quant)
	}
}

func TestResolveLocalModelSetMinimalFailCloseOnTinyHost(t *testing.T) {
	local := mustLoadLocal(t)
	// A 2 GiB host cannot fit any required minimal variant.
	outcome := local.ResolveLocalModelSet("minimal", cpuHost(2))
	if outcome.Kind != LocalResolveFailClose {
		t.Fatalf("expected fail-close on a tiny host, got %v", outcome.Kind)
	}
	if outcome.ReasonCode != ReasonLocalModelResolveHostUnsupported {
		t.Fatalf("expected host-unsupported reason, got %q", outcome.ReasonCode)
	}
}

// TestResolveLocalModelSetRecommendedFailsCloseOnUnsupportedHost verifies the
// resolver never substitutes a different preset: a host that fits the minimal
// chat variants but cannot fit the recommended preset's required slots fails
// closed with local_model_resolve_host_unsupported — it does NOT resolve to
// minimal (K-MCAT-036/037, design/02).
func TestResolveLocalModelSetRecommendedFailsCloseOnUnsupportedHost(t *testing.T) {
	local := mustLoadLocal(t)
	// An 8 GiB host fits minimal chat variants but not the larger recommended
	// chat variants.
	outcome := local.ResolveLocalModelSet("recommended", cpuHost(8))
	if outcome.Kind != LocalResolveFailClose {
		t.Fatalf("expected fail-close on an unsupported recommended host, got %v (%s)", outcome.Kind, outcome.Detail)
	}
	if outcome.ReasonCode != ReasonLocalModelResolveHostUnsupported {
		t.Fatalf("expected host-unsupported reason, got %q", outcome.ReasonCode)
	}
	if outcome.InstallLevel != "recommended" {
		t.Fatalf("resolver must not substitute a preset; install level = %q, want recommended", outcome.InstallLevel)
	}
}

func TestResolveLocalModelSetDeterministic(t *testing.T) {
	local := mustLoadLocal(t)
	host := cpuHost(32)
	first := local.ResolveLocalModelSet("minimal", host)
	second := local.ResolveLocalModelSet("minimal", host)
	if first.Kind != second.Kind || len(first.ResolvedSlots) != len(second.ResolvedSlots) {
		t.Fatal("resolver is not deterministic across identical inputs")
	}
	for i := range first.ResolvedSlots {
		if first.ResolvedSlots[i].AssetID != second.ResolvedSlots[i].AssetID {
			t.Fatalf("slot %d asset_id diverged: %q vs %q",
				i, first.ResolvedSlots[i].AssetID, second.ResolvedSlots[i].AssetID)
		}
	}
}

func TestResolveLocalModelSetNeverSelectsTightVariant(t *testing.T) {
	local := mustLoadLocal(t)
	chat, ok := local.ModelRow("gemma-4-e2b-it-local")
	if !ok {
		t.Fatal("expected the gemma-4-e2b-it-local row")
	}
	// Pick the smallest required RAM among the variants and build a host whose
	// budget is exactly that footprint: ratio == 1.0 is "tight" and must never
	// be auto-selected.
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

// cudaHost returns a CUDA-GPU LocalDeviceProfile with the given RAM + VRAM
// budgets. The resolver consumes only Runtime host evidence (K-DEV-*).
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

// metalHost returns an Apple-Silicon unified-memory LocalDeviceProfile.
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

// TestResolveRecommendedImageSlotResolvesCompanionsOnCudaHost verifies the
// host-conditional image slot resolves on a capable CUDA host and that the
// resolved image slot carries both companion bindings (VAE + text encoder)
// with non-empty variant-level asset ids (K-MCAT-032/035, design/04).
func TestResolveRecommendedImageSlotResolvesCompanionsOnCudaHost(t *testing.T) {
	local := mustLoadLocal(t)
	outcome := local.ResolveLocalModelSet("recommended", cudaHost(64, 24))
	if outcome.Kind != LocalResolveResolved {
		t.Fatalf("expected resolved, got %v (%s)", outcome.Kind, outcome.Detail)
	}
	image, ok := outcome.ResolvedSlotByName("image")
	if !ok {
		t.Fatal("expected the host-conditional image slot to resolve on a 24 GiB CUDA host")
	}
	if image.AssetID == "" || image.AssetID != image.VariantID {
		t.Fatalf("image slot asset_id must equal a non-empty variant_id, got %q", image.AssetID)
	}
	if image.Accelerator != "cuda" {
		t.Fatalf("expected the cuda image variant on a CUDA host, got accelerator %q", image.Accelerator)
	}
	if len(image.Companions) != 2 {
		t.Fatalf("expected 2 resolved companions (vae + text encoder), got %d", len(image.Companions))
	}
	kinds := map[string]ResolvedCompanion{}
	for _, companion := range image.Companions {
		if companion.AssetID == "" || companion.AssetID != companion.VariantID {
			t.Fatalf("companion %q asset_id must equal a non-empty variant_id, got %q", companion.EngineSlot, companion.AssetID)
		}
		if companion.Accelerator != "cuda" {
			t.Fatalf("companion %q must select a cuda variant on a CUDA host, got %q", companion.EngineSlot, companion.Accelerator)
		}
		kinds[companion.CompanionKind] = companion
	}
	vae, hasVAE := kinds["vae"]
	if !hasVAE || vae.EngineSlot != "vae_path" {
		t.Fatalf("expected a vae companion on engine_slot vae_path, got %+v", kinds)
	}
	textEnc, hasTextEnc := kinds["auxiliary"]
	if !hasTextEnc || textEnc.EngineSlot != "llm_path" {
		t.Fatalf("expected an auxiliary text-encoder companion on engine_slot llm_path, got %+v", kinds)
	}
}

// TestResolveRecommendedImageSlotResolvesOnMetalHost verifies the image slot +
// companions also resolve on an Apple-Silicon Metal host.
func TestResolveRecommendedImageSlotResolvesOnMetalHost(t *testing.T) {
	local := mustLoadLocal(t)
	outcome := local.ResolveLocalModelSet("recommended", metalHost(64, 32))
	if outcome.Kind != LocalResolveResolved {
		t.Fatalf("expected resolved, got %v (%s)", outcome.Kind, outcome.Detail)
	}
	image, ok := outcome.ResolvedSlotByName("image")
	if !ok {
		t.Fatal("expected the image slot to resolve on a 32 GiB unified-memory Metal host")
	}
	if image.Accelerator != "metal" {
		t.Fatalf("expected the metal image variant on a Metal host, got %q", image.Accelerator)
	}
	for _, companion := range image.Companions {
		if companion.Accelerator != "metal" {
			t.Fatalf("companion %q must select a metal variant on a Metal host, got %q", companion.EngineSlot, companion.Accelerator)
		}
	}
}

// TestResolveRecommendedImageSlotOmittedOnCpuOnlyHost verifies the
// host-conditional image slot is omitted (not fail-closed) on a host with no
// GPU: the required text/speech slots still resolve (K-MCAT-036, design/02/04).
func TestResolveRecommendedImageSlotOmittedOnCpuOnlyHost(t *testing.T) {
	local := mustLoadLocal(t)
	// A 64 GiB CPU-only host fits the required recommended slots but has no
	// cuda/metal accelerator for any image variant.
	outcome := local.ResolveLocalModelSet("recommended", cpuHost(64))
	if outcome.Kind != LocalResolveResolved {
		t.Fatalf("expected resolved (required slots ship), got %v (%s)", outcome.Kind, outcome.Detail)
	}
	if _, ok := outcome.ResolvedSlotByName("image"); ok {
		t.Fatal("the image slot must be omitted on a GPU-less host, not resolved")
	}
	var omitted *OmittedSlot
	for i := range outcome.OmittedSlots {
		if outcome.OmittedSlots[i].Slot == "image" {
			omitted = &outcome.OmittedSlots[i]
		}
	}
	if omitted == nil {
		t.Fatal("expected the image slot in OmittedSlots")
	}
	if omitted.ReasonCode != ReasonLocalModelResolveSlotOmitted {
		t.Fatalf("expected slot-omitted reason, got %q", omitted.ReasonCode)
	}
	// The required slots must still be present.
	for _, slotID := range []string{"chat", "stt", "tts"} {
		if _, ok := outcome.ResolvedSlotByName(slotID); !ok {
			t.Fatalf("required slot %q must still ship when the optional image slot is omitted", slotID)
		}
	}
}

// TestSelectCompanionVariantsUnsatisfiableWhenNoRunnableVariant verifies
// selectCompanionVariants reports the engine_slot of a companion that has no
// host-runnable variant — the fence that makes the parent slot unsatisfiable
// (K-MCAT-036, design/04).
func TestSelectCompanionVariantsUnsatisfiableWhenNoRunnableVariant(t *testing.T) {
	// A 4 GiB CUDA budget: the vae companion variant (2 GiB footprint) is
	// runnable, the text-encoder companion variant (8 GiB footprint) is not.
	budget := hostBudget{cudaAvailable: true, cpuAvailable: true, vramBytes: 4 * gib}
	companions := []LocalPlaneCompanion{
		{
			CompanionKind: "vae",
			EngineSlot:    "vae_path",
			Variants: []LocalPlaneVariant{{
				VariantID:       "test.vae.f16.cuda",
				Quant:           "F16",
				Files:           []string{"ae.safetensors"},
				Hashes:          map[string]string{"ae.safetensors": "sha256:00"},
				TotalSizeBytes:  1,
				HostRequirement: LocalPlaneHostRequirement{Accelerator: "cuda", MinVRAMBytes: 2 * gib},
			}},
		},
		{
			CompanionKind: "clip",
			EngineSlot:    "llm_path",
			Variants: []LocalPlaneVariant{{
				VariantID:       "test.textenc.q8.cuda",
				Quant:           "Q8_0",
				Files:           []string{"enc.gguf"},
				Hashes:          map[string]string{"enc.gguf": "sha256:00"},
				TotalSizeBytes:  1,
				HostRequirement: LocalPlaneHostRequirement{Accelerator: "cuda", MinVRAMBytes: 8 * gib},
			}},
		},
	}
	resolved, unresolved := selectCompanionVariants(companions, budget)
	if unresolved != "llm_path" {
		t.Fatalf("expected the llm_path companion to be unsatisfiable, got unresolved=%q resolved=%+v", unresolved, resolved)
	}
	// All companions fit on a larger budget.
	if resolvedAll, slot := selectCompanionVariants(companions, hostBudget{cudaAvailable: true, vramBytes: 16 * gib}); slot != "" {
		t.Fatalf("expected every companion to resolve on a 16 GiB budget, got unresolved %q", slot)
	} else if len(resolvedAll) != 2 {
		t.Fatalf("expected 2 resolved companions on a 16 GiB budget, got %d", len(resolvedAll))
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
