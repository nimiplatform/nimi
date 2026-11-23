package localservice

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/proto"
)

func gemmaRecipeOnHost(t *testing.T, svc *Service, totalGiB int64) *runtimev1.LoadoutRecipeDescriptor {
	t.Helper()
	localRuntimeProbeRAM = func() (int64, int64) { return totalGiB << 30, totalGiB << 29 }
	response, err := svc.ListLoadoutRecipes(context.Background(), &runtimev1.ListLoadoutRecipesRequest{CapabilityContract: capabilitydriver.LlamaCapabilityContract})
	if err != nil {
		t.Fatalf("ListLoadoutRecipes: %v", err)
	}
	for _, recipe := range response.GetRecipes() {
		if recipe.GetRecipeId() == capabilitydriver.LlamaGenericGGUFRecipeID {
			return recipe
		}
	}
	t.Fatal("llama.text-generate.gguf.v1 recipe is missing")
	return nil
}

func recipeSlot(t *testing.T, recipe *runtimev1.LoadoutRecipeDescriptor, slotID string) *runtimev1.LoadoutRecipeSlotDescriptor {
	t.Helper()
	for _, slot := range recipe.GetSlots() {
		if slot.GetSlotId() == slotID {
			return slot
		}
	}
	t.Fatalf("recipe slot %q is missing", slotID)
	return nil
}

// The host keeps its coherent E2B Q8_0 recommendation; what changes is that the
// recommended configuration runs at a context that fits (model-catalog r061).
func TestListLoadoutRecipesRecommendsAVerifiedContextForTheRecommendedVariant(t *testing.T) {
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	previousProbeRAM := localRuntimeProbeRAM
	t.Cleanup(func() { localRuntimeProbeRAM = previousProbeRAM })
	svc := newLoadoutTestService(t, t.TempDir())

	recipe := gemmaRecipeOnHost(t, svc, 11)
	main := recipeSlot(t, recipe, capabilitydriver.MainGGUFRequirementID)
	if got := main.GetRecommendedVariantIds(); len(got) != 1 || got[0] != "local.chat.gemma-4-e2b-it.q8-0" {
		t.Fatalf("11 GiB recommended variant = %v, want coherent E2B Q8_0 choice", got)
	}
	fit := main.GetRecommendedContextFit()
	if fit.GetAuthoredContextSize() != 131072 || fit.GetRecommendedContextSize() != 90112 {
		t.Fatalf("11 GiB recommended context fit = %+v, want 90112 of 131072", fit)
	}
	options := fit.GetRecommendedOptions().GetFields()
	if len(options) != 1 || options["contextSize"].GetNumberValue() != 90112 {
		t.Fatalf("reduced recommended options = %v, want only the Driver context size", options)
	}
	if !proto.Equal(recipe.GetRecommendedOptions(), fit.GetRecommendedOptions()) {
		t.Fatalf("recipe recommended options %v differ from the recommended slot fit %v", recipe.GetRecommendedOptions(), fit.GetRecommendedOptions())
	}
	if len(recipe.GetDefaultOptions().GetFields()) != 0 {
		t.Fatalf("default options must stay the omitted automatic mode, got %v", recipe.GetDefaultOptions())
	}
	// What the preview states is what the Driver runs once the options are applied.
	if window, err := (capabilitydriver.LlamaTextDriver{}).TextContextWindow(recipe.GetRecommendedOptions(), fit.GetAuthoredContextSize()); err != nil || window != fit.GetRecommendedContextSize() {
		t.Fatalf("recommended options run with (%d, %v), want %d", window, err, fit.GetRecommendedContextSize())
	}

	reduced := 0
	for _, offer := range main.GetOffers() {
		offerFit := offer.GetContextFit()
		if offerFit == nil {
			continue
		}
		if offerFit.GetRecommendedContextSize() < offerFit.GetAuthoredContextSize() {
			reduced++
			if !proto.Equal(offerFit, fit) {
				t.Fatalf("reduced offer fit %+v differs from the recommended variant's fit %+v", offerFit, fit)
			}
			continue
		}
		if len(offerFit.GetRecommendedOptions().GetFields()) != 0 {
			t.Fatalf("automatic offer fit must keep the context option omitted: %+v", offerFit)
		}
	}
	if reduced != 1 {
		t.Fatalf("11 GiB reduced offers = %d, want only E2B Q8_0", reduced)
	}
	projector := recipeSlot(t, recipe, capabilitydriver.CompanionMMProjRequirementID)
	if projector.GetRecommendedContextFit() != nil {
		t.Fatalf("a projector carries no context evidence, got %+v", projector.GetRecommendedContextFit())
	}
	for _, offer := range projector.GetOffers() {
		if offer.GetContextFit() != nil {
			t.Fatalf("projector offer carries a context fit: %+v", offer)
		}
	}

	recipe = gemmaRecipeOnHost(t, svc, 128)
	fit = recipeSlot(t, recipe, capabilitydriver.MainGGUFRequirementID).GetRecommendedContextFit()
	if fit.GetAuthoredContextSize() != 131072 || fit.GetRecommendedContextSize() != 131072 || len(fit.GetRecommendedOptions().GetFields()) != 0 {
		t.Fatalf("128 GiB fit = %+v, want the automatic 131072 capacity", fit)
	}
	if len(recipe.GetRecommendedOptions().GetFields()) != 0 {
		t.Fatalf("128 GiB recommended options = %v, want the omitted automatic mode", recipe.GetRecommendedOptions())
	}
}
