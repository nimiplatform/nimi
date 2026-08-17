package catalog

import (
	"fmt"
	"path"
	"regexp"
	"strings"

	runtimecatalog "github.com/nimiplatform/nimi/runtime/catalog"
	"gopkg.in/yaml.v3"
)

// localProviderID is the K-MCAT local provider identity.
const localProviderID = "local"

// localProviderSnapshotFile is the embedded built-in local provider snapshot.
const localProviderSnapshotFile = "providers/local.yaml"

// LocalProviderCatalog is the parsed K-MCAT local provider document, exposing
// local-plane model rows and Loadout recipe recommendations.
type LocalProviderCatalog struct {
	CatalogVersion string
	models         []ModelEntry
	modelByID      map[string]*ModelEntry
	loadoutRecipes []LocalLoadoutRecipe
	recipeByID     map[string]*LocalLoadoutRecipe
}

// LoadBuiltInLocalProviderCatalog parses the embedded built-in local provider
// snapshot (runtime/catalog/providers/local.yaml). It fails closed when the
// snapshot is missing, unparseable, or structurally invalid.
func LoadBuiltInLocalProviderCatalog() (*LocalProviderCatalog, error) {
	raw, err := runtimecatalog.DefaultProvidersFS.ReadFile(path.Join(localProviderSnapshotFile))
	if err != nil {
		return nil, fmt.Errorf("read embedded local provider snapshot: %w", err)
	}
	var doc ProviderDocument
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("parse embedded local provider snapshot: %w", err)
	}
	if normalizeProvider(doc.Provider) != localProviderID {
		return nil, fmt.Errorf("embedded local provider snapshot has unexpected provider %q", doc.Provider)
	}
	catalog := &LocalProviderCatalog{
		CatalogVersion: strings.TrimSpace(doc.CatalogVersion),
		models:         append([]ModelEntry(nil), doc.Models...),
		modelByID:      make(map[string]*ModelEntry, len(doc.Models)),
		loadoutRecipes: append([]LocalLoadoutRecipe(nil), doc.LoadoutRecipes...),
		recipeByID:     make(map[string]*LocalLoadoutRecipe, len(doc.LoadoutRecipes)),
	}
	for i := range catalog.models {
		key := normalizeID(catalog.models[i].ModelID)
		if key == "" {
			return nil, fmt.Errorf("local provider snapshot has a model row with empty model_id")
		}
		catalog.modelByID[key] = &catalog.models[i]
	}
	for i := range catalog.loadoutRecipes {
		recipeID := strings.TrimSpace(catalog.loadoutRecipes[i].RecipeID)
		if recipeID == "" || recipeID != catalog.loadoutRecipes[i].RecipeID {
			return nil, fmt.Errorf("local provider snapshot has a Loadout recipe with invalid recipe_id")
		}
		if _, duplicate := catalog.recipeByID[recipeID]; duplicate {
			return nil, fmt.Errorf("local provider snapshot has duplicate Loadout recipe %q", recipeID)
		}
		catalog.recipeByID[recipeID] = &catalog.loadoutRecipes[i]
	}
	if err := catalog.validateLocalPlane(); err != nil {
		return nil, err
	}
	return catalog, nil
}

var localPassiveModelTypes = map[string]struct{}{
	"vae":        {},
	"clip":       {},
	"lora":       {},
	"controlnet": {},
	"auxiliary":  {},
}

var localExactSHA256Pattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

// validateLocalPlaneVariants fails closed on structurally incomplete K-MCAT-032
// variants (missing variant_id / files / hashes / size / host_requirement). It
// is shared by runnable and passive independent ModelAsset offer rows. The
// seen map is caller-scoped to one canonical model row.
func validateLocalPlaneVariants(scope string, variants []LocalPlaneVariant, seenVariants map[string]struct{}) error {
	for _, variant := range variants {
		variantID := strings.TrimSpace(variant.VariantID)
		if variantID == "" {
			return fmt.Errorf("%s has a variant with empty variant_id", scope)
		}
		if _, dup := seenVariants[strings.ToLower(variantID)]; dup {
			return fmt.Errorf("%s has duplicate variant_id %q", scope, variantID)
		}
		seenVariants[strings.ToLower(variantID)] = struct{}{}
		if len(variant.Files) == 0 {
			return fmt.Errorf("local variant %q declares no files", variantID)
		}
		for _, file := range variant.Files {
			hash := strings.TrimSpace(variant.Hashes[file])
			if hash == "" {
				return fmt.Errorf("local variant %q file %q is missing an integrity hash", variantID, file)
			}
		}
		if variant.TotalSizeBytes <= 0 {
			return fmt.Errorf("local variant %q total_size_bytes must be positive", variantID)
		}
		repo := strings.TrimSpace(variant.Repo)
		revision := strings.TrimSpace(variant.Revision)
		if (repo == "") != (revision == "") || strings.EqualFold(revision, "main") {
			return fmt.Errorf("local variant %q source override requires repo and pinned revision together", variantID)
		}
		backend := strings.ToLower(strings.TrimSpace(variant.DriverBackend))
		if backend != "" && backend != "standard" && backend != "mlx" {
			return fmt.Errorf("local variant %q driver_backend must be standard or mlx", variantID)
		}
		accelerator := strings.ToLower(strings.TrimSpace(variant.HostRequirement.Accelerator))
		if accelerator != "cpu" && accelerator != "metal" && accelerator != "cuda" {
			return fmt.Errorf("local variant %q host_requirement.accelerator must be cpu|metal|cuda", variantID)
		}
		if accelerator != "cpu" && variant.HostRequirement.MinVRAMBytes <= 0 {
			return fmt.Errorf("local variant %q host_requirement.min_vram_bytes is required for accelerator %q", variantID, accelerator)
		}
	}
	return nil
}

