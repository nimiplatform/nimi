package localservice

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestCatalogOfferInstalledAssetProjectionIsExactAndDeterministic(t *testing.T) {
	contentID := "sha256:" + strings.Repeat("a", 64)
	svc := &Service{modelAssets: map[string]*runtimev1.ModelAssetRecord{
		"model_z": {ModelAssetId: "model_z", ContentId: contentID},
		"model_a": {ModelAssetId: "model_a", ContentId: contentID},
		"other":   {ModelAssetId: "other", ContentId: "sha256:" + strings.Repeat("b", 64)},
	}}
	offer := catalogOffer{identity: modelAssetOfferIdentity{
		sourceKind: "huggingface",
		locator:    "owner/model",
		revision:   "revision-1",
		entryID:    "gguf:model.gguf",
	}, entryPath: "model.gguf", files: []string{"model.gguf"}, hashes: map[string]string{"model.gguf": contentID}}
	if got := svc.catalogOfferInstalledAssetID(offer); got != "model_a" {
		t.Fatalf("installed model_asset_id=%q, want model_a", got)
	}
}

func TestRecipeSlotOfferCarriesRuntimeOwnedInstalledModelAssetID(t *testing.T) {
	svc := newLoadoutTestService(t, t.TempDir())
	variantID := ""
	for _, model := range svc.localProviderCatalog.LocalPlaneModels() {
		if len(model.Variants) > 0 {
			variantID = model.Variants[0].VariantID
			break
		}
	}
	if variantID == "" {
		t.Fatal("catalog has no variant")
	}
	offer, ok := svc.catalogOfferForLocalVariant(variantID)
	if !ok {
		t.Fatalf("catalog offer %q not found", variantID)
	}
	files := make([]*runtimev1.ModelAssetFile, 0, len(offer.files))
	for _, path := range offer.files {
		files = append(files, &runtimev1.ModelAssetFile{RelativePath: path, Sha256: offer.hashes[path]})
	}
	svc.modelAssets["model_installed"] = &runtimev1.ModelAssetRecord{
		ModelAssetId: "model_installed",
		ContentId:    modelAssetContentID(files),
	}
	projected := svc.projectRecipeSlotOffers([]string{variantID}, collectDeviceProfile())
	if len(projected) != 1 || !projected[0].GetCandidate().GetInstalled() || projected[0].GetInstalledModelAssetId() != "model_installed" {
		t.Fatalf("slot offer installed projection=%+v", projected)
	}
}

func TestCatalogOfferInstallabilityReusesPassiveAssetKinds(t *testing.T) {
	for _, modelType := range []string{"vae", "clip"} {
		offer := catalogOffer{
			identity:  modelAssetOfferIdentity{sourceKind: "verified", locator: "owner/model", revision: "revision-1", entryID: modelType + ":entry"},
			entryPath: modelType + ".safetensors",
			offerRef:  "offer_" + modelType,
			modelType: modelType,
			files:     []string{modelType + ".safetensors"},
			hashes:    map[string]string{modelType + ".safetensors": strings.Repeat("a", 64)},
		}
		if !catalogOfferInstallable(offer) {
			t.Fatalf("passive %s offer was hidden from existing acquisition semantics", modelType)
		}
	}
}

func TestRecipeAndVerifiedMarketReuseCanonicalVariantOfferRef(t *testing.T) {
	svc := newLoadoutTestService(t, t.TempDir())
	for _, item := range svc.catalogSnapshot() {
		variantID := item.GetTemplateId()
		recipeOffer, ok := svc.catalogOfferForLocalVariant(variantID)
		if !ok {
			continue
		}
		marketOffer, err := catalogOfferFromCatalogItem(item)
		if err != nil {
			t.Fatal(err)
		}
		if recipeOffer.offerRef != marketOffer.offerRef {
			t.Fatalf("variant %q recipe ref=%q market ref=%q", variantID, recipeOffer.offerRef, marketOffer.offerRef)
		}
		return
	}
	t.Fatal("catalog has no comparable canonical variant")
}

