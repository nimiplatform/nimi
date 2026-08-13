package catalog

import (
	"fmt"
	"path"
	"strings"

	runtimecatalog "github.com/nimiplatform/nimi/runtime/catalog"
	"gopkg.in/yaml.v3"
)

// localProviderID is the K-MCAT local provider identity.
const localProviderID = "local"

// localProviderSnapshotFile is the embedded built-in local provider snapshot.
const localProviderSnapshotFile = "providers/local.yaml"

// LocalProviderCatalog is the parsed K-MCAT local provider document, exposing
// the K-MCAT-032 local-plane rows and the K-MCAT-033 curated presets. It is the
// single SSOT for verified local-asset truth (K-LOCAL-010 / K-LOCAL-011) — no
// parallel in-process verified-asset literal is admitted.
type LocalProviderCatalog struct {
	CatalogVersion string
	models         []ModelEntry
	modelByID      map[string]*ModelEntry
	presets        *Presets
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
		presets:        doc.Presets,
	}
	for i := range catalog.models {
		key := normalizeID(catalog.models[i].ModelID)
		if key == "" {
			return nil, fmt.Errorf("local provider snapshot has a model row with empty model_id")
		}
		catalog.modelByID[key] = &catalog.models[i]
	}
	if err := catalog.validateLocalPlane(); err != nil {
		return nil, err
	}
	return catalog, nil
}

// localCompanionKinds is the K-LOCAL-007 passive-asset kind enum a companion
// companion_kind must map onto.
var localCompanionKinds = map[string]struct{}{
	"vae":        {},
	"clip":       {},
	"lora":       {},
	"controlnet": {},
	"auxiliary":  {},
}

// validateLocalPlaneVariants fails closed on structurally incomplete K-MCAT-032
// variants (missing variant_id / files / hashes / size / host_requirement). It
// is shared by the main-model variant list and by companion variant lists. The
// seen map is caller-scoped so variant_id uniqueness spans model + companions.
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

// validateLocalPlane fails closed on structurally incomplete local-plane rows,
// companions, and presets. Integrity material (hashes) is mandatory per
// K-MCAT-032.
func (c *LocalProviderCatalog) validateLocalPlane() error {
	for i := range c.models {
		model := &c.models[i]
		if model.Install == nil && len(model.Variants) == 0 && model.Fitness == nil {
			if len(model.Companions) > 0 {
				return fmt.Errorf("local model %q declares companions without a local-plane block", model.ModelID)
			}
			continue
		}
		if model.Install == nil || len(model.Variants) == 0 || model.Fitness == nil {
			return fmt.Errorf("local model %q local-plane block requires install, variants, and fitness together", model.ModelID)
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
		if err := validateLocalCompanions(model, seenVariants); err != nil {
			return err
		}
	}
	return c.validatePresets()
}

// validateLocalCompanions fails closed on structurally invalid K-MCAT-032
// companions: an unknown companion_kind (must map onto K-LOCAL-007), a missing
// or duplicate engine_slot (K-LOCAL-031), or a missing install / variants
// block. seenVariants is the model-scoped variant_id set so a companion
// variant_id can never collide with a main-model variant_id.
func validateLocalCompanions(model *ModelEntry, seenVariants map[string]struct{}) error {
	seenSlots := make(map[string]struct{}, len(model.Companions))
	for idx := range model.Companions {
		companion := &model.Companions[idx]
		kind := strings.ToLower(strings.TrimSpace(companion.CompanionKind))
		if _, ok := localCompanionKinds[kind]; !ok {
			return fmt.Errorf("local model %q companion #%d companion_kind %q is not a K-LOCAL-007 passive kind", model.ModelID, idx, companion.CompanionKind)
		}
		slot := strings.TrimSpace(companion.EngineSlot)
		if slot == "" {
			return fmt.Errorf("local model %q companion %q requires an engine_slot", model.ModelID, kind)
		}
		if _, dup := seenSlots[strings.ToLower(slot)]; dup {
			return fmt.Errorf("local model %q has duplicate companion engine_slot %q", model.ModelID, slot)
		}
		seenSlots[strings.ToLower(slot)] = struct{}{}
		if companion.Install == nil || len(companion.Variants) == 0 {
			return fmt.Errorf("local model %q companion %q requires install and at least one variant", model.ModelID, slot)
		}
		if strings.TrimSpace(companion.Install.Repo) == "" {
			return fmt.Errorf("local model %q companion %q install.repo is required", model.ModelID, slot)
		}
		revision := strings.TrimSpace(companion.Install.Revision)
		if revision == "" || strings.EqualFold(revision, "main") {
			return fmt.Errorf("local model %q companion %q install.revision must be a pinned commit sha", model.ModelID, slot)
		}
		if err := validateLocalPlaneVariants(fmt.Sprintf("local model %q companion %q", model.ModelID, slot), companion.Variants, seenVariants); err != nil {
			return err
		}
	}
	return nil
}

// validatePresets fails closed when a preset slot references a model_ref that
// does not resolve to a local-plane row whose capabilities cover the slot
// capability (K-MCAT-033 invariant).
func (c *LocalProviderCatalog) validatePresets() error {
	if c.presets == nil {
		return nil
	}
	for level, preset := range map[string]*Preset{"minimal": c.presets.Minimal, "recommended": c.presets.Recommended} {
		if preset == nil {
			continue
		}
		if strings.TrimSpace(preset.FactoryAIProfileAlias) == "" {
			return fmt.Errorf("preset %q missing factory_aiprofile_alias", level)
		}
		if len(preset.Slots) == 0 {
			return fmt.Errorf("preset %q declares no slots", level)
		}
		for _, slot := range preset.Slots {
			capability := strings.TrimSpace(slot.Capability)
			if capability == "" {
				return fmt.Errorf("preset %q slot %q missing capability", level, slot.Slot)
			}
			if strings.EqualFold(capability, "text.embed") {
				return fmt.Errorf("preset %q slot %q: text.embed is not an admitted preset slot", level, slot.Slot)
			}
			model := c.modelByID[normalizeID(slot.ModelRef)]
			if model == nil {
				return fmt.Errorf("preset %q slot %q model_ref %q does not resolve to a local catalog row", level, slot.Slot, slot.ModelRef)
			}
			if model.Install == nil || len(model.Variants) == 0 {
				return fmt.Errorf("preset %q slot %q model_ref %q has no local-plane block", level, slot.Slot, slot.ModelRef)
			}
			if !modelHasCapability(*model, capability) {
				return fmt.Errorf("preset %q slot %q model_ref %q does not declare capability %q", level, slot.Slot, slot.ModelRef, capability)
			}
		}
	}
	return nil
}

// Preset returns the curated preset for an install level (minimal|recommended).
func (c *LocalProviderCatalog) Preset(installLevel string) (*Preset, bool) {
	if c == nil || c.presets == nil {
		return nil, false
	}
	switch strings.ToLower(strings.TrimSpace(installLevel)) {
	case "minimal":
		if c.presets.Minimal == nil {
			return nil, false
		}
		return c.presets.Minimal, true
	case "recommended":
		if c.presets.Recommended == nil {
			return nil, false
		}
		return c.presets.Recommended, true
	default:
		return nil, false
	}
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