// validateLocalPlane fails closed on structurally incomplete independent local
// ModelAsset offers. Integrity material is mandatory per K-MCAT-032.
func (c *LocalProviderCatalog) validateLocalPlane() error {
	for i := range c.models {
		model := &c.models[i]
		if model.Install == nil && len(model.Variants) == 0 && model.Fitness == nil {
			continue
		}
		if model.Install == nil || len(model.Variants) == 0 {
			return fmt.Errorf("local model %q local-plane block requires install and variants together", model.ModelID)
		}
		_, passive := localPassiveModelTypes[strings.ToLower(strings.TrimSpace(model.ModelType))]
		if passive && (len(model.Capabilities) != 0 || model.Fitness != nil || strings.TrimSpace(model.Install.PreferredEngine) != "") {
			return fmt.Errorf("local passive ModelAsset offer %q carries capability, fitness, or engine authority", model.ModelID)
		}
		if !passive && model.Fitness == nil {
			return fmt.Errorf("local runnable model %q requires fitness", model.ModelID)
		}
		if strings.TrimSpace(model.Install.Repo) == "" {
			return fmt.Errorf("local model %q install.repo is required", model.ModelID)
		}
		revision := strings.TrimSpace(model.Install.Revision)
		if revision == "" || strings.EqualFold(revision, "main") {
			return fmt.Errorf("local model %q install.revision must be a pinned commit sha", model.ModelID)
		}
		seenVariants := make(map[string]struct{}, len(model.Variants))
		if err := validateLocalPlaneVariants(fmt.Sprintf("local model %q", model.ModelID), model.Variants, seenVariants); err != nil {
			return err
		}
	}
	return c.validateLoadoutRecipes()
}

func (c *LocalProviderCatalog) validateLoadoutRecipes() error {
	for _, recipe := range c.loadoutRecipes {
		for _, value := range []string{recipe.RecipeID, recipe.Revision, recipe.Title, recipe.CapabilityContract, recipe.ImplementationID, recipe.DriverID, recipe.DriverDialect} {
			if strings.TrimSpace(value) == "" || strings.TrimSpace(value) != value {
				return fmt.Errorf("local Loadout recipe %q has incomplete or non-canonical identity", recipe.RecipeID)
			}
		}
		if len(recipe.SlotMetadata) == 0 {
			return fmt.Errorf("local Loadout recipe %q has no slot_metadata", recipe.RecipeID)
		}
		seenCustodyFiles := make(map[string]struct{}, len(recipe.Custody))
		for _, custody := range recipe.Custody {
			file := strings.TrimSpace(custody.File)
			if file == "" || file != custody.File ||
				strings.TrimSpace(custody.Source) == "" || strings.TrimSpace(custody.Source) != custody.Source ||
				strings.TrimSpace(custody.Role) == "" || strings.TrimSpace(custody.Role) != custody.Role ||
				!localExactSHA256Pattern.MatchString(custody.SHA256) {
				return fmt.Errorf("local Loadout recipe %q has invalid custody metadata", recipe.RecipeID)
			}
			if _, duplicate := seenCustodyFiles[file]; duplicate {
				return fmt.Errorf("local Loadout recipe %q has duplicate custody file %q", recipe.RecipeID, file)
			}
			seenCustodyFiles[file] = struct{}{}
		}
		seenSlots := make(map[string]struct{}, len(recipe.SlotMetadata))
		for _, slot := range recipe.SlotMetadata {
			slotID := strings.TrimSpace(slot.SlotID)
			if slotID == "" || slotID != slot.SlotID || strings.TrimSpace(slot.DisplayLabel) == "" {
				return fmt.Errorf("local Loadout recipe %q has invalid slot metadata", recipe.RecipeID)
			}
			if _, duplicate := seenSlots[slotID]; duplicate {
				return fmt.Errorf("local Loadout recipe %q has duplicate slot_metadata %q", recipe.RecipeID, slotID)
			}
			seenSlots[slotID] = struct{}{}
			if len(slot.ModelContract) == 0 {
				return fmt.Errorf("local Loadout recipe %q slot %q has no Model Contract", recipe.RecipeID, slotID)
			}
			seenRecommendations := make(map[string]struct{}, len(slot.RecommendedContentIDs))
			for _, contentID := range slot.RecommendedContentIDs {
				if !localExactSHA256Pattern.MatchString(contentID) {
					return fmt.Errorf("local Loadout recipe %q slot %q has invalid recommended content identity", recipe.RecipeID, slotID)
				}
				if _, duplicate := seenRecommendations[contentID]; duplicate {
					return fmt.Errorf("local Loadout recipe %q slot %q has duplicate recommended content identity", recipe.RecipeID, slotID)
				}
				seenRecommendations[contentID] = struct{}{}
			}
		}
	}
	return nil
}