func TestRecipeRecommendationOrderingAndRequiredSlotReduction(t *testing.T) {
	items := []*runtimev1.LoadoutRecipeDescriptor{
		{RecipeId: "z-canonical-first", Applicability: runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_SUPPORTED},
		{RecipeId: "unknown", Applicability: runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_UNKNOWN},
		{RecipeId: "a-canonical-second", Applicability: runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_SUPPORTED},
	}
	sortLoadoutRecipeRecommendations(items)
	if items[0].GetRecipeId() != "z-canonical-first" || items[1].GetRecipeId() != "a-canonical-second" || items[2].GetRecipeId() != "unknown" {
		t.Fatalf("recipe applicability partition changed canonical order: %v", []string{items[0].GetRecipeId(), items[1].GetRecipeId(), items[2].GetRecipeId()})
	}

	if applicability, _ := recipeSlotApplicability(nil); applicability != runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_UNKNOWN {
		t.Fatalf("empty slot applicability=%v, want unknown", applicability)
	}
	unsupportedOffer := &runtimev1.LoadoutRecipeOfferDescriptor{Applicability: runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_UNSUPPORTED}
	if applicability, _ := recipeSlotApplicability([]*runtimev1.LoadoutRecipeOfferDescriptor{unsupportedOffer}); applicability != runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_UNSUPPORTED {
		t.Fatalf("all-explicitly-unsupported slot applicability=%v", applicability)
	}

	recipe := &runtimev1.LoadoutRecipeDescriptor{
		Applicability: runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_SUPPORTED,
		Slots: []*runtimev1.LoadoutRecipeSlotDescriptor{
			{Presence: runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED, Applicability: runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_UNKNOWN},
			{Presence: runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_OPTIONAL_CONDITIONAL, Applicability: runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_UNSUPPORTED},
		},
	}
	reduceRecipeApplicability(recipe)
	if recipe.GetApplicability() != runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_UNKNOWN {
		t.Fatalf("required unknown plus optional unsupported recipe applicability=%v", recipe.GetApplicability())
	}
	recipe.Slots[0].Applicability = runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_UNSUPPORTED
	recipe.Applicability = runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_SUPPORTED
	reduceRecipeApplicability(recipe)
	if recipe.GetApplicability() != runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_UNSUPPORTED {
		t.Fatalf("required unsupported recipe applicability=%v", recipe.GetApplicability())
	}
}

func TestCUDAOnlyImageRecipeSlotsRemainVisibleAsUnsupportedOnAppleSilicon(t *testing.T) {
	svc := newLoadoutTestService(t, t.TempDir())
	host := &runtimev1.LocalDeviceProfile{
		Os: "darwin", Arch: "arm64", TotalRamBytes: 128 << 30,
		Gpu: &runtimev1.LocalGpuProfile{Available: true, Vendor: "Apple", TotalVramBytes: 128 << 30, MemoryModel: runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_UNIFIED},
	}
	for _, recipeID := range []string{"ideogram4", "qwen-image", "qwen-image-edit-2511"} {
		recipe, ok := svc.localProviderCatalog.LoadoutRecipe(recipeID)
		if !ok {
			t.Fatalf("recipe %q missing", recipeID)
		}
		for _, slot := range recipe.SlotMetadata {
			ranked := svc.localProviderCatalog.RankVariantsForHost(slot.RecommendedVariantIDs, host)
			offers := svc.projectRecipeSlotOffers(slot.RecommendedVariantIDs, host)
			if len(ranked) == 0 || len(offers) != len(ranked) {
				t.Fatalf("recipe %q slot %q ranked=%d offers=%d", recipeID, slot.SlotID, len(ranked), len(offers))
			}
			for _, offer := range offers {
				if offer.GetApplicability() != runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_UNSUPPORTED {
					t.Fatalf("recipe %q slot %q offer=%+v", recipeID, slot.SlotID, offer)
				}
			}
		}
		options, err := structpb.NewStruct(recipe.DefaultOptions)
		if err != nil {
			t.Fatal(err)
		}
		identity := capabilitydriver.Identity{ImplementationID: recipe.ImplementationID, DriverID: recipe.DriverID, DriverDialect: recipe.DriverDialect}
		_, requirements, implementationFeatures, err := svc.projectRecipe(
			recipe.RecipeID,
			recipe.CapabilityContract,
			identity.Proto(),
			options,
			normalizeStableStringSet(recipe.SupportedFeatures),
		)
		if err != nil {
			t.Fatal(err)
		}
		projected, err := svc.projectLoadoutRecipeDescriptor(
			recipe,
			svc.projectHostRecommendedLoadoutRecipe(recipe, host),
			requirements,
			implementationFeatures,
			host,
			runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_SUPPORTED,
			nil,
		)
		if err != nil {
			t.Fatal(err)
		}
		if projected.GetApplicability() != runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_UNSUPPORTED {
			t.Fatalf("CUDA-only recipe %q projection=%+v", recipeID, projected)
		}
	}
}
