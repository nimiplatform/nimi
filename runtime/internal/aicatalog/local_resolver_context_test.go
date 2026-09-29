package catalog

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	gemma26BQ8     = "local.chat.gemma-4-26b-a4b-it.q8-0"
	gemmaE2BQ8     = "local.chat.gemma-4-e2b-it.q8-0"
	gemmaRecipeCap = "text.generate"
)

func cpuHostBytes(ramBytes int64) *runtimev1.LocalDeviceProfile {
	return &runtimev1.LocalDeviceProfile{Os: "linux", Arch: "amd64", TotalRamBytes: ramBytes}
}

func gemmaMainSlotCandidates(t *testing.T, local *LocalProviderCatalog) []string {
	t.Helper()
	for _, recipe := range local.LoadoutRecipes() {
		if recipe.CapabilityContract != gemmaRecipeCap || recipe.RecipeID != "llama.text-generate.gemma4.v1" {
			continue
		}
		for _, slot := range recipe.SlotMetadata {
			if slot.SlotID == "main.gguf" {
				return slot.RecommendedVariantIDs
			}
		}
	}
	t.Fatal("Gemma 4 main.gguf recipe slot is missing")
	return nil
}

func TestGemmaCatalogCarriesGGUFContextEvidence(t *testing.T) {
	local := mustLoadLocal(t)
	for modelID, want := range map[string][2]int64{
		"gemma-4-26b-a4b-it-local": {262144, 20480},
		"gemma-4-e2b-it-local":     {131072, 6144},
	} {
		row, ok := local.ModelRow(modelID)
		if !ok || row.Fitness == nil {
			t.Fatalf("%s has no fitness", modelID)
		}
		if row.Fitness.ContextLength != 32768 || row.Fitness.AuthoredContextLength != want[0] || row.Fitness.KVCacheBytesPerToken != want[1] {
			t.Fatalf("%s fitness = %+v, want reference 32768 and evidence %v", modelID, *row.Fitness, want)
		}
	}
}

func TestContextFitKeepsAutomaticCapacityWhenItFits(t *testing.T) {
	local := mustLoadLocal(t)
	variantID, ok := local.RecommendVariantForHost(gemmaMainSlotCandidates(t, local), cpuHost(128))
	if !ok || variantID != gemma26BQ8 {
		t.Fatalf("128 GiB recommendation = %q/%v, want %s", variantID, ok, gemma26BQ8)
	}
	fit, ok := local.ContextFitForHost(variantID, cpuHost(128))
	if !ok || fit.Reduced() || fit.AuthoredContextSize != 262144 || fit.RecommendedContextSize != 262144 {
		t.Fatalf("128 GiB fit = %+v/%v, want automatic 262144", fit, ok)
	}
}

// 44 GiB keeps the 26B Q8_0 choice (runnable at the reference context) but
// the automatic 262144 context needs 40.375 GiB (tight). 98304 needs
// 37.25 GiB (<= 85%); 106496 needs 37.406 GiB (> 85%).
func TestContextFitReducesToLargestRunnableStepForTheChosenVariant(t *testing.T) {
	local := mustLoadLocal(t)
	host := cpuHost(44)
	variantID, ok := local.RecommendVariantForHost(gemmaMainSlotCandidates(t, local), host)
	if !ok || variantID != gemma26BQ8 {
		t.Fatalf("44 GiB recommendation = %q/%v, want the unchanged %s choice", variantID, ok, gemma26BQ8)
	}
	fit, ok := local.ContextFitForHost(variantID, host)
	if !ok || !fit.Reduced() || fit.AuthoredContextSize != 262144 || fit.RecommendedContextSize != 98304 {
		t.Fatalf("44 GiB fit = %+v/%v, want 98304 of 262144", fit, ok)
	}
	budget := resolveHostBudget(host)
	requirement := func(context int64) int64 { return 36*gib + 20480*(context-32768) }
	if classifyFootprint(requirement(98304), budget.ramBytes) < tierRunnable ||
		classifyFootprint(requirement(98304+contextFitGranularityTokens), budget.ramBytes) >= tierRunnable {
		t.Fatal("98304 is not the largest runnable step")
	}
}

func TestContextFitFloorsAtTheReferenceContext(t *testing.T) {
	local := mustLoadLocal(t)
	// 36/42.5 GiB is runnable at the reference; the next step, 40960, is not.
	host := cpuHostBytes(85 * gib / 2)
	fit, ok := local.ContextFitForHost(gemma26BQ8, host)
	if !ok || fit.RecommendedContextSize != 32768 || fit.AuthoredContextSize != 262144 {
		t.Fatalf("42.5 GiB fit = %+v/%v, want the 32768 reference context", fit, ok)
	}
}

func TestContextFitAppliesToSmallModelsOnSmallHosts(t *testing.T) {
	local := mustLoadLocal(t)
	// 9 GiB at 32768 is runnable on 11 GiB; 131072 needs 9.5625 GiB (tight).
	fit, ok := local.ContextFitForHost(gemmaE2BQ8, cpuHost(11))
	if !ok || fit.AuthoredContextSize != 131072 || fit.RecommendedContextSize != 90112 {
		t.Fatalf("11 GiB E2B fit = %+v/%v, want 90112 of 131072", fit, ok)
	}
}

func TestContextFitIsAbsentWithoutEvidenceOrReferenceFit(t *testing.T) {
	local := mustLoadLocal(t)
	if fit, ok := local.ContextFitForHost(gemma26BQ8, cpuHost(40)); ok {
		t.Fatalf("tight at the reference context must not project a fit, got %+v", fit)
	}
	if fit, ok := local.ContextFitForHost(gemma26BQ8, cpuHost(0)); ok {
		t.Fatalf("missing host memory must not project a fit, got %+v", fit)
	}
	if fit, ok := local.ContextFitForHost("local.embedding.nomic-embed-text-v1.5.q4-k-m", cpuHost(128)); ok {
		t.Fatalf("a model without context evidence must not project a fit, got %+v", fit)
	}
	if fit, ok := local.ContextFitForHost("local.chat.unknown", cpuHost(128)); ok {
		t.Fatalf("an unknown variant must not project a fit, got %+v", fit)
	}
}

func TestLocalPlaneContextEvidenceIsDeclaredAsOnePair(t *testing.T) {
	for name, fitness := range map[string]LocalPlaneFitness{
		"authored only":         {ParamCount: 1, ContextLength: 32768, AuthoredContextLength: 131072},
		"bytes only":            {ParamCount: 1, ContextLength: 32768, KVCacheBytesPerToken: 6144},
		"below reference":       {ParamCount: 1, ContextLength: 32768, AuthoredContextLength: 16384, KVCacheBytesPerToken: 6144},
		"negative bytes":        {ParamCount: 1, ContextLength: 32768, AuthoredContextLength: 131072, KVCacheBytesPerToken: -1},
		"missing reference ctx": {ParamCount: 1, AuthoredContextLength: 131072, KVCacheBytesPerToken: 6144},
	} {
		fitness := fitness
		if err := validateLocalPlaneContextEvidence("m", &fitness); err == nil {
			t.Fatalf("%s: expected a validation failure", name)
		}
	}
	for _, fitness := range []*LocalPlaneFitness{nil, {ParamCount: 1, ContextLength: 32768}, {ParamCount: 1, ContextLength: 32768, AuthoredContextLength: 32768, KVCacheBytesPerToken: 1}} {
		if err := validateLocalPlaneContextEvidence("m", fitness); err != nil {
			t.Fatalf("valid fitness %+v rejected: %v", fitness, err)
		}
	}
}