// ValidateLoadoutRecipeSlots compares catalog slot_metadata with the complete
// live Driver projection. The catalog never supplies an expected topology.
func (c *LocalProviderCatalog) ValidateLoadoutRecipeSlots(project func(LocalLoadoutRecipe) ([]string, error)) error {
	if c == nil || project == nil {
		return fmt.Errorf("Loadout recipe Driver projector is required")
	}
	for _, recipe := range c.loadoutRecipes {
		projected, err := project(recipe)
		if err != nil {
			return fmt.Errorf("local Loadout recipe %q Driver projection failed: %w", recipe.RecipeID, err)
		}
		seenProjected := make(map[string]struct{}, len(projected))
		for _, slotID := range projected {
			if slotID = strings.TrimSpace(slotID); slotID == "" {
				return fmt.Errorf("local Loadout recipe %q Driver projected an empty slot", recipe.RecipeID)
			}
			if _, duplicate := seenProjected[slotID]; duplicate {
				return fmt.Errorf("local Loadout recipe %q Driver projected duplicate slot %q", recipe.RecipeID, slotID)
			}
			seenProjected[slotID] = struct{}{}
		}
		seenMetadata := make(map[string]struct{}, len(recipe.SlotMetadata))
		for _, slot := range recipe.SlotMetadata {
			seenMetadata[slot.SlotID] = struct{}{}
		}
		for slotID := range seenProjected {
			if _, ok := seenMetadata[slotID]; !ok {
				return fmt.Errorf("local Loadout recipe %q slot_metadata is missing Driver slot %q", recipe.RecipeID, slotID)
			}
		}
		for slotID := range seenMetadata {
			if _, ok := seenProjected[slotID]; !ok {
				return fmt.Errorf("local Loadout recipe %q slot_metadata has extra slot %q", recipe.RecipeID, slotID)
			}
		}
	}
	return nil
}

// ModelRow returns the local-plane catalog row for a model id.
func (c *LocalProviderCatalog) ModelRow(modelID string) (*ModelEntry, bool) {
	if c == nil {
		return nil, false
	}
	model, ok := c.modelByID[normalizeID(modelID)]
	return model, ok
}

// LocalPlaneModels returns every catalog row that carries a K-MCAT-032
// local-plane block. The result is a copy; callers must not mutate the catalog.
func (c *LocalProviderCatalog) LocalPlaneModels() []ModelEntry {
	if c == nil {
		return nil
	}
	out := make([]ModelEntry, 0, len(c.models))
	for _, model := range c.models {
		if model.Install == nil || len(model.Variants) == 0 {
			continue
		}
		out = append(out, model)
	}
	return out
}

func (c *LocalProviderCatalog) LoadoutRecipe(recipeID string) (LocalLoadoutRecipe, bool) {
	if c == nil {
		return LocalLoadoutRecipe{}, false
	}
	recipe := c.recipeByID[strings.TrimSpace(recipeID)]
	if recipe == nil {
		return LocalLoadoutRecipe{}, false
	}
	return cloneLocalLoadoutRecipe(*recipe), true
}

func (c *LocalProviderCatalog) LoadoutRecipes() []LocalLoadoutRecipe {
	if c == nil {
		return nil
	}
	result := make([]LocalLoadoutRecipe, 0, len(c.loadoutRecipes))
	for _, recipe := range c.loadoutRecipes {
		result = append(result, cloneLocalLoadoutRecipe(recipe))
	}
	return result
}

func cloneLocalLoadoutRecipe(recipe LocalLoadoutRecipe) LocalLoadoutRecipe {
	recipe.DefaultOptions = cloneAnyMap(recipe.DefaultOptions)
	recipe.SupportedFeatures = append([]string(nil), recipe.SupportedFeatures...)
	recipe.Custody = append([]LocalRecipeCustody(nil), recipe.Custody...)
	slots := make([]LocalRecipeSlotMetadata, 0, len(recipe.SlotMetadata))
	for _, slot := range recipe.SlotMetadata {
		slot.RecommendedVariantIDs = append([]string(nil), slot.RecommendedVariantIDs...)
		slot.RecommendedContentIDs = append([]string(nil), slot.RecommendedContentIDs...)
		slot.ModelContract = cloneAnyMap(slot.ModelContract)
		slots = append(slots, slot)
	}
	recipe.SlotMetadata = slots
	return recipe
}

func cloneAnyMap(input map[string]any) map[string]any {
	if input == nil {
		return nil
	}
	result := make(map[string]any, len(input))
	for key, value := range input {
		result[key] = value
	}
	return result
}
