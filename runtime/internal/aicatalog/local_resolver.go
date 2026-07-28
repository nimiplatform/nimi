package catalog

import (
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// Resolver reason codes are Runtime-owned activation projection identifiers;
// consumers must not invent their own.
const (
	ReasonLocalModelResolveInstallLevelInvalid = "local_model_resolve_install_level_invalid"
	ReasonLocalModelResolveSlotOmitted         = "local_model_resolve_slot_omitted"
	ReasonLocalModelResolveHostUnsupported     = "local_model_resolve_host_unsupported"
)

// LocalResolveOutcomeKind discriminates resolved and fail-closed outcomes.
type LocalResolveOutcomeKind string

const (
	LocalResolveResolved  LocalResolveOutcomeKind = "resolved"
	LocalResolveFailClose LocalResolveOutcomeKind = "fail_close"
)

// variantFitTier is the bounded head-room tier used by the variant selector.
type variantFitTier int

const (
	tierRecommended    variantFitTier = 4 // estimated_mem <= 70% budget
	tierRunnable       variantFitTier = 3 // <= 85%
	tierTight          variantFitTier = 2 // <= 100%
	tierNotRecommended variantFitTier = 1 // > budget
	tierIneligible     variantFitTier = 0 // accelerator unavailable / no budget evidence
)

// quantRank is the fixed K-MCAT-035 total order over quant identifiers. A
// higher rank is a higher-fidelity quant. Unknown quant tokens rank 0 and only
// tie-break by variant_id. Same-precision K-variants share a rank; the stable
// variant_id tie-break makes selection deterministic among them.
var quantRank = map[string]int{
	"f16":    9,
	"q8_0":   8,
	"q6_k":   7,
	"q5_k_m": 6,
	"q5_k_s": 6,
	"q5_0":   5,
	"q4_k_m": 4,
	"q4_k":   4,
	"q4_k_s": 4,
	"q4_0":   3,
	"q3":     2,
	"q3_k":   2,
	"q3_k_m": 2,
	"q3_k_s": 2,
	"q2":     1,
	"q2_k":   1,
}

// ResolvedCompanion is one resolved K-MCAT-032 companion binding: a concrete
// variant-level passive asset bound to its parent slot. AssetID is the
// companion variant_id; it becomes the asset_id of a model.companion-asset
// dependency whose parent_asset_id is the parent slot's resolved AssetID.
type ResolvedCompanion struct {
	CompanionKind string
	EngineSlot    string
	AssetID       string // companion variant-level installable identity (variant_id)
	VariantID     string
	Quant         string
	Accelerator   string // selected variant host_requirement.accelerator
}

// ResolvedSlot is one resolved K-MCAT-034 slot: a concrete variant-level asset.
// Companions carries the resolved passive companion bindings (K-MCAT-032 /
// design/04) — empty for core text/speech slots whose models have no
// companions.
type ResolvedSlot struct {
	Slot        string
	Capability  string
	ModelRef    string
	AssetID     string // variant-level installable identity (variant_id)
	VariantID   string
	Quant       string
	Accelerator string // selected variant host_requirement.accelerator
	Companions  []ResolvedCompanion
}

// OmittedSlot is a host-conditional slot the resolver dropped (K-MCAT-036).
type OmittedSlot struct {
	Slot       string
	Capability string
	ModelRef   string
	ReasonCode string
	Note       string
}

// LocalResolveOutcome is the deterministic result of resolving an install
// level + host posture over the curated catalog (K-MCAT-034..037).
type LocalResolveOutcome struct {
	Kind LocalResolveOutcomeKind

	// InstallLevel is the level the ResolvedSlots were resolved at. The
	// resolver never substitutes a different preset, so this always equals the
	// requested install level.
	InstallLevel string

	ResolvedSlots []ResolvedSlot
	OmittedSlots  []OmittedSlot

	// ReasonCode is set for fail-close outcomes.
	ReasonCode string
	Detail     string
}

// hostBudget captures the resolved per-accelerator memory budget and
// availability derived from the Runtime LocalDeviceProfile (K-DEV-*). The
// resolver consumes Runtime host evidence only; it never re-probes hardware.
type hostBudget struct {
	cpuAvailable   bool
	metalAvailable bool
	cudaAvailable  bool
	ramBytes       int64
	vramBytes      int64
	// unifiedMemory marks a host whose GPU shares system RAM (Apple Silicon).
	unifiedMemory bool
}

// resolveHostBudget projects a LocalDeviceProfile into accelerator availability
// and memory budgets.
func resolveHostBudget(profile *runtimev1.LocalDeviceProfile) hostBudget {
	budget := hostBudget{cpuAvailable: true}
	if profile == nil {
		return budget
	}
	budget.ramBytes = profile.GetTotalRamBytes()
	gpu := profile.GetGpu()
	if gpu != nil && gpu.GetAvailable() {
		vendor := strings.ToLower(strings.TrimSpace(gpu.GetVendor()))
		os := strings.ToLower(strings.TrimSpace(profile.GetOs()))
		if gpu.GetMemoryModel() == runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_UNIFIED || os == "darwin" {
			budget.unifiedMemory = true
		}
		switch {
		case strings.Contains(vendor, "apple") || os == "darwin":
			budget.metalAvailable = true
		case strings.Contains(vendor, "nvidia"):
			budget.cudaAvailable = true
		}
		budget.vramBytes = gpu.GetTotalVramBytes()
		// On a unified-memory host the GPU shares system RAM; when the VRAM
		// probe is unavailable fall back to the RAM budget.
		if budget.unifiedMemory && budget.vramBytes <= 0 {
			budget.vramBytes = budget.ramBytes
		}
	}
	return budget
}

// classifyVariant returns the K-MCAT-035 fit tier for one variant against the
// host budget. A variant whose accelerator is unavailable, or whose budget
// evidence is missing, is tierIneligible (never auto-selected).
func classifyVariant(variant LocalPlaneVariant, budget hostBudget) variantFitTier {
	accelerator := strings.ToLower(strings.TrimSpace(variant.HostRequirement.Accelerator))
	var available bool
	var hostBudgetBytes int64
	var footprintBytes int64
	switch accelerator {
	case "cpu":
		available = budget.cpuAvailable
		hostBudgetBytes = budget.ramBytes
		footprintBytes = variant.HostRequirement.MinRAMBytes
	case "metal":
		available = budget.metalAvailable
		hostBudgetBytes = budget.vramBytes
		footprintBytes = variant.HostRequirement.MinVRAMBytes
	case "cuda":
		available = budget.cudaAvailable
		hostBudgetBytes = budget.vramBytes
		footprintBytes = variant.HostRequirement.MinVRAMBytes
	default:
		return tierIneligible
	}
	if !available {
		return tierIneligible
	}
	// Missing budget evidence or footprint must fail closed to ineligible —
	// the resolver never selects a variant on unverified head-room.
	if hostBudgetBytes <= 0 || footprintBytes <= 0 {
		return tierIneligible
	}
	ratio := float64(footprintBytes) / float64(hostBudgetBytes)
	switch {
	case ratio <= 0.70:
		return tierRecommended
	case ratio <= 0.85:
		return tierRunnable
	case ratio <= 1.00:
		return tierTight
	default:
		return tierNotRecommended
	}
}

// selectVariant picks the highest-quant-rank variant that reaches at least the
// runnable tier (K-MCAT-035). tight / not_recommended variants are never
// auto-selected. Returns false when no variant is runnable on this host.
func selectVariant(variants []LocalPlaneVariant, budget hostBudget) (LocalPlaneVariant, bool) {
	type candidate struct {
		variant LocalPlaneVariant
		rank    int
	}
	eligible := make([]candidate, 0, len(variants))
	for _, variant := range variants {
		if classifyVariant(variant, budget) >= tierRunnable {
			eligible = append(eligible, candidate{
				variant: variant,
				rank:    quantRank[strings.ToLower(strings.TrimSpace(variant.Quant))],
			})
		}
	}
	if len(eligible) == 0 {
		return LocalPlaneVariant{}, false
	}
	// Deterministic order: highest quant rank first, then stable variant_id
	// tie-break.
	sort.Slice(eligible, func(i, j int) bool {
		if eligible[i].rank != eligible[j].rank {
			return eligible[i].rank > eligible[j].rank
		}
		return strings.ToLower(eligible[i].variant.VariantID) < strings.ToLower(eligible[j].variant.VariantID)
	})
	return eligible[0].variant, true
}

// ResolveLocalModelSet implements the K-MCAT-034 deterministic resolver:
// (install_level, host_posture) -> ResolvedModelSet | FailClose. Identical
// (install_level, host_posture, catalog_version) yields an identical outcome.
// The resolver never substitutes a different preset: the chosen install level
// resolves for this host or it fails closed (K-MCAT-036/037).
func (c *LocalProviderCatalog) ResolveLocalModelSet(installLevel string, hostPosture *runtimev1.LocalDeviceProfile) LocalResolveOutcome {
	level := strings.ToLower(strings.TrimSpace(installLevel))
	if level != "minimal" && level != "recommended" {
		return LocalResolveOutcome{
			Kind:         LocalResolveFailClose,
			InstallLevel: level,
			ReasonCode:   ReasonLocalModelResolveInstallLevelInvalid,
			Detail:       fmt.Sprintf("install level must be minimal or recommended: %q", installLevel),
		}
	}
	budget := resolveHostBudget(hostPosture)
	return c.resolveAtLevel(level, budget)
}

// resolveAtLevel resolves a single install level over the catalog (K-MCAT-034
// step 1-3). Any unsatisfiable required slot fails closed; there is no
// cross-preset substitution.
func (c *LocalProviderCatalog) resolveAtLevel(level string, budget hostBudget) LocalResolveOutcome {
	preset, ok := c.Preset(level)
	if !ok {
		return LocalResolveOutcome{
			Kind:         LocalResolveFailClose,
			InstallLevel: level,
			ReasonCode:   ReasonLocalModelResolveInstallLevelInvalid,
			Detail:       fmt.Sprintf("no curated preset for install level %q", level),
		}
	}
	outcome := LocalResolveOutcome{Kind: LocalResolveResolved, InstallLevel: level}
	for _, slot := range preset.Slots {
		model, found := c.ModelRow(slot.ModelRef)
		if !found || model.Install == nil || len(model.Variants) == 0 {
			// Preset integrity is validated at load time; a missing row here
			// is a hard fail-close, never a silent skip.
			return LocalResolveOutcome{
				Kind:         LocalResolveFailClose,
				InstallLevel: level,
				ReasonCode:   ReasonLocalModelResolveHostUnsupported,
				Detail:       fmt.Sprintf("preset slot %q model_ref %q has no local-plane catalog row", slot.Slot, slot.ModelRef),
			}
		}
		variant, runnable := selectVariant(model.Variants, budget)
		if !runnable {
			if slot.HostConditional {
				outcome.OmittedSlots = append(outcome.OmittedSlots, OmittedSlot{
					Slot:       slot.Slot,
					Capability: slot.Capability,
					ModelRef:   slot.ModelRef,
					ReasonCode: ReasonLocalModelResolveSlotOmitted,
					Note:       fmt.Sprintf("no variant of %q reaches the runnable tier on this host", slot.ModelRef),
				})
				continue
			}
			return LocalResolveOutcome{
				Kind:         LocalResolveFailClose,
				InstallLevel: level,
				ReasonCode:   ReasonLocalModelResolveHostUnsupported,
				Detail:       fmt.Sprintf("required slot %q (%s): no variant of %q is runnable on this host", slot.Slot, slot.Capability, slot.ModelRef),
			}
		}
		// K-MCAT-032/035 companion variant selection: resolve every companion
		// against the same host posture. A companion with no runnable variant
		// makes the parent slot unsatisfiable — it folds into the same
		// host_conditional->omit / required->fail-close rule (K-MCAT-036).
		companions, unresolvedCompanion := selectCompanionVariants(model.Companions, budget)
		if unresolvedCompanion != "" {
			if slot.HostConditional {
				outcome.OmittedSlots = append(outcome.OmittedSlots, OmittedSlot{
					Slot:       slot.Slot,
					Capability: slot.Capability,
					ModelRef:   slot.ModelRef,
					ReasonCode: ReasonLocalModelResolveSlotOmitted,
					Note:       fmt.Sprintf("companion %q of %q has no variant runnable on this host", unresolvedCompanion, slot.ModelRef),
				})
				continue
			}
			return LocalResolveOutcome{
				Kind:         LocalResolveFailClose,
				InstallLevel: level,
				ReasonCode:   ReasonLocalModelResolveHostUnsupported,
				Detail:       fmt.Sprintf("required slot %q (%s): companion %q of %q has no variant runnable on this host", slot.Slot, slot.Capability, unresolvedCompanion, slot.ModelRef),
			}
		}
		outcome.ResolvedSlots = append(outcome.ResolvedSlots, ResolvedSlot{
			Slot:        slot.Slot,
			Capability:  slot.Capability,
			ModelRef:    slot.ModelRef,
			AssetID:     variant.VariantID,
			VariantID:   variant.VariantID,
			Quant:       variant.Quant,
			Accelerator: strings.ToLower(strings.TrimSpace(variant.HostRequirement.Accelerator)),
			Companions:  companions,
		})
	}
	return outcome
}

// selectCompanionVariants runs K-MCAT-035 variant selection for each companion
// of a slot model against the same host posture. It returns the resolved
// companion bindings, or the engine_slot of the first companion that has no
// host-runnable variant (the parent slot is then unsatisfiable, K-MCAT-036).
func selectCompanionVariants(companions []LocalPlaneCompanion, budget hostBudget) ([]ResolvedCompanion, string) {
	if len(companions) == 0 {
		return nil, ""
	}
	resolved := make([]ResolvedCompanion, 0, len(companions))
	for _, companion := range companions {
		variant, runnable := selectVariant(companion.Variants, budget)
		if !runnable {
			return nil, companion.EngineSlot
		}
		resolved = append(resolved, ResolvedCompanion{
			CompanionKind: companion.CompanionKind,
			EngineSlot:    companion.EngineSlot,
			AssetID:       variant.VariantID,
			VariantID:     variant.VariantID,
			Quant:         variant.Quant,
			Accelerator:   strings.ToLower(strings.TrimSpace(variant.HostRequirement.Accelerator)),
		})
	}
	return resolved, ""
}

// ResolvedSlotByCapability returns the resolved slot serving a capability.
func (o LocalResolveOutcome) ResolvedSlotByCapability(capability string) (ResolvedSlot, bool) {
	want := strings.ToLower(strings.TrimSpace(capability))
	for _, slot := range o.ResolvedSlots {
		if strings.ToLower(strings.TrimSpace(slot.Capability)) == want {
			return slot, true
		}
	}
	return ResolvedSlot{}, false
}

// ResolvedSlotByName returns the resolved slot for a slot id (chat|stt|tts|...).
func (o LocalResolveOutcome) ResolvedSlotByName(slotID string) (ResolvedSlot, bool) {
	want := strings.ToLower(strings.TrimSpace(slotID))
	for _, slot := range o.ResolvedSlots {
		if strings.ToLower(strings.TrimSpace(slot.Slot)) == want {
			return slot, true
		}
	}
	return ResolvedSlot{}, false
}
